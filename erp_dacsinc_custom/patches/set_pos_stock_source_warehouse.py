"""One-time: Admin Settings › POS Stock Requests › Source Warehouse = VV Puram - IND
(where POS stores' Material Requests take stock from), unless already set."""

import frappe

from erp_dacsinc_custom.pos_scope import DEFAULT_SOURCE_WAREHOUSE


def execute():
	if not frappe.get_meta("Admin Settings").has_field("pos_stock_source_warehouse"):
		return
	if frappe.db.get_single_value("Admin Settings", "pos_stock_source_warehouse"):
		return
	if frappe.db.exists("Warehouse", DEFAULT_SOURCE_WAREHOUSE):
		frappe.db.set_single_value("Admin Settings", "pos_stock_source_warehouse", DEFAULT_SOURCE_WAREHOUSE)
