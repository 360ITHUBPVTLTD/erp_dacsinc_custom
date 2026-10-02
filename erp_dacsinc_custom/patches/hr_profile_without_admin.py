"""HR profile without the Admin role; HR Manager manages users on Roles & Permissions.

- Role Profile "HR" loses Admin (its users — hr@dacsinc.in — lose it with it; Role
  Profile's own on_update updates them). HR keeps HR Manager, HR User, Leave Approver,
  Delivery User, Employee.
- HR Manager may open the Roles & Permissions desk page (page roles + its Custom Role),
  where roles_and_permissions_api keeps a user manager away from admins and admin roles.
"""

import frappe


def execute():
	if frappe.db.exists("Role Profile", "HR"):
		rp = frappe.get_doc("Role Profile", "HR")
		keep = [r for r in rp.roles if r.role != "Admin"]
		if len(keep) != len(rp.roles):
			rp.set("roles", [{"role": r.role} for r in keep])
			rp.flags.ignore_permissions = True
			rp.save(ignore_permissions=True)
		# users holding the profile (native field or User Access Profile) lose Admin too
		users = set(frappe.get_all("User", filters={"role_profile_name": "HR"}, pluck="name"))
		users |= set(frappe.get_all("User Access Profile Role Profile", filters={"role_profile": "HR"}, pluck="parent"))
		for u in users:
			if "Admin" in frappe.get_roles(u):
				frappe.get_doc("User", u).remove_roles("Admin")

	frappe.reload_doc("erp_dacsinc_custom", "page", "roles_and_permissions")
	cr = frappe.db.get_value("Custom Role", {"page": "roles-and-permissions"}, "name")
	if cr:
		doc = frappe.get_doc("Custom Role", cr)
		if "HR Manager" not in [r.role for r in doc.roles]:
			doc.append("roles", {"role": "HR Manager"})
			doc.save(ignore_permissions=True)
	frappe.clear_cache()
