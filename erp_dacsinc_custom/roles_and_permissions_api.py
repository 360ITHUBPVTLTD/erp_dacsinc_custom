"""
Server side for the "Roles & Permissions" desk page (erp_dacsinc_custom.page
.roles_and_permissions) — a live, editable view of every user's access,
built on top of erp_dacsinc_custom.role_permission_matrix (the single source
of truth for what each role/profile actually means).

Every whitelisted method here is admin-only: this page can create users and
reset passwords, so it stays restricted to System Manager / Admin / Super
Admin, same three roles order_flow_permissions.ADMIN_ROLES already treats as
"full access, no further configuration" for this app.
"""

import frappe
from frappe import _
from frappe.utils.password import update_password

from erp_dacsinc_custom.erp_dacsinc_custom.doctype.user_access_profile.user_access_profile import (
    sync_user_access_profile,
)
from erp_dacsinc_custom.role_permission_matrix import ROLE_PROFILES

ADMIN_ROLES = ("System Manager", "Admin", "Super Admin")

# Standard, safe-to-edit User profile fields — no roles, no password, no
# permission-relevant fields. Anyone who can open this page can edit these
# for anyone; the two things that stay tiered are handled separately below.
PROFILE_FIELDS = (
    "first_name", "last_name", "mobile_no", "phone", "gender",
    "birth_date", "location", "time_zone", "language",
)


def _guard():
    if frappe.session.user == "Administrator":
        return
    if not (set(frappe.get_roles()) & set(ADMIN_ROLES)):
        frappe.throw(
            _("You are not permitted to manage roles and permissions."),
            frappe.PermissionError,
        )


def _is_system_manager():
    return frappe.session.user == "Administrator" or "System Manager" in frappe.get_roles()


def _check_editable(user):
    """
    A disabled user is frozen: no profile edits, no role/profile changes,
    no password action. The only things still allowed on them are
    re-enabling (set_user_enabled) and delete — everything else must go
    through here first, server-side, so it can't be bypassed by calling
    the API directly instead of clicking a (disabled) button.
    """
    if frappe.db.get_value("User", user, "enabled") == 0:
        frappe.throw(
            _("{0} is disabled. Enable the user first to make changes.").format(user),
            frappe.ValidationError,
        )


def _profile_detail(role_profile_name):
    """Plain-language capability line for a Role Profile PLUS the actual
    roles it bundles, derived from the matrix's own data so it can never
    drift from the actual grants. The role list is what lets the page show
    "what are the 4 roles" instead of just the count."""
    if not role_profile_name:
        return {"summary": "", "roles": []}
    roles = sorted(frappe.get_all(
        "Has Role", filters={"parent": role_profile_name, "parenttype": "Role Profile"},
        pluck="role",
    ))
    if "Super Admin" in roles or "Admin" in roles:
        summary = _("Full business access")
    else:
        summary = _("{0} role(s)").format(len(roles))
    return {"summary": summary, "roles": roles}


