"""Customer / Supplier form › Account Summary (public/js/party_summary.js): the party's documents with
their chain, and the statement of account as a PDF on the letter head. Finance roles only
(party_balance.FINANCE_ROLES), plus read on the party and its invoices.

- get_party_documents: invoices (unpaid / paid / all / returns) or orders, for a date range; each with
  what it came from and what followed — Customer: Quotation → Sales Order → Delivery Note → Sales
  Invoice → payments / credit notes; Supplier: Purchase Order → Purchase Receipt → Purchase Invoice →
  payments / debit notes.
- statement_pdf: the ledger (GL Entries of the party, not cancelled) for the dates — opening balance,
  every entry with a running balance, closing — on the default Letter Head, as the receipts are.
"""

import frappe
from frappe import _
from frappe.utils import add_months, cint, flt, getdate, nowdate

from erp_dacsinc_custom.party_balance import INVOICE, can_see_balances

LIMIT = 100
SIDE = {
	"Customer": {"order": "Sales Order", "order_field": "sales_order", "receipt": "Delivery Note", "receipt_field": "delivery_note",
				 "receipt_item_order": "against_sales_order", "quote": "Quotation", "name_field": "customer_name"},
	"Supplier": {"order": "Purchase Order", "order_field": "purchase_order", "receipt": "Purchase Receipt", "receipt_field": "purchase_receipt",
				 "receipt_item_order": "purchase_order", "quote": None, "name_field": "supplier_name"},
}


def _guard(party_type, party):
	if party_type not in INVOICE:
		frappe.throw(_("Unknown party type."))
	inv_dt = INVOICE[party_type][0]
	if not can_see_balances() or not (frappe.has_permission(party_type, "read", party) and frappe.has_permission(inv_dt, "read")):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


def _total(r):
	return flt(r.get("rounded_total")) or flt(r.get("grand_total"))


def _payments_for(dt, names):
	"""{doc name: [payments / journal entries / notes set against it]}"""
	out = {n: [] for n in names}
	if not names:
		return out
	for p in frappe.db.sql("""SELECT per.reference_name AS ref, pe.name, pe.posting_date, per.allocated_amount AS amount,
			pe.mode_of_payment, pe.reference_no, pe.custom_bulk_payment
		FROM `tabPayment Entry Reference` per JOIN `tabPayment Entry` pe ON pe.name = per.parent
		WHERE per.reference_doctype = %s AND per.reference_name IN %s AND pe.docstatus = 1
		ORDER BY pe.posting_date""", (dt, tuple(names)), as_dict=1):
		out[p.ref].append({"doctype": "Payment Entry", "name": p.name, "date": p.posting_date, "amount": flt(p.amount),
						   "note": " · ".join(x for x in (p.mode_of_payment, p.reference_no, p.custom_bulk_payment and _("Bulk {0}").format(p.custom_bulk_payment)) if x)})
	notes = []
	if dt in ("Sales Invoice", "Purchase Invoice"):
		notes = frappe.get_all(dt, filters={"return_against": ["in", names], "docstatus": 1, "is_return": 1},
							   fields=["name", "posting_date", "return_against", "grand_total", "rounded_total"])
		for n in notes:
			out[n.return_against].append({"doctype": dt, "name": n.name, "date": n.posting_date, "amount": -_total(n),
										  "note": _("Credit Note") if dt == "Sales Invoice" else _("Debit Note")})
	listed = {(n.return_against, n.name) for n in notes}
	# Journal Entries; one ERPNext makes to set a credit / debit note off (voucher type Credit / Debit
	# Note) is skipped when that note is already listed above
	for j in frappe.db.sql("""SELECT jea.reference_name AS ref, je.name, je.posting_date,
			ABS(jea.credit_in_account_currency - jea.debit_in_account_currency) AS amount, je.voucher_type,
			(SELECT j2.reference_name FROM `tabJournal Entry Account` j2 WHERE j2.parent = je.name
				AND j2.reference_type = jea.reference_type AND j2.reference_name != jea.reference_name LIMIT 1) AS other
		FROM `tabJournal Entry Account` jea JOIN `tabJournal Entry` je ON je.name = jea.parent
		WHERE jea.reference_type = %s AND jea.reference_name IN %s AND je.docstatus = 1""", (dt, tuple(names)), as_dict=1):
		if (j.ref, j.other) in listed:
			continue
		out[j.ref].append({"doctype": "Journal Entry", "name": j.name, "date": j.posting_date, "amount": flt(j.amount),
						   "note": " · ".join(x for x in (j.voucher_type, j.other and _("sets off {0}").format(j.other)) if x)})
	return out


