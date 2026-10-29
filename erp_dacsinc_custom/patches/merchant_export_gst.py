"""GST 0.1% for merchant exporters (merchant_export.py, docs/item-taxes.md):

1. Customer field "Merchant Exporter (0.1% GST)" — the only customers a 0.1% line is allowed for — and the tick
   "Merchant Export - GST 0.1%" on Quotation / Sales Order / Delivery Note / Sales Invoice (every line on 0.1%).
2. Item Tax Template "GST 0.1% - IND", made from "GST 5% - IND" (same accounts, rates × 0.02).
3. Every item with GST rows gets two rows for it (In-State, Out-State) after its others — never picked by
   itself; on a slab item with the full price range (as its Exempted rows). Items on Exempted / Nil-Rated /
   Non-GST get none.

The rows go in with one bulk insert and a dated comment per item (thousands of items: one save each would
take long); modified dates are kept. New items and later GST changes get the rows from
custom_script.update_tax_child. Safe to run again.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import now

from erp_dacsinc_custom.custom_script import SLAB_UPPER_LIMIT, TAX_VALID_FROM
from erp_dacsinc_custom.merchant_export import CUSTOMER_FIELD, DOC_FIELD, NO_GST, TEMPLATE, TICK_DOCTYPES, ensure_template

DAY = "2026-10-29"


def execute():
	create_custom_fields({"Customer": [{
		"fieldname": CUSTOMER_FIELD, "label": "Merchant Exporter (0.1% GST)", "fieldtype": "Check",
		"insert_after": "gst_category",
		"description": "Buys to export (Notifications 40/2017 and 41/2017): their sales lines may use GST 0.1% - IND. "
					   "Tick only after the accountant has confirmed it.",
	}], **{dt: [{
		"fieldname": DOC_FIELD, "label": "Merchant Export - GST 0.1%", "fieldtype": "Check", "insert_after": "tax_category",
		"print_hide": 1, "hidden": 1,
		"description": "Every line at GST 0.1% - IND (supply to a merchant exporter). Untick to put the lines back on "
					   "their normal GST. Shown only for a customer ticked Merchant Exporter.",
	}] for dt in TICK_DOCTYPES}}, update=True)

	ensure_template()

	rows = frappe.db.sql("""
		select parent,
			(select max(a.idx) from `tabItem Tax` a where a.parenttype = 'Item' and a.parent = t.parent) as last_idx,
			max(ifnull(maximum_net_rate, 0) > 0 or ifnull(minimum_net_rate, 0) > 0) as slab
		from `tabItem Tax` t
		where parenttype = 'Item' and ifnull(item_tax_template, '') not in %(no_gst)s and item_tax_template <> ''
			and parent not in (select parent from `tabItem Tax` where parenttype = 'Item' and item_tax_template = %(t)s)
		group by parent
	""", {"no_gst": NO_GST + (TEMPLATE,), "t": TEMPLATE}, as_dict=True)
	if rows:
		ts = now()
		values = []
		for r in rows:
			for i, category in enumerate(("In-State", "Out-State"), start=1):
				values.append((frappe.generate_hash(length=10), ts, ts, "Administrator", "Administrator",
					r.parent, "Item", "taxes", r.last_idx + i, TEMPLATE, category, TAX_VALID_FROM, 0,
					SLAB_UPPER_LIMIT if r.slab else 0))
		frappe.db.bulk_insert("Item Tax", ["name", "creation", "modified", "owner", "modified_by", "parent",
			"parenttype", "parentfield", "idx", "item_tax_template", "tax_category", "valid_from",
			"minimum_net_rate", "maximum_net_rate"], values, chunk_size=5000)
		text = (f"{DAY}: Taxes table - GST 0.1% - IND added (In-State, Out-State) after the other rows, for sales to a "
				"merchant exporter. It is never picked by itself; the line's normal GST stays the default.")
		frappe.db.bulk_insert("Comment", ["name", "creation", "modified", "owner", "modified_by", "comment_type",
			"reference_doctype", "reference_name", "content", "comment_email"],
			[(frappe.generate_hash(length=10), ts, ts, "Administrator", "Administrator", "Comment", "Item", r.parent,
				text, "Administrator") for r in rows], chunk_size=5000)
		frappe.db.commit()
		frappe.clear_document_cache("Item")
	print(f"merchant_export_gst: template {TEMPLATE}; 0.1% rows added on {len(rows)} item(s)")
