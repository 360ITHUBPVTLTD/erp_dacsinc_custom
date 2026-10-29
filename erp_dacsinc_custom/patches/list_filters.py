"""Filter boxes on the lists of the important doctypes, and better search when a customer / supplier is picked on a
document (docs/list-search.md). Property Setters only — no change to ERPNext's own files. Safe to run again.

The Customer / Supplier lists also get one "Search everything" box (public/js/party_list_search.js) for what a
filter box can't do: mobile / phone on a Contact or Address, city, pincode, email, group — one box for all."""

import frappe
from frappe.custom.doctype.property_setter.property_setter import make_property_setter

FILTERS = {
	"Customer": ["gstin", "mobile_no", "custom_merchant_exporter", "custom_merchandiser_user", "disabled"],
	"Supplier": ["gstin", "mobile_no", "disabled"],
	"Item": ["item_name", "gst_hsn_code", "custom_tax_rate", "is_stock_item", "disabled"],
	"Sales Order": ["status", "delivery_date", "customer_group"],
	"Quotation": ["status", "custom_lead_owner"],
	"Sales Invoice": ["posting_date", "due_date", "is_return", "customer_group"],
	"Delivery Note": ["posting_date", "lr_no", "transporter"],
	"Purchase Order": ["transaction_date", "schedule_date"],
	"Purchase Invoice": ["bill_no", "posting_date"],
	"Payment Entry": ["mode_of_payment", "reference_no", "posting_date"],
}
# what a Link field's dropdown searches besides the ID and the name
SEARCH_FIELDS = {
	"Customer": "customer_name,mobile_no,gstin,customer_group,territory",
	"Supplier": "supplier_name,mobile_no,gstin,supplier_group",
}


def execute():
	added = []
	for dt, fields in FILTERS.items():
		meta = frappe.get_meta(dt)
		for f in fields:
			df = meta.get_field(f)
			if not df or df.in_standard_filter:
				continue
			make_property_setter(dt, f, "in_standard_filter", 1, "Check", validate_fields_for_doctype=False)
			added.append(f"{dt}.{f}")
	for dt, value in SEARCH_FIELDS.items():
		meta = frappe.get_meta(dt)
		value = ",".join(f for f in value.split(",") if meta.get_field(f))
		if (meta.search_fields or "").replace(" ", "") != value:
			make_property_setter(dt, None, "search_fields", value, "Data", for_doctype=True, validate_fields_for_doctype=False)
			added.append(f"{dt} search: {value}")
	for dt in set(FILTERS) | set(SEARCH_FIELDS):
		frappe.clear_cache(doctype=dt)
	print("list_filters:", ", ".join(added) or "nothing to change")
