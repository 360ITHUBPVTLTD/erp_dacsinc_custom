"""
Applies the doctype/role access matrix supplied by the business (spreadsheet:
Item, Customer, Supplier, BOM, Warehouse, Quotation, Sales Order, Sales
Invoice, Purchase Order, Purchase Receipt, Purchase Invoice, Material
Request, POS Invoice, Delivery Note, Stock Entry — plus read-only visibility
into stock reports). All 15 roles referenced already existed on this site
before this patch — nothing here creates a new Role.

Column meaning confirmed with the business: Read / Write / Create / Submit.
Frappe rejects Submit=1 on a non-submittable doctype outright (see
check_if_submittable in frappe/core/doctype/doctype/doctype.py), so the four
non-submittable doctypes in the sheet (Item, Customer, Supplier, Warehouse —
each marked "yes" in that column) have Submit silently left off; every other
doctype below is genuinely submittable and Submit is applied as given.

"stock report" in the sheet doesn't correspond to a doctype at all — it's
read-only visibility into the standard Stock Balance / Stock Ledger reports,
confirmed with the business. The Write/Create/Submit columns on that row
don't correspond to any action a Report can have, so only Read (-> the
report's own role list) is applied, for every role listed under it.

This only ADDS permissions — via Custom DocPerm (the standard, upgrade-safe
way for an app to extend a core doctype's permissions without touching its
JSON) and via each Report's own `roles` child table. It never removes an
existing role's access, so re-running it (or running it on a site with
slightly different existing grants) is safe either way.
"""

import frappe
from frappe.permissions import setup_custom_perms


# (doctype, is_submittable, [(roles, read, write, create, submit), ...])
DOCTYPE_ACCESS = [
    ("Item", False, [
        (["Production Assistant", "Production Manager"], 1, 1, 1, 0),
    ]),
    ("Customer", False, [
        (["Accounts Executive", "Finance Executive", "Accounts Manager", "Executive"], 1, 1, 1, 0),
    ]),
    ("Supplier", False, [
        (["Accounts Manager", "Accounts Executive", "Finance Executive", "Finance Collection Executive"], 1, 1, 1, 0),
    ]),
    ("BOM", True, [
        (["Production Assistant", "Production Manager"], 1, 1, 1, 1),
    ]),
    ("Warehouse", False, [
        (["Store Operation Manager", "Production Manager"], 1, 1, 1, 0),
    ]),
    ("Quotation", True, [
        (["Marketing Manager", "Marketing Executive", "Accounts Manager", "Accounts Executive"], 1, 1, 1, 0),
    ]),
    ("Sales Order", True, [
        (["Executive", "Production Assistant", "Production Manager", "Accounts Executive",
          "Junior Merchandiser", "Warehouse Incharge", "Finance Executive",
          "Operation Manager Corporate", "Marketing Manager", "Marketing Executive"], 1, 1, 0, 0),
        (["Finance Collection Executive"], 1, 0, 0, 0),
    ]),
    ("Sales Invoice", True, [
        (["Accounts Executive"], 1, 1, 1, 0),
    ]),
    ("Purchase Order", True, [
        (["Purchase Executive", "Executive", "Production Assistant", "Marketing Executive"], 1, 1, 1, 0),
        (["Production Manager"], 1, 1, 1, 1),
    ]),
    ("Purchase Receipt", True, [
        (["Executive"], 1, 1, 0, 0),
        (["Production Manager"], 1, 1, 1, 1),
        (["Production Assistant", "Purchase Executive", "Accounts Executive"], 1, 1, 1, 0),
    ]),
    ("Purchase Invoice", True, [
        (["Production Manager"], 1, 1, 1, 1),
        (["Purchase Executive", "Accounts Executive"], 1, 1, 1, 0),
    ]),
    ("Material Request", True, [
        (["Store Manager", "Production Assistant"], 1, 1, 1, 0),
        (["Production Manager"], 1, 1, 1, 1),
        (["Purchase Executive", "Junior Merchandiser", "Operation Manager Corporate", "Warehouse Incharge"], 1, 1, 1, 0),
    ]),
    ("POS Invoice", True, [
        (["Store Manager", "Store Operation Manager"], 1, 1, 1, 0),
    ]),
    ("Delivery Note", True, [
        (["Accounts Executive", "Executive"], 1, 1, 1, 0),
        (["Production Manager"], 1, 1, 1, 1),
    ]),
    ("Stock Entry", True, [
        (["Production Manager", "Executive", "Store Manager"], 1, 1, 1, 0),
    ]),
]

# Read-only visibility into stock reports — every role appearing anywhere in
# either sheet row for "stock report" gets Read on both.
STOCK_REPORT_ROLES = [
    "Store Manager", "Store Operation Manager", "Production Assistant", "Executive",
    "Purchase Executive", "Accounts Executive", "Operation Manager Corporate",
    "Warehouse Incharge", "Production Manager",
]
STOCK_REPORTS = ["Stock Balance", "Stock Ledger"]


def set_doc_permission(doctype, role, read=1, write=0, create=0, submit=0):
    setup_custom_perms(doctype)
    existing = frappe.db.get_value(
        "Custom DocPerm", {"parent": doctype, "role": role, "permlevel": 0, "if_owner": 0}
    )
    if existing:
        doc = frappe.get_doc("Custom DocPerm", existing)
        doc.read, doc.write, doc.create, doc.submit = read, write, create, submit
        doc.save(ignore_permissions=True)
    else:
        frappe.get_doc({
            "doctype": "Custom DocPerm",
            "parent": doctype, "parenttype": "DocType", "parentfield": "permissions",
            "role": role, "permlevel": 0,
            "read": read, "write": write, "create": create, "submit": submit,
        }).insert(ignore_permissions=True)


def execute():
    for doctype, is_submittable, role_rows in DOCTYPE_ACCESS:
        if not frappe.db.exists("DocType", doctype):
            frappe.log_error(
                title="Role permission matrix: doctype missing",
                message=f"{doctype} does not exist on this site — skipped.",
            )
            continue
        for roles, read, write, create, submit in role_rows:
            for role in roles:
                if not frappe.db.exists("Role", role):
                    frappe.log_error(
                        title="Role permission matrix: role missing",
                        message=f"{role} does not exist — skipped for {doctype}.",
                    )
                    continue
                set_doc_permission(
                    doctype, role, read, write, create,
                    submit if is_submittable else 0,
                )

    for report_name in STOCK_REPORTS:
        if not frappe.db.exists("Report", report_name):
            continue
        report = frappe.get_doc("Report", report_name)
        existing_roles = {d.role for d in report.roles}
        changed = False
        for role in STOCK_REPORT_ROLES:
            if role in existing_roles or not frappe.db.exists("Role", role):
                continue
            report.append("roles", {"role": role})
            changed = True
        if changed:
            report.save(ignore_permissions=True)

    frappe.clear_cache()
