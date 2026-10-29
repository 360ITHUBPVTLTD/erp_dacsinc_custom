"""Receive / Pay — one prompt (public/js/bulk_payment.js) for every payment against invoices / bills:
one invoice, several invoices of one party, or one amount (a cheque, a transfer, cash) for several
parties and their invoices. docs/bulk-payment.md.

- One party  → one standard Payment Entry (its invoices as references; an amount above them is kept
  as advance; no invoice at all = an advance).                                   make_payment
- Several    → a Bulk Payment (this doctype) that, on Submit, makes one Payment Entry per party, each
  marked with it (Payment Entry › custom_bulk_payment) and sharing its mode, date and cheque /
  reference no. Cancelling it cancels them all. One of them may be cancelled on its own: its rows here are
  marked Cancelled, the status becomes Partly Cancelled (cancelled amount kept), and when the last one is
  cancelled the Bulk Payment is cancelled too (payment_entry_on_cancel).

Rows are invoices / bills, or a Journal Entry with something due on it (an opening balance, a charge) — from the
Payment Ledger (party_open_items); the Payment Entry references it the way ERPNext's Get Outstanding does.

Bank charges (for the whole amount, on the first party's entry), TDS and write-off (per invoice row)
are Payment Entry deductions, as Create › Payment would post them:
  Receive:  Dr Bank (total − charges − TDS − write-off), Dr Bank Charges, Dr TDS, Dr Write Off; Cr Debtors total
  Pay:      Dr Creditors total, Dr Bank Charges; Cr Bank (total − TDS − write-off + charges), Cr TDS, Cr Write Off
"""

from collections import OrderedDict

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, fmt_money, getdate

from erp_dacsinc_custom.party_open_items import PAYABLE_KINDS

INVOICE = {"Receive": ("Customer", "Sales Invoice", "customer", "customer_name"),
		   "Pay": ("Supplier", "Purchase Invoice", "supplier", "supplier_name")}
JE = "Journal Entry"


