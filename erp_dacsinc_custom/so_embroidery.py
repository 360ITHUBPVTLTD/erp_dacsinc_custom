"""
Full Piece embroidery sent straight from a Sales Order's own stock.

A Full Piece Embroidery Work Order (EWO) normally hangs off a Purchase
Order: goods made on a Subcontract PO (or bought on a direct PO) go out to a
Full Piece jobber and come back. Stock the business already holds needs the
same trip with no PO in between, so an EWO can instead carry the Sales Order
itself in `saels_order_id` (sic, the doctype's own fieldname) with
`purchase_order` left empty. Like the PO flow it only tracks qty sent and
received: no Stock Entry is posted either way, so while the goods are at the
jobber they are still in Bin. held_at_jobber_by_item is what keeps them from
being counted as pickable in the meantime.

The rule both routes share: a Sales Order line's qty goes to Full Piece
embroidery once, whichever route sends it. A BOM line made on a Subcontract
PO can be sent from that PO's own Full Piece dashboard; whatever was sent
there must not be offered again here, and vice versa. Both sides read the
same per-(sales_order, item_code) total from fp_sent_by_so_item and cap what
they offer by what the line still has left (so_fp_remaining).
"""

import json
from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import cint, flt, nowdate

FULL_PIECE = "Full Piece Job Work"
SENT_STAGE = "Sent to Full Piece Jobber"

# Pick List: qty currently out at a Full Piece jobber (claimed from this
# Pick List's own picked/allocated stock — see
# _consume_draft_pick_lists_for_embroidery) and which EWO is holding it.
# Zero/blank means nothing is held and the Pick List submits normally.
PL_HOLD_QTY_FIELD = "custom_embroidery_hold_qty"
PL_HOLD_EWO_FIELD = "custom_embroidery_ewo"
# Embroidery Work Order Item (native field — this app owns the doctype):
# [{"pick_list": name, "qty": qty}], which draft Pick List(s) this row's
# ordered_qty was claimed from, so receiving it back can release the
# matching hold(s) (see release_pick_list_holds). Blank for a row sent from
# plain free stock, or from a Purchase Order.
EWO_ITEM_SOURCE_FIELD = "source_pick_lists"


def create_embroidery_pick_list_fields():
    """
    Idempotent — wired to after_migrate so a deploy creates them; inserting
    a Custom Field adds the column itself, so no separate schema step is
    needed beyond bench migrate.

    Both Pick List fields are Custom Fields (Pick List is core/vendor-owned,
    same as the app's other Custom Field additions). Embroidery Work Order
    Item is owned by this app, so its field is added natively via the
    DocType record itself (see _ensure_ewo_item_source_field) rather than as
    a Custom Field — the same field either way appears on the doc.
    """
    fields = [
        {
            "dt": "Pick List",
            "fieldname": PL_HOLD_QTY_FIELD,
            "label": "Embroidery Hold Qty",
            "fieldtype": "Float",
            "insert_after": "parent_warehouse",
            "read_only": 1,
            "print_hide": 1,
            "no_copy": 1,
            "description": "Qty on this Pick List currently out at a Full Piece embroidery jobber (see so_embroidery.py). Blocks submitting this Pick List until it is received back.",
        },
        {
            "dt": "Pick List",
            "fieldname": PL_HOLD_EWO_FIELD,
            "label": "Embroidery Work Order",
            "fieldtype": "Link",
            "options": "Embroidery Work Order",
            "insert_after": PL_HOLD_QTY_FIELD,
            "read_only": 1,
            "print_hide": 1,
            "no_copy": 1,
            "depends_on": f"eval:doc.{PL_HOLD_QTY_FIELD}",
        },
    ]
    for field in fields:
        name = f"{field['dt']}-{field['fieldname']}"
        if frappe.db.exists("Custom Field", name):
            continue
        try:
            frappe.get_doc({"doctype": "Custom Field", **field}).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(title=f"Could not create {field['fieldname']} on {field['dt']}",
                              message=frappe.get_traceback())
    _ensure_ewo_item_source_field()
    frappe.db.commit()


def _ensure_ewo_item_source_field():
    """Adds `source_pick_lists` to the Embroidery Work Order Item DocType
    record directly (this app owns the doctype) — saving it syncs the
    column the same way `bench migrate` would from the doctype's own json,
    without needing a full migrate. Idempotent."""
    dt = frappe.get_doc("DocType", "Embroidery Work Order Item")
    if any(f.fieldname == EWO_ITEM_SOURCE_FIELD for f in dt.fields):
        return
    dt.append("fields", {
        "fieldname": EWO_ITEM_SOURCE_FIELD,
        "fieldtype": "Small Text",
        "label": "Source Pick Lists (JSON)",
        "hidden": 1,
        "allow_on_submit": 1,
        "insert_after": "pending_qty",
    })
    dt.save()


