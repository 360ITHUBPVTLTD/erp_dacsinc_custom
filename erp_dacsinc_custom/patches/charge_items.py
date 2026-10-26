"""Freight / packing / insurance as item lines (docs/charges.md).

Creates, for every company, once (later runs only fill what is missing):
- the income ledger "Freight Charges Recovered" (under Direct Income) for charges billed to customers;
- three non-stock charge items — Freight Charges (SAC 996511), Packing Charges (998540), Insurance
  Charges (997136) — in item group Service, bought and sold, excluded from overall discount, marked
  custom_charge_item (their Taxes table then lists every GST rate, so a line takes the goods' rate),
  posting to the existing expense ledgers on purchases and to Freight Charges Recovered on sales.
Every record created gets a dated comment. Existing items are not changed except for missing settings.
"""

import frappe
from frappe.utils import nowdate

CHARGES = (
	# item code, SAC, expense ledger (purchases), description
	("Freight Charges", "996511", "Transportation Expenses", "Freight / transport charged on the same invoice as the goods"),
	("Packing Charges", "998540", "Packing Charges", "Packing / packaging charged on the same invoice as the goods"),
	("Insurance Charges", "997136", "Insurance Charges", "Transit insurance charged on the same invoice as the goods"),
)
INCOME_LEDGER = "Freight Charges Recovered"


def _comment(doctype, name, text):
	frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": doctype,
					"reference_name": name, "content": f"{nowdate()}: {text}"}).insert(ignore_permissions=True)


def _income_ledger(company, abbr):
	name = f"{INCOME_LEDGER} - {abbr}"
	if frappe.db.exists("Account", name):
		return name
	parent = frappe.db.get_value("Account", {"company": company, "is_group": 1, "account_name": "Direct Income"}) \
		or frappe.db.get_value("Account", {"company": company, "is_group": 1, "root_type": "Income"})
	if not parent:
		return None
	acc = frappe.get_doc({"doctype": "Account", "account_name": INCOME_LEDGER, "company": company,
						  "parent_account": parent, "root_type": "Income", "report_type": "Profit and Loss",
						  "account_type": "Income Account", "is_group": 0}).insert(ignore_permissions=True)
	_comment("Account", acc.name, "created for freight / packing / insurance charged to customers (charges as item lines)")
	return acc.name


def execute():
	# the "Exclude from Overall Discount" field is otherwise only made in after_migrate (after patches)
	from erp_dacsinc_custom.overall_discount import create_fields
	create_fields()
	# only companies that keep these expense ledgers (not ERPNext's _Test companies)
	companies = [c for c in frappe.get_all("Company", fields=["name", "abbr", "cost_center"])
				 if any(frappe.db.exists("Account", f"{exp} - {c.abbr}") for _, _, exp, _ in CHARGES)]
	if not companies:
		return
	item_group = "Service" if frappe.db.exists("Item Group", "Service") else frappe.db.get_value("Item Group", {"is_group": 0}, "name")
	uom = "Nos" if frappe.db.exists("UOM", "Nos") else frappe.db.get_single_value("Stock Settings", "stock_uom")
	income = {c.name: _income_ledger(c.name, c.abbr) for c in companies}

	for code, sac, expense, desc in CHARGES:
		if not frappe.db.exists("GST HSN Code", sac):
			frappe.get_doc({"doctype": "GST HSN Code", "hsn_code": sac, "description": code}).insert(ignore_permissions=True)
		defaults = []
		for c in companies:
			exp = f"{expense} - {c.abbr}"
			defaults.append({"company": c.name, "default_warehouse": None,
							 "expense_account": exp if frappe.db.exists("Account", exp) else None,
							 "income_account": income.get(c.name),
							 "buying_cost_center": c.cost_center, "selling_cost_center": c.cost_center})
		if frappe.db.exists("Item", code):
			item = frappe.get_doc("Item", code)
			changed = []
			if not item.get("custom_charge_item"):
				item.custom_charge_item = 1
				changed.append("charge item")
			if not item.get("custom_exclude_from_overall_discount") and item.meta.has_field("custom_exclude_from_overall_discount"):
				item.custom_exclude_from_overall_discount = 1
				changed.append("excluded from overall discount")
			have = {d.company for d in item.item_defaults}
			for row in defaults:
				if row["company"] not in have:
					item.append("item_defaults", row)
					changed.append(f"defaults for {row['company']}")
			if changed:
				item.flags.ignore_permissions = True
				item.save()
				_comment("Item", code, "charges set-up: " + ", ".join(changed))
			continue
		item = frappe.get_doc({
			"doctype": "Item", "item_code": code, "item_name": code, "description": desc,
			"item_group": item_group, "stock_uom": uom, "is_stock_item": 0, "include_item_in_manufacturing": 0,
			"is_purchase_item": 1, "is_sales_item": 1, "gst_hsn_code": sac,
			"custom_charge_item": 1, "custom_tax_rate": "GST 5% - IND" if frappe.db.exists("Item Tax Template", "GST 5% - IND") else None,
			"item_defaults": defaults,
		})
		if item.meta.has_field("custom_exclude_from_overall_discount"):
			item.custom_exclude_from_overall_discount = 1
		item.flags.ignore_permissions = True
		item.insert()
		_comment("Item", code, "created: charge item for freight / packing / insurance billed with goods — takes the goods' GST rate (docs/charges.md)")
