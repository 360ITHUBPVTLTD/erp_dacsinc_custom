"""Customer's GSTIN / address given after the Sales Invoice was submitted (docs/invoice-gstin-update.md).

ERPNext doesn't let a submitted invoice's party address / GSTIN change, and cancelling a correct bill only to add the
GSTIN costs a cancelled number and a new one. When the customer's new GSTIN is of the invoice's own place of supply
(same state), the tax (CGST + SGST, same rate), the ledger and the totals stay exactly as they are — only the invoice's
GST details change (B2C → B2B in GSTR-1). This sets those, and nothing else, with a dated comment.

Refused when the change would need different taxes (another state → IGST; SEZ / overseas), when an e-Invoice or
e-Way Bill is already made (they carry the old details), on POS shift invoices and credit notes, or when the month's
GSTR-1 is already filed — those take a credit note and a new invoice.
"""

import frappe
from frappe import _
from frappe.contacts.doctype.address.address import get_address_display
from frappe.utils import cint, formatdate, getdate, nowdate

ROLES = {"Accounts Manager", "Admin"}
CATEGORIES = ("Registered Regular", "Registered Composition")


def can_update():
	return bool(ROLES & set(frappe.get_roles()))


def customer_gstin_addresses(customer):
	return frappe.get_all("Address", filters=[["Dynamic Link", "link_doctype", "=", "Customer"],
		["Dynamic Link", "link_name", "=", customer], ["gstin", "is", "set"], ["disabled", "=", 0]],
		fields=["`tabAddress`.name", "`tabAddress`.gstin", "`tabAddress`.gst_category", "`tabAddress`.address_line1", "`tabAddress`.city",
			"`tabAddress`.state", "`tabAddress`.pincode", "`tabAddress`.is_primary_address"],
		order_by="`tabAddress`.is_primary_address desc, `tabAddress`.modified desc", distinct=True)


def refusal(si, address=None):
	"""Why this invoice / address can't be updated (None when it can)."""
	if si.docstatus != 1:
		return _("Only a submitted invoice.")
	if cint(si.is_return) or cint(si.is_consolidated) or cint(si.is_pos):
		return _("Not for credit notes or POS invoices.")
	if si.irn or si.ewaybill:
		return _("An e-Invoice / e-Way Bill is already made with the old details: cancel it, or make a credit note and a new invoice.")
	frozen = frappe.db.get_single_value("Accounts Settings", "acc_frozen_upto")
	if frozen and getdate(si.posting_date) <= getdate(frozen):
		return _("Accounts are frozen up to {0}.").format(formatdate(frozen))
	period = getdate(si.posting_date).strftime("%m%Y")
	if frappe.db.exists("GST Return Log", {"return_type": "GSTR1", "return_period": period, "gstin": si.company_gstin, "filing_status": "Filed"}):
		return _("GSTR-1 for {0} is already filed: make a credit note and a new invoice (or amend it in the next GSTR-1).").format(period)
	if address is None:
		return None
	a = frappe.db.get_value("Address", address, ["gstin", "gst_category"], as_dict=True)
	if not a or address not in {x.name for x in customer_gstin_addresses(si.customer)}:
		return _("Address {0} is not a GST address of {1}.").format(address, si.customer)
	if a.gst_category not in CATEGORIES:
		return _("GST Category {0}: the taxes would change — make a credit note and a new invoice.").format(a.gst_category)
	if a.gstin == si.company_gstin:
		return _("That is our own GSTIN.")
	if a.gstin[:2] != (si.place_of_supply or "")[:2]:
		return _("GSTIN {0} is of another state than the place of supply {1}: the tax would change (IGST in place of CGST + SGST). "
			"Make a credit note and a new invoice.").format(a.gstin, si.place_of_supply)
	if a.gstin == si.billing_address_gstin and address == si.customer_address:
		return _("The invoice already has this GSTIN and address.")
	return None


@frappe.whitelist()
def get_gstin_update(invoice):
	"""For the form: the customer's GST addresses when the invoice may take one, else nothing."""
	if not can_update():
		return None
	si = frappe.get_doc("Sales Invoice", invoice)
	if refusal(si):
		return None
	options = [a for a in customer_gstin_addresses(si.customer) if not refusal(si, a.name)]
	return {"addresses": options, "current": {"gstin": si.billing_address_gstin, "gst_category": si.gst_category,
		"address": si.customer_address}} if options else None


@frappe.whitelist(methods=["POST"])
def update_customer_gstin(invoice, address):
	if not can_update():
		frappe.throw(_("Only Accounts Manager / Admin can update the customer's GSTIN on a submitted invoice."), frappe.PermissionError)
	si = frappe.get_doc("Sales Invoice", invoice)
	si.check_permission("write")
	if why := refusal(si, address):
		frappe.throw(why, title=_("Cannot update GSTIN"))

	a = frappe.get_doc("Address", address)
	old = {"customer_address": si.customer_address, "billing_address_gstin": si.billing_address_gstin, "gst_category": si.gst_category,
		"einvoice_status": si.einvoice_status, "e_waybill_status": si.e_waybill_status}
	new = {"customer_address": a.name, "address_display": get_address_display(a.as_dict()), "billing_address_gstin": a.gstin,
		"gst_category": a.gst_category}
	si.update(new)
	# what India Compliance would have set at submit with these details
	from india_compliance.gst_india.overrides.sales_invoice import is_e_waybill_applicable
	from india_compliance.gst_india.utils.e_invoice import validate_e_invoice_applicability
	gst = frappe.get_cached_doc("GST Settings")
	new["einvoice_status"] = "Pending" if gst.enable_e_invoice and validate_e_invoice_applicability(si, gst_settings=gst, throw=False) else "Not Applicable"
	new["e_waybill_status"] = "Pending" if is_e_waybill_applicable(si, gst) else "Not Applicable"
	si.db_set(new, notify=True)
	# the invoice's Version history, as ERPNext keeps for an update after submit
	frappe.get_doc({"doctype": "Version", "ref_doctype": "Sales Invoice", "docname": si.name, "data": frappe.as_json({
		"changed": [[f, old.get(f), new[f]] for f in ("customer_address", "billing_address_gstin", "gst_category", "einvoice_status", "e_waybill_status")
			if old.get(f) != new[f]], "added": [], "removed": [], "row_changed": []})}).insert(ignore_permissions=True)

	changes = [f"{label}: {old[f] or '—'} → {new[f]}" for f, label in (("billing_address_gstin", "GSTIN"), ("gst_category", "GST Category"),
		("customer_address", "Address"), ("einvoice_status", "e-Invoice"), ("e_waybill_status", "e-Way Bill")) if old[f] != new[f]]
	si.add_comment("Comment", f"{formatdate(nowdate())}: customer's GST details updated after submit by {frappe.session.user} "
		f"(the customer gave the GSTIN later; same state, so taxes, totals and ledger unchanged). " + "; ".join(changes))
	return {"changes": changes, "einvoice_status": new["einvoice_status"]}
