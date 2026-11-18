"""New role Operations Manager = Merchandiser User's access for every customer, without accounts
(user, 18-11-2026; docs/operations-manager.md).

Everything is copied at run time from THIS site's Merchandiser User — live's access differs from local —
and only rows for the new role are added. No other role, no Admin Settings save, no sheet apply, no bundle
file (access/agreed_access.json) is touched, so no other role's access changes on any site.

1. Role "Operations Manager" (desk, flagged for the access sheet) and its Role Profile
   "Operations Manager (Order Flow)" (role + Employee + Employee Self Service; access_sync.PROFILE_NAME —
   the old "Operations Manager" profile on live is a different, unrelated one and is left untouched).
   No user gets it: assign the profile by hand.
2. Access sheet: an "Operations Manager" column in the stored Document and Order Flow sheets, a copy of the
   Merchandiser User column — so a later sheet save keeps it instead of wiping it.
3. Custom DocPerm: each Merchandiser User row copied (all flags, if_owner, permlevel), except Read on
   accounting documents (Sales / Purchase Invoice, Payment Entry, Journal Entry …); Select-only rows there stay
   so forms that link them still load. Linked-document grants are tracked like the sheet's own.
4. Reports / pages: every report and page Merchandiser User may open, except the accounting and tax reports.
5. Admin Settings › Order Flow tab / sub-tab (view and Can Act) role lists: added wherever Merchandiser User is.
6. Sales Order Workflow: Approve / Reject at Pending Merchandiser Approval and editing in that state,
   rows copied from Merchandiser User's (appended; live's own rows stay).

Run twice = no change (each step adds only what is missing).
"""
import json

import frappe

ROLE = "Operations Manager"
SOURCE = "Merchandiser User"

# No Read on these, whatever Merchandiser User has (Select-only rows are kept for link fields).
ACCOUNT_DOCS = {
	"Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry", "Payment Request", "GL Entry",
	"Payment Ledger Entry", "Bank Transaction", "Bank Clearance", "Period Closing Voucher",
	"Payment Reconciliation", "Dunning", "Bulk Payment", "POS Invoice", "POS Closing Entry", "POS Opening Entry",
}
# Reports never copied: accounting / tax / finance (besides every report of the Accounts module).
ACCOUNT_REPORTS = {
	"General Ledger", "Sales Register", "Purchase Register", "Item-wise Sales Register", "Item-wise Purchase Register",
	"Accounts Payable", "Accounts Payable Summary", "Accounts Receivable", "Accounts Receivable Summary",
	"Financial Ratios", "Consolidated Financial Statement", "Budget Variance Report", "TDS Computation Summary",
	"Tax Withholding Details", "Summary of ITC Availed", "GST Purchase Register Beta", "GST Sales Register Beta",
	"Stock and Account Value Comparison", "Project Profitability", "Received Items To Be Billed",
	"Billed Items To Be Received", "Purchase Invoice Trends", "Sales Invoice Trends", "Employee Salary  Report",
}
PERM_FIELDS = ("read", "select", "print", "email", "report", "export", "write", "create",
               "submit", "cancel", "amend", "delete", "import", "share")


def execute():
	if not frappe.db.exists("Role", SOURCE):
		return
	frappe.flags.dacs_access_applying = True  # our own writes are not read back into the sheet
	try:
		ensure_role()
		add_sheet_columns()
		copy_docperms()
		copy_reports_and_pages()
		add_admin_settings_rows()
		add_workflow_rows()
	finally:
		frappe.flags.dacs_access_applying = False
	frappe.clear_cache()


# 1 ------------------------------------------------------------------ role + profile
def ensure_role():
	from erp_dacsinc_custom.access_sync import ROLE_FLAG, ensure_profiles

	if not frappe.db.exists("Role", ROLE):
		frappe.get_doc({"doctype": "Role", "role_name": ROLE, "desk_access": 1}).insert(ignore_permissions=True)
	if frappe.db.has_column("Role", ROLE_FLAG):
		frappe.db.set_value("Role", ROLE, ROLE_FLAG, 1, update_modified=False)
	ensure_profiles([ROLE])  # creates "Operations Manager (Order Flow)" only if missing


# 2 ------------------------------------------------------------------ access sheet column
def add_sheet_columns():
	from erp_dacsinc_custom.access_worksheet import load_sheet, store_sheet

	for name in ("doc_access", "tab_access"):
		sheet = load_sheet(name)
		if not sheet or ROLE in (sheet.get("roles") or []) or SOURCE not in (sheet.get("roles") or []):
			continue
		i = sheet["roles"].index(SOURCE)
		roles = sheet["roles"] + [ROLE]
		cells = {}
		for row, vals in (sheet.get("cells") or {}).items():
			v = vals[i] if i < len(vals) else ""
			if name == "doc_access" and row in ACCOUNT_DOCS:
				v = ""
			if name == "tab_access" and (row.startswith("Finance") or row.startswith("Pending DN/SI")):
				v = ""
			cells[row] = list(vals) + [""] * (len(sheet["roles"]) - len(vals)) + [v]
		store_sheet(name, roles, cells, note="Operations Manager column added (copy of Merchandiser User)")


