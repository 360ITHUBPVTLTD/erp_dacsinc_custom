"""Sales Order Workflow: more roles may edit a draft waiting for approval (user, 18-11-2026).

A workflow state has one "Only Allow Edit For" role, but Frappe's form reads every row of a state
(frappe.workflow.get_document_state_roles collects them all), so a second row for the same state adds a role.
Added, after the existing rows — nothing else is changed (no rebuild: live's own rows and its 13 transitions stay):

| State | Edit (existing) | Added |
|---|---|---|
| Pending Merchandiser Approval | Merchandiser User | Admin, Sales Order Final Approver |
| Pending Final Approval | Admin (so_final_approval_edit_admin) | Sales Order Final Approver |

"Sales Order Final Approver" is the role kept on exactly the users of Admin Settings › Sales Order Final Approval
(order_flow_permissions.sync_sales_order_final_approver_role). Editing still needs Write on Sales Order from a real
role; this only unlocks the form in these states.
"""

import frappe

ADD = (
	("Pending Merchandiser Approval", "Admin"),
	("Pending Merchandiser Approval", "Sales Order Final Approver"),
	("Pending Final Approval", "Sales Order Final Approver"),
)


def execute():
	if not frappe.db.exists("Workflow", "Sales Order Workflow"):
		return
	wf = frappe.get_doc("Workflow", "Sales Order Workflow")
	have = {(s.state, s.allow_edit) for s in wf.states}
	added = False
	for state, role in ADD:
		if (state, role) in have or not frappe.db.exists("Role", role):
			continue
		row = next((s for s in wf.states if s.state == state), None)
		if not row:
			continue
		wf.append("states", {"state": state, "doc_status": row.doc_status, "allow_edit": role})
		added = True
	if added:
		wf.flags.ignore_permissions = True
		wf.save()
		frappe.clear_cache(doctype="Sales Order")