def _children(child_dt, link_field, values, parent_dt, extra_fields=()):
	"""Submitted / draft parents of `parent_dt` whose items point at `values` through `link_field`."""
	if not values:
		return []
	return frappe.db.sql(f"""SELECT DISTINCT p.name, p.posting_date AS date, p.docstatus, p.status, p.grand_total, p.rounded_total,
			c.{link_field} AS src {''.join(', p.' + f for f in extra_fields)}
		FROM `tab{child_dt}` c JOIN `tab{parent_dt}` p ON p.name = c.parent
		WHERE c.{link_field} IN %s AND p.docstatus < 2 ORDER BY p.posting_date""", (tuple(values),), as_dict=1)


def _doc(dt, r, **extra):
	d = {"doctype": dt, "name": r.name, "date": r.get("date") or r.get("posting_date") or r.get("transaction_date"),
		 "total": _total(r), "status": r.get("status") or "", "draft": cint(r.get("docstatus")) == 0}
	d.update(extra)
	return d


@frappe.whitelist()
def get_party_documents(party_type, party, view="unpaid", from_date=None, to_date=None, company=None):
	_guard(party_type, party)
	inv_dt, inv_field = INVOICE[party_type]
	side = SIDE[party_type]
	company = company or frappe.defaults.get_user_default("Company")
	to_date = getdate(to_date or nowdate())
	from_date = getdate(from_date or add_months(to_date, -12))
	inv_item = inv_dt + " Item"

	if view == "orders":
		order_dt = side["order"]
		orders = frappe.get_all(order_dt, filters={inv_field: party, "company": company, "docstatus": ["<", 2],
			"transaction_date": ["between", [from_date, to_date]]},
			fields=["name", "transaction_date", "docstatus", "status", "grand_total", "rounded_total", "per_billed",
					"per_delivered" if party_type == "Customer" else "per_received"]
					+ (["workflow_state"] if party_type == "Customer" else []),
			order_by="transaction_date desc", limit_page_length=LIMIT)
		names = [o.name for o in orders]
		quotes = {}
		if side["quote"] and names:
			for q in frappe.db.sql("""SELECT DISTINCT soi.parent AS so, q.name, q.transaction_date AS date, q.status, q.grand_total, q.rounded_total, q.docstatus
				FROM `tabSales Order Item` soi JOIN `tabQuotation` q ON q.name = soi.prevdoc_docname
				WHERE soi.parent IN %s""", (tuple(names),), as_dict=1):
				quotes.setdefault(q.so, []).append(_doc("Quotation", q))
		receipts, invoices = {}, {}
		for r in _children(side["receipt"] + " Item", side["receipt_item_order"], names, side["receipt"]):
			receipts.setdefault(r.src, []).append(_doc(side["receipt"], r))
		inv_rows = _children(inv_item, side["order_field"], names, inv_dt, ("outstanding_amount", "is_return"))
		pays = _payments_for(inv_dt, list({r.name for r in inv_rows}))
		for r in inv_rows:
			invoices.setdefault(r.src, []).append(_doc(inv_dt, r, outstanding=flt(r.outstanding_amount), is_return=cint(r.is_return),
													   payments=pays.get(r.name, [])))
		advances = _payments_for(order_dt, names)
		rows = []
		for o in orders:
			done = flt(o.get("per_delivered") if party_type == "Customer" else o.get("per_received"))
			rows.append(_doc(order_dt, frappe._dict(o, date=o.transaction_date), per_billed=flt(o.per_billed), per_done=done,
				workflow_state=o.get("workflow_state") if o.docstatus == 0 else None,
				chain={"quotations": quotes.get(o.name, []), "receipts": receipts.get(o.name, []),
					   "invoices": invoices.get(o.name, []), "advances": advances.get(o.name, [])}))
		return {"view": view, "from_date": from_date, "to_date": to_date, "rows": rows, "more": len(orders) >= LIMIT}

	filters = {inv_field: party, "company": company, "docstatus": 1, "posting_date": ["between", [from_date, to_date]]}
	if view == "returns":
		filters["is_return"] = 1
	else:
		filters["is_return"] = 0
		if view == "unpaid":
			filters["outstanding_amount"] = [">", 0.005]
			filters.pop("posting_date")   # unpaid: whatever the date
		elif view == "paid":
			filters["outstanding_amount"] = ["<=", 0.005]
	fields = ["name", "posting_date", "due_date", "status", "docstatus", "grand_total", "rounded_total", "outstanding_amount", "return_against"]
	if party_type == "Supplier":
		fields.append("bill_no")
	invs = frappe.get_all(inv_dt, filters=filters, fields=fields,
						  order_by="due_date asc" if view == "unpaid" else "posting_date desc", limit_page_length=LIMIT)
	names = [i.name for i in invs]
	pays = _payments_for(inv_dt, names)
	src = {}
	if names:
		for s in frappe.db.sql(f"""SELECT DISTINCT parent, {side['order_field']} AS ord, {side['receipt_field']} AS rec
			FROM `tab{inv_item}` WHERE parent IN %s""", (tuple(names),), as_dict=1):
			src.setdefault(s.parent, {"orders": set(), "receipts": set()})
			if s.ord:
				src[s.parent]["orders"].add(s.ord)
			if s.rec:
				src[s.parent]["receipts"].add(s.rec)
	all_orders = sorted({o for v in src.values() for o in v["orders"]})
	quote_of = {}
	if side["quote"] and all_orders:
		for q in frappe.db.sql("""SELECT DISTINCT parent, prevdoc_docname FROM `tabSales Order Item`
			WHERE parent IN %s AND IFNULL(prevdoc_docname, '') != ''""", (tuple(all_orders),), as_dict=1):
			quote_of.setdefault(q.parent, set()).add(q.prevdoc_docname)
	rows = []
	for i in invs:
		s = src.get(i.name, {"orders": set(), "receipts": set()})
		rows.append(_doc(inv_dt, frappe._dict(i, date=i.posting_date), due_date=i.due_date, outstanding=flt(i.outstanding_amount),
			bill_no=i.get("bill_no"), return_against=i.return_against,
			chain={"quotations": sorted({q for o in s["orders"] for q in quote_of.get(o, ())}),
				   "orders": sorted(s["orders"]), "receipts": sorted(s["receipts"]), "payments": pays.get(i.name, [])}))
	if view == "unpaid":
		# what else is due besides invoices — opening balances and other Journal Entries, a refund paid out
		# (party_open_items, the Payment Ledger): listed with the invoices, oldest due first
		from erp_dacsinc_custom.party_open_items import open_items
		for it in open_items(party_type, [party], company).get(party, []):
			if it.outstanding > 0.005 and it.doctype != inv_dt:
				rows.append({"doctype": it.doctype, "name": it.name, "date": it.posting_date, "total": it.total,
							 "outstanding": it.outstanding, "due_date": it.due_date, "kind": it.kind, "remark": it.remark,
							 "status": "", "draft": False, "chain": {}})
		rows.sort(key=lambda r: str(r.get("due_date") or r.get("date") or ""))
	return {"view": view, "from_date": from_date, "to_date": to_date, "rows": rows, "more": len(invs) >= LIMIT}


