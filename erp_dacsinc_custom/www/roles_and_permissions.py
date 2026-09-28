import json

import frappe
from frappe.sessions import get_csrf_token

from erp_dacsinc_custom.access_sync import is_active, sheet_roles
from erp_dacsinc_custom.access_worksheet import EDIT_ROLE, load_all

no_cache = 1


def get_context(context):
	# The page itself stays public; the saved decision sheets are shown only to
	# signed-in users, and only the Admin role can edit them.
	signed_in = frappe.session.user != "Guest"
	saved = load_all() if signed_in else {}
	context.no_breadcrumbs = True
	context.ws_boot = json.dumps({
		"signed_in": signed_in,
		"can_edit": signed_in and EDIT_ROLE in frappe.get_roles(),
		"csrf_token": get_csrf_token() if signed_in else "",
		"saved": saved,
		# Sheet columns: the roles flagged for the access sheet (dynamic).
		"roles": sheet_roles(),
		# Switched on = saving applies the sheet to the ERP (see access_sync).
		"active": is_active(),
	}).replace("<", "\\u003c")
	return context
