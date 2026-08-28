"""
Single source of truth for the order-lifecycle role/permission matrix
(see erp_dacsinc_custom/www/process-flow.html for the human-readable version
of the same 19-stage matrix this file enforces).

Edit THIS file when the business process changes — who does what, which
doctype a team needs write access to, which Order Flow tab a role should see.
The patch that applies it (patches/apply_stage_role_matrix.py) is a thin,
idempotent runner that re-reads this data on every `bench migrate`; it never
needs to change just because a role/doctype/tab mapping changes here.

Additive only, same philosophy as the existing
patches/apply_role_permission_matrix.py: nothing here ever removes an
existing role, permission, or Order Flow tab role that isn't listed below.
"""

import frappe
from frappe.permissions import setup_custom_perms


# ---------------------------------------------------------------------------
# Roles that don't exist yet and are introduced by this matrix. Everything
# else referenced below (Merchandiser User, Purchase Manager, Junior
# Merchandiser, Admin, Super Admin, Accounts Executive, ...) already exists
# on this site and is reused as-is.
# ---------------------------------------------------------------------------
NEW_ROLES = [
    "Marketing Team",
    "Inside Sales",
    "Production Team",
    "Purchase Team",
    "Inward Team",
    "Accounts Team",
]

# Roles that should have full business-doctype access (read/write/create/
# submit/cancel/amend/delete). Deliberately NOT System Manager: full access
# to the business doctypes below, not to system administration (Users,
# Roles, System Settings, DocType) — same "Super Admin != System Manager"
# design already documented in order_flow_permissions.py.
ADMIN_FULL_ACCESS_ROLES = ["Admin", "Super Admin"]


# (doctype, is_submittable, [(roles, read, write, create, submit), ...])
#
# Frappe rejects submit=1 on a non-submittable doctype outright, so
# is_submittable must be accurate for every row (checked directly against
# each doctype's JSON before writing this).
DOCTYPE_ACCESS = [
    ("Lead", False, [
        (["Marketing Team"], 1, 1, 1, 0),
    ]),
    ("Event Activity", False, [
        # The business's actual follow-up/activity mechanism on a Lead
        # ("a follow-up is scheduled and shared with whoever it's assigned
        # to" in process-flow.html) — NOT stock Event, which is already
        # open to every desk user via the built-in Desk User role and
        # needs no grant here. Currently System Manager only.
        (["Marketing Team", "Inside Sales"], 1, 1, 1, 0),
    ]),
    ("Task", False, [
        # The Lead form's "Create Task" button. Stock-restricted to
        # Projects User only; Marketing Team has no access today.
        (["Marketing Team"], 1, 1, 1, 0),
    ]),
    ("Quotation", True, [
        (["Marketing Team", "Inside Sales"], 1, 1, 1, 1),
    ]),
    ("Sales Order", True, [
        # Submission goes through the existing Sales Order Workflow, not the
        # raw submit flag — same pattern already used for every operational
        # role in apply_role_permission_matrix.py (e.g. Junior Merchandiser).
        (["Merchandiser User"], 1, 1, 1, 0),
    ]),
    ("Material Request", True, [
        (["Merchandiser User", "Production Team"], 1, 1, 1, 0),
    ]),
    ("Purchase Order", True, [
        # Approval stays with Purchase Manager (already has full access).
        (["Purchase Team"], 1, 1, 1, 0),
    ]),
    ("Purchase Receipt", True, [
        (["Inward Team"], 1, 1, 1, 1),
    ]),
    ("Purchase Invoice", True, [
        (["Accounts Team"], 1, 1, 1, 1),
    ]),
    ("Subcontracting Order", True, [
        (["Production Team"], 1, 1, 1, 1),
    ]),
    ("Subcontracting Receipt", True, [
        (["Inward Team"], 1, 1, 1, 1),
    ]),
    ("Stock Entry", True, [
        # Doctype-wide, same as the existing matrix does for other roles —
        # Stock Entry has no permission concept for its `purpose` field.
        # Covers Subcontracting Issue (Send to Subcontractor), Stock
        # Transfer (Material Transfer), and embroidery-related transfers.
        (["Production Team", "Inward Team"], 1, 1, 1, 1),
    ]),
    ("Uniform Embroidery Transfer", False, [
        # Embroidery Issue AND Embroidery Receipt both live on this one
        # doctype: "receipts" is a child table (Uniform Embroidery Transfer
        # Receipt, istable=1) inside it, not a separate document — child
        # tables have no permissions of their own in Frappe, so Inward Team
        # needs read/write access to THIS parent doctype to log a receipt,
        # not a grant on the child table (which Frappe silently ignores).
        # Currently System Manager + Merchandiser User only — Production
        # Team creates the issue, Inward Team logs the receipt against it.
        (["Production Team"], 1, 1, 1, 0),
        (["Inward Team"], 1, 1, 0, 0),
    ]),
    ("Embroidery Work Order", True, [
        # Currently System Manager only.
        (["Production Team"], 1, 1, 1, 1),
        (["Inward Team"], 1, 0, 0, 0),
    ]),
    ("Pick List", True, [
        # Neither role has any Pick List grant today.
        (["Merchandiser User", "Junior Merchandiser"], 1, 1, 1, 1),
    ]),
    ("Delivery Note", True, [
        (["Accounts Team", "Inward Team"], 1, 1, 1, 1),
    ]),
    ("Sales Invoice", True, [
        (["Accounts Team"], 1, 1, 1, 1),
    ]),
]

