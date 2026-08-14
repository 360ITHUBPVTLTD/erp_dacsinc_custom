"""
Backfill received_qty (and a matching Receipts row) for Uniform Embroidery
Transfer records completed under the old, pre-partial-receive design.

That design had only a single, all-or-nothing receipt: status flipped
straight to "Received" with no separate quantity tracked, because the
transfer's own `qty` WAS the received quantity by definition. received_qty is
new and defaults to 0, so every record finished before this feature existed
now reads as "Received, but Received Qty: 0" — a visibly contradictory state
(confirmed live on this site before writing this patch). This makes that
history consistent with the new model: received_qty = qty, and one receipts
row reconstructed from the fields that already recorded that single receipt
(date_received, to_warehouse, stock_entry_received).
"""

import frappe


def execute():
    rows = frappe.db.sql("""
        SELECT name, qty, date_sent, date_received, to_warehouse, stock_entry_received
        FROM `tabUniform Embroidery Transfer`
        WHERE status = 'Received' AND received_qty < qty
    """, as_dict=True)

    for row in rows:
        doc = frappe.get_doc("Uniform Embroidery Transfer", row.name)
        doc.received_qty = row.qty
        if not doc.receipts:
            doc.append("receipts", {
                "date": row.date_received or row.date_sent,
                "qty": row.qty,
                "to_warehouse": row.to_warehouse,
                "stock_entry": row.stock_entry_received,
            })
        # Some legacy records point at items/warehouses/stock entries that no
        # longer exist. This backfill only reconciles received_qty/receipts
        # history and must not fail on unrelated dangling links elsewhere on
        # the same document.
        doc.flags.ignore_links = True
        doc.save(ignore_permissions=True)
    frappe.db.commit()
