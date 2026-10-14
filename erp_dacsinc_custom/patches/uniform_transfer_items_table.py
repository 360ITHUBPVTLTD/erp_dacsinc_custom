"""Uniform Embroidery Transfer now holds several item lines (Items table). Each transfer made
before that carried one item in header fields (source_item, target_item, qty, received_qty):
move it into one Items line, fill the item on its receipt rows, and set the totals. Safe to run
again — a transfer that already has lines is left alone."""

import frappe
from frappe.utils import flt


def execute():
    frappe.reload_doc("erp_dacsinc_custom", "doctype", "uniform_embroidery_transfer_item")
    frappe.reload_doc("erp_dacsinc_custom", "doctype", "uniform_embroidery_transfer_receipt")
    frappe.reload_doc("erp_dacsinc_custom", "doctype", "uniform_embroidery_transfer")
    done = 0
    for t in frappe.get_all("Uniform Embroidery Transfer",
                            fields=["name", "source_item", "target_item", "qty", "received_qty"]):
        if frappe.db.exists("Uniform Embroidery Transfer Item", {"parent": t.name, "parenttype": "Uniform Embroidery Transfer"}):
            continue
        if not t.source_item:
            continue
        row = frappe.get_doc({
            "doctype": "Uniform Embroidery Transfer Item", "parent": t.name, "parenttype": "Uniform Embroidery Transfer",
            "parentfield": "items", "idx": 1, "source_item": t.source_item, "target_item": t.target_item or t.source_item,
            "same_item": 1 if (t.target_item or t.source_item) == t.source_item else 0,
            "qty": flt(t.qty), "received_qty": flt(t.received_qty),
            "pending_qty": flt(flt(t.qty) - flt(t.received_qty), 6),
            "uom": frappe.db.get_value("Item", t.source_item, "stock_uom"),
        })
        row.db_insert()
        frappe.db.sql("""UPDATE `tabUniform Embroidery Transfer Receipt`
            SET source_item = %s, target_item = %s, item_row = %s
            WHERE parent = %s AND parenttype = 'Uniform Embroidery Transfer'""",
                      (t.source_item, t.target_item or t.source_item, row.name, t.name))
        frappe.db.set_value("Uniform Embroidery Transfer", t.name,
                            {"total_qty": flt(t.qty), "total_received": flt(t.received_qty)}, update_modified=False)
        done += 1
    print(f"moved {done} transfer(s) to the Items table")
