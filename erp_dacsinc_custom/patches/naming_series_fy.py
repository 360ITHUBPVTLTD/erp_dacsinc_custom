"""Document numbers PREFIX/26-27/00001 (naming.py, docs/naming-series.md).

- naming_series options for the doctypes whose options are not in this app's custom/*.json (those 9 carry the new
  series in their JSON): new series first, the old ones kept so existing documents stay valid.
- The POS Invoice Document Naming Rules (JP / RN / VA / VV + counter, no year) are disabled: a Document Naming Rule wins
  over the naming series, and naming.py now gives each store's bills JP/26-27/00001 … Their counters stay as they were.
"""

import frappe
from frappe.custom.doctype.property_setter.property_setter import make_property_setter

from erp_dacsinc_custom.naming import all_series

DOCTYPES = ["Request for Quotation", "Supplier Quotation", "Subcontracting Order", "Subcontracting Receipt", "Journal Entry",
	"Stock Reconciliation", "Payment Entry"]
DAY = "2026-10-29"


def execute():
	for dt in DOCTYPES:
		f = frappe.get_meta(dt).get_field("naming_series")
		if not f:
			continue
		new = all_series(dt)
		old = [o for o in (f.options or "").split("\n") if o and o not in new]
		make_property_setter(dt, "naming_series", "options", "\n".join(new + old), "Text", validate_fields_for_doctype=False)
		make_property_setter(dt, "naming_series", "default", new[0], "Text", validate_fields_for_doctype=False)
	for r in frappe.get_all("Document Naming Rule", {"document_type": "POS Invoice", "disabled": 0}, ["name", "prefix", "counter"]):
		frappe.db.set_value("Document Naming Rule", r.name, "disabled", 1)
		frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Document Naming Rule",
			"reference_name": r.name, "content": f"{DAY}: disabled - POS bills are now numbered {r.prefix}/26-27/00001 by the "
			f"naming series (financial year in the number, GST). Last number given here: {r.prefix}{r.counter:05d}."}).insert(ignore_permissions=True)
	frappe.clear_cache()
