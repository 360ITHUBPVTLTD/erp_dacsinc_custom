"""Turns the agreed access sheets (/roles-and-permissions) into real access.

The two sheets saved by ``access_worksheet.save_sheet`` are the source of truth:

- ``doc_access`` → Custom DocPerm rows for the sheet roles on the sheet's
  documents, plus the linked documents those need (see "Dependencies").
- ``tab_access`` → Admin Settings › Order Flow tab and sub-tab role lists.

Only the sheet roles are managed: the roles flagged ``custom_dacsinc_access_role``
(``sheet_roles()``). Rows for any other role (HR Manager, …) are never touched, and
no role is ever deleted.

Roles and profiles (dynamic):

- Flag a role and it becomes a sheet column; ``INITIAL_ROLES`` is only the first set.
- Each flagged role gets one Role Profile holding exactly that role + Employee +
  Employee Self Service, flagged ``custom_dacsinc_access_profile`` — created when
  the role is flagged (Role ``on_update`` hook). A user may hold several profiles.
- The Roles & Permissions desk page shows only flagged roles and profiles.

Dependencies, so a role that may create a document never hits "no permission":

- A role that may create/edit a document gets Read + Select on every document
  linked from it, including links in child tables. On a *sheet* document the sheet
  decides, so there it gets only Select (enough to search and pick) — plus Read
  where the form fetches values from it (e.g. Customer name on a Sales Order).
- A role that may create/edit a *master* (Customer, Item, Supplier, Lead,
  Warehouse…) also gets create/edit on that master's own setup masters (Brand,
  Item Group, UOM, Customer Group, Territory, Lead Source…).
- These grants only ever ADD to what a role already has. What was added is
  tracked (DefaultValue ``derived_applied``), so a grant that is no longer needed
  takes back only what it added — hand-made rules (e.g. Merchandiser User's) stay.

Switch — nothing is taken away from any user until an Admin switches it on:

- **Off** (a site's first state, e.g. live right after the one-time patch):
  - roles, flags and fields exist, and profiles are created only where missing
    (existing profiles keep their roles, so no user loses one);
  - the sheets are stored (from ``access/agreed_access.json`` if the site has none);
  - saving a sheet only records it;
  - no permissions / Admin Settings tabs are changed, and the POS store scope is off.
- **On** (``activate()``, "Apply to the ERP" on the sheet page, Admin only):
  profiles are reset to role + Employee + ESS, both sheets are applied, and from
  then on every save applies at once and the POS store scope works.

``initial_setup`` runs once per site from a patch; a later migrate never re-runs
it, so what was changed on that site is never reset.
"""

import json
import os

import frappe
from frappe.permissions import setup_custom_perms

from erp_dacsinc_custom.access_worksheet import STATE_PARENT, load_sheet

INITIAL_ROLES = [
	"Accounts Executive", "Accounts Manager", "DAC CRM", "DAC CRM Head",
	"Finance Collection Executive", "Finance Executive", "Merchandiser User",
	"POS Admin", "POS Store Manager", "Production Assistant", "Production Manager",
	"Purchase Executive", "Purchase Manager", "Warehouse Incharge", "Warhouse Executive",
	"Packing Team", "Logistics",
]
# Role Profile name when it differs from the role name (an existing profile is
# reused; names match case-insensitively, e.g. "DAC CRM HEAD").
PROFILE_NAME = {"Merchandiser User": "Merchandiser", "Warhouse Executive": "Warehouse Executive"}
BASE_ROLES = ["Employee", "Employee Self Service"]
SHEET_ROLES = INITIAL_ROLES  # kept for callers; use sheet_roles() for the live list
ROLE_FLAG = "custom_dacsinc_access_role"
PROFILE_FLAG = "custom_dacsinc_access_profile"

# Sheet row → real doctype(s).
DOC_TARGETS = {"Contact & Address": ["Contact", "Address"]}

# Sheet letter → Custom DocPerm fields.
LETTER_FIELDS = {
	"V": ("read", "select", "print", "email", "report", "export"),
	"E": ("write", "create"),
	"S": ("submit",),
	"C": ("cancel", "amend"),
	"D": ("delete",),
}
PERM_FIELDS = ("read", "select", "print", "email", "report", "export", "write", "create",
			   "submit", "cancel", "amend", "delete", "import", "share")
