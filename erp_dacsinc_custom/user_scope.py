"""User list: only Admin, HR Manager and System Manager see every user.

Everyone else may still pick users in Link fields (Assign To, Merchandiser User, Lead Owner…) —
Employee and the access-sheet roles keep Select on User — but the User List / Report view and the
list APIs show them only their own record, and another user's form is refused (no Read on User).
Frappe's own user_query (the Link-field search) runs through the same frappe.get_list, so the
narrowing is applied only to list requests, never to a search. See docs/user-list-access.md.
"""
import frappe

FULL_ACCESS_ROLES = {"Admin", "HR Manager", "System Manager"}

# Desk List / Report view, its count and sidebar, and the list APIs.
LIST_METHODS = {
	"frappe.desk.reportview.get",
	"frappe.desk.reportview.get_list",
	"frappe.desk.reportview.get_count",
	"frappe.desk.reportview.get_sidebar_stats",
	"frappe.desk.reportview.get_group_by_count",
	"frappe.desk.reportview.export_query",
	"frappe.client.get_list",
	"frappe.client.get_count",
}


def _is_list_request():
	cmd = (frappe.form_dict or {}).get("cmd") or ""
	if cmd in LIST_METHODS:
		return True
	req = getattr(frappe.local, "request", None)
	path = getattr(req, "path", "") or ""
	# /api/resource/User (GET list); /api/method/<list method>
	return path.rstrip("/") in ("/api/resource/User", "/api/v2/document/User") \
		or any(path.endswith("/" + m) for m in LIST_METHODS)


def get_user_list_conditions(user=None):
	user = user or frappe.session.user
	if user == "Administrator" or FULL_ACCESS_ROLES & set(frappe.get_roles(user)):
		return ""
	if not _is_list_request():
		return ""
	return "(`tabUser`.`name` = {0})".format(frappe.db.escape(user))
