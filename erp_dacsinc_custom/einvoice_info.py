"""Sales Invoice › the e-Invoice / e-Way Bill box at the top of the form (public/js/sales_invoice.js,
docs/print-formats.md › e-Invoice and e-Way Bill). India Compliance keeps only the IRN, the e-way bill number and their
statuses on the invoice; the Ack No / Ack Date / signed QR are on its e-Invoice Log, the e-way bill's date and validity on
its e-Waybill Log. Read-only."""

import frappe


@frappe.whitelist()
def get_einvoice_ewaybill(sales_invoice):
	doc = frappe.get_doc("Sales Invoice", sales_invoice)
	doc.check_permission("read")
	out = {f: doc.get(f) for f in ("irn", "einvoice_status", "ewaybill", "e_waybill_status", "company_gstin", "billing_address_gstin",
		"place_of_supply", "mode_of_transport", "vehicle_no", "gst_vehicle_type", "distance", "gst_transporter_id", "transporter_name",
		"lr_no", "lr_date", "grand_total")}
	if out["irn"] and frappe.db.exists("e-Invoice Log", out["irn"]):
		log = frappe.db.get_value("e-Invoice Log", out["irn"], ["acknowledgement_number", "acknowledged_on", "signed_qr_code",
			"is_cancelled", "cancelled_on", "cancel_remark"], as_dict=True)
		out.update({"ack_no": log.acknowledgement_number, "ack_date": log.acknowledged_on, "irn_cancelled": log.is_cancelled,
			"irn_cancelled_on": log.cancelled_on, "irn_cancel_remark": log.cancel_remark})
		if log.signed_qr_code:
			from india_compliance.gst_india.utils.jinja import get_qr_code

			out["qr"] = get_qr_code(log.signed_qr_code, scale=2)
	if out["ewaybill"] and frappe.db.exists("e-Waybill Log", out["ewaybill"]):
		log = frappe.db.get_value("e-Waybill Log", out["ewaybill"], ["created_on", "valid_upto", "is_cancelled", "cancelled_on"],
			as_dict=True)
		out.update({"ewaybill_date": log.created_on, "ewaybill_valid_upto": log.valid_upto,
			"ewaybill_cancelled": log.is_cancelled, "ewaybill_cancelled_on": log.cancelled_on})
	return out
