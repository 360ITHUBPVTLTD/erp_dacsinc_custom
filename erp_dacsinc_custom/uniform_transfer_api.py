# -*- coding: utf-8 -*-
# Copyright (c) 2026, Administrator and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import nowdate, flt

from erp_dacsinc_custom.order_flow_permissions import guard_act, guard_tab
from erp_dacsinc_custom.order_flow_api import _paged_query, _attach_creator_names

def _free_stock(item_code, warehouse):
    """What can really leave `warehouse`: stock on hand minus what is held for Sales Orders
    (stock_hold: Pick Lists, embroidery at the jobber, raw-material earmarks — held only in the
    hold warehouse). Returns (actual, held, free, holds[])."""
    from erp_dacsinc_custom import stock_hold

    actual = flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty"))
    holds, held = [], 0.0
    if warehouse == stock_hold.HOLD_WAREHOUSE:
        for h, got in stock_hold.allocate(stock_hold.holds_for([item_code]).get(item_code, []), actual):
            if got > 0:
                held += got
                holds.append({"kind": h["kind"], "doc": h["doc"], "sales_order": h.get("sales_order"), "qty": got})
    return actual, flt(held, 3), flt(max(0.0, actual - held), 3), holds


@frappe.whitelist()
def create_embroidery_transfers(lines, from_warehouse, wip_warehouse):
    """Embroidery Transfers tab › Create Transfer: several lines at once — each line is a plain
    (source) item, the embroidered (target) item it comes back as (the same item when it only
    goes for embroidery), and a qty. One Stock Entry moves every line from `from_warehouse` to
    the jobber's WIP warehouse, and ONE Uniform Embroidery Transfer holds every line (Items)
    to follow them back.
    Only free stock may go: a source item's lines together may not exceed what is not held for
    Sales Orders (_free_stock) — no override here."""
    import json
    guard_tab("uniform")
    guard_act("uniform")
    lines = json.loads(lines) if isinstance(lines, str) else (lines or [])
    clean = []
    for n, l in enumerate(lines, 1):
        src, tgt, qty = (l.get("source_item") or "").strip(), (l.get("target_item") or "").strip(), flt(l.get("qty"))
        if not src and not qty:
            continue
        if not src:
            frappe.throw(f"Line {n}: choose the plain (source) item.")
        tgt = tgt or (src if l.get("same_item") else "")
        if not tgt:
            frappe.throw(f"Line {n}: choose the embroidered (target) item, or tick Same item.")
        if qty <= 0:
            frappe.throw(f"Line {n}: quantity must be greater than 0.")
        clean.append({"source_item": src, "target_item": tgt, "qty": qty})
    if not clean:
        frappe.throw("Add at least one line.")
    if not from_warehouse or not wip_warehouse:
        frappe.throw("Choose the From Warehouse and the WIP Warehouse.")

    wanted = {}
    for l in clean:
        wanted[l["source_item"]] = wanted.get(l["source_item"], 0) + l["qty"]
    short = []
    for item, qty in wanted.items():
        actual, held, free, _ = _free_stock(item, from_warehouse)
        if qty - free > 0.0005:
            short.append(f"{item}: {qty:g} asked, only {free:g} free in {from_warehouse} "
                         f"({actual:g} on hand, {held:g} held for Sales Orders)")
    if short:
        frappe.throw("Only free stock can go to embroidery:<br>" + "<br>".join(short), title="Not enough free stock")

    se = frappe.new_doc("Stock Entry")
    se.purpose = "Material Transfer"
    se.stock_entry_type = "Material Transfer"
    se.from_warehouse = from_warehouse
    se.to_warehouse = wip_warehouse
    for l in clean:
        se.append("items", {"item_code": l["source_item"], "qty": l["qty"],
                            "uom": frappe.db.get_value("Item", l["source_item"], "stock_uom"),
                            "s_warehouse": from_warehouse, "t_warehouse": wip_warehouse})
    se.insert(ignore_permissions=True)
    se.submit()

    uet = frappe.new_doc("Uniform Embroidery Transfer")
    uet.update({"from_warehouse": from_warehouse, "wip_warehouse": wip_warehouse, "status": "Sent",
                "date_sent": nowdate(), "stock_entry_sent": se.name})
    for l in clean:
        uet.append("items", {"source_item": l["source_item"], "target_item": l["target_item"],
                             "same_item": 1 if l["source_item"] == l["target_item"] else 0, "qty": l["qty"]})
    uet.insert(ignore_permissions=True)
    return {"transfers": [uet.name], "transfer": uet.name, "stock_entry": se.name}


