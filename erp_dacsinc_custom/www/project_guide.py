import frappe

no_cache = 1


def get_context(context):
	# The project guide (overview, flow, roles, BRD, FRD, developer and deploy notes) is
	# internal: signed-in staff only, like /order-flow-rules.
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/project-guide"
		raise frappe.Redirect
	context.no_breadcrumbs = True
	return context
