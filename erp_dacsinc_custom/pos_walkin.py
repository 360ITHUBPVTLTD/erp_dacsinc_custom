"""Walk-in details on POS Invoices.

Stores bill on one fixed customer; who actually bought is kept on the invoice itself
— POS Invoice › Walk-in Name (`custom_walkin_name`) and Walk-in Mobile
(`custom_walkin_mobile`) — so a bill can be found later (e.g. for a return) without
creating a customer. Entered on the Point of Sale screen under the customer
(`public/js/pos_page_extend.js`), searchable in Recent Orders (get_past_order_list
below) and in the POS Invoice list (standard filters, search fields, global search).
"""

import frappe

WALKIN_FIELDS = ("custom_walkin_name", "custom_walkin_mobile")


def ensure_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
	from frappe.custom.doctype.property_setter.property_setter import make_property_setter

	create_custom_fields({"POS Invoice": [
		{"fieldname": "custom_walkin_name", "fieldtype": "Data", "label": "Walk-in Name",
		 "insert_after": "customer_name", "in_standard_filter": 1, "in_global_search": 1, "allow_on_submit": 0,
		 "description": "Name of the person who bought, when the bill is on the store's fixed customer."},
		{"fieldname": "custom_walkin_mobile", "fieldtype": "Data", "options": "Phone", "label": "Walk-in Mobile",
		 "insert_after": "custom_walkin_name", "in_standard_filter": 1, "in_global_search": 1, "in_list_view": 1,
		 "description": "Their mobile number — search by it to find the bill later (e.g. for a return)."},
	]}, update=True)

	current = frappe.get_meta("POS Invoice").search_fields or ""
	fields = [f.strip() for f in current.split(",") if f.strip()]
	for f in WALKIN_FIELDS:
		if f not in fields:
			fields.append(f)
	make_property_setter("POS Invoice", None, "search_fields", ", ".join(fields), "Data", for_doctype=True)


@frappe.whitelist()
def get_past_order_list(search_term, status, limit=20):
	"""Recent Orders on the Point of Sale screen (overrides ERPNext's): also finds a bill
	by the walk-in's name or mobile, and shows the walk-in's name on walk-in bills."""
	fields = ["name", "grand_total", "currency", "customer", "customer_name", "posting_time", "posting_date",
			  *WALKIN_FIELDS]
	if not status:
		return []
	if search_term:
		like = f"%{search_term}%"
		invoices = frappe.db.get_list(
			"POS Invoice", filters={"status": status},
			or_filters={"customer_name": ["like", like], "customer": ["like", like], "name": ["like", like],
						"custom_walkin_name": ["like", like], "custom_walkin_mobile": ["like", like]},
			fields=fields, page_length=limit, order_by="posting_date desc, posting_time desc")
	else:
		invoices = frappe.db.get_list("POS Invoice", filters={"status": status}, fields=fields, page_length=limit,
									  order_by="posting_date desc, posting_time desc")
	for inv in invoices:
		if inv.get("custom_walkin_name") or inv.get("custom_walkin_mobile"):
			inv["customer_name"] = " · ".join(x for x in (inv.get("custom_walkin_name"), inv.get("custom_walkin_mobile")) if x)
	return invoices
