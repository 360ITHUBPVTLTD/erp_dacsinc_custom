"""Print format "Quotation print format 7Apr" (DB-only, used by download_quotation_pdf in custom_script.py):
print the body shared with Proforma Invoice Quotation (templates/print/quotation_body.html), titled QUOTATION
with the GSTIN line.

That body is the uniform layout of the app's formats (docs/print-formats.md): Liberation Sans, letter head 10mm
from the top with the gap above the title tightened, blank item rows down to the totals on a quotation that
surely fits one page, Tax% as the item's GST rate (it printed "GST 5% - IND%"), no 0.00 tax rows.
The layout itself now lives in the app file, so later changes need no patch.
"""

import json

import frappe

FORMAT = "Quotation print format 7Apr"
SOURCE = "proforma_invoice_quotation"

BLOCK = ('{#- body shared with "Proforma Invoice Quotation" (docs/print-formats.md) -#}\n'
	'{%- set dacs_title = "QUOTATION" -%}{%- set dacs_gstin = true -%}\n'
	'{% include "erp_dacsinc_custom/templates/print/quotation_body.html" %}')
# page header: "Quotation No / Date (continued)" from page 2 on
HEADING = '{%- set dacs_label = "Quotation" -%}{% include "erp_dacsinc_custom/templates/print/quotation_contd.html" %}'


def execute():
	if not frappe.db.exists("Print Format", FORMAT):
		return
	blocks = json.loads(frappe.db.get_value("Print Format", FORMAT, "format_data") or "[]")
	main = [b for b in blocks if b.get("fieldtype") == "HTML" and "QUOTATION" in (b.get("options") or "")]
	sections = [b for b in blocks if b.get("fieldtype") == "Section Break"]
	heading = blocks[0] if blocks and blocks[0].get("fieldname") == "print_heading_template" else None
	if len(main) != 1 or len(sections) != 1 or not heading:
		print(f"quotation_print_format_7apr_header: {FORMAT} differs from the expected layout - not changed")
		return
	if main[0]["options"] == BLOCK and heading.get("options") == HEADING:
		return
	main[0]["options"] = BLOCK
	heading["options"] = HEADING
	# the page box finds the item section by its label
	sections[0]["label"] = "Items"
	css = json.load(open(frappe.get_app_path("erp_dacsinc_custom", "erp_dacsinc_custom", "print_format", SOURCE, SOURCE + ".json")))["css"]
	frappe.db.set_value("Print Format", FORMAT, {"format_data": json.dumps(blocks), "css": css})
	frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Print Format", "reference_name": FORMAT,
		"content": "2026-10-27: now prints the layout shared with Proforma Invoice Quotation (app file "
			"templates/print/quotation_body.html): smaller gap above QUOTATION, blank item rows to the totals, "
			"Tax% shows the GST rate (5%) instead of the tax template name, Quotation No / Date with the letter "
			"head from page 2 on."}).insert(ignore_permissions=True)
	frappe.db.commit()
	print(f"quotation_print_format_7apr_header: {FORMAT} updated")