DEP_READ = ("read", "select")
DEP_EDIT = ("read", "select", "write", "create")

# Dependencies never grant more than Read on these, and never touch the modules
# in DEP_SKIP_MODULES (framework / optional integrations).
DEP_READ_ONLY = {
	"Company", "Currency", "Price List", "Account", "Cost Center", "Country", "Letter Head",
	"Print Heading", "Print Format", "Terms and Conditions", "Workflow State", "Project",
	"Opportunity", "Prospect", "Sales Partner", "Campaign", "Batch", "Language",
}
DEP_SELECT_ONLY = {"User"}
DEP_SKIP_MODULES = {"Core", "Custom", "Desk", "Email", "Integrations", "Automation", "Website", "Social"}
DEP_SKIP = {"DocType"}
# Modules whose non-submittable masters are "setup masters" a master's editors may edit too.
DEP_EDIT_MODULES = {"Setup", "Stock", "Selling", "Buying", "CRM", "Contacts", "Erp Dacsinc Custom", "GST India"}

# Order Flow dashboard: sheet tab label → key; sub-tab label → key.
TAB_KEYS = {
	"SO Approvals": "approval", "Sales Tracker": "tracker", "Pick Lists": "picklist",
	"Purchase Flow": "purchase", "Job Work": "jobwork", "Stock Tracker": "stock",
	"Pending DN/SI": "billing", "Finance": "accounts", "Embroidery Transfers": "uniform",
	"Logistics": "logistics",
}
SUBTAB_KEYS = {
	"SO Approvals": {"1. Pending Approval (my orders)": "merchandiser", "2. Merchandiser Unassigned Orders": "unassigned",
					 "3. Other Merchandisers' Orders": "other", "4. Pending Final SO Approval": "final",
					 "5. Rejected Orders": "rejected"},
	"Sales Tracker": {"Sales Orders": "so", "Material Requests": "mr", "Embroidery - FP": "fp", "Embroidery - Panel": "pn"},
	"Purchase Flow": {"POs": "po", "Receipts": "receipt", "To Bill": "bill"},
	"Job Work": {"Sub POs": "po", "Sub Receipts": "receipt", "Embroidery - FP": "fp", "Embroidery - Panel": "pn"},
	"Finance": {"Receivables": "receivables", "Supplier Payables": "supplier", "Jobber Payables": "jobber"},
}
# A tab nobody may see gets this role, so it counts as configured (admins see everything anyway).
NOBODY_ROLE = "Admin"

BUNDLE_PATH = os.path.join(os.path.dirname(__file__), "access", "agreed_access.json")


# ------------------------------------------------------------------ roles / profiles
def sheet_roles():
	"""The flagged roles, in sheet order: INITIAL_ROLES order first, then any
	other flagged role alphabetically. Before the flag exists: INITIAL_ROLES."""
	if not frappe.db.has_column("Role", ROLE_FLAG):
		return list(INITIAL_ROLES)
	flagged = set(frappe.get_all("Role", filters={ROLE_FLAG: 1, "disabled": 0}, pluck="name"))
	if not flagged:
		return list(INITIAL_ROLES)
	return [r for r in INITIAL_ROLES if r in flagged] + sorted(flagged - set(INITIAL_ROLES))


def sheet_profiles():
	if not frappe.db.has_column("Role Profile", PROFILE_FLAG):
		return []
	return sorted(frappe.get_all("Role Profile", filters={PROFILE_FLAG: 1}, pluck="name"))

def ensure_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({
		"Role": [{
			"fieldname": ROLE_FLAG, "fieldtype": "Check", "label": "Access Sheet Role", "insert_after": "desk_access",
			"description": "Managed by the agreed access sheet (/roles-and-permissions). Only these roles are used.",
		}],
		"Role Profile": [{
			"fieldname": PROFILE_FLAG, "fieldtype": "Check", "label": "Access Sheet Profile", "insert_after": "role_profile",
			"description": "Offered on the Roles & Permissions page. Holds one access sheet role plus Employee and Employee Self Service.",
		}],
	}, update=True)