@frappe.whitelist()
def create_embroidery_transfer(source_item, target_item, qty, from_warehouse, wip_warehouse):
    """One line — kept for callers of the old single-line dialog (same rules as above)."""
    r = create_embroidery_transfers([{"source_item": source_item, "target_item": target_item, "qty": qty}],
                                    from_warehouse, wip_warehouse)
    return r["transfer"]

@frappe.whitelist()
def receive_embroidery_transfer(transfer_id, lines=None, to_warehouse=None, qty=None):
    """Receive embroidered items back against a transfer, line by line.

    lines: [{"row": <Items row name>, "qty": <received now>, "to_warehouse": <where it goes>}] —
    each line its own quantity and warehouse; lines with no qty are skipped. Every received line
    gets its own Repack Stock Entry (plain item out of the jobber's WIP, embroidered item into
    that line's warehouse), so each item's valuation is its own, and its own row in Receipts.
    A line can be received in parts; the transfer is Partially Received until every line is back.
    (to_warehouse / qty without lines: the old single-line call — the only line, or every
    pending line in full.)"""
    import json
    guard_tab("uniform")  # exclusively invoked from that tab's "Receive" button
    guard_act("uniform")
    uet = frappe.get_doc("Uniform Embroidery Transfer", transfer_id)
    if uet.status not in ("Sent", "Partially Received"):
        frappe.throw(f"Transfer {transfer_id} has already been fully received or cancelled.")
    lines = json.loads(lines) if isinstance(lines, str) else (lines or [])
    if not lines:
        if not to_warehouse:
            frappe.throw("Choose where the received items go.")
        pending = [r for r in uet.items if flt(r.qty) - flt(r.received_qty) > 0.0005]
        lines = [{"row": r.name, "to_warehouse": to_warehouse,
                  "qty": (flt(qty) if (qty not in (None, "") and len(pending) == 1) else flt(r.qty) - flt(r.received_qty))}
                 for r in pending]

    by_row = {r.name: r for r in uet.items}
    todo = []
    for l in lines:
        q = flt(l.get("qty"))
        if q <= 0:
            continue
        row = by_row.get(l.get("row"))
        if not row:
            frappe.throw("A line to receive is not on this transfer — refresh and try again.")
        pending = flt(row.qty) - flt(row.received_qty)
        if q - pending > 0.0005:
            frappe.throw(f"Row {row.idx} ({row.target_item}): cannot receive {q:g} — only {pending:g} is pending.")
        if not l.get("to_warehouse"):
            frappe.throw(f"Row {row.idx} ({row.target_item}): choose the warehouse it goes to.")
        todo.append((row, q, l["to_warehouse"]))
    if not todo:
        frappe.throw("Enter the quantity received for at least one line.")

    for row, q, wh in todo:
        se = frappe.new_doc("Stock Entry")
        se.purpose = "Repack"
        se.stock_entry_type = "Repack"
        se.append("items", {"item_code": row.source_item, "qty": q, "s_warehouse": uet.wip_warehouse,
                            "uom": frappe.db.get_value("Item", row.source_item, "stock_uom")})
        se.append("items", {"item_code": row.target_item, "qty": q, "t_warehouse": wh,
                            "uom": frappe.db.get_value("Item", row.target_item, "stock_uom")})
        se.insert(ignore_permissions=True)
        se.submit()
        row.received_qty = flt(row.received_qty) + q
        uet.append("receipts", {"date": nowdate(), "qty": q, "to_warehouse": wh, "stock_entry": se.name,
                                "source_item": row.source_item, "target_item": row.target_item, "item_row": row.name})
        uet.to_warehouse = wh
        uet.stock_entry_received = se.name
    uet.date_received = nowdate()
    uet.save(ignore_permissions=True)   # validate(): pending, totals, status
    return {"status": uet.status, "received_qty": uet.total_received,
            "outstanding": flt(uet.total_qty) - flt(uet.total_received)}