class BulkPayment(Document):
	def _validate_links(self):
		# Frappe checks links before any hook on insert: a draft (new, or amended from a cancelled one,
		# however it was copied) has no Payment Entries yet — its Submit makes them — so drop old ones first
		if self.docstatus == 0:
			self.payment_entries = None
			self.status, self.cancelled_amount = "Draft", 0
			for row in self.allocations:
				row.payment_entry, row.cancelled = None, 0
		return super()._validate_links()

	def before_validate(self):
		# the rows' Dynamic Links (party, invoice) are checked against these — set them first
		if self.payment_type in INVOICE:
			party_type, inv_dt = INVOICE[self.payment_type][:2]
			self.party_type = party_type
			for row in self.allocations:
				row.party_type = party_type
				if row.reference_doctype != JE:
					row.reference_doctype = inv_dt

	def validate(self):
		"""Also run (without saving) for a one-party payment from the prompt: flags.allow_advance lets the
		total exceed the invoices (kept as advance on its Payment Entry), flags.advance_party names the
		party when no invoice is chosen."""
		if not self.company:
			self.company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
		party_type, inv_dt, party_field, name_field = INVOICE[self.payment_type]
		receive = self.payment_type == "Receive"
		self.party_type = party_type
		self._set_bank_account()
		seen, total, tds, wo = set(), 0.0, 0.0, 0.0
		for row in self.allocations:
			row.party_type = party_type
			if row.reference_doctype != JE:
				row.reference_doctype = inv_dt
			if not row.reference_name:
				frappe.throw(_("Row {0}: choose the invoice.").format(row.idx))
			if row.reference_name in seen:
				frappe.throw(_("Row {0}: {1} is in the table twice.").format(row.idx, row.reference_name))
			seen.add(row.reference_name)
			if row.reference_doctype == JE:
				self._validate_je_row(row)
			else:
				self._validate_invoice_row(row, inv_dt, party_field, name_field)
			row.tds_amount, row.write_off_amount = flt(row.tds_amount, 2), flt(row.write_off_amount, 2)
			if flt(row.allocated_amount) <= 0:
				frappe.throw(_("Row {0}: enter the amount for {1}.").format(row.idx, row.reference_name))
			if flt(row.allocated_amount) - flt(row.outstanding_amount) > 0.005:
				frappe.throw(_("Row {0}: {1} is more than what is still due on {2} ({3}).").format(
					row.idx, fmt_money(row.allocated_amount), row.reference_name, fmt_money(row.outstanding_amount)))
			if row.tds_amount < 0 or row.write_off_amount < 0:
				frappe.throw(_("Row {0}: TDS and write-off cannot be negative.").format(row.idx))
			if row.tds_amount + row.write_off_amount - flt(row.allocated_amount) > 0.005:
				frappe.throw(_("Row {0}: TDS and write-off on {1} are more than its amount.").format(row.idx, row.reference_name))
			total += flt(row.allocated_amount)
			tds += row.tds_amount
			wo += row.write_off_amount
		self._after_rows(total, tds, wo, receive)

	def _validate_invoice_row(self, row, inv_dt, party_field, name_field):
			inv = frappe.db.get_value(inv_dt, row.reference_name,
									  ["docstatus", "is_return", party_field, name_field, "posting_date", "due_date",
									   "rounded_total", "grand_total", "outstanding_amount", "company",
									   "bill_no" if inv_dt == "Purchase Invoice" else "name"], as_dict=1)
			if not inv or inv.docstatus != 1 or inv.is_return:
				frappe.throw(_("Row {0}: {1} is not a submitted invoice.").format(row.idx, row.reference_name))
			if inv.company != self.company:
				frappe.throw(_("Row {0}: {1} belongs to {2}.").format(row.idx, row.reference_name, inv.company))
			if row.party and row.party != inv[party_field]:
				frappe.throw(_("Row {0}: {1} is not an invoice of {2}.").format(row.idx, row.reference_name, row.party))
			row.party, row.party_name = inv[party_field], inv[name_field]
			row.posting_date, row.due_date = inv.posting_date, inv.due_date
			row.invoice_total = flt(inv.rounded_total) or flt(inv.grand_total)
			if self.docstatus == 0:
				row.outstanding_amount = flt(inv.outstanding_amount)
			if inv_dt == "Purchase Invoice":
				row.bill_no = inv.bill_no

	def _validate_je_row(self, row):
		"""A Journal Entry row: something still due on it for this party (Payment Ledger — an opening balance or
		another debit to a customer / credit to a supplier)."""
		from erp_dacsinc_custom.party_open_items import open_items

		if not row.party:
			frappe.throw(_("Row {0}: choose the {1} for {2}.").format(row.idx, _(self.party_type).lower(), row.reference_name))
		item = next((i for i in open_items(self.party_type, [row.party], self.company).get(row.party, [])
					 if i.doctype == JE and i.name == row.reference_name), None)
		if not item or item.outstanding <= 0.005:
			frappe.throw(_("Row {0}: nothing is due from {1} on {2}.").format(row.idx, row.party, row.reference_name))
		row.party_name = frappe.db.get_value(self.party_type, row.party, INVOICE[self.payment_type][3])
		row.posting_date, row.due_date = item.posting_date, item.due_date
		row.invoice_total = item.total
		if self.docstatus == 0:
			row.outstanding_amount = item.outstanding

	def _after_rows(self, total, tds, wo, receive):
		from erp_dacsinc_custom.dashboard_payment import _deduction_account_ok

		self.allocated_amount = flt(total, 2)
		self.tds_amount, self.write_off_amount = flt(tds, 2), flt(wo, 2)
		self.bank_charges = flt(self.bank_charges, 2)
		parties = {r.party for r in self.allocations} or ({self.flags.advance_party} if self.flags.get("advance_party") else set())
		if not parties:
			frappe.throw(_("Choose the {0} and their invoices.").format(_("customer") if receive else _("supplier")))
		self.party_count = len(parties)
		self.invoice_count = len(self.allocations)

		# deductions and their ledgers (TDS on a supplier payment may be left blank: each supplier's own ledger)
		if self.bank_charges < 0:
			frappe.throw(_("Bank charges cannot be negative."))
		for value, account, label, kind, needed in (
				(self.bank_charges, self.bank_charges_account, _("Bank Charges"), "bank_charges", True),
				(self.tds_amount, self.tds_account, _("TDS"), "tds", receive),
				(self.write_off_amount, self.write_off_account, _("Write Off"), "write_off", True)):
			if not value or (not account and not needed):
				continue
			if not account or not frappe.db.exists("Account", {"name": account, "company": self.company, "is_group": 0}):
				frappe.throw(_("Choose the account for {0}.").format(label))
			if not _deduction_account_ok(kind, account):
				frappe.throw(_("{0} cannot go to {1}: choose an expense account for bank charges / write-off, "
							   "and a TDS account for TDS.").format(label, account))

		# the total must be what the rows settle; only a one-party payment may keep more as advance
		excess = flt(flt(self.total_amount) - self.allocated_amount, 2)
		if flt(self.total_amount) <= 0:
			frappe.throw(_("Enter the amount."))
		if excess < -0.005:
			frappe.throw(_("The amounts on the invoices ({0}) are more than the Total Amount ({1}) by {2}.").format(
				fmt_money(self.allocated_amount), fmt_money(self.total_amount), fmt_money(-excess)), title=_("Too much allocated"))
		if excess > 0.005:
			if not self.flags.get("allow_advance") or self.party_count > 1:
				frappe.throw(_("The amounts allocated ({0}) must add up to the Total Amount ({1}) — {2} still to allocate.").format(
					fmt_money(self.allocated_amount), fmt_money(self.total_amount), fmt_money(excess)), title=_("Not fully allocated"))
			if self.bank_charges or self.tds_amount or self.write_off_amount:
				frappe.throw(_("{0} more than the invoices would be kept as advance — that can't go with bank charges, TDS or "
							   "write-off. Make the advance a separate payment.").format(fmt_money(excess)))
		cut = self.tds_amount + self.write_off_amount
		self.bank_amount = flt(flt(self.total_amount) - cut - self.bank_charges if receive
							   else flt(self.total_amount) - cut + self.bank_charges, 2)
		if self.bank_amount <= 0:
			frappe.throw(_("The bank charges / TDS / write-off are as much as the total — nothing would be {0}.").format(
				_("received") if receive else _("paid")))
		if self.bank_cash_account and frappe.get_cached_value("Account", self.bank_cash_account, "account_type") == "Bank" \
				and not (self.reference_no and self.reference_date):
			frappe.throw(_("Enter the Cheque / Reference No and Date for {0}.").format(self.mode_of_payment))

	def _set_bank_account(self):
		from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account
		from erp_dacsinc_custom.payment_modes import shown

		if not self.mode_of_payment:
			frappe.throw(_("Choose the Mode of Payment."))
		if not shown(self.mode_of_payment):
			frappe.throw(_("Mode of Payment {0} is not ticked \"Show in Payment Entry\".").format(self.mode_of_payment))
		acc = (get_bank_cash_account(self.mode_of_payment, self.company) or {}).get("account")
		if not acc:
			frappe.throw(_("Mode of Payment {0} has no account for {1}.").format(self.mode_of_payment, self.company))
		self.bank_cash_account = acc

	def make_entries(self, bulk=True):
		"""One Payment Entry per party, submitted. bulk: made by this (submitted) Bulk Payment — marked and
		cancelled with it; else the one-party payment from the prompt (the user's remarks, as typed)."""
		by_party = OrderedDict()
		for row in self.allocations:
			by_party.setdefault(row.party, []).append(row)
		if not by_party:
			by_party[self.flags.advance_party] = []
		advance = 0 if bulk else flt(flt(self.total_amount) - self.allocated_amount, 2)
		made = []
		for i, (party, rows) in enumerate(by_party.items()):
			pe = self._party_entry(party, rows, self.bank_charges if i == 0 else 0, advance, bulk)
			if bulk:
				for row in rows:
					row.db_set("payment_entry", pe.name, update_modified=False)
			made.append(pe.name)
		return made

	def _party_entry(self, party, rows, charges, advance, bulk):
		from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
		from erpnext.accounts.utils import get_company_default

		receive = self.payment_type == "Receive"
		settled = flt(sum(flt(r.allocated_amount) for r in rows) + advance, 2)
		tds = flt(sum(flt(r.tds_amount) for r in rows), 2)
		wo = flt(sum(flt(r.write_off_amount) for r in rows), 2)
		bank = flt(settled - tds - wo - charges if receive else settled - tds - wo + charges, 2)

		if rows:
			inv_rows = [r for r in rows if r.reference_doctype != JE]
			pe = get_payment_entry(inv_rows[0].reference_doctype, inv_rows[0].reference_name, bank_account=self.bank_cash_account) \
				if inv_rows else self._advance_entry(party)
			je_refs = self._je_references(pe, party, [r for r in rows if r.reference_doctype == JE])
			refs = []
			for row in rows:
				if row.reference_doctype == JE:
					refs.append(je_refs[row.reference_name])
					continue
				# ERPNext's own reference row for this invoice (accounts, due date, outstanding…)
				ref = get_payment_entry(row.reference_doctype, row.reference_name, bank_account=self.bank_cash_account).references[0]
				ref.allocated_amount = flt(row.allocated_amount)
				refs.append(ref.as_dict(no_default_fields=True))
			pe.set("references", [])
			for ref in refs:
				ref.pop("name", None)
				ref.pop("parent", None)
				pe.append("references", ref)
		else:
			pe = self._advance_entry(party)
		pe.paid_amount = pe.received_amount = bank
		pe.base_paid_amount = pe.base_received_amount = bank
		pe.mode_of_payment = self.mode_of_payment
		pe.posting_date = getdate(self.posting_date)
		pe.reference_no = self.reference_no or None
		pe.reference_date = self.reference_date or (None if self.reference_no else pe.posting_date)

		pe.set("deductions", [])
		cost_center = get_company_default(self.company, "cost_center")
		sign = 1 if receive else -1
		tds_account = self.tds_account or (None if receive else _tds_account(party, self.company))
		if tds and not tds_account:
			frappe.throw(_("No TDS ledger found for {0} — choose the TDS Account.").format(party))
		for value, account, row_sign in ((charges, self.bank_charges_account, 1), (tds, tds_account, sign),
										 (wo, self.write_off_account, sign)):
			if value:
				pe.append("deductions", {"account": account, "cost_center": cost_center, "amount": row_sign * value})

		if bulk:
			pe.custom_bulk_payment = self.name
			pe.custom_remarks = 1
			pe.remarks = _("{0} {1}: {2} {3} — {4}{5}").format(
				_("Bulk Payment"), self.name, fmt_money(self.total_amount, currency=pe.paid_from_account_currency),
				_("received from {0} parties").format(self.party_count) if receive else _("paid to {0} parties").format(self.party_count),
				_("this one {0} for {1}").format(fmt_money(settled), ", ".join(r.reference_name for r in rows)),
				(" · " + self.remarks) if self.remarks else "")
			pe.flags.from_bulk_payment = True
		else:
			# the user's words, kept: without Custom Remarks ERPNext rewrites Remarks on validate
			pe.remarks = (self.remarks or "").strip() or None
			pe.custom_remarks = 1 if pe.remarks else 0
			pe.flags.from_order_flow = True
		pe.insert()
		if abs(flt(pe.difference_amount)) > 0.005:
			frappe.throw(_("The amounts do not balance for {0} (difference {1}). Check the amount and deductions.")
						 .format(party, flt(pe.difference_amount, 2)))
		pe.submit()
		return pe

	def _je_references(self, pe, party, rows):
		"""{Journal Entry: reference row} — as ERPNext's Get Outstanding builds them on a Payment Entry."""
		if not rows:
			return {}
		from erpnext.accounts.doctype.payment_entry.payment_entry import get_outstanding_reference_documents

		found = {d.voucher_no: d for d in get_outstanding_reference_documents({
			"posting_date": self.posting_date, "company": self.company, "party_type": self.party_type,
			"payment_type": self.payment_type, "party": party, "party_account": pe.party_account,
			"get_outstanding_invoices": True}) if d.voucher_type == JE}
		out = {}
		for row in rows:
			d = found.get(row.reference_name)
			if not d:
				frappe.throw(_("{0}: nothing is due on it for {1} any more.").format(row.reference_name, party))
			out[row.reference_name] = {"reference_doctype": JE, "reference_name": row.reference_name,
				"due_date": d.get("due_date") or d.get("posting_date"), "total_amount": flt(d.invoice_amount),
				"outstanding_amount": flt(d.outstanding_amount), "allocated_amount": flt(row.allocated_amount),
				"exchange_rate": 1, "account": d.get("account") or pe.party_account}
		return out

	def _advance_entry(self, party):
		"""A Payment Entry with no invoice — all of it advance (Receive: customer advance; Pay: to a supplier)."""
		from erpnext.accounts.party import get_party_account

		receive = self.payment_type == "Receive"
		party_account = get_party_account(self.party_type, party, self.company)
		pe = frappe.new_doc("Payment Entry")
		pe.update({"payment_type": self.payment_type, "company": self.company, "party_type": self.party_type,
				   "party": party, "posting_date": self.posting_date,
				   "paid_from": party_account if receive else self.bank_cash_account,
				   "paid_to": self.bank_cash_account if receive else party_account,
				   "source_exchange_rate": 1, "target_exchange_rate": 1})
		pe.setup_party_account_field()
		pe.set_missing_values()
		return pe

	def on_submit(self):
		made = self.make_entries(bulk=True)
		self.db_set({"payment_entries": ", ".join(made), "status": "Submitted"}, update_modified=False)
		frappe.msgprint(_("{0} Payment Entr{1} made and submitted: {2}").format(
			len(made), "y" if len(made) == 1 else "ies", ", ".join(made)), indicator="green", alert=True)

	def on_cancel(self):
		self.db_set("status", "Cancelled", update_modified=False)

	def before_cancel(self):
		# its Payment Entries go first (they link back to this document)
		for name in sorted({r.payment_entry for r in self.allocations if r.payment_entry}):
			pe = frappe.get_doc("Payment Entry", name)
			if pe.docstatus == 1:
				pe.flags.from_bulk_payment = True
				pe.flags.ignore_links = True   # this Bulk Payment (still submitted) links to it — cancelled together
				pe.cancel()

	def on_trash(self):
		"""A draft or cancelled Bulk Payment may be deleted. Its cancelled Payment Entries stay (audit
		trail); their link to it is cleared and each gets a dated comment, so nothing points at a
		deleted document."""
		for pe in frappe.get_all("Payment Entry", filters={"custom_bulk_payment": self.name}, fields=["name", "docstatus"]):
			if pe.docstatus == 1:
				frappe.throw(_("{0} is still submitted — cancel this Bulk Payment first.").format(pe.name))
			frappe.db.set_value("Payment Entry", pe.name, "custom_bulk_payment", None, update_modified=False)
			frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Payment Entry",
							"reference_name": pe.name, "content": _("{0}: was part of Bulk Payment {1}, which was deleted after being cancelled.").format(
								frappe.utils.nowdate(), self.name)}).insert(ignore_permissions=True)