# Small "supporting" doctypes a role needs read access to in order to
# actually use the doctypes above (e.g. picking a Customer while creating a
# Sales Order, or a Payment Terms Template while creating a Purchase Order).
# Read-only, additive — never touches write/create.
#
# Deliberately excludes doctypes already open by default to any desk user —
# Address, Contact (both have an "All" read row) and Company (has an
# "Employee" read row, and every Role Profile this matrix creates includes
# Employee) — adding a grant there would be redundant. Everything listed
# below was checked against its own doctype JSON and has NO such open row,
# so without an explicit grant a role would hit a permission error the
# moment it tried to search/select one of these in a Link field.
SUPPORT_DOCTYPE_ACCESS = {
    "Marketing Team": [
        "Customer", "Item", "Price List", "Item Group", "Territory",
        "Customer Group", "Terms and Conditions",
        "Sales Taxes and Charges Template", "Payment Terms Template", "Currency",
        # Lead-specific: Market Segment is a genuine Lead Link field missed
        # first time round; the other three back the Lead form's "Lost"
        # flow and location dropdowns (Location Master is a Single).
        "Market Segment", "Lost Enquiry Reasons", "Quotation Lost Reason",
        "Location Master",
    ],
    "Inside Sales": [
        "Customer", "Item", "Price List", "Item Group", "Territory",
        "Customer Group", "Terms and Conditions",
        "Sales Taxes and Charges Template", "Payment Terms Template", "Currency",
        "Market Segment", "Lost Enquiry Reasons", "Quotation Lost Reason",
        "Location Master",
    ],
    "Merchandiser User": [
        "Customer", "Item", "Item Group", "Territory", "Customer Group", "UOM",
        "Terms and Conditions", "Sales Taxes and Charges Template",
        "Payment Terms Template", "Currency", "Cost Center",
    ],
    "Production Team": [
        "Item", "Warehouse", "BOM", "Customer", "Supplier",
        "UOM", "Item Group", "Brand", "Cost Center",
    ],
    "Purchase Team": [
        "Item", "Supplier", "Warehouse", "Price List",
        "UOM", "Item Group", "Brand", "Terms and Conditions",
        "Purchase Taxes and Charges Template", "Payment Terms Template",
        "Currency", "Cost Center", "Tax Category",
    ],
    "Inward Team": [
        "Item", "Warehouse", "Supplier", "UOM", "Item Group", "Brand",
    ],
    "Accounts Team": [
        "Customer", "Supplier", "Item", "Cost Center",
        "UOM", "Item Group", "Brand", "Currency", "Terms and Conditions",
        "Sales Taxes and Charges Template", "Purchase Taxes and Charges Template",
        "Payment Terms Template", "Tax Category",
    ],
}

