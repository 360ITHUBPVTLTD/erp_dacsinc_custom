"""Role Permission Manager → Document access sheet (the other direction).

The sheet on /roles-and-permissions is the source of truth, and saving it writes the
permissions (access_sync.apply_doc_access). When someone changes a sheet role's rights
on a sheet document in Role Permission Manager instead, the sheet follows:

- the change is read back into the sheet's letters (V N E S C D O) and stored as a new
  sheet version ("Role Permission Manager · <user>"), and in developer mode the bundle
  (access/agreed_access.json) is rewritten, so the next deploy carries it to live;
- the sheet is then re-applied in the background, so linked-document rights, reports
  and tabs follow too, and the rows are normalised to the sheet's letters (N = create,
  E = write, V = read, print, email, report, export…).

A tweak that doesn't change a letter (e.g. unticking only Export) isn't a sheet change;
it stays until the sheet is applied next, which puts the letter's full set back.

Rights the sheet itself adds for linked documents (Read / Select on Address, Contact,
fetched masters) are not read back as View. Only roles flagged for the sheet and the
documents on it are followed, and only while the sheet is applied (access_sync.is_active).
"""

import frappe

from frappe.core.page.permission_manager import permission_manager as pm

LETTERS = "VNESCDO"
V_EXTRA = {"print", "email", "report", "export"}


def _applying():
	return bool(frappe.flags.dacs_access_applying)


def _sheet_rows_for(doctypes):
	"""{sheet row: [doctype, ...]} for the sheet rows these doctypes belong to."""
	from erp_dacsinc_custom.access_sync import DOC_TARGETS

	out = {}
	for dt in doctypes:
		row = next((r for r, targets in DOC_TARGETS.items() if dt in targets), dt)
		out.setdefault(row, []).append(dt)
	return out


def _perm_rows(doctype, role):
	fields = ["permlevel", "if_owner", "read", "select", "print", "email", "report", "export",
			  "write", "create", "submit", "cancel", "amend", "delete"]
	table = "Custom DocPerm" if frappe.db.exists("Custom DocPerm", {"parent": doctype}) else "DocPerm"
	return frappe.get_all(table, filters={"parent": doctype, "role": role, "permlevel": 0}, fields=fields)


def letters_from_perms(rows, need, old, submittable):
	"""Sheet letters for one role on one document from its permission rows.

	need: what the sheet's linked-document rule adds there anyway (not a sheet right
	unless the cell already had it); old: the cell's current letters."""
	def of(row):
		if not row:
			return ""
		have = {f for f in ("read", "select", "write", "create", "submit", "cancel", "delete", *V_EXTRA) if row.get(f)}
		out = set()
		if "read" in have and ("read" not in need or (have & V_EXTRA) - need or "V" in old):
			out.add("V")
		if "create" in have and ("create" not in need or "N" in old):
			out.add("N")
		if "write" in have and ("write" not in need or "E" in old):
			out.add("E")
		if submittable and "submit" in have:
			out.add("S")
		if submittable and "cancel" in have:
			out.add("C")
		if "delete" in have:
			out.add("D")
		if out:
			out.add("V")  # every right needs View
		return out

	def union(rs):  # Frappe grants what any of a role's rows gives
		return {f: 1 for r in rs for f, v in r.items() if v and f not in ("permlevel", "if_owner")} if rs else None

	general = union([r for r in rows if not r.if_owner])
	own = union([r for r in rows if r.if_owner])
	letters = of(general)
	if not letters:
		letters = of(own)
		if letters:
			letters.add("O")
	return "".join(l for l in LETTERS if l in letters)


def read_back(doctypes=None):
	"""What the Document access sheet would become from the ERP's actual rights.
	doctypes: only these (None = every sheet document).
	Returns (sheet, new_cells, {(row, role): (old, new)}), or (None, None, {})."""
	from erp_dacsinc_custom import access_sync
	from erp_dacsinc_custom.access_worksheet import load_sheet

	sheet = load_sheet("doc_access")
	if not sheet:
		return None, None, {}
	cells = sheet.get("cells") or {}
	if doctypes is None:
		rows = {r: access_sync.DOC_TARGETS.get(r, [r]) for r in cells}
	else:
		rows = {r: dts for r, dts in _sheet_rows_for(doctypes).items() if r in cells}
	rows = {r: [d for d in dts if frappe.db.exists("DocType", d)] for r, dts in rows.items()}
	rows = {r: dts for r, dts in rows.items() if dts}
	cols = access_sync._role_columns(sheet)
	_direct, deps = access_sync.compute_doc_access(sheet)
	changed = {}
	new_cells = {r: list(v) for r, v in cells.items()}
	for row, dts in rows.items():
		dt = dts[0]  # "Contact & Address": the one just edited (Contact for a full sync)
		submittable = bool(frappe.get_meta(dt).is_submittable)
		for role, i in cols.items():
			old = cells[row][i]
			new = letters_from_perms(_perm_rows(dt, role), deps.get(dt, {}).get(role, set()), old, submittable)
			if new != old:
				new_cells[row][i] = new
				changed[(row, role)] = (old, new)
	return sheet, new_cells, changed