def fp_sent_by_so_item(sales_orders):
    """
    {(sales_order, item_code): {"so_direct", "so_direct_pending", "po_linked"}}

    so_direct          qty sent on EWOs raised from the Sales Order itself
    so_direct_pending  of that, still at the jobber (sent - received)
    po_linked          qty sent on EWOs raised from a Purchase Order whose
                       lines for this item belong to this Sales Order

    Submitted EWOs only; cancelled ones sent nothing and drafts are never
    created by either route.
    """
    sales_orders = tuple({s for s in (sales_orders or []) if s})
    out = {}
    if not sales_orders:
        return out

    def slot(so, item_code):
        return out.setdefault((so, item_code), {"so_direct": 0.0, "so_direct_pending": 0.0, "po_linked": 0.0})

    for r in frappe.db.sql("""
        SELECT ewo.saels_order_id AS sales_order, c.item_code,
               SUM(c.ordered_qty) AS sent,
               SUM(GREATEST(c.ordered_qty - IFNULL(c.received_qty, 0), 0)) AS pending
        FROM `tabEmbroidery Work Order Item` c
        JOIN `tabEmbroidery Work Order` ewo ON ewo.name = c.parent
        WHERE ewo.docstatus = 1 AND ewo.work_type = %(fp)s
          AND IFNULL(ewo.purchase_order, '') = ''
          AND ewo.saels_order_id IN %(sos)s
        GROUP BY ewo.saels_order_id, c.item_code
    """, {"fp": FULL_PIECE, "sos": sales_orders}, as_dict=1):
        s = slot(r.sales_order, r.item_code)
        s["so_direct"] += flt(r.sent)
        s["so_direct_pending"] += flt(r.pending)

    # A PO-linked EWO names its Purchase Order, not a Sales Order. Its qty
    # belongs to whichever orders that PO's lines for the same item were
    # raised against. On a Subcontract PO the line's item_code is the
    # service item and fg_item is the finished good the EWO carries. When
    # one PO covers the same item for more than one order, the EWO's qty is
    # split by line qty so no order is charged for another's embroidery.
    rows = frappe.db.sql("""
        SELECT c.name AS ewo_row, c.item_code, c.ordered_qty, poi.sales_order,
               SUM(IF(IFNULL(poi.fg_item, '') != '', poi.fg_item_qty, poi.qty)) AS line_qty
        FROM `tabEmbroidery Work Order Item` c
        JOIN `tabEmbroidery Work Order` ewo ON ewo.name = c.parent
        JOIN `tabPurchase Order Item` poi ON poi.parent = ewo.purchase_order
             AND IFNULL(NULLIF(poi.fg_item, ''), poi.item_code) = c.item_code
        WHERE ewo.docstatus = 1 AND ewo.work_type = %(fp)s
          AND ewo.purchase_order IN (
              SELECT DISTINCT parent FROM `tabPurchase Order Item` WHERE sales_order IN %(sos)s)
        GROUP BY c.name, c.item_code, c.ordered_qty, poi.sales_order
    """, {"fp": FULL_PIECE, "sos": sales_orders}, as_dict=1)

    by_row = defaultdict(list)
    for r in rows:
        by_row[r.ewo_row].append(r)
    for parts in by_row.values():
        total = sum(flt(p.line_qty) for p in parts)
        for p in parts:
            if p.sales_order not in sales_orders:
                continue
            share = flt(p.line_qty) / total if total > 0 else 1.0 / len(parts)
            slot(p.sales_order, p.item_code)["po_linked"] += flt(p.ordered_qty) * share

    return out


def held_at_jobber_by_item(item_codes):
    """
    {item_code: qty} still out with a Full Piece jobber on Sales-Order-raised
    EWOs, across every order. That stock never left Bin (no Stock Entry), so
    anything reading Bin as "free to pick or send" has to take this off.

    PO-linked EWOs are not counted here: their goods were never in this
    stock to begin with; they come back as Incoming for their own order.
    """
    item_codes = tuple({i for i in (item_codes or []) if i})
    if not item_codes:
        return {}
    return {r.item_code: flt(r.pending) for r in frappe.db.sql("""
        SELECT c.item_code, SUM(GREATEST(c.ordered_qty - IFNULL(c.received_qty, 0), 0)) AS pending
        FROM `tabEmbroidery Work Order Item` c
        JOIN `tabEmbroidery Work Order` ewo ON ewo.name = c.parent
        WHERE ewo.docstatus = 1 AND ewo.work_type = %(fp)s
          AND IFNULL(ewo.purchase_order, '') = ''
          AND IFNULL(ewo.saels_order_id, '') != ''
          AND c.item_code IN %(items)s
        GROUP BY c.item_code
    """, {"fp": FULL_PIECE, "items": item_codes}, as_dict=1)}