STATEMENT = """
<style>
  .st { font-family: Arial, sans-serif; font-size: 8.5pt; color: #000; }
  .st h2 { text-align: center; font-size: 12pt; letter-spacing: 1px; margin: 6px 0 2px; }
  .st .sub { text-align: center; margin-bottom: 8px; }
  .st table { width: 100%; border-collapse: collapse; }
  .st td, .st th, .st div { font-size: 8.5pt; }
  .st .box td { border: 1px solid #000; padding: 5px 7px; vertical-align: top; }
  .st .t th { border: 1px solid #2e86c1; background: #3498DB; color: #fff; padding: 4px; text-align: left; }
  .st .t th.r { text-align: right; }
  .st .t td { border: 1px solid #000; padding: 3px 4px; vertical-align: top; }
  .st .nw { white-space: nowrap; }
  .st .r { text-align: right; white-space: nowrap; }
  .st tr.b td { font-weight: bold; background: #f7f7f7; }
  .st .sum td { border: 1px solid #000; padding: 5px 7px; }
</style>
<div class="st">
  {% if letter_head %}<div>{{ letter_head }}</div>{% endif %}
  <h2>STATEMENT OF ACCOUNT</h2>
  <div class="sub">{{ frappe.utils.formatdate(from_date) }} to {{ frappe.utils.formatdate(to_date) }}</div>
  <table class="box"><tr>
    <td style="width:60%"><div style="font-size:7.5pt">{{ party_type }}</div><div style="font-weight:bold;font-size:10.5pt">{{ party_name }}</div>
      <div>{{ party }}{% if gstin %} · GSTIN: {{ gstin }}{% endif %}</div>{% if address %}<div style="margin-top:2px">{{ address }}</div>{% endif %}</td>
    <td><div style="font-size:9.5pt"><b>Opening balance:</b> {{ fmt(opening) }}</div><div style="font-size:9.5pt"><b>Closing balance:</b> {{ fmt(closing) }}</div>
      <div style="font-size:7.5pt;margin-top:3px">{{ "Dr = receivable from the customer, Cr = advance / credit" if party_type == "Customer" else "Cr = payable to the supplier, Dr = advance / debit" }}</div></td>
  </tr></table>
  <table class="t" style="margin-top:8px">
    <thead><tr><th style="width:11%">Date</th><th style="width:16%">Type</th><th style="width:17%">Document</th><th>Details</th>
      <th class="r" style="width:11%">Debit</th><th class="r" style="width:11%">Credit</th><th class="r" style="width:13%">Balance</th></tr></thead>
    <tbody>
      <tr class="b"><td class="nw">{{ frappe.utils.formatdate(from_date) }}</td><td colspan="3">Opening balance</td><td></td><td></td><td class="r">{{ fmt(opening) }}</td></tr>
      {% for e in entries %}<tr><td class="nw">{{ frappe.utils.formatdate(e.posting_date) }}</td><td>{{ e.voucher_type }}</td><td>{{ e.voucher_no }}</td>
        <td>{{ e.details or "" }}</td><td class="r">{{ frappe.utils.fmt_money(e.debit) if e.debit else "" }}</td>
        <td class="r">{{ frappe.utils.fmt_money(e.credit) if e.credit else "" }}</td><td class="r">{{ fmt(e.balance) }}</td></tr>{% endfor %}
      <tr class="b"><td colspan="4" class="r">Total for the period</td><td class="r">{{ frappe.utils.fmt_money(total_debit) }}</td><td class="r">{{ frappe.utils.fmt_money(total_credit) }}</td><td></td></tr>
      <tr class="b"><td class="nw">{{ frappe.utils.formatdate(to_date) }}</td><td colspan="3">Closing balance</td><td></td><td></td><td class="r">{{ fmt(closing) }}</td></tr>
    </tbody>
  </table>
  <table class="sum" style="margin-top:8px"><tr>
    <td style="font-size:9.5pt"><b>{{ closing_label }}: ₹ {{ frappe.utils.fmt_money(closing_abs) }}</b>{% if closing_abs %} — Rupees {{ closing_words }} Only{% endif %}</td>
  </tr></table>
  <div style="margin-top:28px;text-align:right"><b>For {{ company }}</b><br><br><br>Authorised Signatory</div>
  <div style="font-size:7pt;margin-top:10px">Computer generated statement on {{ frappe.utils.formatdate(frappe.utils.nowdate()) }}. Please report any difference within 15 days.</div>
</div>
"""


