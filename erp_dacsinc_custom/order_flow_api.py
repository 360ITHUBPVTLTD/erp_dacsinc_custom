"""
Data API for the "Order Flow" desk page.

One place to watch a Sales Order travel through the business:
    Sales Order -> Material Request -> Purchase Order -> Receipt
                -> Subcontracting / Embroidery job work
                -> Pick List -> Delivery Note -> Invoice

Every document type is joined back to the Sales Order it serves, so the page can
answer "what happened to my order?" without opening ten list views.

All queries are read-only and scoped by the standard Sales Order read permission.
"""

import re

import frappe
from frappe import _
from frappe.utils import cint, flt, add_days, nowdate

from erp_dacsinc_custom.order_flow_permissions import (
    OF_TABS,
    guard_tab as _guard_tab,
    get_order_flow_permissions,
    is_scoped_to_own_customers,
)
from erp_dacsinc_custom.custom_script import (
    _so_has_submitted_dn, _so_has_submitted_stock_si, check_bom_raw_materials_in_stock,
)


# --------------------------------------------------------------------------
# Linkage
# --------------------------------------------------------------------------

_EVENT_SQL = """
    SELECT 'Material Request' AS doctype, mr.name, mri.sales_order AS sales_order,
           mr.modified AS ts, mr.creation AS created, mr.status, mr.docstatus, mr.owner,
           NULL AS party, NULL AS party_name,
           IF(MAX(CASE WHEN mri.sales_order_item IS NOT NULL AND mri.sales_order_item != '' THEN 1 ELSE 0 END) > 0, 0, 1) AS is_rm_tier
    FROM `tabMaterial Request Item` mri
    JOIN `tabMaterial Request` mr ON mr.name = mri.parent
    WHERE mri.sales_order IS NOT NULL AND mri.sales_order != '' AND mr.docstatus <= 2
    GROUP BY mr.name, mri.sales_order, mr.modified, mr.creation, mr.status, mr.docstatus, mr.owner

    UNION ALL

    SELECT 'Purchase Order', po.name, poi.sales_order,
           po.modified, po.creation, po.status, po.docstatus, po.owner,
           po.supplier, sup.supplier_name,
           IF(MAX(CASE WHEN poi.sales_order_item IS NOT NULL AND poi.sales_order_item != '' THEN 1 ELSE 0 END) > 0, 0, 1) AS is_rm_tier
    FROM `tabPurchase Order Item` poi
    JOIN `tabPurchase Order` po ON po.name = poi.parent
    LEFT JOIN `tabSupplier` sup ON sup.name = po.supplier
    WHERE poi.sales_order IS NOT NULL AND poi.sales_order != '' AND po.docstatus <= 2
    GROUP BY po.name, poi.sales_order, po.modified, po.creation, po.status, po.docstatus, po.owner, po.supplier, sup.supplier_name

    UNION ALL

    SELECT 'Purchase Receipt', pr.name, pri.sales_order,
           pr.modified, pr.creation, pr.status, pr.docstatus, pr.owner,
           pr.supplier, sup.supplier_name,
           IF(MAX(CASE WHEN pri.sales_order_item IS NOT NULL AND pri.sales_order_item != '' THEN 1 ELSE 0 END) > 0, 0, 1) AS is_rm_tier
    FROM `tabPurchase Receipt Item` pri
    JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
    LEFT JOIN `tabSupplier` sup ON sup.name = pr.supplier
    WHERE pri.sales_order IS NOT NULL AND pri.sales_order != '' AND pr.docstatus <= 2
    GROUP BY pr.name, pri.sales_order, pr.modified, pr.creation, pr.status, pr.docstatus, pr.owner, pr.supplier, sup.supplier_name

    UNION ALL

    SELECT 'Subcontracting Receipt', scr.name, poi.sales_order,
           scr.modified, scr.creation, scr.status, scr.docstatus, scr.owner,
           scr.supplier, sup.supplier_name,
           IF(MAX(CASE WHEN poi.sales_order_item IS NOT NULL AND poi.sales_order_item != '' THEN 1 ELSE 0 END) > 0, 0, 1) AS is_rm_tier
    FROM `tabSubcontracting Receipt Item` scri
    JOIN `tabSubcontracting Receipt` scr ON scr.name = scri.parent
    JOIN `tabPurchase Order Item` poi ON poi.name = scri.purchase_order_item
    LEFT JOIN `tabSupplier` sup ON sup.name = scr.supplier
    WHERE poi.sales_order IS NOT NULL AND poi.sales_order != '' AND scr.docstatus <= 2
    GROUP BY scr.name, poi.sales_order, scr.modified, scr.creation, scr.status, scr.docstatus, scr.owner, scr.supplier, sup.supplier_name

    UNION ALL

    -- Subcontracting Orders are tracked through their Purchase Order: the event
    -- carries the PO id, never the SCO id, so nothing in the dashboard links to
    -- a Subcontracting Order. The doctype label keeps the "job work" signal.
    -- Always main-item tier: a subcontract Job Work IS the finished good's own
    -- production step, never a raw-material-only request.
    SELECT 'Job Work (Subcontract)', sco.purchase_order, poi.sales_order,
           sco.modified, sco.creation, sco.status, sco.docstatus, sco.owner,
           sco.supplier, sup.supplier_name, 0 AS is_rm_tier
    FROM `tabSubcontracting Order` sco
    JOIN `tabPurchase Order Item` poi ON poi.parent = sco.purchase_order
    LEFT JOIN `tabSupplier` sup ON sup.name = sco.supplier
    WHERE poi.sales_order IS NOT NULL AND poi.sales_order != '' AND sco.docstatus <= 2
      AND sco.purchase_order IS NOT NULL AND sco.purchase_order != ''
    GROUP BY sco.purchase_order, poi.sales_order, sco.modified, sco.creation, sco.status, sco.docstatus, sco.owner, sco.supplier, sup.supplier_name

    UNION ALL

    SELECT 'Embroidery Work Order', ewo.purchase_order, poi.sales_order,
           ewo.modified, ewo.creation, ewo.status, ewo.docstatus, ewo.owner,
           COALESCE(ewo.full_piece_jobber, ewo.panel_jobber),
           COALESCE(fp.supplier_name, pn.supplier_name), 0 AS is_rm_tier
    FROM `tabEmbroidery Work Order` ewo
    JOIN `tabPurchase Order Item` poi ON poi.parent = ewo.purchase_order
    LEFT JOIN `tabSupplier` fp ON fp.name = ewo.full_piece_jobber
    LEFT JOIN `tabSupplier` pn ON pn.name = ewo.panel_jobber
    WHERE poi.sales_order IS NOT NULL AND poi.sales_order != '' AND ewo.docstatus <= 2
    GROUP BY ewo.purchase_order, poi.sales_order, ewo.modified, ewo.creation, ewo.status, ewo.docstatus, ewo.owner,
             ewo.full_piece_jobber, ewo.panel_jobber, fp.supplier_name, pn.supplier_name

    UNION ALL

    SELECT 'Pick List', pl.name, pli.sales_order,
           pl.modified, pl.creation, pl.status, pl.docstatus, pl.owner,
           pl.customer, cust.customer_name, 0 AS is_rm_tier
    FROM `tabPick List Item` pli
    JOIN `tabPick List` pl ON pl.name = pli.parent
    LEFT JOIN `tabCustomer` cust ON cust.name = pl.customer
    WHERE pli.sales_order IS NOT NULL AND pli.sales_order != '' AND pl.docstatus <= 2
    GROUP BY pl.name, pli.sales_order, pl.modified, pl.creation, pl.status, pl.docstatus, pl.owner, pl.customer, cust.customer_name

    UNION ALL

    SELECT 'Delivery Note', dn.name, dni.against_sales_order,
           dn.modified, dn.creation, dn.status, dn.docstatus, dn.owner,
           dn.customer, cust.customer_name, 0 AS is_rm_tier
    FROM `tabDelivery Note Item` dni
    JOIN `tabDelivery Note` dn ON dn.name = dni.parent
    LEFT JOIN `tabCustomer` cust ON cust.name = dn.customer
    WHERE dni.against_sales_order IS NOT NULL AND dni.against_sales_order != '' AND dn.docstatus <= 2
    GROUP BY dn.name, dni.against_sales_order, dn.modified, dn.creation, dn.status, dn.docstatus, dn.owner, dn.customer, cust.customer_name

    UNION ALL

    SELECT 'Sales Invoice', si.name, sii.sales_order,
           si.modified, si.creation, si.status, si.docstatus, si.owner,
           si.customer, cust.customer_name, 0 AS is_rm_tier
    FROM `tabSales Invoice Item` sii
    JOIN `tabSales Invoice` si ON si.name = sii.parent
    LEFT JOIN `tabCustomer` cust ON cust.name = si.customer
    WHERE sii.sales_order IS NOT NULL AND sii.sales_order != '' AND si.docstatus <= 2
    GROUP BY si.name, sii.sales_order, si.modified, si.creation, si.status, si.docstatus, si.owner, si.customer, cust.customer_name

    UNION ALL

    SELECT 'Purchase Invoice', pi.name, poi.sales_order,
           pi.modified, pi.creation, pi.status, pi.docstatus, pi.owner,
           pi.supplier, sup.supplier_name, 0 AS is_rm_tier
    FROM `tabPurchase Invoice Item` pii
    JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
    JOIN `tabPurchase Order Item` poi ON poi.parent = pii.purchase_order
    LEFT JOIN `tabSupplier` sup ON sup.name = pi.supplier
    WHERE poi.sales_order IS NOT NULL AND poi.sales_order != '' AND pi.docstatus <= 2
    GROUP BY pi.name, poi.sales_order, pi.modified, pi.creation, pi.status, pi.docstatus, pi.owner, pi.supplier, sup.supplier_name

    UNION ALL

    SELECT 'Sales Order' AS doctype, so.name, so.name AS sales_order,
           so.modified AS ts, so.creation AS created, COALESCE(so.workflow_state, so.status) AS status, so.docstatus, so.owner,
           so.customer AS party, so.customer_name AS party_name, 0 AS is_rm_tier
    FROM `tabSales Order` so
    WHERE so.docstatus <= 2

    UNION ALL

    SELECT 'Comment' AS doctype, c.name, c.reference_name AS sales_order,
           c.modified AS ts, c.creation AS created, c.content AS status, 0 AS docstatus, c.owner,
           NULL AS party, NULL AS party_name, 0 AS is_rm_tier
    FROM `tabComment` c
    WHERE c.reference_doctype = 'Sales Order' AND c.comment_type = 'Comment'

    UNION ALL

    -- Embroidery stock transfers are warehouse-to-warehouse moves with no Sales
    -- Order behind them, so sales_order is NULL here. They exist in this feed so
    -- the Embroidery Transfers tab can notify on its own records; every consumer
    -- has to tolerate a NULL sales_order.
    SELECT 'Uniform Embroidery Transfer' AS doctype, uet.name, NULL AS sales_order,
           uet.modified AS ts, uet.creation AS created, uet.status, uet.docstatus, uet.owner,
           NULL AS party, NULL AS party_name, 0 AS is_rm_tier
    FROM `tabUniform Embroidery Transfer` uet
"""


def _guard():
    if not frappe.has_permission("Sales Order", "read"):
        frappe.throw(_("You are not permitted to view Sales Orders."), frappe.PermissionError)


# A Sales Order flagged "Old Record Item Is Disabled" is a superseded/legacy
# record that must never surface anywhere on this dashboard — not the
# tracker, not approvals, not any PO/MR/receipt/invoice row derived from it.
# Every query below joins Sales Order as `so` (or the activity subquery as
# `so2`); this fragment is NULL-tolerant so it never drops a row that simply
# has no Sales Order behind it (e.g. a standalone embroidery transfer).
_NOT_DISABLED_SO = "(so.name IS NULL OR IFNULL(so.custom_old_record_item_is_disabled, 0) = 0)"
_NOT_DISABLED_SO2 = "(so2.name IS NULL OR IFNULL(so2.custom_old_record_item_is_disabled, 0) = 0)"


def _from_date(days):
    return add_days(nowdate(), -abs(int(days or 120)))


# --------------------------------------------------------------------------
# Event importance & per-user relevance
#
# _EVENT_SQL fires a row for every touch on every linked document — including
# the `modified` bump each save makes — which is far more than an operator can
# read. The helpers below decide which rows are real milestones ("important")
# and which of them the logged-in user actually has to act on.
# --------------------------------------------------------------------------

# Milestone wording per doctype, used once the document is submitted.
_SUBMITTED_LABELS = {
    "Material Request": "Material Request submitted",
    "Purchase Order": "Purchase Order placed",
    "Job Work (Subcontract)": "Job Work sent to vendor",
    "Embroidery Work Order": "Embroidery work started",
    "Purchase Receipt": "Stock received",
    "Subcontracting Receipt": "Subcontract goods received",
    "Pick List": "Pick List submitted",
    "Delivery Note": "Delivered to customer",
    "Sales Invoice": "Sales Invoice raised",
    "Purchase Invoice": "Supplier bill booked",
}

def _plain_text(html):
    if not html:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", str(html))).strip()


# The dashboard's notification tabs. Only the names live here — which doctypes
# each tab shows is the page's business (see OF_TAB_FILTERS in order_flow.js).
# The dashboard's tab set now lives in order_flow_permissions.OF_TABS, which
# also drives the per-tab role gating — kept as one list so the two can never
# drift apart.
_ACTIVITY_TABS = OF_TABS


def _seen_key(tab, doctype, name, docstatus=None, status=None):
    """
    Identity of one *notification*, not of the document behind it.

    Two things are folded into the key on purpose:

    `tab`, because one event surfaces on several tabs — a Purchase Order shows
    up under both Purchase and the Tracker — and clearing it where you work
    should not silently clear it for the colleague working the other tab.

    the document's state, because keying purely on doctype:name makes "seen"
    stick to the document for the rest of its life: mark the draft Purchase
    Order seen (or hit "Mark all seen" once) and its submission, and later its
    cancellation, are born already-seen and never notify again.

    Seen marks are stored per session user (a DefaultValue row parented to that
    user), so one user clearing a notification never affects another's.
    """
    return f"{tab}|{doctype}:{name}:{cint(docstatus)}:{_plain_text(status)[:80]}"


_SEEN_DEFKEY = "dac_seen_notifications"

# One event can hold a key per tab, so this sits well above the number of
# notifications a user actually works through.
_SEEN_MAX = 6000


def _load_seen_dict():
    """This user's seen marks. Keys predating the tab|... format are dropped."""
    import json
    val_str = frappe.db.get_value(
        "DefaultValue", {"parent": frappe.session.user, "defkey": _SEEN_DEFKEY}, "defvalue")
    if not val_str:
        return {}
    try:
        stored = json.loads(val_str)
    except Exception:
        return {}
    # Legacy "doctype:name" keys can never match a tab-scoped lookup again, so
    # they are dead weight — drop them the next time this user is written.
    return {k: v for k, v in stored.items() if "|" in k}


def _save_seen_dict(seen_dict):
    import json
    if len(seen_dict) > _SEEN_MAX:
        for k in list(seen_dict.keys())[:-_SEEN_MAX]:
            seen_dict.pop(k, None)

    val_json = json.dumps(seen_dict)
    name = frappe.db.get_value(
        "DefaultValue", {"parent": frappe.session.user, "defkey": _SEEN_DEFKEY}, "name")
    if name:
        frappe.db.set_value("DefaultValue", name, "defvalue", val_json)
    else:
        frappe.get_doc({
            "doctype": "DefaultValue",
            "parent": frappe.session.user,
            "parenttype": "User",
            "parentfield": "defaults",
            "defkey": _SEEN_DEFKEY,
            "defvalue": val_json,
        }).insert(ignore_permissions=True)
    frappe.db.commit()


