"""
Role-based tab visibility for the Order Flow dashboard.

One rule: a tab with no roles configured (in Admin Settings > Order Flow) is
visible to anyone who can open the page; the page can be opened by anyone who
can see at least one tab. Administrator and everyone in ADMIN_ROLES (System
Manager, Super Admin) always see every tab — that bypass is hard-coded here,
not configurable, so the dashboard can never become unadministrable.

"Empty tab = everyone" is deliberate, not just a convenient default: on first
deploy every tab field is empty, so behaviour is identical to before this
feature existed and nothing needs to be migrated. Configuring a tab only ever
narrows its audience from "everyone" down — the rollout is monotonic and each
step is independently reversible by clearing the field.

This module is the single source of truth for the tab list, referenced by
both order_flow_api.py and uniform_transfer_api.py (which is why it isn't
folded into the already large order_flow_api.py).
"""

import frappe
from frappe import _

# Ordered left-to-right exactly as the tab strip renders. The order is
# load-bearing: allowed_tabs[0] becomes the landing tab on the client.
#
# "accounts" was the original receivables/payables tab and is now labelled
# "Finance" (see OF_TAB_LABELS) — its key stays "accounts" so existing
# of_tab_accounts_roles configuration keeps applying unchanged. "billing" is
# the new tab that took over the "Accounts" label: Sales Orders that have a
# Delivery Note but still need to be billed.
OF_TABS = ("approval", "tracker", "purchase", "jobwork", "stock", "billing", "accounts", "uniform")

OF_TAB_LABELS = {
    "approval": "SO Approvals",
    "tracker": "Sales Tracker",
    "purchase": "Purchase Flow",
    "jobwork": "Job Work",
    "stock": "Stock Tracker",
    "billing": "Accounts",
    "accounts": "Finance",
    "uniform": "Embroidery Transfers",
}

TAB_DOCTYPES = {
    "approval": ["Sales Order"],
    "tracker": ["Sales Order"],
    "purchase": ["Purchase Order", "Material Request"],
    "jobwork": ["Subcontracting Order", "Embroidery Work Order"],
    "stock": ["Stock Entry"],
    "billing": ["Sales Invoice"],
    "accounts": ["Payment Entry", "Journal Entry", "Sales Invoice", "Purchase Invoice"],
    "uniform": ["Uniform Embroidery Transfer"],
}


# The roles that could open the Order Flow page before this feature existed
# (order_flow.json's original static role list). Used only while at least one
# tab is still unconfigured, so that "the page opens for anyone who can see a
# tab" stays well-defined during a partial rollout — see
# sync_order_flow_page_roles().
LEGACY_PAGE_ROLES = (
    "Sales User", "Sales Manager",
    "Purchase User", "Purchase Manager",
    "Stock User", "Stock Manager",
    "System Manager",
)


def _tab_field(tab):
    return f"of_tab_{tab}_roles"


# Roles that bypass tab configuration entirely and see all six tabs. Kept as
# a tuple (not a single name) so a future "give this person everything but
# don't make them a System Manager" role can be added in one place.
#
# "Super Admin" and "Admin" are deliberately plain desk roles, not System
# Manager — they grant full Order Flow visibility without also granting
# System Manager's much broader powers (doctype customization, user
# management, etc.). See erp_dacsinc_custom.role_permission_matrix.
ADMIN_ROLES = ("System Manager", "Super Admin", "Admin")

# Bridges the Sales Order Workflow's "Pending Final Approval" transition
# (Frappe workflow transitions are gated by a Role, never by a list of
# individual users) to the actual source of truth for who may final-approve:
# Admin Settings > Sales Order Final Approval, a per-user list. Holding any
# other role — including a broad one like a future "Merchandiser Manager" —
# must never grant this on its own; only being named in that list (or being
# an admin, via ADMIN_ROLES/System Manager on the transition itself) does.
# See sync_sales_order_final_approver_role().
SALES_ORDER_FINAL_APPROVER_ROLE = "Sales Order Final Approver"


