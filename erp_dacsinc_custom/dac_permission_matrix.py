"""
Single source of truth for `docs/DAC_Permission_Matrix.xlsx` — the business's full
doctype/role permission spreadsheet (sheet "Matrix"), the Excel "Roles" crosswalk, and
the per-employee target Role Profile derived from the "Employees" sheet.

This site already has 30 Role Profiles and dozens of roles, many hand-created outside
any patch (see `apply_role_permission_matrix.py`, `role_permission_matrix.py`,
`create_order_flow_roles.py`). This module does NOT recreate any of that — every role
referenced below except `NEW_ROLES` already existed on this site (checked directly
against `tabRole` before writing this), and every Role Profile referenced in
`EMPLOYEE_ROLE_PROFILE_TARGETS` except the three in `NEW_ROLE_PROFILES` already existed
(checked directly against `tabRole Profile`).

Column -> Role mapping used throughout (cross-checked against live `Has Role` counts so
this reuses whichever existing role is actually in use, not a dormant same-ish-named one):

    Sales Executive                        -> DAC CRM
    Sales Manager                          -> DAC CRM Head
    Merchandiser                           -> Merchandiser User
    Packing Executive / Junior Merchandiser -> Junior Merchandiser
    Admin (Anuj)                           -> Admin
    Inward Executive                       -> Inward Team
    Asst Store Manager / POS Executive     -> POS User
    Operations Store Manager (POS Admin)   -> POS Admin
    Store Manager / POS Manager            -> POS Store Manager (see note below)
    Production Manager                     -> Production Manager
    Production Assistant                   -> Production Assistant
    Accounts | Executive                   -> Accounts Executive
    Accounts | Manager                     -> Accounts Manager
    Finance                                -> Finance Executive
    Online                                 -> Online (new)
    Purchase Manager                       -> Purchase Manager
    Purchase Assistant                     -> Purchase Executive
    Logistics                              -> Logistics (new)
    HR Manager                             -> HR Manager

"Store Manager | POS Manager" is deliberately NOT also applied to POS Admin: the sheet
gives that column and the "Operations Store Manager (POS Admin)" column nearly identical
values throughout, so POS Admin is already fully covered via that other column. This
column's grants go to `POS Store Manager` instead — a role that already existed on this
site but had almost no Custom DocPerm of its own, and needs its own tier separate from
POS Admin (see EMPLOYEE_ROLE_PROFILE_TARGETS: some "Store Manager" employees are assigned
to `POS Manager` (-> POS Admin), others to the new `POS Store Manager` profile, exactly
per the sheet's own per-employee ERP Role column).

Vocabulary: sheet text -> Custom DocPerm field (this site's Custom DocPerm has `select`
in addition to the usual fields, confirmed against its doctype JSON):

    View            -> read=1
    View Own        -> read=1, if_owner=1
    View Reporting Team / View All  -> read=1 (no if_owner — Frappe has no built-in
                                        manager-hierarchy scoping; treated as full
                                        company-wide read for this pass, same as
                                        every other role already on this site except
                                        POS User's owner-restricted rows)
    Select / Select All             -> select=1
    Select Own                      -> select=1, if_owner=1
    Create / Create Own / Create All -> create=1
    Draft / Edit / Update           -> write=1
    Submit / Cancel / Amend / Delete / Print / Export -> the matching field
    Approve / Reject / POD Updation -> write=1 (no dedicated DocPerm flag for either;
                                        Sales Order approval stays gated by the existing
                                        Sales Order Workflow, unchanged by this module)
    NA / na / blank                 -> no grant for that role on that row

`submit`/`cancel`/`amend` are silently dropped for a row whose real doctype is not
submittable (Frappe rejects submit=1 outright otherwise) — same rule
apply_role_permission_matrix.py already uses for Item/Customer/Supplier/Warehouse.

Explicitly NOT covered by this module (by design, not oversight):
- Merchandiser User's existing "own customers only" restriction
  (`get_sales_order_permission_query_conditions` / `has_sales_order_permission` /
  `get_customer_permission_query_conditions` / `has_customer_permission` in
  custom_script.py) — untouched. This module only fills OTHER gaps that role was
  missing (Supplier read, tax templates, etc.).
- "Point of Sale Page" (real route `point-of-sale`) and "Chart of Accounts" (Account's
  own tree view) — no distinct permission surface beyond what POS Invoice/POS Profile
  and Account already gate.
- "Bank Transation List" in the sheet -> the real `Bank Transaction` doctype, covered
  under that name in DOCTYPE_ACCESS.
"""