def _comment_importance(content):
    """(is_important, plain text) for a Sales Order comment.

    Every comment on a Sales Order is a real, human-authored action and must
    notify — it is never a routine re-save the way a plain draft "save" is.
    """
    text = _plain_text(content)
    return True, text


def _event_importance(ev):
    """
    (is_important, short label) for one event row.

    Important means a document was created, submitted or cancelled, an
    approval decision was taken, or a comment was left. The one exception is a
    plain Sales Order draft with no live approval state — that is a routine
    re-save, not activity worth a notification.
    """
    dt = ev.get("doctype")
    ds = cint(ev.get("docstatus"))
    status = str(ev.get("status") or "")
    st = status.lower()

    if dt == "Comment":
        important, text = _comment_importance(status)
        return important, (text[:160] or "Comment")

    if dt == "Uniform Embroidery Transfer":
        # Not a submittable doctype — docstatus is always 0 and the whole
        # lifecycle lives in `status`, so the draft/submitted wording below
        # would be meaningless here.
        if "receiv" in st:
            return True, "Embroidery transfer received back"
        return True, "Plain stock sent to embroidery"

    if dt == "Sales Order":
        if ds == 2:
            return True, "Sales Order cancelled"
        if ds == 1:
            # `status` here is the workflow state, which sits at "Approved" for
            # the rest of a submitted order's life. so_status is the fulfilment
            # status that actually keeps moving.
            fulfilment = str(ev.get("so_status") or "").lower()
            if fulfilment == "completed":
                return True, "Order completed"
            if fulfilment == "closed":
                return True, "Order closed"
            if fulfilment == "on hold":
                return True, "Order on hold"
            if fulfilment == "to bill":
                return True, "Delivered — to be invoiced"
            if fulfilment == "to deliver":
                return True, "Invoiced — to be delivered"
            return True, "Sales Order approved"
        # Creating the order is itself the milestone the Approval tab exists
        # to show — it must notify the moment it happens, not only once it
        # reaches a specific approval state. This mirrors the generic
        # doctype fallback below ("{dt} created (Draft)"): the row is keyed
        # by document name, so this same event is superseded in place once
        # the order is actually submitted for approval, not duplicated.
        return True, status or "Draft"

    if ds == 2:
        return True, f"{dt} cancelled"

    if ds == 1:
        label = _SUBMITTED_LABELS.get(dt, f"{dt} submitted")
        # Compare the whole status, never a substring: "Unpaid" contains "paid"
        # and "Partially Ordered" contains "ordered", so `in` silently inverts
        # the meaning of the milestone.
        if dt in ("Sales Invoice", "Purchase Invoice"):
            if st == "paid":
                label = f"{dt} paid"
            elif st in ("partly paid", "partly paid and discounted"):
                label = f"{dt} part-paid"
            elif st in ("overdue", "overdue and discounted"):
                label = f"{dt} overdue"
        elif dt == "Purchase Order":
            if st == "completed":
                label = "Purchase Order completed"
            elif st == "closed":
                label = "Purchase Order closed"
            elif st == "to bill":
                label = "Purchase Order fully received"
            elif st == "on hold":
                label = "Purchase Order on hold"
        elif dt == "Material Request":
            if st == "stopped":
                label = "Material Request stopped"
            elif st == "partially ordered":
                label = "Material Request partly ordered"
            elif st == "ordered":
                label = "Material Request fully ordered"
            elif st == "received":
                label = "Material Request received"
        return True, label

    # Draft — created but not yet submitted. Still a real, human-initiated
    # action (raising an MR, opening a PO) that the relevant tab should
    # surface; it simply gets superseded by this same document's own
    # "submitted"/"cancelled" milestone once that happens.
    return True, f"{dt} created (Draft)"


def is_merchandiser_user(user=None):
    """
    True only for someone who actually owns customer relationships.

    A bare `"Merchandiser User" in frappe.get_roles()` is NOT this test.
    Administrator implicitly holds every role in the system, so that check
    passes for admins too, and a System Manager is an operator rather than a
    merchandiser. Both must answer False here.

    This gates who may become a Customer's `custom_merchandiser_user`. Getting
    it wrong is not cosmetic: that field drives the Customer and Sales Order
    permission rules, so writing an admin into it silently narrows the customer
    to that admin. Anything that assigns merchandiser ownership must use this.
    """
    roles = frappe.get_roles(user or frappe.session.user)
    return (
        "Merchandiser User" in roles
        and "System Manager" not in roles
        and "Administrator" not in roles
    )


def claim_customer_merchandiser(customer, user=None):
    """
    Give an unowned Customer to `user` as its merchandiser, if that is allowed.

    Two guards, both deliberate:
      * only a real merchandiser may claim (see is_merchandiser_user) — an admin
        approving an order must never become the customer's merchandiser;
      * an existing merchandiser is never overwritten, so approving someone
        else's customer does not steal it from them.

    Returns True only when the field was actually written.
    """
    user = user or frappe.session.user
    if not customer or not is_merchandiser_user(user):
        return False
    if frappe.db.get_value("Customer", customer, "custom_merchandiser_user"):
        return False
    frappe.db.set_value("Customer", customer, "custom_merchandiser_user", user)
    return True


def _user_context():
    """Everything the relevance rules need about the session user, read once."""
    roles = frappe.get_roles()
    user = frappe.session.user
    is_admin = "System Manager" in roles or user == "Administrator"

    final_users = []
    try:
        settings = frappe.get_doc("Admin Settings")
        final_users = [d.user for d in (settings.get("sales_order_final_approval") or []) if d.user]
    except Exception:
        frappe.log_error(title="Order Flow: could not read final approvers",
                         message=frappe.get_traceback())

    return {
        "user": user,
        "is_admin": is_admin,
        "is_merchandiser": "Merchandiser User" in roles,
        "is_final_approver": bool(is_admin or user in final_users),
    }


def _event_relevance(ev, ctx):
    """
    Whether — and why — this event belongs to the session user.

    for_me         the user is responsible for this order
    is_own_action  the user performed it themselves, so it is not news to them
    action_needed  the order is parked waiting on this user
    """
    user = ctx["user"]
    own = 1 if ev.get("owner") == user else 0
    merch = ev.get("so_merchandiser")
    ws = ev.get("so_workflow_state") or ""
    dt = ev.get("doctype")

    reasons = []
    action = 0

    if merch and merch == user:
        reasons.append(_("You are the merchandiser for this customer"))
    if ev.get("so_owner") == user:
        reasons.append(_("You created this Sales Order"))
    if dt == "Comment" and f'data-id="{user}"' in str(ev.get("status") or ""):
        reasons.insert(0, _("You were mentioned in this comment"))
        action = 1

    if dt == "Sales Order" and cint(ev.get("docstatus")) == 0:
        if ws == "Pending Final Approval" and ctx["is_final_approver"]:
            reasons.insert(0, _("Waiting for your final approval"))
            action = 1
        elif ws in ("Pending Merchandiser Approval", "Draft", "") and ctx["is_merchandiser"] \
                and (not merch or merch == user):
            reasons.insert(0, _("Waiting for your merchandiser approval"))
            action = 1
        elif ws == "Rejected" and (ev.get("so_owner") == user or (merch and merch == user)):
            reasons.insert(0, _("Rejected — needs your correction"))
            action = 1

    # "for_me" is about ownership of the order (I'm the merchandiser / creator /
    # approver), not about who happened to click submit. A merchandiser running
    # a customer end-to-end still needs their own past actions to count as their
    # own orders — is_own_action only mutes the styling, it never drops the row
    # from "for me", or a single-operator account would see an empty stream.
    for_me = 1 if reasons else 0

    return {
        "for_me": for_me,
        "is_own_action": own,
        "action_needed": action,
        "relevance_reason": reasons[0] if reasons else "",
    }


# NOTE: merchandiser scoping applies to the SO Approvals tab (handled inline in
# get_pending_approvals()) and to the Sales Tracker tab (handled inline in
# get_sales_tracker(), via order_flow_permissions.is_scoped_to_own_customers)
# — a user whose ONLY reason for tracker access is Merchandiser User sees only
# their own customers' orders there, since that role's job is per-customer,
# not company-wide. Someone who ALSO holds a broader tracker-granting role
# (Production Manager, Accounts Executive, ...) keeps the full picture.
# Purchase Flow, Job Work & Embroidery, and Accounts remain intentionally
# unscoped regardless of role combination.


# --------------------------------------------------------------------------
# Tab 1 — Sales Order tracker + activity
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_sales_tracker(days=120, search=None, scope="open", stage_filter=None, merchandiser=None, approval_stage=None):
    """
    Sales Orders ordered by most recent downstream activity, with exact stage & next action.
    """
    _guard()
    _guard_tab("tracker")
    from_date = _from_date(days)

    if approval_stage in ("Draft", "Pending Merchandiser Approval", "Pending Final Approval", "Rejected"):
        conditions = ["so.docstatus = 0", "so.transaction_date >= %(from_date)s"]
    elif approval_stage:
        conditions = ["so.docstatus = 1", "so.transaction_date >= %(from_date)s"]
    else:
        # Sales Tracker shows only approved/submitted Sales Orders — drafts and
        # pending-approval orders belong in the SO Approvals tab.
        conditions = ["so.docstatus = 1", "so.transaction_date >= %(from_date)s"]
    conditions.append(_NOT_DISABLED_SO)
    params = {"from_date": from_date}

    if approval_stage:
        if approval_stage == "Draft":
            conditions.append("(so.workflow_state = 'Draft' OR so.workflow_state IS NULL OR so.workflow_state = '')")
        else:
            conditions.append("so.workflow_state = %(approval_stage)s")
            params["approval_stage"] = approval_stage

    if stage_filter == "completed":
        # Force completed orders to show even under 'open' scope
        pass
    elif scope == "open":
        conditions.append("so.status NOT IN ('Closed', 'Completed', 'Cancelled')")
    
    if scope == "mine":
        conditions.append("so.owner = %(me)s")
        params["me"] = frappe.session.user

    if search:
        conditions.append("(so.name LIKE %(q)s OR so.customer_name LIKE %(q)s OR so.customer LIKE %(q)s)")
        params["q"] = f"%{search}%"

    # An explicit "view as this merchandiser" pick from the tracker's own
    # filter dropdown — distinct from is_scoped_to_own_customers below, which
    # forces a plain Merchandiser User to their own customers regardless of
    # this argument. Only an admin/final-approver can even see this dropdown
    # (see update_merchandiser_visibility in order_flow.js), so the two never
    # fight over the same condition.
    if merchandiser:
        conditions.append("cust.custom_merchandiser_user = %(merchandiser)s")
        params["merchandiser"] = merchandiser

    # A user whose ONLY reason for seeing this tab is Merchandiser User (no
    # other tracker-granting role held) uses it to answer "where is MY order",
    # not to browse the whole company's order book — scope to the customers
    # assigned to them. Someone who ALSO holds a broader role (Production
    # Manager, Accounts Executive, ...) keeps the full, unscoped picture, since
    # that role's own reason for tracker access is company-wide visibility.
    # See is_scoped_to_own_customers's docstring — this is the same function
    # get_order_flow_permissions() uses for tracker_scoped_to_own_customers,
    # so the client's button-hiding can never disagree with what rows the
    # server actually returns.
    if is_scoped_to_own_customers("tracker"):
        conditions.append("cust.custom_merchandiser_user = %(merch_scope)s")
        params["merch_scope"] = frappe.session.user

    orders = frappe.db.sql(f"""
        SELECT so.name, so.customer, so.customer_name, so.transaction_date, so.delivery_date,
               so.status, so.grand_total, so.currency, so.per_delivered, so.per_billed,
               so.owner, so.modified, so.skip_delivery_note, so.docstatus,
               cust.custom_merchandiser_user, mu.full_name AS custom_merchandiser_name
        FROM `tabSales Order` so
        LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
        LEFT JOIN `tabUser` mu ON mu.name = cust.custom_merchandiser_user
        WHERE {' AND '.join(conditions)}
        ORDER BY so.transaction_date DESC
        LIMIT 300
    """, params, as_dict=1)

    if not orders:
        return []

    names = [o.name for o in orders]
    by_name = {o.name: o for o in orders}
    for o in orders:
        o["counts"] = {}
        o["pick_lists"] = []
        o["draft_pick_lists"] = []
        o["submitted_pick_lists"] = []
        o["pos"] = []
        o["open_pos"] = []
        o["receipts"] = []
        o["draft_receipts"] = []
        o["submitted_receipts"] = []
        o["mrs"] = []
        o["jobworks"] = []
        o["embroidery_orders"] = []
        o["invoices"] = []
        o["draft_invoices"] = []
        o["delivery_notes"] = []
        # Raw-material-tier procurement (an MR/PO/Receipt for a BOM component,
        # not the SO's own sold item) — tracked separately so it can be shown
        # as its own pipeline without ever driving the main stage/action below.
        # See is_rm_tier in _EVENT_SQL: true only when every item on that
        # document has no sales_order_item, i.e. it was never mapped from a
        # Sales Order Item row (so_make_rm_material_request never sets it;
        # the standard "Raise MR from SO" / subcontract-PO flows always do).
        o["rm_counts"] = {}
        o["rm_mrs"] = []
        o["rm_pos"] = []
        o["rm_open_pos"] = []
        o["rm_receipts"] = []
        # Submitted Sales Invoices carrying "Update Stock". On a Direct Bill
        # order the goods leave on the invoice, so these — not Delivery Notes —
        # are the documents that delivered the order.
        o["stock_invoices"] = []
        o["last_event"] = None
        o["last_event_on"] = None
        o["last_event_doc"] = None
        o["last_event_label"] = None
        o["last_event_important"] = 0
        o["_minor_event"] = None

    # Which invoices actually moved stock. ERPNext posts the delivery straight
    # from a Sales Invoice when "Update Stock" is ticked (it maintains
    # delivered_qty / per_delivered exactly as a Delivery Note would), so on a
    # Direct Bill order these are the delivering documents and there is no DN to
    # point at.
    for r in frappe.db.sql("""
        SELECT DISTINCT sii.sales_order, si.name
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON si.name = sii.parent
        WHERE si.docstatus = 1 AND IFNULL(si.update_stock, 0) = 1
          AND sii.sales_order IN %(names)s
    """, {"names": tuple(names)}, as_dict=1):
        row = by_name.get(r.sales_order)
        if row and r.name not in row["stock_invoices"]:
            row["stock_invoices"].append(r.name)

    # Whether this order's own items are made-to-order (a bom_no on the Sales
    # Order Item, produced via Subcontract PO) or plain trade items (bought
    # via a Material Request) — the "Newly Created" fallback stage below needs
    # this to word its action correctly. A Sales Order full of BOM items has
    # no Material Request step at all in this company's flow (see the
    # per-item widget's own so_buy_btn: is_bom_item always routes to
    # "Subcontract PO", never "Material Request"), so defaulting every such
    # order's first action to "Raise MR from SO" was simply wrong for it.
    for r in frappe.db.sql("""
        SELECT parent AS sales_order, COUNT(*) AS item_count,
               SUM(CASE WHEN bom_no IS NOT NULL AND bom_no != '' THEN 1 ELSE 0 END) AS bom_item_count
        FROM `tabSales Order Item`
        WHERE parent IN %(names)s
        GROUP BY parent
    """, {"names": tuple(names)}, as_dict=1):
        row = by_name.get(r.sales_order)
        if not row:
            continue
        item_count = cint(r.item_count)
        bom_item_count = cint(r.bom_item_count)
        row["has_bom_items"] = bom_item_count > 0
        row["all_bom_items"] = item_count > 0 and bom_item_count == item_count

    # Roll every linked document up to its Sales Order in one pass.
    events = frappe.db.sql(f"""
        SELECT sales_order, doctype, name, ts, status, docstatus, is_rm_tier
        FROM ({_EVENT_SQL}) ev
        WHERE ev.sales_order IN %(names)s
        ORDER BY ts DESC
    """, {"names": tuple(names)}, as_dict=1)

    for ev in events:
        row = by_name.get(ev.sales_order)
        if not row:
            continue
        dt = ev.doctype
        ds = ev.docstatus
        # True only for a Material Request / Purchase Order / Receipt raised for
        # a BOM raw material (see is_rm_tier in _EVENT_SQL) — never for the SO's
        # own sold item. Kept out of row["counts"]/mrs/pos/receipts entirely so
        # it can never reach _compute_stage_info and flip the order's main
        # Current Stage / Action Required; it is rolled up into the rm_* lists
        # below instead, for its own "RM Pipeline" indicator on the tracker row.
        is_rm = bool(ev.get("is_rm_tier")) and dt in (
            "Material Request", "Purchase Order", "Purchase Receipt", "Subcontracting Receipt")

        # A cancelled document is not live progress — it must still surface as
        # the order's last activity (below) but must never count toward doc-flow
        # tallies or stage computation, or a cancelled PO/MR/Receipt would make
        # an order look further along than it actually is.
        if ds != 2:
            if is_rm:
                row["rm_counts"][dt] = row["rm_counts"].get(dt, 0) + 1
            else:
                row["counts"][dt] = row["counts"].get(dt, 0) + 1

            if dt == "Pick List":
                if ev.name not in row["pick_lists"]:
                    row["pick_lists"].append(ev.name)
                if ds == 0:
                    if ev.name not in row["draft_pick_lists"]:
                        row["draft_pick_lists"].append(ev.name)
                elif ds == 1:
                    if ev.name not in row["submitted_pick_lists"]:
                        row["submitted_pick_lists"].append(ev.name)
            elif dt == "Purchase Order":
                if is_rm:
                    if ev.name not in row["rm_pos"]:
                        row["rm_pos"].append(ev.name)
                    if ds == 1 and ev.name not in row["rm_open_pos"]:
                        row["rm_open_pos"].append(ev.name)
                else:
                    if ev.name not in row["pos"]:
                        row["pos"].append(ev.name)
                    if ds == 1 and ev.name not in row["open_pos"]:
                        row["open_pos"].append(ev.name)
            elif dt in ("Purchase Receipt", "Subcontracting Receipt"):
                receipt_obj = {"name": ev.name, "doctype": ev.doctype}
                if is_rm:
                    if receipt_obj not in row["rm_receipts"]:
                        row["rm_receipts"].append(receipt_obj)
                    # RM-tier receipts only ever feed the separate RM Pipeline
                    # indicator, never stage computation — draft/submitted
                    # distinction is irrelevant there, so it isn't tracked.
                else:
                    if receipt_obj not in row["receipts"]:
                        row["receipts"].append(receipt_obj)
                    # A draft Receipt has posted nothing to the stock ledger yet —
                    # only a submitted one actually brings stock in. Tracked
                    # separately so _compute_stage_info never calls stock
                    # "Arrived" off a document that hasn't moved anything.
                    if ds == 1:
                        if receipt_obj not in row["submitted_receipts"]:
                            row["submitted_receipts"].append(receipt_obj)
                    elif ds == 0:
                        if receipt_obj not in row["draft_receipts"]:
                            row["draft_receipts"].append(receipt_obj)
            elif dt == "Material Request":
                if is_rm:
                    if ev.name not in row["rm_mrs"]:
                        row["rm_mrs"].append(ev.name)
                else:
                    if ev.name not in row["mrs"]:
                        row["mrs"].append(ev.name)
            elif dt == "Job Work (Subcontract)":
                # ev.name is the Purchase Order, not the Subcontracting Order.
                job_obj = {"name": ev.name, "doctype": "Purchase Order"}
                if job_obj not in row["jobworks"]:
                    row["jobworks"].append(job_obj)
            elif dt == "Embroidery Work Order":
                # ev.name is the Purchase Order, not the Embroidery Work Order.
                job_obj = {"name": ev.name, "doctype": "Purchase Order"}
                if job_obj not in row["embroidery_orders"]:
                    row["embroidery_orders"].append(job_obj)
                if job_obj not in row["jobworks"]:
                    row["jobworks"].append(job_obj)
            elif dt == "Sales Invoice":
                if ev.name not in row["invoices"]:
                    row["invoices"].append(ev.name)
                if ds == 0 and ev.name not in row["draft_invoices"]:
                    row["draft_invoices"].append(ev.name)
            elif dt == "Delivery Note":
                if ev.name not in row["delivery_notes"]:
                    row["delivery_notes"].append(ev.name)

        # "Last Activity" is a milestone column, not a change log: events arrive
        # newest first, so the first important one is the one worth showing. A
        # minor event is kept only as a fallback for orders that have none yet.
        # The event's own status is the workflow state; _event_importance needs
        # the order's fulfilment status to label a submitted order correctly.
        if dt == "Sales Order":
            ev["so_status"] = row.get("status")
        important, label = _event_importance(ev)
        if important:
            if not row["last_event_on"]:
                row["last_event_on"] = ev.ts
                row["last_event"] = dt
                row["last_event_doc"] = ev.name
                row["last_event_label"] = label
                row["last_event_important"] = 1
        elif not row["_minor_event"]:
            row["_minor_event"] = {"ts": ev.ts, "doctype": dt, "name": ev.name, "label": label}

    for o in orders:
        minor = o.pop("_minor_event", None)
        if not o["last_event_on"] and minor:
            o["last_event_on"] = minor["ts"]
            o["last_event"] = minor["doctype"]
            o["last_event_doc"] = minor["name"]
            o["last_event_label"] = minor["label"]
            o["last_event_important"] = 0

    # Orders with fresh activity first; then by order date.
    orders.sort(key=lambda r: (r.get("last_event_on") or r.get("modified") or ""), reverse=True)

    filtered_orders = []
    for o in orders:
        stage_info = _compute_stage_info(o)
        o["stage"] = stage_info
        if stage_filter and stage_filter != "all":
            if stage_filter == "overdue" and not o.get("is_overdue"):
                continue
            elif stage_filter != "overdue" and stage_info.get("stage_key") != stage_filter:
                continue
        filtered_orders.append(o)

    return filtered_orders