def _profile_name(role):
	"""Existing profile for this role (by name, or by its Profile Name field — some
	profiles were renamed, e.g. "Accounts" still has Profile Name "Accounts Manager";
	such a profile is renamed back), else the name to create."""
	wanted = PROFILE_NAME.get(role, role)
	name = frappe.db.get_value("Role Profile", {"name": wanted}, "name")
	if name:
		return name
	renamed = frappe.db.get_value("Role Profile", {"role_profile": wanted}, "name")
	if renamed:
		# Give it back the role's name, so the page shows the same name as the role.
		frappe.rename_doc("Role Profile", renamed, wanted, force=True)
		return wanted
	return wanted


def is_active():
	"""Is the access sheet switched on (applied to the ERP) on this site?"""
	return _state_get("active") == "1"


def ensure_roles_and_profiles(reset=None):
	"""Create/flag the sheet roles and their profiles. Returns profiles whose roles changed."""
	for role in INITIAL_ROLES:
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)
		frappe.db.set_value("Role", role, ROLE_FLAG, 1, update_modified=False)
	return ensure_profiles(sheet_roles(), reset=reset)


def ensure_profiles(roles, reset=None):
	"""Each role's profile = role + Employee + Employee Self Service, flagged.

	With reset off (the default while the sheet is switched off) an existing
	profile keeps its roles — only missing profiles are created — so no user loses
	a role. Returns profiles whose roles changed."""
	if reset is None:
		reset = is_active()
	changed = []
	for role in roles:
		name = _profile_name(role)
		wanted = [role] + BASE_ROLES
		if frappe.db.exists("Role Profile", name) and not reset:
			frappe.db.set_value("Role Profile", name, PROFILE_FLAG, 1, update_modified=False)
			continue
		if frappe.db.exists("Role Profile", name):
			doc = frappe.get_doc("Role Profile", name)
			if sorted(r.role for r in doc.roles) != sorted(wanted):
				# Rewrite the roles and update its users right here, in this
				# transaction. A normal save would lock the profile and queue that
				# update as a background job instead.
				frappe.db.delete("Has Role", {"parent": doc.name, "parenttype": "Role Profile"})
				for idx, r in enumerate(wanted, 1):
					frappe.get_doc({"doctype": "Has Role", "parent": doc.name, "parenttype": "Role Profile",
									"parentfield": "roles", "role": r, "idx": idx}).db_insert()
				doc = frappe.get_doc("Role Profile", doc.name)
				doc.update_all_users()
				doc.clear_cache()
				changed.append(doc.name)
		else:
			# Inserted directly (a new profile has no users to update), so no
			# lock / background job is involved.
			doc = frappe.get_doc({"doctype": "Role Profile", "role_profile": name,
								  "roles": [{"role": r} for r in wanted]})
			doc.name = name
			doc.set_parent_in_children()
			doc.db_insert()
			for d in doc.roles:
				d.db_insert()
			changed.append(doc.name)
		frappe.db.set_value("Role Profile", doc.name, PROFILE_FLAG, 1, update_modified=False)

	# Users on several profiles (User Access Profile) don't follow a profile edit by themselves.
	if changed and frappe.db.exists("DocType", "User Access Profile"):
		from erp_dacsinc_custom.erp_dacsinc_custom.doctype.user_access_profile.user_access_profile import (
			sync_user_access_profile,
		)
		for uap in set(frappe.get_all("User Access Profile Role Profile",
									  filters={"role_profile": ["in", changed]}, pluck="parent")):
			sync_user_access_profile(uap)
	return changed


def on_role_update(doc, method=None):
	"""Role on_update: a newly flagged role gets its profile straight away."""
	if doc.get(ROLE_FLAG) and not doc.disabled:
		ensure_profiles([doc.name])


# ------------------------------------------------------------------ helpers
def _role_columns(sheet):
	"""{role: index into the sheet's cells} for the sheet roles present in it."""
	roles = sheet.get("roles") or []
	return {r: roles.index(r) for r in sheet_roles() if r in roles}


def _flags(letters, submittable):
	out = set()
	for l in letters:
		if l in ("S", "C") and not submittable:
			continue
		out.update(LETTER_FIELDS.get(l, ()))
	return out


def _meta_links(doctype):
	"""(links on the doctype's own fields, links inside its child tables,
	targets the form fetches values from — fetch_from "<link field>.<field>")."""
	own, child, fetched = set(), set(), set()

	def scan(meta, into):
		link_target = {f.fieldname: f.options for f in meta.fields if f.fieldtype == "Link" and f.options}
		into.update(link_target.values())
		for f in meta.fields:
			src = (f.fetch_from or "").split(".")[0]
			if src in link_target:
				fetched.add(link_target[src])

	meta = frappe.get_meta(doctype)
	scan(meta, own)
	for f in meta.fields:
		if f.fieldtype in ("Table", "Table MultiSelect") and f.options:
			scan(frappe.get_meta(f.options), child)
	return own, child, fetched


