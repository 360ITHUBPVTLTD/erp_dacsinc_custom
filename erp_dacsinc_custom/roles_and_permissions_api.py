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
        filters={
            "user_type": "System User",
            "name": ["not in", ["Administrator", "Guest"]],
        },
        fields=["name", "full_name", "enabled", "role_profile_name", "last_login",
                *PROFILE_FIELDS],
        order_by="full_name asc",
    )

    # "en" reads as a raw code in the UI — show the language's actual name.
    language_names = dict(frappe.get_all(
        "Language", fields=["name", "language_name"], as_list=True,
    ))

    profile_detail_cache = {}

    # Every role actually applied on each User right now — this is a
    # superset of what their Role Profile(s) grant whenever a role was
    # added directly (outside any profile), e.g. via toggle_user_role
    # below or another mechanism like Sales Order Final Approver. Fetched
    # once for every user rather than per-row so this page stays a single
    # extra query regardless of how many users it's showing.
    current_roles_by_user = {}
    for r in frappe.get_all(
        "Has Role",
        filters={"parenttype": "User", "parent": ["in", [u.name for u in users]]},
        fields=["parent", "role"],
    ):
        current_roles_by_user.setdefault(r.parent, set()).add(r.role)

    rows = []
    for u in users:
        extra_profiles = profiles_for_user.get(u.name, [])
        native_profile = u.role_profile_name
        all_profiles = ([native_profile] if native_profile else []) + extra_profiles

        profile_summaries = []
        profile_role_union = set()
        for p in all_profiles:
            if p not in profile_detail_cache:
                profile_detail_cache[p] = _profile_detail(p)
            detail = profile_detail_cache[p]
            profile_summaries.append({
                "profile": p, "summary": detail["summary"], "roles": detail["roles"],
            })
            profile_role_union.update(detail["roles"])

        # Roles this user actually has that no selected Role Profile
        # explains — assigned directly to the user, not through a profile.
        extra_roles = sorted(current_roles_by_user.get(u.name, set()) - profile_role_union)

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
            "extra_roles": extra_roles,
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


PTYPES = ("read", "write", "create", "submit", "cancel", "delete")

# How the preview ORDERS AND LABELS the doctypes an admin weighs when
# deciding whether a Role Profile is safe to hand out.
#
# This list is not what decides whether a doctype is shown — see
# _classify_doctypes(), which also surfaces anything submittable or from one
# of this company's own apps under "Other business documents". That matters:
# a curated list silently goes stale every time ERPNext or this app adds a
# doctype, and a permission screen that quietly hides a grant is worse than
# one that shows it in the wrong group. Adding a doctype here only promotes
# it out of "Other" into a named group.
#
# What it deliberately leaves out is the supporting cast: granting Sales
# Order also drags in Sales Taxes and Charges Template, Currency, UOM, Price
# List, Territory, Brand and a dozen more (see
# dac_permission_matrix.DOCTYPE_DEPENDENCIES, which is what actually grants
# them). Those are a consequence of the main grant, not a separate decision,
# so they are reported as a count.
#
# A doctype named here that doesn't exist on the site is simply skipped.
KEY_DOCTYPE_GROUPS = (
    ("Sales", ("Lead", "Quotation", "Sales Order", "Delivery Note",
               "Delivery Trip", "Sales Invoice", "Customer")),
    ("Purchase", ("Material Request", "Request for Quotation", "Supplier Quotation",
                  "Purchase Order", "Purchase Receipt", "Purchase Invoice",
                  "Supplier")),
    ("Subcontracting & Production", ("Subcontracting Order", "Subcontracting Receipt",
                                     "BOM", "Work Order", "Job Card",
                                     "Embroidery Work Order",
                                     "Uniform Embroidery Transfer")),
    ("Stock", ("Item", "Stock Entry", "Stock Reconciliation", "Quality Inspection",
               "Pick List", "Warehouse")),
    ("Accounts", ("Payment Entry", "Payment Request", "Journal Entry",
                  "Bank Transaction", "Bank Reconciliation Tool", "Expense Claim")),
    ("POS", ("POS Invoice", "POS Opening Entry", "POS Closing Entry")),
    ("HR & Payroll", ("Employee", "Attendance", "Leave Application", "Employee Checkin",
                      "Employee Advance", "Salary Slip", "Salary Structure",
                      "Salary Structure Assignment")),
    ("CRM & Communication", ("Contact", "Business Contacts", "Opportunity",
                             "Event Activity", "WhatsApp Instance")),
    ("Tasks & Projects", ("Task", "Project", "Timesheet")),
)

