"""POS Admin and Warehouse Incharge: every Material Request action (user, 19-11-2026; docs/pos-store-scope.md).

New, Edit, Submit, Stop / Close, Cancel, Amend, Delete — on every Material Request (the "all
Material Requests" part is code: pos_scope / pos_request). Add-only, for these two roles only:

1. Access sheet: the Material Request cell of both columns becomes VNESCD (letters already there are kept),
   so a later sheet save keeps it.
2. Custom DocPerm Material Request (level 0, all records): those rights switched on for both roles.
   Nothing is switched off; no other role's row is touched.
3. What the new cell brings with it on linked documents (Select / Read on what an MR form links:
   Item, Warehouse, UOM, …) — only the difference between the sheet before and after this cell
   change, for these two roles, added where missing and tracked in ``derived_applied``. Older
   differences between the sheet and a site's permissions are left alone.

No sheet apply, no Admin Settings save, no access/agreed_access.json / RULES_VERSION change.
Running it again changes nothing.
"""
import frappe

ROLES = ("POS Admin", "Warehouse Incharge")
DT = "Material Request"
LETTERS = "VNESCD"


def execute():
	if not frappe.db.exists("DocType", DT):
		return
	roles = [r for r in ROLES if frappe.db.exists("Role", r)]
	if not roles:
		return
	frappe.flags.dacs_access_applying = True  # our own writes are not read back into the sheet
	try:
		old, new = update_sheet(roles)
		grant_material_request(roles)
		if old and new:
			grant_linked(old, new, roles)
	finally:
		frappe.flags.dacs_access_applying = False
	frappe.clear_cache()


def update_sheet(roles):
	from erp_dacsinc_custom.access_worksheet import load_sheet, store_sheet

	sheet = load_sheet("doc_access")
	if not sheet or DT not in (sheet.get("cells") or {}):
		return None, None
	old = {"roles": list(sheet["roles"]), "cells": {k: list(v) for k, v in sheet["cells"].items()}}
	cols = sheet.get("roles") or []
	row = list(sheet["cells"][DT]) + [""] * (len(cols) - len(sheet["cells"][DT]))
	changed = False
	for role in roles:
		if role not in cols:
			continue
		i = cols.index(role)
		have = (row[i] or "").replace("O", "")  # O = own records only: these roles get all records
		new = "".join(l for l in "VNESCOD" if l in have or l in LETTERS)
		if new != row[i]:
			row[i] = new
			changed = True
	if changed:
		sheet["cells"][DT] = row
		store_sheet("doc_access", cols, sheet["cells"],
					note="Material Request: every action for POS Admin and Warehouse Incharge")
		return old, load_sheet("doc_access")
	return None, None  # nothing changed in the sheet: nothing new on linked documents


def grant_material_request(roles):
	from erp_dacsinc_custom.access_sync import LETTER_FIELDS

	fields = {f for l in LETTERS for f in LETTER_FIELDS[l]}
	for role in roles:
		rows = frappe.get_all("Custom DocPerm", filters={"parent": DT, "role": role, "permlevel": 0, "if_owner": 0},
							  pluck="name")
		if rows:
			doc = frappe.get_doc("Custom DocPerm", rows[0])
			missing = [f for f in fields if not doc.get(f)]
			if missing:
				for f in missing:
					doc.set(f, 1)
				doc.save(ignore_permissions=True)
		else:
			frappe.get_doc({"doctype": "Custom DocPerm", "parent": DT, "parenttype": "DocType",
							"parentfield": "permissions", "role": role, "permlevel": 0, "if_owner": 0,
							**{f: 1 for f in fields}}).insert(ignore_permissions=True)
	frappe.clear_cache(doctype=DT)


def grant_linked(old, new, roles):
	from erp_dacsinc_custom.access_sync import DEP_READ, _map_get, _map_set, compute_doc_access

	_d, before = compute_doc_access(old)
	direct, deps = compute_doc_access(new)
	derived = _map_get("derived_applied")
	changed = False
	for dt, by_role in deps.items():
		for role in roles:
			want = set(by_role.get(role, ())) - set(before.get(dt, {}).get(role, ()))
			if dt in direct:
				want &= set(DEP_READ)  # a sheet document: only what picking / displaying needs
			want = {f for f in want if f in ("read", "select", "print", "email", "report", "export",
											 "write", "create")}
			if not want:
				continue
			rows = frappe.get_all("Custom DocPerm", filters={"parent": dt, "role": role, "permlevel": 0, "if_owner": 0},
								  pluck="name")
			doc = frappe.get_doc("Custom DocPerm", rows[0]) if rows else None
			add = {f for f in want if not (doc and doc.get(f))}
			if not add:
				continue
			if not frappe.db.exists("Custom DocPerm", {"parent": dt}):
				from frappe.permissions import setup_custom_perms

				setup_custom_perms(dt)
				rows = frappe.get_all("Custom DocPerm",
									  filters={"parent": dt, "role": role, "permlevel": 0, "if_owner": 0}, pluck="name")
				doc = frappe.get_doc("Custom DocPerm", rows[0]) if rows else None
				add = {f for f in want if not (doc and doc.get(f))}
				if not add:
					continue
			if doc:
				for f in add:
					doc.set(f, 1)
				doc.save(ignore_permissions=True)
			else:
				frappe.get_doc({"doctype": "Custom DocPerm", "parent": dt, "parenttype": "DocType",
								"parentfield": "permissions", "role": role, "permlevel": 0, "if_owner": 0,
								**{f: 1 for f in add}}).insert(ignore_permissions=True)
			frappe.clear_cache(doctype=dt)
			if dt not in direct:
				mine = set(derived.setdefault(dt, {}).get(role, [])) | add
				derived[dt][role] = sorted(mine)
				changed = True
	if changed:
		_map_set("derived_applied", derived)