def _compute_stage_info(order):
    """
    Computes exact workflow stage & required action for a Sales Order.
    """
    if order.get("docstatus") == 0:
        return {
            "stage_key": "draft",
            "stage_label": "Draft SO (Awaiting Approval)",
            "badge_class": "of-pill--draft",
            "icon": "clock-o",
            "action_type": "open_doc",
            "target_doc": order["name"],
            "target_doctype": "Sales Order",
            "action_label": "Approve Sales Order",
            "action_btn_class": "of-btn--warning"
        }

    delivered = flt(order.get("per_delivered"))
    billed = flt(order.get("per_billed"))
    draft_pls = order.get("draft_pick_lists") or []
    subm_pls = order.get("submitted_pick_lists") or []
    open_pos = order.get("open_pos") or []
    submitted_receipts = order.get("submitted_receipts") or []
    draft_receipts = order.get("draft_receipts") or []
    mrs = order.get("mrs") or []
    jobworks = order.get("jobworks") or []
    embroidery_orders = order.get("embroidery_orders") or []
    draft_invoices = order.get("draft_invoices") or []

    skip_dn = bool(order.get("skip_delivery_note"))
    is_completed = billed >= 100 if skip_dn else (delivered >= 100 and billed >= 100)

    is_overdue = False
    today = nowdate()
    if order.get("delivery_date") and not is_completed:
        if str(order["delivery_date"]) < today:
            is_overdue = True
    order["is_overdue"] = is_overdue

    if is_completed:
        return {
            "stage_key": "completed",
            "stage_label": "Completed",
            "badge_class": "of-pill--ready",
            "icon": "check-circle",
            "action_type": "none",
            "action_label": "Completed",
            "action_btn_class": "of-btn-disabled"
        }

    # If skip_dn, Pick List submitted triggers need_to_bill directly
    is_ready_to_bill = False
    is_fully_picked_or_delivered = False
    if skip_dn:
        # Load so_items to compute picker status
        so_items = frappe.db.get_values(
            "Sales Order Item",
            {"parent": order["name"]},
            ["qty", "delivered_qty", "picked_qty"],
            as_dict=True
        )
        total_qty = sum(flt(i.qty) for i in so_items)
        total_picked_or_delivered = sum(min(flt(i.qty), flt(i.picked_qty) + flt(i.delivered_qty)) for i in so_items)
        is_fully_picked_or_delivered = (total_picked_or_delivered >= total_qty) if total_qty > 0 else False

        if subm_pls or delivered >= 100:
            is_ready_to_bill = True
    else:
        if delivered >= 100:
            is_ready_to_bill = True
            is_fully_picked_or_delivered = True

    if is_ready_to_bill and billed < 100:
        if draft_invoices:
            inv_name = draft_invoices[0]
            return {
                "stage_key": "need_to_bill",
                "stage_label": "Need to Bill" if is_fully_picked_or_delivered else "Need to Bill (Partial)",
                "badge_class": "of-pill--need-bill" if is_fully_picked_or_delivered else "of-pill--warn",
                "icon": "file-text-o",
                "target_doc": inv_name,
                "target_doctype": "Sales Invoice",
                "action_type": "open_doc",
                "action_label": f"Open Draft Invoice ({inv_name})",
                "action_btn_class": "of-btn--warning"
            }
        else:
            return {
                "stage_key": "need_to_bill",
                "stage_label": "Need to Bill" if is_fully_picked_or_delivered else "Need to Bill (Partial)",
                "badge_class": "of-pill--need-bill" if is_fully_picked_or_delivered else "of-pill--warn",
                "icon": "file-text-o",
                "action_type": "make_invoice",
                "action_label": "Create Sales Invoice" if is_fully_picked_or_delivered else "Create Sales Invoice (Partial)",
                "action_btn_class": "of-btn--primary" if is_fully_picked_or_delivered else "of-btn--warning"
            }

    if draft_pls:
        pl_name = draft_pls[0]
        return {
            "stage_key": "draft_pick_list",
            "stage_label": "Draft Pick List",
            "badge_class": "of-pill--draft",
            "icon": "clock-o",
            "target_doc": pl_name,
            "target_doctype": "Pick List",
            "action_type": "open_doc",
            "action_label": f"Submit Pick List ({pl_name})",
            "action_btn_class": "of-btn--warning"
        }

    # For standard flow, if Pick List is submitted, we create Delivery Note
    # OR a Sales Invoice with Update Stock — same either-route choice the
    # Sales Order's own "Item Stock & Action Plan" widget already offers
    # per item (so_prompt_dn_or_si). Once this order has committed to one
    # route (a submitted DN, or a submitted SI with Update Stock already
    # exists), the button collapses to that single route instead of asking
    # again — mirroring guard_so_fulfillment_route_lock, which would reject
    # the other route at submit time anyway.
    if subm_pls and not skip_dn:
        pl_name = subm_pls[0]
        so_items = frappe.db.get_values(
            "Sales Order Item",
            {"parent": order["name"]},
            ["qty", "delivered_qty", "picked_qty"],
            as_dict=True
        )
        total_qty = sum(flt(i.qty) for i in so_items)
        total_picked_or_delivered = sum(min(flt(i.qty), flt(i.picked_qty) + flt(i.delivered_qty)) for i in so_items)
        is_fully_picked = (total_picked_or_delivered >= total_qty) if total_qty > 0 else False

        route_lock = ""
        if _so_has_submitted_dn(order["name"]):
            route_lock = "dn"
        elif _so_has_submitted_stock_si(order["name"]):
            route_lock = "si"

        if route_lock == "si":
            label = "Create Sales Invoice (Update Stock)" if is_fully_picked else "Create Sales Invoice (Update Stock, Partial)"
            icon = "file-text-o"
        else:
            label = "Create DN / SI" if not route_lock else "Create Delivery Note"
            if not is_fully_picked:
                label += " (Partial)"
            icon = "truck"

        if is_fully_picked:
            return {
                "stage_key": "ready_to_deliver",
                "stage_label": "Ready for Delivery",
                "badge_class": "of-pill--dn",
                "icon": icon,
                "target_doc": pl_name,
                "target_doctype": "Pick List",
                "action_type": "make_dn_or_si",
                "action_label": label,
                "action_btn_class": "of-btn--success",
                "route_lock": route_lock
            }
        else:
            return {
                "stage_key": "ready_to_deliver",
                "stage_label": "Partially Ready for Delivery",
                "badge_class": "of-pill--warn",
                "icon": icon,
                "target_doc": pl_name,
                "target_doctype": "Pick List",
                "action_type": "make_dn_or_si",
                "action_label": label,
                "action_btn_class": "of-btn--warning",
                "route_lock": route_lock
            }

    # A Purchase/Subcontracting Receipt only posts to the stock ledger on
    # submit — a draft one has moved nothing yet, so it must never read as
    # "Stock Arrived". Checked first so a submitted receipt still wins even
    # if an unrelated draft receipt also exists on the same order.
    if submitted_receipts:
        return {
            "stage_key": "stock_received",
            "stage_label": "Stock Arrived (PL Needed)",
            "badge_class": "of-pill--ready",
            "icon": "inbox",
            "action_type": "make_picklist",
            "action_label": "Create Pick List",
            "action_btn_class": "of-btn--primary"
        }

    if draft_receipts:
        rcpt = draft_receipts[0]
        return {
            "stage_key": "receipt_draft",
            "stage_label": "Receiving Stock (Draft PR)",
            "badge_class": "of-pill--draft",
            "icon": "inbox",
            "target_doc": rcpt["name"],
            "target_doctype": rcpt["doctype"],
            "action_type": "open_doc",
            "action_label": f"Submit Receipt ({rcpt['name']})",
            "action_btn_class": "of-btn--warning"
        }

    if embroidery_orders:
        # These are {"name": <Purchase Order>, "doctype": "Purchase Order"}
        # dicts, not plain names — see get_sales_tracker's event loop, where
        # ev.name is the Purchase Order that raised the Embroidery Work
        # Order, never the EWO itself. Interpolating the dict directly used
        # to print its Python repr straight into the action label.
        ewo = embroidery_orders[0]
        ewo_name = ewo.get("name") if isinstance(ewo, dict) else ewo
        ewo_doctype = ewo.get("doctype") if isinstance(ewo, dict) else "Purchase Order"
        return {
            "stage_key": "in_embroidery",
            "stage_label": "Embroidery",
            "badge_class": "of-pill--planned",
            "icon": "magic",
            "target_doc": ewo_name,
            "target_doctype": ewo_doctype,
            "action_type": "open_doc",
            "action_label": f"Track Embroidery ({ewo_name})",
            "action_btn_class": "of-btn--info"
        }

    if jobworks:
        # Same shape as embroidery_orders above — {"name": <Purchase Order>,
        # "doctype": "Purchase Order"}.
        jw = jobworks[0]
        jw_name = jw.get("name") if isinstance(jw, dict) else jw
        jw_doctype = jw.get("doctype") if isinstance(jw, dict) else "Purchase Order"
        return {
            "stage_key": "in_jobwork",
            "stage_label": "In Job Work",
            "badge_class": "of-pill--planned",
            "icon": "cogs",
            "target_doc": jw_name,
            "target_doctype": jw_doctype,
            "action_type": "open_doc",
            "action_label": f"Track Job Work ({jw_name})",
            "action_btn_class": "of-btn--info"
        }

    if open_pos:
        po_name = open_pos[0]
        return {
            "stage_key": "awaiting_stock",
            "stage_label": "PO Raised (Awaiting Stock)",
            "badge_class": "of-pill--wait",
            "icon": "shopping-cart",
            "target_doc": po_name,
            "target_doctype": "Purchase Order",
            "action_type": "open_doc",
            "action_label": f"Track PO ({po_name})",
            "action_btn_class": "of-btn--info"
        }

    if mrs:
        mr_name = mrs[0]
        return {
            "stage_key": "mr_raised",
            "stage_label": "MR Raised",
            "badge_class": "of-pill--warn",
            "icon": "file-text-o",
            "target_doc": mr_name,
            "target_doctype": "Material Request",
            "action_type": "make_po_from_mr",
            "action_label": f"Order from MR ({mr_name})",
            "action_btn_class": "of-btn--primary"
        }

    # "Raise MR from SO" only makes sense for a plain trade item — a BOM item
    # is produced via Subcontract PO, with no Material Request step at all
    # (see so_buy_btn on the Sales Order widget). Word the action to match
    # what this order's own items actually need, not a one-size label that
    # was wrong for every made-to-order line.
    all_bom = bool(order.get("all_bom_items"))
    has_bom = bool(order.get("has_bom_items"))
    if all_bom:
        action_label = "Create Subcontract PO"
    elif has_bom:
        action_label = "Raise MR / Subcontract PO"
    else:
        action_label = "Raise MR from SO"

    # Calling this "Create Subcontract PO" would be a lie if the raw material
    # for it isn't physically in stock — the SO's own widget (so_buy_btn) and
    # the backend (make_subcontract_purchase_order) both hard-block that PO,
    # so the label here must say so too instead of sending the user to a dead
    # end. Only worth checking for orders with a BOM item that could actually
    # reach this branch (see _has_bom_rm_shortage's own docstring for why the
    # "newly_created" state makes the qty math simple here).
    if has_bom and _has_bom_rm_shortage(order["name"]):
        return {
            "stage_key": "newly_created",
            "stage_label": "Newly Created — RM Shortage",
            "badge_class": "of-pill--warn",
            "icon": "exclamation-triangle",
            "action_type": "make_mr",
            "action_label": "RM Not in Stock — Cannot Create PO Yet",
            "action_btn_class": "of-btn--warning"
        }

    return {
        "stage_key": "newly_created",
        "stage_label": "Newly Created",
        "badge_class": "of-pill--new",
        "icon": "star",
        # Still just opens the Sales Order (see the "make_mr" branch client-side)
        # — the per-item widget there already offers the right button
        # (Material Request / Subcontract PO) for each line.
        "action_type": "make_mr",
        "action_label": action_label,
        "action_btn_class": "of-btn--primary"
    }


