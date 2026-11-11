"""Admin Settings › Kits — Allowed Roles / Can Act: filled once with the tab's default role
(order_flow_permissions.DEFAULT_TAB_ROLES — Production Manager) when empty. docs/kits.md.

Touches ONLY those two fields: the rows are inserted directly, Admin Settings is NOT saved, so no
other field and none of its on_update hooks (Order Flow page roles, final approver role) run — the
site's own access stays exactly as it is. A field that already has roles is left alone.
"""
import frappe


def execute():
	from erp_dacsinc_custom.order_flow_permissions import DEFAULT_TAB_ROLES

	meta = frappe.get_meta("Admin Settings")
	for field in ("of_tab_kit_roles", "of_tab_kit_act_roles"):
		df = meta.get_field(field)
		if not df:
			continue
		if frappe.db.exists(df.options, {"parent": "Admin Settings", "parenttype": "Admin Settings", "parentfield": field}):
			continue
		for idx, role in enumerate([r for r in DEFAULT_TAB_ROLES["kit"] if frappe.db.exists("Role", r)], 1):
			frappe.get_doc({"doctype": df.options, "parent": "Admin Settings", "parenttype": "Admin Settings",
			                "parentfield": field, "idx": idx, "role": role}).db_insert()
	frappe.clear_document_cache("Admin Settings", "Admin Settings")
