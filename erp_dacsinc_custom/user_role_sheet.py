"""Users' roles from the client's user sheet (access/user_roles.json).

Each listed user gets exactly the Role Profile of the role named for them — the sheet
role's own profile (that role + Employee + Employee Self Service) — and "" means the
Employee profile. Every other role is removed, except Sales Order Final Approver, which
Admin Settings › final approvers manages user-wise (order_flow_permissions).
HRMS removes Employee / Employee Self Service from a user with no Employee record (e.g.
the POS counter logins); that is expected. Users not in the file are never touched; users the file names but the site doesn't have
are skipped and reported.

The profile is kept on the user's User Access Profile record (created when missing), the
way the Roles & Permissions page assigns profiles, and the User's own Role Profile field
is cleared — so every user is managed the same way and a later save keeps the roles.

Runs once per site through patch `assign_user_roles_from_sheet` (live: on migrate);
locally: bench --site … execute erp_dacsinc_custom.user_role_sheet.apply --kwargs
'{"dry_run": 1}'.
"""

import json
import os

import frappe

BASE = {"Employee", "Employee Self Service"}
AUTOMATIC = {"All", "Guest", "Desk User", "Administrator"}
KEEP = {"Sales Order Final Approver"}  # given by Admin Settings (user-wise)
SHEET = os.path.join(os.path.dirname(__file__), "access", "user_roles.json")


def _profiles():
	out = {}
	for rp in frappe.get_all("Role Profile", pluck="name"):
		out[rp] = set(frappe.get_all("Has Role", filters={"parent": rp, "parenttype": "Role Profile"}, pluck="role"))
	return out


def profile_for(role, profiles=None):
	profiles = profiles or _profiles()
	want = ({role} if role else set()) | BASE
	matches = sorted(p for p, roles in profiles.items() if roles == want)
	return matches[0] if matches else None


def apply(dry_run=False):
	data = json.load(open(SHEET))
	profiles = _profiles()
	report = {"changed": [], "unchanged": [], "not_found": [], "no_profile": []}
	for email, role in data["users"].items():
		user = frappe.db.get_value("User", {"name": email}, "name") or frappe.db.get_value("User", {"email": email}, "name")
		if not user:
			report["not_found"].append(email)
			continue
		prof = profile_for(role, profiles)
		if not prof:
			report["no_profile"].append(f"{email}: {role}")
			continue
		current = set(frappe.get_all("Has Role", filters={"parent": user, "parenttype": "User"}, pluck="role")) - AUTOMATIC
		target = profiles[prof] | (current & KEEP)
		uap = frappe.db.exists("User Access Profile", user)
		uap_ok = bool(uap) and [r.role_profile for r in frappe.get_doc("User Access Profile", uap).role_profiles] == [prof]
		no_employee = not frappe.db.exists("Employee", {"user_id": user})
		same = current == target or (no_employee and current == target - BASE)
		if same and uap_ok and not frappe.db.get_value("User", user, "role_profile_name"):
			report["unchanged"].append(user)
			continue
		report["changed"].append({"user": user, "profile": prof, "added": sorted(target - current), "removed": sorted(current - target)})
		if dry_run:
			continue
		# The profile always lives on the user's User Access Profile record, the way the
		# Roles & Permissions page assigns it (one place, editable there the same way).
		if True:
			doc = frappe.get_doc("User Access Profile", uap) if uap else frappe.new_doc("User Access Profile")
			doc.user = user
			doc.set("role_profiles", [{"role_profile": prof}])
			doc.flags.ignore_permissions = True
			doc.save(ignore_permissions=True)  # replaces the rows; its own sync runs, the roles are set exactly below
			frappe.db.set_value("User Access Profile", doc.name, "managed_roles", json.dumps(sorted(profiles[prof])), update_modified=False)
		u = frappe.get_doc("User", user)
		u.role_profile_name = None
		u.set("roles", [{"role": r} for r in sorted(target)])
		u.flags.ignore_permissions = True
		frappe.local._uap_resyncing = user  # the roles are already exact; skip the multi-profile resync
		try:
			u.save(ignore_permissions=True)
		finally:
			frappe.local._uap_resyncing = None
		got = set(frappe.get_all("Has Role", filters={"parent": user, "parenttype": "User"}, pluck="role")) - AUTOMATIC
		# HRMS takes Employee / Employee Self Service off a user with no Employee record
		if got != target and not (got == target - BASE and no_employee):
			frappe.throw(f"{user}: roles after save {sorted(got)} ≠ {sorted(target)}")
	return report