KEY_DOCTYPES = frozenset(dt for _group, dts in KEY_DOCTYPE_GROUPS for dt in dts)

# Apps this business maintains — their doctypes are business-specific by
# definition, so a grant on one is always worth showing.
COMPANY_APPS = ("erp_dacsinc_custom", "mobile_app_360ithub", "fcm_360ithub",
                "webtoolex_whatsapp")

OTHER_GROUP_LABEL = "Other business documents"


def _classify_doctypes(names):
    """
    Split granted doctypes into (main, supporting).

    "Main" is anything an admin would want to see on a permission screen:
    the curated KEY_DOCTYPES, plus any submittable doctype (a business
    transaction — Work Order, Salary Slip, Asset, Delivery Trip...), plus
    anything from one of this company's own apps (Business Contacts,
    WhatsApp Instance...). Everything left is the supporting cast that rides
    along with a main grant — Currency, UOM, tax templates, Item Group.

    Deriving it this way rather than from KEY_DOCTYPES alone is deliberate:
    it means a doctype nobody remembered to curate still shows up.
    """
    names = list(names)
    if not names:
        return set(), set()

    company_modules = set(frappe.get_all(
        "Module Def", filters={"app_name": ["in", list(COMPANY_APPS)]}, pluck="name",
    ))
    main = {
        d.name for d in frappe.get_all(
            "DocType", filters={"name": ["in", names]},
            fields=["name", "module", "is_submittable", "issingle"],
        )
        if d.name in KEY_DOCTYPES
        # a single is a settings page, not a document anyone files
        or (not d.issingle and (d.is_submittable or d.module in company_modules))
    }
    return main, set(names) - main


def _doctype_access_for_roles(roles):
    """
    What `roles` can do on each doctype: {doctype: {ptype: "full"|"owner"}}.

    Reads both tabDocPerm (each doctype's own baseline permissions) and
    tabCustom DocPerm (this app's matrix additions) directly, keyed off a
    role list, so it can never drift from what frappe.has_permission would
    really decide. Shared by the per-user view and the Role Profile preview
    so the two can never disagree about what a grant means.
    """
    if not roles:
        return {}

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
        {"roles": list(roles)},
        as_dict=True,
    )

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
    # Drop stale/renamed doctypes referenced by an old perm row, and drop
    # any whose perm row grants none of PTYPES — a row carrying only
    # select/print/export/report is real in tabDocPerm but grants nothing
    # this screen reports on, and rendering it produces a card with a
    # doctype name and no flags at all, which reads as "access granted"
    # while showing nothing.
    return {
        dt: perms for dt, perms in by_doctype.items()
        if dt in valid_doctypes and perms
    }


def _group_key_doctypes(access):
    """
    Lay a {doctype: perms} map out in KEY_DOCTYPE_GROUPS order, dropping
    groups nothing was granted in, and sweeping every other main doctype
    into a trailing "Other business documents" group so a grant can never
    go missing just because it wasn't curated.

    Returns (groups, supporting_count).
    """
    main, supporting = _classify_doctypes(access.keys())

    groups = []
    grouped = set()
    for label, doctypes in KEY_DOCTYPE_GROUPS:
        items = [
            {"doctype": dt, "permissions": access[dt]}
            for dt in doctypes if access.get(dt)
        ]
        if items:
            groups.append({"group": label, "doctypes": items})
            grouped.update(d["doctype"] for d in items)

    leftover = sorted(main - grouped)
    if leftover:
        groups.append({
            "group": OTHER_GROUP_LABEL,
            "doctypes": [{"doctype": dt, "permissions": access[dt]} for dt in leftover],
        })

    return groups, len(supporting)