def _dt_info():
	return {d.name: d for d in frappe.get_all(
		"DocType", fields=["name", "module", "issingle", "istable", "is_submittable", "is_virtual"])}


def _dep_level(target, info, parent_is_master, own_field):
	"""How much a create/edit right on the parent should grant on `target`."""
	if target in DEP_SELECT_ONLY:
		return ("select",)
	d = info.get(target)
	if not d or d.issingle or d.istable or d.is_virtual or target in DEP_SKIP or d.module in DEP_SKIP_MODULES:
		return None
	if (parent_is_master and own_field and not d.is_submittable and target not in DEP_READ_ONLY
			and d.module in DEP_EDIT_MODULES):
		return DEP_EDIT
	return DEP_READ


# ------------------------------------------------------------------ document access
def compute_doc_access(sheet):
	"""({doctype: {role: (flags, if_owner)}} from the sheet, {doctype: {role: flags}} dependencies)."""
	cols = _role_columns(sheet)
	cells = sheet.get("cells") or {}
	info = _dt_info()
	direct = {}
	for row, values in cells.items():
		for dt in DOC_TARGETS.get(row, [row]):
			if dt not in info:
				continue
			sub = bool(info[dt].is_submittable)
			direct[dt] = {r: (_flags(values[i], sub), int("O" in values[i])) for r, i in cols.items()}

	deps = {}
	for dt, by_role in direct.items():
		own, child, fetched = _meta_links(dt)
		is_master = not info[dt].is_submittable
		for role, (flags, _o) in by_role.items():
			if not flags & {"write", "create"}:
				continue
			for target, own_field in [(t, True) for t in own] + [(t, False) for t in child - own]:
				if target == dt:
					continue
				if target in direct:
					# A sheet document: the sheet decides. Only what picking needs.
					level = ("select", "read") if target in fetched else ("select",)
				else:
					level = _dep_level(target, info, is_master, own_field)
				if level:
					deps.setdefault(target, {}).setdefault(role, set()).update(level)
	return direct, deps


def _rows(doctype, role):
	return frappe.get_all("Custom DocPerm", filters={"parent": doctype, "role": role},
						  fields=["name", "permlevel", "if_owner", *PERM_FIELDS])


def _insert_row(doctype, role, flags, if_owner=0):
	frappe.get_doc({
		"doctype": "Custom DocPerm", "parent": doctype, "parenttype": "DocType", "parentfield": "permissions",
		"role": role, "permlevel": 0, "if_owner": if_owner, **{f: int(f in flags) for f in PERM_FIELDS},
	}).insert(ignore_permissions=True)