@frappe.whitelist()
def get_embroidery_transfers(status=None, search=None, scope=None, page=1, page_size=100, **kwargs):
    """
    Returns the list of Uniform Embroidery Transfers, filtered by status,
    scope, and/or search query — every other tab's "Open orders" / "Created
    by me" dropdown actually narrows that tab's list; this one used to accept
    `scope` and silently ignore it, so switching the dropdown here had no
    effect at all and a fully Received transfer still showed under "Open".

    `status` (the tab's own Status dropdown) and `scope` are independent axes
    and can combine: `scope="mine"` narrows to transfers this user created,
    on top of whatever status is chosen. But an explicit `status` always wins
    over scope's own open/closed bucketing — picking "Received" from the
    Status dropdown must show Received transfers even while "Open orders" is
    still selected in the other dropdown, not silently intersect with it.
    """
    guard_tab("uniform")
    conditions = []
    values = {}

    if status:
        conditions.append("uet.status = %(status)s")
        values["status"] = status
    elif scope == "open":
        # "Open" here means still in progress — not yet fully received.
        conditions.append("uet.status IN ('Sent', 'Partially Received')")

    if scope == "mine":
        conditions.append("uet.owner = %(me)s")
        values["me"] = frappe.session.user

    if search:
        conditions.append("""(uet.name LIKE %(search)s OR EXISTS (SELECT 1 FROM `tabUniform Embroidery Transfer Item` li
                             WHERE li.parent = uet.name AND (li.source_item LIKE %(search)s OR li.target_item LIKE %(search)s)))""")
        values["search"] = f"%{search}%"

    # The page's custom date range ("from~to") narrows by date sent. "Last N days" is not
    # applied here: this tab has always listed every transfer.
    days = kwargs.get("days")
    if days and "~" in str(days):
        from erp_dacsinc_custom.order_flow_api import _from_date, _to_next
        conditions.append("uet.date_sent >= %(from_date)s AND uet.date_sent < %(to_next)s")
        values["from_date"], values["to_next"] = _from_date(days), _to_next(days)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    transfers = _paged_query(f"""
        SELECT uet.name, uet.total_qty AS qty, uet.total_received AS received_qty, uet.from_warehouse, uet.wip_warehouse,
               uet.to_warehouse, uet.status, uet.date_sent, uet.date_received, uet.stock_entry_sent,
               uet.stock_entry_received, uet.owner
        FROM `tabUniform Embroidery Transfer` uet
        {where_clause}
        ORDER BY uet.creation DESC
    """, values, page, page_size)
    # each transfer's item lines (several per transfer)
    names = [r.name for r in transfers["rows"]]
    lines = {}
    if names:
        for li in frappe.get_all("Uniform Embroidery Transfer Item", filters={"parent": ["in", names], "parenttype": "Uniform Embroidery Transfer"},
                                 fields=["name", "parent", "idx", "source_item", "target_item", "same_item", "qty", "received_qty", "uom"],
                                 order_by="idx asc"):
            li.pending_qty = flt(flt(li.qty) - flt(li.received_qty), 6)
            lines.setdefault(li.parent, []).append(li)
    for r in transfers["rows"]:
        r["items"] = lines.get(r.name, [])
        r["source_item"] = r["items"][0].source_item if len(r["items"]) == 1 else ""
        r["target_item"] = r["items"][0].target_item if len(r["items"]) == 1 else ""
    _attach_creator_names(transfers["rows"])
    return transfers

@frappe.whitelist()
def get_transfer_receipts(transfer_id):
    """The row toggle on the Embroidery Transfers tab: the transfer's item lines and its receipt
    history (each receipt with its item, qty, warehouse and Stock Entry)."""
    guard_tab("uniform")
    return {
        "items": frappe.get_all("Uniform Embroidery Transfer Item",
            filters={"parent": transfer_id, "parenttype": "Uniform Embroidery Transfer"},
            fields=["name", "idx", "source_item", "target_item", "same_item", "qty", "received_qty", "pending_qty", "uom"],
            order_by="idx asc"),
        "receipts": frappe.get_all("Uniform Embroidery Transfer Receipt",
            filters={"parent": transfer_id, "parenttype": "Uniform Embroidery Transfer"},
            fields=["date", "qty", "to_warehouse", "stock_entry", "source_item", "target_item"], order_by="idx asc"),
    }


@frappe.whitelist()
def get_item_stock_details(item_code, warehouse):
    """Stock of an item in a warehouse for the transfer dialog: on hand, what is held for Sales
    Orders (with the documents), and what is free to send (net_available)."""
    guard_tab("uniform")  # exclusively invoked from that tab's transfer dialog
    actual, held, free, holds = _free_stock(item_code, warehouse)
    return {"actual_qty": actual, "held_qty": held, "holds": holds, "net_available": free,
            "stock_uom": frappe.db.get_value("Item", item_code, "stock_uom")}
