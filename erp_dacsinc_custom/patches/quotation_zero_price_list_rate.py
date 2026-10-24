"""Draft Quotation lines with a typed Rate but Price List Rate 0 (the item had no price): Price List
Rate set to the Rate, like quotation_rate_as_price_list did for the discount / margin lines.

Why: Rate is read-only now (docs/rate-read-only.md); a line at Price List Rate 0 can only be repriced
through the Price List Rate, and showed 0 next to the Rate. These lines carry no discount or margin,
so quotation_rate_as_price_list (already run) did not pick them. 2026-10-24 on live: 438 lines on 148
draft Quotations — list in bench docs/files/quotation_discount_fix.xlsx.

Rate, amounts, taxes and totals stay as they are (row update, no save). Each Quotation gets a dated
comment. Submitted Quotations are not changed.
"""

import frappe
from frappe.utils import flt

from erp_dacsinc_custom.patches.quotation_rate_as_price_list import CLEAR, DAY


def execute():
	rows = frappe.db.sql("""select i.name, i.parent, i.idx, i.rate, i.base_rate
		from `tabQuotation Item` i join `tabQuotation` q on q.name = i.parent
		where q.docstatus = 0 and i.rate <> 0 and ifnull(i.price_list_rate, 0) = 0
		order by i.parent, i.idx""", as_dict=True)
	by_doc = {}
	for r in rows:
		frappe.db.set_value("Quotation Item", r.name, {"price_list_rate": r.rate, "base_price_list_rate": r.base_rate, **CLEAR},
			update_modified=False)
		by_doc.setdefault(r.parent, []).append(r)
	for name, lines in by_doc.items():
		frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Quotation", "reference_name": name,
			"content": f"{DAY}: Price List Rate was 0 next to a typed Rate. Price List Rate set to the Rate (Rate and totals unchanged): "
				+ "; ".join(f"line {r.idx} 0 → {flt(r.rate):g}" for r in lines)}).insert(ignore_permissions=True)
	frappe.db.commit()
	print(f"quotation_zero_price_list_rate: {len(rows)} line(s) on {len(by_doc)} draft Quotation(s)")
