"""POS Closing Entry built in one server call (docs/pos-store-scope.md › Close the POS).

The Point of Sale's "Close the POS" used to open an empty closing entry and let the
form load it in the browser. That load could run twice at once (ERPNext's own trigger
for the opening entry, plus the fill-in for entries made from the POS); both runs clear
the tables before filling them, so the entry came out empty or half-filled after a long
wait. Here the whole entry (bills, payments, taxes, totals) is built on the server
once, the same way the form computes it, and the form opens already filled.
"""

import frappe
from frappe import _
from frappe.utils import flt, get_datetime, now_datetime, nowdate, nowtime


def shift_invoices(pos_profile, start, end):
	"""Every submitted, not yet consolidated bill of the store made during the shift — by any
	user: the store's shift is shared (pos_cash.open_store_shift). ERPNext's get_pos_invoices
	takes only the bills of the user who opened it."""
	rows = frappe.db.sql("""select name, timestamp(posting_date, posting_time) as ts from `tabPOS Invoice`
		where docstatus = 1 and pos_profile = %s and ifnull(consolidated_invoice, '') = '' order by ts""",
		pos_profile, as_dict=True)
	start, end = get_datetime(start), get_datetime(end)
	return [frappe.get_doc("POS Invoice", r.name).as_dict() for r in rows if start <= get_datetime(r.ts) <= end]


@frappe.whitelist()
def get_pos_invoices(start, end, pos_profile, user=None):
	"""Replaces ERPNext's (the closing form calls it when the opening entry is picked): the
	store's bills in the shift, by any user."""
	frappe.has_permission("POS Profile", "read", pos_profile, throw=True)
	return shift_invoices(pos_profile, start, end)


from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import POSClosingEntry  # noqa: E402


class StorePOSClosingEntry(POSClosingEntry):
	"""hooks override_doctype_class: a store's shift is shared, so its closing may carry bills
	made by any of the store's users. Same checks as ERPNext, without "created by the user
	who opened the shift"."""

	def validate_pos_invoices(self):
		invalid_rows = []
		for d in self.pos_transactions:
			inv = frappe.db.get_value("POS Invoice", d.pos_invoice, ["consolidated_invoice", "pos_profile", "docstatus"],
									  as_dict=True) or frappe._dict()
			msg = []
			if inv.consolidated_invoice:
				msg.append(_("POS Invoice is already consolidated"))
			else:
				if inv.pos_profile != self.pos_profile:
					msg.append(_("POS Profile doesn't match {}").format(frappe.bold(self.pos_profile)))
				if inv.docstatus != 1:
					msg.append(_("POS Invoice is not submitted"))
			if msg:
				invalid_rows.append(_("Row #{}: {}").format(d.idx, " ".join(msg)))
		if invalid_rows:
			frappe.throw(invalid_rows, title=_("Invalid POS Invoices"), as_list=True)


@frappe.whitelist()
def make_closing_entry(pos_opening_entry):
	opening = frappe.get_doc("POS Opening Entry", pos_opening_entry)
	opening.check_permission("read")
	if opening.docstatus != 1 or opening.status != "Open":
		frappe.throw(_("POS Opening Entry {0} is not open.").format(frappe.bold(opening.name)))
	if opening.user != frappe.session.user and not frappe.has_permission("POS Closing Entry", "create"):
		frappe.throw(_("Not permitted."), frappe.PermissionError)

	doc = frappe.new_doc("POS Closing Entry")
	doc.update({
		"pos_opening_entry": opening.name, "period_start_date": opening.period_start_date,
		"period_end_date": now_datetime(), "posting_date": nowdate(), "posting_time": nowtime(),
		"pos_profile": opening.pos_profile, "user": opening.user, "company": opening.company,
		"grand_total": 0, "net_total": 0, "total_quantity": 0,
	})
	payments = {}
	for b in opening.balance_details:
		payments[b.mode_of_payment] = {"mode_of_payment": b.mode_of_payment, "opening_amount": flt(b.opening_amount),
									   "expected_amount": flt(b.opening_amount)}
	taxes = {}
	for inv in shift_invoices(opening.pos_profile, opening.period_start_date, doc.period_end_date):
		doc.append("pos_transactions", {"pos_invoice": inv.name, "posting_date": inv.posting_date,
										"grand_total": inv.grand_total, "customer": inv.customer})
		doc.grand_total += flt(inv.grand_total)
		doc.net_total += flt(inv.net_total)
		doc.total_quantity += flt(inv.total_qty)
		for p in inv.payments:
			amount = flt(p.amount)
			if p.account == inv.account_for_change_amount:
				amount -= flt(inv.change_amount)  # cash given back is not in the drawer
			row = payments.setdefault(p.mode_of_payment, {"mode_of_payment": p.mode_of_payment, "opening_amount": 0,
														  "expected_amount": 0})
			row["expected_amount"] += amount
		for t in inv.taxes:
			key = (t.account_head, flt(t.rate))
			row = taxes.setdefault(key, {"account_head": t.account_head, "rate": t.rate, "amount": 0})
			row["amount"] += flt(t.tax_amount)
	for f in ("grand_total", "net_total", "total_quantity"):
		doc.set(f, flt(doc.get(f), 2))
	# Every mode starts at its expected amount; the cashier changes it only where the drawer /
	# machine / app shows something else (pos_cash.py).
	for row in payments.values():
		row["expected_amount"] = flt(row["expected_amount"], 2)
		row["closing_amount"] = row["expected_amount"]
		row["difference"] = 0
		doc.append("payment_reconciliation", row)
	for row in taxes.values():
		row["amount"] = flt(row["amount"], 2)
		doc.append("taxes", row)
	return doc