def is_admin(user=None):
    """
    True for Administrator or anyone holding one of ADMIN_ROLES.

    Administrator implicitly holds every role Frappe knows about
    (frappe.get_roles("Administrator") returns the full role list), so this
    check must be explicit rather than inferred from any single role name —
    the same reasoning documented on is_merchandiser_user() in
    order_flow_api.py.
    """
    user = user or frappe.session.user
    if user == "Administrator":
        return True
    return bool(set(frappe.get_roles(user)) & set(ADMIN_ROLES))


def get_tab_roles():
    """
    {tab: [role, ...]} as configured in Admin Settings.

    Defensive by design: a broken or missing Admin Settings record must never
    brick the dashboard, so any failure here is treated as "every tab
    unconfigured" (i.e. unrestricted), matching the empty-tab default.
    """
    try:
        settings = frappe.get_cached_doc("Admin Settings")
    except Exception:
        frappe.log_error(title="Order Flow: could not read tab role config",
                         message=frappe.get_traceback())
        return {tab: [] for tab in OF_TABS}

    roles = {}
    for tab in OF_TABS:
        try:
            roles[tab] = [d.role for d in (settings.get(_tab_field(tab)) or []) if d.role]
        except Exception:
            roles[tab] = []
    return roles


def can_view_tab(tab, user=None, tab_roles=None):
    """Whether `user` (session user by default) may see `tab`."""
    if is_admin(user):
        return True

    user = user or frappe.session.user
    if tab in TAB_DOCTYPES:
        has_doctype_access = False
        for dt in TAB_DOCTYPES[tab]:
            if frappe.has_permission(dt, "read", user=user):
                has_doctype_access = True
                break
        if not has_doctype_access:
            return False

    allowed = (tab_roles or get_tab_roles()).get(tab) or []
    if not allowed:
        return True  # unconfigured = everyone who has doctype read access

    return bool(set(frappe.get_roles(user)) & set(allowed))



def is_scoped_to_own_customers(tab, user=None, tab_roles=None):
    """
    True if `user`'s ONLY reason for seeing `tab` is the Merchandiser User
    role — i.e. they hold none of that tab's OTHER configured roles.

    A merchandiser is expected to see only their own customers' orders. But
    "Merchandiser User" can be combined with a broader operational role
    (Production Manager, Accounts Executive, ...) for someone who does both
    jobs, and that role's own reason for being on this tab is company-wide
    visibility — scoping them down to their own customers would take away
    access their OTHER role legitimately grants. Only a user with no other
    tab-granting role gets narrowed.

    Deliberately keyed off the tab's own role configuration rather than a
    hard-coded list of "broad" roles, so this stays correct automatically if
    that configuration changes — no second list to keep in sync.
    """
    user = user or frappe.session.user
    if is_admin(user):
        return False

    roles = set(frappe.get_roles(user))
    if "Merchandiser User" not in roles:
        return False

    other_roles = set((tab_roles or get_tab_roles()).get(tab) or []) - {"Merchandiser User"}
    return not (roles & other_roles)


def get_allowed_tabs(user=None):
    """Tabs `user` may see, in tab-strip order."""
    tab_roles = get_tab_roles()
    return [t for t in OF_TABS if can_view_tab(t, user, tab_roles)]


def guard_tab(tab):
    """
    Raise PermissionError unless the session user may see `tab`.

    Deliberately checks ONLY tab access — not Sales Order read permission,
    which the callers already enforce separately via _guard(). Keeping the
    two independent matters for the "uniform" tab: Uniform Embroidery
    Transfer carries no Sales Order link, so a Sales-Order-read requirement
    would wrongly exclude a Stock User who has no reason to read Sales
    Orders at all.
    """
    if not can_view_tab(tab):
        frappe.throw(
            _("You are not permitted to view the {0} tab of Order Flow.").format(
                _(OF_TAB_LABELS.get(tab, tab))
            ),
            frappe.PermissionError,
        )