def _tds_account(party, company):
	from erp_dacsinc_custom.dashboard_payment import _supplier_tds_account
	return _supplier_tds_account(party, company, frappe.get_cached_value("Company", company, "abbr"))


def payment_entry_on_cancel(doc, method=None):
	"""One of a Bulk Payment's entries cancelled on its own (not by cancelling the Bulk Payment): its rows there are
	marked Cancelled, the amount it received / paid is added to Cancelled Amount, the status becomes Partly
	Cancelled with a dated comment — and when no entry of it is left submitted, the Bulk Payment is cancelled."""
	bp_name = doc.get("custom_bulk_payment")
	if not bp_name:
		return
	# the submitted Bulk Payment links to this entry (its rows) — that must not stop the cancel. Set here, not
	# before_cancel: ERPNext's own on_cancel replaces ignore_linked_doctypes, and Frappe checks the links after
	# the on_cancel hooks
	doc.ignore_linked_doctypes = tuple(doc.get("ignore_linked_doctypes") or ()) + ("Bulk Payment", "Bulk Payment Allocation")
	if doc.flags.get("from_bulk_payment"):
		return
	bp = frappe.get_doc("Bulk Payment", bp_name)
	if bp.docstatus != 1:
		return
	for row in bp.allocations:
		if row.payment_entry == doc.name and not row.cancelled:
			row.db_set("cancelled", 1, update_modified=False)
	amount = flt(doc.received_amount if doc.payment_type == "Receive" else doc.paid_amount)
	left = frappe.get_all("Payment Entry", filters={"custom_bulk_payment": bp.name, "docstatus": 1}, pluck="name")
	bp.db_set({"cancelled_amount": flt(flt(bp.cancelled_amount) + amount, 2),
			   "status": "Partly Cancelled" if left else "Cancelled"}, update_modified=True)
	bp.add_comment("Comment", _("{0}: Payment Entry {1} ({2}, {3}) was cancelled on its own.").format(
		frappe.utils.nowdate(), doc.name, doc.party_name or doc.party, fmt_money(amount)))
	if not left:
		# nothing of it stands any more: cancel it too (its own cancel finds no submitted entry to cancel)
		bp.reload()
		bp.flags.ignore_permissions = True
		bp.cancel()
		frappe.msgprint(_("That was the last Payment Entry of Bulk Payment {0}, so it is cancelled too.").format(bp.name), alert=True)
	else:
		frappe.msgprint(_("Bulk Payment {0} is now Partly Cancelled: {1} still stand ({2}).").format(
			bp.name, len(left), ", ".join(left)), alert=True)


