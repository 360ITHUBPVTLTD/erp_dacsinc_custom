import frappe


def execute():
	"""Once per site: every open Pick List claims only stock that is really on the shelf in
	VV Puram (stock_hold.correct_pick_lists). Preview first with
	    bench --site <site> execute erp_dacsinc_custom.stock_hold.correct_pick_lists --kwargs "{'dry_run': 1}"
	"""
	from erp_dacsinc_custom.stock_hold import correct_pick_lists

	frappe.set_user("Administrator")
	correct_pick_lists()
	frappe.db.commit()
