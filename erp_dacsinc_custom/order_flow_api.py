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

import frappe
from frappe import _
from frappe.utils import flt, add_days, nowdate


# --------------------------------------------------------------------------
# Linkage
# --------------------------------------------------------------------------

_EVENT_SQL = """
    SELECT 'Material Request' AS doctype, mr.name, mri.sales_order AS sales_order,
           mr.modified AS ts, mr.creation AS created, mr.status, mr.docstatus, mr.owner,
           NULL AS party, NULL AS party_name
    FROM `tabMaterial Request Item` mri
    JOIN `tabMaterial Request` mr ON mr.name = mri.parent
    WHERE mri.sales_order IS NOT NULL AND mri.sales_order != '' AND mr.docstatus < 2
    GROUP BY mr.name, mri.sales_order, mr.modified, mr.creation, mr.status, mr.docstatus, mr.owner

    UNION ALL

    SELECT 'Purchase Order', po.name, poi.sales_order,
           po.modified, po.creation, po.status, po.docstatus, po.owner,
           po.supplier, sup.supplier_name
    FROM `tabPurchase Order Item` poi
    JOIN `tabPurchase Order` po ON po.name = poi.parent
    LEFT JOIN `tabSupplier` sup ON sup.name = po.supplier
    WHERE poi.sales_order IS NOT NULL AND poi.sales_order != '' AND po.docstatus < 2
    GROUP BY po.name, poi.sales_order, po.modified, po.creation, po.status, po.docstatus, po.owner, po.supplier, sup.supplier_name

    UNION ALL

    SELECT 'Purchase Receipt', pr.name, pri.sales_order,
           pr.modified, pr.creation, pr.status, pr.docstatus, pr.owner,
           pr.supplier, sup.supplier_name
    FROM `tabPurchase Receipt Item` pri
    JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
    LEFT JOIN `tabSupplier` sup ON sup.name = pr.supplier
    WHERE pri.sales_order IS NOT NULL AND pri.sales_order != '' AND pr.docstatus < 2
    GROUP BY pr.name, pri.sales_order, pr.modified, pr.creation, pr.status, pr.docstatus, pr.owner, pr.supplier, sup.supplier_name

    UNION ALL

    SELECT 'Subcontracting Receipt', scr.name, poi.sales_order,
           scr.modified, scr.creation, scr.status, scr.docstatus, scr.owner,
           scr.supplier, sup.supplier_name
    FROM `tabSubcontracting Receipt Item` scri
    JOIN `tabSubcontracting Receipt` scr ON scr.name = scri.parent
    JOIN `tabPurchase Order Item` poi ON poi.name = scri.purchase_order_item
    LEFT JOIN `tabSupplier` sup ON sup.name = scr.supplier
    WHERE poi.sales_order IS NOT NULL AND poi.sales_order != '' AND scr.docstatus < 2
    GROUP BY scr.name, poi.sales_order, scr.modified, scr.creation, scr.status, scr.docstatus, scr.owner, scr.supplier, sup.supplier_name

    UNION ALL

    -- Subcontracting Orders are tracked through their Purchase Order: the event
    -- carries the PO id, never the SCO id, so nothing in the dashboard links to
    -- a Subcontracting Order. The doctype label keeps the "job work" signal.
    SELECT 'Job Work (Subcontract)', sco.purchase_order, poi.sales_order,
           sco.modified, sco.creation, sco.status, sco.docstatus, sco.owner,
           sco.supplier, sup.supplier_name
    FROM `tabSubcontracting Order` sco
    JOIN `tabPurchase Order Item` poi ON poi.parent = sco.purchase_order
    LEFT JOIN `tabSupplier` sup ON sup.name = sco.supplier
    WHERE poi.sales_order IS NOT NULL AND poi.sales_order != '' AND sco.docstatus < 2
      AND sco.purchase_order IS NOT NULL AND sco.purchase_order != ''
    GROUP BY sco.purchase_order, poi.sales_order, sco.modified, sco.creation, sco.status, sco.docstatus, sco.owner, sco.supplier, sup.supplier_name

    UNION ALL

    SELECT 'Embroidery Work Order', ewo.purchase_order, poi.sales_order,
           ewo.modified, ewo.creation, ewo.status, ewo.docstatus, ewo.owner,
           COALESCE(ewo.full_piece_jobber, ewo.panel_jobber),
           COALESCE(fp.supplier_name, pn.supplier_name)
    FROM `tabEmbroidery Work Order` ewo
    JOIN `tabPurchase Order Item` poi ON poi.parent = ewo.purchase_order
    LEFT JOIN `tabSupplier` fp ON fp.name = ewo.full_piece_jobber
    LEFT JOIN `tabSupplier` pn ON pn.name = ewo.panel_jobber
    WHERE poi.sales_order IS NOT NULL AND poi.sales_order != '' AND ewo.docstatus < 2
    GROUP BY ewo.purchase_order, poi.sales_order, ewo.modified, ewo.creation, ewo.status, ewo.docstatus, ewo.owner,
             ewo.full_piece_jobber, ewo.panel_jobber, fp.supplier_name, pn.supplier_name

    UNION ALL

    SELECT 'Pick List', pl.name, pli.sales_order,
           pl.modified, pl.creation, pl.status, pl.docstatus, pl.owner,
           pl.customer, cust.customer_name
    FROM `tabPick List Item` pli
    JOIN `tabPick List` pl ON pl.name = pli.parent
    LEFT JOIN `tabCustomer` cust ON cust.name = pl.customer
    WHERE pli.sales_order IS NOT NULL AND pli.sales_order != '' AND pl.docstatus < 2
    GROUP BY pl.name, pli.sales_order, pl.modified, pl.creation, pl.status, pl.docstatus, pl.owner, pl.customer, cust.customer_name

    UNION ALL

    SELECT 'Delivery Note', dn.name, dni.against_sales_order,
           dn.modified, dn.creation, dn.status, dn.docstatus, dn.owner,
           dn.customer, cust.customer_name
    FROM `tabDelivery Note Item` dni
    JOIN `tabDelivery Note` dn ON dn.name = dni.parent
    LEFT JOIN `tabCustomer` cust ON cust.name = dn.customer
    WHERE dni.against_sales_order IS NOT NULL AND dni.against_sales_order != '' AND dn.docstatus < 2
    GROUP BY dn.name, dni.against_sales_order, dn.modified, dn.creation, dn.status, dn.docstatus, dn.owner, dn.customer, cust.customer_name

    UNION ALL

    SELECT 'Sales Invoice', si.name, sii.sales_order,
           si.modified, si.creation, si.status, si.docstatus, si.owner,
           si.customer, cust.customer_name
    FROM `tabSales Invoice Item` sii
    JOIN `tabSales Invoice` si ON si.name = sii.parent
    LEFT JOIN `tabCustomer` cust ON cust.name = si.customer
    WHERE sii.sales_order IS NOT NULL AND sii.sales_order != '' AND si.docstatus < 2
    GROUP BY si.name, sii.sales_order, si.modified, si.creation, si.status, si.docstatus, si.owner, si.customer, cust.customer_name

    UNION ALL

    SELECT 'Purchase Invoice', pi.name, poi.sales_order,
           pi.modified, pi.creation, pi.status, pi.docstatus, pi.owner,
           pi.supplier, sup.supplier_name
    FROM `tabPurchase Invoice Item` pii
    JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
    JOIN `tabPurchase Order Item` poi ON poi.parent = pii.purchase_order
    LEFT JOIN `tabSupplier` sup ON sup.name = pi.supplier
    WHERE poi.sales_order IS NOT NULL AND poi.sales_order != '' AND pi.docstatus < 2
    GROUP BY pi.name, poi.sales_order, pi.modified, pi.creation, pi.status, pi.docstatus, pi.owner, pi.supplier, sup.supplier_name
"""