# Manager tier: on the SAME small supporting doctypes each Team role only
# gets read on above, the paired Manager role gets create too (plus read) —
# e.g. a Purchase Manager can add a new Item Group when one's genuinely
# needed, a Purchase Team member can only pick from what already exists.
# Every Manager role here already exists (from apply_role_permission_matrix.py);
# this only adds to their existing grants, never replaces them.
MANAGER_SUPPORT_DOCTYPE_ACCESS = {
    "Marketing Manager": SUPPORT_DOCTYPE_ACCESS["Marketing Team"],
    "Purchase Manager": SUPPORT_DOCTYPE_ACCESS["Purchase Team"],
    "Production Manager": SUPPORT_DOCTYPE_ACCESS["Production Team"],
    "Accounts Manager": SUPPORT_DOCTYPE_ACCESS["Accounts Team"],
    # Inward Team has no direct "Inward Manager" — Store Manager is the
    # existing role that already covers warehouse/inward oversight.
    "Store Manager": SUPPORT_DOCTYPE_ACCESS["Inward Team"],
}

# POS User already has real "only my own records" restrictions live on this
# site (if_owner=1 Custom DocPerm rows, configured by hand before this
# matrix existed) — this table just captures that exact existing state so a
# fresh site build reproduces it. Applying it must be a verified no-op
# against the current DB (see apply_stage_role_matrix.py), never a fresh
# grant, so the live restriction is never accidentally loosened.
# (doctype, read, write, create, submit, cancel, delete)
POS_OWNER_RESTRICTED_ACCESS = {
    "POS User": [
        ("POS Invoice", 1, 1, 1, 1, 1, 0),
        ("POS Opening Entry", 1, 1, 1, 1, 1, 0),
        ("POS Closing Entry", 1, 1, 1, 1, 1, 0),
        ("POS Profile", 1, 0, 0, 0, 0, 0),
        ("POS Settings", 1, 0, 0, 0, 0, 0),
        ("Customer", 1, 1, 1, 0, 0, 0),
        ("Delivery Note", 1, 1, 1, 0, 0, 0),
        ("Material Request", 1, 1, 1, 0, 0, 0),
        ("Sales Order", 1, 0, 0, 0, 0, 0),
    ],
}

# "POS Manager" isn't a new role — POS Admin already has full, company-wide,
# non-owner-restricted access to POS Invoice/POS Profile/Sales Invoice/etc.
# It's just missing Stock Entry, which the business explicitly wants a POS
# Manager to have alongside everything else.
POS_ADMIN_EXTRA_ACCESS = {
    "POS Admin": [
        ("Stock Entry", 1, 1, 1, 1),
    ],
}

# Every doctype an Admin/Super Admin needs full access to: everything in
# DOCTYPE_ACCESS above, the 15 doctypes from the existing
# apply_role_permission_matrix.py, and the core masters referenced as
# supporting doctypes. (doctype, is_submittable).
ADMIN_ACCESS_DOCTYPES = [
    ("Lead", False),
    ("Quotation", True),
    ("Customer", False),
    ("Supplier", False),
    ("Item", False),
    ("BOM", True),
    ("Warehouse", False),
    ("Price List", False),
    ("Cost Center", False),
    ("Item Group", False),
    ("Customer Group", False),
    ("Territory", False),
    ("Brand", False),
    ("UOM", False),
    ("Currency", False),
    ("Tax Category", False),
    ("Terms and Conditions", False),
    ("Payment Terms Template", False),
    ("Sales Taxes and Charges Template", False),
    ("Purchase Taxes and Charges Template", False),
    ("Sales Order", True),
    ("Material Request", True),
    ("Purchase Order", True),
    ("Purchase Receipt", True),
    ("Purchase Invoice", True),
    ("Subcontracting Order", True),
    ("Subcontracting Receipt", True),
    ("Stock Entry", True),
    ("Pick List", True),
    ("Delivery Note", True),
    ("Sales Invoice", True),
    ("POS Invoice", True),
    # NOTE: "Uniform Embroidery Transfer Receipt" is deliberately absent —
    # it's a child table (istable=1) of "Uniform Embroidery Transfer" above,
    # and Frappe ignores permissions set directly on a child-table doctype.
    ("Uniform Embroidery Transfer", False),
    ("Embroidery Work Order", True),
]

