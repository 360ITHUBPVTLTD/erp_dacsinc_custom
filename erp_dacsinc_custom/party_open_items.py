"""Everything still open on a customer's / supplier's account, from ERPNext's Payment Ledger (the ledger its own
Accounts Receivable / Payable reports read) — docs/bulk-payment.md › Open items.

Each open item is one voucher with something left on it:
  dues (still to be received from a customer / paid to a supplier): invoices, opening invoices, opening balances
  and other Journal Entries, a refund paid out;
  credits (held for the party, to be set off): advances (Payment Entries, Journal Entries), credit / debit notes.
They add up to the party's ledger balance (GL), which the Account Summary checks.
Used by the Account Summary (party_balance), its Documents › Unpaid view (party_statement) and the Receive / Pay
prompt (Bulk Payment).
"""

import frappe
from frappe.utils import flt, getdate

INVOICE = {"Customer": "Sales Invoice", "Supplier": "Purchase Invoice"}
# kinds a payment can be set against from the Receive / Pay prompt
PAYABLE_KINDS = ("invoice", "opening_invoice", "opening", "journal")


def open_items(party_type, parties, company):
	"""{party: [item, …]} — item: doctype, name, kind, posting_date, due_date, total (the voucher's own amount on the
	party), outstanding (+ due, − credit), remark, bill_no. Oldest due first."""
	parties = [p for p in (parties or []) if p]
	if not parties or party_type not in INVOICE:
		return {}
	rows = frappe.db.sql("""
		SELECT party, against_voucher_type AS doctype, against_voucher_no AS name, SUM(amount) AS outstanding,
			SUM(IF(voucher_type = against_voucher_type AND voucher_no = against_voucher_no, amount, 0)) AS total,
			MIN(IF(voucher_type = against_voucher_type AND voucher_no = against_voucher_no, posting_date, NULL)) AS posting_date,
			MAX(IF(voucher_type = against_voucher_type AND voucher_no = against_voucher_no, due_date, NULL)) AS due_date
		FROM `tabPayment Ledger Entry`
		WHERE delinked = 0 AND company = %(company)s AND party_type = %(pt)s AND party IN %(parties)s
		GROUP BY party, against_voucher_type, against_voucher_no
		HAVING ABS(SUM(amount)) > 0.005
	""", {"company": company, "pt": party_type, "parties": tuple(parties)}, as_dict=True)

	by_dt = {}
	for r in rows:
		by_dt.setdefault(r.doctype, []).append(r.name)
	info = {}
	inv_dt = INVOICE[party_type]
	if by_dt.get(inv_dt):
		fields = ["name", "posting_date", "due_date", "is_return", "is_opening", "return_against", "remarks"]
		if inv_dt == "Purchase Invoice":
			fields.append("bill_no")
		for d in frappe.get_all(inv_dt, filters={"name": ["in", by_dt[inv_dt]]}, fields=fields):
			kind = ("credit_note" if inv_dt == "Sales Invoice" else "debit_note") if d.is_return \
				else "opening_invoice" if d.is_opening == "Yes" else "invoice"
			info[(inv_dt, d.name)] = {"kind": kind, "posting_date": d.posting_date, "due_date": d.due_date,
									  "bill_no": d.get("bill_no"), "return_against": d.return_against}
	if by_dt.get("Journal Entry"):
		for d in frappe.get_all("Journal Entry", filters={"name": ["in", by_dt["Journal Entry"]]},
								fields=["name", "posting_date", "voucher_type", "is_opening", "user_remark", "cheque_no", "title"]):
			kind = "opening" if (d.is_opening == "Yes" or d.voucher_type == "Opening Entry") else "journal"
			info[("Journal Entry", d.name)] = {"kind": kind, "posting_date": d.posting_date,
											   "remark": (d.user_remark or d.title or "").strip()[:140], "ref": d.cheque_no}
	if by_dt.get("Payment Entry"):
		for d in frappe.get_all("Payment Entry", filters={"name": ["in", by_dt["Payment Entry"]]},
								fields=["name", "posting_date", "mode_of_payment", "reference_no", "payment_type"]):
			info[("Payment Entry", d.name)] = {"kind": "payment", "posting_date": d.posting_date,
											   "remark": " · ".join(x for x in (d.mode_of_payment, d.reference_no) if x)}

	out = {}
	for r in rows:
		i = info.get((r.doctype, r.name), {})
		out_amt = flt(r.outstanding, 2)
		kind = i.get("kind") or "other"
		if kind == "payment":
			kind = "advance" if out_amt < 0 else "refund"
		if kind == "journal" and out_amt < 0:
			kind = "journal_credit"
		posting = i.get("posting_date") or r.posting_date
		out.setdefault(r.party, []).append(frappe._dict({
			"doctype": r.doctype, "name": r.name, "kind": kind, "posting_date": posting,
			"due_date": i.get("due_date") or r.due_date or posting,
			"total": abs(flt(r.total, 2)) or abs(out_amt), "outstanding": out_amt,
			"remark": i.get("remark") or "", "bill_no": i.get("bill_no"), "return_against": i.get("return_against"),
			"ref": i.get("ref"),
		}))
	for items in out.values():
		items.sort(key=lambda x: (getdate(x.due_date) if x.due_date else getdate("2100-01-01"), x.name))
	return out
