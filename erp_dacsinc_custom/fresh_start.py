"""Fresh start of the company's transactions (agreed with the user 2026-10-27).

Deletes every selling / buying / stock / POS / accounting transaction and its ledgers; keeps masters
(Item, Customer, Supplier, Account, BOM, Warehouse, …), CRM (Lead, Opportunity, Quotation, Event
Activity, Business Contacts, …), HR (Attendance, Checkins, Leave, Expense Claim with its own ledger
rows) and logs. Document numbering of the deleted doctypes starts again from 1.

Same method as ERPNext's "Delete Company Transactions" (Transaction Deletion Record): direct deletes, no
document events. That is the point: deleting a Sales Order through the ORM runs sales_order_on_trash →
sync_lead_data, which resets the Lead's PO Value / category / type. ERPNext's own tool cannot be used,
it also deletes Lead, Opportunity, Quotation and Attendance (every doctype with a Company field).

Run on the server, never from the browser (no web timeout, no hooks):
    bench --site <site> execute erp_dacsinc_custom.fresh_start.run --kwargs "{'confirm': '<site>', 'dry_run': 1}"
dry_run=1 does everything, prints the checks and rolls back; dry_run=0 commits. Take a full backup first.
"""

import hashlib
import json
import re

import frappe

COMPANY = "Dac's Inc"

# deleted with their child tables, versions, comments, communications, shares, todos, notifications
TRANSACTIONS = [
	# POS
	"POS Invoice Merge Log", "POS Closing Entry", "POS Invoice", "POS Opening Entry",
	# selling
	"Pick List", "Packing Slip", "Installation Note", "Delivery Trip", "Shipment", "Delivery Note",
	"Sales Invoice", "Dunning", "Payment Request", "Sales Order", "Embroidery Work Order", "Bulk Payment",
	# buying / subcontracting
	"Landed Cost Voucher", "Purchase Invoice", "Subcontracting Receipt", "Purchase Receipt",
	"Subcontracting Order", "Purchase Order", "Supplier Quotation", "Request for Quotation", "Material Request",
	# manufacturing
	"Job Card", "Work Order", "Production Plan",
	# stock
	"Quality Inspection", "Stock Entry", "Stock Reconciliation", "Stock Reservation Entry",
	"Serial and Batch Bundle", "Repost Item Valuation",
	# accounts
	"Payment Entry", "Journal Entry", "Period Closing Voucher", "Process Deferred Accounting",
	"Process Payment Reconciliation", "Unreconcile Payment", "Repost Payment Ledger", "Repost Accounting Ledger",
	"Invoice Discounting", "Exchange Rate Revaluation", "Bank Transaction", "Account Closing Balance",
]
# ledgers: every row except those of the documents kept (Expense Claim)
LEDGERS = ["GL Entry", "Payment Ledger Entry", "Stock Ledger Entry"]
KEEP_VOUCHERS = ("Expense Claim",)
# linked rows of a deleted document (reference doctype field, reference name field)
TRAILS = [("Version", "ref_doctype", "docname"), ("Comment", "reference_doctype", "reference_name"),
	("ToDo", "reference_type", "reference_name"), ("Notification Log", "document_type", "document_name"),
	("DocShare", "share_doctype", "share_name"), ("Energy Point Log", "reference_doctype", "reference_name")]
# must come out identical
KEPT = ["Lead", "Opportunity", "Quotation", "Customer", "Supplier", "Item", "Item Price", "Contact", "Address",
	"BOM", "Account", "Warehouse", "Employee", "Attendance", "Employee Checkin", "Expense Claim", "Asset",
	"Event Activity", "Business Contacts"]