def _statement_data(party_type, party, from_date, to_date, company):
	from_date, to_date = getdate(from_date), getdate(to_date)
	receivable = party_type == "Customer"
	opening = flt(frappe.db.sql("""SELECT SUM(debit - credit) FROM `tabGL Entry` WHERE party_type = %s AND party = %s
		AND company = %s AND is_cancelled = 0 AND posting_date < %s""", (party_type, party, company, from_date))[0][0], 2)
	entries = frappe.db.sql("""SELECT posting_date, voucher_type, voucher_no, SUM(debit) AS debit, SUM(credit) AS credit,
			MAX(against_voucher) AS against_voucher, MAX(remarks) AS remarks
		FROM `tabGL Entry` WHERE party_type = %s AND party = %s AND company = %s AND is_cancelled = 0
		AND posting_date BETWEEN %s AND %s
		GROUP BY posting_date, voucher_type, voucher_no ORDER BY posting_date, MIN(creation)""",
		(party_type, party, company, from_date, to_date), as_dict=1)
	bal = opening
	for e in entries:
		e.debit, e.credit = flt(e.debit, 2), flt(e.credit, 2)
		bal = flt(bal + e.debit - e.credit, 2)
		e.balance = bal
		bits = []
		if e.voucher_type in ("Sales Invoice", "Purchase Invoice"):
			ret = frappe.db.get_value(e.voucher_type, e.voucher_no, ["is_return", "return_against", "bill_no" if e.voucher_type == "Purchase Invoice" else "po_no"], as_dict=1) or {}
			if ret.get("is_return"):
				bits.append(_("Return against {0}").format(ret.get("return_against")) if ret.get("return_against") else _("Return"))
			if ret.get("bill_no"):
				bits.append(_("Bill {0}").format(ret.bill_no))
			if ret.get("po_no"):
				bits.append(_("PO {0}").format(ret.po_no))
		elif e.voucher_type == "Payment Entry":
			pe = frappe.db.get_value("Payment Entry", e.voucher_no, ["mode_of_payment", "reference_no"], as_dict=1) or {}
			bits += [x for x in (pe.get("mode_of_payment"), pe.get("reference_no") and _("Ref {0}").format(pe.reference_no)) if x]
			refs = frappe.get_all("Payment Entry Reference", filters={"parent": e.voucher_no}, pluck="reference_name")
			if refs:
				bits.append(_("for {0}").format(", ".join(refs[:4]) + (" …" if len(refs) > 4 else "")))
		elif e.against_voucher and e.against_voucher != e.voucher_no:
			bits.append(_("against {0}").format(e.against_voucher))
		e.details = " · ".join(bits)
	return opening, entries, bal, receivable