def _record(sheet, new_cells, changed, source):
	from erp_dacsinc_custom import access_sync
	from erp_dacsinc_custom.access_worksheet import store_sheet

	note = f"{source} · {frappe.utils.get_fullname(frappe.session.user)}: " + "; ".join(
		f"{role} · {row}: {old or '—'} → {new or '—'}" for (row, role), (old, new) in changed.items())
	data = store_sheet("doc_access", sheet["roles"], new_cells, note=note[:500])
	access_sync.write_bundle()
	frappe.enqueue("erp_dacsinc_custom.access_reverse.reapply_doc_sheet", queue="short",
				   job_id="dacs_access_reapply", deduplicate=True, enqueue_after_commit=True)
	return data


def sync_sheet_from_perms(doctypes, source="Role Permission Manager"):
	"""Read the sheet roles' rights on these doctypes back into the Document access sheet.
	Returns the changed cells {(row, role): (old, new)}."""
	from erp_dacsinc_custom import access_sync

	if _applying() or not access_sync.is_active():
		return {}
	sheet, new_cells, changed = read_back(doctypes)
	if changed:
		_record(sheet, new_cells, changed, source)
	return changed


@frappe.whitelist(methods=["POST"])
def sync_from_erp(confirm=0, base_version=0):
	"""The page's "Sync from ERP": the whole Document access sheet from the ERP's actual
	role rights (System Manager). confirm=0 → preview only; confirm=1 → record it as
	one new version (refused if the sheet was saved since the preview)."""
	from erp_dacsinc_custom import access_sync
	from erp_dacsinc_custom.access_worksheet import RESET_ROLE

	frappe.only_for(RESET_ROLE)
	if not access_sync.is_active():
		frappe.throw("The sheet isn't applied to the ERP yet, so the ERP's rights aren't the sheet's to read back.")
	sheet, new_cells, changed = read_back()
	items = [{"row": row, "role": role, "old": old, "new": new} for (row, role), (old, new) in sorted(changed.items())]
	if not frappe.utils.cint(confirm) or not changed:
		return {"version": sheet and sheet.get("version"), "changes": items}
	if int(sheet.get("version") or 0) != int(base_version or 0):
		frappe.throw("The sheet was saved again after the preview. Run Sync from ERP again.", title="Sheet changed")
	data = _record(sheet, new_cells, changed, "Sync from ERP")
	return {"version": data["version"], "changes": items, "saved": data}


def reapply_doc_sheet():
	"""Background: apply the Document access sheet again (linked documents, reports)."""
	from erp_dacsinc_custom import access_sync
	from erp_dacsinc_custom.access_worksheet import load_sheet

	if access_sync.is_active():
		access_sync.apply_sheet("doc_access", load_sheet("doc_access"))


# ------------------------------------------------------------------ Order Flow tabs
# Admin Settings › Order Flow → the tab sheet, the same way: a sheet role listed to
# see a tab / sub-tab is ✓, listed to act from it (…_act_roles) is A. An empty act
# list means everyone who sees it may act (order_flow_permissions.can_act_tab), so
# its viewers read back as A; a sub-tab without its own act list follows its tab.
# An empty view list (never configured) leaves the cell as it is.
def read_back_tabs():
	from erp_dacsinc_custom import access_sync
	from erp_dacsinc_custom.access_worksheet import load_sheet

	sheet = load_sheet("tab_access")
	if not sheet:
		return None, None, {}
	frappe.clear_document_cache("Admin Settings", "Admin Settings")
	doc = frappe.get_doc("Admin Settings")
	meta = frappe.get_meta("Admin Settings")
	listed = lambda f: {d.role for d in (doc.get(f) or []) if d.role} if meta.has_field(f) else set()
	cells = sheet.get("cells") or {}
	cols = access_sync._role_columns(sheet)
	tab_act = {}
	changed, new_cells = {}, {r: list(v) for r, v in cells.items()}
	for row, view_f, act_f in access_sync.tab_fields():
		view, act = listed(view_f), listed(act_f)
		if " › " not in row:
			tab_act[row] = act
		else:
			act = act or tab_act.get(row.split(" › ")[0], set())
		if row not in cells or not (view or act):
			continue
		for role, i in cols.items():
			old = cells[row][i]
			new = "A" if role in act or (role in view and not act) else "Y" if role in view else ""
			if new != old:
				new_cells[row][i] = new
				changed[(row, role)] = (old, new)
	return sheet, new_cells, changed