def _has_bom_rm_shortage(sales_order_name):
    """
    True when at least one BOM item still pending on this Sales Order (qty >
    delivered_qty) has a raw material that is not yet physically in stock —
    see check_bom_raw_materials_in_stock. This is only ever called from the
    "newly_created" branch of _compute_stage_info, which is reached only when
    the order has no MR/PO/pick/receipt anywhere on it yet — so each BOM
    row's own qty - delivered_qty is exactly what's still needed, with no
    further netting against other documents required. Fails open (treats as
    fulfilled) on any lookup error so a bad BOM never breaks the tracker.
    """
    try:
        bom_rows = frappe.db.sql("""
            SELECT item_code, bom_no, qty, delivered_qty
            FROM `tabSales Order Item`
            WHERE parent = %s AND bom_no IS NOT NULL AND bom_no != ''
        """, sales_order_name, as_dict=True)

        bom_cache = {}
        for row in bom_rows:
            qty_needed = flt(row.qty) - flt(row.delivered_qty)
            if qty_needed <= 0:
                continue
            is_fulfilled, _shortages = check_bom_raw_materials_in_stock(row.bom_no, qty_needed, bom_cache)
            if not is_fulfilled:
                return True
        return False
    except Exception:
        frappe.log_error(title="Order Flow: RM shortage check failed",
                          message=frappe.get_traceback())
        return False


@frappe.whitelist()
def get_activity(days=21, limit=80, merchandiser=None, scope="open", search=None):
    """
    The notification stream: what happened to the records the page is showing.

    Scope matters as much as content here. The stream is deliberately held to the
    same Sales Orders the tab tables are filtered to — same `days`, same `scope`,
    same `search` — so a tab never reports activity on orders the operator cannot
    see in front of them. Without that the feed drifts into a firehose of every
    event in the system and stops being readable. The page then narrows it once
    more per tab, to the doctypes that tab actually lists.

    Only milestones are returned (see _event_importance) — a document's creation,
    submission and cancellation each count once, but a plain re-save of an
    already-known draft does not spawn a new row (the underlying query reflects
    each document's current state, not its full revision history).

    `limit` is a per-doctype allowance rather than a global cut, because the page
    fans this single feed out across six tabs and a global cut lets a chatty
    doctype starve a quiet one. The SQL window is wider again so that trimming
    still leaves each doctype its full slice.
    """
    _guard()
    limit = int(limit)
    fetch_limit = min(max(limit * 20, 400), 3000)
    conditions = ["ev.ts >= %(from_date)s"]
    params = {"from_date": _from_date(days), "limit": fetch_limit}

    # Hold the feed to the orders the tables are showing. Events with no Sales
    # Order of their own (embroidery stock transfers) are exempt — they are
    # matched by their tab's doctype list instead.
    so_conditions = ["so2.transaction_date >= %(from_date)s", _NOT_DISABLED_SO2]
    if scope == "open":
        so_conditions.append("so2.status NOT IN ('Closed', 'Completed', 'Cancelled')")
    if search:
        so_conditions.append(
            "(so2.name LIKE %(q)s OR so2.customer_name LIKE %(q)s OR so2.customer LIKE %(q)s)")
        params["q"] = f"%{search}%"

    conditions.append(f"""(
        ev.sales_order IS NULL
        OR ev.sales_order IN (
            SELECT so2.name FROM `tabSales Order` so2
            WHERE {' AND '.join(so_conditions)}
        )
    )""")

    # The dashboard's notification stream is intentionally unscoped for every
    # role — see the note above _event_relevance: merchandiser scoping belongs
    # only to get_pending_approvals() / the SO Approvals tab. Auto-restricting
    # this feed to the session user's own role (as used to happen here) meant a
    # Merchandiser User never saw a PO/MR/Receipt/etc. notification for any
    # customer not explicitly assigned to them — nearly every customer in this
    # system has no merchandiser assigned, so the stream was effectively empty.
    # Only an explicit `merchandiser` argument (an admin viewing "as" a specific
    # merchandiser) narrows it now; the viewer's own role never does.
    if merchandiser:
        conditions.append("""(
            cust.custom_merchandiser_user = %(merchandiser)s
            OR (
                (cust.custom_merchandiser_user IS NULL OR cust.custom_merchandiser_user = '')
                AND ev.doctype = 'Sales Order'
                AND ev.docstatus = 0
            )
        )""")
        params["merchandiser"] = merchandiser
    
    rows = frappe.db.sql(f"""
        SELECT ev.*, so.customer_name, so.status AS so_status, u.full_name AS owner_fullname,
               so.owner AS so_owner, so.workflow_state AS so_workflow_state,
               so.docstatus AS so_docstatus,
               IFNULL(po_sc.is_subcontracted, 0) AS is_subcontracted,
               po_sc.per_received AS po_per_received,
               po_sc.per_billed AS po_per_billed,
               cust.custom_merchandiser_user AS so_merchandiser
        FROM ({_EVENT_SQL}) ev
        LEFT JOIN `tabSales Order` so ON so.name = ev.sales_order
        LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
        LEFT JOIN `tabUser` u ON u.name = ev.owner
        -- A subcontracting Purchase Order is Job Work, not buying: the Purchase
        -- Flow table excludes it, so the Purchase notifications must too.
        LEFT JOIN `tabPurchase Order` po_sc
               ON po_sc.name = ev.name AND ev.doctype = 'Purchase Order'
        WHERE {' AND '.join(conditions)}
        ORDER BY ev.ts DESC
        LIMIT %(limit)s
    """, params, as_dict=1)

    # This user's own seen marks, keyed per tab and per milestone — see _seen_key.
    seen_dict = _load_seen_dict()

    # Keep only real milestones, annotate seen status and what this means for
    # the session user.
    ctx = _user_context()
    important_rows = []
    for row in rows:
        important, label = _event_importance(row)
        if not important:
            continue

        # Seen is per tab, so the row carries the set of tabs it has been
        # cleared on rather than one flat flag.
        row["seen_tabs"] = {
            t: 1 for t in _ACTIVITY_TABS
            if _seen_key(t, row.get("doctype"), row.get("name"),
                         row.get("docstatus"), row.get("status")) in seen_dict
        }
        row["is_important"] = 1
        row["event_label"] = label
        row.update(_event_relevance(row, ctx))
        important_rows.append(row)

    # The page splits this one feed across six tabs, so a single global cut
    # would let a chatty doctype bury a quiet one: 26 comments and 9 draft
    # orders are enough to push every Job Work and Invoice event past a
    # limit of 60, leaving those tabs looking idle while work is happening.
    # Give each doctype its own newest slice instead, then cap the whole
    # payload so the response stays small.
    per_doctype = {}
    balanced = []
    for row in important_rows:                      # already newest-first
        dt = row.get("doctype")
        taken = per_doctype.get(dt, 0)
        if taken >= limit:
            continue
        per_doctype[dt] = taken + 1
        balanced.append(row)

    return balanced[: limit * 6]


# --------------------------------------------------------------------------
# Tab 2 — Purchase flow
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_purchase_flow(days=120, search=None, scope="open", merchandiser=None):
    """Purchase Orders with their receipt progress, tied back to the Sales Order."""
    _guard()
    _guard_tab("purchase")
    conditions = ["po.docstatus < 2", "po.transaction_date >= %(from_date)s", "IFNULL(po.is_subcontracted, 0) = 0", _NOT_DISABLED_SO]
    params = {"from_date": _from_date(days)}

    if scope == "open":
        conditions.append("po.status NOT IN ('Closed', 'Completed', 'Cancelled')")
        conditions.append("(poi.sales_order IS NULL OR poi.sales_order = '' OR so.status NOT IN ('Closed', 'Completed', 'Cancelled'))")
    elif scope == "mine":
        conditions.append("po.owner = %(me)s")
        params["me"] = frappe.session.user

    if search:
        conditions.append("""(po.name LIKE %(q)s OR po.supplier LIKE %(q)s
                              OR sup.supplier_name LIKE %(q)s OR poi.sales_order LIKE %(q)s
                              OR poi.item_code LIKE %(q)s)""")
        params["q"] = f"%{search}%"


    purchase_orders = frappe.db.sql(f"""
        SELECT po.name, po.transaction_date, po.schedule_date, po.status, po.docstatus,
               po.supplier, sup.supplier_name, po.is_subcontracted, po.currency,
               po.per_received, po.per_billed, po.grand_total,
               GROUP_CONCAT(DISTINCT poi.sales_order ORDER BY poi.sales_order SEPARATOR ', ') AS sales_orders,
               GROUP_CONCAT(DISTINCT so.customer_name ORDER BY so.customer_name SEPARATOR ', ') AS so_customer_names,
               COUNT(DISTINCT poi.item_code) AS item_count,
               SUM(CASE WHEN po.is_subcontracted = 1 THEN poi.fg_item_qty ELSE poi.qty END) AS qty,
               SUM(poi.received_qty) AS received_qty
        FROM `tabPurchase Order Item` poi
        JOIN `tabPurchase Order` po ON po.name = poi.parent
        LEFT JOIN `tabSupplier` sup ON sup.name = po.supplier
        LEFT JOIN `tabSales Order` so ON so.name = poi.sales_order
        LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
        WHERE {' AND '.join(conditions)}
        GROUP BY po.name, po.transaction_date, po.schedule_date, po.status, po.docstatus,
                 po.supplier, sup.supplier_name, po.is_subcontracted, po.currency,
                 po.per_received, po.per_billed, po.grand_total
        ORDER BY po.transaction_date DESC, po.name DESC
        LIMIT 300
    """, params, as_dict=1)

    mr_conditions = ["mr.docstatus < 2", "mr.transaction_date >= %(from_date)s", _NOT_DISABLED_SO]
    if scope == "open":
        mr_conditions.append("mr.status NOT IN ('Received', 'Stopped', 'Cancelled')")
        mr_conditions.append("(mri.sales_order IS NULL OR mri.sales_order = '' OR so.status NOT IN ('Closed', 'Completed', 'Cancelled'))")
    elif scope == "mine":
        mr_conditions.append("mr.owner = %(me)s")
    if search:
        mr_conditions.append("(mr.name LIKE %(q)s OR mri.sales_order LIKE %(q)s OR mri.item_code LIKE %(q)s)")


    pr_conditions = ["pr.docstatus < 2", "pr.posting_date >= %(from_date)s", "IFNULL(pr.is_subcontracted, 0) = 0", _NOT_DISABLED_SO]
    scr_conditions = ["scr.docstatus < 2", "scr.posting_date >= %(from_date)s", _NOT_DISABLED_SO]
    if scope == "open":
        pr_conditions.append("pr.status NOT IN ('Completed', 'Cancelled')")
        pr_conditions.append("(pri.sales_order IS NULL OR pri.sales_order = '' OR so.status NOT IN ('Closed', 'Completed', 'Cancelled'))")
        scr_conditions.append("scr.status NOT IN ('Completed', 'Cancelled')")
        scr_conditions.append("(poi.sales_order IS NULL OR poi.sales_order = '' OR so.status NOT IN ('Closed', 'Completed', 'Cancelled'))")
    elif scope == "mine":
        pr_conditions.append("pr.owner = %(me)s")
        scr_conditions.append("scr.owner = %(me)s")
    if search:
        pr_conditions.append("(pr.name LIKE %(q)s OR pr.supplier LIKE %(q)s OR sup.supplier_name LIKE %(q)s)")
        scr_conditions.append("(scr.name LIKE %(q)s OR scr.supplier LIKE %(q)s OR sup.supplier_name LIKE %(q)s)")


    receipts = frappe.db.sql(f"""
        (SELECT 'Purchase Receipt' AS doctype, pr.name, pr.posting_date, pr.status, pr.docstatus,
                pr.supplier, sup.supplier_name, pr.is_subcontracted, pr.currency, pr.grand_total,
                GROUP_CONCAT(DISTINCT pri.sales_order ORDER BY pri.sales_order SEPARATOR ', ') AS sales_orders,
                GROUP_CONCAT(DISTINCT so.customer_name ORDER BY so.customer_name SEPARATOR ', ') AS so_customer_names,
                GROUP_CONCAT(DISTINCT pri.purchase_order ORDER BY pri.purchase_order SEPARATOR ', ') AS purchase_orders,
                SUM(pri.received_qty) AS qty, NULL AS linked_pr
         FROM `tabPurchase Receipt Item` pri
         JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
         LEFT JOIN `tabSupplier` sup ON sup.name = pr.supplier
         LEFT JOIN `tabSales Order` so ON so.name = pri.sales_order
         LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
         WHERE {' AND '.join(pr_conditions)}
         GROUP BY pr.name, pr.posting_date, pr.status, pr.docstatus, pr.supplier,
                  sup.supplier_name, pr.is_subcontracted, pr.currency, pr.grand_total)

        UNION ALL

        (SELECT 'Subcontracting Receipt', scr.name, scr.posting_date, scr.status, scr.docstatus,
                scr.supplier, sup.supplier_name, 1, NULL, NULL,
                GROUP_CONCAT(DISTINCT poi.sales_order ORDER BY poi.sales_order SEPARATOR ', '),
                GROUP_CONCAT(DISTINCT so.customer_name ORDER BY so.customer_name SEPARATOR ', '),
                GROUP_CONCAT(DISTINCT scri.purchase_order ORDER BY scri.purchase_order SEPARATOR ', '),
                SUM(scri.qty),
                (SELECT pr2.name FROM `tabPurchase Receipt` pr2
                 WHERE pr2.subcontracting_receipt = scr.name LIMIT 1)
         FROM `tabSubcontracting Receipt Item` scri
         JOIN `tabSubcontracting Receipt` scr ON scr.name = scri.parent
         LEFT JOIN `tabPurchase Order Item` poi ON poi.name = scri.purchase_order_item
         LEFT JOIN `tabSupplier` sup ON sup.name = scr.supplier
         LEFT JOIN `tabSales Order` so ON so.name = poi.sales_order
         LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
         WHERE {' AND '.join(scr_conditions)}
         GROUP BY scr.name, scr.posting_date, scr.status, scr.docstatus, scr.supplier, sup.supplier_name)

        ORDER BY posting_date DESC
        LIMIT 300
    """, params, as_dict=1)

    material_requests = frappe.db.sql(f"""
        SELECT mr.name, mr.transaction_date, mr.schedule_date, mr.material_request_type,
               mr.status, mr.docstatus, mr.per_ordered, mr.per_received,
               GROUP_CONCAT(DISTINCT mri.sales_order ORDER BY mri.sales_order SEPARATOR ', ') AS sales_orders,
               GROUP_CONCAT(DISTINCT so.customer_name ORDER BY so.customer_name SEPARATOR ', ') AS so_customer_names,
               COUNT(DISTINCT mri.item_code) AS item_count,
               SUM(mri.qty) AS qty, SUM(mri.ordered_qty) AS ordered_qty
        FROM `tabMaterial Request Item` mri
        JOIN `tabMaterial Request` mr ON mr.name = mri.parent
        LEFT JOIN `tabSales Order` so ON so.name = mri.sales_order
        LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
        WHERE {' AND '.join(mr_conditions)}
        GROUP BY mr.name, mr.transaction_date, mr.schedule_date, mr.material_request_type,
                 mr.status, mr.docstatus, mr.per_ordered, mr.per_received
        ORDER BY mr.transaction_date DESC
        LIMIT 300
    """, params, as_dict=1)

    draft_pis = frappe.db.sql("""
        SELECT pii.purchase_order, pi.name
        FROM `tabPurchase Invoice Item` pii
        JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
        WHERE pi.docstatus = 0 AND pii.purchase_order IS NOT NULL AND pii.purchase_order != ''
    """, as_dict=1)
    
    po_draft_pi = {}
    for d in draft_pis:
        po_draft_pi[d.purchase_order] = d.name
        
    for p in purchase_orders:
        p["draft_invoice"] = po_draft_pi.get(p.name)

    return {
        "material_requests": material_requests,
        "purchase_orders": purchase_orders,
        "receipts": receipts,
    }


