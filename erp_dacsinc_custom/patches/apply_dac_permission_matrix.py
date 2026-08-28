"""
Applies erp_dacsinc_custom.dac_permission_matrix — the business's full spreadsheet
(docs/DAC_Permission_Matrix.xlsx) — on top of everything already granted by
apply_role_permission_matrix.py / apply_stage_role_matrix.py.

Additive only, same philosophy as those two patches: creates the 2 roles and 3 Role
Profiles that genuinely don't exist yet (Logistics, Online, POS Store Manager), and
only ADDS Custom DocPerm grants — never removes an existing role's access. Re-running
it (or running it on a site with slightly different existing grants) is safe either way.

Deliberately does NOT touch real users — see erp_dacsinc_custom.roles_and_permissions_api
.get_dac_matrix_assignment_preview() / apply_dac_matrix_assignments() and the "DAC
Matrix" action on the Roles & Permissions desk page for that (an explicit,
admin-confirmed, additive-only action per user, not something a migrate should ever do
silently).
"""

import frappe

from erp_dacsinc_custom.dac_permission_matrix import (
    DOCTYPE_ACCESS,
    NEW_ROLE_PROFILES,
    NEW_ROLES,
    REPORT_ACCESS,
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
                title="DAC permission matrix: doctype missing",
                message=f"{doctype} does not exist on this site — skipped.",
            )
            continue
        for roles, bits in role_rows:
            for role in roles:
                if not frappe.db.exists("Role", role):
                    frappe.log_error(
                        title="DAC permission matrix: role missing",
                        message=f"{role} does not exist — skipped for {doctype}.",
                    )
                    continue
                set_doc_permission(doctype, role, **bits)


def apply_report_access():
    for report_name, roles in REPORT_ACCESS.items():
        if not frappe.db.exists("Report", report_name):
            frappe.log_error(
                title="DAC permission matrix: report missing",
                message=f"{report_name} does not exist — skipped.",
            )
            continue
        report = frappe.get_doc("Report", report_name)
        existing_roles = {d.role for d in report.roles}
        changed = False
        for role in roles:
            if role in existing_roles or not frappe.db.exists("Role", role):
                continue
            report.append("roles", {"role": role})
            changed = True
        if changed:
            # A handful of this site's Reports carry a pre-existing, unrelated
            # broken Link (e.g. a `letter_head` pointing at a record that doesn't
            # exist on this site — leftover from data copied in from elsewhere).
            # That's not something this patch should fix or care about; it only
            # wants to append a role, so link validation is skipped for this save
            # the same way frappe.get_doc(...).save(ignore_links=True) is meant
            # to be used, rather than failing the whole patch over unrelated data.
            report.flags.ignore_links = True
            report.save(ignore_permissions=True)


def create_new_role_profiles():
    for profile_name, roles in NEW_ROLE_PROFILES.items():
        if frappe.db.exists("Role Profile", profile_name):
            continue
        valid_roles = [r for r in roles if frappe.db.exists("Role", r)]
        if not valid_roles:
            continue
        frappe.get_doc({
            "doctype": "Role Profile",
            "role_profile": profile_name,
            "roles": [{"role": r} for r in valid_roles],
        }).insert(ignore_permissions=True)


def execute():
    create_new_roles()
    apply_doctype_access()
    apply_report_access()
    create_new_role_profiles()
    frappe.clear_cache()