def run(confirm=None, dry_run=1):
	if confirm != frappe.local.site:
		frappe.throw(f"Pass confirm='{frappe.local.site}' to run on this site")
	dry_run = int(dry_run)
	real_commit = frappe.db.commit
	frappe.db.commit = lambda *a, **k: None  # one transaction; nothing called below may commit half of it
	report = {"site": frappe.local.site, "dry_run": dry_run, "deleted": {}, "series_reset": []}
	try:
		before = _fingerprint()
		report["irn_on_sales_invoices"] = frappe.db.count("Sales Invoice", {"irn": ["is", "set"]}) \
			if frappe.get_meta("Sales Invoice").has_field("irn") else 0
		prefixes = {}
		for dt in TRANSACTIONS:
			if not frappe.db.table_exists(dt):
				continue
			names = frappe.get_all(dt, pluck="name", limit_page_length=0)
			if not names:
				continue
			prefixes[dt] = {_prefix(n) for n in names} - {None}
			report["deleted"][dt] = _delete(dt, names)
		for dt in LEDGERS:
			cond = {"voucher_type": ["not in", KEEP_VOUCHERS]}
			report["deleted"][dt] = frappe.db.count(dt, cond)
			frappe.db.delete(dt, cond)
		warehouses = frappe.get_all("Warehouse", {"company": COMPANY}, pluck="name")
		report["deleted"]["Bin"] = frappe.db.count("Bin", {"warehouse": ["in", warehouses]})
		frappe.db.delete("Bin", {"warehouse": ["in", warehouses]})
		report["series_reset"] = _reset_series(prefixes)
		# POS bills are numbered by Document Naming Rules (JP / RN / VA / VV + store warehouse), not by Series
		for rule in frappe.get_all("Document Naming Rule", {"document_type": ["in", list(prefixes)], "counter": [">", 0]},
				["name", "document_type", "prefix", "counter"]):
			if not frappe.db.count(rule.document_type):
				frappe.db.set_value("Document Naming Rule", rule.name, "counter", 0, update_modified=False)
				report["series_reset"].append([rule.document_type, f"naming rule {rule.prefix}", rule.counter])
		# an Asset keeps its depreciation schedule; its booked rows pointed at deleted Journal Entries
		if frappe.db.table_exists("Depreciation Schedule"):
			frappe.db.sql("""update `tabDepreciation Schedule` set journal_entry=null where ifnull(journal_entry, '') != ''""")
		after = _fingerprint()
		report["kept_unchanged"] = {k: before[k] == after[k] for k in before}
		report["left"] = {dt: frappe.db.count(dt) for dt in TRANSACTIONS if frappe.db.table_exists(dt) and frappe.db.count(dt)}
		report["left_ledgers"] = {dt: frappe.db.count(dt) for dt in LEDGERS}
		report["dangling_links"] = _dangling_links()
		if not all(report["kept_unchanged"].values()):
			raise Exception(f"a kept doctype changed: {report['kept_unchanged']}")
	except Exception:
		frappe.db.rollback()
		frappe.db.commit = real_commit
		raise
	if dry_run:
		frappe.db.rollback()
	else:
		real_commit()
	frappe.db.commit = real_commit
	if not dry_run:
		frappe.clear_cache()
	print(json.dumps(report, indent=1, default=str))
	return report


def _delete(dt, names):
	meta = frappe.get_meta(dt)
	for df in meta.get_table_fields():
		# every row of this parent type: earlier out-of-band deletes left orphan child rows
		frappe.db.delete(df.options, {"parenttype": dt})
	for chunk in _chunks(names):
		for trail, dt_field, name_field in TRAILS:
			if frappe.db.table_exists(trail):
				frappe.db.delete(trail, {dt_field: dt, name_field: ["in", chunk]})
		comms = frappe.get_all("Communication", {"reference_doctype": dt, "reference_name": ["in", chunk]}, pluck="name")
		if comms:
			frappe.db.delete("Communication Link", {"parent": ["in", comms]})
			frappe.db.delete("Communication", {"name": ["in", comms]})
		frappe.db.sql("""update `tabFile` set attached_to_doctype=null, attached_to_name=null, attached_to_field=null
			where attached_to_doctype=%s and attached_to_name in %s""", (dt, chunk))
		frappe.db.delete(dt, {"name": ["in", chunk]})
	return len(names)


def _prefix(name):
	"""SAL-ORD-2026-00012(-1) -> SAL-ORD-2026-; hash names -> None"""
	m = re.match(r"^(.*\D)(\d{4,})(-\d{1,2})?$", name)
	return m.group(1) if m else None


def _reset_series(prefixes):
	reset = []
	for dt, pfx in prefixes.items():
		for p in sorted(pfx):
			row = frappe.db.sql("select current from `tabSeries` where name=%s", p)
			if not row:
				continue
			current = row[0][0]
			left = frappe.db.sql(f"select count(*) from `tab{dt}` where name like %s", (p + "%",))[0][0]
			if left:
				continue
			frappe.db.sql("update `tabSeries` set current=0 where name=%s", p)
			reset.append([dt, p, current])
	return reset


def _fingerprint():
	"""row count + checksum of every kept doctype (Lead / Quotation fields the SO hooks touch included)"""
	out = {}
	for dt in KEPT:
		if not frappe.db.table_exists(dt):
			continue
		rows = frappe.db.sql(f"select * from `tab{dt}` order by name", as_list=True)
		out[dt] = (len(rows), hashlib.md5(json.dumps(rows, default=str).encode()).hexdigest())
	return out


def _dangling_links():
	"""links from rows that still exist to a deleted transaction"""
	gone = set(TRANSACTIONS)
	found = {}
	for f in frappe.db.sql("""select parent, fieldname from `tabDocField` where fieldtype='Link' and options in %s
		union select dt, fieldname from `tabCustom Field` where fieldtype='Link' and options in %s""", (list(gone), list(gone)), as_dict=True):
		if f.parent in gone or not frappe.db.table_exists(f.parent):
			continue
		try:
			n = frappe.db.sql(f"select count(*) from `tab{f.parent}` where ifnull(`{f.fieldname}`, '') != ''")[0][0]
		except Exception:
			continue
		if n:
			found[f"{f.parent}.{f.fieldname}"] = n
	return found


def _chunks(seq, size=500):
	for i in range(0, len(seq), size):
		yield seq[i:i + size]


# ── Opening stock from the client's closing stock summaries ──────────────────────────────────────────

