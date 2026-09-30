# Copyright (c) 2025, Pankaj and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class AdminSettings(Document):
	pass


def has_permission(doc, ptype=None, user=None, debug=False):
	"""Admin Settings is readable by many roles (server code reads it on their behalf),
	but its contents — recipients, users, role lists — are shown only to those who may
	edit it. Opening / reading / exporting it needs write access. Server code reads it
	with get_single_value / get_cached_doc, which don't check this, so nothing that
	depends on the settings stops working."""
	user = user or frappe.session.user
	if user == "Administrator" or ptype in ("write", "create", "submit", "cancel", "delete", "amend"):
		return None
	if not frappe.has_permission("Admin Settings", "write", user=user):
		return False
	return None


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def access_role_query(doctype, txt, searchfield, start, page_len, filters):
	"""Role picker in Admin Settings › Customer: the Access Sheet roles (Role ›
	custom_dacsinc_access_role) and Admin."""
	return frappe.db.sql("""
		SELECT name FROM `tabRole`
		WHERE (IFNULL(custom_dacsinc_access_role, 0) = 1 OR name = 'Admin')
		  AND disabled = 0 AND name LIKE %(txt)s
		ORDER BY name LIMIT %(start)s, %(page_len)s
	""", {"txt": f"%{txt}%", "start": int(start or 0), "page_len": int(page_len or 20)})