@frappe.whitelist()
def get_users_overview():
    _guard()

    uap_by_user = {
        d.name: d for d in frappe.get_all(
            "User Access Profile", fields=["name", "user", "managed_roles"],
        )
    }
    uap_profiles = frappe.get_all(
        "User Access Profile Role Profile",
        fields=["parent", "role_profile"],
    )
    profiles_for_user = {}
    for row in uap_profiles:
        profiles_for_user.setdefault(row.parent, []).append(row.role_profile)

    users = frappe.get_all(
        "User",
        filters={"user_type": "System User"},
        fields=["name", "full_name", "enabled", "role_profile_name", "last_login",
                *PROFILE_FIELDS],
        order_by="full_name asc",
    )

    # "en" reads as a raw code in the UI — show the language's actual name.
    language_names = dict(frappe.get_all(
        "Language", fields=["name", "language_name"], as_list=True,
    ))

    profile_detail_cache = {}

    rows = []
    for u in users:
        extra_profiles = profiles_for_user.get(u.name, [])
        native_profile = u.role_profile_name
        all_profiles = ([native_profile] if native_profile else []) + extra_profiles

        profile_summaries = []
        for p in all_profiles:
            if p not in profile_detail_cache:
                profile_detail_cache[p] = _profile_detail(p)
            detail = profile_detail_cache[p]
            profile_summaries.append({
                "profile": p, "summary": detail["summary"], "roles": detail["roles"],
            })

        # Kept as the raw code in profile_fields (the edit dialog's Language
        # Link field needs that, not the display name) — language_display
        # is a read-only-view-only addition, never sent back on save.
        language_code = u.get("language")

        rows.append({
            "user": u.name,
            "full_name": u.full_name,
            "enabled": u.enabled,
            "last_login": u.last_login,
            "role_profiles": all_profiles,
            "profile_summaries": profile_summaries,
            "managed_by_multi_profile": u.name in uap_by_user,
            "profile_fields": {f: u.get(f) for f in PROFILE_FIELDS},
            "language_display": language_names.get(language_code, language_code),
        })

    return {
        "users": rows,
        "available_role_profiles": sorted(frappe.get_all(
            "Role Profile", pluck="name",
        )),
        # Drives the page's password UI: only a System Manager may set a
        # password directly (and Frappe never stores or shows the actual
        # password value to anyone, System Manager included — passwords are
        # one-way hashed). Everyone else on this page can only trigger the
        # standard reset-link email; they can make the user change their
        # password, they can never see or choose it.
        "is_system_manager": _is_system_manager(),
    }


@frappe.whitelist()
def create_user(email, first_name, last_name=None, role_profiles=None):
    _guard()
    if frappe.db.exists("User", email):
        frappe.throw(_("User {0} already exists.").format(email))

    user_doc = frappe.get_doc({
        "doctype": "User",
        "email": email,
        "first_name": first_name,
        "last_name": last_name,
        "enabled": 1,
        "send_welcome_email": 0,
        "user_type": "System User",
    })
    user_doc.insert(ignore_permissions=True)

    if role_profiles:
        update_user_role_profiles(email, role_profiles)

    return {"user": user_doc.name}


@frappe.whitelist()
def update_user_role_profiles(user, role_profiles=None):
    """
    Assign one or more Role Profiles to a user via the User Access Profile
    mechanism (never the native single role_profile_name field — see that
    doctype's controller for why).
    """
    _guard()
    _check_editable(user)
    role_profiles = role_profiles or []
    if isinstance(role_profiles, str):
        role_profiles = frappe.parse_json(role_profiles)

    unknown = [p for p in role_profiles if not frappe.db.exists("Role Profile", p)]
    if unknown:
        frappe.throw(_("Unknown Role Profile(s): {0}").format(", ".join(unknown)))

    if frappe.db.exists("User Access Profile", user):
        uap = frappe.get_doc("User Access Profile", user)
    else:
        uap = frappe.new_doc("User Access Profile")
        uap.user = user

    uap.set("role_profiles", [{"role_profile": p} for p in role_profiles])
    uap.flags.ignore_permissions = True
    uap.save(ignore_permissions=True)
    sync_user_access_profile(uap.name)

    return {"user": user, "role_profiles": role_profiles}


@frappe.whitelist()
def set_user_password(user, new_password):
    """
    Directly set a user's password. System Manager only — Frappe never
    stores or displays an existing password to anyone (it's one-way
    hashed), so this isn't "hidden from everyone else for no reason": it's
    the one action that lets someone CHOOSE what a password becomes, which
    is exactly the privilege being tiered. Admin/Super Admin use
    send_password_reset_email instead — they can make a user change their
    password, but never see or set it themselves.
    """
    _guard()
    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))
    _check_editable(user)
    if not _is_system_manager():
        frappe.throw(
            _("Only a System Manager can set a password directly. Use 'Send Reset Email' instead."),
            frappe.PermissionError,
        )
    update_password(user=user, pwd=new_password, logout_all_sessions=1)
    return {"user": user}