# --------------------------------------------------------------------------
# Tab 3 — Job work (subcontracting + embroidery)
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_jobwork_flow(days=180, search=None, scope="open", merchandiser=None):
    """Subcontracting/Job Work POs with their receipt progress, tied back to the Sales Order."""
    _guard()
    _guard_tab("jobwork")
    conditions = ["po.docstatus < 2", "po.transaction_date >= %(from_date)s", "po.is_subcontracted = 1", _NOT_DISABLED_SO]
    params = {"from_date": _from_date(days)}

    if scope == "open":
        conditions.append("po.status NOT IN ('Closed', 'Completed', 'Cancelled')")
        conditions.append("(poi.sales_order IS NULL OR poi.sales_order = '' OR so.status NOT IN ('Closed', 'Completed', 'Cancelled'))")
    elif scope == "mine":
        conditions.append("po.owner = %(me)s")
        params["me"] = frappe.session.user

    if search:
        conditions.append("""(po.name LIKE %(q)s OR po.supplier LIKE %(q)s
                              OR sup.supplier_name LIKE %(q)s OR poi.sales_order LIKE %(q)s
                              OR poi.item_code LIKE %(q)s)""")
        params["q"] = f"%{search}%"


    purchase_orders = frappe.db.sql(f"""
        SELECT po.name, po.transaction_date, po.schedule_date, po.status, po.docstatus,
               po.supplier, sup.supplier_name, po.is_subcontracted, po.currency,
               po.per_received, po.per_billed, po.grand_total,
               GROUP_CONCAT(DISTINCT poi.sales_order ORDER BY poi.sales_order SEPARATOR ', ') AS sales_orders,
               GROUP_CONCAT(DISTINCT so.customer_name ORDER BY so.customer_name SEPARATOR ', ') AS so_customer_names,
               COUNT(DISTINCT poi.item_code) AS item_count,
               SUM(poi.fg_item_qty) AS qty,
               SUM(poi.received_qty) AS received_qty
        FROM `tabPurchase Order Item` poi
        JOIN `tabPurchase Order` po ON po.name = poi.parent
        LEFT JOIN `tabSupplier` sup ON sup.name = po.supplier
        LEFT JOIN `tabSales Order` so ON so.name = poi.sales_order
        LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
        WHERE {' AND '.join(conditions)}
        GROUP BY po.name, po.transaction_date, po.schedule_date, po.status, po.docstatus,
                 po.supplier, sup.supplier_name, po.is_subcontracted, po.currency,
                 po.per_received, po.per_billed, po.grand_total
        ORDER BY po.transaction_date DESC, po.name DESC
        LIMIT 300
    """, params, as_dict=1)

    pr_conditions = ["pr.docstatus < 2", "pr.posting_date >= %(from_date)s", "pr.is_subcontracted = 1", _NOT_DISABLED_SO]
    scr_conditions = ["scr.docstatus < 2", "scr.posting_date >= %(from_date)s", _NOT_DISABLED_SO]
    ewo_conditions = ["ewo.docstatus < 2", "ewo.date >= %(from_date)s", _NOT_DISABLED_SO]
    
    if scope == "open":
        pr_conditions.append("pr.status NOT IN ('Completed', 'Cancelled')")
        pr_conditions.append("(pri.sales_order IS NULL OR pri.sales_order = '' OR so.status NOT IN ('Closed', 'Completed', 'Cancelled'))")
        scr_conditions.append("scr.status NOT IN ('Completed', 'Cancelled')")
        scr_conditions.append("(poi.sales_order IS NULL OR poi.sales_order = '' OR so.status NOT IN ('Closed', 'Completed', 'Cancelled'))")
        ewo_conditions.append("ewo.status NOT IN ('Closed', 'Completed', 'Cancelled')")
        ewo_conditions.append("(ewo.purchase_order IS NULL OR ewo.purchase_order = '' OR po.status NOT IN ('Closed', 'Completed', 'Cancelled'))")
        ewo_conditions.append("(poi.sales_order IS NULL OR poi.sales_order = '' OR so.status NOT IN ('Closed', 'Completed', 'Cancelled'))")
    elif scope == "mine":
        pr_conditions.append("pr.owner = %(me)s")
        scr_conditions.append("scr.owner = %(me)s")
        ewo_conditions.append("ewo.owner = %(me)s")
        
    if search:
        pr_conditions.append("(pr.name LIKE %(q)s OR pr.supplier LIKE %(q)s OR sup.supplier_name LIKE %(q)s)")
        scr_conditions.append("(scr.name LIKE %(q)s OR scr.supplier LIKE %(q)s OR sup.supplier_name LIKE %(q)s)")
        ewo_conditions.append("""(ewo.name LIKE %(q)s OR ewo.purchase_order LIKE %(q)s
                                  OR fp.supplier_name LIKE %(q)s OR pn.supplier_name LIKE %(q)s)""")


    receipts = frappe.db.sql(f"""
        (SELECT 'Purchase Receipt' AS doctype, pr.name, pr.posting_date, pr.status, pr.docstatus,
                pr.supplier, sup.supplier_name, pr.is_subcontracted, pr.currency, pr.grand_total,
                GROUP_CONCAT(DISTINCT pri.sales_order ORDER BY pri.sales_order SEPARATOR ', ') AS sales_orders,
                GROUP_CONCAT(DISTINCT so.customer_name ORDER BY so.customer_name SEPARATOR ', ') AS so_customer_names,
                GROUP_CONCAT(DISTINCT pri.purchase_order ORDER BY pri.purchase_order SEPARATOR ', ') AS purchase_orders,
                SUM(pri.received_qty) AS qty, NULL AS linked_pr
         FROM `tabPurchase Receipt Item` pri
         JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
         LEFT JOIN `tabSupplier` sup ON sup.name = pr.supplier
         LEFT JOIN `tabSales Order` so ON so.name = pri.sales_order
         LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
         WHERE {' AND '.join(pr_conditions)}
         GROUP BY pr.name, pr.posting_date, pr.status, pr.docstatus, pr.supplier, sup.supplier_name, pr.is_subcontracted, pr.currency, pr.grand_total)
        UNION
        (SELECT 'Subcontracting Receipt' AS doctype, scr.name, scr.posting_date, scr.status, scr.docstatus,
                scr.supplier, sup.supplier_name, 1 AS is_subcontracted, '' AS currency, 0 AS grand_total,
                (SELECT GROUP_CONCAT(DISTINCT poi.sales_order ORDER BY poi.sales_order SEPARATOR ', ')
                 FROM `tabPurchase Order Item` poi
                 JOIN `tabSubcontracting Receipt Item` scri2 ON scri2.purchase_order = poi.parent
                 WHERE scri2.parent = scr.name) AS sales_orders,
                (SELECT GROUP_CONCAT(DISTINCT so2.customer_name ORDER BY so2.customer_name SEPARATOR ', ')
                 FROM `tabPurchase Order Item` poi2
                 JOIN `tabSubcontracting Receipt Item` scri3 ON scri3.purchase_order = poi2.parent
                 LEFT JOIN `tabSales Order` so2 ON so2.name = poi2.sales_order
                 WHERE scri3.parent = scr.name) AS so_customer_names,
                GROUP_CONCAT(DISTINCT scri.purchase_order ORDER BY scri.purchase_order SEPARATOR ', ') AS purchase_orders,
                SUM(scri.qty) AS qty,
                -- Every Subcontracting Receipt this app creates immediately gets a
                -- mapped Purchase Receipt (create_receipt_documents in
                -- purchase_order.py) — that PR, not the SCR, is the document this
                -- business actually works from day to day.
                (SELECT pr2.name FROM `tabPurchase Receipt` pr2
                 WHERE pr2.subcontracting_receipt = scr.name LIMIT 1) AS linked_pr
         FROM `tabSubcontracting Receipt Item` scri
         JOIN `tabSubcontracting Receipt` scr ON scr.name = scri.parent
         LEFT JOIN `tabPurchase Order Item` poi ON poi.name = scri.purchase_order_item
         LEFT JOIN `tabSupplier` sup ON sup.name = scr.supplier
         LEFT JOIN `tabSales Order` so ON so.name = poi.sales_order
         LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
         WHERE {' AND '.join(scr_conditions)}
         GROUP BY scr.name, scr.posting_date, scr.status, scr.docstatus, scr.supplier, sup.supplier_name)
        ORDER BY posting_date DESC, name DESC
        LIMIT 300
    """, params, as_dict=1)

    embroidery_orders = frappe.db.sql(f"""
        SELECT ewo.name, ewo.date, ewo.status, ewo.docstatus, ewo.work_type,
               ewo.purchase_order, ewo.subcontracting_order, ewo.completed_on,
               ewo.panel_stage, ewo.full_piece_stage, ewo.per_received,
               ewo.panel_jobber, ewo.full_piece_jobber,
               COALESCE(fp.supplier_name, pn.supplier_name) AS jobber_name,
               po.supplier AS po_supplier, po_sup.supplier_name AS po_supplier_name,
               (SELECT SUM(c.ordered_qty) FROM `tabEmbroidery Work Order Item` c WHERE c.parent = ewo.name) AS ordered_qty,
               (SELECT SUM(c.received_qty) FROM `tabEmbroidery Work Order Item` c WHERE c.parent = ewo.name) AS received_qty,
               (SELECT GROUP_CONCAT(DISTINCT poi.sales_order ORDER BY poi.sales_order SEPARATOR ', ')
                  FROM `tabPurchase Order Item` poi WHERE poi.parent = ewo.purchase_order) AS sales_orders,
               GROUP_CONCAT(DISTINCT so.customer_name ORDER BY so.customer_name SEPARATOR ', ') AS so_customer_names
        FROM `tabEmbroidery Work Order` ewo
        LEFT JOIN `tabSupplier` fp ON fp.name = ewo.full_piece_jobber
        LEFT JOIN `tabSupplier` pn ON pn.name = ewo.panel_jobber
        LEFT JOIN `tabPurchase Order` po ON po.name = ewo.purchase_order
        LEFT JOIN `tabSupplier` po_sup ON po_sup.name = po.supplier
        LEFT JOIN `tabPurchase Order Item` poi ON poi.parent = ewo.purchase_order
        LEFT JOIN `tabSales Order` so ON so.name = poi.sales_order
        WHERE {' AND '.join(ewo_conditions)}
        GROUP BY ewo.name, ewo.date, ewo.status, ewo.docstatus, ewo.work_type,
                 ewo.purchase_order, ewo.subcontracting_order, ewo.completed_on,
                 ewo.panel_stage, ewo.full_piece_stage, ewo.per_received,
                 ewo.panel_jobber, ewo.full_piece_jobber, fp.supplier_name, pn.supplier_name,
                 po.supplier, po_sup.supplier_name
        ORDER BY ewo.date DESC
        LIMIT 300
    """, params, as_dict=1)

    return {
        "purchase_orders": purchase_orders,
        "receipts": receipts,
        "embroidery_orders": embroidery_orders,
    }


# --------------------------------------------------------------------------
# Header counters & Stage Breakdown
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_summary(days=120, scope="open", search=None, merchandiser=None, approval_stage=None):
    """
    Headline stage counters for Number Cards on the Order Flow page.
    """
    _guard()
    _guard_tab("tracker")  # only called from the Sales Tracker tab
    # To compute accurate summary counts for all stages (including completed ones),
    # we override "open" scope to "all". "mine" scope is preserved to only count the user's orders.
    summary_scope = "all" if scope == "open" else scope
    orders_all = get_sales_tracker(days=days, scope=summary_scope, search=search, merchandiser=merchandiser, approval_stage=approval_stage)

    open_orders = 0
    completed = 0
    need_to_bill = 0
    draft_pick_list = 0
    ready_to_deliver = 0
    stock_received = 0
    receipt_draft = 0
    in_jobwork = 0
    in_embroidery = 0
    awaiting_stock = 0
    newly_created = 0
    overdue = 0

    for o in orders_all:
        if o.get("status") in ('Closed', 'Completed', 'Cancelled'):
            completed += 1
            continue

        open_orders += 1
        if o.get("is_overdue"):
            overdue += 1

        st = o.get("stage", {}).get("stage_key")
        if st == "need_to_bill":
            need_to_bill += 1
        elif st == "draft_pick_list":
            draft_pick_list += 1
        elif st == "ready_to_deliver":
            ready_to_deliver += 1
        elif st == "stock_received":
            stock_received += 1
        elif st == "receipt_draft":
            receipt_draft += 1
        elif st == "in_jobwork":
            in_jobwork += 1
        elif st == "in_embroidery":
            in_embroidery += 1
        elif st == "awaiting_stock":
            awaiting_stock += 1
        elif st == "newly_created":
            newly_created += 1

    return {
        "open_orders": open_orders,
        "need_to_bill": need_to_bill,
        "draft_pick_list": draft_pick_list,
        "ready_to_deliver": ready_to_deliver,
        "stock_received": stock_received,
        "receipt_draft": receipt_draft,
        "in_jobwork": in_jobwork,
        "in_embroidery": in_embroidery,
        "awaiting_stock": awaiting_stock,
        "newly_created": newly_created,
        "overdue": overdue,
        "completed": completed
    }