@frappe.whitelist()
def statement_pdf(party_type, party, from_date=None, to_date=None, company=None, letter_head=1):
	"""The statement of account as a PDF download (opened in a new tab by the form)."""
	from frappe.utils.pdf import get_pdf
	from frappe.www.printview import get_letter_head

	_guard(party_type, party)
	company = company or frappe.defaults.get_user_default("Company")
	to_date = getdate(to_date or nowdate())
	from_date = getdate(from_date or add_months(to_date, -12))
	opening, entries, closing, receivable = _statement_data(party_type, party, from_date, to_date, company)
	pdoc = frappe.get_doc(party_type, party)
	lh = get_letter_head(frappe._dict(company=company), not cint(letter_head)) or {}
	lh_html = frappe.render_template(lh.get("content") or "", {"doc": frappe._dict(company=company)}) if lh.get("content") else ""
	address = ""
	addr_name = pdoc.get("customer_primary_address" if receivable else "supplier_primary_address")
	if addr_name:
		from frappe.contacts.doctype.address.address import get_address_display
		address = (get_address_display(addr_name) or "").replace("<br>", ", ").strip(", ")

	def fmt(v):
		v = flt(v, 2)
		if abs(v) < 0.005:
			return "0.00"
		return f"{frappe.utils.fmt_money(abs(v))} {'Dr' if v > 0 else 'Cr'}"

	owe = closing > 0.005 if receivable else closing < -0.005
	adv = closing < -0.005 if receivable else closing > 0.005
	html = frappe.render_template(STATEMENT, {
		"letter_head": lh_html, "party_type": party_type, "party": party,
		"party_name": pdoc.get(SIDE[party_type]["name_field"]) or party, "gstin": pdoc.get("gstin"), "address": address,
		"from_date": from_date, "to_date": to_date, "opening": opening, "closing": closing, "entries": entries,
		"total_debit": flt(sum(e.debit for e in entries), 2), "total_credit": flt(sum(e.credit for e in entries), 2),
		"company": company, "fmt": fmt, "closing_abs": abs(closing),
		"closing_label": (_("Amount due from you") if receivable else _("Amount payable by us")) if owe
			else (_("Advance / credit with us") if receivable else _("Advance with you")) if adv else _("Balance"),
		"closing_words": (frappe.utils.money_in_words(abs(closing), "INR") or "").replace("INR ", "").rstrip(".").removesuffix(" only").removesuffix(" Only")
			if abs(closing) > 0.005 else "",
	})
	frappe.local.response.filename = f"Statement {party} {from_date} to {to_date}.pdf"
	frappe.local.response.filecontent = get_pdf(html, {"margin-top": "8mm", "margin-bottom": "10mm", "margin-left": "8mm", "margin-right": "8mm"})
	frappe.local.response.type = "pdf"
