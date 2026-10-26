"""Outstanding balance on the Customer / Supplier list views (public/js/party_balance_list.js).

The figure is the party's ledger balance — the ERPNext standard "Party Balance" (as on a Payment
Entry): GL Entries of the party, not cancelled, for the company. It nets unpaid invoices, credit /
debit notes, advances and adjustments. Customer: debit − credit (positive = they owe us);
Supplier: credit − debit (positive = we owe them). Plus the count of unpaid submitted invoices /
bills and how many are past their due date. Only for FINANCE_ROLES (Admin, System Manager, Accounts
Executive, Accounts Manager) who may also read that party and its invoices (Sales Invoice for
customers, Purchase Invoice for suppliers) — others get nothing.
"""

import json

import frappe
from frappe.utils import cint, flt, nowdate

INVOICE = {"Customer": ("Sales Invoice", "customer"), "Supplier": ("Purchase Invoice", "supplier")}

# Who sees a party's money on the Customer / Supplier list and form (and may adjust its advances).
FINANCE_ROLES = ("Admin", "System Manager", "Accounts Executive", "Accounts Manager")


def can_see_balances(user=None):
	return bool(set(frappe.get_roles(user)) & set(FINANCE_ROLES))


@frappe.whitelist()
def get_party_balances(party_type, names, company=None):
	if party_type not in INVOICE:
		return {}
	inv_dt, inv_field = INVOICE[party_type]
	if not can_see_balances() or not (frappe.has_permission(party_type, "read") and frappe.has_permission(inv_dt, "read")):
		return {}
	names = json.loads(names) if isinstance(names, str) else (names or [])
	names = [n for n in names if n][:500]
	if not names:
		return {}
	company = company or frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
	sign = "debit - credit" if party_type == "Customer" else "credit - debit"
	out = {n: {"balance": 0.0, "open": 0, "overdue": 0} for n in names}
	for r in frappe.db.sql(f"""SELECT party, SUM({sign}) AS bal FROM `tabGL Entry`
			WHERE party_type = %(pt)s AND party IN %(names)s AND company = %(company)s AND is_cancelled = 0
			GROUP BY party""", {"pt": party_type, "names": tuple(names), "company": company}, as_dict=1):
		out[r.party]["balance"] = flt(r.bal, 2)
	for r in frappe.db.sql(f"""SELECT {inv_field} AS party, COUNT(*) AS n, SUM(due_date < %(today)s) AS late
			FROM `tab{inv_dt}` WHERE docstatus = 1 AND IFNULL(is_return, 0) = 0 AND outstanding_amount > 0.005
			AND company = %(company)s AND {inv_field} IN %(names)s GROUP BY {inv_field}""",
			{"names": tuple(names), "company": company, "today": nowdate()}, as_dict=1):
		out[r.party]["open"] = cint(r.n)
		out[r.party]["overdue"] = cint(r.late)
	return out