def so_line_totals(sales_order):
    """{item_code: {"qty", "delivered_qty"}} for one Sales Order, summed per item."""
    totals = {}
    for r in frappe.get_all("Sales Order Item", filters={"parent": sales_order},
                            fields=["item_code", "qty", "delivered_qty"]):
        t = totals.setdefault(r.item_code, {"qty": 0.0, "delivered_qty": 0.0})
        t["qty"] += flt(r.qty)
        t["delivered_qty"] += flt(r.delivered_qty)
    return totals


def so_fp_remaining(line, sent):
    """
    What of one Sales Order item can still go to Full Piece embroidery:
    ordered qty less whichever is larger, what has already gone out to the
    customer or what has already been sent by either route. Embroidered goods
    come back and are then delivered, so delivered and sent overlap rather
    than add up.
    """
    already = max(flt(line.get("delivered_qty")),
                  flt(sent.get("so_direct")) + flt(sent.get("po_linked")))
    return max(0.0, flt(line.get("qty")) - already)


def _draft_pick_list_rows(sales_order, item_code):
    """
    This order's own DRAFT Pick List Item rows for `item_code`, oldest
    first, each with the Pick List's own current hold (0 if none). A Pick
    List already on hold has nothing further to claim — an earlier send is
    still outstanding against it, and it must be received back before it
    can be claimed again.
    """
    rows = frappe.db.sql("""
        SELECT pli.parent, pli.name, pli.qty, pli.picked_qty,
               IFNULL(pl.%s, 0) AS hold_qty
        FROM `tabPick List Item` pli
        JOIN `tabPick List` pl ON pl.name = pli.parent
        WHERE pli.sales_order = %%(so)s AND pli.item_code = %%(item)s AND pl.docstatus = 0
        ORDER BY pl.creation ASC
    """ % PL_HOLD_QTY_FIELD, {"so": sales_order, "item": item_code}, as_dict=1)

    by_parent = defaultdict(list)
    for r in rows:
        by_parent[r.parent].append(r)
    return by_parent


def _consume_draft_pick_lists_for_embroidery(sales_order, item_code, qty):
    """
    FIFO-claims up to `qty` of `item_code` from this Sales Order's own
    draft Pick List(s) — the stock a draft Pick List reserves is already
    picked and sitting in the warehouse, so it is exactly what physically
    moves first if any of this item's stock goes out to a jobber. A Pick
    List already on hold (an earlier send still outstanding) is skipped —
    one hold must be resolved before another can be claimed against it.

    Returns (sources, remaining):
      sources    [{"pick_list", "qty"}] claimed, oldest Pick List first
      remaining  qty left unaccounted for — drawn from plain free stock,
                 with no Pick List to hold
    """
    by_parent = _draft_pick_list_rows(sales_order, item_code)
    sources = []
    remaining = flt(qty)
    for pl_name, pl_rows in by_parent.items():
        if remaining <= 0.001:
            break
        if flt(pl_rows[0].hold_qty) > 0.001:
            continue
        available = sum(flt(r.picked_qty) or flt(r.qty) for r in pl_rows)
        if available <= 0.001:
            continue
        take = min(available, remaining)
        sources.append({"pick_list": pl_name, "qty": take})
        remaining -= take
    return sources, remaining


def _apply_pick_list_hold(pick_list, qty, ewo_name):
    current = flt(frappe.db.get_value("Pick List", pick_list, PL_HOLD_QTY_FIELD))
    frappe.db.set_value("Pick List", pick_list, {
        PL_HOLD_QTY_FIELD: current + flt(qty),
        PL_HOLD_EWO_FIELD: ewo_name,
    }, update_modified=False)


