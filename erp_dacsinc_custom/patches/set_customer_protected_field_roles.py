import frappe


def execute():
	"""Admin Settings › Customer: Admin may change POS Store / Industry / Merchandiser User to
	begin with (System Manager and Administrator always can). Only when nothing is set yet."""
	doc = frappe.get_single("Admin Settings")
	if doc.get("customer_protected_field_roles") or not frappe.db.exists("Role", "Admin"):
		return
	doc.append("customer_protected_field_roles", {"role": "Admin"})
	doc.flags.ignore_permissions = True
	doc.save()
	frappe.db.commit()
