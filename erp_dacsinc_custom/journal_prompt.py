"""Journal Entry prompt (Order Flow › Finance › New › Journal Entry — public/js/journal_prompt.js).

A short form instead of the full Journal Entry: ready-made patterns in groups (bank & cash,
expenses & salary, provisions & prepaid, partners & capital, fixed assets, taxes, customers & suppliers,
credit & debit notes, loans & advances) that fill the debit and credit
lines from the company's ledgers, then account, party, debit, credit per line with a live Dr = Cr check. The entry is
ERPNext's own Journal Entry, made as the user (their Journal Entry permissions apply), saved as a
draft or submitted.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate

VOUCHER_TYPES = ("Journal Entry", "Bank Entry", "Cash Entry", "Contra Entry", "Write Off Entry", "Credit Note", "Debit Note",
	"Depreciation Entry")


def _acc(company, *names):
	for n in names:
		if n and frappe.db.exists("Account", {"name": n, "company": company, "is_group": 0, "disabled": 0}):
			return n
	return None


def _first_of_type(company, account_type):
	return frappe.db.get_value("Account", {"company": company, "account_type": account_type, "is_group": 0, "disabled": 0}, "name")


@frappe.whitelist()
def get_setup(company=None):
	if not frappe.has_permission("Journal Entry", "create"):
		frappe.throw(_("You are not allowed to create Journal Entries."), frappe.PermissionError)
	company = company or frappe.defaults.get_user_default("Company")
	c = frappe.get_cached_doc("Company", company)
	abbr = c.abbr
	return {
		"company": company,
		"currency": c.default_currency,
		"can_submit": bool(frappe.has_permission("Journal Entry", "submit")),
		"accounts": {
			"bank": _acc(company, c.default_bank_account) or _first_of_type(company, "Bank"),
			"cash": _acc(company, c.default_cash_account) or _first_of_type(company, "Cash"),
			"bank_charges": _acc(company, f"Bank Charges - {abbr}", f"Bank Charges A/c - {abbr}"),
			"tds_payable": _acc(company, f"TDS Payable - {abbr}"),
			"write_off": _acc(company, c.write_off_account, f"Write Off - {abbr}"),
			"debtors": _acc(company, c.default_receivable_account) or _first_of_type(company, "Receivable"),
			"creditors": _acc(company, c.default_payable_account) or _first_of_type(company, "Payable"),
			"round_off": _acc(company, c.round_off_account),
			"interest_od": _acc(company, f"Interest on OD A/c - {abbr}"),
			"salary": _acc(company, f"Basic Salary - {abbr}", f"Salary - {abbr}"),
			"payroll_payable": _acc(company, c.get("default_payroll_payable_account"), f"Payroll Payable - {abbr}"),
			"depreciation": _acc(company, c.depreciation_expense_account) or _first_of_type(company, "Depreciation"),
			"accum_dep": _acc(company, c.accumulated_depreciation_account) or _first_of_type(company, "Accumulated Depreciation"),
			"tds_receivable": _acc(company, f"TDS Receivable - {abbr}"),
			"pf": _acc(company, f"PF Account - {abbr}"),
			"out_cgst": _acc(company, f"Output Tax CGST - {abbr}"),
			"out_sgst": _acc(company, f"Output Tax SGST - {abbr}"),
			"out_igst": _acc(company, f"Output Tax IGST - {abbr}"),
			# credit / debit notes without GST (a GST note is made from the invoice — docs/returns.md)
			"trade_discount": _acc(company, c.default_discount_account, f"Trade Discount A/c - {abbr}"),
			"rate_difference": _acc(company, f"Rate Difference - {abbr}"),
			"discount_received": _acc(company, f"Discount Received - {abbr}"),
			# bank & cash, provisions, partners, assets, taxes, loans (the more patterns — journal_prompt.js);
			# a ledger not found here is chosen on the line
			"fixed_deposit": _acc(company, f"Fixed Deposit - {abbr}"),
			"interest_received": _acc(company, f"Interest Received - {abbr}"),
			"card_charges": _acc(company, f"Card Swipe Bank Charges - {abbr}"),
			"expenses_payable": _acc(company, f"Expenses Payable - {abbr}"),
			"prepaid": _acc(company, f"Prepaid Expenses - {abbr}"),
			"drawings": _acc(company, f"Drawings - {abbr}"),
			"interest_on_capital": _acc(company, f"Interest on Capital - {abbr}"),
			"partner_rem": _acc(company, f"Partners' Remuneration - {abbr}", f"Salary To Partner - {abbr}"),
			"bad_debts": _acc(company, f"Bad Debts - {abbr}"),
			"salary_advance": _acc(company, f"Salary Advance - {abbr}"),
			"bonus": _acc(company, f"Bonus to Staff - {abbr}"),
			"asset_gain_loss": _acc(company, c.get("disposal_account"), f"Gain/Loss on Asset Disposal - {abbr}"),
			"in_cgst": _acc(company, f"Input Tax CGST - {abbr}"),
			"in_sgst": _acc(company, f"Input Tax SGST - {abbr}"),
			"in_igst": _acc(company, f"Input Tax IGST - {abbr}"),
			"profession_tax": _acc(company, f"Profession Tax - {abbr}"),
			"income_tax": _acc(company, f"Income Tax - {abbr}"),
			"interest_loan": _acc(company, f"Interest on Loan - {abbr}"),
		},
	}


@frappe.whitelist()
def make_journal_entry(data, submit=0):
	data = frappe.parse_json(data) if isinstance(data, str) else data
	submit = cint(submit)
	if not frappe.has_permission("Journal Entry", "create") or (submit and not frappe.has_permission("Journal Entry", "submit")):
		frappe.throw(_("You are not allowed to {0} Journal Entries.").format(_("submit") if submit else _("create")), frappe.PermissionError)
	company = data.get("company") or frappe.defaults.get_user_default("Company")
	vtype = data.get("voucher_type") or "Journal Entry"
	if vtype not in VOUCHER_TYPES:
		frappe.throw(_("Unknown entry type {0}.").format(vtype))
	remark = (data.get("user_remark") or "").strip()
	if not remark:
		frappe.throw(_("Write what this entry is for (Remark)."))
	rows = [r for r in (data.get("accounts") or []) if r.get("account") and (flt(r.get("debit")) or flt(r.get("credit")))]
	if len(rows) < 2:
		frappe.throw(_("A Journal Entry needs at least two lines (one debit, one credit)."))
	dr = flt(sum(flt(r.get("debit")) for r in rows), 2)
	cr = flt(sum(flt(r.get("credit")) for r in rows), 2)
	if abs(dr - cr) > 0.005:
		frappe.throw(_("Debit {0} and Credit {1} are not equal (difference {2}).").format(dr, cr, flt(dr - cr, 2)))
	from erpnext.accounts.utils import get_company_default

	cost_center = get_company_default(company, "cost_center")
	je = frappe.new_doc("Journal Entry")
	je.update({
		"voucher_type": vtype, "company": company, "posting_date": getdate(data.get("posting_date") or nowdate()),
		"cheque_no": data.get("cheque_no") or None, "cheque_date": data.get("cheque_date") or None,
		"user_remark": remark,
	})
	for r in rows:
		if flt(r.get("debit")) and flt(r.get("credit")):
			frappe.throw(_("Line {0}: put the amount in Debit or in Credit, not both.").format(r.get("account")))
		if flt(r.get("debit")) < 0 or flt(r.get("credit")) < 0:
			frappe.throw(_("Line {0}: amounts cannot be negative.").format(r.get("account")))
		je.append("accounts", {
			"account": r.get("account"), "party_type": r.get("party_type") or None, "party": r.get("party") or None,
			"debit_in_account_currency": flt(r.get("debit"), 2), "credit_in_account_currency": flt(r.get("credit"), 2),
			"cost_center": cost_center, "user_remark": r.get("note") or None,
		})
	_set_company_gstin(je)
	je.insert()
	if submit:
		je.submit()
	return {"name": je.name, "docstatus": je.docstatus}


def _set_company_gstin(je):
	"""India Compliance refuses a Journal Entry with a GST ledger and no Company GSTIN ("Company GSTIN is mandatory if
	any GST account is present" — GST paid, GST set-off). The prompt has no GSTIN field: a company with one GSTIN gets
	it; with several, the check stays as it is (the full form picks one). Entries without a GST ledger are untouched."""
	if not je.meta.has_field("company_gstin") or je.get("company_gstin"):
		return
	try:
		from india_compliance.gst_india.utils import get_gst_account_gst_tax_type_map
	except ImportError:
		return
	gst_accounts = get_gst_account_gst_tax_type_map() or {}
	if not any(r.account in gst_accounts for r in je.accounts):
		return
	gstins = frappe.get_all("Address", filters=[["Dynamic Link", "link_doctype", "=", "Company"],
		["Dynamic Link", "link_name", "=", je.company], ["gstin", "is", "set"], ["disabled", "=", 0]], pluck="gstin", distinct=True)
	if len(set(gstins)) == 1:
		je.company_gstin = gstins[0]
