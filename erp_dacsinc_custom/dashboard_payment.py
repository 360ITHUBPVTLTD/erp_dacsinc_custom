"""Refunds on returns (below), and the ledger helpers the Receive / Pay prompt shares
(doctype/bulk_payment/bulk_payment.py › make_payment — payments against invoices, docs/bulk-payment.md):
the deduction ledgers allowed and the supplier's TDS ledger.

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


def can_record_payment():
    return bool(frappe.has_permission("Payment Entry", "create")
                and frappe.has_permission("Payment Entry", "submit"))


# ── Refunds on returns (Finance › Returns / Notes, and the Credit / Debit Note form) ─────────────
# A Credit Note with its own negative outstanding = a credit the customer has with us; refunding
# it is a Payment Entry of type Pay to the customer (Dr Debtors, Cr Bank). A Debit Note with a
# negative outstanding = the supplier owes us; their refund is a Receive from the supplier
# (Dr Bank, Cr Creditors). Built with ERPNext's get_payment_entry, as Create › Payment would.

def _load_return(doctype, name, from_form=0):
    if doctype not in INVOICE_DOCTYPES:
        frappe.throw(_("Refunds are recorded only against a Credit Note or Debit Note."))
    if not cint(from_form):
        guard_tab("accounts")
    doc = frappe.get_doc(doctype, name)
    doc.check_permission("read")
    if not cint(doc.is_return):
        frappe.throw(_("{0} is not a return (Credit / Debit Note).").format(name))
    if doctype == "Sales Invoice":
        sub = "receivables"
    else:
        is_jobwork = cint(doc.get("is_subcontracted")) or cint(frappe.db.get_value("Supplier", doc.supplier, "custom_is_jobber"))
        sub = "jobber" if is_jobwork else "supplier"
    if not cint(from_form):
        guard_act("accounts", sub)
    if doc.docstatus != 1:
        frappe.throw(_("{0} {1} is not submitted.").format(_(doctype), name))
    if flt(doc.outstanding_amount) >= -0.005:
        frappe.throw(_("{0} has nothing to refund — it was set off against its invoice, or already refunded / adjusted.").format(name))
    if not can_record_payment():
        frappe.throw(_("You are not allowed to create and submit Payment Entries."), frappe.PermissionError)
    return doc


@frappe.whitelist()
def get_refund_prompt(doctype, name, from_form=0):
    doc = _load_return(doctype, name, from_form)
    from erp_dacsinc_custom.payment_modes import FLAG
    credit = doctype == "Sales Invoice"
    mode_filters = {"enabled": 1}
    if frappe.db.has_column("Mode of Payment", FLAG):
        mode_filters[FLAG] = 1
    modes = []
    for m in frappe.get_all("Mode of Payment", filters=mode_filters, fields=["name", "type"], order_by="name"):
        acc = frappe.db.get_value("Mode of Payment Account", {"parent": m.name, "company": doc.company}, "default_account")
        if acc:
            modes.append({"name": m.name, "account": acc,
                          "account_type": frappe.get_cached_value("Account", acc, "account_type")})
    party = doc.customer if credit else doc.supplier
    return {
        "doctype": doctype, "name": doc.name, "credit_note": credit,
        "party_type": "Customer" if credit else "Supplier", "party": party,
        "party_name": (doc.customer_name if credit else doc.supplier_name) or "",
        "company": doc.company, "currency": doc.currency, "posting_date": str(doc.posting_date),
        "return_against": doc.return_against or "", "note_total": abs(_invoice_total(doc)),
        "refund_due": -flt(doc.outstanding_amount), "modes": modes,
    }


@frappe.whitelist()
def record_refund(doctype, name, mode_of_payment, amount, posting_date=None, reference_no=None,
                  reference_date=None, remarks=None, from_form=0):
    doc = _load_return(doctype, name, from_form)
    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
    from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account
    from erp_dacsinc_custom.payment_modes import shown

    amount = flt(amount, 2)
    due = -flt(doc.outstanding_amount)
    if amount <= 0:
        frappe.throw(_("Enter the refund amount."))
    if amount - due > 0.005:
        frappe.throw(_("The refund {0} is more than the {1} due on {2}.").format(
            frappe.format_value(amount, {"fieldtype": "Currency"}), frappe.format_value(due, {"fieldtype": "Currency"}), name))
    if not shown(mode_of_payment):
        frappe.throw(_("Mode of Payment {0} is not ticked \"Show in Payment Entry\".").format(mode_of_payment))
    bank_account = (get_bank_cash_account(mode_of_payment, doc.company) or {}).get("account")
    if not bank_account:
        frappe.throw(_("Mode of Payment {0} has no account for {1}.").format(mode_of_payment, doc.company))
    is_bank = frappe.get_cached_value("Account", bank_account, "account_type") == "Bank"
    if is_bank and not (reference_no and reference_date):
        frappe.throw(_("Reference No and Reference Date are required for {0} (UTR / cheque / transaction number).").format(mode_of_payment))

    pe = get_payment_entry(doctype, name, party_amount=amount, bank_account=bank_account)
    pe.mode_of_payment = mode_of_payment
    pe.posting_date = getdate(posting_date or nowdate())
    pe.reference_no = reference_no or None
    pe.reference_date = getdate(reference_date) if reference_date else (None if is_bank else pe.posting_date)
    pe.paid_amount = pe.received_amount = amount
    for ref in pe.references:
        if ref.reference_doctype == doctype and ref.reference_name == name:
            ref.allocated_amount = -amount
    pe.set("deductions", [])
    # the user's words, kept: without Custom Remarks ERPNext rewrites Remarks on validate
    pe.remarks = (remarks or "").strip() or None
    pe.custom_remarks = 1 if pe.remarks else 0
    pe.flags.from_order_flow = True
    pe.insert()
    if abs(flt(pe.difference_amount)) > 0.005:
        frappe.throw(_("The amounts do not balance (difference {0}).").format(flt(pe.difference_amount, 2)))
    pe.submit()
    return {"name": pe.name, "payment_type": pe.payment_type,
            "outstanding": flt(frappe.db.get_value(doctype, name, "outstanding_amount"))}
