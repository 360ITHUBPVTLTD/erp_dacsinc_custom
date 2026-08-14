"""
Create the roles used by the Order Flow tab-visibility configuration
(Admin Settings > Order Flow):

    Executive, Store Manager   - referenced by the tab -> role mapping
    Super Admin                - always sees every Order Flow tab, same as
                                  System Manager / Administrator, WITHOUT
                                  granting the rest of what System Manager
                                  implies (doctype customization, user
                                  management, etc.) See is_admin() in
                                  order_flow_permissions.py.

None of the three exist on this site today — verified against the live role
table before writing this patch. All are desk roles (not module-restricted),
so any user can be assigned one via User > Roles without further setup.
"""

import frappe


def execute():
    for role_name in ("Executive", "Store Manager", "Super Admin"):
        if frappe.db.exists("Role", role_name):
            continue
        frappe.get_doc({
            "doctype": "Role",
            "role_name": role_name,
            "desk_access": 1,
        }).insert(ignore_permissions=True)
