"""New Lead HTML field custom_quotation_so_html (user, 27-11-2026; docs/lead-quotation.md).

Shows the quotations of the whole lead family (the main lead and all its duplicates) with the
Sales Order(s) raised from each quotation, tagged Main / Duplicate. Rendered by public/js/lead.js
(family_quotation_so_html) from custom_lead.get_family_quotations_with_so. Placed right after the
existing single-lead Quotation block (custom_quotation_html). Idempotent — create_custom_fields
updates in place if the field already exists.
"""
import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
	if not frappe.db.exists("DocType", "Lead"):
		return
	create_custom_fields(
		{
			"Lead": [
				{
					"fieldname": "custom_quotation_so_html",
					"label": "Quotation & Sales Order (Lead + Duplicates)",
					"fieldtype": "HTML",
					"insert_after": "custom_quotation_html",
				}
			]
		},
		ignore_validate=True,
	)
