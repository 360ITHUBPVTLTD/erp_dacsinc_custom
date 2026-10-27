"""Print format "Quotation print format 7Apr" (DB-only, used by download_quotation_pdf in custom_script.py):
the uniform header block of the app's formats, and the GST rate in Tax%.

- Font: Liberation Sans under the name "Arial" from the app (docs/print-formats.md › Font); the letter head
  starts 10mm from the top of the paper; the letter head's gaps tightened (the space between its bottom
  line and "QUOTATION" was ~8mm).
- Tax% printed the Item Tax Template's name ("GST 5% - IND%"); now the item's GST rate ("5%").
- No blank last page (`.page-break:last-child`), editor-formatted terms keep their own height.
Checked on the 25 latest quotations: none prints more pages than before.
"""

import json

import frappe

FORMAT = "Quotation print format 7Apr"

FONT_BLOCK = """{#- dacs-font: one font on every server — Liberation Sans (Arial's letter widths) shipped in the app
    (public/fonts), so a print measures and looks the same on local and live (docs/print-formats.md › Font) -#}
{%- set dacs_base = frappe.utils.get_url() -%}
<style>
@font-face { font-family: 'Arial'; src: url('{{ dacs_base }}/assets/erp_dacsinc_custom/fonts/LiberationSans-Regular.ttf') format('truetype'); font-weight: normal; font-style: normal; }
@font-face { font-family: 'Arial'; src: url('{{ dacs_base }}/assets/erp_dacsinc_custom/fonts/LiberationSans-Bold.ttf') format('truetype'); font-weight: bold; font-style: normal; }
@font-face { font-family: 'Arial'; src: url('{{ dacs_base }}/assets/erp_dacsinc_custom/fonts/LiberationSans-Italic.ttf') format('truetype'); font-weight: normal; font-style: italic; }
@font-face { font-family: 'Arial'; src: url('{{ dacs_base }}/assets/erp_dacsinc_custom/fonts/LiberationSans-BoldItalic.ttf') format('truetype'); font-weight: bold; font-style: italic; }
body, body * { font-family: Arial !important; }
/* uniform top margin: the PDF page header (letter head, or the format's own company / store header) starts
   10mm from the top of the paper on every format (Frappe's header template pulls a letter head to the edge) */
body[onload] .wrapper > :first-child { margin-top: -7.5mm !important; }
</style>
"""

CSS = """.print-format > .page-break:last-child { page-break-after: auto; }
/* terms written in the editor carry its "height: 100%" and scroll bars - the text keeps its own height */
.print-format .ql-editor { height: auto !important; overflow: visible !important; padding: 0 !important; }
.print-format .ql-editor p { margin: 0 !important; }
/* letter head: tighter gaps (the Letter Head record is shared); the PDF page header's own 5mm bottom padding
   is the gap under the heading (docs/print-formats.md) */
.print-format .letter-head > div { margin-bottom: 1px !important; }
.print-format .letter-head > div > div[style*="border-bottom"] { margin-top: 2px !important; }
html body { padding-bottom: 1mm !important; }"""

TAX_OLD = '<td class="center">{{ item.item_tax_template or "0" }}%</td>'
TAX_NEW = """{%- set gr = (item.igst_rate or 0) + (item.cgst_rate or 0) + (item.sgst_rate or 0) -%}
{%- if not gr and item.item_tax_template %}{%- set gr = frappe.db.get_value("Item Tax Template", item.item_tax_template, "gst_rate") or 0 -%}{%- endif %}
<td class="center">{{ "{:g}".format(gr | float) }}%</td>"""
TITLE_OLD = '<div style="text-align:center; margin: 2px 0 5px 0; line-height: 1.2;">'
TITLE_NEW = '<div style="text-align:center; margin: 0 0 5px 0; line-height: 1.2;">'


def execute():
	if not frappe.db.exists("Print Format", FORMAT):
		return
	blocks = json.loads(frappe.db.get_value("Print Format", FORMAT, "format_data") or "[]")
	main = [b for b in blocks if b.get("fieldtype") == "HTML" and "QUOTATION" in (b.get("options") or "")]
	if len(main) != 1 or "dacs-font" in main[0]["options"]:
		return
	o = main[0]["options"]
	if o.count(TAX_OLD) != 1 or o.count(TITLE_OLD) != 1:
		# edited on the site since: leave it, report it
		print(f"quotation_print_format_7apr_header: {FORMAT} differs from the expected layout - not changed")
		return
	main[0]["options"] = FONT_BLOCK + o.replace(TAX_OLD, TAX_NEW).replace(TITLE_OLD, TITLE_NEW)
	frappe.db.set_value("Print Format", FORMAT, {"format_data": json.dumps(blocks), "css": CSS})
	frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Print Format", "reference_name": FORMAT,
		"content": "2026-10-27: uniform header (Liberation Sans font, letter head 10mm from the top, smaller gap above "
			"QUOTATION), Tax% shows the GST rate (5%) instead of the tax template name, no blank last page."}).insert(ignore_permissions=True)
	frappe.db.commit()
	print(f"quotation_print_format_7apr_header: {FORMAT} updated")