# Role Profiles for one-click assignment when a new user is created. Names
# match the language actually used in the process flow / spreadsheet, even
# where the underlying Role already exists under a different, older name.
ROLE_PROFILES = {
    "Marketing Team": ["Employee", "Employee Self Service", "Marketing Team"],
    "Inside Sales": ["Employee", "Employee Self Service", "Inside Sales"],
    "Merchandiser": ["Employee", "Employee Self Service", "Merchandiser User"],
    "Production Team": ["Employee", "Employee Self Service", "Item Manager", "Stock User", "Production Team"],
    "Purchase Team": ["Employee", "Employee Self Service", "Item Manager", "Purchase Team"],
    "Inward Team": ["Employee", "Employee Self Service", "Item Manager", "Stock User", "Inward Team"],
    "Accounts Team": ["Employee", "Employee Self Service", "Accounts Team"],
    # "Packing Executive" is how the business refers to the Junior
    # Merchandiser role (see process-flow.html) — same role bundle as the
    # existing "Junior Merchandiser" Role Profile, under the name actually
    # used when assigning a new hire.
    "Packing Executive": [
        "Employee", "Employee Self Service", "Item Manager",
        "Purchase User", "Sales User", "Stock User", "Junior Merchandiser",
    ],
    # Minimal profile for someone who needs full business access without
    # the other 31 roles bundled into the existing "Admin" Role Profile.
    "Super Admin": ["Employee", "Employee Self Service", "Super Admin"],
    # No new role — POS Admin already has full, company-wide, non-owner-
    # restricted POS access; this just gives it a business-friendly name
    # to assign, separate from the existing single-role "POS User" profile.
    "POS Manager": ["Employee", "Employee Self Service", "POS Admin"],
}

# Desk Pages that must stay admin-only regardless of any other config —
# System Manager plus both full-access roles. Enforced via a Custom Role
# record (same override mechanism order_flow_permissions.py already uses
# for the Order Flow page), since editing the Page's own JSON `roles` is
# silently overwritten on every `bench migrate` re-import.
ADMIN_ONLY_PAGES = ["roles-and-permissions"]

# Roles to MERGE into (never replace) the existing Admin Settings > Order
# Flow tab role fields. "approval" isn't listed: Merchandiser User is
# already configured there. "stock" and "billing" aren't listed either —
# both are currently unconfigured (= visible to everyone by design) and
# narrowing that is a real behaviour change nobody has asked for.
ORDER_FLOW_TAB_ROLES = {
    "tracker": ["Marketing Team", "Inside Sales", "Purchase Team", "Inward Team", "Accounts Team", "Production Team"],
    "purchase": ["Purchase Team", "Inward Team"],
    "jobwork": ["Production Team"],
    "accounts": ["Accounts Team"],
    "uniform": ["Production Team", "Inward Team"],
}


def set_doc_permission(doctype, role, read=1, write=0, create=0, submit=0,
                        delete=0, cancel=0, amend=0, if_owner=0):
    """
    Idempotently set one role's Custom DocPerm row on a doctype.

    `if_owner` is part of the lookup key, not just a value to set — a role
    can legitimately have BOTH an if_owner=0 row and a separate if_owner=1
    row for the same doctype (e.g. core Frappe's own Note/Address do this:
    broad read, owner-only write). Keying only on {parent, role, permlevel}
    would find the wrong row and could silently turn an owner-restricted
    grant into an unrestricted one.
    """
    # Enforce standard Frappe permission dependencies (e.g., create/write requires read)
    if cancel or amend:
        submit = 1
    if submit:
        create = 1
    if create:
        write = 1
    if create or write or delete:
        read = 1

    setup_custom_perms(doctype)
    existing = frappe.db.get_value(
        "Custom DocPerm",
        {"parent": doctype, "role": role, "permlevel": 0, "if_owner": if_owner},
    )
    if existing:
        doc = frappe.get_doc("Custom DocPerm", existing)
        doc.read, doc.write, doc.create, doc.submit = read, write, create, submit
        doc.delete, doc.cancel, doc.amend = delete, cancel, amend
        doc.save(ignore_permissions=True)
    else:
        frappe.get_doc({
            "doctype": "Custom DocPerm",
            "parent": doctype, "parenttype": "DocType", "parentfield": "permissions",
            "role": role, "permlevel": 0, "if_owner": if_owner,
            "read": read, "write": write, "create": create, "submit": submit,
            "delete": delete, "cancel": cancel, "amend": amend,
        }).insert(ignore_permissions=True)