def release_pick_list_holds(ewo_doc):
    """
    Call after saving received_qty on a Full Piece Embroidery Work Order
    (purchase_order.create_full_piece_receipt) — releases the matching
    Pick List hold(s) each row's qty was claimed from, in proportion to how
    much of the row has now come back.

    Recomputed from the row's own (cumulative) received_qty each time, not
    the incremental qty just received, so this is idempotent — safe to call
    unconditionally on every receipt, including a second partial one.
    """
    if ewo_doc.work_type != FULL_PIECE:
        return
    for row in ewo_doc.items:
        raw = row.get(EWO_ITEM_SOURCE_FIELD)
        if not raw:
            continue
        try:
            sources = json.loads(raw)
        except ValueError:
            continue
        remaining_received = flt(row.received_qty)
        for src in sources:
            pl_name, claimed = src.get("pick_list"), flt(src.get("qty"))
            if not pl_name:
                continue
            released_now = min(claimed, remaining_received)
            still_held = max(0.0, claimed - released_now)
            remaining_received = max(0.0, remaining_received - claimed)
            update = {PL_HOLD_QTY_FIELD: still_held}
            if still_held <= 0.001:
                update[PL_HOLD_EWO_FIELD] = None
            frappe.db.set_value("Pick List", pl_name, update, update_modified=False)


def guard_pick_list_hold_edit(doc, method=None):
    """
    Pick List validate / on_trash hook — while part of a draft Pick List is
    out at a Full Piece jobber, it can't be deleted and its qty can't drop
    below what is out (the hold would point at goods no longer on it).
    """
    hold = flt(doc.get(PL_HOLD_QTY_FIELD))
    if hold <= 0.001:
        return
    ewo = doc.get(PL_HOLD_EWO_FIELD) or _("an Embroidery Work Order")
    if method == "on_trash":
        frappe.throw(_("Pick List {0} has {1} out at a Full Piece embroidery jobber ({2}). "
                       "Receive it back before deleting this Pick List.").format(doc.name, hold, ewo),
                     title=_("Awaiting Embroidery"))
    total = sum(flt(r.get("qty")) for r in doc.get("locations") or [])
    if total + 0.001 < hold:
        frappe.throw(_("Pick List qty can't go below {0} — that much is out at a Full Piece embroidery "
                       "jobber ({1}). Receive it back first.").format(hold, ewo),
                     title=_("Awaiting Embroidery"))


def guard_pick_list_submit(doc, method=None):
    """Pick List before_submit hook — a Pick List can't be finalised while
    some of its qty is still out at a Full Piece embroidery jobber; the
    goods it would be submitted to ship are not physically here."""
    hold = flt(doc.get(PL_HOLD_QTY_FIELD))
    if hold <= 0.001:
        return
    ewo = doc.get(PL_HOLD_EWO_FIELD)
    ewo_ref = frappe.utils.get_link_to_form("Embroidery Work Order", ewo) if ewo else _("an Embroidery Work Order")
    frappe.throw(_(
        "{0} on this Pick List is still out at a Full Piece embroidery jobber on {1} — "
        "sent to jobber, need to collect. Receive it back before submitting this Pick List."
    ).format(flt(hold), ewo_ref), title=_("Awaiting Embroidery"))


def _submitted_pick_lists_for(sales_order, item_code):
    """
    This order's SUBMITTED Pick Lists for `item_code` with qty still
    undelivered — the stock a user may bring back to draft (revert_pick_list_to_draft)
    and then send for embroidery. Each carries `blocked_by`: the Delivery
    Note(s), draft or submitted, already made from it — once a DN exists the
    goods are on their way to the customer and cannot go to a jobber.
    """
    rows = frappe.db.sql("""
        SELECT pl.name, SUM(GREATEST(IFNULL(pli.picked_qty, 0) - IFNULL(pli.delivered_qty, 0), 0)) AS qty
        FROM `tabPick List Item` pli
        JOIN `tabPick List` pl ON pl.name = pli.parent
        WHERE pli.sales_order = %(so)s AND pli.item_code = %(item)s AND pl.docstatus = 1
          AND pl.status NOT IN ('Completed', 'Cancelled')
        GROUP BY pl.name
        HAVING qty > 0.001
        ORDER BY MIN(pl.creation)
    """, {"so": sales_order, "item": item_code}, as_dict=1)
    out = []
    for r in rows:
        dns = frappe.db.sql_list("""
            SELECT DISTINCT dni.parent FROM `tabDelivery Note Item` dni
            WHERE dni.against_pick_list = %s AND dni.docstatus < 2
        """, r.name)
        out.append({"pick_list": r.name, "qty": flt(r.qty, 3), "blocked_by": dns})
    return out