@frappe.whitelist()
def get_order_flow_permissions():
    """
    Everything the client needs to gate the tab strip and the SO Approval
    sub-tabs, in one call.

    Returns both a dense map (`tabs`) for point lookups and an ordered list
    (`allowed_tabs`) for the landing tab and the unread-badge loop — deriving
    one from the other client-side would just reintroduce the tab ordering
    as a second list in JavaScript.
    """
    if not frappe.has_permission("Sales Order", "read"):
        frappe.throw(_("You are not permitted to view Sales Orders."), frappe.PermissionError)

    roles = frappe.get_roles()
    admin = is_admin()

    tab_roles = get_tab_roles()
    tabs = {t: can_view_tab(t, tab_roles=tab_roles) for t in OF_TABS}
    allowed_tabs = [t for t in OF_TABS if tabs[t]]

    final_users = []
    try:
        settings = frappe.get_cached_doc("Admin Settings")
        final_users = [d.user for d in (settings.get("sales_order_final_approval") or []) if d.user]
    except Exception:
        frappe.log_error(title="Order Flow: could not read final approvers",
                         message=frappe.get_traceback())

    return {
        "user": frappe.session.user,
        "is_admin": admin,
        "is_merchandiser": "Merchandiser User" in roles,
        # Admins keep access so the approval workflow is never unadministrable.
        "is_final_approver": bool(admin or frappe.session.user in final_users),
        "final_approvers": final_users,
        "tabs": tabs,
        "allowed_tabs": allowed_tabs,
        # Single source of truth for "does this user see only their own
        # customers' orders on the Tracker tab, with no action buttons" —
        # get_sales_tracker() filters by this same function, so the client's
        # button-hiding and the server's row-scoping can never disagree.
        "tracker_scoped_to_own_customers": is_scoped_to_own_customers("tracker", tab_roles=tab_roles),
    }


def sync_order_flow_page_roles(doc=None, method=None):
    # doc/method accepted (and ignored) so this can be wired both as an
    # Admin Settings on_update doc_event (called as (doc, method)) and as an
    # after_migrate hook (called with no arguments).
    """
    Regenerate the Custom Role that gates the Order Flow Page itself, from
    the union of the six tab configs.

    Why a Custom Role rather than editing order_flow.json's roles directly:
    order_flow.json is a "standard" Page — bench migrate re-imports it from
    disk, so any DB-side edit to its roles would be silently overwritten on
    the next migrate. A Custom Role is a plain, non-standard DocType record
    that migrate never touches, and it is exactly the mechanism Frappe core
    already provides for overriding a Page's roles (Page.is_permitted() adds
    get_custom_allowed_roles() to the static list).

    Rule: while any tab is still unconfigured, the page stays open to
    whoever could open it before this feature existed (LEGACY_PAGE_ROLES),
    unioned with whatever has been configured so far. Once every tab has an
    explicit role list, the page's audience becomes exactly the union of
    those six lists. Either way ADMIN_ROLES are always included, and the
    record is never saved empty — Page.is_permitted() treats "no roles at
    all" as "visible to everyone", so an empty Custom Role would be a
    fail-open, and a Custom Role with an empty child table is additionally
    known to hide the page from every user in the desk sidebar/awesomebar
    listing (frappe.boot.get_user_pages_or_reports excludes any page that
    HAS a Custom Role record from its "no restrictions" query, then finds no
    matching role in the empty one).
    """
    # When this runs as Admin Settings' own on_update hook, it is called
    # DURING that same save — Document.run_post_save_methods() fires
    # on_update before it clears the document cache, so a cached read here
    # would still see the pre-save values. Force a fresh read explicitly
    # rather than depend on that ordering (verified against
    # frappe/model/document.py: db write -> on_update -> clear_cache).
    frappe.clear_document_cache("Admin Settings", "Admin Settings")
    tab_roles = get_tab_roles()
    any_unconfigured = any(not roles for roles in tab_roles.values())

    page_roles = set()
    if any_unconfigured:
        page_roles.update(LEGACY_PAGE_ROLES)
    for roles in tab_roles.values():
        page_roles.update(roles)
    page_roles.update(ADMIN_ROLES)

    # Drop roles that no longer exist, so a renamed/deleted Role can't leave
    # a dangling Link on the Custom Role's child table.
    page_roles = {r for r in page_roles if frappe.db.exists("Role", r)}

    existing_name = frappe.db.get_value("Custom Role", {"page": "order-flow"}, "name")

    if not page_roles:
        # Cannot happen (ADMIN_ROLES are always added above) — kept as a
        # hard stop rather than ever writing an empty Custom Role.
        if existing_name:
            frappe.delete_doc("Custom Role", existing_name, ignore_permissions=True)
        frappe.db.commit()
        return

    if existing_name:
        custom_role = frappe.get_doc("Custom Role", existing_name)
        custom_role.set("roles", [])
    else:
        custom_role = frappe.new_doc("Custom Role")
        custom_role.page = "order-flow"

    for role in sorted(page_roles):
        custom_role.append("roles", {"role": role})

    custom_role.flags.ignore_permissions = True
    custom_role.save(ignore_permissions=True)
    frappe.db.commit()

    # has_role:Page and the allowed-pages list are both cached per user; a
    # targeted invalidation can't reach every affected session, and this
    # runs rarely enough (an Admin Settings save, or a migrate) that a full
    # clear is the right trade-off.
    frappe.clear_cache()


