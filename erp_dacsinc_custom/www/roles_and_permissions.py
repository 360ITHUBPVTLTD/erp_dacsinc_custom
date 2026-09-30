import json

import frappe
from frappe.sessions import get_csrf_token

from erp_dacsinc_custom.access_sync import is_active, sheet_roles
from erp_dacsinc_custom.access_worksheet import EDIT_ROLE, RESET_ROLE, can_view, load_all

no_cache = 1


def get_context(context):
	# Only Admin, System Manager and Administrator may open this page (access_worksheet.VIEW_ROLES).
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/roles-and-permissions"
		raise frappe.Redirect
	if not can_view():
		frappe.throw("Only Admin and System Manager can open Roles & Permissions.", frappe.PermissionError)
	signed_in = True
	saved = load_all() if signed_in else {}
	context.no_breadcrumbs = True
	context.ws_boot = json.dumps({
		"signed_in": signed_in,
		"can_edit": signed_in and EDIT_ROLE in frappe.get_roles(),
		# Resets (restore / clear / refill, apply to the ERP, reset profiles): System Manager.
		"can_reset": signed_in and RESET_ROLE in frappe.get_roles(),
		"csrf_token": get_csrf_token() if signed_in else "",
		"saved": saved,
		# Sheet columns: the roles flagged for the access sheet (dynamic).
		"roles": sheet_roles(),
		# Switched on = saving applies the sheet to the ERP (see access_sync).
		"active": is_active(),
	}).replace("<", "\\u003c")
	return context