def apply_doc_access(sheet):
	"""Make the sheet roles' permissions match the sheet. Returns a summary dict."""
	direct, deps = compute_doc_access(sheet)
	touched, summary = set(), {"sheet_rows": 0, "dependency_grants": 0, "dependency_removed": 0, "select_added_on_sheet_docs": [], "read_added_on_sheet_docs": []}

	# 1. Sheet documents: exactly what the sheet says, plus Read/Select a dependency needs.
	for dt, by_role in direct.items():
		setup_custom_perms(dt)
		for role, (flags, if_owner) in by_role.items():
			need = deps.get(dt, {}).get(role, set()) & set(DEP_READ)
			if "read" in need - flags:
				summary["read_added_on_sheet_docs"].append(f"{role} · {dt}")
			elif need - flags:
				summary["select_added_on_sheet_docs"].append(f"{role} · {dt}")
			flags = flags | need
			for r in _rows(dt, role):
				frappe.delete_doc("Custom DocPerm", r.name, ignore_permissions=True, force=True)
			if flags:
				_insert_row(dt, role, flags, if_owner)
				summary["sheet_rows"] += 1
		touched.add(dt)

	# 2. Linked documents: only ever add; take back only what we added before.
	prev = json.loads(_state_get("derived_applied") or "{}")
	new_state = {}
	for dt in sorted(set(deps) | set(prev)):
		if dt in direct:
			continue
		want_by_role = deps.get(dt, {})
		for role in sorted(set(want_by_role) | set(prev.get(dt, {}))):
			want = want_by_role.get(role, set())
			added_before = set(prev.get(dt, {}).get(role, []))
			rows = [r for r in _rows(dt, role) if r.permlevel == 0 and not r.if_owner]
			row = rows[0] if rows else None
			have = {f for f in PERM_FIELDS if row and row.get(f)}
			to_add = want - have
			to_remove = added_before - want
			ours = (added_before & want) | to_add          # still-needed rights we granted
			if to_add or to_remove:
				setup_custom_perms(dt)
				rows = [r for r in _rows(dt, role) if r.permlevel == 0 and not r.if_owner]
				row = rows[0] if rows else None
				if row:
					doc = frappe.get_doc("Custom DocPerm", row.name)
					for f in to_add:
						doc.set(f, 1)
					for f in to_remove:
						doc.set(f, 0)
					if any(doc.get(f) for f in PERM_FIELDS):
						doc.save(ignore_permissions=True)
					else:
						frappe.delete_doc("Custom DocPerm", doc.name, ignore_permissions=True, force=True)
				elif to_add:
					_insert_row(dt, role, to_add)
				summary["dependency_grants"] += len(to_add)
				summary["dependency_removed"] += len(to_remove)
				touched.add(dt)
			if ours:
				new_state.setdefault(dt, {})[role] = sorted(ours)
	_state_set("derived_applied", json.dumps(new_state))
	summary["linked_doctypes"] = len(new_state)

	summary["report_roles_added"], summary["report_roles_removed"] = apply_report_access(direct)

	for dt in touched:
		frappe.clear_cache(doctype=dt)
	return summary


def apply_report_access(direct):
	"""View includes reports: a role that may view a document gets the reports
	built on it (Report.ref_doctype). Additive and tracked like dependencies."""
	want = {}
	for dt, by_role in direct.items():
		roles = [r for r, (flags, _o) in by_role.items() if "read" in flags]
		if not roles:
			continue
		for rep_name in frappe.get_all("Report", filters={"ref_doctype": dt, "disabled": 0}, pluck="name"):
			want.setdefault(rep_name, set()).update(roles)
	prev = json.loads(_state_get("reports_applied") or "{}")
	added = removed = 0
	state = {}
	for rep_name in sorted(set(want) | set(prev)):
		have = set(frappe.get_all("Has Role", filters={"parent": rep_name, "parenttype": "Report"}, pluck="role"))
		mine = set(prev.get(rep_name, []))
		wanted = want.get(rep_name, set())
		if not have - mine:
			# No role list of its own = open to everyone who may report on the
			# document; adding one would shut the others out.
			wanted = set()
		for role in wanted - have:
			frappe.get_doc({"doctype": "Has Role", "parent": rep_name, "parenttype": "Report", "parentfield": "roles",
							"role": role}).db_insert()
			added += 1
		for role in (mine - wanted) & have:
			frappe.db.delete("Has Role", {"parent": rep_name, "parenttype": "Report", "role": role})
			removed += 1
		ours = (mine & wanted) | (wanted - have)
		if ours:
			state[rep_name] = sorted(ours)
		if wanted - have or (mine - wanted) & have:
			frappe.clear_document_cache("Report", rep_name)
	_state_set("reports_applied", json.dumps(state))
	return added, removed


# ------------------------------------------------------------------ Order Flow tabs
def apply_tab_access(sheet):
	"""Set Admin Settings › Order Flow tab and sub-tab roles from the tab sheet."""
	cols = _role_columns(sheet)
	cells = sheet.get("cells") or {}
	who = lambda key: [r for r, i in cols.items() if (cells.get(key) or [""] * 99)[i] in ("Y", "A")] or [NOBODY_ROLE]
	doc = frappe.get_doc("Admin Settings")
	meta = frappe.get_meta("Admin Settings")
	set_fields = 0
	for tab, key in TAB_KEYS.items():
		field = f"of_tab_{key}_roles"
		if meta.has_field(field):
			doc.set(field, [{"role": r} for r in who(tab)])
			set_fields += 1
		for label, sub in SUBTAB_KEYS.get(tab, {}).items():
			field = f"of_sub_{key}_{sub}_roles"
			if meta.has_field(field):
				doc.set(field, [{"role": r} for r in who(f"{tab} › {label}")])
				set_fields += 1
	doc.flags.ignore_permissions = True
	doc.save(ignore_permissions=True)
	return {"fields": set_fields}