@frappe.whitelist()
def get_user_doctype_access(user):
    """
    Every doctype this user's roles grant SOME access to, and what they can
    do on it — the "Doctype Access" detail on the page. `key_doctypes` marks
    which of them are the curated main ones, so the UI can default to those
    and keep the supporting doctypes behind a toggle.
    """
    _guard()
    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))

    access = _doctype_access_for_roles(frappe.get_roles(user))
    main, _supporting = _classify_doctypes(access.keys())

    doctypes = [
        {
            "doctype": doctype,
            "permissions": perms,
            "owner_only": bool(perms) and all(v == "owner" for v in perms.values()),
            "is_key": doctype in main,
        }
        for doctype, perms in access.items()
    ]
    doctypes.sort(key=lambda d: d["doctype"])

    return {"user": user, "doctypes": doctypes}


def _page_user_population():
    """The same user population the Users view lists: system users, minus
    Administrator/Guest. Every other "who has this" query on this page
    filters through this set, so a Role Profile held only by a filtered-out
    account never shows up as if a real page user had it."""
    return set(frappe.get_all(
        "User",
        filters={
            "user_type": "System User",
            "name": ["not in", ["Administrator", "Guest"]],
        },
        pluck="name",
    ))


def _users_by_role_profile(page_users):
    """{role_profile: {user, ...}} — native `role_profile_name` plus every
    User Access Profile grant, restricted to `page_users` and counting a
    user once even if both mechanisms name the same profile."""
    users_by_profile = {}
    for u in frappe.get_all(
        "User", filters={"role_profile_name": ["is", "set"]},
        fields=["name", "role_profile_name"],
    ):
        if u.name in page_users:
            users_by_profile.setdefault(u.role_profile_name, set()).add(u.name)
    for r in frappe.get_all(
        "User Access Profile Role Profile", fields=["parent", "role_profile"],
    ):
        if r.parent in page_users:
            users_by_profile.setdefault(r.role_profile, set()).add(r.parent)
    return users_by_profile


@frappe.whitelist()
def get_role_profiles_overview():
    """
    Every Role Profile on the site with the roles it bundles and how many
    users currently hold it — the "Role Profiles" view, which exists to
    answer "what does this profile grant?" without picking a user first.

    User counts are over the same population the Users view shows (system
    users, excluding Administrator/Guest) and count a user once even if
    they hold the profile both natively and through a User Access Profile.
    """
    _guard()

    roles_by_profile = {}
    for r in frappe.get_all(
        "Has Role", filters={"parenttype": "Role Profile"}, fields=["parent", "role"],
    ):
        roles_by_profile.setdefault(r.parent, []).append(r.role)

    users_by_profile = _users_by_role_profile(_page_user_population())

    profiles = []
    for name in sorted(frappe.get_all("Role Profile", pluck="name")):
        roles = sorted(roles_by_profile.get(name, []))
        profiles.append({
            "profile": name,
            "roles": roles,
            "role_count": len(roles),
            "user_count": len(users_by_profile.get(name, ())),
        })
    return {"profiles": profiles}


@frappe.whitelist()
def get_role_profile_users(role_profile):
    """
    Name and email of every user currently holding `role_profile` — the
    "who actually has this" behind the Role Profiles view's user count.
    Same population and native/User-Access-Profile union as that count, via
    the shared helper, so the two can never disagree.
    """
    _guard()
    if not frappe.db.exists("Role Profile", role_profile):
        frappe.throw(_("Role Profile {0} does not exist.").format(role_profile))

    page_users = _page_user_population()
    user_names = _users_by_role_profile(page_users).get(role_profile, set())

    users = frappe.get_all(
        "User", filters={"name": ["in", list(user_names)]},
        fields=["name", "full_name", "enabled"],
        order_by="full_name asc",
    )
    return {"role_profile": role_profile, "users": users}


