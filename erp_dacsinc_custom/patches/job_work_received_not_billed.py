"""Job work (stitching) received but not billed — a liability clearing account (2026-10-23).

ERPNext's Subcontracting Receipt credits the service cost (moved into the finished goods' stock
value) to the service item's expense account (SubcontractingReceipt.set_service_expense_account),
and the jobber's Purchase Invoice for that service item debits the same account. With no account on
the service item both fell back to the company default, Cost of Goods Sold: between the goods
arriving and the jobber's bill, COGS was understated (profit overstated) and the amount owed to the
jobber showed nowhere. Same idea as "Stock Received But Not Billed" for goods:

    Subcontracting Receipt   Dr Stock In Hand (FG at RM + service)  Cr Stock In Hand (RM used)
                                                                    Cr Job Work Received But Not Billed (service)
    Jobber's Purchase Invoice  Dr Job Work Received But Not Billed  Dr Input GST   Cr Creditors

Per company that uses a service item on subcontracted Purchase Orders whose service item has no
expense account yet: the account is created under Stock Liabilities and set as its expense account (Item Default — written
directly: saving the Item would also rebuild its tax rows and item prices). Receipts made before
keep Cost of Goods Sold on their lines, and their bills (made from those receipts) debit the same,
so they still net to zero. Idempotent; a dated comment on the account and the item.
"""

import frappe

ACCOUNT_NAME = "Job Work Received But Not Billed"
NOTE = "2026-10-23: "


def execute():
	usage = frappe.db.sql("""SELECT DISTINCT po.company, poi.item_code FROM `tabPurchase Order Item` poi
		JOIN `tabPurchase Order` po ON po.name = poi.parent
		WHERE po.is_subcontracted = 1 AND po.docstatus = 1""", as_dict=1)
	for u in usage:
		if frappe.db.get_value("Item", u.item_code, "is_stock_item"):
			continue   # the finished good / a stock line — only the service item carries the cost
		current = frappe.db.get_value("Item Default", {"parent": u.item_code, "parenttype": "Item", "company": u.company}, "expense_account")
		if current:
			# already has its own account (on live: ERPNext's "Service Received But Not Billed") — the
			# same role; nothing to create or change
			print(f"job_work_received_not_billed: {u.item_code} ({u.company}) already uses {current} — left as it is")
			continue
		account = _ensure_account(u.company)
		if not account:
			continue
		_set_item_expense_account(u.item_code, u.company, account)


def _ensure_account(company):
	abbr = frappe.get_cached_value("Company", company, "abbr")
	name = f"{ACCOUNT_NAME} - {abbr}"
	if frappe.db.exists("Account", name):
		return name
	parent = frappe.db.get_value("Account", {"company": company, "is_group": 1, "root_type": "Liability",
											   "account_name": "Stock Liabilities"}, "name")
	if not parent:
		print(f"job_work_received_not_billed: {company} has no Stock Liabilities group — skipped")
		return None
	acc = frappe.get_doc({
		"doctype": "Account", "account_name": ACCOUNT_NAME, "parent_account": parent, "company": company,
		"is_group": 0, "root_type": "Liability", "report_type": "Balance Sheet",
	})
	acc.insert(ignore_permissions=True)
	_comment("Account", acc.name, NOTE + "created for job work (stitching) received on a Subcontracting Receipt and "
			 "not yet billed by the jobber — cleared by the jobber's Purchase Invoice (patches/job_work_received_not_billed.py).")
	return acc.name


def _set_item_expense_account(item_code, company, account):
	row = frappe.db.get_value("Item Default", {"parent": item_code, "parenttype": "Item", "company": company},
							  ["name", "expense_account"], as_dict=1)
	if row and row.expense_account == account:
		return
	if row and row.expense_account:
		# someone already chose an account for this service — leave it, say so
		print(f"job_work_received_not_billed: {item_code} ({company}) already uses {row.expense_account} — left as it is")
		return
	if row:
		frappe.db.set_value("Item Default", row.name, "expense_account", account, update_modified=False)
	else:
		item = frappe.get_doc("Item", item_code)
		d = item.append("item_defaults", {"company": company, "expense_account": account})
		d.db_insert()
	frappe.clear_document_cache("Item", item_code)
	_comment("Item", item_code, NOTE + f"Expense Account ({company}) set to {account}: the stitching cost on a "
			 "Subcontracting Receipt now waits there (a liability) until the jobber's bill, instead of reducing Cost of Goods Sold.")
	print(f"job_work_received_not_billed: {item_code} ({company}) → {account}")


def _comment(doctype, name, text):
	frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": doctype,
					"reference_name": name, "content": text}).insert(ignore_permissions=True)
