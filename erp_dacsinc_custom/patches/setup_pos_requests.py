import frappe


def execute():
	"""POS store requests (pos_request.py): fields, default approver roles, and Draft on the
	POS Store Manager requests still in draft."""
	from erp_dacsinc_custom.pos_request import backfill, ensure_fields

	ensure_fields()
	print("POS requests:", backfill())
