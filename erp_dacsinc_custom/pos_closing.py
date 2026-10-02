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


@frappe.whitelist()
def make_closing_entry(pos_opening_entry):
	opening = frappe.get_doc("POS Opening Entry", pos_opening_entry)
	opening.check_permission("read")
	if opening.docstatus != 1 or opening.status != "Open":
		frappe.throw(_("POS Opening Entry {0} is not open.").format(frappe.bold(opening.name)))
	if opening.user != frappe.session.user and not frappe.has_permission("POS Closing Entry", "create"):
		frappe.throw(_("Not permitted."), frappe.PermissionError)

	from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import get_pos_invoices

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
	for inv in get_pos_invoices(opening.period_start_date, get_datetime(doc.period_end_date), opening.pos_profile, opening.user):
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
