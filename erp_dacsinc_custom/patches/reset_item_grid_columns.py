import json

import frappe

# Items tables whose columns (incl. Price List Rate and Discount %) are set by the app
# (custom/*_item.json property setters). A user's own column choice (the grid's ⚙) would
# hide the new columns, so those choices are cleared once; the rest of each user's
# settings (list filters, sort, other tables) stay.
ITEM_TABLES = ("Sales Order Item", "Quotation Item", "Sales Invoice Item", "Delivery Note Item",
			   "Purchase Order Item", "Purchase Receipt Item", "Purchase Invoice Item")


def execute():
	cleared = 0
	for r in frappe.db.sql("select `user`, doctype, data from `__UserSettings` where data like '%%GridView%%'", as_dict=True):
		try:
			data = json.loads(r.data or "{}")
		except ValueError:
			continue
		grid = data.get("GridView") or {}
		drop = [t for t in ITEM_TABLES if t in grid]
		if not drop:
			continue
		for t in drop:
			grid.pop(t)
		data["GridView"] = grid
		frappe.db.sql("update `__UserSettings` set data=%s where `user`=%s and doctype=%s", (json.dumps(data), r.user, r.doctype))
		cleared += len(drop)
	frappe.cache.delete_key("_user_settings")
	frappe.db.commit()
	print(f"Personal item-table column settings cleared: {cleared}")