# 3 ------------------------------------------------------------------ document permissions
def copy_docperms():
	from erp_dacsinc_custom.access_sync import _map_get, _map_set

	src = frappe.get_all("Custom DocPerm", filters={"role": SOURCE},
	                     fields=["parent", "permlevel", "if_owner", *PERM_FIELDS])
	have = {(r.parent, int(r.permlevel or 0), int(r.if_owner or 0))
	        for r in frappe.get_all("Custom DocPerm", filters={"role": ROLE}, fields=["parent", "permlevel", "if_owner"])}
	for r in src:
		flags = {f: int(r.get(f) or 0) for f in PERM_FIELDS}
		if r.parent in ACCOUNT_DOCS:
			flags = {f: 0 for f in PERM_FIELDS}
			flags["select"] = int(r.get("select") or 0)
		if not any(flags.values()):
			continue
		key = (r.parent, int(r.permlevel or 0), int(r.if_owner or 0))
		if key in have:
			continue
		frappe.get_doc({"doctype": "Custom DocPerm", "parent": r.parent, "parenttype": "DocType",
		                "parentfield": "permissions", "role": ROLE, "permlevel": key[1], "if_owner": key[2],
		                **flags}).insert(ignore_permissions=True)
		have.add(key)
		frappe.clear_cache(doctype=r.parent)

	# Linked-document grants made for Merchandiser User are the new role's too (so a later sheet
	# save tracks them for it instead of leaving them untracked).
	derived = _map_get("derived_applied")
	changed = False
	for dt, by_role in derived.items():
		if SOURCE in by_role and ROLE not in by_role and dt not in ACCOUNT_DOCS:
			by_role[ROLE] = list(by_role[SOURCE])
			changed = True
	if changed:
		_map_set("derived_applied", derived)


# 4 ------------------------------------------------------------------ reports and pages
def _account_report(name):
	return name in ACCOUNT_REPORTS or frappe.db.get_value("Report", name, "module") == "Accounts"


def _add_has_role(parenttype, parent):
	if frappe.db.exists("Has Role", {"parenttype": parenttype, "parent": parent, "role": ROLE}):
		return
	idx = (frappe.db.sql("select max(idx) from `tabHas Role` where parenttype=%s and parent=%s",
	                     (parenttype, parent))[0][0] or 0) + 1
	frappe.get_doc({"doctype": "Has Role", "parenttype": parenttype, "parent": parent, "parentfield": "roles",
	                "role": ROLE, "idx": idx}).db_insert()


def copy_reports_and_pages():
	for p in frappe.get_all("Has Role", filters={"role": SOURCE, "parenttype": "Custom Role"}, pluck="parent"):
		cr = frappe.db.get_value("Custom Role", p, ["report", "page"], as_dict=True) or {}
		if cr.get("report") and _account_report(cr.report):
			continue
		_add_has_role("Custom Role", p)
	for rep in frappe.get_all("Has Role", filters={"role": SOURCE, "parenttype": "Report"}, pluck="parent"):
		if not _account_report(rep):
			_add_has_role("Report", rep)


# 5 ------------------------------------------------------------------ Admin Settings role lists
def add_admin_settings_rows():
	meta = frappe.get_meta("Admin Settings")
	for df in meta.fields:
		if df.fieldtype not in ("Table", "Table MultiSelect") or not df.fieldname.startswith("of_"):
			continue
		if "_accounts_" in df.fieldname or "_billing_" in df.fieldname:
			continue  # Finance / Pending DN/SI: never, even where a site gave them to Merchandiser User
		if not frappe.get_meta(df.options).has_field("role"):
			continue
		rows = frappe.get_all(df.options, filters={"parent": "Admin Settings", "parenttype": "Admin Settings",
		                                           "parentfield": df.fieldname}, fields=["role", "idx"])
		roles = {r.role for r in rows}
		if SOURCE not in roles or ROLE in roles:
			continue
		frappe.get_doc({"doctype": df.options, "parent": "Admin Settings", "parenttype": "Admin Settings",
		                "parentfield": df.fieldname, "idx": max(r.idx for r in rows) + 1,
		                "role": ROLE}).db_insert()
	frappe.clear_document_cache("Admin Settings", "Admin Settings")


# 6 ------------------------------------------------------------------ Sales Order Workflow
def add_workflow_rows():
	if not frappe.db.exists("Workflow", "Sales Order Workflow"):
		return
	wf = frappe.get_doc("Workflow", "Sales Order Workflow")
	added = False
	state_rows = {(s.state, s.allow_edit) for s in wf.states}
	for s in list(wf.states):
		if s.allow_edit == SOURCE and (s.state, ROLE) not in state_rows:
			wf.append("states", {"state": s.state, "doc_status": s.doc_status, "allow_edit": ROLE,
			                     "update_field": s.update_field, "update_value": s.update_value})
			state_rows.add((s.state, ROLE))
			added = True
	trans = {(t.state, t.action, t.next_state, t.allowed) for t in wf.transitions}
	for t in list(wf.transitions):
		if t.allowed == SOURCE and (t.state, t.action, t.next_state, ROLE) not in trans:
			wf.append("transitions", {"state": t.state, "action": t.action, "next_state": t.next_state,
			                          "allowed": ROLE, "allow_self_approval": t.allow_self_approval,
			                          "condition": t.condition})
			trans.add((t.state, t.action, t.next_state, ROLE))
			added = True
	if added:
		wf.flags.ignore_permissions = True
		wf.save()
		frappe.clear_cache(doctype="Sales Order")
