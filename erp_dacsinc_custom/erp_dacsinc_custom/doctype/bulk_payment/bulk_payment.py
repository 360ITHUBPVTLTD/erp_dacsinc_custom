"""Receive / Pay — one prompt (public/js/bulk_payment.js) for every payment against invoices / bills:
one invoice, several invoices of one party, or one amount (a cheque, a transfer, cash) for several
parties and their invoices. docs/bulk-payment.md.

- One party  → one standard Payment Entry (its invoices as references; an amount above them is kept
  as advance; no invoice at all = an advance).                                   make_payment
- Several    → a Bulk Payment (this doctype) that, on Submit, makes one Payment Entry per party, each
  marked with it (Payment Entry › custom_bulk_payment) and sharing its mode, date and cheque /
  reference no. Cancelling it cancels them; one of them can't be cancelled on its own.

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

INVOICE = {"Receive": ("Customer", "Sales Invoice", "customer", "customer_name"),
		   "Pay": ("Supplier", "Purchase Invoice", "supplier", "supplier_name")}


class BulkPayment(Document):
	def _validate_links(self):
		# Frappe checks links before any hook on insert: a draft (new, or amended from a cancelled one,
		# however it was copied) has no Payment Entries yet — its Submit makes them — so drop old ones first
		if self.docstatus == 0:
			self.payment_entries = None
			for row in self.allocations:
				row.payment_entry = None
		return super()._validate_links()

	def before_validate(self):
		# the rows' Dynamic Links (party, invoice) are checked against these — set them first
		if self.payment_type in INVOICE:
			party_type, inv_dt = INVOICE[self.payment_type][:2]
			self.party_type = party_type
			for row in self.allocations:
				row.party_type, row.reference_doctype = party_type, inv_dt

	def validate(self):
		"""Also run (without saving) for a one-party payment from the prompt: flags.allow_advance lets the
		total exceed the invoices (kept as advance on its Payment Entry), flags.advance_party names the
		party when no invoice is chosen."""
		from erp_dacsinc_custom.dashboard_payment import _deduction_account_ok

		if not self.company:
			self.company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
		party_type, inv_dt, party_field, name_field = INVOICE[self.payment_type]
		receive = self.payment_type == "Receive"
		self.party_type = party_type
		self._set_bank_account()
		seen, total, tds, wo = set(), 0.0, 0.0, 0.0
		for row in self.allocations:
			row.party_type, row.reference_doctype = party_type, inv_dt
			if not row.reference_name:
				frappe.throw(_("Row {0}: choose the invoice.").format(row.idx))
			if row.reference_name in seen:
				frappe.throw(_("Row {0}: {1} is in the table twice.").format(row.idx, row.reference_name))
			seen.add(row.reference_name)
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
			pe = get_payment_entry(rows[0].reference_doctype, rows[0].reference_name, bank_account=self.bank_cash_account)
			refs = []
			for row in rows:
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
		self.db_set("payment_entries", ", ".join(made), update_modified=False)
		frappe.msgprint(_("{0} Payment Entr{1} made and submitted: {2}").format(
			len(made), "y" if len(made) == 1 else "ies", ", ".join(made)), indicator="green", alert=True)

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


def payment_entry_before_cancel(doc, method=None):
	"""A Payment Entry made by a Bulk Payment is cancelled with it, not on its own."""
	if doc.get("custom_bulk_payment") and not doc.flags.get("from_bulk_payment") \
			and frappe.db.get_value("Bulk Payment", doc.custom_bulk_payment, "docstatus") == 1:
		frappe.throw(_("{0} is part of Bulk Payment {1} — cancel the Bulk Payment (it cancels all its entries together).").format(
			doc.name, doc.custom_bulk_payment), title=_("Part of a Bulk Payment"))


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
	filters = {"docstatus": 1, "is_return": 0, "outstanding_amount": [">", 0.005], "company": company}
	rows = frappe.get_list(inv_dt, filters=filters,
						   fields=[party_field + " as party", f"max({name_field}) as party_name", "count(name) as invoices",
								   "sum(outstanding_amount) as due", "min(due_date) as oldest_due"],
						   group_by=party_field, order_by="due desc", limit_page_length=500)
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
	"""Unpaid submitted invoices / bills of the chosen customers / suppliers (oldest due first)."""
	party_type, inv_dt, party_field, name_field = INVOICE[payment_type]
	if not _can_pay() or not frappe.has_permission(inv_dt, "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	parties = frappe.parse_json(parties) if isinstance(parties, str) else (parties or [])
	if not parties:
		return []
	company = company or frappe.defaults.get_user_default("Company")
	fields = ["name", party_field + " as party", name_field + " as party_name", "posting_date", "due_date",
			  "rounded_total", "grand_total", "outstanding_amount", "currency"]
	if inv_dt == "Purchase Invoice":
		fields.append("bill_no")
	rows = frappe.get_list(inv_dt, filters={"docstatus": 1, "is_return": 0, "outstanding_amount": [">", 0.005],
											party_field: ["in", parties], "company": company},
						   fields=fields, order_by="due_date asc, posting_date asc, name asc", limit_page_length=1000)
	for r in rows:
		r["invoice_total"] = flt(r.rounded_total) or flt(r.grand_total)
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
		"allocations": [{"party_type": party_type, "party": a.get("party"), "reference_doctype": inv_dt,
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


def payment_entry_on_trash(doc, method=None):
	"""A Payment Entry of a submitted Bulk Payment can't be deleted (it is submitted anyway); one of a
	cancelled Bulk Payment can — its row there drops the link."""
	if not doc.get("custom_bulk_payment"):
		return
	if frappe.db.get_value("Bulk Payment", doc.custom_bulk_payment, "docstatus") == 1:
		frappe.throw(_("{0} is part of Bulk Payment {1} — cancel the Bulk Payment first.").format(doc.name, doc.custom_bulk_payment))
	frappe.db.sql("""UPDATE `tabBulk Payment Allocation` SET payment_entry = NULL
		WHERE parent = %s AND payment_entry = %s""", (doc.custom_bulk_payment, doc.name))


def invoice_before_cancel(doc, method=None):
	"""An invoice paid by a submitted Bulk Payment is not cancelled under it — the Bulk Payment (and
	so its Payment Entries) is cancelled first."""
	bulk = frappe.db.sql("""SELECT DISTINCT pe.custom_bulk_payment FROM `tabPayment Entry Reference` per
		JOIN `tabPayment Entry` pe ON pe.name = per.parent
		WHERE per.reference_doctype = %s AND per.reference_name = %s AND pe.docstatus = 1
		AND IFNULL(pe.custom_bulk_payment, '') != ''""", (doc.doctype, doc.name), pluck=True)
	if bulk:
		frappe.throw(_("{0} is paid by Bulk Payment {1} — cancel the Bulk Payment first (it cancels its Payment Entries together).").format(
			doc.name, ", ".join(bulk)), title=_("Paid by a Bulk Payment"))


def unreconcile_before_submit(doc, method=None):
	"""UnReconcile would change a Bulk Payment's Payment Entry behind its back — cancel the Bulk
	Payment and make it again instead."""
	if doc.get("voucher_type") == "Payment Entry" and doc.get("voucher_no"):
		bulk = frappe.db.get_value("Payment Entry", doc.voucher_no, "custom_bulk_payment")
		if bulk and frappe.db.get_value("Bulk Payment", bulk, "docstatus") == 1:
			frappe.throw(_("{0} is part of Bulk Payment {1}: to change its allocation, cancel the Bulk Payment, amend it and submit again.").format(
				doc.voucher_no, bulk), title=_("Part of a Bulk Payment"))
