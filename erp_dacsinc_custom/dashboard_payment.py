"""Order Flow › Finance: record a payment against one invoice from a prompt.

The prompt (public/js/payment_prompt.js › of_payment_prompt — on Order Flow › Finance rows and
on the Sales / Purchase Invoice forms) asks what an accountant fills on a Payment
Entry: date, mode of payment, amount, reference no / date, and the amounts that settle the
invoice without passing through the bank: bank charges, TDS and a small difference written
off. The Payment Entry is built with ERPNext's own get_payment_entry (the same as the
invoice's Create › Payment), adjusted, and submitted as the user, so the user's own
Payment Entry permissions apply.

Deductions are always posted as debits (PaymentEntry.add_deductions_gl_entries), and must
make  allocated − received = deductions (Receive)  /  paid − allocated = deductions (Pay):

  Receive (customer):  Dr Bank amount, Dr Bank Charges, Dr TDS Receivable, Dr Write Off
                       Cr Debtors  amount + charges + TDS + write-off
  Pay (supplier):      Dr Creditors  amount + TDS + write-off
                       Dr Bank Charges;  Cr Bank  amount + charges
                       Cr TDS Payable, Cr Write Off (negative deduction rows)
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate

from erp_dacsinc_custom.order_flow_permissions import guard_act, guard_tab

INVOICE_DOCTYPES = ("Sales Invoice", "Purchase Invoice")


def _invoice_total(doc):
    return flt(doc.rounded_total) or flt(doc.grand_total)


def _account(name, company):
    """`name` if that ledger exists (non-group) in the company, else None."""
    if name and frappe.db.exists("Account", {"name": name, "company": company, "is_group": 0}):
        return name
    return None


def _supplier_tds_account(supplier, company, abbr):
    """The TDS ledger for paying this supplier: the account on their Tax Withholding Category for
    this company; else, for a jobber (job work = 194C), TDS on Contract; else TDS Payable."""
    category = frappe.db.get_value("Supplier", supplier, "tax_withholding_category")
    if category:
        acc = frappe.db.get_value("Tax Withholding Account", {"parent": category, "company": company}, "account")
        if _account(acc, company):
            return acc
    if cint(frappe.db.get_value("Supplier", supplier, "custom_is_jobber")):
        acc = _first_account(company, f"TDS on Contract - {abbr}")
        if acc:
            return acc
    return _first_account(company, f"TDS Payable - {abbr}")


# Which ledgers each deduction may go to (prompt filter and record_payment check): bank charges
# and write-off are expenses; TDS is a TDS ledger (an asset when customers cut it, a liability
# when we cut it — matched by name, since the TDS ledgers carry no common account type).
def _deduction_account_ok(kind, account):
    root, name = frappe.db.get_value("Account", account, ["root_type", "account_name"]) or (None, "")
    if kind in ("bank_charges", "write_off"):
        return root == "Expense"
    if kind == "tds":
        return "TDS" in (name or "").upper() and root in ("Asset", "Liability")
    return False


def _first_account(company, *candidates):
    for c in candidates:
        if _account(c, company):
            return c
    return None


def _load(doctype, name, from_form=0):
    """The invoice, after the access checks. From Order Flow › Finance: the Finance tab and its
    sub-tab must be open to the user to act. From the invoice's own form (`from_form`, its
    "Receive / Make Payment" button in place of Create › Payment): read on the invoice, plus the
    Payment Entry create + submit permission every caller checks — the same as Create › Payment."""
    if doctype not in INVOICE_DOCTYPES:
        frappe.throw(_("Payments can be recorded only against a Sales Invoice or Purchase Invoice."))
    if not cint(from_form):
        guard_tab("accounts")
    doc = frappe.get_doc(doctype, name)
    doc.check_permission("read")
    if doctype == "Sales Invoice":
        sub = "receivables"
    else:
        # same split as Finance: jobber supplier or subcontracted invoice = Jobber Payables
        is_jobwork = cint(doc.get("is_subcontracted")) or cint(frappe.db.get_value("Supplier", doc.supplier, "custom_is_jobber"))
        sub = "jobber" if is_jobwork else "supplier"
    if not cint(from_form):
        guard_act("accounts", sub)
    if doc.docstatus != 1:
        frappe.throw(_("{0} {1} is not submitted.").format(_(doctype), name))
    if flt(doc.outstanding_amount) <= 0:
        frappe.throw(_("{0} {1} has nothing outstanding.").format(_(doctype), name))
    return doc


def can_record_payment():
    return bool(frappe.has_permission("Payment Entry", "create")
                and frappe.has_permission("Payment Entry", "submit"))


@frappe.whitelist()
def get_payment_prompt(doctype, name, from_form=0):
    """Everything the prompt shows and defaults to for this invoice."""
    doc = _load(doctype, name, from_form)
    if not can_record_payment():
        frappe.throw(_("You are not allowed to create and submit Payment Entries."), frappe.PermissionError)
    company = doc.company
    receive = doctype == "Sales Invoice"
    abbr = frappe.get_cached_value("Company", company, "abbr")

    from erp_dacsinc_custom.payment_modes import FLAG
    mode_filters = {"enabled": 1}
    if frappe.db.has_column("Mode of Payment", FLAG):
        mode_filters[FLAG] = 1   # only modes ticked "Show in Payment Entry" — no POS counter / store modes
    modes = []
    for m in frappe.get_all("Mode of Payment", filters=mode_filters, fields=["name", "type"], order_by="name"):
        acc = frappe.db.get_value("Mode of Payment Account", {"parent": m.name, "company": company}, "default_account")
        if acc:
            modes.append({"name": m.name, "type": m.type, "account": acc,
                          "account_type": frappe.get_cached_value("Account", acc, "account_type")})

    company_doc = frappe.get_cached_doc("Company", company)
    return {
        "doctype": doctype,
        "name": doc.name,
        "receive": receive,
        "party_type": "Customer" if receive else "Supplier",
        "party": doc.customer if receive else doc.supplier,
        "party_name": (doc.customer_name if receive else doc.supplier_name) or "",
        "company": company,
        "currency": doc.currency,
        "posting_date": str(doc.posting_date),
        "due_date": str(doc.due_date or ""),
        "invoice_total": _invoice_total(doc),
        "outstanding": flt(doc.outstanding_amount),
        "bill_no": (doc.get("bill_no") or "") if not receive else "",
        "tds_on_invoice": flt(doc.get("taxes_and_charges_deducted")) if not receive else 0,
        "modes": modes,
        "defaults": {
            "bank_charges_account": _first_account(company, f"Bank Charges - {abbr}", f"Bank Charges A/c - {abbr}"),
            "card_charges_account": _first_account(company, f"Card Swipe Bank Charges - {abbr}"),
            "tds_account": _first_account(company, f"TDS Receivable - {abbr}") if receive
                           else _supplier_tds_account(doc.supplier, company, abbr),
            "write_off_account": _account(company_doc.write_off_account, company)
                                 or _first_account(company, f"Write Off - {abbr}"),
            "round_off_account": _account(company_doc.round_off_account, company),
        },
    }


@frappe.whitelist()
def record_payment(doctype, name, mode_of_payment, amount, posting_date=None, reference_no=None,
                   reference_date=None, bank_charges=0, bank_charges_account=None, tds_amount=0,
                   tds_account=None, write_off_amount=0, write_off_account=None, remarks=None, from_form=0):
    """Create and submit the Payment Entry the prompt describes. Returns its name."""
    doc = _load(doctype, name, from_form)
    if not can_record_payment():
        frappe.throw(_("You are not allowed to create and submit Payment Entries."), frappe.PermissionError)
    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
    from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account
    from erpnext.accounts.utils import get_company_default

    company = doc.company
    receive = doctype == "Sales Invoice"
    amount, charges = flt(amount, 2), flt(bank_charges, 2)
    tds, write_off = flt(tds_amount, 2), flt(write_off_amount, 2)
    if amount <= 0:
        frappe.throw(_("Enter the amount {0}.").format(_("received") if receive else _("paid")))
    if min(charges, tds, write_off) < 0:
        frappe.throw(_("Bank charges, TDS and write-off cannot be negative."))
    for value, account, label, kind in ((charges, bank_charges_account, _("Bank Charges"), "bank_charges"),
                                        (tds, tds_account, _("TDS"), "tds"),
                                        (write_off, write_off_account, _("Write Off"), "write_off")):
        if value and not _account(account, company):
            frappe.throw(_("Choose the account for {0}.").format(label))
        if value and not _deduction_account_ok(kind, account):
            frappe.throw(_("{0} cannot go to {1}: choose an expense account for bank charges / write-off, "
                           "and a TDS account for TDS.").format(label, account))

    from erp_dacsinc_custom.payment_modes import shown
    if not shown(mode_of_payment):
        frappe.throw(_("Mode of Payment {0} is not ticked \"Show in Payment Entry\".").format(mode_of_payment))
    bank_account = (get_bank_cash_account(mode_of_payment, company) or {}).get("account")
    if not bank_account:
        frappe.throw(_("Mode of Payment {0} has no account for {1}.").format(mode_of_payment, company))
    is_bank = frappe.get_cached_value("Account", bank_account, "account_type") == "Bank"
    if is_bank and not (reference_no and reference_date):
        frappe.throw(_("Reference No and Reference Date are required for {0} (UTR / cheque / transaction number).").format(mode_of_payment))

    # What this payment settles on the invoice, and what moves through the bank / cash.
    settled = amount + charges + tds + write_off if receive else amount + tds + write_off
    bank_amount = amount if receive else amount + charges
    outstanding = flt(doc.outstanding_amount)
    if settled - outstanding > 0.005 and (charges or tds or write_off):
        frappe.throw(_("Amount plus bank charges, TDS and write-off ({0}) is more than the outstanding {1}. "
                       "Reduce the deductions; only the amount itself may exceed the outstanding (kept as advance).")
                     .format(frappe.format_value(settled, {"fieldtype": "Currency"}),
                             frappe.format_value(outstanding, {"fieldtype": "Currency"})))

    pe = get_payment_entry(doctype, name, bank_account=bank_account)
    pe.mode_of_payment = mode_of_payment
    pe.posting_date = getdate(posting_date or nowdate())
    pe.reference_no = reference_no or None
    pe.reference_date = getdate(reference_date) if reference_date else (None if is_bank else pe.posting_date)
    pe.paid_amount = bank_amount
    pe.received_amount = bank_amount
    for ref in pe.references:
        if ref.reference_doctype == doctype and ref.reference_name == name:
            ref.allocated_amount = min(settled, outstanding)
    pe.set("deductions", [])
    cost_center = doc.get("cost_center") or get_company_default(company, "cost_center")
    sign = 1 if receive else -1
    for value, account, row_sign in ((charges, bank_charges_account, 1),
                                     (tds, tds_account, sign),
                                     (write_off, write_off_account, sign)):
        if value:
            pe.append("deductions", {"account": account, "cost_center": cost_center, "amount": row_sign * value})
    pe.remarks = (remarks or "").strip() or None
    pe.flags.from_order_flow = True
    pe.insert()
    if abs(flt(pe.difference_amount)) > 0.005:
        frappe.throw(_("The amounts do not balance (difference {0}). Check the amount and deductions.")
                     .format(flt(pe.difference_amount, 2)))
    pe.submit()
    return {"name": pe.name, "outstanding": flt(frappe.db.get_value(doctype, name, "outstanding_amount"))}
