"""Assign users' roles from the client's user sheet (access/user_roles.json), once per
site. See user_role_sheet.py. To run it again after the sheet changes, add a comment to
its line in patches.txt."""

import frappe


def execute():
	from erp_dacsinc_custom import access_sync, user_role_sheet

	if frappe.db.has_column("Role", access_sync.ROLE_FLAG):
		access_sync.ensure_roles_and_profiles()  # the sheet roles' own profiles exist first
	report = user_role_sheet.apply()
	print(f"User roles from sheet: {len(report['changed'])} changed, {len(report['unchanged'])} already right, "
		  f"not found: {report['not_found'] or 'none'}, no profile: {report['no_profile'] or 'none'}")