def _so_fp_rows(sales_order):
    """
    One rule: only qty on this order's DRAFT Pick List(s) can be sent to a
    Full Piece jobber. Free stock nobody picked cannot (pick it first), a
    submitted Pick List can be reverted to draft first (as long as no
    Delivery Note has been made from it), and delivered qty never can.
    """
    so = frappe.get_doc("Sales Order", sales_order)
    names = {}
    for it in so.items:
        names.setdefault(it.item_code, it.item_name)
    totals = so_line_totals(sales_order)
    sent_map = fp_sent_by_so_item([sales_order])

    rows = []
    for item_code, line in totals.items():
        sent = sent_map.get((sales_order, item_code), {})
        remaining = so_fp_remaining(line, sent)
        # Everything on unheld draft Pick Lists for this item on this order.
        draft_sources, _unused = _consume_draft_pick_lists_for_embroidery(sales_order, item_code, 10 ** 9)
        draft_qty = flt(sum(src["qty"] for src in draft_sources), 3)
        sendable = flt(min(remaining, draft_qty), 3)
        submitted = _submitted_pick_lists_for(sales_order, item_code)
        history = [_trip(r, flt(r.ordered_qty), flt(r.received_qty))
                   for r in _so_direct_ewo_rows(sales_order=sales_order, item_code=item_code)]
        rows.append({
            "item_code": item_code,
            "item_name": names.get(item_code) or item_code,
            "qty": flt(line["qty"]),
            "delivered_qty": flt(line["delivered_qty"]),
            "sent_from_so": flt(sent.get("so_direct"), 3),
            "sent_from_po": flt(sent.get("po_linked"), 3),
            "at_jobber": flt(sent.get("so_direct_pending"), 3),
            "remaining": flt(remaining, 3),
            "draft_pick_qty": draft_qty,
            "draft_pick_lists": [src["pick_list"] for src in draft_sources],
            "sendable": sendable,
            "from_draft_pick_list": sendable,
            # Submitted Pick Lists: revertable (no DN) vs locked (DN made).
            "submitted_pick_lists": submitted if remaining > 0.001 else [],
            # Every trip for this item on this order: sent → received.
            "embroidery_history": history,
        })
    return so, rows


@frappe.whitelist()
def revert_pick_list_to_draft(pick_list):
    """
    Bring a submitted Pick List back to draft (cancel + amend) so its qty can
    be sent for Full Piece embroidery. Refused once any Delivery Note — draft
    or submitted — has been made from it, or once any of it is delivered:
    that qty is on its way to (or with) the customer.
    Returns the new draft Pick List's name.
    """
    pl = frappe.get_doc("Pick List", pick_list)
    pl.check_permission("cancel")
    if pl.docstatus != 1:
        frappe.throw(_("Pick List {0} is not submitted.").format(pick_list))
    dns = frappe.db.sql_list("""
        SELECT DISTINCT parent FROM `tabDelivery Note Item`
        WHERE against_pick_list = %s AND docstatus < 2
    """, pick_list)
    if dns:
        frappe.throw(_(
            "Pick List {0} cannot go back to draft: Delivery Note {1} is already made from it. "
            "Goods on a Delivery Note cannot be sent for embroidery."
        ).format(pick_list, ", ".join(dns)), title=_("Already on a Delivery Note"))
    if any(flt(r.get("delivered_qty")) > 0.001 for r in pl.locations):
        frappe.throw(_("Pick List {0} is already partly delivered — it cannot go back to draft.").format(pick_list))

    pl.flags.ignore_links = True
    pl.cancel()
    new_pl = frappe.copy_doc(pl)
    new_pl.amended_from = pl.name
    new_pl.docstatus = 0
    for field in (PL_HOLD_QTY_FIELD, PL_HOLD_EWO_FIELD):
        new_pl.set(field, None)
    # A draft has picked nothing yet: keep what it is FOR (qty), clear what the
    # submitted one had picked/delivered — otherwise the draft reads
    # "20 picked" and the next submit starts from a stale figure.
    for loc in new_pl.locations:
        loc.picked_qty = 0
        loc.delivered_qty = 0
    new_pl.insert()
    frappe.msgprint(_("Pick List {0} is back in draft as {1}. You can now send it for embroidery.").format(
        pick_list, new_pl.name), indicator="green", alert=True)
    return new_pl.name


@frappe.whitelist()
def get_so_fp_embroidery_items(sales_order):
    """Per item on the order: what has gone to Full Piece embroidery by either route, and what can still go now."""
    frappe.has_permission("Sales Order", "read", sales_order, throw=True)
    so, rows = _so_fp_rows(sales_order)
    return {
        "items": rows,
        "can_create": bool(so.docstatus == 1 and so.status not in ("Closed", "Completed")
                           and frappe.has_permission("Embroidery Work Order", "create")),
    }