# --------------------------------------------------------------------------
# Tab 4 — Accounts & Financials (Receivables, Supplier Payables & Jobber Payables)
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_accounts_flow(days=120, search=None, scope="open", merchandiser=None):
    """
    Financial summary & invoices split into Receivables, Supplier Payables, and Jobber Payables (custom_is_jobber = 1).
    """
    _guard()
    _guard_tab("accounts")
    from_date = _from_date(days)
    params = {"from_date": from_date}

    si_conditions = ["si.docstatus = 1", "si.posting_date >= %(from_date)s", _NOT_DISABLED_SO]
    if scope == "open":
        si_conditions.append("si.status != 'Paid'")
    elif scope == "mine":
        si_conditions.append("si.owner = %(me)s")
        params["me"] = frappe.session.user
    if search:
        si_conditions.append("""(si.name LIKE %(q)s OR si.customer LIKE %(q)s
                                 OR cust.customer_name LIKE %(q)s OR sii.sales_order LIKE %(q)s)""")
        params["q"] = f"%{search}%"


    sales_invoices = frappe.db.sql(f"""
        SELECT si.name, si.posting_date, si.due_date, si.status, si.docstatus,
               si.customer, cust.customer_name, si.currency,
               si.grand_total, si.outstanding_amount,
               (si.grand_total - si.outstanding_amount) AS paid_amount,
               GROUP_CONCAT(DISTINCT sii.sales_order ORDER BY sii.sales_order SEPARATOR ', ') AS sales_orders,
               GROUP_CONCAT(DISTINCT so.customer_name ORDER BY so.customer_name SEPARATOR ', ') AS so_customer_names
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON si.name = sii.parent
        LEFT JOIN `tabCustomer` cust ON cust.name = si.customer
        LEFT JOIN `tabSales Order` so ON so.name = sii.sales_order
        WHERE {' AND '.join(si_conditions)}
        GROUP BY si.name, si.posting_date, si.due_date, si.status, si.docstatus,
                 si.customer, cust.customer_name, si.currency, si.grand_total, si.outstanding_amount
        ORDER BY si.posting_date DESC, si.name DESC
        LIMIT 300
    """, params, as_dict=1)

    pi_params = {"from_date": from_date}
    pi_conditions = ["pi.docstatus = 1", "pi.posting_date >= %(from_date)s", _NOT_DISABLED_SO]
    if scope == "open":
        pi_conditions.append("pi.status != 'Paid'")
    elif scope == "mine":
        pi_conditions.append("pi.owner = %(me)s")
        pi_params["me"] = frappe.session.user
    if search:
        pi_conditions.append("""(pi.name LIKE %(q)s OR pi.supplier LIKE %(q)s
                                 OR sup.supplier_name LIKE %(q)s OR poi.sales_order LIKE %(q)s)""")
        pi_params["q"] = f"%{search}%"


    purchase_invoices = frappe.db.sql(f"""
        SELECT pi.name, pi.posting_date, pi.due_date, pi.status, pi.docstatus,
               pi.supplier, sup.supplier_name, pi.currency,
               IFNULL(sup.custom_is_jobber, 0) AS is_jobber,
               pi.grand_total, pi.outstanding_amount,
               (pi.grand_total - pi.outstanding_amount) AS paid_amount,
               GROUP_CONCAT(DISTINCT poi.sales_order ORDER BY poi.sales_order SEPARATOR ', ') AS sales_orders,
               GROUP_CONCAT(DISTINCT so.customer_name ORDER BY so.customer_name SEPARATOR ', ') AS so_customer_names
        FROM `tabPurchase Invoice Item` pii
        JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
        LEFT JOIN `tabPurchase Order Item` poi ON poi.parent = pii.purchase_order
        LEFT JOIN `tabSupplier` sup ON sup.name = pi.supplier
        LEFT JOIN `tabSales Order` so ON so.name = poi.sales_order
        LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
        WHERE {' AND '.join(pi_conditions)}
        GROUP BY pi.name, pi.posting_date, pi.due_date, pi.status, pi.docstatus,
                 pi.supplier, sup.supplier_name, sup.custom_is_jobber, pi.currency, pi.grand_total, pi.outstanding_amount
        ORDER BY pi.posting_date DESC, pi.name DESC
        LIMIT 300
    """, pi_params, as_dict=1)

    supplier_invoices = [p for p in purchase_invoices if flt(p.get("is_jobber")) == 0]
    jobber_invoices   = [p for p in purchase_invoices if flt(p.get("is_jobber")) == 1]

    sales_total = sum(flt(s.grand_total) for s in sales_invoices)
    sales_received = sum(flt(s.paid_amount) for s in sales_invoices)
    sales_outstanding = sum(flt(s.outstanding_amount) for s in sales_invoices)

    supplier_total = sum(flt(p.grand_total) for p in supplier_invoices)
    supplier_paid = sum(flt(p.paid_amount) for p in supplier_invoices)
    supplier_outstanding = sum(flt(p.outstanding_amount) for p in supplier_invoices)

    jobber_total = sum(flt(p.grand_total) for p in jobber_invoices)
    jobber_paid = sum(flt(p.paid_amount) for p in jobber_invoices)
    jobber_outstanding = sum(flt(p.outstanding_amount) for p in jobber_invoices)

    return {
        "sales_invoices": sales_invoices,
        "supplier_invoices": supplier_invoices,
        "jobber_invoices": jobber_invoices,
        "metrics": {
            "sales_total": sales_total,
            "sales_received": sales_received,
            "sales_outstanding": sales_outstanding,
            "supplier_total": supplier_total,
            "supplier_paid": supplier_paid,
            "supplier_outstanding": supplier_outstanding,
            "jobber_total": jobber_total,
            "jobber_paid": jobber_paid,
            "jobber_outstanding": jobber_outstanding
        }
    }


# --------------------------------------------------------------------------
# Pick List review, for the Sales Order stock widget's "Pick Lists" button
# (public/js/sales_order.js — shared by the real Sales Order form and every
# dashboard tab that expands a Sales Order row)
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_pick_lists_for_so(sales_order):
    """Every draft/submitted Pick List line tied to this Sales Order — one
    item now maps to one Pick List (see
    custom_script._create_pick_lists_one_per_item), so an order with several
    lines can have several to review at once. `pick_list_item` is the child
    row's own name, needed to edit a draft's quantity before submitting it
    (custom_script.update_and_submit_pick_list)."""
    _guard()
    return frappe.db.sql("""
        SELECT pl.name, pl.status, pl.docstatus, pli.name AS pick_list_item,
               pli.item_code, pli.qty, pli.picked_qty, IFNULL(pli.delivered_qty, 0) AS delivered_qty,
               pli.warehouse
        FROM `tabPick List Item` pli
        JOIN `tabPick List` pl ON pl.name = pli.parent
        WHERE pli.sales_order = %(so)s AND pl.docstatus < 2
        ORDER BY pl.docstatus ASC, pl.creation ASC
    """, {"so": sales_order}, as_dict=1)


@frappe.whitelist()
def get_draft_dn_si_for_so(sales_order):
    """Existing draft Delivery Notes/Sales Invoices already against this
    Sales Order — surfaced before offering to create a new one from the
    dashboard's "Create DN / SI" action, so that action never builds a
    duplicate draft next to one the user already started."""
    _guard()
    draft_dns = frappe.db.sql_list("""
        SELECT DISTINCT dn.name
        FROM `tabDelivery Note Item` dni
        JOIN `tabDelivery Note` dn ON dn.name = dni.parent
        WHERE dni.against_sales_order = %s AND dn.docstatus = 0
    """, sales_order)
    # Scoped to update_stock=1 — a plain draft invoice (e.g. billing against
    # an existing DN) is a different, expected document, not a duplicate of
    # the "Sales Invoice with Update Stock" fulfillment route this action
    # creates.
    draft_sis = frappe.db.sql_list("""
        SELECT DISTINCT si.name
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON si.name = sii.parent
        WHERE sii.sales_order = %s AND si.docstatus = 0 AND si.update_stock = 1
    """, sales_order)
    return {"draft_dns": draft_dns, "draft_sis": draft_sis}


# --------------------------------------------------------------------------
# Tab — Accounts (Sales Orders with a Delivery Note that still need billing)
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_billing_flow(days=120, search=None, scope="open"):
    """
    Sales Orders that have shipped (a submitted Delivery Note exists) but are
    not yet fully billed — the queue this tab exists to clear.
    """
    _guard()
    _guard_tab("billing")
    conditions = ["so.docstatus = 1", "so.per_billed < 100", "so.transaction_date >= %(from_date)s", _NOT_DISABLED_SO]
    params = {"from_date": _from_date(days)}

    if scope == "open":
        conditions.append("so.status NOT IN ('Closed', 'Cancelled')")
    elif scope == "mine":
        conditions.append("so.owner = %(me)s")
        params["me"] = frappe.session.user

    if search:
        conditions.append("(so.name LIKE %(q)s OR so.customer_name LIKE %(q)s OR so.customer LIKE %(q)s)")
        params["q"] = f"%{search}%"

    conditions.append("""EXISTS (
        SELECT 1 FROM `tabDelivery Note Item` dni
        JOIN `tabDelivery Note` dn ON dn.name = dni.parent
        WHERE dni.against_sales_order = so.name AND dn.docstatus = 1
    )""")

    orders = frappe.db.sql(f"""
        SELECT so.name, so.customer, so.customer_name, so.transaction_date, so.grand_total,
               so.currency, so.per_delivered, so.per_billed, so.status, so.owner
        FROM `tabSales Order` so
        WHERE {' AND '.join(conditions)}
        ORDER BY so.transaction_date DESC
        LIMIT 300
    """, params, as_dict=1)

    return {
        "orders": orders,
        "metrics": {
            "count": len(orders),
            "total_to_bill": sum(flt(o.grand_total) * (100 - flt(o.per_billed)) / 100 for o in orders),
        }
    }


# --------------------------------------------------------------------------
# Purchase Flow / Job Work / Finance — row-level "see items" toggle
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_document_items(doctype, docname):
    """
    Item child-table rows for one document — backs the row-level "see items"
    toggle on Purchase Flow / Job Work / Finance (those rows are Purchase
    Orders, Material Requests, Receipts and Invoices, not Sales Orders, so
    the Sales Order stock widget doesn't apply — this shows the document's
    own line items instead).

    A subcontracted Purchase Order is a named special case: its own `items`
    are the raw/service material sent to the jobber, and `fg_item`/
    `fg_item_qty` on those same rows describe the finished good it produces
    — both are surfaced as separate rows so the panel reads as "sent X, get
    back Y" rather than just the raw material.
    """
    _guard()
    allowed = {"Purchase Order", "Material Request", "Purchase Receipt",
               "Subcontracting Receipt", "Sales Invoice", "Purchase Invoice"}
    if doctype not in allowed:
        frappe.throw(_("Unsupported document type: {0}").format(doctype))

    doc = frappe.get_doc(doctype, docname)
    doc.check_permission("read")
    is_subcontracted_po = doctype == "Purchase Order" and bool(doc.get("is_subcontracted"))

    rows = []
    for item in doc.get("items") or []:
        rows.append({
            "item_code": item.item_code, "item_name": item.get("item_name"),
            "qty": item.qty, "uom": item.get("uom"),
            "rate": item.get("rate"), "warehouse": item.get("warehouse"),
            "role": "Raw / Service Item" if is_subcontracted_po else None,
        })
        if is_subcontracted_po and item.get("fg_item"):
            rows.append({
                "item_code": item.get("fg_item"), "item_name": None, "qty": item.get("fg_item_qty"),
                "uom": None, "rate": None, "warehouse": None, "role": "Finished Good",
            })
    return rows


# --------------------------------------------------------------------------
# Tab — Stock Tracker (global item availability & Pick List reservations)
# --------------------------------------------------------------------------

def _get_global_pick_reservations(item_codes, warehouse=None):
    """
    {item_code: {"draft_qty": x, "submitted_qty": y}} — the same held_qty
    computation custom_script._get_pick_blockers already uses per Sales
    Order (draft rows count stock_qty, submitted rows count picked_qty
    minus delivered_qty, excluding Completed/Cancelled Pick Lists),
    aggregated globally across every Sales Order instead of scoped to one.
    """
    if not item_codes:
        return {}

    params = {"items": tuple(item_codes)}
    wh_filter = ""
    if warehouse:
        wh_filter = "AND pli.warehouse = %(warehouse)s"
        params["warehouse"] = warehouse

    rows = frappe.db.sql(f"""
        SELECT pli.item_code, pl.docstatus,
               SUM(CASE WHEN pli.picked_qty > 0 AND pl.docstatus = 1
                        THEN pli.picked_qty - IFNULL(pli.delivered_qty, 0)
                        ELSE pli.stock_qty END) AS reserved_qty
        FROM `tabPick List Item` pli
        JOIN `tabPick List` pl ON pl.name = pli.parent
        WHERE pli.item_code IN %(items)s
          AND (pli.picked_qty > 0 OR pli.stock_qty > 0)
          AND pl.status NOT IN ('Completed', 'Cancelled')
          AND pli.docstatus != 2
          {wh_filter}
        GROUP BY pli.item_code, pl.docstatus
    """, params, as_dict=1)

    out = {}
    for r in rows:
        entry = out.setdefault(r.item_code, {"draft_qty": 0.0, "submitted_qty": 0.0})
        entry["submitted_qty" if r.docstatus == 1 else "draft_qty"] += flt(r.reserved_qty)
    return out


@frappe.whitelist()
def get_stock_tracker(search=None, warehouse=None):
    """
    Global (not per-Sales-Order) item availability report: physical stock by
    warehouse, how much of it is already reserved by draft/submitted Pick
    Lists across every Sales Order, and the resulting net-available
    quantity — stock that looks free in Bin may already be claimed by
    another order's Pick List.
    """
    _guard()
    _guard_tab("stock")

    # Every stock item shows by default — search/warehouse only narrow from
    # there, they never gate which items appear. An item with zero stock and
    # no reservation is still a valid, useful row (it's the "out of stock"
    # signal); the warehouse filter narrows each item's figures below, not
    # the item list itself.
    conditions = ["i.disabled = 0", "i.is_stock_item = 1"]
    params = {}
    if search:
        conditions.append("(i.item_code LIKE %(q)s OR i.item_name LIKE %(q)s)")
        params["q"] = f"%{search}%"

    items = frappe.db.sql(f"""
        SELECT i.item_code, i.item_name, i.stock_uom
        FROM `tabItem` i
        WHERE {' AND '.join(conditions)}
        ORDER BY i.item_code
        LIMIT 300
    """, params, as_dict=1)
    if not items:
        return []

    item_codes = [i.item_code for i in items]

    bin_params = {"items": tuple(item_codes)}
    bin_where = "item_code IN %(items)s AND actual_qty != 0"
    if warehouse:
        bin_where += " AND warehouse = %(warehouse)s"
        bin_params["warehouse"] = warehouse
    bins = frappe.db.sql(f"""
        SELECT item_code, warehouse, actual_qty, reserved_qty,
               reserved_qty_for_production, reserved_qty_for_sub_contract
        FROM `tabBin` WHERE {bin_where} ORDER BY actual_qty DESC
    """, bin_params, as_dict=1)

    bins_by_item = {}
    for b in bins:
        bins_by_item.setdefault(b.item_code, []).append(b)

    reservations = _get_global_pick_reservations(item_codes, warehouse)

    result = []
    for i in items:
        wh_rows = bins_by_item.get(i.item_code, [])
        total_available = sum(flt(w.actual_qty) for w in wh_rows)
        res = reservations.get(i.item_code, {"draft_qty": 0.0, "submitted_qty": 0.0})
        net_available = total_available - res["draft_qty"] - res["submitted_qty"]
        result.append({
            "item_code": i.item_code, "item_name": i.item_name, "stock_uom": i.stock_uom,
            "total_available_stock": total_available,
            "warehouse_stock": wh_rows,
            "picked_draft_qty": res["draft_qty"], "picked_submitted_qty": res["submitted_qty"],
            "net_available": net_available,
        })
    return result


