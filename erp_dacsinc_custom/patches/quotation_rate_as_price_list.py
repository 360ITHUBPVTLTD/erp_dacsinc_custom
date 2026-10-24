"""Draft Quotation lines whose Rate was typed by hand: the Rate becomes the Price List Rate, with no
discount and no margin — the ERPNext way (docs/rate-read-only.md).

Why: before Rate was made read-only (live 2026-10-23), users typed the Rate instead of changing the
Price List Rate. ERPNext then shows the difference as a line discount (Rate below the Price List Rate)
or a margin (Rate above it), e.g. Price List 10, Rate 375 → margin 365. 2026-10-24 on live: 2,792
lines on 478 of 557 draft Quotations (2,560 margin, 232 discount) — list in bench
docs/files/quotation_discount_fix.xlsx.

The Rate, amounts, taxes and totals stay exactly as they are; only the Price List Rate, discount and
margin fields of those lines change (row update, no save — so drafts with a since-disabled item are
fixed too). Lines at Rate 0 (a 100% discount) are left for a person to decide. The header (additional)
discount is not touched. Each Quotation gets a dated comment. Submitted Quotations are not changed.
"""

import frappe
from frappe.utils import flt

DAY = "2026-10-24"
CLEAR = {"discount_percentage": 0, "discount_amount": 0, "margin_type": "", "margin_rate_or_amount": 0,
	"rate_with_margin": 0, "base_rate_with_margin": 0}


def execute():
	rows = frappe.db.sql("""select i.name, i.parent, i.idx, i.price_list_rate, i.rate, i.base_rate
		from `tabQuotation Item` i join `tabQuotation` q on q.name = i.parent
		where q.docstatus = 0 and i.rate <> 0
			and (ifnull(i.discount_percentage, 0) <> 0 or ifnull(i.discount_amount, 0) <> 0
				or ifnull(i.margin_rate_or_amount, 0) <> 0)
		order by i.parent, i.idx""", as_dict=True)
	by_doc = {}
	for r in rows:
		frappe.db.set_value("Quotation Item", r.name, {"price_list_rate": r.rate, "base_price_list_rate": r.base_rate, **CLEAR},
			update_modified=False)
		by_doc.setdefault(r.parent, []).append(r)
	for name, lines in by_doc.items():
		frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Quotation", "reference_name": name,
			"content": f"{DAY}: Rate had been typed by hand, so it showed as a discount / margin. Price List Rate set to the Rate, "
				"discount and margin 0 (Rate and totals unchanged): "
				+ "; ".join(f"line {r.idx} {flt(r.price_list_rate):g} → {flt(r.rate):g}" for r in lines)}).insert(ignore_permissions=True)
	frappe.db.commit()
	print(f"quotation_rate_as_price_list: {len(rows)} line(s) on {len(by_doc)} draft Quotation(s)")
