"""Employee role: Select on User, not Read (docs/user-list-access.md).

Every staff login holds Employee, and its Read on User let anyone open any user's form and see
the whole user list. Select keeps user pickers (Assign To, Merchandiser User, Lead Owner…)
working; a user's own record stays open to them (shared with themselves); Admin, HR Manager and
System Manager keep full access. Only this one Custom DocPerm row is touched.
"""
import frappe


def execute():
	name = frappe.db.get_value("Custom DocPerm", {"parent": "User", "role": "Employee", "permlevel": 0}, "name")
	if not name:
		return
	frappe.db.set_value("Custom DocPerm", name, {"read": 0, "select": 1}, update_modified=False)
	frappe.clear_cache(doctype="User")
