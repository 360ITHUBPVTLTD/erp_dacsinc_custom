# Copyright (c) 2025, Pankaj and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt, now_datetime

STOCK_TRANSFER = "Stock Transfer"


class EmbroideryWorkOrder(Document):
	"""Full Piece / Panel job work (tracked only, no stock moves — purchase_order.py, so_embroidery.py), or a
	**Stock Transfer**: free plain stock sent to an embroidery jobber, each line coming back as an embroidered
	item (or the same item). A Stock Transfer moves stock — one Material Transfer to the jobber's WIP warehouse
	when it is made, a Repack per received line — and is made and received only from Order Flow › Embroidery
	Transfers (uniform_transfer_api). Everything below applies to Stock Transfers only."""

	def is_stock_transfer(self):
		return self.work_type == STOCK_TRANSFER

	def validate(self):
		if not self.is_stock_transfer():
			return
		if self.is_new() and not self.flags.from_transfer_api:
			frappe.throw("A Stock Transfer moves stock: create it from Order Flow › Embroidery Transfers › Create Transfer.")
		self.update_transfer_totals()

	def before_update_after_submit(self):
		# receiving saves the submitted work order: validate() doesn't run then
		if self.is_stock_transfer():
			self.update_transfer_totals()

	def update_transfer_totals(self):
		"""Lines (same item, pending), totals, % received and status: Open → Partially Received → Completed."""
		if not self.get("items"):
			frappe.throw("Add at least one item line.")
		for row in self.items:
			if row.same_item or not row.target_item:
				row.target_item = row.item_code if row.same_item else (row.target_item or row.item_code)
			if flt(row.ordered_qty) <= 0:
				frappe.throw(f"Row {row.idx}: quantity sent must be greater than 0.")
			if flt(row.received_qty) - flt(row.ordered_qty) > 0.0005:
				frappe.throw(f"Row {row.idx}: received {row.received_qty} is more than the {row.ordered_qty} sent.")
			row.pending_qty = flt(flt(row.ordered_qty) - flt(row.received_qty), 6)
		self.total_qty = flt(sum(flt(r.ordered_qty) for r in self.items), 6)
		self.total_received = flt(sum(flt(r.received_qty) for r in self.items), 6)
		self.per_received = flt(self.total_received / self.total_qty * 100, 2) if self.total_qty else 0
		if self.total_received <= 0:
			self.status = "Open"
		elif all(flt(r.received_qty) >= flt(r.ordered_qty) - 0.0005 for r in self.items):
			self.status = "Completed"
			self.completed_on = self.completed_on or now_datetime()
		else:
			self.status = "Partially Received"

	def on_cancel(self):
		"""Cancelling a Stock Transfer undoes its stock: the receipt Repack entries (newest first), then the
		Material Transfer that sent the goods. On cancel, not before: until this work order is cancelled its links
		to those entries block their cancel. If any can't be cancelled (e.g. the embroidered items were already
		used) the cancel is refused and nothing changes (it all runs in the cancel's transaction)."""
		if not self.is_stock_transfer():
			return
		entries = [r.stock_entry for r in reversed(self.get("receipts") or []) if r.stock_entry]
		if self.stock_entry_sent:
			entries.append(self.stock_entry_sent)
		for name in dict.fromkeys(entries):
			if not frappe.db.exists("Stock Entry", name):
				continue
			se = frappe.get_doc("Stock Entry", name)
			try:
				if se.docstatus == 1:
					se.flags.ignore_permissions = True
					se.cancel()
				elif se.docstatus == 0:
					frappe.delete_doc("Stock Entry", name, ignore_permissions=True)
			except frappe.ValidationError as e:
				frappe.throw(f"Can't cancel {self.name}: its Stock Entry {name} can't be cancelled, so the stock it "
							 f"moved can't be put back.<br><br>{e}", title="Can't undo the stock")