@frappe.whitelist()
def create_so_fp_embroidery(sales_order, items, supplier, notes=None, attachment_urls=None):
    """
    Send Sales Order stock to a Full Piece jobber: one submitted Embroidery
    Work Order carrying this order in saels_order_id and no Purchase Order.
    Receiving it back uses the same purchase_order.create_full_piece_receipt
    as a PO-linked one.

    `items` is [{"item_code", "qty"}]. Each qty is re-checked here against
    _so_fp_rows, the same figures the dialog showed, so a stale dialog or a
    second tab can never send the same qty twice.
    """
    frappe.has_permission("Sales Order", "read", sales_order, throw=True)
    if not frappe.has_permission("Embroidery Work Order", "create"):
        frappe.throw(_("You are not permitted to create Embroidery Work Orders."), frappe.PermissionError)
    if not supplier:
        frappe.throw(_("Select the Full Piece jobber."))

    items = json.loads(items) if isinstance(items, str) else (items or [])
    wanted = defaultdict(float)
    for i in items:
        if flt(i.get("qty")) > 0:
            wanted[i.get("item_code")] += flt(i.get("qty"))
    if not wanted:
        frappe.throw(_("Enter a quantity greater than 0 for at least one item."))

    # Two people sending from the same order at once would each pass the
    # check below on the same numbers; serialise on the Sales Order row.
    frappe.db.sql("SELECT name FROM `tabSales Order` WHERE name = %s FOR UPDATE", sales_order)
    so, rows = _so_fp_rows(sales_order)
    if so.docstatus != 1 or so.status in ("Closed", "Completed"):
        frappe.throw(_("Sales Order {0} must be submitted and open to send stock for embroidery.").format(sales_order))

    by_item = {r["item_code"]: r for r in rows}
    for item_code, qty in wanted.items():
        r = by_item.get(item_code)
        if not r:
            frappe.throw(_("Item {0} is not on Sales Order {1}.").format(item_code, sales_order))
        if qty > r["sendable"] + 0.001:
            frappe.throw(_(
                "Only {0} of {1} can be sent now — only qty on a DRAFT Pick List of this order can go to "
                "embroidery ({2} on draft Pick Lists, {3} still to send on this order). Create a Pick List "
                "first, or revert a submitted one to draft (not possible once a Delivery Note is made)."
            ).format(r["sendable"], item_code, r["draft_pick_qty"], r["remaining"]))

    ewo = frappe.new_doc("Embroidery Work Order")
    ewo.saels_order_id = sales_order
    ewo.work_type = FULL_PIECE
    ewo.full_piece_jobber = supplier
    ewo.full_piece_stage = SENT_STAGE
    ewo.date = nowdate()
    ewo.notes = notes
    # Which draft Pick List(s) each item's qty is claimed from (FIFO,
    # oldest first) — computed now, under the same Sales Order lock, so it
    # can never disagree with the cap just checked above (which is draft
    # Pick List qty only, so every unit sent holds a Pick List).
    claims_by_item = {}
    for item_code, qty in wanted.items():
        sources, _unused = _consume_draft_pick_lists_for_embroidery(sales_order, item_code, qty)
        claims_by_item[item_code] = sources
        ewo.append("items", {
            "item_code": item_code,
            "item_name": by_item[item_code]["item_name"],
            "ordered_qty": qty,
            "received_qty": 0,
            "pending_qty": qty,
            EWO_ITEM_SOURCE_FIELD: json.dumps(sources) if sources else None,
        })
    # Same as purchase_order.create_full_piece_send: the create permission is
    # checked above, submit rights are not required of whoever sends.
    ewo.insert(ignore_permissions=True)
    ewo.submit()

    # Hold each claimed Pick List — it now represents stock that is on its
    # way to a jobber, not ready to ship, so it must not be submitted (and
    # the goods behind it delivered) until this comes back. See
    # guard_pick_list_submit (Pick List's before_submit hook) and
    # release_pick_list_holds (called on receipt).
    for sources in claims_by_item.values():
        for src in sources:
            _apply_pick_list_hold(src["pick_list"], src["qty"], ewo.name)

    urls = json.loads(attachment_urls) if isinstance(attachment_urls, str) else (attachment_urls or [])
    for url in urls:
        if not url:
            continue
        unattached = frappe.get_all("File", filters={"file_url": url, "attached_to_name": None}, pluck="name", limit=1)
        if unattached:
            frappe.db.set_value("File", unattached[0], {
                "attached_to_doctype": "Embroidery Work Order", "attached_to_name": ewo.name})
        else:
            frappe.get_doc({"doctype": "File", "file_url": url,
                            "attached_to_doctype": "Embroidery Work Order",
                            "attached_to_name": ewo.name}).insert(ignore_permissions=True)

    return ewo.name


