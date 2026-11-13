"""A POS Invoice prints in the print format set on its own POS Profile (POS Profile › Print Format),
wherever it is printed from — not only on the POS screen. docs/pos-store-scope.md, "Printing".
Read by public/js/pos_print_format.js (the desk print view)."""
import frappe


@frappe.whitelist()
def get_pos_print_format(pos_invoice):
	"""The POS Profile print format of this POS Invoice, or "" when its profile has none (the print view
	then keeps Frappe's own default)."""
	if not frappe.has_permission("POS Invoice", "read", doc=pos_invoice):
		frappe.throw(frappe._("Not permitted"), frappe.PermissionError)
	profile = frappe.db.get_value("POS Invoice", pos_invoice, "pos_profile")
	print_format = profile and frappe.db.get_value("POS Profile", profile, "print_format")
	if not print_format or frappe.db.get_value("Print Format", print_format, "disabled"):
		return ""
	return print_format