@frappe.whitelist()
def get_party_summary(party_type, party, company=None):
	"""Account Summary on the Customer / Supplier form (public/js/party_summary.js): balance, unpaid
	invoices / bills with ageing, overdue, advances not yet used, open credit / debit notes, recent
	payments, this financial year's billing and payments, credit limit. Same access rule as the list
	pill; payments only for users who may read Payment Entries."""
	from erpnext.accounts.utils import get_fiscal_year
	from frappe.utils import date_diff, getdate

	if party_type not in INVOICE:
		return {}
	inv_dt, inv_field = INVOICE[party_type]
	if not can_see_balances() or not (frappe.has_permission(party_type, "read", party) and frappe.has_permission(inv_dt, "read")):
		return {}
	company = company or frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
	customer = party_type == "Customer"
	today = getdate(nowdate())
	sign = "debit - credit" if customer else "credit - debit"
	balance = flt(frappe.db.sql(f"""SELECT SUM({sign}) FROM `tabGL Entry` WHERE party_type = %s AND party = %s
		AND company = %s AND is_cancelled = 0""", (party_type, party, company))[0][0], 2)

	fields = ["name", "posting_date", "due_date", "grand_total", "rounded_total", "outstanding_amount", "status"]
	if not customer:
		fields.append("bill_no")
	unpaid = frappe.get_all(inv_dt, filters={inv_field: party, "company": company, "docstatus": 1, "is_return": 0,
		"outstanding_amount": [">", 0.005]}, fields=fields, order_by="due_date asc, posting_date asc", limit_page_length=500)
	ageing = {"not_due": 0.0, "d30": 0.0, "d60": 0.0, "d90": 0.0, "d90p": 0.0}
	overdue_amt, overdue_n = 0.0, 0
	for r in unpaid:
		r["invoice_total"] = flt(r.rounded_total) or flt(r.grand_total)
		late = date_diff(today, r.due_date) if r.due_date else 0
		r["days_overdue"] = max(late, 0)
		out = flt(r.outstanding_amount)
		if late <= 0:
			ageing["not_due"] += out
		else:
			overdue_amt += out
			overdue_n += 1
			ageing["d30" if late <= 30 else "d60" if late <= 60 else "d90" if late <= 90 else "d90p"] += out
	notes = frappe.get_all(inv_dt, filters={inv_field: party, "company": company, "docstatus": 1, "is_return": 1,
		"outstanding_amount": ["<", -0.005]}, fields=["name", "posting_date", "return_against", "outstanding_amount"],
		order_by="posting_date desc", limit_page_length=50)
	drafts = frappe.db.count(inv_dt, {inv_field: party, "company": company, "docstatus": 0})

	try:
		fy = get_fiscal_year(today, company=company, as_dict=True)
		fy_from, fy_to, fy_name = fy.year_start_date, fy.year_end_date, fy.name
	except Exception:
		fy_from, fy_to, fy_name = getdate(f"{today.year}-01-01"), today, str(today.year)
	billed = flt(frappe.db.sql(f"""SELECT SUM(IF(base_rounded_total != 0, base_rounded_total, base_grand_total)) FROM `tab{inv_dt}` WHERE {inv_field} = %s AND company = %s
		AND docstatus = 1 AND posting_date BETWEEN %s AND %s""", (party, company, fy_from, fy_to))[0][0], 2)
	last_invoice = frappe.db.get_value(inv_dt, {inv_field: party, "company": company, "docstatus": 1, "is_return": 0},
		"posting_date", order_by="posting_date desc")

	can_pe = frappe.has_permission("Payment Entry", "read")
	advances, payments, paid_fy = [], [], 0.0
	if can_pe:
		pe_filters = {"party_type": party_type, "party": party, "company": company, "docstatus": 1}
		advances = frappe.get_all("Payment Entry", filters=dict(pe_filters, unallocated_amount=[">", 0.005]),
			fields=["name", "posting_date", "unallocated_amount", "mode_of_payment", "reference_no"],
			order_by="posting_date desc", limit_page_length=50)
		payments = frappe.get_all("Payment Entry", filters=pe_filters,
			fields=["name", "posting_date", "payment_type", "paid_amount", "mode_of_payment", "reference_no", "custom_bulk_payment"],
			order_by="posting_date desc, creation desc", limit_page_length=8)
		paid_fy = flt(frappe.db.sql("""SELECT SUM(paid_amount) FROM `tabPayment Entry` WHERE party_type = %s AND party = %s
			AND company = %s AND docstatus = 1 AND payment_type = %s AND posting_date BETWEEN %s AND %s""",
			(party_type, party, company, "Receive" if customer else "Pay", fy_from, fy_to))[0][0], 2)

	orders = _order_status(party_type, party, company)
	credit_limit = 0.0
	if customer:
		credit_limit = flt(frappe.db.get_value("Customer Credit Limit", {"parent": party, "parenttype": "Customer",
			"company": company}, "credit_limit"))
	terms = frappe.db.get_value(party_type, party, "payment_terms")
	return {
		"company": company, "currency": frappe.get_cached_value("Company", company, "default_currency"),
		"balance": balance, "unpaid": unpaid, "outstanding": flt(sum(flt(r.outstanding_amount) for r in unpaid), 2),
		"overdue": flt(overdue_amt, 2), "overdue_count": overdue_n, "ageing": ageing,
		"notes": notes, "drafts": drafts, "advances": advances, "payments": payments, "can_pe": can_pe,
		"advance_total": flt(sum(flt(a.unallocated_amount) for a in advances), 2),
		"fy": fy_name, "billed_fy": billed, "paid_fy": paid_fy, "last_invoice": last_invoice,
		"credit_limit": credit_limit, "payment_terms": terms, "orders": orders,
		"can_pay": bool(frappe.has_permission("Payment Entry", "create") and frappe.has_permission("Payment Entry", "submit")),
	}