def _roles_granting_doctype(doctype):
    """{role: {ptype: "full"|"owner"}} for every role with SOME access to
    `doctype` — the reverse of _doctype_access_for_roles (that one takes
    roles and finds doctypes; this takes a doctype and finds roles)."""
    rows = frappe.db.sql(
        """
        select role, `read`, `write`, `create`, submit, cancel, `delete`, if_owner
        from `tabDocPerm`
        where parent = %(dt)s and permlevel = 0
        union all
        select role, `read`, `write`, `create`, submit, cancel, `delete`, if_owner
        from `tabCustom DocPerm`
        where parent = %(dt)s and permlevel = 0
        """,
        {"dt": doctype},
        as_dict=True,
    )
    by_role = {}
    for r in rows:
        entry = by_role.setdefault(r.role, {})
        for ptype in PTYPES:
            if not r.get(ptype):
                continue
            if entry.get(ptype) != "full":
                entry[ptype] = "owner" if r.if_owner else "full"
    # same reason as _doctype_access_for_roles: a perm row granting only
    # select/print/export would otherwise list the role with no flags
    return {role: perms for role, perms in by_role.items() if perms}


def _users_with_any_role(roles, page_users):
    """Every one of `page_users` who currently holds at least one of
    `roles`, read straight off each User's own Has Role rows — the same
    source of truth frappe.get_roles() resolves from, so this can never
    disagree with what a user can actually do."""
    if not roles:
        return set()
    return set(frappe.get_all(
        "Has Role",
        filters={
            "parenttype": "User",
            "role": ["in", list(roles)],
            "parent": ["in", list(page_users)],
        },
        pluck="parent",
    ))


def _merge_role_permissions(by_role, roles):
    """Collapse several roles' {ptype: tier} grants on one doctype down to
    a single recipient's grant, "full" always winning over "owner" — same
    rule _roles_granting_doctype and _doctype_access_for_roles both use, so
    a user's merged access can never disagree with the role-level rows
    already shown for the same doctype."""
    merged = {}
    for role in roles:
        for ptype, tier in by_role.get(role, {}).items():
            if merged.get(ptype) != "full":
                merged[ptype] = tier
    return merged


@frappe.whitelist()
def get_user_access_for_doctype(user, doctype):
    """
    Exactly what `user` can do on `doctype`, and which of their roles is the
    reason — the drill-down behind clicking a name in a doctype's "N users"
    list. Different roles among the ones granting a doctype often grant
    different tiers (read-only vs full CRUD); this answers "which one does
    THIS person actually get" instead of leaving the admin to cross-reference
    the role list against a role list they'd have to fetch separately.
    """
    _guard()
    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))
    if not frappe.db.exists("DocType", doctype):
        frappe.throw(_("DocType {0} does not exist.").format(doctype))

    by_role = _roles_granting_doctype(doctype)
    granting_roles = sorted(set(frappe.get_roles(user)) & set(by_role.keys()))

    return {
        "user": user,
        "doctype": doctype,
        "roles": [{"role": r, "permissions": by_role[r]} for r in granting_roles],
        "permissions": _merge_role_permissions(by_role, granting_roles),
    }


@frappe.whitelist()
def get_doctype_access_overview():
    """
    Every doctype ANY role currently grants some access to, with how many
    roles grant it and how many of this page's users hold at least one of
    those roles — the list behind the "search any doctype" view.

    Deliberately NOT restricted to the curated KEY_DOCTYPES the Role Profile
    preview uses: an admin searching for a specific doctype — including a
    "supporting" one like Customer or Item — is exactly the case a search
    exists for, and hiding results here would defeat the point. The curated
    list only matters when BROWSING a profile's grants, where 60 lines of
    noise bury the 6 that matter; a targeted search has no such problem.
    """
    _guard()

    rows = frappe.db.sql(
        """
        select parent as doctype, role from `tabDocPerm` where permlevel = 0
        union
        select parent as doctype, role from `tabCustom DocPerm` where permlevel = 0
        """,
        as_dict=True,
    )
    roles_by_doctype = {}
    for r in rows:
        roles_by_doctype.setdefault(r.doctype, set()).add(r.role)

    valid_doctypes = set(frappe.get_all(
        "DocType", filters={"istable": 0, "issingle": 0}, pluck="name",
    ))

    page_users = _page_user_population()
    users_by_role = {}
    for r in frappe.get_all(
        "Has Role", filters={"parenttype": "User", "parent": ["in", list(page_users)]},
        fields=["parent", "role"],
    ):
        users_by_role.setdefault(r.role, set()).add(r.parent)

    items = []
    for doctype, roles in roles_by_doctype.items():
        if doctype not in valid_doctypes:
            continue
        users = set()
        for role in roles:
            users |= users_by_role.get(role, set())
        items.append({
            "doctype": doctype,
            "role_count": len(roles),
            "user_count": len(users),
        })
    items.sort(key=lambda x: x["doctype"])
    return {"doctypes": items}