def _can_pay():
	return bool(frappe.has_permission("Payment Entry", "create") and frappe.has_permission("Payment Entry", "submit"))


@frappe.whitelist()
def get_payment_setup(payment_type, company=None):
	"""What the prompt offers: the modes (only those ticked "Show in Payment Entry", with their account
	for the company) and the default deduction ledgers."""
	from erp_dacsinc_custom.dashboard_payment import _account, _first_account
	from erp_dacsinc_custom.payment_modes import FLAG

	if payment_type not in INVOICE:
		frappe.throw(_("Unknown payment type."))
	if not _can_pay():
		frappe.throw(_("You are not allowed to create and submit Payment Entries."), frappe.PermissionError)
	company = company or frappe.defaults.get_user_default("Company")
	abbr = frappe.get_cached_value("Company", company, "abbr")
	mode_filters = {"enabled": 1}
	if frappe.db.has_column("Mode of Payment", FLAG):
		mode_filters[FLAG] = 1
	modes = []
	for m in frappe.get_all("Mode of Payment", filters=mode_filters, fields=["name", "type"], order_by="name"):
		acc = frappe.db.get_value("Mode of Payment Account", {"parent": m.name, "company": company}, "default_account")
		if acc:
			modes.append({"name": m.name, "type": m.type, "account": acc,
						  "account_type": frappe.get_cached_value("Account", acc, "account_type")})
	company_doc = frappe.get_cached_doc("Company", company)
	return {
		"company": company,
		"currency": company_doc.default_currency,
		"modes": modes,
		"can_bulk": bool(frappe.has_permission("Bulk Payment", "create") and frappe.has_permission("Bulk Payment", "submit")),
		"defaults": {
			"bank_charges_account": _first_account(company, f"Bank Charges - {abbr}", f"Bank Charges A/c - {abbr}"),
			"card_charges_account": _first_account(company, f"Card Swipe Bank Charges - {abbr}"),
			"tds_account": _first_account(company, f"TDS Receivable - {abbr}") if payment_type == "Receive" else None,
			"write_off_account": _account(company_doc.write_off_account, company) or _first_account(company, f"Write Off - {abbr}"),
		},
	}


