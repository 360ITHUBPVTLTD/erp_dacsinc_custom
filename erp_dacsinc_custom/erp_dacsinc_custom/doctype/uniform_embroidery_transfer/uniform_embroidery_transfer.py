# -*- coding: utf-8 -*-
# Copyright (c) 2026, Administrator and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class UniformEmbroideryTransfer(Document):
	"""Plain stock sent to the embroidery jobber, several item lines per transfer (Items), each
	coming back as an embroidered item (or the same item). Lines are received back in parts —
	each receipt line records its own warehouse and Stock Entry (uniform_transfer_api)."""

	def validate(self):
		if not self.get("items"):
			frappe.throw("Add at least one item line.")
		for row in self.items:
			if row.same_item or not row.target_item:
				row.target_item = row.target_item or row.source_item
				if row.same_item:
					row.target_item = row.source_item
			if flt(row.qty) <= 0:
				frappe.throw(f"Row {row.idx}: quantity sent must be greater than 0.")
			if flt(row.received_qty) - flt(row.qty) > 0.0005:
				frappe.throw(f"Row {row.idx}: received {row.received_qty} is more than the {row.qty} sent.")
			row.pending_qty = flt(flt(row.qty) - flt(row.received_qty), 6)
		self.total_qty = flt(sum(flt(r.qty) for r in self.items), 6)
		self.total_received = flt(sum(flt(r.received_qty) for r in self.items), 6)
		self.set_status()

	def on_trash(self):
		"""Deleting a transfer undoes its stock: the receipt Repack entries (newest first), then the
		Material Transfer that sent the goods, are cancelled (a draft one is deleted). The transfer
		only points at those Stock Entries, so without this Frappe deleted it and left the stock at
		the jobber / in the receiving warehouse. If any entry can't be cancelled — e.g. the
		embroidered items were already used, or another transfer shares the entry — the delete is
		refused and nothing changes (it all runs in the delete's transaction)."""
		entries = [r.stock_entry for r in reversed(self.get("receipts") or []) if r.stock_entry]
		if self.stock_entry_sent:
			entries.append(self.stock_entry_sent)
		for name in dict.fromkeys(entries):
			if not frappe.db.exists("Stock Entry", name):
				continue
			shared = frappe.db.sql("""
				SELECT name FROM `tabUniform Embroidery Transfer` WHERE stock_entry_sent = %(se)s AND name != %(me)s
				UNION
				SELECT parent FROM `tabUniform Embroidery Transfer Receipt`
				WHERE stock_entry = %(se)s AND parent != %(me)s AND parenttype = 'Uniform Embroidery Transfer'
			""", {"se": name, "me": self.name}, pluck=True)
			if shared:
				frappe.throw(f"Stock Entry {name} is also used by transfer {', '.join(map(str, shared))}. "
							 "Delete that transfer too, or cancel the Stock Entry yourself first.",
							 title="Can't undo the stock")
			se = frappe.get_doc("Stock Entry", name)
			try:
				if se.docstatus == 1:
					se.flags.ignore_permissions = True
					se.cancel()
				elif se.docstatus == 0:
					frappe.delete_doc("Stock Entry", name, ignore_permissions=True)
			except frappe.ValidationError as e:
				frappe.throw(f"Can't delete transfer {self.name}: its Stock Entry {name} can't be cancelled, so the stock "
							 f"it moved can't be put back.<br><br>{e}", title="Can't undo the stock")

	def set_status(self):
		if self.status == "Cancelled":
			return
		if self.total_received <= 0:
			self.status = "Sent"
		elif all(flt(r.received_qty) >= flt(r.qty) - 0.0005 for r in self.items):
			self.status = "Received"
		else:
			self.status = "Partially Received"
