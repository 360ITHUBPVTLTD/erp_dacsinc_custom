"""Supplier / Customer clean-up (2026-10-02):
- Supplier › Address (custom_add): an unused custom field, removed;
- every Supplier's Default Price List = Standard Buying (new ones get it as the field's
  default, exported in custom/supplier.json);
- Customers / Suppliers with an address but no primary address get one (party_address.py)."""

import frappe


def execute():
	if frappe.db.exists("Custom Field", "Supplier-custom_add"):
		frappe.delete_doc("Custom Field", "Supplier-custom_add", ignore_permissions=True, force=True)
	if frappe.db.exists("Price List", "Standard Buying"):
		frappe.db.sql("update tabSupplier set default_price_list = 'Standard Buying'")
	from erp_dacsinc_custom import party_address
	print("primary addresses set:", party_address.backfill())
	frappe.clear_cache(doctype="Supplier")
