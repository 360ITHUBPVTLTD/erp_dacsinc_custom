"""Suppliers' Tax Category set from their GSTIN / address / GST category (tax_category.py): Out-State for
SEZ / Overseas or another state than the company, else In-State. Only blank / In-State / Out-State values
are corrected (Reverse Charge / Composition stay). Each change leaves a dated comment on the supplier.
Why: new suppliers default to In-State, so an out-of-state supplier's PO / receipt / bill took "Input GST
In-state" and India Compliance refused it ("Cannot charge CGST/SGST for inter-state supplies").
"""

import frappe
from frappe.utils import cstr, nowdate

from erp_dacsinc_custom.tax_category import AUTO, supplier_tax_category


def execute():
	changed = []
	for s in frappe.get_all("Supplier", filters={"disabled": 0}, fields=["name", "tax_category", "gst_category"]):
		if cstr(s.tax_category) not in AUTO:
			continue
		want = supplier_tax_category(s.name, s.gst_category)
		if not want or want == cstr(s.tax_category):
			continue
		frappe.db.set_value("Supplier", s.name, "tax_category", want, update_modified=False)
		frappe.get_doc({
			"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Supplier", "reference_name": s.name,
			"content": f"{nowdate()}: Tax Category {s.tax_category or '(blank)'} → {want} — set from the supplier's GSTIN / address "
					   f"so its purchases take the right GST template (CGST + SGST in-state, IGST out-of-state).",
		}).insert(ignore_permissions=True)
		changed.append(f"{s.name} {s.tax_category or '(blank)'}→{want}")
	print(f"supplier_tax_category: {len(changed)} supplier(s) corrected", changed[:50])