def cap_po_fp_balance(po_name, available_items):
    """
    PO-side counterpart of the rule above, applied to the PO Full Piece
    dashboard's available_items (purchase_order.get_full_piece_dashboard_data):
    each item's balance_avail is capped by what its Sales Order(s) still
    have left to send once Sales-Order-raised EWOs are counted too.
    Items on lines with no Sales Order are left as they are.
    """
    so_by_item = defaultdict(set)
    for r in frappe.db.sql("""
        SELECT IFNULL(NULLIF(fg_item, ''), item_code) AS item_code, sales_order
        FROM `tabPurchase Order Item`
        WHERE parent = %s AND IFNULL(sales_order, '') != ''
    """, po_name, as_dict=1):
        so_by_item[r.item_code].add(r.sales_order)
    if not so_by_item:
        return available_items

    all_sos = set().union(*so_by_item.values())
    sent_map = fp_sent_by_so_item(all_sos)
    totals = {so: so_line_totals(so) for so in all_sos}

    # One budget per item, spent down across rows: a Subcontract PO lists the
    # same finished good once per Sales Order line, and each row being offered
    # the whole of what is left would let the rows together exceed it.
    budget = {}
    for it in available_items:
        item_code = it.get("item_code")
        sos = so_by_item.get(item_code)
        if not sos:
            continue
        if item_code not in budget:
            budget[item_code] = sum(so_fp_remaining(totals[so].get(item_code, {}),
                                                    sent_map.get((so, item_code), {})) for so in sos)
        if budget[item_code] < flt(it.get("balance_avail")):
            it["balance_avail"] = int(budget[item_code])
            it["capped_by_so"] = 1
        budget[item_code] = max(0.0, budget[item_code] - flt(it.get("balance_avail")))
    return available_items


def validate_po_fp_send(po_name, items):
    """Server-side check for purchase_order.create_full_piece_send, same cap as cap_po_fp_balance."""
    wanted = defaultdict(float)
    for i in items:
        wanted[i.get("item_code")] += flt(i.get("qty"))
    capped = cap_po_fp_balance(po_name, [
        {"item_code": ic, "balance_avail": q} for ic, q in wanted.items()])
    for it in capped:
        if it.get("capped_by_so") and wanted[it["item_code"]] > flt(it["balance_avail"]) + 0.001:
            frappe.throw(_(
                "Only {0} of {1} can still go to Full Piece embroidery for its Sales Order — "
                "the rest has already been sent, from this Purchase Order or straight from the Sales Order."
            ).format(it["balance_avail"], it["item_code"]))


def _so_direct_ewo_rows(sales_order=None, item_code=None, pick_list_like=None):
    """Submitted SO-raised Full Piece EWO item rows (the embroidery trips),
    oldest first, with jobber name and the Pick List claim JSON."""
    cond, params = ["ewo.docstatus = 1", "IFNULL(ewo.purchase_order, '') = ''", "ewo.work_type = %(fp)s"], {"fp": FULL_PIECE}
    if sales_order:
        cond.append("ewo.saels_order_id = %(so)s"); params["so"] = sales_order
    if item_code:
        cond.append("c.item_code = %(item)s"); params["item"] = item_code
    if pick_list_like:
        cond.append("(" + " OR ".join(f"c.{EWO_ITEM_SOURCE_FIELD} LIKE %(pl{i})s" for i in range(len(pick_list_like))) + ")")
        params.update({f"pl{i}": f'%"{pl}"%' for i, pl in enumerate(pick_list_like)})
    return frappe.db.sql(f"""
        SELECT ewo.name AS ewo, ewo.date, ewo.saels_order_id AS sales_order, ewo.full_piece_jobber AS jobber,
               sup.supplier_name AS jobber_name, c.name AS ewo_item, c.item_code, c.ordered_qty, IFNULL(c.received_qty, 0) AS received_qty,
               c.{EWO_ITEM_SOURCE_FIELD} AS sources
        FROM `tabEmbroidery Work Order Item` c
        JOIN `tabEmbroidery Work Order` ewo ON ewo.name = c.parent
        LEFT JOIN `tabSupplier` sup ON sup.name = ewo.full_piece_jobber
        WHERE {' AND '.join(cond)}
        ORDER BY ewo.creation ASC
    """, params, as_dict=1)


def _trip(r, sent, received):
    return {"ewo": r.ewo, "ewo_item": r.get("ewo_item"), "sales_order": r.get("sales_order"),
            "date": str(r.date) if r.date else None, "jobber": r.jobber_name or r.jobber,
            "item_code": r.item_code, "sent": flt(sent, 3), "received": flt(received, 3),
            "at_jobber": flt(max(0.0, sent - received), 3)}