@frappe.whitelist()
def send_password_reset_email(user):
    """Available to any admin (System Manager, Admin, Super Admin) — emails
    the user a standard reset link. Never reveals or chooses a password."""
    _guard()
    user_doc = frappe.get_doc("User", user)
    if user_doc.name == "Administrator":
        frappe.throw(_("Administrator's password cannot be reset this way."))
    _check_editable(user)
    user_doc.validate_reset_password()
    user_doc.reset_password(send_email=True)
    return {"user": user}


@frappe.whitelist()
def update_user_profile(user, values=None):
    """Update standard, non-sensitive User profile fields — never roles,
    never the password, never anything role-permission-relevant."""
    _guard()
    _check_editable(user)
    values = values or {}
    if isinstance(values, str):
        values = frappe.parse_json(values)

    unknown = set(values) - set(PROFILE_FIELDS)
    if unknown:
        frappe.throw(_("These fields cannot be edited here: {0}").format(", ".join(unknown)))

    user_doc = frappe.get_doc("User", user)
    for fieldname, value in values.items():
        user_doc.set(fieldname, value)
    user_doc.flags.ignore_permissions = True
    user_doc.save(ignore_permissions=True)
    return {"user": user, "profile_fields": {f: user_doc.get(f) for f in PROFILE_FIELDS}}


@frappe.whitelist()
def toggle_user_role(user, role, enabled):
    _guard()
    _check_editable(user)
    enabled = frappe.utils.cint(enabled)
    if not frappe.db.exists("Role", role):
        frappe.throw(_("Role {0} does not exist.").format(role))

    user_doc = frappe.get_doc("User", user)
    if enabled:
        user_doc.add_roles(role)
    else:
        user_doc.remove_roles(role)
    return {"user": user, "role": role, "enabled": enabled}


@frappe.whitelist()
def set_user_enabled(user, enabled):
    _guard()
    if user == "Administrator":
        frappe.throw(_("Administrator cannot be disabled."))
    frappe.db.set_value("User", user, "enabled", frappe.utils.cint(enabled))
    frappe.clear_cache(user=user)
    return {"user": user, "enabled": frappe.utils.cint(enabled)}


@frappe.whitelist()
def delete_user(user):
    """
    Permanently delete a user. Frappe's own link-integrity check still
    applies underneath — if this user is referenced anywhere (owner of an
    existing document, a named approver list, etc.) the delete is refused
    with a clear error instead of silently orphaning those references.
    Disable (set_user_enabled) is the safer, reversible choice for someone
    who's simply left the business; delete is for a genuine mistake or a
    throwaway/test account.
    """
    _guard()
    if user in ("Administrator", "Guest"):
        frappe.throw(_("{0} cannot be deleted.").format(user))
    if user == frappe.session.user:
        frappe.throw(_("You cannot delete your own account."))
    if frappe.db.exists("User Access Profile", user):
        frappe.delete_doc("User Access Profile", user, ignore_permissions=True)
    frappe.delete_doc("User", user, ignore_permissions=True)
    return {"user": user, "deleted": True}