def _record_tabs(sheet, new_cells, changed, source):
	from erp_dacsinc_custom import access_sync
	from erp_dacsinc_custom.access_worksheet import store_sheet

	word = {"": "hidden", "Y": "view", "A": "view + act"}
	note = f"{source} · {frappe.utils.get_fullname(frappe.session.user)}: " + "; ".join(
		f"{role} · {row}: {word[old]} → {word[new]}" for (row, role), (old, new) in changed.items())
	data = store_sheet("tab_access", sheet["roles"], new_cells, note=note[:500])
	access_sync.write_bundle()
	return data


def on_admin_settings_update(doc, method=None):
	"""Admin Settings on_update: tab / sub-tab role changes made there reach the tab sheet."""
	from erp_dacsinc_custom import access_sync

	if _applying() or not access_sync.is_active():
		return
	sheet, new_cells, changed = read_back_tabs()
	if changed:
		_record_tabs(sheet, new_cells, changed, "Admin Settings")


@frappe.whitelist(methods=["POST"])
def sync_tabs_from_settings(confirm=0, base_version=0):
	"""The tab sheet's "Sync from Admin Settings" (System Manager): preview, or record."""
	from erp_dacsinc_custom import access_sync
	from erp_dacsinc_custom.access_worksheet import RESET_ROLE

	frappe.only_for(RESET_ROLE)
	if not access_sync.is_active():
		frappe.throw("The sheet isn't applied to the ERP yet, so Admin Settings isn't the sheet's to read back.")
	sheet, new_cells, changed = read_back_tabs()
	items = [{"row": row, "role": role, "old": old, "new": new} for (row, role), (old, new) in sorted(changed.items())]
	if not frappe.utils.cint(confirm) or not changed:
		return {"version": sheet and sheet.get("version"), "changes": items}
	if int(sheet.get("version") or 0) != int(base_version or 0):
		frappe.throw("The sheet was saved again after the preview. Run the sync again.", title="Sheet changed")
	data = _record_tabs(sheet, new_cells, changed, "Sync from Admin Settings")
	return {"version": data["version"], "changes": items, "saved": data}


# ------------------------------------------------------------------ adding documents
# A System Manager can put any document type on the Document access sheet. Its row
# starts from what each sheet role can actually do on it now (so nobody loses a
# right), and from then on the sheet decides it like any other row. Added rows are
# kept in the sheet (`added`), so the bundle carries them to live.
SKIP_MODULES = {"Core", "Custom", "Desk", "Email", "Integrations", "Automation", "Website", "Social", "Printing"}


def _addable(dt):
	d = frappe.db.get_value("DocType", dt, ["istable", "issingle", "is_virtual", "module"], as_dict=True)
	return bool(d) and not d.istable and not d.issingle and not d.is_virtual and d.module not in SKIP_MODULES


@frappe.whitelist()
def addable_doctypes():
	from erp_dacsinc_custom import access_sync
	from erp_dacsinc_custom.access_worksheet import RESET_ROLE, load_sheet

	frappe.only_for(RESET_ROLE)
	sheet = load_sheet("doc_access") or {}
	have = {d for r in (sheet.get("cells") or {}) for d in access_sync.DOC_TARGETS.get(r, [r])}
	return sorted(d.name for d in frappe.get_all("DocType", filters={"istable": 0, "issingle": 0, "is_virtual": 0,
			"module": ["not in", list(SKIP_MODULES)]}, fields=["name"]) if d.name not in have)