def _guard():
    if not frappe.has_permission("Sales Order", "read"):
        frappe.throw(_("You are not permitted to view Sales Orders."), frappe.PermissionError)


def _from_date(days):
    return add_days(nowdate(), -abs(int(days or 120)))


# NOTE: merchandiser scoping applies ONLY to the SO Approvals tab and is handled
# inline in get_pending_approvals(). The dashboard tabs (Sales Tracker, Purchase
# Flow, Job Work & Embroidery, Accounts) are intentionally unscoped, so a
# Merchandiser User still sees the full downstream picture there.


# --------------------------------------------------------------------------
# Tab 1 — Sales Order tracker + activity
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_sales_tracker(days=120, search=None, scope="open", stage_filter=None, merchandiser=None, approval_stage=None):
    """
    Sales Orders ordered by most recent downstream activity, with exact stage & next action.
    """
    _guard()
    from_date = _from_date(days)

    if approval_stage in ("Draft", "Pending Merchandiser Approval", "Pending Final Approval", "Rejected"):
        conditions = ["so.docstatus = 0", "so.transaction_date >= %(from_date)s"]
    else:
        conditions = ["so.docstatus = 1", "so.transaction_date >= %(from_date)s"]
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


    orders = frappe.db.sql(f"""
        SELECT so.name, so.customer, so.customer_name, so.transaction_date, so.delivery_date,
               so.status, so.grand_total, so.currency, so.per_delivered, so.per_billed,
               so.owner, so.modified
        FROM `tabSales Order` so
        LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
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
        o["draft_pick_lists"] = []
        o["submitted_pick_lists"] = []
        o["open_pos"] = []
        o["receipts"] = []
        o["mrs"] = []
        o["jobworks"] = []
        o["embroidery_orders"] = []
        o["draft_invoices"] = []
        o["last_event"] = None
        o["last_event_on"] = None
        o["last_event_doc"] = None

    # Roll every linked document up to its Sales Order in one pass.
    events = frappe.db.sql(f"""
        SELECT sales_order, doctype, name, ts, status, docstatus
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
        row["counts"][dt] = row["counts"].get(dt, 0) + 1

        if dt == "Pick List":
            if ds == 0:
                if ev.name not in row["draft_pick_lists"]:
                    row["draft_pick_lists"].append(ev.name)
            elif ds == 1:
                if ev.name not in row["submitted_pick_lists"]:
                    row["submitted_pick_lists"].append(ev.name)
        elif dt == "Purchase Order":
            if ds == 1 and ev.name not in row["open_pos"]:
                row["open_pos"].append(ev.name)
        elif dt in ("Purchase Receipt", "Subcontracting Receipt"):
            if ds == 1 and ev.name not in row["receipts"]:
                row["receipts"].append(ev.name)
        elif dt == "Material Request":
            if ds == 1 and ev.name not in row["mrs"]:
                row["mrs"].append(ev.name)
        elif dt == "Job Work (Subcontract)":
            # ev.name is the Purchase Order, not the Subcontracting Order.
            if ds == 1 and ev.name not in row["jobworks"]:
                row["jobworks"].append(ev.name)
        elif dt == "Embroidery Work Order":
            if ds == 1 and ev.name not in row["embroidery_orders"]:
                row["embroidery_orders"].append(ev.name)
        elif dt == "Sales Invoice":
            if ds == 0 and ev.name not in row["draft_invoices"]:
                row["draft_invoices"].append(ev.name)

        if not row["last_event_on"]:
            row["last_event_on"] = ev.ts
            row["last_event"] = dt
            row["last_event_doc"] = ev.name

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
    delivered = flt(order.get("per_delivered"))
    billed = flt(order.get("per_billed"))
    draft_pls = order.get("draft_pick_lists") or []
    subm_pls = order.get("submitted_pick_lists") or []
    open_pos = order.get("open_pos") or []
    receipts = order.get("receipts") or []
    mrs = order.get("mrs") or []
    jobworks = order.get("jobworks") or []
    embroidery_orders = order.get("embroidery_orders") or []
    draft_invoices = order.get("draft_invoices") or []

    is_overdue = False
    today = nowdate()
    if order.get("delivery_date") and delivered < 100:
        if str(order["delivery_date"]) < today:
            is_overdue = True
    order["is_overdue"] = is_overdue

    if delivered >= 100 and billed >= 100:
        return {
            "stage_key": "completed",
            "stage_label": "Completed",
            "badge_class": "of-pill--ready",
            "icon": "check-circle",
            "action_type": "none",
            "action_label": "Completed",
            "action_btn_class": "of-btn-disabled"
        }

    if delivered >= 100 and billed < 100:
        if draft_invoices:
            inv_name = draft_invoices[0]
            return {
                "stage_key": "need_to_bill",
                "stage_label": "Need to Bill",
                "badge_class": "of-pill--need-bill",
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
                "stage_label": "Need to Bill",
                "badge_class": "of-pill--need-bill",
                "icon": "file-text-o",
                "action_type": "make_invoice",
                "action_label": "Create Sales Invoice",
                "action_btn_class": "of-btn--primary"
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

    if subm_pls:
        pl_name = subm_pls[0]
        return {
            "stage_key": "ready_to_deliver",
            "stage_label": "Ready for Delivery",
            "badge_class": "of-pill--dn",
            "icon": "truck",
            "target_doc": pl_name,
            "target_doctype": "Pick List",
            "action_type": "make_dn",
            "action_label": "Create Delivery Note",
            "action_btn_class": "of-btn--success"
        }

    if receipts:
        rcpt_name = receipts[0]
        return {
            "stage_key": "stock_received",
            "stage_label": "Stock Arrived (PL Needed)",
            "badge_class": "of-pill--ready",
            "icon": "inbox",
            "action_type": "make_picklist",
            "action_label": "Create Pick List",
            "action_btn_class": "of-btn--primary"
        }

    if embroidery_orders:
        ewo_name = embroidery_orders[0]
        return {
            "stage_key": "in_embroidery",
            "stage_label": "Embroidery",
            "badge_class": "of-pill--planned",
            "icon": "magic",
            "target_doc": ewo_name,
            "target_doctype": "Embroidery Work Order",
            "action_type": "open_doc",
            "action_label": f"Track Embroidery ({ewo_name})",
            "action_btn_class": "of-btn--info"
        }

    if jobworks:
        jw_name = jobworks[0]
        return {
            "stage_key": "in_jobwork",
            "stage_label": "In Job Work",
            "badge_class": "of-pill--planned",
            "icon": "cogs",
            "target_doc": jw_name,
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

    return {
        "stage_key": "newly_created",
        "stage_label": "Newly Created",
        "badge_class": "of-pill--new",
        "icon": "star",
        "action_type": "make_picklist_or_po",
        "action_label": "Create Pick List / PO",
        "action_btn_class": "of-btn--primary"
    }


@frappe.whitelist()
def get_activity(days=21, limit=80, merchandiser=None):
    """The notification stream: newest downstream events across all Sales Orders."""
    _guard()
    conditions = ["ev.ts >= %(from_date)s"]
    params = {"from_date": _from_date(days), "limit": int(limit)}
    
        
    rows = frappe.db.sql(f"""
        SELECT ev.*, so.customer_name, so.status AS so_status
        FROM ({_EVENT_SQL}) ev
        LEFT JOIN `tabSales Order` so ON so.name = ev.sales_order
        LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
        WHERE {' AND '.join(conditions)}
        ORDER BY ev.ts DESC
        LIMIT %(limit)s
    """, params, as_dict=1)
    return rows


# --------------------------------------------------------------------------
# Tab 2 — Purchase flow
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_purchase_flow(days=120, search=None, scope="open", merchandiser=None):
    """Purchase Orders with their receipt progress, tied back to the Sales Order."""
    _guard()
    conditions = ["po.docstatus < 2", "po.transaction_date >= %(from_date)s", "IFNULL(po.is_subcontracted, 0) = 0"]
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

    mr_conditions = ["mr.docstatus < 2", "mr.transaction_date >= %(from_date)s"]
    if scope == "open":
        mr_conditions.append("mr.status NOT IN ('Received', 'Stopped', 'Cancelled')")
        mr_conditions.append("(mri.sales_order IS NULL OR mri.sales_order = '' OR so.status NOT IN ('Closed', 'Completed', 'Cancelled'))")
    elif scope == "mine":
        mr_conditions.append("mr.owner = %(me)s")
    if search:
        mr_conditions.append("(mr.name LIKE %(q)s OR mri.sales_order LIKE %(q)s OR mri.item_code LIKE %(q)s)")


    pr_conditions = ["pr.docstatus < 2", "pr.posting_date >= %(from_date)s", "IFNULL(pr.is_subcontracted, 0) = 0"]
    scr_conditions = ["scr.docstatus < 2", "scr.posting_date >= %(from_date)s"]
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
                GROUP_CONCAT(DISTINCT pri.purchase_order ORDER BY pri.purchase_order SEPARATOR ', ') AS purchase_orders,
                SUM(pri.received_qty) AS qty
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
                GROUP_CONCAT(DISTINCT scri.purchase_order ORDER BY scri.purchase_order SEPARATOR ', '),
                SUM(scri.qty)
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
    conditions = ["po.docstatus < 2", "po.transaction_date >= %(from_date)s", "po.is_subcontracted = 1"]
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

    pr_conditions = ["pr.docstatus < 2", "pr.posting_date >= %(from_date)s", "pr.is_subcontracted = 1"]
    scr_conditions = ["scr.docstatus < 2", "scr.posting_date >= %(from_date)s"]
    ewo_conditions = ["ewo.docstatus < 2", "ewo.date >= %(from_date)s"]
    
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
                GROUP_CONCAT(DISTINCT pri.purchase_order ORDER BY pri.purchase_order SEPARATOR ', ') AS purchase_orders,
                SUM(pri.received_qty) AS qty
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
                GROUP_CONCAT(DISTINCT scri.purchase_order ORDER BY scri.purchase_order SEPARATOR ', ') AS purchase_orders,
                SUM(scri.qty) AS qty
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
               (SELECT SUM(c.ordered_qty) FROM `tabEmbroidery Work Order Item` c WHERE c.parent = ewo.name) AS ordered_qty,
               (SELECT SUM(c.received_qty) FROM `tabEmbroidery Work Order Item` c WHERE c.parent = ewo.name) AS received_qty,
               (SELECT GROUP_CONCAT(DISTINCT poi.sales_order ORDER BY poi.sales_order SEPARATOR ', ')
                  FROM `tabPurchase Order Item` poi WHERE poi.parent = ewo.purchase_order) AS sales_orders
        FROM `tabEmbroidery Work Order` ewo
        LEFT JOIN `tabSupplier` fp ON fp.name = ewo.full_piece_jobber
        LEFT JOIN `tabSupplier` pn ON pn.name = ewo.panel_jobber
        LEFT JOIN `tabPurchase Order` po ON po.name = ewo.purchase_order
        LEFT JOIN `tabPurchase Order Item` poi ON poi.parent = ewo.purchase_order
        LEFT JOIN `tabSales Order` so ON so.name = poi.sales_order
        LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
        WHERE {' AND '.join(ewo_conditions)}
        GROUP BY ewo.name, ewo.date, ewo.status, ewo.docstatus, ewo.work_type,
                 ewo.purchase_order, ewo.subcontracting_order, ewo.completed_on,
                 ewo.panel_stage, ewo.full_piece_stage, ewo.per_received,
                 ewo.panel_jobber, ewo.full_piece_jobber, fp.supplier_name, pn.supplier_name
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
    from_date = _from_date(days)
    params = {"from_date": from_date}

    si_conditions = ["si.docstatus = 1", "si.posting_date >= %(from_date)s"]
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
               GROUP_CONCAT(DISTINCT sii.sales_order ORDER BY sii.sales_order SEPARATOR ', ') AS sales_orders
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON si.name = sii.parent
        LEFT JOIN `tabCustomer` cust ON cust.name = si.customer
        WHERE {' AND '.join(si_conditions)}
        GROUP BY si.name, si.posting_date, si.due_date, si.status, si.docstatus,
                 si.customer, cust.customer_name, si.currency, si.grand_total, si.outstanding_amount
        ORDER BY si.posting_date DESC, si.name DESC
        LIMIT 300
    """, params, as_dict=1)

    pi_params = {"from_date": from_date}
    pi_conditions = ["pi.docstatus = 1", "pi.posting_date >= %(from_date)s"]
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
               GROUP_CONCAT(DISTINCT poi.sales_order ORDER BY poi.sales_order SEPARATOR ', ') AS sales_orders
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


@frappe.whitelist()
def get_approval_permissions():
    """
    What the current user is allowed to see on the SO Approval tab.

    The "Pending Final Approval" sub-tab is only for the users listed in
    Admin Settings > sales_order_final_approval (plus System Manager /
    Administrator). Everyone else should not even see the tab, let alone the
    bulk-approve controls inside it.
    """
    _guard()

    roles = frappe.get_roles()
    is_admin = "System Manager" in roles or frappe.session.user == "Administrator"

    final_users = []
    try:
        settings = frappe.get_doc("Admin Settings")
        final_users = [d.user for d in (settings.get("sales_order_final_approval") or []) if d.user]
    except Exception:
        frappe.log_error(title="Order Flow: could not read final approvers",
                         message=frappe.get_traceback())

    return {
        "user": frappe.session.user,
        "is_admin": is_admin,
        "is_merchandiser": "Merchandiser User" in roles,
        # Admins keep access so the workflow is never unadministrable.
        "is_final_approver": bool(is_admin or frappe.session.user in final_users),
        "final_approvers": final_users,
    }


@frappe.whitelist()
def get_pending_approvals(search=None, merchandiser=None, approval_stage=None):
    _guard()
    setup_sales_order_workflow()
    
    conditions = ["so.docstatus = 0"]
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
        is_merchandiser = "Merchandiser User" in frappe.get_roles() and "System Manager" not in frappe.get_roles() and frappe.session.user != "Administrator"
        if is_merchandiser and not is_final_approver:
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
        
        if doc.workflow_state == "Pending Final Approval":
            if "Merchandiser User" in frappe.get_roles():
                customer_merchandiser = frappe.db.get_value("Customer", doc.customer, "custom_merchandiser_user")
                if not customer_merchandiser:
                    frappe.db.set_value("Customer", doc.customer, "custom_merchandiser_user", frappe.session.user)


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
    
    if "Merchandiser User" in frappe.get_roles():
        customer_merchandiser = frappe.db.get_value("Customer", so.customer, "custom_merchandiser_user")
        if not customer_merchandiser:
            frappe.db.set_value("Customer", so.customer, "custom_merchandiser_user", frappe.session.user)


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


