"""Read-only: documents whose GST tax rows have no GST tax type (igst / cgst / sgst) — their lines then carry
0% GST and the printed HSN breakup shows "(0.0%) ₹ 0.00" while the total tax is right
(docs/item-taxes.md › Tax Category).

    bench --site <site> execute erp_dacsinc_custom.gst_tag_check.run

Nothing is changed. A draft is put right by saving it again; a submitted document keeps its rows.
"""

import frappe

SALES = ("Quotation", "Sales Order", "Delivery Note", "Sales Invoice", "POS Invoice")
PURCHASE = ("Purchase Order", "Purchase Receipt", "Purchase Invoice")


def run(show=20):
	from india_compliance.gst_india.utils import get_gst_account_gst_tax_type_map

	gst_accounts = tuple(get_gst_account_gst_tax_type_map())
	if not gst_accounts:
		print("No GST accounts in GST Settings.")
		return
	total = 0
	for dt in SALES + PURCHASE:
		child = "Sales Taxes and Charges" if dt in SALES else "Purchase Taxes and Charges"
		rows = frappe.db.sql(f"""
			SELECT p.name, p.docstatus, p.modified
			FROM `tab{child}` t JOIN `tab{dt}` p ON p.name = t.parent AND t.parenttype = %(dt)s
			WHERE t.account_head IN %(acc)s AND IFNULL(t.gst_tax_type, '') = '' AND p.docstatus < 2
			GROUP BY p.name, p.docstatus, p.modified ORDER BY p.modified DESC
		""", {"dt": dt, "acc": gst_accounts}, as_dict=True)
		if not rows:
			continue
		total += len(rows)
		drafts = [r.name for r in rows if r.docstatus == 0]
		print(f"{dt}: {len(rows)} ({len(drafts)} draft, {len(rows) - len(drafts)} submitted)")
		for r in rows[:show]:
			print(f"   {r.name}  {'draft' if r.docstatus == 0 else 'submitted'}  {r.modified:%d-%m-%Y}")
	print("RESULT:", f"{total} documents with untagged GST rows" if total else "every GST tax row is tagged")
