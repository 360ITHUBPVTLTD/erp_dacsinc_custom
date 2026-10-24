"""Every item's Taxes row gets Valid From 2023-01-01 (custom_script.TAX_VALID_FROM), then the sales
drafts left without a GST template because of the missing date are saved again so their lines pick it.

Why: ERPNext reads a row with a price range but no Valid From as valid from TODAY, so a Quotation /
Order / Invoice dated before today got no Item Tax Template on its lines (the dropdown stayed empty
too) and the line was taxed at the header template's rate — docs/item-taxes.md. 2026-10-24 on live:
104,103 rows on 18,879 items without the date; 10 draft Quotations and 1 draft Sales Invoice with
such lines. Submitted documents are not touched (a change there needs cancel + amend).

One SQL update for the rows and a bulk insert of the dated comments (one per changed item), so it
takes seconds rather than one save per item; modified dates are kept. Safe to run again.
"""

import frappe
from frappe.utils import now

from erp_dacsinc_custom.custom_script import TAX_VALID_FROM
from erp_dacsinc_custom.tax_category import SALES

DAY = "2026-10-24"


def execute():
	items = frappe.db.sql_list("""select distinct parent from `tabItem Tax`
		where parenttype='Item' and (valid_from is null or valid_from <> %s)""", TAX_VALID_FROM)
	if items:
		frappe.db.sql("""update `tabItem Tax` set valid_from=%s
			where parenttype='Item' and (valid_from is null or valid_from <> %s)""", (TAX_VALID_FROM, TAX_VALID_FROM))
		text = (f"{DAY}: Taxes table - Valid From set to {frappe.utils.formatdate(TAX_VALID_FROM, 'dd-MM-yyyy')} on every row, "
			"so Quotations / Orders / Invoices dated before today pick the GST template.")
		ts = now()
		frappe.db.bulk_insert("Comment", ["name", "creation", "modified", "owner", "modified_by", "comment_type",
			"reference_doctype", "reference_name", "content", "comment_email"],
			[(frappe.generate_hash(length=10), ts, ts, "Administrator", "Administrator", "Comment", "Item", n, text,
				"Administrator") for n in items], chunk_size=5000)
		frappe.db.commit()
		frappe.clear_document_cache("Item")
	print(f"item_tax_valid_from: Valid From set on {len(items)} item(s)")

	fixed, failed = [], []
	for dt in SALES:
		for name in _drafts_with_untaxed_lines(dt):
			doc = frappe.get_doc(dt, name)
			before = _untaxed_lines(doc)
			if not before:
				continue
			frappe.db.savepoint("item_tax_valid_from")
			try:
				frappe.flags.mute_messages = True
				doc.flags.ignore_permissions = True
				doc.save()
			except Exception as e:
				frappe.db.rollback(save_point="item_tax_valid_from")
				failed.append(f"{dt} {name}: {e}")
				continue
			finally:
				frappe.flags.mute_messages = False
			after = _untaxed_lines(doc)
			if after == before:
				frappe.db.rollback(save_point="item_tax_valid_from")
				failed.append(f"{dt} {name}: no template fits line(s) {after}")
				continue
			before = [i for i in before if i not in after]
			doc.add_comment("Comment", f"{DAY}: GST template filled on line(s) {', '.join(map(str, before))} "
				f"(was empty: the items' tax rows had no Valid From). Totals recalculated."
				+ (f" Still empty: line(s) {', '.join(map(str, after))}." if after else ""))
			frappe.db.commit()
			fixed.append(f"{dt} {name}")
	print(f"item_tax_valid_from: drafts saved again: {len(fixed)} {fixed}")
	if failed:
		print("item_tax_valid_from: NOT saved (fix by hand):", failed)


def _drafts_with_untaxed_lines(dt):
	return frappe.db.sql_list(f"""select distinct d.name from `tab{dt}` d
		join `tab{dt} Item` i on i.parent = d.name
		join `tabItem` it on it.name = i.item_code
		where d.docstatus = 0 and ifnull(i.item_tax_template, '') = ''
			and ifnull(it.custom_tax_rate, '') not in ('', 'Non-GST - IND')
			and exists (select 1 from `tabItem Tax` t where t.parenttype = 'Item' and t.parent = it.name)""")


def _untaxed_lines(doc):
	return [r.idx for r in doc.items if r.item_code and not r.item_tax_template
		and frappe.db.exists("Item Tax", {"parenttype": "Item", "parent": r.item_code})]