def get_sales_order_final_approvers():
    """Users listed in Admin Settings > Sales Order Final Approval."""
    try:
        settings = frappe.get_cached_doc("Admin Settings")
        return [d.user for d in (settings.get("sales_order_final_approval") or []) if d.user]
    except Exception:
        frappe.log_error(title="Order Flow: could not read final approvers",
                         message=frappe.get_traceback())
        return []


def sync_sales_order_final_approver_role(doc=None, method=None):
    # doc/method accepted (and ignored) so this can be wired both as an
    # Admin Settings on_update doc_event and as an after_migrate hook, same
    # as sync_order_flow_page_roles above.
    """
    Keep the Sales Order Final Approver role assigned to exactly the users
    listed in Admin Settings > Sales Order Final Approval — no more, no less.

    This role exists solely to satisfy the Sales Order Workflow's
    role-gated "Pending Final Approval" transition; it is never assigned by
    hand and grants nothing beyond passing that one gate (System Manager /
    Administrator can always pass it too, via a separate transition row —
    see setup_sales_order_workflow in order_flow_api.py).
    """
    if not frappe.db.exists("Role", SALES_ORDER_FINAL_APPROVER_ROLE):
        return

    frappe.clear_document_cache("Admin Settings", "Admin Settings")
    wanted = {u for u in get_sales_order_final_approvers() if frappe.db.exists("User", u)}

    has_role = set(frappe.get_all(
        "Has Role",
        filters={"role": SALES_ORDER_FINAL_APPROVER_ROLE, "parenttype": "User"},
        pluck="parent",
    ))

    changed = False
    blocked_by_role_profile = []
    for user in wanted - has_role:
        user_doc = frappe.get_doc("User", user)
        if user_doc.role_profile_name:
            # User.validate() unconditionally repopulates `roles` from the
            # Role Profile on every save (populate_role_profile_roles) — a
            # role added here would be silently wiped out by that same
            # save, not just at some later, unrelated save. Adding it to the
            # Role Profile instead would grant it to every OTHER user on
            # that profile too, which is a decision for a human to make
            # explicitly, not something this sync should do on its own.
            blocked_by_role_profile.append((user, user_doc.role_profile_name))
            continue
        user_doc.add_roles(SALES_ORDER_FINAL_APPROVER_ROLE)
        changed = True

    if blocked_by_role_profile:
        frappe.log_error(
            title="Order Flow: final approver role blocked by Role Profile",
            message="Could not grant {0} to: {1}. Each has a Role Profile "
                    "(User.roles is fully repopulated from it on every save), "
                    "so either add the role to that profile directly or remove "
                    "the user's Role Profile.".format(
                        SALES_ORDER_FINAL_APPROVER_ROLE,
                        ", ".join(f"{u} ({p})" for u, p in blocked_by_role_profile),
                    ),
        )

    for user in has_role - wanted:
        frappe.db.delete("Has Role", {
            "role": SALES_ORDER_FINAL_APPROVER_ROLE, "parent": user, "parenttype": "User",
        })
        changed = True

    if changed:
        frappe.db.commit()
        frappe.clear_cache()