import frappe
from frappe.permissions import setup_custom_perms


NEW_ROLES = ["Logistics", "Online"]


def set_doc_permission(doctype, role, read=0, write=0, create=0, submit=0, delete=0,
                        cancel=0, amend=0, if_owner=0, select=0, print=0, export=0):
    """
    Idempotently set one role's Custom DocPerm row on a doctype.

    Deliberately a standalone copy of the same upsert pattern used by
    role_permission_matrix.set_doc_permission (not an import) — this module needs
    `select`/`print`/`export` on top of that function's fields, and duplicating ~15
    lines here avoids touching a file two other already-live patches depend on.

    `if_owner` is part of the lookup key, not just a value to set — see the identical
    note on role_permission_matrix.set_doc_permission for why (a role can legitimately
    have both an if_owner=0 row and a separate if_owner=1 row on the same doctype).

    MERGES with an existing row rather than overwriting it: a field is only ever
    turned on here, never off. This module's own DOCTYPE_ACCESS frequently grants a
    role LESS on a given doctype than a prior patch already did (e.g. this sheet's
    "Delivery Note" column for Production Manager is narrower than what
    role_permission_matrix.py already gave it) — a plain overwrite would silently
    downgrade that existing, already-live grant, which breaks the additive-only
    guarantee every patch in this app relies on. Verified against a dry run on
    dacsinc.local: with a plain overwrite this would have shrunk 106 existing rows.
    """
    setup_custom_perms(doctype)
    existing = frappe.db.get_value(
        "Custom DocPerm",
        {"parent": doctype, "role": role, "permlevel": 0, "if_owner": if_owner},
    )
    values = dict(read=read, write=write, create=create, submit=submit, delete=delete,
                  cancel=cancel, amend=amend, select=select, print=print, export=export)
    if existing:
        doc = frappe.get_doc("Custom DocPerm", existing)
        changed = False
        for field, val in values.items():
            if val and not doc.get(field):
                doc.set(field, val)
                changed = True
        if changed:
            doc.save(ignore_permissions=True)
    else:
        frappe.get_doc({
            "doctype": "Custom DocPerm",
            "parent": doctype, "parenttype": "DocType", "parentfield": "permissions",
            "role": role, "permlevel": 0, "if_owner": if_owner,
            **values,
        }).insert(ignore_permissions=True)