def _order_status(party_type, party, company):
	"""Where the party's orders stand (Sales Orders for a customer, Purchase Orders for a supplier):
	drafts (Sales Orders by their approval state), open orders, value still to deliver / receive and
	value delivered / received but not billed — values with tax, in company currency."""
	customer = party_type == "Customer"
	dt = "Sales Order" if customer else "Purchase Order"
	field = "customer" if customer else "supplier"
	done = "delivered_qty" if customer else "received_qty"
	args = {"party": party, "company": company}
	drafts = frappe.db.sql(f"""SELECT {"IFNULL(NULLIF(workflow_state, ''), 'Draft')" if customer else "'Draft'"} AS state,
			COUNT(*) AS n, SUM(base_grand_total) AS amt
		FROM `tab{dt}` WHERE {field} = %(party)s AND company = %(company)s AND docstatus = 0 GROUP BY state""", args, as_dict=1)
	open_ = frappe.db.sql(f"""SELECT status, COUNT(*) AS n, SUM(base_grand_total) AS amt FROM `tab{dt}`
		WHERE {field} = %(party)s AND company = %(company)s AND docstatus = 1
		AND status NOT IN ('Completed', 'Closed', 'Cancelled') GROUP BY status""", args, as_dict=1)
	# per item, scaled from the item's own value to the order's value with tax (grand / total)
	pend = frappe.db.sql(f"""SELECT
			SUM(GREATEST(i.qty - i.{done}, 0) * i.base_rate * o.base_grand_total / NULLIF(o.base_total, 0)) AS to_do,
			COUNT(DISTINCT IF(i.qty - i.{done} > 0.0001, o.name, NULL)) AS n_do,
			SUM(GREATEST(i.{done} * i.rate - i.billed_amt, 0) * o.conversion_rate * o.base_grand_total / NULLIF(o.base_total, 0)) AS to_bill,
			COUNT(DISTINCT IF(i.{done} * i.rate - i.billed_amt > 0.01, o.name, NULL)) AS n_bill
		FROM `tab{dt} Item` i JOIN `tab{dt}` o ON o.name = i.parent
		WHERE o.{field} = %(party)s AND o.company = %(company)s AND o.docstatus = 1
		AND o.status NOT IN ('Completed', 'Closed', 'Cancelled')""", args, as_dict=1)[0]
	completed = frappe.db.count(dt, {field: party, "company": company, "docstatus": 1, "status": ["in", ["Completed", "Closed"]]})
	return {
		"doctype": dt,
		"drafts": [{"state": d.state, "n": cint(d.n), "amount": flt(d.amt, 2)} for d in drafts],
		"draft_n": sum(cint(d.n) for d in drafts), "draft_amount": flt(sum(flt(d.amt) for d in drafts), 2),
		"open": [{"status": o.status, "n": cint(o.n), "amount": flt(o.amt, 2)} for o in open_],
		"open_n": sum(cint(o.n) for o in open_), "open_amount": flt(sum(flt(o.amt) for o in open_), 2),
		"to_do": flt(pend.to_do, 2), "to_do_n": cint(pend.n_do),
		"to_bill": flt(pend.to_bill, 2), "to_bill_n": cint(pend.n_bill),
		"completed_n": completed,
	}


# ── Adjust advances / credit notes against unpaid invoices (the Account Summary's "Adjust") ─────────
# ERPNext's own Payment Reconciliation does the work (the same as Accounting › Payment Reconciliation):
# its unreconciled entries are the credits (advances on Payment Entries, Journal Entries, credit /
# debit notes) and the invoices; the allocation rows are built the way its allocate_entries builds
# them, for the invoices and amounts the user chose; reconcile() posts them (Payment Ledger,
# references on the Payment Entry, outstanding on the invoice).

def _reconciliation(party_type, party, company):
	from erpnext.accounts.party import get_party_account

	if party_type not in INVOICE:
		frappe.throw(frappe._("Unknown party type."))
	if not can_see_balances() or not (frappe.has_permission(party_type, "read", party) and frappe.has_permission("Payment Reconciliation", "write")):
		frappe.throw(frappe._("You are not allowed to adjust advances (Payment Reconciliation)."), frappe.PermissionError)
	company = company or frappe.defaults.get_user_default("Company")
	pr = frappe.new_doc("Payment Reconciliation")
	pr.company, pr.party_type, pr.party = company, party_type, party
	pr.receivable_payable_account = get_party_account(party_type, party, company)
	if cint(frappe.get_cached_value("Company", company, "book_advance_payments_in_separate_party_account")):
		pr.default_advance_account = frappe.get_cached_value(
			"Company", company, "default_advance_received_account" if party_type == "Customer" else "default_advance_paid_account")
	pr.get_unreconciled_entries()
	return pr