def embroidery_history_for_pick_lists(pick_lists):
    """
    {pick_list: [trip, ...]} — every Full Piece embroidery trip that drew on
    each Pick List, with what was sent and what has come back, kept after the
    hold is released so the Pick List always shows its embroidery history.
    Received qty is split across a row's source Pick Lists oldest first — the
    same order release_pick_list_holds releases them in.
    """
    pick_lists = [p for p in (pick_lists or []) if p]
    if not pick_lists:
        return {}
    wanted = set(pick_lists)
    out = defaultdict(list)
    for r in _so_direct_ewo_rows(pick_list_like=pick_lists):
        try:
            sources = json.loads(r.sources or "[]")
        except ValueError:
            continue
        left = flt(r.received_qty)
        for src in sources:
            claimed = flt(src.get("qty"))
            got = min(claimed, left)
            left = max(0.0, left - claimed)
            if src.get("pick_list") in wanted:
                out[src["pick_list"]].append(_trip(r, claimed, got))
    return dict(out)


@frappe.whitelist()
def get_pick_list_embroidery_history(pick_list):
    frappe.get_doc("Pick List", pick_list).check_permission("read")
    return embroidery_history_for_pick_lists([pick_list]).get(pick_list, [])


def embroidery_history_by_item(sales_order):
    """{item_code: [trip, ...]} — every SO-direct Full Piece trip of this order,
    sent and received, for the Item Stock & Action Plan row's history flag."""
    out = defaultdict(list)
    for r in _so_direct_ewo_rows(sales_order=sales_order):
        out[r.item_code].append(_trip(r, flt(r.ordered_qty), flt(r.received_qty)))
    return dict(out)


def pick_list_dn_map(pick_lists):
    """{pick_list: [Delivery Note, ...]} — DNs (draft or submitted) made from each."""
    pick_lists = [p for p in (pick_lists or []) if p]
    if not pick_lists:
        return {}
    out = defaultdict(list)
    for r in frappe.db.sql("""
        SELECT DISTINCT against_pick_list AS pl, parent FROM `tabDelivery Note Item`
        WHERE against_pick_list IN %(pls)s AND docstatus < 2
    """, {"pls": tuple(pick_lists)}, as_dict=1):
        out[r.pl].append(r.parent)
    return dict(out)


def pick_list_revert_state(rows):
    """
    Adds `delivery_notes` and `revertable` to Pick List rows (dicts with name,
    docstatus, and optionally delivered_qty): a SUBMITTED Pick List with no
    Delivery Note made from it and nothing delivered can go back to draft
    (revert_pick_list_to_draft). Once a DN exists, it can't.
    """
    dns = pick_list_dn_map(list({r["name"] for r in rows}))
    for r in rows:
        r["delivery_notes"] = dns.get(r["name"], [])
        r["revertable"] = bool(cint(r.get("docstatus")) == 1 and not r["delivery_notes"]
                               and flt(r.get("delivered_qty")) <= 0.001
                               and (r.get("status") or "") not in ("Completed", "Cancelled"))
    return rows


@frappe.whitelist()
def get_pick_list_state(pick_list):
    """Everything the Pick List form shows about embroidery and undo: trips
    (sent → back), what is still at the jobber, DNs made from it, revertable."""
    pl = frappe.get_doc("Pick List", pick_list)
    pl.check_permission("read")
    row = {"name": pl.name, "docstatus": pl.docstatus, "status": pl.status,
           "delivered_qty": sum(flt(l.get("delivered_qty")) for l in pl.locations)}
    pick_list_revert_state([row])
    row["history"] = embroidery_history_for_pick_lists([pl.name]).get(pl.name, [])
    row["hold_qty"] = flt(pl.get(PL_HOLD_QTY_FIELD))
    row["hold_ewo"] = pl.get(PL_HOLD_EWO_FIELD)
    return row


def guard_linked_embroidery(doc, method=None):
    """
    Purchase Order / Subcontracting Order before_cancel and on_trash: refuse
    while an Embroidery Work Order (draft or submitted) still points at it.
    Removing the PO/SCO under a live EWO leaves the EWO with a dead link —
    its goods can then never be received back (every save fails link
    validation) and the dashboard can only show it as "PO deleted".
    """
    field = "purchase_order" if doc.doctype == "Purchase Order" else "subcontracting_order"
    ewos = frappe.get_all("Embroidery Work Order", filters={field: doc.name, "docstatus": ["<", 2]}, pluck="name")
    if ewos:
        frappe.throw(_(
            "{0} {1} can't be {2} — Embroidery Work Order {3} still points at it. "
            "Cancel that Embroidery Work Order first."
        ).format(_(doc.doctype), doc.name, _("deleted") if method == "on_trash" else _("cancelled"), ", ".join(ewos)),
            title=_("Linked Embroidery Work Order"))
