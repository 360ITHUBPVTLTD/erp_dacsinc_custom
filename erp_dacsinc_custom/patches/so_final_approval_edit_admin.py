"""Sales Order Workflow › Pending Final Approval: "Only Allow Edit For" = Admin (was System Manager).

User, 18-11-2026: Admin could not edit a draft Sales Order waiting for final approval — the workflow lets only the
state's one "allow edit" role edit it, and that was System Manager. Every System Manager user on live also holds
Admin, so nobody loses edit. Only this one field is set; the rest of the workflow (states, transitions, roles) is
left exactly as each site has it — no rebuild (setup_sales_order_workflow(force=True) would replace live's own rows).
"""

import frappe


def execute():
	if not frappe.db.exists("Workflow", "Sales Order Workflow") or not frappe.db.exists("Role", "Admin"):
		return
	row = frappe.db.get_value("Workflow Document State",
	                          {"parent": "Sales Order Workflow", "parenttype": "Workflow", "state": "Pending Final Approval"},
	                          ["name", "allow_edit"], as_dict=True)
	if not row or row.allow_edit == "Admin":
		return
	frappe.db.set_value("Workflow Document State", row.name, "allow_edit", "Admin", update_modified=False)
	frappe.clear_cache(doctype="Sales Order")
