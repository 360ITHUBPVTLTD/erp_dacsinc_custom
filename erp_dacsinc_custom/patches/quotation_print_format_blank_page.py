"""Print format "Quotation print format 7Apr" (DB-only, used by download_quotation_pdf in custom_script.py):
drop the empty HTML block after the main Custom HTML.

Why: the empty block still renders as a row after the Terms / Signature table. On the live server the
PDF uses DejaVu Sans (no Arial there), which is wider, so a quotation that just fills page 1
(SAL-QTN-2026-00423, 4 lines) pushed that empty row onto a page 2 with only the letter head.
Reproduced locally with DejaVu Sans: 2 pages with the block, 1 without. Nothing visible is removed.
"""

import json

import frappe

FORMAT = "Quotation print format 7Apr"


def execute():
	if not frappe.db.exists("Print Format", FORMAT):
		return
	data = frappe.db.get_value("Print Format", FORMAT, "format_data")
	blocks = json.loads(data or "[]")
	kept = [b for b in blocks if not (b.get("fieldtype") == "HTML" and not (b.get("options") or "").strip())]
	if len(kept) == len(blocks):
		return
	frappe.db.set_value("Print Format", FORMAT, "format_data", json.dumps(kept))
	frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Print Format", "reference_name": FORMAT,
		"content": f"2026-10-24: removed {len(blocks) - len(kept)} empty HTML block(s) at the end of the layout - it pushed an "
			"almost-full quotation onto a blank second page (only the letter head)."}).insert(ignore_permissions=True)
	frappe.db.commit()
	print(f"quotation_print_format_blank_page: {len(blocks) - len(kept)} empty block(s) removed")
