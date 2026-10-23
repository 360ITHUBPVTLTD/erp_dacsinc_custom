"""Job work accounting: the jobber's bill clears exactly what the Subcontracting Receipt booked.

A Subcontracting Receipt moves the service cost (stitching) into the finished goods' stock value and
credits it to the line's Service Expense Account — the service item's expense account, "Job Work
Received But Not Billed" (patches/job_work_received_not_billed.py; Cost of Goods Sold on receipts
made before 2026-10-23). The service Purchase Receipt made from it (ERPNext's
subcontracting_receipt.make_purchase_receipt) copies its expense account from the Purchase Order
line instead, which on an older PO is Cost of Goods Sold — its bill would then debit COGS while the
receipt credited the liability, leaving the liability open and COGS doubled. So, before validate,
each line of a Purchase Receipt made from a Subcontracting Receipt takes the account that receipt
credited for the same PO line. The Purchase Invoice made from it copies the line's account, so the
bill clears the same account the goods were booked against.
"""

import frappe


def match_subcontracting_receipt_account(doc, method=None):
	if doc.doctype != "Purchase Receipt" or not doc.get("subcontracting_receipt") or doc.get("is_return"):
		return
	booked = {r.purchase_order_item: r.service_expense_account for r in frappe.get_all(
		"Subcontracting Receipt Item", filters={"parent": doc.subcontracting_receipt},
		fields=["purchase_order_item", "service_expense_account"]) if r.purchase_order_item and r.service_expense_account}
	for row in doc.get("items") or []:
		acc = booked.get(row.get("purchase_order_item"))
		if acc and row.expense_account != acc:
			row.expense_account = acc


def clear_service_line_warehouse(doc, method=None):
	"""A service (non-stock) line has no warehouse — ERPNext standard; nothing of it is stored.

	ERPNext fills the line's warehouse anyway (from the PO line / the item's default warehouse) and,
	on submit, lists every non-stock line that has one as "No accounting entries for the following
	warehouses: …" — on every job-work Purchase Receipt (Stitching Charges → VV Puram). Runs on
	validate, after ERPNext's own fill-in. Fixed-asset lines keep theirs (assets have a location)."""
	if doc.doctype != "Purchase Receipt":
		return
	codes = {r.item_code for r in doc.get("items") or [] if r.item_code and r.get("warehouse")}
	if not codes:
		return
	stock = set(frappe.get_all("Item", filters={"name": ["in", list(codes)], "is_stock_item": 1}, pluck="name"))
	for row in doc.get("items"):
		if row.get("warehouse") and row.item_code not in stock and not row.get("is_fixed_asset"):
			row.warehouse = None
			if row.meta.has_field("rejected_warehouse"):
				row.rejected_warehouse = None


def itc04_references(doc):
	"""India Compliance's own suggestion for a Subcontracting Receipt's "Original Document References"
	(the "Fetch Original Document Reference" button): the "Send to Subcontractor" Stock Entries of its
	Subcontracting Orders that carried its raw materials, and return receipts. Raw materials are read
	from the Subcontracting Orders (the receipt's own supplied items are filled later, in validate)."""
	from india_compliance.gst_india.overrides.subcontracting_transaction import get_relevant_references

	scos = sorted({r.subcontracting_order for r in doc.get("items") or [] if r.get("subcontracting_order")})
	if not scos or not doc.get("supplier"):
		return {}
	supplied = sorted({r.rm_item_code for r in doc.get("supplied_items") or [] if r.get("rm_item_code")} or set(
		frappe.get_all("Subcontracting Order Supplied Item", filters={"parent": ["in", scos]}, pluck="rm_item_code")))
	return get_relevant_references({
		"supplier": doc.supplier,
		"supplied_items": supplied or [""],
		"received_items": sorted({r.item_code for r in doc.items if r.item_code}) or [""],
		"subcontracting_orders": scos,
	}) or {}


def fill_itc04_references(doc, method=None):
	"""A Subcontracting Receipt names the challans (Send to Subcontractor Stock Entries) its goods went
	out on — GST ITC-04 links what came back to what was sent. India Compliance only warns ("Please
	Select Original Document Reference for ITC-04 Reporting") when the table is empty; receipts made by
	this app's flows never pressed its Fetch button. Filled here, before India Compliance's check."""
	if doc.doctype != "Subcontracting Receipt" or doc.get("is_return") or doc.get("doc_references"):
		return
	for doctype, names in itc04_references(doc).items():
		for name in names:
			doc.append("doc_references", {"link_doctype": doctype, "link_name": name})