@frappe.whitelist(methods=["POST"])
def add_sheet_document(doctype, group, confirm=0, base_version=0):
	"""Add a document to the Document access sheet (System Manager). confirm=0 → the
	row it would get (from the roles' actual rights); confirm=1 → record it."""
	from erp_dacsinc_custom import access_sync
	from erp_dacsinc_custom.access_worksheet import RESET_ROLE, load_sheet, store_sheet

	frappe.only_for(RESET_ROLE)
	group = (group or "").strip()[:60] or "Other documents"
	if not _addable(doctype):
		frappe.throw(f"{doctype} can't be put on the sheet (not a main document).")
	sheet = load_sheet("doc_access")
	if not sheet:
		frappe.throw("The Document access sheet hasn't been saved yet.")
	if doctype in sheet["cells"] or any(doctype in t for t in access_sync.DOC_TARGETS.values()):
		frappe.throw(f"{doctype} is already on the sheet.")
	submittable = int(frappe.get_meta(doctype).is_submittable or 0)
	cols = access_sync._role_columns(sheet)
	row = [""] * len(sheet["roles"])
	for role, i in cols.items():
		# Everything the role can do there today counts (need = nothing), so nobody loses a right.
		row[i] = letters_from_perms(_perm_rows(doctype, role), set(), "", submittable)
	preview = {role: row[i] for role, i in cols.items()}
	if not frappe.utils.cint(confirm):
		return {"doctype": doctype, "group": group, "submittable": submittable, "row": preview}
	if int(sheet.get("version") or 0) != int(base_version or 0):
		frappe.throw("The sheet was saved again meanwhile. Reload the page, then add it again.", title="Sheet changed")
	cells = dict(sheet["cells"], **{doctype: row})
	added = dict(sheet.get("added") or {}, **{doctype: {"group": group, "submittable": submittable}})
	given = "; ".join(f"{r}: {v}" for r, v in preview.items() if v) or "no role has rights yet"
	data = store_sheet("doc_access", sheet["roles"], cells, added=added,
					   note=f"Added {doctype} to the sheet ({group}), read from the ERP · {given}"[:500])
	access_sync.write_bundle()
	if access_sync.is_active():
		frappe.enqueue("erp_dacsinc_custom.access_reverse.reapply_doc_sheet", queue="short",
					   job_id="dacs_access_reapply", deduplicate=True, enqueue_after_commit=True)
	return {"saved": data}


@frappe.whitelist(methods=["POST"])
def remove_sheet_document(doctype, base_version=0):
	"""Take an added document off the sheet (System Manager). Roles keep the rights they
	have on it; the sheet just stops deciding them. Built-in rows can't be removed."""
	from erp_dacsinc_custom import access_sync
	from erp_dacsinc_custom.access_worksheet import RESET_ROLE, load_sheet, store_sheet

	frappe.only_for(RESET_ROLE)
	sheet = load_sheet("doc_access") or {}
	added = dict(sheet.get("added") or {})
	if doctype not in added:
		frappe.throw(f"{doctype} wasn't added on this page, so it can't be removed here.")
	if int(sheet.get("version") or 0) != int(base_version or 0):
		frappe.throw("The sheet was saved again meanwhile. Reload the page, then try again.", title="Sheet changed")
	added.pop(doctype)
	cells = {r: v for r, v in sheet["cells"].items() if r != doctype}
	data = store_sheet("doc_access", sheet["roles"], cells, added=added,
					   note=f"Removed {doctype} from the sheet (roles keep their current rights on it)")
	access_sync.write_bundle()
	return {"saved": data}


# ------------------------------------------------------------------ hooks
def on_custom_docperm_change(doc, method=None):
	"""Custom DocPerm insert / update / delete (other than the sheet's own apply)."""
	if not _applying() and doc.parent:
		sync_sheet_from_perms([doc.parent])


# Role Permission Manager's own endpoints (override_whitelisted_methods): the core
# action, then the sheet follows. `update` writes with db.set_value, which fires no
# document events, so these wrappers are what catches it.
@frappe.whitelist()
def rpm_add(parent, role, permlevel):
	out = pm.add(parent, role, permlevel)
	sync_sheet_from_perms([parent])
	return out


@frappe.whitelist()
def rpm_update(doctype, role, permlevel, ptype, value=None, if_owner=0):
	out = pm.update(doctype, role, permlevel, ptype, value, if_owner)
	sync_sheet_from_perms([doctype])
	return out


@frappe.whitelist()
def rpm_remove(doctype, role, permlevel, if_owner=0):
	out = pm.remove(doctype, role, permlevel, if_owner)
	sync_sheet_from_perms([doctype])
	return out


@frappe.whitelist()
def rpm_reset(doctype):
	out = pm.reset(doctype)
	sync_sheet_from_perms([doctype])
	return out
