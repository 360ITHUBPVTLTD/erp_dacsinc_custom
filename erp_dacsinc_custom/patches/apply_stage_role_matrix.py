"""
Applies the order-lifecycle stage/role matrix from
erp_dacsinc_custom.role_permission_matrix (see that module for the actual
data, and erp_dacsinc_custom/www/process-flow.html for the human-readable
version of the same 19-stage matrix).

Creates the six "Team" roles the matrix introduces, grants them (and Admin /
Super Admin) permissions via Custom DocPerm, creates matching Role Profiles,
and merges the new roles into the existing Order Flow tab visibility config
on Admin Settings. Additive only — mirrors apply_role_permission_matrix.py's
approach, so re-running it (or running it on a site with slightly different
existing grants) is safe either way.
"""

import frappe

from erp_dacsinc_custom.role_permission_matrix import (
    ADMIN_ACCESS_DOCTYPES,
    ADMIN_FULL_ACCESS_ROLES,
    ADMIN_ONLY_PAGES,
    DOCTYPE_ACCESS,
    MANAGER_SUPPORT_DOCTYPE_ACCESS,
    NEW_ROLES,
    ORDER_FLOW_TAB_ROLES,
    POS_ADMIN_EXTRA_ACCESS,
    POS_OWNER_RESTRICTED_ACCESS,
    ROLE_PROFILES,
    SUPPORT_DOCTYPE_ACCESS,
    set_doc_permission,
)


def create_new_roles():
    for role_name in NEW_ROLES:
        if frappe.db.exists("Role", role_name):
            continue
        frappe.get_doc({
            "doctype": "Role",
            "role_name": role_name,
            "desk_access": 1,
        }).insert(ignore_permissions=True)


def apply_doctype_access():
    for doctype, is_submittable, role_rows in DOCTYPE_ACCESS:
        if not frappe.db.exists("DocType", doctype):
            frappe.log_error(
                title="Stage role matrix: doctype missing",
                message=f"{doctype} does not exist on this site — skipped.",
            )
            continue
        for roles, read, write, create, submit in role_rows:
            for role in roles:
                if not frappe.db.exists("Role", role):
                    frappe.log_error(
                        title="Stage role matrix: role missing",
                        message=f"{role} does not exist — skipped for {doctype}.",
                    )
                    continue
                set_doc_permission(doctype, role, read, write, create,
                                    submit if is_submittable else 0)

    for role, doctypes in SUPPORT_DOCTYPE_ACCESS.items():
        if not frappe.db.exists("Role", role):
            continue
        for doctype in doctypes:
            if not frappe.db.exists("DocType", doctype):
                continue
            set_doc_permission(doctype, role, read=1)


def apply_manager_support_access():
    for role, doctypes in MANAGER_SUPPORT_DOCTYPE_ACCESS.items():
        if not frappe.db.exists("Role", role):
            continue
        for doctype in doctypes:
            if not frappe.db.exists("DocType", doctype):
                continue
            set_doc_permission(doctype, role, read=1, write=1, create=1)


def apply_pos_access():
    for role, rows in POS_OWNER_RESTRICTED_ACCESS.items():
        if not frappe.db.exists("Role", role):
            continue
        for doctype, read, write, create, submit, cancel, delete in rows:
            if not frappe.db.exists("DocType", doctype):
                continue
            set_doc_permission(
                doctype, role, read=read, write=write, create=create,
                submit=submit, cancel=cancel, delete=delete, if_owner=1,
            )

    for role, rows in POS_ADMIN_EXTRA_ACCESS.items():
        if not frappe.db.exists("Role", role):
            continue
        for doctype, read, write, create, submit in rows:
            if not frappe.db.exists("DocType", doctype):
                continue
            set_doc_permission(doctype, role, read=read, write=write,
                                create=create, submit=submit)


def apply_admin_full_access():
    for role in ADMIN_FULL_ACCESS_ROLES:
        if not frappe.db.exists("Role", role):
            continue
        for doctype, is_submittable in ADMIN_ACCESS_DOCTYPES:
            if not frappe.db.exists("DocType", doctype):
                continue
            set_doc_permission(
                doctype, role,
                read=1, write=1, create=1,
                submit=1 if is_submittable else 0,
                delete=1,
                cancel=1 if is_submittable else 0,
                amend=1 if is_submittable else 0,
            )


def create_role_profiles():
    for profile_name, roles in ROLE_PROFILES.items():
        valid_roles = [r for r in roles if frappe.db.exists("Role", r)]
        if not valid_roles:
            continue
        if frappe.db.exists("Role Profile", profile_name):
            continue
        frappe.get_doc({
            "doctype": "Role Profile",
            "role_profile": profile_name,
            "roles": [{"role": r} for r in valid_roles],
        }).insert(ignore_permissions=True)


def lock_admin_only_pages():
    admin_roles = {"System Manager", *ADMIN_FULL_ACCESS_ROLES}
    admin_roles = {r for r in admin_roles if frappe.db.exists("Role", r)}
    for page in ADMIN_ONLY_PAGES:
        if not frappe.db.exists("Page", page):
            continue
        existing_name = frappe.db.get_value("Custom Role", {"page": page}, "name")
        if existing_name:
            custom_role = frappe.get_doc("Custom Role", existing_name)
            if {d.role for d in custom_role.roles} == admin_roles:
                continue
            custom_role.set("roles", [])
        else:
            custom_role = frappe.new_doc("Custom Role")
            custom_role.page = page
        for role in sorted(admin_roles):
            custom_role.append("roles", {"role": role})
        custom_role.flags.ignore_permissions = True
        custom_role.save(ignore_permissions=True)


def merge_order_flow_tab_roles():
    settings = frappe.get_single("Admin Settings")
    changed = False
    for tab, roles in ORDER_FLOW_TAB_ROLES.items():
        fieldname = f"of_tab_{tab}_roles"
        if not settings.meta.has_field(fieldname):
            continue
        existing = {d.role for d in (settings.get(fieldname) or [])}
        for role in roles:
            if role in existing or not frappe.db.exists("Role", role):
                continue
            settings.append(fieldname, {"role": role})
            changed = True
    if changed:
        settings.flags.ignore_permissions = True
        settings.save(ignore_permissions=True)


def execute():
    create_new_roles()
    apply_doctype_access()
    apply_manager_support_access()
    apply_pos_access()
    apply_admin_full_access()
    create_role_profiles()
    lock_admin_only_pages()
    merge_order_flow_tab_roles()
    frappe.clear_cache()