def load_opening_stock(confirm=None, data_file=None, dry_run=1):
	"""After run(): Item Valuation Rate = Cl Rate, then one Opening Stock reconciliation per store, dated today.

	data_file: a File URL on the site (e.g. /private/files/opening_stock_2026_10.json) or a path, built by bench
	.scratch/stock-reload-2026-10/build.py: {"stores": {warehouse: [{item_code, qty, rate, row, store, file}]},
	"item_rates": {item_code: {rate, store, row, file}}}. Every changed / created record gets a dated comment.
	    bench --site <site> execute erp_dacsinc_custom.fresh_start.load_opening_stock \\
	        --kwargs "{'confirm': '<site>', 'data_file': '/private/files/opening_stock_2026_10.json', 'dry_run': 1}"
	"""
	import os

	from frappe.utils import flt, now_datetime, nowdate

	if confirm != frappe.local.site:
		frappe.throw(f"Pass confirm='{frappe.local.site}' to run on this site")
	dry_run = int(dry_run)
	if data_file and os.path.exists(data_file):
		data = json.load(open(data_file))
	else:
		data = json.loads(frappe.get_doc("File", {"file_url": data_file}).get_content())
	stamp = now_datetime().strftime("%d-%m-%Y %H:%M")
	report = {"site": frappe.local.site, "dry_run": dry_run, "posting_date": nowdate(), "item_rates_set": 0, "stores": {}}
	real_commit = frappe.db.commit
	frappe.db.commit = lambda *a, **k: None
	try:
		# 1. Item Valuation Rate (direct update: saving an Item re-syncs its prices and barcodes)
		comments = []
		for code, r in data["item_rates"].items():
			old = frappe.db.get_value("Item", code, "valuation_rate")
			if old is None or flt(old) == flt(r["rate"]):
				continue
			frappe.db.set_value("Item", code, "valuation_rate", flt(r["rate"]), update_modified=False)
			comments.append(("Item", code, f"{stamp}: Valuation Rate {flt(old):g} → {flt(r['rate']):g} as per the client's closing "
				f"stock summary ({r['file']}, row {r['row']}, Cl Rate)."))
		report["item_rates_set"] = len(comments)

		# 2. one Opening Stock reconciliation per store
		cost_center = frappe.get_cached_value("Company", COMPANY, "cost_center")
		for warehouse, rows in data["stores"].items():
			ok = [r for r in rows if frappe.db.get_value("Item", r["item_code"], "disabled") == 0]
			skipped = [r["item_code"] for r in rows if r not in ok]
			doc = frappe.get_doc({
				"doctype": "Stock Reconciliation", "company": COMPANY, "purpose": "Opening Stock",
				"posting_date": nowdate(), "expense_account": "Temporary Opening - IND", "cost_center": cost_center,
				"items": [{"item_code": r["item_code"], "warehouse": warehouse, "qty": flt(r["qty"]),
					"valuation_rate": flt(r["rate"]), "allow_zero_valuation_rate": 0 if flt(r["rate"]) else 1} for r in ok],
			})
			doc.insert(ignore_permissions=True)
			doc._submit()  # in-process; .submit() would queue it for > 100 rows
			qty = sum(flt(r["qty"]) for r in ok)
			value = sum(flt(r["qty"]) * flt(r["rate"]) for r in ok)
			comments.append(("Stock Reconciliation", doc.name, f"{stamp}: Opening stock of {ok[0]['store']} ({warehouse}) as per the "
				f"client's closing stock summary {ok[0]['file']}: {len(ok)} items, qty {qty:g}, value {value:,.2f} (Stock = qty, "
				f"Cl Rate = valuation rate; {sum(1 for r in ok if not flt(r['rate']))} rows without a Cl Rate at 0). Rows whose item "
				"is not in ERP are not loaded: docs/files/opening_stock_items_not_in_erp.xlsx."))
			in_wh = frappe.db.sql("""select ifnull(sum(actual_qty), 0), ifnull(sum(stock_value_difference), 0)
				from `tabStock Ledger Entry` where warehouse=%s and is_cancelled=0""", warehouse)[0]
			report["stores"][warehouse] = {"reconciliation": doc.name, "items": len(ok), "qty_file": qty, "qty_erp": flt(in_wh[0]),
				"value_file": round(value, 2), "value_erp": round(flt(in_wh[1]), 2), "skipped_disabled": skipped}

		ts = now_datetime()
		frappe.db.bulk_insert("Comment", ["name", "creation", "modified", "owner", "modified_by", "comment_type",
			"reference_doctype", "reference_name", "content", "comment_email"],
			[(frappe.generate_hash(length=10), ts, ts, "Administrator", "Administrator", "Comment", dt, name, text, "Administrator")
				for dt, name, text in comments], chunk_size=5000)
	except Exception:
		frappe.db.rollback()
		frappe.db.commit = real_commit
		raise
	if dry_run:
		frappe.db.rollback()
	else:
		real_commit()
		frappe.clear_document_cache("Item")
	frappe.db.commit = real_commit
	print(json.dumps(report, indent=1, default=str))
	return report
