import frappe


def execute():
	"""Share existing Sales Orders with their Lead Owner (read + write), once."""
	from erp_dacsinc_custom.so_share import backfill

	n = backfill()
	frappe.db.commit()
	print(f"Sales Orders shared with their lead owner: {n}")
