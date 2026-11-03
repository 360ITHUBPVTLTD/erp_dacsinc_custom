"""Embroidery Transfers are now Embroidery Work Orders of work type Stock Transfer (user, 03-11-2026;
docs/order-flow-dashboard.md › Embroidery Transfers). Every Uniform Embroidery Transfer still on the site (oldest
first, cancelled ones left alone) becomes a submitted Stock Transfer work order in the EM/26-27/00001 series — the
same lines, receipts, jobber, warehouses and Stock Entries; no stock moves — so the next work order continues the
series. The old record is then deleted without its on_trash (which would cancel those Stock Entries); it stays in
Deleted Documents. Safe to run again: a converted transfer no longer exists."""

import frappe
from frappe.utils import getdate

DAY = "03-11-2026"


def execute():
	for t in frappe.get_all("Uniform Embroidery Transfer", filters={"status": ["!=", "Cancelled"]}, pluck="name", order_by="creation asc"):
		old = frappe.get_doc("Uniform Embroidery Transfer", t)
		ewo = frappe.new_doc("Embroidery Work Order")
		ewo.update({"work_type": "Stock Transfer", "date": old.date_sent or getdate(old.creation), "full_piece_jobber": old.supplier,
			"notes": old.notes, "from_warehouse": old.from_warehouse, "wip_warehouse": old.wip_warehouse,
			"to_warehouse": old.to_warehouse, "stock_entry_sent": old.stock_entry_sent,
			"stock_entry_received": old.stock_entry_received, "date_received": old.date_received})
		for r in old.items:
			ewo.append("items", {"item_code": r.source_item, "item_name": frappe.db.get_value("Item", r.source_item, "item_name"),
				"target_item": r.target_item, "same_item": r.same_item, "ordered_qty": r.qty, "received_qty": r.received_qty,
				"uom": r.uom or frappe.db.get_value("Item", r.source_item, "stock_uom")})
		for r in old.get("receipts") or []:
			ewo.append("receipts", {"date": r.date, "qty": r.qty, "to_warehouse": r.to_warehouse, "stock_entry": r.stock_entry,
				"source_item": r.source_item, "target_item": r.target_item, "item_row": r.item_row})
		ewo.flags.from_transfer_api = True
		ewo.insert(ignore_permissions=True)
		ewo.submit()
		# receipts point at their line: the old line's name → the new one (same order)
		lines = {o.name: n.name for o, n in zip(old.items, ewo.items)}
		for r in ewo.receipts:
			if r.item_row in lines:
				r.db_set("item_row", lines[r.item_row], update_modified=False)
		frappe.db.set_value("Embroidery Work Order", ewo.name, "owner", old.owner, update_modified=False)
		frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Embroidery Work Order",
			"reference_name": ewo.name, "content": f"{DAY}: was Uniform Embroidery Transfer {old.name} (sent {old.date_sent}). "
				"Embroidery transfers are now Stock Transfer work orders; its Stock Entries are unchanged."}).insert(ignore_permissions=True)
		frappe.delete_doc("Uniform Embroidery Transfer", old.name, ignore_permissions=True, ignore_on_trash=True, force=True)
		print(f"uniform_transfer_to_ewo: transfer {old.name} → {ewo.name}")
