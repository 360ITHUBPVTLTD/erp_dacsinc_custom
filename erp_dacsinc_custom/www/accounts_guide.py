import frappe

no_cache = 1


def get_context(context):
	# The Accounts Guide (Order Flow › Finance › Guide): how the accounts team works in ERPNext —
	# entry types, debit / credit, Journal Entry, examples, routine, reports, fixes.
	# Signed-in staff only, like /project-guide.
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/accounts-guide"
		raise frappe.Redirect
	context.no_breadcrumbs = True
	return context