# ------------------------------------------------------------------ state / bundle
def _state_get(key):
	return frappe.db.get_value("DefaultValue", {"parent": STATE_PARENT, "defkey": key}, "defvalue")


def _state_set(key, value):
	name = frappe.db.get_value("DefaultValue", {"parent": STATE_PARENT, "defkey": key}, "name")
	if name:
		frappe.db.set_value("DefaultValue", name, "defvalue", value, update_modified=False)
	else:
		frappe.get_doc({"doctype": "DefaultValue", "parent": STATE_PARENT, "parenttype": "__default",
						"parentfield": "system_defaults", "defkey": key, "defvalue": value}).insert(ignore_permissions=True)


def write_bundle():
	"""Copy the saved sheets into the app (developer mode only), so the next deploy ships them."""
	if not frappe.conf.developer_mode:
		return False
	data = {s: load_sheet(s) for s in ("doc_access", "tab_access")}
	os.makedirs(os.path.dirname(BUNDLE_PATH), exist_ok=True)
	with open(BUNDLE_PATH, "w") as f:
		json.dump(data, f, indent=1, sort_keys=True)
		f.write("\n")
	return True


def read_bundle():
	if not os.path.exists(BUNDLE_PATH):
		return {}
	with open(BUNDLE_PATH) as f:
		return json.load(f) or {}


def apply_sheet(sheet_name, sheet):
	if sheet_name == "doc_access":
		return apply_doc_access(sheet)
	if sheet_name == "tab_access":
		return apply_tab_access(sheet)


def initial_setup():
	"""One-time setup for a site (run from a patch).

	Always safe: creates fields, roles, flags and missing profiles, and stores the
	sheets. It applies them only on a site where the sheet is already switched on."""
	from erp_dacsinc_custom.access_worksheet import store_sheet

	ensure_custom_fields()
	ensure_roles_and_profiles()
	bundle = read_bundle()
	result = {"active": is_active()}
	for name in ("doc_access", "tab_access"):
		sheet = load_sheet(name)
		if not sheet and bundle.get(name):
			sheet = store_sheet(name, bundle[name]["roles"], bundle[name]["cells"],
								note="from the agreed sheet shipped with the app")
		if sheet and is_active():
			result[name] = apply_sheet(name, sheet)
	return result


def activation_preview():
	"""What switching on would change for users: {user: [roles they would lose]}."""
	losing = {}
	for role in sheet_roles():
		name = _profile_name_readonly(role)
		if not name:
			continue
		extra = set(frappe.get_all("Has Role", filters={"parent": name, "parenttype": "Role Profile"}, pluck="role")) \
			- {role, *BASE_ROLES}
		if not extra:
			continue
		users = set(frappe.get_all("User", filters={"role_profile_name": name}, pluck="name"))
		users |= set(frappe.get_all("User Access Profile Role Profile", filters={"role_profile": name}, pluck="parent")) \
			if frappe.db.exists("DocType", "User Access Profile") else set()
		for u in users:
			losing.setdefault(u, set()).update(extra)
	return {u: sorted(r) for u, r in sorted(losing.items())}


def _profile_name_readonly(role):
	wanted = PROFILE_NAME.get(role, role)
	return (frappe.db.get_value("Role Profile", {"name": wanted}, "name")
			or frappe.db.get_value("Role Profile", {"role_profile": wanted}, "name"))


@frappe.whitelist(methods=["POST"])
def activate():
	"""Switch the access sheet on: reset the profiles, apply both sheets. Admin only."""
	from erp_dacsinc_custom.access_worksheet import EDIT_ROLE

	frappe.only_for(EDIT_ROLE)
	result = {"profiles_reset": ensure_roles_and_profiles(reset=True)}
	for name in ("doc_access", "tab_access"):
		sheet = load_sheet(name)
		if sheet:
			result[name] = apply_sheet(name, sheet)
	_state_set("active", "1")
	return result


@frappe.whitelist()
def get_activation_preview():
	from erp_dacsinc_custom.access_worksheet import EDIT_ROLE

	frappe.only_for(EDIT_ROLE)
	return {"active": is_active(), "users": activation_preview()}