@frappe.whitelist()
def get_warehouses():
    _guard()
    return frappe.get_all("Warehouse", filters={"disabled": 0, "is_group": 0},
                           fields=["name"], order_by="name")


@frappe.whitelist()
def get_stock_reservation_details(item_code, warehouse, kind):
    """
    Which documents are actually behind one of the Stock Tracker's three
    Bin reservation counters, for its "click the count, see why" drill-down.
    Bin itself only stores the number — this re-derives the source rows the
    same way ERPNext's own Bin recalculation does for each counter:

      reserved                -> submitted, open Sales Order Item lines
      reserved_for_production -> submitted, open Work Order requirements
      reserved_for_subcontract -> submitted, open Subcontracting Order /
                                  old-flow Purchase Order raw-material
                                  requirements (both subcontracting flows)
    """
    _guard()
    params = {"item_code": item_code, "warehouse": warehouse}

    if kind == "reserved":
        # Matches erpnext.stock.stock_balance.get_reserved_qty's own two
        # sources: a direct Sales Order Item line, or the item riding along
        # as a component of a Product Bundle sold on the order (a Packed
        # Item row) — Bin.reserved_qty sums both, so a bundle-only
        # reservation would otherwise show a count with nothing behind it.
        direct = frappe.db.sql("""
            SELECT so.name, so.customer_name, soi.qty, soi.delivered_qty,
                   (soi.qty - soi.delivered_qty) AS outstanding_qty
            FROM `tabSales Order Item` soi
            JOIN `tabSales Order` so ON so.name = soi.parent
            WHERE soi.item_code = %(item_code)s AND soi.warehouse = %(warehouse)s
              AND (soi.delivered_by_supplier IS NULL OR soi.delivered_by_supplier = 0)
              AND so.docstatus = 1 AND so.status NOT IN ('On Hold', 'Closed')
              AND soi.qty > soi.delivered_qty
            ORDER BY so.transaction_date DESC
        """, params, as_dict=1)

        bundled = frappe.db.sql("""
            SELECT so.name, so.customer_name, pi.qty,
                   IFNULL(soi.delivered_qty, 0) AS delivered_qty,
                   (pi.qty - IFNULL(soi.delivered_qty, 0)) AS outstanding_qty
            FROM `tabPacked Item` pi
            JOIN `tabSales Order` so ON so.name = pi.parent AND pi.parenttype = 'Sales Order'
            LEFT JOIN `tabSales Order Item` soi ON soi.name = pi.parent_detail_docname
            WHERE pi.item_code = %(item_code)s AND pi.warehouse = %(warehouse)s
              AND pi.item_code != pi.parent_item
              AND so.docstatus = 1 AND so.status NOT IN ('On Hold', 'Closed')
            ORDER BY so.transaction_date DESC
        """, params, as_dict=1)

        return list(direct) + list(bundled)

    if kind == "production":
        return frappe.db.sql("""
            SELECT wo.name, wo.status, woi.required_qty, woi.transferred_qty,
                   (woi.required_qty - woi.transferred_qty) AS outstanding_qty
            FROM `tabWork Order Item` woi
            JOIN `tabWork Order` wo ON wo.name = woi.parent
            WHERE woi.item_code = %(item_code)s AND wo.source_warehouse = %(warehouse)s
              AND wo.docstatus = 1 AND wo.status NOT IN ('Stopped', 'Completed', 'Closed')
              AND (woi.required_qty - woi.transferred_qty) > 0
            ORDER BY wo.creation DESC
        """, params, as_dict=1)

    if kind == "subcontract":
        new_flow = frappe.db.sql("""
            SELECT sco.name, 'Subcontracting Order' AS doctype, sco.supplier, sup.supplier_name,
                   scosi.required_qty AS qty
            FROM `tabSubcontracting Order Supplied Item` scosi
            JOIN `tabSubcontracting Order` sco ON sco.name = scosi.parent
            LEFT JOIN `tabSupplier` sup ON sup.name = sco.supplier
            WHERE scosi.rm_item_code = %(item_code)s AND scosi.reserve_warehouse = %(warehouse)s
              AND sco.docstatus = 1 AND sco.per_received < 100
        """, params, as_dict=1)
        old_flow = frappe.db.sql("""
            SELECT po.name, 'Purchase Order' AS doctype, po.supplier, sup.supplier_name,
                   poisup.required_qty AS qty
            FROM `tabPurchase Order Item Supplied` poisup
            JOIN `tabPurchase Order` po ON po.name = poisup.parent
            LEFT JOIN `tabSupplier` sup ON sup.name = po.supplier
            WHERE poisup.rm_item_code = %(item_code)s AND poisup.reserve_warehouse = %(warehouse)s
              AND po.docstatus = 1 AND IFNULL(po.is_old_subcontracting_flow, 0) = 1
              AND po.per_received < 100
        """, params, as_dict=1)
        return list(new_flow) + list(old_flow)

    if kind == "pick_draft":
        wh_cond = ""
        if warehouse:
            wh_cond = "AND pli.warehouse = %(warehouse)s"
        return frappe.db.sql(f"""
            SELECT pl.name, pli.warehouse, pli.sales_order, so.customer_name, pli.stock_qty AS qty
            FROM `tabPick List Item` pli
            JOIN `tabPick List` pl ON pl.name = pli.parent
            LEFT JOIN `tabSales Order` so ON so.name = pli.sales_order
            WHERE pli.item_code = %(item_code)s
              AND pli.stock_qty > 0
              AND pl.docstatus = 0
              AND pl.status NOT IN ('Completed', 'Cancelled')
              AND pli.docstatus != 2
              {wh_cond}
            ORDER BY pl.creation DESC
        """, params, as_dict=1)

    if kind == "pick_submitted":
        wh_cond = ""
        if warehouse:
            wh_cond = "AND pli.warehouse = %(warehouse)s"
        return frappe.db.sql(f"""
            SELECT pl.name, pli.warehouse, pli.sales_order, so.customer_name,
                   (pli.picked_qty - IFNULL(pli.delivered_qty, 0)) AS qty
            FROM `tabPick List Item` pli
            JOIN `tabPick List` pl ON pl.name = pli.parent
            LEFT JOIN `tabSales Order` so ON so.name = pli.sales_order
            WHERE pli.item_code = %(item_code)s
              AND pli.picked_qty > IFNULL(pli.delivered_qty, 0)
              AND pl.docstatus = 1
              AND pl.status NOT IN ('Completed', 'Cancelled')
              AND pli.docstatus != 2
              {wh_cond}
            ORDER BY pl.creation DESC
        """, params, as_dict=1)

    frappe.throw(_("Unknown reservation kind: {0}").format(kind))


@frappe.whitelist()
def get_approval_permissions():
    """
    Deprecated: kept as a thin wrapper because it is a whitelisted, public
    method and something outside this app may still call it by name.

    Superseded by get_order_flow_permissions(), which returns everything this
    used to plus the per-tab visibility map (`tabs` / `allowed_tabs`).
    """
    return get_order_flow_permissions()


@frappe.whitelist()
def get_pending_approvals(search=None, merchandiser=None, approval_stage=None):
    _guard()
    _guard_tab("approval")
    setup_sales_order_workflow()
    
    conditions = ["so.docstatus = 0", _NOT_DISABLED_SO]
    params = {}

    conditions.append("(so.workflow_state in ('Draft', 'Pending Merchandiser Approval', 'Pending Final Approval', 'Rejected') or so.workflow_state is null or so.workflow_state = '')")
    
    if approval_stage:
        if approval_stage == "Draft":
            conditions.append("(so.workflow_state = 'Draft' OR so.workflow_state IS NULL OR so.workflow_state = '')")
        else:
            conditions.append("so.workflow_state = %(approval_stage)s")
            params["approval_stage"] = approval_stage

    settings = frappe.get_single("Admin Settings")
    final_users = [d.user for d in settings.sales_order_final_approval or []]
    is_final_approver = frappe.session.user in final_users or "System Manager" in frappe.get_roles() or frappe.session.user == "Administrator"

    if merchandiser:
        conditions.append("cust.custom_merchandiser_user = %(me)s")
        params["me"] = merchandiser
    else:
        if is_merchandiser_user() and not is_final_approver:
            conditions.append("(cust.custom_merchandiser_user = %(me)s OR cust.custom_merchandiser_user IS NULL OR cust.custom_merchandiser_user = '')")
            params["me"] = frappe.session.user
        
    if search:
        conditions.append("""(
            so.name LIKE %(q)s 
            OR so.customer_name LIKE %(q)s 
            OR so.customer LIKE %(q)s 
            OR EXISTS(SELECT 1 FROM `tabSales Order Item` WHERE parent = so.name AND (item_code LIKE %(q)s OR item_name LIKE %(q)s))
        )""")
        params["q"] = f"%{search}%"
        
    orders = frappe.db.sql(f"""
        SELECT so.name, so.customer, so.customer_name, so.transaction_date, so.delivery_date,
               so.workflow_state, so.grand_total, so.currency, so.owner, so.modified,
               cust.custom_merchandiser_user,
               u.full_name AS custom_merchandiser_name,
               (SELECT content FROM `tabComment` 
                WHERE reference_doctype = 'Sales Order' AND reference_name = so.name 
                  AND (content LIKE '%%Rejected%%' OR content LIKE '%%Rejection%%')
                ORDER BY creation DESC LIMIT 1) as rejection_comment
        FROM `tabSales Order` so
        LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
        LEFT JOIN `tabUser` u ON u.name = cust.custom_merchandiser_user
        WHERE {' AND '.join(conditions)}
        ORDER BY so.modified DESC
        LIMIT 300
    """, params, as_dict=1)
    
    for o in orders:
        items = frappe.get_all("Sales Order Item", filters={"parent": o.name}, fields=["item_name", "qty"])
        items_formatted = []
        for it in items:
            qty_val = it.qty
            if qty_val == int(qty_val):
                qty_str = str(int(qty_val))
            else:
                qty_str = str(qty_val)
            items_formatted.append(f"{it.item_name} ({qty_str})")
        o["items_list"] = ", ".join(items_formatted)
        
    return orders


@frappe.whitelist()
def verify_customer_details(sales_order):
    _guard()
    so = frappe.get_doc("Sales Order", sales_order)
    customer_name = so.customer
    customer = frappe.get_doc("Customer", customer_name)
    
    address = customer.customer_primary_address
    if not address:
        address = frappe.db.get_value("Dynamic Link", {"parenttype": "Address", "link_doctype": "Customer", "link_name": customer_name}, "parent")
        
    contact = customer.customer_primary_contact
    if not contact:
        contact = frappe.db.get_value("Dynamic Link", {"parenttype": "Contact", "link_doctype": "Customer", "link_name": customer_name}, "parent")
    
    address_details = {}
    if address:
        addr_doc = frappe.get_cached_doc("Address", address)
        address_details = {
            "address_line1": addr_doc.address_line1 or "",
            "address_line2": addr_doc.address_line2 or "",
            "city": addr_doc.city or "",
            "state": addr_doc.state or "",
            "country": addr_doc.country or "India",
            "pincode": addr_doc.pincode or ""
        }
        
    contact_details = {}
    if contact:
        cont_doc = frappe.get_cached_doc("Contact", contact)
        mobile_no = cont_doc.mobile_no or ""
        if not mobile_no and cont_doc.phone_nos:
            mobile_no = cont_doc.phone_nos[0].phone or ""
        email = cont_doc.email_id or ""
        if not email and cont_doc.email_ids:
            email = cont_doc.email_ids[0].email_id or ""
            
        contact_details = {
            "first_name": cont_doc.first_name or "",
            "mobile_no": mobile_no,
            "email": email
        }
    
    return {
        "customer": customer_name,
        "gstin": customer.gstin or "",
        "tax_category": customer.tax_category or "",
        "customer_primary_address": address or "",
        "customer_primary_contact": contact or "",
        "address_details": address_details,
        "contact_details": contact_details,
        "workflow_state": so.workflow_state,
        "skip_delivery_note": so.skip_delivery_note or 0,
        "missing": {
            "gstin": not customer.gstin,
            "tax_category": not customer.tax_category,
            "customer_primary_address": not address,
            "customer_primary_contact": not contact
        }
    }


@frappe.whitelist()
def verify_bulk_sales_orders(sales_orders):
    _guard()
    import json
    if isinstance(sales_orders, str):
        sales_orders = json.loads(sales_orders)
        
    results = {}
    for so_name in sales_orders:
        results[so_name] = verify_customer_details(so_name)
    return results


def add_custom_workflow_comment(ref_doctype, ref_name, label, detail_comment=None):
    import datetime
    now_str = datetime.datetime.now().strftime("%d-%b-%Y %I:%M %p")
    user_fullname = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
    
    text = f"{label} by {user_fullname} on {now_str}"
    if detail_comment:
        text += f": {detail_comment}"
        
    comment = frappe.new_doc("Comment")
    comment.comment_type = "Comment"
    comment.reference_doctype = ref_doctype
    comment.reference_name = ref_name
    comment.content = text
    comment.insert(ignore_permissions=True)


@frappe.whitelist()
def approve_sales_orders(sales_orders):
    _guard()
    import json
    if isinstance(sales_orders, str):
        sales_orders = json.loads(sales_orders)
        
    settings = frappe.get_single("Admin Settings")
    allowed_final_users = [d.user for d in settings.sales_order_final_approval or []]
    is_admin_or_system_mgr = "System Manager" in frappe.get_roles() or frappe.session.user == "Administrator"
    
    for so_name in sales_orders:
        doc = frappe.get_doc("Sales Order", so_name)
        state_before = doc.workflow_state or "Draft"
        
        if doc.workflow_state == "Pending Final Approval":
            if frappe.session.user not in allowed_final_users and not is_admin_or_system_mgr:
                frappe.throw(_("You are not authorized to perform Final Approval for Sales Order {0}.").format(so_name))
        
        if state_before in ("Draft", "", "Rejected"):
            # Transition from Draft/Rejected to Pending Merchandiser Approval first
            frappe.model.workflow.apply_workflow(doc, "Submit for Merchandiser Approval")
            doc = frappe.get_doc("Sales Order", so_name)

        transitions = frappe.model.workflow.get_transitions(doc)
        action = None
        for t in transitions:
            if t.next_state in ("Pending Final Approval", "Approved") and t.action in ("Approve", "Final Approve"):
                action = t.action
                break
        
        if not action:
            for t in transitions:
                if "approve" in t.action.lower() or "final" in t.action.lower():
                    action = t.action
                    break
                    
        if not action:
            frappe.throw(_("No valid transition found to approve Sales Order {0} in state {1}.").format(so_name, doc.workflow_state))
            
        frappe.model.workflow.apply_workflow(doc, action)
        
        if state_before in ("Draft", "Pending Merchandiser Approval", "Rejected", ""):
            add_custom_workflow_comment(doc.doctype, doc.name, "Merchandiser Approved")
        elif state_before == "Pending Final Approval":
            add_custom_workflow_comment(doc.doctype, doc.name, "Final Approved")
        
        # A merchandiser who pushes an order through to final approval takes
        # ownership of that customer; an admin doing the same does not.
        if doc.workflow_state == "Pending Final Approval":
            claim_customer_merchandiser(doc.customer)