def _search_parties(party_type, txt, limit=300, within=None):
	"""Customers / suppliers matching `txt` on id, name, mobile, email, GSTIN, any of their addresses
	(lines, city, pincode, phone) or a phone / mobile on any of their contacts — a list of ids.
	`within`: only among these ids."""
	like = f"%{txt}%"
	if within is not None and not within:
		return []
	w1 = "AND name IN %(w)s" if within else ""
	w2 = "AND dl.link_name IN %(w)s" if within else ""
	name_col = "customer_name" if party_type == "Customer" else "supplier_name"
	hits = frappe.db.sql(f"""
		SELECT name FROM `tab{party_type}` WHERE disabled = 0 {w1} AND (name LIKE %(t)s OR {name_col} LIKE %(t)s
			OR IFNULL(mobile_no, '') LIKE %(t)s OR IFNULL(email_id, '') LIKE %(t)s OR IFNULL(gstin, '') LIKE %(t)s)
		UNION
		SELECT dl.link_name FROM `tabDynamic Link` dl JOIN `tabAddress` a ON a.name = dl.parent
		WHERE dl.parenttype = 'Address' AND dl.link_doctype = %(pt)s {w2} AND (a.address_line1 LIKE %(t)s
			OR IFNULL(a.address_line2, '') LIKE %(t)s OR IFNULL(a.city, '') LIKE %(t)s OR IFNULL(a.pincode, '') LIKE %(t)s
			OR IFNULL(a.phone, '') LIKE %(t)s OR IFNULL(a.gstin, '') LIKE %(t)s)
		UNION
		SELECT dl.link_name FROM `tabDynamic Link` dl JOIN `tabContact Phone` cp ON cp.parent = dl.parent
		WHERE dl.parenttype = 'Contact' AND dl.link_doctype = %(pt)s {w2} AND cp.phone LIKE %(t)s
		LIMIT {int(limit)}""", {"t": like, "pt": party_type, "w": tuple(within or [])}, pluck=True)
	return [h for h in hits if frappe.has_permission(party_type, "read", h)]


