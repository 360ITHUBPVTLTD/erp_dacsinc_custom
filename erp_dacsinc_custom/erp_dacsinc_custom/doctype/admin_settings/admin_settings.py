# Copyright (c) 2025, Pankaj and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class AdminSettings(Document):
	pass


# Opening the form on the desk (frappe.desk.form.load.getdoc) shows every recipient, user
# and role list; that stays with those who may edit it.
DESK_FORM_METHODS = ("frappe.desk.form.load.getdoc", "frappe.desk.form.load.getdoctype",
					 "frappe.utils.print_format.download_pdf", "frappe.utils.print_format.download_multi_pdf",
					 "frappe.www.printview.get_html_and_style")


def has_permission(doc, ptype=None, user=None, debug=False):
	"""Admin Settings: roles with Read may read it through the API (the mobile app reads its
	settings as the signed-in user, e.g. DAC CRM), but only those who may edit it open the
	desk form or print / email / export / share it. Server code reads it with
	get_single_value / get_cached_doc, which don't check this."""
	user = user or frappe.session.user
	if user == "Administrator" or ptype in ("write", "create", "submit", "cancel", "delete", "amend"):
		return None
	if frappe.has_permission("Admin Settings", "write", user=user):
		return None
	if ptype in ("print", "email", "export", "report", "share"):
		return False
	method = getattr(frappe.local, "form_dict", {}).get("cmd") or ""
	if not method and getattr(frappe.local, "request", None):
		method = (frappe.local.request.path or "").rsplit("/api/method/", 1)[-1]
	path = (frappe.local.request.path or "") if getattr(frappe.local, "request", None) else ""
	if method in DESK_FORM_METHODS or path.startswith("/printview"):
		return False  # Frappe prints whatever may be read: printing it needs edit rights too
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
