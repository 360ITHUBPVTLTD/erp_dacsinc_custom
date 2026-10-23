"""Customers' Tax Category set from their billing address / GST category (tax_category.py):
Out-State for SEZ / Overseas or another state than the company, else In-State. Only blank /
In-State / Out-State values are corrected (Reverse Charge / Composition stay). Each change leaves a
dated comment on the customer. 2026-10-23 on the local copy: 25 customers (BIOCON SEZ blank, 21 in
another state and 3 abroad marked In-State) — list in bench docs/files/customer_tax_category_fix.xlsx.
"""

import frappe
from frappe.utils import cstr

from erp_dacsinc_custom.tax_category import AUTO, customer_tax_category


def execute():
	changed = 0
	for c in frappe.get_all("Customer", filters={"disabled": 0}, fields=["name", "tax_category", "gst_category"]):
		if cstr(c.tax_category) not in AUTO:
			continue
		want = customer_tax_category(c.name, c.gst_category)
		if not want or want == cstr(c.tax_category):
			continue
		frappe.db.set_value("Customer", c.name, "tax_category", want, update_modified=False)
		frappe.get_doc({
			"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Customer", "reference_name": c.name,
			"content": f"2026-10-23: Tax Category {c.tax_category or '(blank)'} → {want} — set from the billing address / GST category "
					   f"so the item's In-State / Out-State GST rows (5% / 18%) apply on its documents.",
		}).insert(ignore_permissions=True)
		changed += 1
	print(f"customer_tax_category: {changed} customer(s) corrected")