@frappe.whitelist()
def get_user_doctype_access(user):
    """
    Every doctype this user's roles grant SOME access to, and what they can
    do on it — the "collapsible doctype access" detail on the page. Reads
    both tabDocPerm (each doctype's own baseline permissions) and
    tabCustom DocPerm (this matrix's additions) directly, keyed off the
    user's actual role list, so it can never drift from what
    frappe.has_permission would really decide.
    """
    _guard()
    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))

    roles = frappe.get_roles(user)
    if not roles:
        return {"user": user, "doctypes": []}

    rows = frappe.db.sql(
        """
        select parent as doctype, `read`, `write`, `create`, submit, cancel, `delete`, if_owner
        from `tabDocPerm`
        where role in %(roles)s and permlevel = 0
        union all
        select parent as doctype, `read`, `write`, `create`, submit, cancel, `delete`, if_owner
        from `tabCustom DocPerm`
        where role in %(roles)s and permlevel = 0
        """,
        {"roles": roles},
        as_dict=True,
    )

    PTYPES = ("read", "write", "create", "submit", "cancel", "delete")
    by_doctype = {}
    for r in rows:
        entry = by_doctype.setdefault(r.doctype, {})
        for ptype in PTYPES:
            if not r.get(ptype):
                continue
            # "full" (no owner restriction) always wins over "owner"-only,
            # matching how Frappe itself resolves multiple roles' grants.
            if entry.get(ptype) != "full":
                entry[ptype] = "owner" if r.if_owner else "full"

    valid_doctypes = set(frappe.get_all(
        "DocType", filters={"istable": 0}, pluck="name",
    ))

    doctypes = []
    for doctype, perms in by_doctype.items():
        if doctype not in valid_doctypes:
            continue  # stale/renamed doctype referenced by an old perm row
        doctypes.append({
            "doctype": doctype,
            "permissions": perms,
            "owner_only": bool(perms) and all(v == "owner" for v in perms.values()),
        })
    doctypes.sort(key=lambda d: d["doctype"])

    return {"user": user, "doctypes": doctypes}


@frappe.whitelist()
def get_role_profile_reference():
    """The same role/profile reference shown on the static onboarding page,
    generated live from role_permission_matrix.py."""
    _guard()
    return {"role_profiles": ROLE_PROFILES}


def _current_role_profiles(user):
    """Every Role Profile currently applied to `user` — its native
    `role_profile_name` plus any profiles from a User Access Profile record,
    same union `get_users_overview()` already shows on this page."""
    native = frappe.db.get_value("User", user, "role_profile_name")
    extra = frappe.get_all(
        "User Access Profile Role Profile", filters={"parent": user}, pluck="role_profile",
    )
    return ([native] if native else []) + extra


@frappe.whitelist()
def get_dac_matrix_assignment_preview():
    """
    Current-vs-proposed Role Profile for every employee named in the DAC
    permission matrix Excel (erp_dacsinc_custom.dac_permission_matrix
    .EMPLOYEE_ROLE_PROFILE_TARGETS) — the preview data behind the "DAC Matrix"
    action on this page. Nothing here changes anything; see
    apply_dac_matrix_assignments() for the actual write.

    ADDITIVE, never a replacement: `will_change` is only true when the
    proposed profile isn't already one of the user's current profiles. A user
    already on 2 profiles who happens to also match the matrix keeps both —
    see apply_dac_matrix_assignments().
    """
    _guard()
    from erp_dacsinc_custom.dac_permission_matrix import EMPLOYEE_ROLE_PROFILE_TARGETS

    rows = []
    for target in EMPLOYEE_ROLE_PROFILE_TARGETS:
        user = target["user"]
        if not frappe.db.exists("User", user):
            rows.append({
                "user": user, "employee_name": target["employee_name"],
                "proposed_role_profile": target["role_profile"],
                "current_role_profiles": [], "will_change": False,
                "enabled": None, "status": "user_not_found",
            })
            continue

        current = _current_role_profiles(user)
        enabled = bool(frappe.db.get_value("User", user, "enabled"))
        rows.append({
            "user": user, "employee_name": target["employee_name"],
            "proposed_role_profile": target["role_profile"],
            "current_role_profiles": current,
            "will_change": target["role_profile"] not in current,
            "enabled": enabled,
            "status": "ok" if enabled else "disabled",
        })
    return {"rows": rows}