@frappe.whitelist()
def reject_sales_orders(sales_orders, comment):
    _guard()
    import json
    if isinstance(sales_orders, str):
        sales_orders = json.loads(sales_orders)
        
    for so_name in sales_orders:
        doc = frappe.get_doc("Sales Order", so_name)
        
        transitions = frappe.model.workflow.get_transitions(doc)
        action = None
        for t in transitions:
            if t.next_state == "Rejected" and t.action in ("Reject", "Cancel"):
                action = t.action
                break
                
        if not action:
            for t in transitions:
                if "reject" in t.action.lower() or "reject" in t.next_state.lower():
                    action = t.action
                    break
                    
        if not action:
            frappe.throw(_("No valid transition found to reject Sales Order {0}.").format(so_name))
            
        frappe.model.workflow.apply_workflow(doc, action)
        add_custom_workflow_comment(doc.doctype, doc.name, "Rejected", comment)


@frappe.whitelist()
def save_and_approve_sales_order(sales_order, gstin=None, tax_category=None, address_data=None, contact_data=None, skip_delivery_note=None):
    _guard()
    so = frappe.get_doc("Sales Order", sales_order)
    customer_name = so.customer
    
    customer = frappe.get_doc("Customer", customer_name)
    if gstin is not None:
        customer.gstin = gstin
    if tax_category is not None:
        customer.tax_category = tax_category
        
    customer.save(ignore_permissions=True)
    
    addr_name = None
    if address_data:
        address_dict = frappe.parse_json(address_data)
        if address_dict.get("address_line1"):
            primary_address = customer.customer_primary_address
            if not primary_address:
                primary_address = frappe.db.get_value("Dynamic Link", {"parenttype": "Address", "link_doctype": "Customer", "link_name": customer_name}, "parent")
            
            if primary_address:
                addr = frappe.get_doc("Address", primary_address)
            else:
                addr = frappe.new_doc("Address")
                addr.address_title = customer.customer_name
                addr.address_type = "Billing"
                addr.is_primary_address = 1
                addr.append("links", {
                    "link_doctype": "Customer",
                    "link_name": customer_name
                })
            
            addr.address_line1 = address_dict.get("address_line1")
            addr.address_line2 = address_dict.get("address_line2")
            addr.city = address_dict.get("city")
            addr.state = address_dict.get("state")
            addr.country = address_dict.get("country") or "India"
            addr.pincode = address_dict.get("pincode")
            if gstin is not None:
                addr.gstin = gstin
            addr.save(ignore_permissions=True)
            addr_name = addr.name
            
            if not customer.customer_primary_address:
                customer.db_set("customer_primary_address", addr_name)
                
    cont_name = None
    if contact_data:
        contact_dict = frappe.parse_json(contact_data)
        if contact_dict.get("first_name"):
            primary_contact = customer.customer_primary_contact
            if not primary_contact:
                primary_contact = frappe.db.get_value("Dynamic Link", {"parenttype": "Contact", "link_doctype": "Customer", "link_name": customer_name}, "parent")
                
            if primary_contact:
                cont = frappe.get_doc("Contact", primary_contact)
            else:
                cont = frappe.new_doc("Contact")
                cont.is_primary_contact = 1
                cont.append("links", {
                    "link_doctype": "Customer",
                    "link_name": customer_name
                })
                
            cont.first_name = contact_dict.get("first_name")
            
            if contact_dict.get("mobile_no"):
                if not cont.phone_nos:
                    cont.append("phone_nos", {
                        "phone": contact_dict.get("mobile_no"),
                        "is_primary_phone": 1
                    })
                else:
                    cont.phone_nos[0].phone = contact_dict.get("mobile_no")
            if contact_dict.get("email"):
                if not cont.email_ids:
                    cont.append("email_ids", {
                        "email_id": contact_dict.get("email"),
                        "is_primary": 1
                    })
                else:
                    cont.email_ids[0].email_id = contact_dict.get("email")
                    
            cont.save(ignore_permissions=True)
            cont_name = cont.name
            
            if not customer.customer_primary_contact:
                customer.db_set("customer_primary_contact", cont_name)
                
    if addr_name:
        so.customer_address = addr_name
    if cont_name:
        so.contact_person = cont_name
    if gstin is not None:
        so.billing_address_gstin = gstin
    if skip_delivery_note is not None:
        so.skip_delivery_note = int(skip_delivery_note)
    so.save(ignore_permissions=True)
            
    approve_sales_orders([sales_order])


@frappe.whitelist()
def approve_sales_order_with_comment(sales_order, comment, skip_delivery_note=None):
    _guard()
    so = frappe.get_doc("Sales Order", sales_order)
    if skip_delivery_note is not None:
        so.skip_delivery_note = int(skip_delivery_note)
        so.save(ignore_permissions=True)
    
    state_before = so.workflow_state or "Draft"
    if state_before in ("Draft", "", "Rejected"):
        frappe.model.workflow.apply_workflow(so, "Submit for Merchandiser Approval")
        so = frappe.get_doc("Sales Order", sales_order)

    add_custom_workflow_comment(so.doctype, so.name, "Merchandiser Approved (with missing details)", comment)
    
    transitions = frappe.model.workflow.get_transitions(so)
    action = None
    for t in transitions:
        if t.next_state == "Pending Final Approval" and t.action in ("Approve", "Final Approve"):
            action = t.action
            break
            
    if not action:
        for t in transitions:
            if "approve" in t.action.lower():
                action = t.action
                break
                
    if not action:
        frappe.throw(_("No valid transition found to approve Sales Order {0}.").format(sales_order))
        
    frappe.model.workflow.apply_workflow(so, action)

    # Same ownership rule as the bulk approval path — merchandisers claim, admins don't.
    claim_customer_merchandiser(so.customer)


def setup_sales_order_workflow(force=False):
    if not force and frappe.db.exists("Workflow", "Sales Order Workflow"):
        return
        
    # Ensure Workflow States exist
    for s in ["Draft", "Pending Merchandiser Approval", "Pending Final Approval", "Approved", "Rejected"]:
        if not frappe.db.exists("Workflow State", s):
            state_doc = frappe.new_doc("Workflow State")
            state_doc.workflow_state_name = s
            state_doc.insert(ignore_permissions=True)
            
    # Ensure Merchandiser User role exists
    if not frappe.db.exists("Role", "Merchandiser User"):
        role_doc = frappe.new_doc("Role")
        role_doc.role_name = "Merchandiser User"
        role_doc.insert(ignore_permissions=True)

    # Ensure the Sales Order Final Approver role exists — see
    # order_flow_permissions.sync_sales_order_final_approver_role for why it
    # exists and how it stays assigned to the right users.
    if not frappe.db.exists("Role", "Sales Order Final Approver"):
        role_doc = frappe.new_doc("Role")
        role_doc.role_name = "Sales Order Final Approver"
        role_doc.desk_access = 1
        role_doc.insert(ignore_permissions=True)

    # Ensure Workflow Actions exist in Workflow Action Master
    for a in ["Submit for Merchandiser Approval", "Approve", "Reject"]:
        if not frappe.db.exists("Workflow Action Master", a):
            action_doc = frappe.new_doc("Workflow Action Master")
            action_doc.workflow_action_name = a
            action_doc.insert(ignore_permissions=True)

    if frappe.db.exists("Workflow", "Sales Order Workflow"):
        workflow = frappe.get_doc("Workflow", "Sales Order Workflow")
        workflow.states = []
        workflow.transitions = []
    else:
        workflow = frappe.new_doc("Workflow")
        workflow.workflow_name = "Sales Order Workflow"
        workflow.document_type = "Sales Order"
        workflow.workflow_state_field = "workflow_state"
        workflow.is_active = 1
        workflow.override_status = 1
    
    workflow.append("states", {"state": "Draft", "doc_status": 0, "allow_edit": "All"})
    workflow.append("states", {"state": "Pending Merchandiser Approval", "doc_status": 0, "allow_edit": "Merchandiser User"})
    workflow.append("states", {"state": "Pending Final Approval", "doc_status": 0, "allow_edit": "System Manager"})
    workflow.append("states", {"state": "Approved", "doc_status": 1, "allow_edit": "System Manager"})
    workflow.append("states", {"state": "Rejected", "doc_status": 0, "allow_edit": "All"})
    
    workflow.append("transitions", {
        "state": "Draft",
        "action": "Submit for Merchandiser Approval",
        "next_state": "Pending Merchandiser Approval",
        "allowed": "All"
    })
    workflow.append("transitions", {
        "state": "Draft",
        "action": "Reject",
        "next_state": "Rejected",
        "allowed": "All"
    })
    workflow.append("transitions", {
        "state": "Pending Merchandiser Approval",
        "action": "Approve",
        "next_state": "Pending Final Approval",
        "allowed": "Merchandiser User"
    })
    workflow.append("transitions", {
        "state": "Pending Merchandiser Approval",
        "action": "Reject",
        "next_state": "Rejected",
        "allowed": "Merchandiser User"
    })
    # Sales Order Final Approver also covers the merchandiser step, not just
    # final approval — a final approver can push an order through both
    # stages without needing the separate Merchandiser User role too.
    workflow.append("transitions", {
        "state": "Pending Merchandiser Approval",
        "action": "Approve",
        "next_state": "Pending Final Approval",
        "allowed": "Sales Order Final Approver"
    })
    workflow.append("transitions", {
        "state": "Pending Merchandiser Approval",
        "action": "Reject",
        "next_state": "Rejected",
        "allowed": "Sales Order Final Approver"
    })
    workflow.append("transitions", {
        "state": "Pending Final Approval",
        "action": "Approve",
        "next_state": "Approved",
        "allowed": "System Manager"
    })
    workflow.append("transitions", {
        "state": "Pending Final Approval",
        "action": "Reject",
        "next_state": "Rejected",
        "allowed": "System Manager"
    })
    # Extra rows for the SAME transition, each gated on a different role, are
    # the standard Frappe way to allow any one of several roles to trigger
    # it: System Manager and Super Admin for the admin override (matching
    # ADMIN_ROLES in order_flow_permissions.py — Super Admin exists
    # specifically to bypass Order Flow checks the same way System Manager
    # does, so it must clear this workflow gate too), and Sales Order Final
    # Approver for whoever is actually listed in Admin Settings > Sales
    # Order Final Approval (see
    # order_flow_permissions.sync_sales_order_final_approver_role).
    for extra_role in ("Super Admin", "Sales Order Final Approver"):
        workflow.append("transitions", {
            "state": "Pending Final Approval",
            "action": "Approve",
            "next_state": "Approved",
            "allowed": extra_role
        })
        workflow.append("transitions", {
            "state": "Pending Final Approval",
            "action": "Reject",
            "next_state": "Rejected",
            "allowed": extra_role
        })
    workflow.append("transitions", {
        "state": "Rejected",
        "action": "Submit for Merchandiser Approval",
        "next_state": "Pending Merchandiser Approval",
        "allowed": "All"
    })
    
    workflow.save(ignore_permissions=True)


def add_docshare(share_doctype, share_name, user, read=1, write=0, share=0, everyone=0, notify=0):
    if not user:
        return
        
    share_name_db = frappe.db.get_value("DocShare", {
        "share_doctype": share_doctype,
        "share_name": share_name,
        "user": user
    })
    
    if share_name_db:
        frappe.db.set_value("DocShare", share_name_db, {
            "read": read,
            "write": write,
            "share": share,
            "notify_by_email": notify
        }, update_modified=False)
    else:
        name = frappe.generate_hash(length=10)
        frappe.db.sql("""
            INSERT INTO `tabDocShare` 
            (name, creation, modified, modified_by, owner, docstatus, idx,
             share_doctype, share_name, user, `read`, `write`, share, notify_by_email, everyone)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (name, frappe.session.user or "Administrator", frappe.session.user or "Administrator",
              share_doctype, share_name, user, read, write, share, notify, everyone))


@frappe.whitelist()
def get_so_approvers(sales_order):
    _guard()
    so = frappe.get_doc("Sales Order", sales_order)
    state = so.workflow_state or "Draft"
    
    # Merchandiser info
    merchandiser = frappe.db.get_value("Customer", so.customer, "custom_merchandiser_user")
    merchandiser_fullname = None
    if merchandiser:
        merchandiser_fullname = frappe.db.get_value("User", merchandiser, "full_name") or merchandiser
        
    # Final approval info
    settings = frappe.get_doc("Admin Settings")
    final_users = [d.user for d in settings.sales_order_final_approval or []]
    final_fullnames = []
    for u in final_users:
        fn = frappe.db.get_value("User", u, "full_name") or u
        final_fullnames.append(fn)
        
    return {
        "state": state,
        "merchandiser": merchandiser,
        "merchandiser_fullname": merchandiser_fullname,
        "final_approvers": final_fullnames,
        "final_users": final_users
    }


@frappe.whitelist()
def get_merchandisers():
    _guard()
    return frappe.db.sql("""
        SELECT DISTINCT u.name, u.full_name
        FROM `tabUser` u
        JOIN `tabHas Role` hr ON hr.parent = u.name
        WHERE hr.role = 'Merchandiser User' AND u.enabled = 1
        ORDER BY u.full_name ASC
    """, as_dict=1)


@frappe.whitelist()
def get_last_seen():
    val = frappe.db.get_value("DefaultValue", {"parent": frappe.session.user, "defkey": "dac_order_flow_last_seen"}, "defvalue")
    return val or ""


@frappe.whitelist()
def set_last_seen(ts):
    # Check if value already exists for this user
    name = frappe.db.get_value("DefaultValue", {"parent": frappe.session.user, "defkey": "dac_order_flow_last_seen"}, "name")
    if name:
        frappe.db.set_value("DefaultValue", name, "defvalue", ts)
    else:
        # Create a new DefaultValue record
        doc = frappe.get_doc({
            "doctype": "DefaultValue",
            "parent": frappe.session.user,
            "parenttype": "User",
            "parentfield": "defaults",
            "defkey": "dac_order_flow_last_seen",
            "defvalue": ts
        })
        doc.insert(ignore_permissions=True)
    frappe.db.commit()


@frappe.whitelist()
def mark_notification_as_seen(event_doctype, event_name, event_docstatus=None, event_status=None, tab="tracker"):
    """Clear one notification on ONE tab, for the session user only."""
    seen_dict = _load_seen_dict()
    seen_dict[_seen_key(tab, event_doctype, event_name, event_docstatus, event_status)] = 1
    _save_seen_dict(seen_dict)
    return True


@frappe.whitelist()
def mark_all_notifications_as_seen(events, tab="tracker"):
    """
    Clear a batch of notifications on ONE tab only, for the session user only.

    "Mark all seen" is per tab by design: the same event surfaces on several
    tabs, and clearing the Purchase queue must not silently clear the Tracker
    for whoever works that one — see _seen_key.
    """
    import json
    if isinstance(events, str):
        events = json.loads(events)

    seen_dict = _load_seen_dict()
    for ev in events:
        seen_dict[_seen_key(tab, ev.get("doctype"), ev.get("name"),
                            ev.get("docstatus"), ev.get("status"))] = 1
    _save_seen_dict(seen_dict)
    return True


@frappe.whitelist()
def mark_notification_as_unseen(event_doctype, event_name, event_docstatus=None, event_status=None, tab="tracker"):
    """Bring one notification back as pending on ONE tab, for this user only."""
    seen_dict = _load_seen_dict()
    seen_dict.pop(_seen_key(tab, event_doctype, event_name, event_docstatus, event_status), None)
    _save_seen_dict(seen_dict)
    return True


@frappe.whitelist()
def repost_bin_qty(item_code, warehouse):
    _guard()
    from erpnext.stock.stock_balance import repost_stock
    repost_stock(item_code, warehouse, only_bin=True)
    return True