# (doctype, is_submittable, [(roles, dict(perm kwargs)), ...]) — mechanically transcribed
# from the "Matrix" sheet (see module docstring for the vocabulary and column mapping).
# submit/cancel/amend are already omitted below for every non-submittable doctype (verified
# against `is_submittable` at generation time), so applying this is just
# set_doc_permission(doctype, role, **bits) for every (roles, bits) row — see
# apply_dac_permission_matrix.py.
DOCTYPE_ACCESS = [
    ("Contact", False, [
        (["DAC CRM", "POS User", "POS Admin", "POS Store Manager"], dict(read=1, create=1, if_owner=1, select=1, export=1)),
        (["DAC CRM Head", "Admin"], dict(read=1, create=1, select=1, export=1)),
        (["Merchandiser User"], dict(read=1)),
    ]),
    ("Lead", False, [
        (["DAC CRM", "POS User", "POS Admin", "POS Store Manager"], dict(read=1, create=1, if_owner=1, select=1, export=1)),
        (["DAC CRM Head", "Admin"], dict(read=1, create=1, select=1, export=1)),
        (["Merchandiser User"], dict(read=1)),
    ]),
    ("Event Activity", False, [
        (["DAC CRM", "POS User"], dict(read=1, create=1, if_owner=1, select=1, export=1)),
        (["DAC CRM Head", "POS Admin", "POS Store Manager"], dict(read=1, create=1, select=1, export=1)),
        (["Admin"], dict(read=1, create=1, delete=1, select=1, export=1)),
    ]),
    ("Quotation", True, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "POS Admin", "POS Store Manager"], dict(read=1, write=1, submit=1, cancel=1, amend=1)),
        (["Admin"], dict(read=1, create=1, delete=1, cancel=1, amend=1, select=1, export=1)),
        (["POS User"], dict(read=1, write=1, submit=1)),
    ]),
    ("Sales Order", True, [
        (["DAC CRM", "DAC CRM Head", "Junior Merchandiser", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant"], dict(create=1)),
        (["Merchandiser User"], dict(write=1, create=1)),
        (["Admin"], dict(write=1, create=1, submit=1, delete=1, cancel=1, amend=1)),
    ]),
    ("Customer", False, [
        (["DAC CRM", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive"], dict(create=1)),
        (["DAC CRM Head", "Admin"], dict(create=1, delete=1)),
    ]),
    ("Item Group", False, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive"], dict(read=1, create=1)),
        (["Admin"], dict(read=1, create=1, delete=1)),
    ]),
    ("Item", False, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive"], dict(read=1, create=1)),
        (["Admin"], dict(read=1, create=1, delete=1)),
        (["Inward Team"], dict(read=1)),
    ]),
    ("BOM", True, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Finance Executive"], dict(read=1, select=1)),
        (["Admin"], dict(write=1, create=1, submit=1, delete=1, cancel=1, amend=1)),
        (["Production Manager"], dict(read=1, write=1, create=1, submit=1, cancel=1, amend=1, select=1)),
        (["Production Assistant"], dict(read=1, write=1, create=1, select=1)),
        (["Purchase Manager", "Purchase Executive"], dict(read=1, create=1, select=1)),
    ]),
    ("Material Request", True, [
        (["DAC CRM", "DAC CRM Head", "Inward Team", "Finance Executive"], dict(read=1)),
        (["Merchandiser User", "Production Manager"], dict(read=1, create=1, submit=1, cancel=1, amend=1, select=1)),
        (["Junior Merchandiser"], dict(read=1, create=1, select=1)),
        (["Admin"], dict(read=1, create=1, submit=1, delete=1, cancel=1, amend=1, select=1)),
        (["POS User", "POS Admin", "POS Store Manager", "Production Assistant", "Purchase Manager"], dict(read=1, create=1, submit=1)),
        (["Purchase Executive"], dict(read=1, create=1)),
    ]),
    ("Purchase Order", True, [
        (["DAC CRM", "DAC CRM Head", "Junior Merchandiser", "Inward Team"], dict(read=1)),
        (["Merchandiser User", "Production Assistant", "Purchase Executive"], dict(read=1, create=1)),
        (["Admin"], dict(read=1, create=1, submit=1, delete=1, cancel=1, amend=1)),
        (["Production Manager", "Purchase Manager"], dict(read=1, create=1, submit=1, cancel=1, amend=1)),
        (["Accounts Executive", "Finance Executive"], dict(read=1, select=1)),
    ]),
    ("Purchase Receipt", True, [
        (["DAC CRM", "DAC CRM Head"], dict(read=1)),
        (["Merchandiser User", "Junior Merchandiser", "Inward Team"], dict(read=1, create=1, submit=1)),
        (["Admin"], dict(read=1, create=1, submit=1, delete=1, cancel=1, amend=1)),
        (["Production Manager", "Purchase Manager"], dict(read=1, create=1, submit=1, cancel=1, amend=1)),
        (["Production Assistant", "Purchase Executive"], dict(read=1, create=1)),
        (["Accounts Executive", "Finance Executive"], dict(read=1, select=1)),
    ]),
    ("Subcontracting Order", True, [
        (["DAC CRM", "DAC CRM Head", "Junior Merchandiser", "Inward Team"], dict(read=1)),
        (["Merchandiser User", "Production Assistant", "Purchase Executive"], dict(read=1, create=1)),
        (["Admin"], dict(read=1, create=1, submit=1, delete=1, cancel=1, amend=1)),
        (["Production Manager", "Purchase Manager"], dict(read=1, create=1, submit=1, cancel=1, amend=1)),
        (["Finance Executive"], dict(read=1, select=1)),
    ]),
    ("Stock Entry", True, [
        (["DAC CRM", "Accounts Executive"], dict(read=1)),
        (["DAC CRM Head", "Merchandiser User", "Production Manager", "Purchase Manager"], dict(read=1, create=1, submit=1, cancel=1, amend=1)),
        (["Junior Merchandiser", "Production Assistant", "Purchase Executive"], dict(read=1, create=1)),
        (["Admin"], dict(read=1, create=1, submit=1, delete=1, cancel=1, amend=1)),
        (["Inward Team"], dict(read=1, create=1, submit=1, select=1)),
        (["Finance Executive"], dict(read=1, select=1)),
        (["POS User", "POS Admin", "POS Store Manager"], dict(read=1, create=1, submit=1)),
    ]),
    ("Uniform Embroidery Transfer", False, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Admin", "Inward Team", "Production Manager", "Production Assistant", "Purchase Manager", "Purchase Executive"], dict(read=1, create=1)),
    ]),
    ("Subcontracting Receipt", True, [
        (["DAC CRM", "DAC CRM Head", "Junior Merchandiser"], dict(read=1)),
        (["Merchandiser User", "Production Assistant", "Purchase Executive"], dict(read=1, create=1)),
        (["Admin"], dict(read=1, create=1, submit=1, delete=1, cancel=1, amend=1)),
        (["Inward Team"], dict(read=1, create=1, submit=1)),
        (["Production Manager", "Purchase Manager"], dict(read=1, create=1, submit=1, cancel=1, amend=1)),
        (["Accounts Executive", "Finance Executive"], dict(read=1, select=1)),
    ]),
    ("Purchase Invoice", True, [
        (["Admin"], dict(read=1, create=1, submit=1, delete=1, cancel=1, amend=1, select=1, print=1)),
        (["POS User", "POS Admin", "POS Store Manager", "Finance Executive"], dict(read=1)),
        (["Production Manager"], dict(read=1, create=1, submit=1, select=1, print=1)),
        (["Production Assistant", "Purchase Executive"], dict(read=1, create=1, select=1)),
        (["Accounts Executive", "Purchase Manager"], dict(read=1, create=1, submit=1, cancel=1, amend=1, select=1, print=1)),
    ]),
    ("Sales Invoice", True, [
        (["DAC CRM Head", "POS Admin", "Accounts Executive"], dict(read=1, create=1, submit=1, cancel=1, amend=1, select=1, print=1)),
        (["Admin"], dict(read=1, create=1, submit=1, delete=1, cancel=1, amend=1, select=1, print=1)),
        (["POS User"], dict(read=1, create=1, submit=1, if_owner=1, select=1, print=1)),
        (["POS Store Manager"], dict(read=1, create=1, submit=1, cancel=1, amend=1, if_owner=1, select=1, print=1)),
        (["Production Manager"], dict(read=1, export=1)),
        (["Finance Executive"], dict(read=1)),
        (["Logistics"], dict(read=1, write=1, select=1, export=1)),
    ]),
    ("Journal Entry", True, [
        (["Admin", "Accounts Executive"], dict(read=1, create=1, submit=1, delete=1, cancel=1, amend=1, select=1)),
        (["Finance Executive"], dict(read=1)),
    ]),
    ("Bank Reconciliation Tool", False, [
        (["Admin", "Accounts Executive", "Finance Executive"], dict(read=1, write=1, export=1)),
    ]),
    ("Bank Transaction", True, [
        (["Admin", "Accounts Executive", "Finance Executive"], dict(read=1, write=1, create=1, export=1)),
    ]),
    ("Payment Entry", True, [
        (["Admin", "Accounts Executive", "Finance Executive"], dict(read=1, create=1, submit=1, delete=1, cancel=1, amend=1, select=1, print=1)),
    ]),
    ("Bank Account", False, [
        (["Admin", "Accounts Executive", "Finance Executive"], dict(read=1, write=1, create=1, export=1)),
    ]),
    ("Account", False, [
        (["Admin", "Accounts Executive", "Finance Executive"], dict(read=1, write=1, create=1, export=1)),
    ]),
    ("POS Profile", False, [
        (["DAC CRM", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "Production Manager", "Accounts Executive"], dict(read=1)),
        (["DAC CRM Head", "POS Admin", "POS Store Manager"], dict(read=1, create=1)),
        (["Admin"], dict(read=1, create=1, delete=1)),
    ]),
    ("POS Opening Entry", True, [
        (["DAC CRM"], dict(read=1, create=1)),
        (["DAC CRM Head", "Admin", "POS User", "POS Admin", "Accounts Executive", "Finance Executive"], dict(read=1, create=1, submit=1, cancel=1, amend=1)),
        (["Merchandiser User"], dict(read=1)),
    ]),
    ("POS Closing Entry", True, [
        (["DAC CRM"], dict(read=1, create=1)),
        (["DAC CRM Head", "Admin", "POS User", "POS Admin", "Accounts Executive", "Finance Executive"], dict(read=1, create=1, submit=1, cancel=1, amend=1)),
        (["Merchandiser User"], dict(read=1)),
    ]),
    ("POS Invoice", True, [
        (["DAC CRM"], dict(read=1, create=1)),
        (["DAC CRM Head", "Admin", "POS User", "POS Admin", "Accounts Executive", "Finance Executive"], dict(read=1, create=1, submit=1, cancel=1, amend=1)),
        (["Merchandiser User"], dict(read=1)),
    ]),
    ("WhatsApp Instance", False, [
        (["Admin", "HR Manager"], dict(read=1, write=1, select=1)),
    ]),
    ("Expense Claim", True, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive", "Logistics"], dict(read=1, create=1, if_owner=1)),
        (["Admin", "HR Manager"], dict(read=1, write=1, create=1, submit=1)),
    ]),
    ("Task", False, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser"], dict(read=1, create=1, if_owner=1)),
        (["Admin", "HR Manager"], dict(read=1, create=1)),
        (["Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive", "Logistics"], dict(create=1)),
    ]),
    ("Holiday List", False, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive", "Logistics"], dict(read=1)),
        (["Admin", "HR Manager"], dict(read=1, create=1)),
    ]),
    ("Shift Type", False, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive", "Logistics"], dict(read=1, if_owner=1)),
        (["Admin", "HR Manager"], dict(read=1, create=1)),
    ]),
    ("Employee", False, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive", "Logistics"], dict(read=1, if_owner=1)),
        (["Admin", "HR Manager"], dict(read=1, create=1)),
    ]),
    ("Attendance", True, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive", "Logistics"], dict(read=1, if_owner=1)),
        (["Admin", "HR Manager"], dict(read=1, create=1)),
    ]),
    ("Employee Checkin", False, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive", "Logistics"], dict(read=1, if_owner=1)),
        (["Admin", "HR Manager"], dict(read=1, create=1)),
    ]),
    ("Leave Type", False, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive", "Logistics"], dict(read=1)),
        (["Admin", "HR Manager"], dict(read=1, create=1)),
    ]),
    ("Leave Policy", True, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive", "Logistics"], dict(read=1, if_owner=1)),
        (["Admin", "HR Manager"], dict(read=1, create=1)),
    ]),
    ("Leave Period", False, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive", "Logistics"], dict(read=1)),
        (["Admin", "HR Manager"], dict(read=1, create=1)),
    ]),
    ("Leave Application", True, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive", "Logistics"], dict(read=1, create=1, if_owner=1)),
        (["Admin", "HR Manager"], dict(read=1, write=1, create=1, submit=1)),
    ]),
    ("Supplier", False, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager"], dict(read=1)),
        (["Admin", "Production Manager"], dict(read=1, create=1, delete=1)),
        (["Production Assistant", "Accounts Executive", "Finance Executive", "Purchase Manager", "Purchase Executive"], dict(read=1, create=1)),
    ]),
    ("Warehouse", False, [
        (["DAC CRM", "Junior Merchandiser", "Inward Team", "POS Admin", "Accounts Executive", "Finance Executive"], dict(read=1, select=1)),
        (["DAC CRM Head", "Merchandiser User", "Production Manager", "Production Assistant", "Purchase Manager", "Purchase Executive"], dict(read=1, create=1, select=1)),
        (["Admin"], dict(read=1, create=1, delete=1, select=1)),
        (["POS User", "POS Store Manager"], dict(read=1, if_owner=1, select=1)),
    ]),
    ("Pick List", True, [
        (["DAC CRM", "Accounts Executive", "Finance Executive", "Logistics"], dict(read=1)),
        (["DAC CRM Head", "Inward Team", "POS Admin", "Production Assistant", "Purchase Executive"], dict(read=1, write=1, create=1)),
        (["Merchandiser User", "Junior Merchandiser"], dict(read=1, create=1, submit=1, cancel=1)),
        (["Admin"], dict(read=1, create=1, submit=1, delete=1, cancel=1, amend=1)),
        (["POS User", "POS Store Manager", "Production Manager", "Purchase Manager"], dict(read=1, write=1, create=1, submit=1)),
    ]),
    ("Delivery Note", True, [
        (["DAC CRM", "POS User", "POS Admin", "POS Store Manager"], dict(read=1)),
        (["DAC CRM Head", "Inward Team", "Production Assistant"], dict(read=1, write=1, create=1)),
        (["Merchandiser User", "Junior Merchandiser"], dict(read=1, create=1, submit=1, cancel=1)),
        (["Admin"], dict(read=1, create=1, submit=1, delete=1, cancel=1, amend=1)),
        (["Production Manager", "Accounts Executive", "Finance Executive"], dict(read=1, create=1)),
        (["Logistics"], dict(read=1, write=1)),
    ]),
    ("Admin Settings", False, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive", "Logistics", "HR Manager"], dict(read=1)),
        (["Admin"], dict(read=1, write=1)),
    ]),
    ("HR Settings", False, [
        (["DAC CRM", "DAC CRM Head", "Merchandiser User", "Junior Merchandiser", "Inward Team", "POS User", "POS Admin", "POS Store Manager", "Production Manager", "Production Assistant", "Accounts Executive", "Finance Executive", "Online", "Purchase Manager", "Purchase Executive", "Logistics"], dict(read=1)),
        (["Admin", "HR Manager"], dict(read=1, write=1)),
    ]),
]