def _party_info(party_type, names):
	"""{id: {mobile, email, gstin, place}} — what the prompt shows under each name."""
	if not names:
		return {}
	addr_col = "customer_primary_address" if party_type == "Customer" else "supplier_primary_address"
	rows = frappe.get_all(party_type, filters={"name": ["in", list(names)]},
						  fields=["name", "mobile_no", "email_id", "gstin", addr_col + " as addr"])
	addrs = {a.name: a for a in frappe.get_all("Address", filters={"name": ["in", [r.addr for r in rows if r.addr]]},
											  fields=["name", "city", "pincode", "phone"])} if any(r.addr for r in rows) else {}
	out = {}
	for r in rows:
		a = addrs.get(r.addr) or {}
		mob = next((m for m in (r.mobile_no, a.get("phone")) if m and any(ch.isdigit() for ch in m)), "")
		out[r.name] = {"mobile": mob, "email": r.email_id or "", "gstin": r.gstin or "",
					   "place": " ".join(x for x in (a.get("city"), a.get("pincode")) if x)}
	return out


@frappe.whitelist()
def get_parties_due(payment_type, company=None, txt=None):
	"""The customers / suppliers with something unpaid — what the prompt lists to pick from: name,
	mobile, place, GSTIN, how many invoices, total due, oldest due date (most due first). `txt` searches
	id, name, mobile, email, GSTIN, addresses and contact phones; a search also lists matching parties
	with nothing due (for an advance)."""
	party_type, inv_dt, party_field, name_field = INVOICE[payment_type]
	if not _can_pay() or not frappe.has_permission(inv_dt, "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	company = company or frappe.defaults.get_user_default("Company")
	txt = (txt or "").strip()
	# who has something due — invoices, opening balances, other Journal Entries (Payment Ledger, as
	# party_open_items); only parties this user may see
	from erp_dacsinc_custom.party_open_items import open_items
	owing = frappe.db.sql("""SELECT party FROM `tabPayment Ledger Entry` WHERE delinked = 0 AND company = %s
		AND party_type = %s GROUP BY party, against_voucher_type, against_voucher_no HAVING SUM(amount) > 0.005""",
		(company, party_type), pluck=True)
	owing = list(dict.fromkeys(owing))
	if owing:
		owing = frappe.get_list(party_type, filters={"name": ["in", owing]}, pluck="name", limit_page_length=0)
	items = open_items(party_type, owing, company)
	names = dict(frappe.get_all(party_type, filters={"name": ["in", owing]}, fields=["name", name_field], as_list=True)) if owing else {}
	rows = []
	for party, its in items.items():
		due = [i for i in its if i.outstanding > 0.005 and i.kind in PAYABLE_KINDS]
		if due:
			rows.append(frappe._dict(party=party, party_name=names.get(party) or party, invoices=len(due),
									 due=flt(sum(i.outstanding for i in due), 2), oldest_due=min(i.due_date for i in due)))
	rows.sort(key=lambda r: -r.due)
	rows = rows[:500]
	if txt:
		# those who owe are searched first (all of them), then up to 15 others for an advance
		hit = set(_search_parties(party_type, txt, within=[r.party for r in rows]))
		rows = [r for r in rows if r.party in hit]
		have = {r.party for r in rows}
		name_col = "customer_name" if party_type == "Customer" else "supplier_name"
		rest = [n for n in _search_parties(party_type, txt, limit=60) if n not in have][:15]
		names = dict(frappe.get_all(party_type, filters={"name": ["in", rest]}, fields=["name", name_col], as_list=True)) if rest else {}
		rows += [frappe._dict(party=n, party_name=names.get(n) or n, invoices=0, due=0, oldest_due=None) for n in rest]
	info = _party_info(party_type, [r.party for r in rows])
	for r in rows:
		r.update(info.get(r.party) or {})
	return rows


@frappe.whitelist()
def get_open_invoices(payment_type, parties, company=None):
	"""What the chosen customers / suppliers still owe / are owed, oldest due first: invoices / bills, opening
	invoices, opening balances and other Journal Entries (party_open_items). Each row: doctype, name, kind (what it
	is, in words on the prompt), party, dates, total, outstanding."""
	from erp_dacsinc_custom.party_open_items import open_items

	party_type, inv_dt, party_field, name_field = INVOICE[payment_type]
	if not _can_pay() or not frappe.has_permission(inv_dt, "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	parties = frappe.parse_json(parties) if isinstance(parties, str) else (parties or [])
	if not parties:
		return []
	parties = frappe.get_list(party_type, filters={"name": ["in", parties]}, pluck="name", limit_page_length=0)
	company = company or frappe.defaults.get_user_default("Company")
	names = dict(frappe.get_all(party_type, filters={"name": ["in", parties]}, fields=["name", name_field], as_list=True)) if parties else {}
	rows = []
	for party, its in open_items(party_type, parties, company).items():
		for i in its:
			if i.outstanding > 0.005 and i.kind in PAYABLE_KINDS:
				rows.append({"name": i.name, "doctype": i.doctype, "kind": i.kind, "party": party, "party_name": names.get(party) or party,
							 "posting_date": i.posting_date, "due_date": i.due_date, "invoice_total": i.total,
							 "outstanding_amount": i.outstanding, "bill_no": i.bill_no, "remark": i.remark})
	rows.sort(key=lambda r: (str(r["due_date"] or ""), str(r["posting_date"] or ""), r["name"]))
	return rows


def _build(data):
	party_type, inv_dt = INVOICE[data.get("payment_type")][:2]   # rows' links are checked before any hook runs
	return frappe.get_doc({
		"doctype": "Bulk Payment",
		"payment_type": data.get("payment_type"),
		"party_type": party_type,
		"company": data.get("company") or frappe.defaults.get_user_default("Company"),
		"posting_date": data.get("posting_date"),
		"mode_of_payment": data.get("mode_of_payment"),
		"total_amount": flt(data.get("total_amount")),
		"reference_no": data.get("reference_no"),
		"reference_date": data.get("reference_date"),
		"remarks": data.get("remarks"),
		"bank_charges": flt(data.get("bank_charges")),
		"bank_charges_account": data.get("bank_charges_account") if flt(data.get("bank_charges")) else None,
		"tds_account": data.get("tds_account") or None,
		"write_off_account": data.get("write_off_account") or None,
		"allocations": [{"party_type": party_type, "party": a.get("party"),
						 "reference_doctype": JE if a.get("doctype") == JE else inv_dt,
						 "reference_name": a.get("invoice"), "allocated_amount": flt(a.get("amount")),
						 "tds_amount": flt(a.get("tds")), "write_off_amount": flt(a.get("write_off"))}
						for a in (data.get("allocations") or []) if flt(a.get("amount")) > 0],
	})


def _guard_dashboard(payment_type, parties):
	"""From Order Flow › Finance: the Finance tab and the sub-tab of every party must be open to act
	(customers: Receivables; suppliers: Jobber Payables for a jobber, else Supplier Payables)."""
	from erp_dacsinc_custom.order_flow_permissions import guard_act, guard_tab

	guard_tab("accounts")
	if payment_type == "Receive":
		guard_act("accounts", "receivables")
		return
	for sub in {"jobber" if cint(frappe.db.get_value("Supplier", p, "custom_is_jobber")) else "supplier" for p in parties}:
		guard_act("accounts", sub)


@frappe.whitelist()
def make_payment(data):
	"""The prompt's Submit. One party → one Payment Entry; several → a Bulk Payment (one entry each).
	Returns {bulk_payment, payment_entries}."""
	data = frappe.parse_json(data) if isinstance(data, str) else data
	if data.get("payment_type") not in INVOICE:
		frappe.throw(_("Unknown payment type."))
	if not _can_pay():
		frappe.throw(_("You are not allowed to create and submit Payment Entries."), frappe.PermissionError)
	doc = _build(data)
	parties = list(OrderedDict.fromkeys(r.party for r in doc.allocations if r.party)) \
		or ([data.get("party")] if data.get("party") else [])
	if not cint(data.get("from_form")):
		_guard_dashboard(doc.payment_type, parties)
	if len(parties) > 1:
		if not (frappe.has_permission("Bulk Payment", "create") and frappe.has_permission("Bulk Payment", "submit")):
			frappe.throw(_("Paying several {0} at once needs permission to create and submit a Bulk Payment.").format(
				_("customers") if doc.payment_type == "Receive" else _("suppliers")), frappe.PermissionError)
		doc.insert()
		doc.submit()
		return {"bulk_payment": doc.name, "payment_entries": [p for p in (doc.payment_entries or "").split(", ") if p]}
	if not parties or not frappe.db.exists(INVOICE[doc.payment_type][0], parties[0]):
		frappe.throw(_("Choose the {0}.").format(_("customer") if doc.payment_type == "Receive" else _("supplier")))
	doc.flags.allow_advance = True
	doc.flags.advance_party = parties[0]
	doc.before_validate()
	doc.validate()
	return {"bulk_payment": None, "payment_entries": doc.make_entries(bulk=False)}


@frappe.whitelist()
def cancel_preview(bulk_payment=None, payment_entry=None):
	"""What a cancel will do, for the confirmation on the Payment Entry / Bulk Payment form: the Bulk Payment, its
	submitted entries (party, amount, what each settles) and, for one entry, what cancelling only it leaves."""
	if payment_entry:
		bulk_payment = frappe.db.get_value("Payment Entry", payment_entry, "custom_bulk_payment")
	if not bulk_payment:
		return None
	bp = frappe.get_doc("Bulk Payment", bulk_payment)
	bp.check_permission("read")
	entries = []
	for pe in frappe.get_all("Payment Entry", filters={"custom_bulk_payment": bp.name, "docstatus": 1},
							 fields=["name", "party", "party_name", "payment_type", "paid_amount", "received_amount",
									 "unallocated_amount"], order_by="name"):
		refs = frappe.get_all("Payment Entry Reference", filters={"parent": pe.name, "allocated_amount": [">", 0]},
							  fields=["reference_doctype", "reference_name", "allocated_amount"], order_by="idx")
		entries.append({"name": pe.name, "party": pe.party, "party_name": pe.party_name or pe.party,
						"amount": flt(pe.received_amount if pe.payment_type == "Receive" else pe.paid_amount),
						"advance": flt(pe.unallocated_amount), "refs": refs})
	return {"bulk_payment": bp.name, "status": bp.status, "docstatus": bp.docstatus, "payment_type": bp.payment_type,
			"total": flt(bp.bank_amount or bp.total_amount), "cancelled_amount": flt(bp.cancelled_amount),
			"entries": entries, "this": payment_entry,
			"can_cancel_bulk": bool(frappe.has_permission("Bulk Payment", "cancel", bp.name)),
			"can_cancel_entry": bool(payment_entry and frappe.has_permission("Payment Entry", "cancel", payment_entry))}


@frappe.whitelist()
def cancel_bulk_payment(bulk_payment):
	"""Cancel a whole Bulk Payment (and so its submitted entries) — the confirmation's second choice."""
	bp = frappe.get_doc("Bulk Payment", bulk_payment)
	bp.check_permission("cancel")
	if bp.docstatus != 1:
		frappe.throw(_("{0} is not submitted.").format(bp.name))
	bp.cancel()
	return bp.name


def payment_entry_on_trash(doc, method=None):
	"""A cancelled Payment Entry of a Bulk Payment (cancelled with it, or on its own) may be deleted: its rows there
	drop the link and keep "Cancelled"."""
	if not doc.get("custom_bulk_payment"):
		return
	frappe.db.sql("""UPDATE `tabBulk Payment Allocation` SET payment_entry = NULL
		WHERE parent = %s AND payment_entry = %s""", (doc.custom_bulk_payment, doc.name))


def invoice_before_cancel(doc, method=None):
	"""An invoice paid through a Bulk Payment is not cancelled under it — first cancel the Payment Entry that pays it
	(the Bulk Payment becomes Partly Cancelled) or the whole Bulk Payment."""
	bulk = frappe.db.sql("""SELECT DISTINCT CONCAT(pe.name, ' (', pe.custom_bulk_payment, ')') FROM `tabPayment Entry Reference` per
		JOIN `tabPayment Entry` pe ON pe.name = per.parent
		WHERE per.reference_doctype = %s AND per.reference_name = %s AND pe.docstatus = 1
		AND IFNULL(pe.custom_bulk_payment, '') != ''""", (doc.doctype, doc.name), pluck=True)
	if bulk:
		frappe.throw(_("{0} is paid by {1} of a Bulk Payment — cancel that Payment Entry first (or the whole Bulk Payment).").format(
			doc.name, ", ".join(bulk)), title=_("Paid by a Bulk Payment"))


def unreconcile_before_submit(doc, method=None):
	"""UnReconcile would change a Bulk Payment's Payment Entry behind its back — cancel the Bulk
	Payment and make it again instead."""
	if doc.get("voucher_type") == "Payment Entry" and doc.get("voucher_no"):
		bulk = frappe.db.get_value("Payment Entry", doc.voucher_no, "custom_bulk_payment")
		if bulk and frappe.db.get_value("Bulk Payment", bulk, "docstatus") == 1:
			frappe.throw(_("{0} is part of Bulk Payment {1}: to change its allocation, cancel the Bulk Payment, amend it and submit again.").format(
				doc.voucher_no, bulk), title=_("Part of a Bulk Payment"))