def _credit_key(p):
	return f"{p.reference_type}|{p.reference_name}|{p.reference_row or ''}"


@frappe.whitelist()
def get_adjustable(party_type, party, company=None):
	"""The party's unused credits (oldest first) and unpaid invoices, as Payment Reconciliation sees them."""
	pr = _reconciliation(party_type, party, company)
	inv_dt, inv_field = INVOICE[party_type]
	due = {r.name: r.due_date for r in frappe.get_all(inv_dt, filters={inv_field: party, "docstatus": 1,
		"outstanding_amount": [">", 0.005]}, fields=["name", "due_date"])}
	return {
		"credits": [{"key": _credit_key(p), "type": p.reference_type, "name": p.reference_name, "date": p.posting_date,
					 "amount": flt(p.amount), "remarks": (p.remarks or "")[:120]} for p in pr.payments],
		"invoices": [{"type": i.invoice_type, "name": i.invoice_number, "date": i.invoice_date, "due_date": due.get(i.invoice_number),
					  "amount": flt(i.amount), "outstanding": flt(i.outstanding_amount)} for i in pr.invoices],
	}


@frappe.whitelist()
def adjust_advances(party_type, party, credits, invoices, company=None):
	"""Set the chosen credits (keys, used oldest first) against the chosen invoices ([{name, amount}], in
	the order given) — Payment Reconciliation's allocation + reconcile."""
	credits = json.loads(credits) if isinstance(credits, str) else credits
	invoices = json.loads(invoices) if isinstance(invoices, str) else invoices
	pr = _reconciliation(party_type, party, company)
	pays = [p for p in pr.payments if _credit_key(p) in set(credits or [])]
	inv_by = {i.invoice_number: i for i in pr.invoices}
	want = []
	for x in invoices or []:
		inv, amt = inv_by.get(x.get("name")), flt(x.get("amount"), 2)
		if amt <= 0:
			continue
		if not inv:
			frappe.throw(frappe._("{0} has nothing left to adjust.").format(x.get("name")))
		if amt - flt(inv.outstanding_amount) > 0.005:
			frappe.throw(frappe._("{0}: {1} is more than its outstanding {2}.").format(
				inv.invoice_number, frappe.format_value(amt, {"fieldtype": "Currency"}),
				frappe.format_value(inv.outstanding_amount, {"fieldtype": "Currency"})))
		want.append([inv, amt])
	if not pays or not want:
		frappe.throw(frappe._("Choose the advance / credit and the invoices to adjust."))
	if sum(a for _, a in want) - sum(flt(p.amount) for p in pays) > 0.005:
		frappe.throw(frappe._("The invoices chosen ({0}) are more than the advances / credits chosen ({1}).").format(
			frappe.format_value(sum(a for _, a in want), {"fieldtype": "Currency"}),
			frappe.format_value(sum(flt(p.amount) for p in pays), {"fieldtype": "Currency"})))

	inv_dicts = [i.as_dict() for i, _ in want]
	pay_dicts = [p.as_dict() for p in pays]
	exchange = pr.get_invoice_exchange_map(inv_dicts, pay_dicts)
	gain_loss_account = frappe.get_cached_value("Company", pr.company, "exchange_gain_loss_account")
	rows = []
	for pay in pay_dicts:
		pay["unreconciled_amount"] = flt(pay.amount)
		for item in want:
			inv, amt = item
			if pay.amount <= 0.005:
				break
			if amt <= 0.005:
				continue
			take = flt(min(flt(pay.amount), amt), 2)
			inv_d = inv.as_dict()
			inv_d["exchange_rate"] = exchange.get(inv.invoice_number)
			if pay.get("reference_type") in ("Sales Invoice", "Purchase Invoice"):
				pay["exchange_rate"] = exchange.get(pay.get("reference_name"))
			res = pr.get_allocated_entry(pay, inv_d, take)   # amount = what the credit still has, as ERPNext does
			res.difference_amount = pr.get_difference_amount(pay, inv_d, take)
			res.difference_account = gain_loss_account
			res.exchange_rate = inv_d.get("exchange_rate")
			res.gain_loss_posting_date = pay.get("posting_date")
			rows.append(res)
			pay["amount"] = flt(flt(pay.amount) - take, 2)
			item[1] = flt(amt - take, 2)
	pr.set("allocation", [])
	for r in rows:
		pr.append("allocation", r)
	pr.reconcile()
	return {"adjusted": flt(sum(flt(r.allocated_amount) for r in rows), 2), "rows": len(rows)}