REPORT_ACCESS = {
    "Lead Report": ["Admin", "DAC CRM", "DAC CRM Head", "Merchandiser User", "POS Admin", "POS Store Manager", "POS User"],
    "General Ledger": ["Accounts Executive", "Admin", "DAC CRM", "DAC CRM Head", "Finance Executive", "Merchandiser User", "POS Admin", "POS Store Manager", "POS User", "Production Assistant", "Production Manager", "Purchase Executive", "Purchase Manager"],
    "GSTR-1": ["Accounts Executive", "Admin", "Finance Executive"],
    "GSTR-3B Details": ["Accounts Executive", "Admin", "Finance Executive"],
    "Balance Sheet": ["Accounts Executive", "Finance Executive", "Junior Merchandiser"],
    "Profit and Loss Statement": ["Accounts Executive", "Finance Executive", "Junior Merchandiser"],
    "Monthly Attendance Report": ["Accounts Executive", "Admin", "DAC CRM", "DAC CRM Head", "Finance Executive", "HR Manager", "Inward Team", "Junior Merchandiser", "Logistics", "Merchandiser User", "Online", "POS Admin", "POS Store Manager", "POS User", "Production Assistant", "Production Manager", "Purchase Executive", "Purchase Manager"],
    "Employee Salary  Report": ["Accounts Executive", "Admin", "DAC CRM", "DAC CRM Head", "Finance Executive", "HR Manager", "Inward Team", "Junior Merchandiser", "Logistics", "Merchandiser User", "Online", "POS Admin", "POS Store Manager", "POS User", "Production Assistant", "Production Manager", "Purchase Executive", "Purchase Manager"],
    "Monthly Attendance Matrix": ["Accounts Executive", "Admin", "DAC CRM", "DAC CRM Head", "Finance Executive", "HR Manager", "Inward Team", "Junior Merchandiser", "Logistics", "Merchandiser User", "Online", "POS Admin", "POS Store Manager", "POS User", "Production Assistant", "Production Manager", "Purchase Executive", "Purchase Manager"],
    "Leave Ledger": ["Accounts Executive", "Admin", "DAC CRM", "DAC CRM Head", "Finance Executive", "HR Manager", "Inward Team", "Junior Merchandiser", "Logistics", "Merchandiser User", "Online", "POS Admin", "POS Store Manager", "POS User", "Production Assistant", "Production Manager", "Purchase Executive", "Purchase Manager"],
    "Stock Ledger": ["Accounts Executive", "Admin", "DAC CRM", "DAC CRM Head", "Finance Executive", "Inward Team", "Junior Merchandiser", "Merchandiser User", "POS Admin", "POS Store Manager", "POS User", "Production Assistant", "Production Manager", "Purchase Executive", "Purchase Manager"],
    "Stock Balance": ["Accounts Executive", "Admin", "DAC CRM", "DAC CRM Head", "Finance Executive", "Inward Team", "Junior Merchandiser", "Merchandiser User", "Online", "POS Admin", "POS Store Manager", "POS User", "Production Assistant", "Production Manager", "Purchase Executive", "Purchase Manager"],
    "Sales Register": ["Accounts Executive", "Accounts Manager", "Admin", "DAC CRM", "DAC CRM Head", "Finance Executive", "HR Manager", "Inward Team", "Logistics", "Merchandiser User", "Online", "POS Admin", "POS Store Manager", "POS User", "Production Assistant", "Production Manager", "Purchase Executive", "Purchase Manager"],
    "Purchase Register": ["Accounts Executive", "Accounts Manager", "Admin", "DAC CRM", "DAC CRM Head", "Finance Executive", "HR Manager", "Inward Team", "Logistics", "Merchandiser User", "Online", "POS Admin", "POS Store Manager", "POS User", "Production Assistant", "Production Manager", "Purchase Executive", "Purchase Manager"],
}


