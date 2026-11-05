"""Invoice money hidden from users who cannot read invoices (e.g. Merchandiser User).

Such a user may see THAT an invoice exists (its number, date, Billed / To Bill, the stage),
never its amount, outstanding, due date or payment status (Paid / Unpaid / Overdue / Partly
Paid). See docs/merchandiser-purchase.md › "No invoice money".
"""
import frappe

# Sales / Purchase Invoice statuses that say how far it is paid — shown as "Submitted" instead.
PAYMENT_STATUSES = {
	"Paid", "Unpaid", "Overdue", "Partly Paid",
	"Unpaid and Discounted", "Partly Paid and Discounted", "Overdue and Discounted",
}


def neutral_invoice_status(status):
	return "Submitted" if status in PAYMENT_STATUSES else status


def hide_party_dashboard_money(doc, method=None):
	"""Customer / Supplier onload: ERPNext's form dashboard shows "Billing this year" and
	"Total Unpaid" from __onload.dashboard_info — emptied for a user who cannot read the
	party's invoices."""
	inv_dt = "Sales Invoice" if doc.doctype == "Customer" else "Purchase Invoice"
	if not frappe.has_permission(inv_dt, "read"):
		doc.set_onload("dashboard_info", [])
