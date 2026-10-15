"""
Overall (Additional) Discount that leaves chosen items alone.

An Item ticked "Exclude from Overall Discount" (e.g. Freight and Forwarding
Charges) keeps its full amount and GST on Quotation / Sales Order / Delivery
Note / Sales Invoice / POS Invoice when an overall discount is given:

  - Discount %  is taken on the other items only (the excluded rows, and the
    GST on them, are left out of the base).
  - The discount amount is spread over the other items only.

ERPNext spreads it over every row (taxes_and_totals.apply_discount_amount).
This patches that on the server (patch(), called from __init__.py); the form
does the same in public/js/overall_discount.js. Keep the two in step.
"""

import json

import frappe
from frappe import scrub
from frappe.utils import flt

FIELD = "custom_exclude_from_overall_discount"
DOCTYPES = ("Quotation", "Sales Order", "Delivery Note", "Sales Invoice", "POS Invoice")
ITEM_TABLES = ("Quotation Item", "Sales Order Item", "Delivery Note Item", "Sales Invoice Item", "POS Invoice Item")


def excluded_items(calc):
	if calc.doc.doctype not in DOCTYPES:
		return []
	return [item for item in calc._items if item.get(FIELD)]


def excluded_value(calc, items):
	"""What the excluded rows add to the discount base: their net amount, plus
	(discount on Grand Total) the percentage taxes on them at their own rates."""
	total = sum(flt(item.net_amount) for item in items)
	if calc.doc.apply_discount_on != "Grand Total":
		return total
	for item in items:
		item_tax_map = json.loads(item.item_tax_rate) if item.get("item_tax_rate") else {}
		for tax in calc.doc.get("taxes") or []:
			if tax.charge_type != "On Net Total" or tax.get("category") == "Valuation":
				continue
			rate = flt(item_tax_map.get(tax.account_head, tax.rate))
			sign = -1 if tax.get("add_deduct_tax") == "Deduct" else 1
			total += sign * flt(item.net_amount) * rate / 100
	return total


def patch():
	from erpnext.controllers.taxes_and_totals import calculate_taxes_and_totals as Calc

	if getattr(Calc, "_overall_discount_patched", False):
		return
	original_set = Calc.set_discount_amount
	original_apply = Calc.apply_discount_amount

	def set_discount_amount(self):
		original_set(self)
		items = excluded_items(self)
		if items and self.doc.additional_discount_percentage:
			base = flt(self.doc.get(scrub(self.doc.apply_discount_on))) - excluded_value(self, items)
			self.doc.discount_amount = flt(
				max(base, 0) * self.doc.additional_discount_percentage / 100,
				self.doc.precision("discount_amount"),
			)

	def apply_discount_amount(self):
		items = excluded_items(self)
		if (
			not items
			or not self.doc.discount_amount
			or (self.doc.apply_discount_on == "Grand Total" and self.doc.get("is_cash_or_non_trade_discount"))
		):
			return original_apply(self)

		self.doc.base_discount_amount = flt(
			self.doc.discount_amount * self.doc.conversion_rate, self.doc.precision("base_discount_amount")
		)
		total_for_discount_amount = self.get_total_for_discount_amount() - excluded_value(self, items)
		if total_for_discount_amount <= 0:
			frappe.throw(frappe._("Overall discount needs at least one item that is not excluded from it."))

		net_total = expected_net_total = 0
		for item in self._items:
			distributed_amount = 0 if item.get(FIELD) else (
				flt(self.doc.discount_amount) * item.net_amount / total_for_discount_amount
			)
			adjusted_net_amount = item.net_amount - distributed_amount
			expected_net_total += adjusted_net_amount
			item.net_amount = flt(adjusted_net_amount, item.precision("net_amount"))
			item.distributed_discount_amount = flt(distributed_amount, item.precision("distributed_discount_amount"))
			net_total += item.net_amount

			# rounding difference goes on a discounted row, never on an excluded one
			if not item.get(FIELD) and (
				rounding_difference := flt(expected_net_total - net_total, self.doc.precision("net_total"))
			):
				item.net_amount = flt(item.net_amount + rounding_difference, item.precision("net_amount"))
				item.distributed_discount_amount = flt(
					distributed_amount + rounding_difference, item.precision("distributed_discount_amount")
				)
				net_total += rounding_difference

			item.net_rate = flt(item.net_amount / item.qty, item.precision("net_rate")) if item.qty else 0
			self._set_in_company_currency(item, ["net_rate", "net_amount"])

		self.discount_amount_applied = True
		self._calculate()

	Calc.set_discount_amount = set_discount_amount
	Calc.apply_discount_amount = apply_discount_amount
	Calc._overall_discount_patched = True


def create_fields():
	"""Idempotent; wired to after_migrate. The tick lives on Item and is copied
	onto each selling row, so it travels with the row from Quotation to Sales
	Order to Delivery Note / Sales Invoice."""
	fields = [
		{
			"dt": "Item",
			"fieldname": FIELD,
			"label": "Exclude from Overall Discount",
			"fieldtype": "Check",
			"insert_after": "max_discount",
			"description": "Overall (Additional) Discount on Quotation / Sales Order / Delivery Note / "
			"Sales Invoice / POS Invoice is not applied to this item, e.g. freight or packing charges.",
		},
	] + [
		{
			"dt": dt,
			"fieldname": FIELD,
			"label": "Exclude from Overall Discount",
			"fieldtype": "Check",
			"insert_after": "distributed_discount_amount",
			"fetch_from": f"item_code.{FIELD}",
			"read_only": 1,
		}
		for dt in ITEM_TABLES
	]
	for field in fields:
		if frappe.db.exists("Custom Field", f"{field['dt']}-{field['fieldname']}"):
			continue
		try:
			frappe.get_doc({"doctype": "Custom Field", **field}).insert(ignore_permissions=True)
		except Exception:
			frappe.log_error(
				title=f"Could not create {field['fieldname']} on {field['dt']}", message=frappe.get_traceback()
			)
	frappe.db.commit()