# The only 3 Role Profiles this feature creates — every other target profile in
# EMPLOYEE_ROLE_PROFILE_TARGETS below already exists on this site and is left alone.
# Bundle shape mirrors the existing "Team" profiles (e.g. "Inward Team": Employee +
# Employee Self Service + Item Manager + Stock User + the team's own role).
NEW_ROLE_PROFILES = {
    "Logistics": ["Employee", "Employee Self Service", "Item Manager", "Stock User", "Logistics"],
    "Online": ["Employee", "Employee Self Service", "Sales User", "Online"],
    "POS Store Manager": ["Employee", "Employee Self Service", "Sales User", "POS Store Manager"],
}

# Every employee in the Excel "Employees" sheet who has a DAC Role filled in (the rest
# are left alone — the sheet has no opinion on them). One entry per person, matched to a
# live User by email (the sheet's "User ID" column). `sheet_role` is the sheet's own
# (DAC Role, ERP Role) pair, kept only for traceability back to the source row.
#
# Nothing here is applied automatically — see roles_and_permissions_api.get_dac_matrix_
# assignment_preview() / apply_dac_matrix_assignments() and the "DAC Matrix" action on
# the Roles & Permissions desk page, which requires an explicit admin confirmation per
# user before anything changes, and only ever ADDS a Role Profile — it never replaces
# whatever Role Profile(s) a user already has.
EMPLOYEE_ROLE_PROFILE_TARGETS = [
    {"user": "ravishankar.munikoti@gmail.com", "employee_name": "Ravi Shankar M",
     "sheet_role": ("Accounts", "Accounts Manager"), "role_profile": "Accounts"},
    {"user": "nikith2601@gmail.com", "employee_name": "Nikith V",
     "sheet_role": ("Accounts Assistant", "Accounts Executive"), "role_profile": "Accounts Executive"},

    {"user": "thapajanakkumar@gmail.com", "employee_name": "Janak Kumar Thapa",
     "sheet_role": ("Asst Store Manager", "POS User"), "role_profile": "POS User"},
    {"user": "snehaammu393@gmail.com", "employee_name": "Mamatha P V",
     "sheet_role": ("Asst Store Manager", "POS User"), "role_profile": "POS User"},
    {"user": "ramyaramya65232@gmail.com", "employee_name": "Ramya M",
     "sheet_role": ("Asst Store Manager", "POS User"), "role_profile": "POS User"},
    {"user": "mithunreddy9164@gmail.com", "employee_name": "Mithun Reddy",
     "sheet_role": ("Asst Store Manager", "POS User"), "role_profile": "POS User"},

    {"user": "dikshitagadiya@icloud.com", "employee_name": "Dikshitha M",
     "sheet_role": ("Finance", "Accounts Executive"), "role_profile": "Accounts Executive"},
    {"user": "gowdamnharshith@gmail.com", "employee_name": "Harshith Gowda M N",
     "sheet_role": ("Finance", "Accounts Executive"), "role_profile": "Accounts Executive"},
    {"user": "harinimshetty01@gmail.com", "employee_name": "Harini M",
     "sheet_role": ("Finance", "Accounts Executive"), "role_profile": "Accounts Executive"},
    {"user": "gkumar065@gmail.com", "employee_name": "Goutham Kumar A Jain",
     "sheet_role": ("Finance", "Accounts Executive"), "role_profile": "Accounts Executive"},

    {"user": "madhushreenan0106@gmail.com", "employee_name": "Madhushree G",
     "sheet_role": ("Inward", ""), "role_profile": "Inward Team"},
    {"user": "rajni@gmail.com", "employee_name": "Rajni R",
     "sheet_role": ("Inward", ""), "role_profile": "Inward Team"},

    {"user": "kavya98kavya@gmail.com", "employee_name": "Kavya L",
     "sheet_role": ("Logistics", ""), "role_profile": "Logistics"},

    {"user": "menezesepm@hotmail.com", "employee_name": "Edwin Paul menezes",
     "sheet_role": ("Merchandiser", "Merchandiser"), "role_profile": "Merchandiser"},
    {"user": "monishabg451@gmail.com", "employee_name": "Monisha B G",
     "sheet_role": ("Merchandiser", "Merchandiser"), "role_profile": "Merchandiser"},
    {"user": "preethidjain57@gmail.com", "employee_name": "Preethi D",
     "sheet_role": ("Merchandiser", "Merchandiser"), "role_profile": "Merchandiser"},
    {"user": "shruthi4naveen@gmail.com", "employee_name": "Shruthi C.H",
     "sheet_role": ("Merchandiser", "Merchandiser"), "role_profile": "Merchandiser"},

    {"user": "hemanthsinghr7@gmail.com", "employee_name": "Hemanth Singh",
     "sheet_role": ("Online", ""), "role_profile": "Online"},

    {"user": "suryabgn16@gmail.com", "employee_name": "Ravi B G",
     "sheet_role": ("Operations Store Manager", "POS Manager"), "role_profile": "POS Manager"},

    {"user": "snjp4841@gmail.com", "employee_name": "Jeya Prakash",
     "sheet_role": ("Production", "Production Assistant"), "role_profile": "Production Assistant"},
    {"user": "deekshithakjain19@gmail.com", "employee_name": "Deekshitha K Jain",
     "sheet_role": ("Production", "Production Manager"), "role_profile": "Production Manager"},
    {"user": "divyajain5419@gmail.com", "employee_name": "Divya Jain",
     "sheet_role": ("Production", "Production Manager"), "role_profile": "Production Manager"},

    {"user": "ranchianupam@gmail.com", "employee_name": "Anupam Kumar",
     "sheet_role": ("Purchase", "Purchase Assistant"), "role_profile": "Purchase executive"},
    {"user": "palchajjer@gmail.com", "employee_name": "Pal R",
     "sheet_role": ("Purchase Assistant", "Purchase Assistant"), "role_profile": "Purchase executive"},

    {"user": "rajkps04@ggmail.com", "employee_name": "Rajesh D Kapasi",
     "sheet_role": ("Store Manager", "POS Manager"), "role_profile": "POS Manager"},
    {"user": "seenusrini15@gmail.com", "employee_name": "Srinivas M",
     "sheet_role": ("Store Manager", "POS Manager"), "role_profile": "POS Manager"},
    {"user": "abhivivoy81@gmail.com", "employee_name": "Abhishek P",
     "sheet_role": ("Store Manager", "POS Store Manager"), "role_profile": "POS Store Manager"},
    {"user": "sunilb6675@yahoo.co.in", "employee_name": "B Sunil",
     "sheet_role": ("Store Manager", "POS Store Manager"), "role_profile": "POS Store Manager"},
]