@frappe.whitelist()
def get_doctype_access_detail(doctype):
    """
    Exactly which roles grant access to `doctype`, what each one grants, and
    every one of this page's users who currently holds any of those roles —
    the drill-down behind get_doctype_access_overview().
    """
    _guard()
    if not frappe.db.exists("DocType", doctype):
        frappe.throw(_("DocType {0} does not exist.").format(doctype))

    by_role = _roles_granting_doctype(doctype)
    roles = [{"role": r, "permissions": by_role[r]} for r in sorted(by_role)]

    page_users = _page_user_population()
    user_names = _users_with_any_role(by_role.keys(), page_users)
    users = frappe.get_all(
        "User", filters={"name": ["in", list(user_names)]},
        fields=["name", "full_name", "enabled"],
        order_by="full_name asc",
    )
    return {"doctype": doctype, "roles": roles, "users": users}


@frappe.whitelist()
def get_role_profile_access_preview(role_profiles=None):
    """
    "If I give someone these Role Profile(s), what can they actually do?" —
    answered before anything is assigned, over the curated key doctypes only.

    Reports what the PROFILES themselves grant. A user may end up with more
    than this from a directly-assigned role or another profile, which is why
    the caller shows this as the profiles' own contribution rather than as
    the user's final access.
    """
    _guard()
    if isinstance(role_profiles, str):
        role_profiles = frappe.parse_json(role_profiles)
    role_profiles = role_profiles or []

    roles = sorted({
        role
        for profile in role_profiles
        for role in frappe.get_all(
            "Has Role",
            filters={"parent": profile, "parenttype": "Role Profile"},
            pluck="role",
        )
    })

    access = _doctype_access_for_roles(roles)
    groups, supporting_count = _group_key_doctypes(access)
    return {
        "role_profiles": role_profiles,
        "roles": roles,
        "groups": groups,
        # the supporting cast only — a count, so the admin knows the preview
        # summarises rather than hides
        "supporting_count": supporting_count,
    }


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


    # 2. Reconcile user Role Profiles — via apply_dac_matrix_assignments(), the
    # SAME additive-only path the "DAC Matrix" dialog uses, so this "sync
    # everything" action can never diverge into the destructive behavior it
    # used to have here (a hard `update_user_role_profiles(user, [proposed])`
    # replacing a user's ENTIRE profile list — wiping out any other Role
    # Profile they held for a second responsibility, e.g. Merchandiser +
    # something else). It only ever ADDS the matrix's proposed profile.
    from erp_dacsinc_custom.dac_permission_matrix import EMPLOYEE_ROLE_PROFILE_TARGETS

    target_by_user = {t["user"]: t for t in EMPLOYEE_ROLE_PROFILE_TARGETS}
    before_by_user = {
        user: _current_role_profiles(user)
        for user in target_by_user if frappe.db.exists("User", user)
    }

    apply_result = apply_dac_matrix_assignments(list(target_by_user.keys()))

    updated_users = []
    skipped_users = []
    reason_labels = {
        "user_not_found": _("User not found"),
        "not_in_matrix": _("Not in matrix"),
    }
    for row in apply_result["results"]:
        user = row["user"]
        if row["status"] == "already_set":
            continue  # no-op — nothing to report, matches the old silent-skip
        employee_name = target_by_user.get(user, {}).get("employee_name", user)
        if row["status"] == "updated":
            updated_users.append({
                "user": user,
                "employee_name": employee_name,
                "profile": row["role_profile"],
                "previous": before_by_user.get(user, []),
            })
        else:
            reason = row.get("reason") or reason_labels.get(row["status"], row["status"])
            skipped_users.append({"user": user, "employee_name": employee_name, "reason": reason})

    return {
        "updated": updated_users,
        "skipped": skipped_users
    }