@frappe.whitelist()
def apply_dac_matrix_assignments(users):
    """
    ADD the DAC matrix's proposed Role Profile to each user in `users`, on
    top of whatever Role Profile(s) they already have — never a replacement.
    A user already on "Merchandiser" + some other profile they need for a
    second responsibility keeps both; this only ever appends the matrix's
    profile if it isn't already present.

    Goes through the existing update_user_role_profiles() -> User Access
    Profile -> sync_user_access_profile() path (never the raw
    role_profile_name field), so a role held for any other reason is never
    clobbered. Only ever acts on users actually named in
    EMPLOYEE_ROLE_PROFILE_TARGETS, and only after the caller has shown
    exactly what will change and gotten an explicit confirmation.
    """
    _guard()
    from erp_dacsinc_custom.dac_permission_matrix import EMPLOYEE_ROLE_PROFILE_TARGETS

    users = frappe.parse_json(users) if isinstance(users, str) else (users or [])
    targets_by_user = {t["user"]: t for t in EMPLOYEE_ROLE_PROFILE_TARGETS}

    results = []
    for user in users:
        target = targets_by_user.get(user)
        if not target:
            results.append({"user": user, "status": "not_in_matrix"})
            continue
        if not frappe.db.exists("User", user):
            results.append({"user": user, "status": "user_not_found"})
            continue

        current = _current_role_profiles(user)
        if target["role_profile"] in current:
            results.append({"user": user, "status": "already_set"})
            continue

        new_profiles = current + [target["role_profile"]]
        try:
            update_user_role_profiles(user, new_profiles)
        except frappe.ValidationError as e:
            results.append({"user": user, "status": "skipped", "reason": str(e)})
            continue
        results.append({
            "user": user, "status": "updated",
            "role_profile": target["role_profile"],
            "role_profiles": new_profiles,
        })
    return {"results": results}


@frappe.whitelist()
def sync_dac_matrix_and_users():
    """
    Sync all permissions, roles, and role profiles from the Python definition files
    (executing all three matrix patches), and reconcile/sync all users to match exactly
    their proposed Role Profile from the spreadsheet (overwriting/setting it).
    """
    _guard()

    # 1. Execute all three matrix patches in order
    from erp_dacsinc_custom.patches.apply_role_permission_matrix import execute as run_matrix1
    from erp_dacsinc_custom.patches.apply_stage_role_matrix import execute as run_matrix2
    from erp_dacsinc_custom.patches.apply_dac_permission_matrix import execute as run_matrix3

    try:
        run_matrix1()
        run_matrix2()
        run_matrix3()
    except Exception as e:
        frappe.log_error(title="Sync DAC matrix: patch execution failed", message=frappe.get_traceback())
        frappe.throw(_("Rebuilding permissions failed: {0}").format(str(e)))

    # 1.5 Sync tab configuration, page permissions, and workspace permissions
    from erp_dacsinc_custom.order_flow_permissions import sync_admin_settings_tab_roles, sync_order_flow_page_roles
    from erp_dacsinc_custom.dac_permission_matrix import sync_workspace_roles

    try:
        sync_admin_settings_tab_roles()
        sync_order_flow_page_roles()
        sync_workspace_roles()
    except Exception as e:
        frappe.log_error(title="Sync DAC matrix: workspace/tab sync failed", message=frappe.get_traceback())
        frappe.throw(_("Rebuilding page/workspace permissions failed: {0}").format(str(e)))


    # 2. Reconcile and overwrite user Role Profiles
    from erp_dacsinc_custom.dac_permission_matrix import EMPLOYEE_ROLE_PROFILE_TARGETS

    updated_users = []
    skipped_users = []

    for target in EMPLOYEE_ROLE_PROFILE_TARGETS:
        user = target["user"]
        proposed = target["role_profile"]

        if not frappe.db.exists("User", user):
            skipped_users.append({"user": user, "employee_name": target["employee_name"], "reason": _("User not found")})
            continue

        enabled = bool(frappe.db.get_value("User", user, "enabled"))
        if not enabled:
            skipped_users.append({"user": user, "employee_name": target["employee_name"], "reason": _("User disabled")})
            continue

        current = _current_role_profiles(user)
        # Check if the user's role profiles are exactly [proposed]
        if len(current) == 1 and current[0] == proposed:
            continue

        try:
            update_user_role_profiles(user, [proposed])
            updated_users.append({
                "user": user,
                "employee_name": target["employee_name"],
                "profile": proposed,
                "previous": current
            })
        except Exception as e:
            skipped_users.append({"user": user, "employee_name": target["employee_name"], "reason": str(e)})

    return {
        "updated": updated_users,
        "skipped": skipped_users
    }

