# Copyright (c) 2026, Pankaj and contributors
# For license information, please see license.txt

import json

import frappe
from frappe.model.document import Document


class UserAccessProfile(Document):
	def on_update(self):
		sync_user_access_profile(self.name)


def sync_user_access_profile(profile_name):
	"""
	Apply the union of roles from every Role Profile selected on this User
	Access Profile record onto the target User, without disturbing any role
	held for a different reason (a directly-assigned role, another
	mechanism like Sales Order Final Approver). Only ever adds/removes
	roles THIS record previously applied — tracked in `managed_roles` — so
	a role granted some other way is never touched, even if it happens to
	also be a member of a currently-selected profile.

	The target User's native `role_profile_name` is force-cleared: Frappe
	unconditionally repopulates `roles` from that single field on every
	User save (see User.populate_role_profile_roles()), which would
	silently undo a multi-profile assignment the next time anyone saves
	the User through the standard form. A user managed here is managed
	entirely through this mechanism, not a mix of both — User's own schema
	is never modified, only its existing `roles` table and the (already
	optional) `role_profile_name` field are updated through the normal
	Document API, same as any other code that assigns roles.
	"""
	profile_doc = frappe.get_doc("User Access Profile", profile_name)
	user = profile_doc.user

	# Read the tracking field straight from the DB rather than trusting
	# profile_doc's in-memory value: if the caller holds/saves a copy of
	# this document that was loaded before a previous sync ran, that save
	# would otherwise silently overwrite managed_roles back to a stale
	# value, corrupting reconciliation on every future sync.
	managed_roles_in_db = frappe.db.get_value(
		"User Access Profile", profile_name, "managed_roles"
	) or "[]"
	previously_managed = set(json.loads(managed_roles_in_db))

	wanted_roles = set()
	for row in profile_doc.role_profiles or []:
		wanted_roles.update(frappe.get_all(
			"Has Role",
			filters={"parent": row.role_profile, "parenttype": "Role Profile"},
			pluck="role",
		))

	user_doc = frappe.get_doc("User", user)
	current_roles = {d.role for d in user_doc.roles}
	final_roles = (current_roles - previously_managed) | wanted_roles

	changed = final_roles != current_roles
	if user_doc.role_profile_name:
		user_doc.role_profile_name = ""
		changed = True

	if changed:
		user_doc.set("roles", [{"role": r} for r in sorted(final_roles)])
		user_doc.flags.ignore_permissions = True
		user_doc.save(ignore_permissions=True)

	new_managed = json.dumps(sorted(wanted_roles))
	if new_managed != managed_roles_in_db:
		frappe.db.set_value(
			"User Access Profile", profile_doc.name, "managed_roles", new_managed,
			update_modified=False,
		)


def guard_role_profile_name(doc, method=None):
	"""
	Registered as User's before_validate hook — runs BEFORE Frappe's own
	validate() on every save. If this user is managed by a User Access
	Profile, force `role_profile_name` back to empty here, pre-emptively.

	Native User.populate_role_profile_roles() (called from validate())
	unconditionally wipes `roles` to nothing and rebuilds it from JUST
	that one field the moment it's non-empty — including any role this
	mechanism (or anything else) had granted. By the time on_update fires,
	that wipe has already happened and the discarded roles are gone;
	resync_after_user_save can restore what THIS mechanism tracks, but not
	roles it never owned in the first place. Clearing the field here means
	the wipe never happens at all, so nothing needs recovering afterward.
	"""
	if frappe.flags.in_install or frappe.flags.in_patch or frappe.flags.in_migrate:
		return
	if not doc.role_profile_name:
		return
	if not frappe.db.exists("User Access Profile", doc.name):
		return
	doc.role_profile_name = ""


def resync_after_user_save(doc, method=None):
	"""
	Registered as User's on_update hook (see hooks.py doc_events) so a save
	made through ANY path — the standard desk User form, a data import,
	another app's script, not just this app's own Roles & Permissions page
	— stays consistent with the user's User Access Profile. If someone sets
	a native Role Profile directly on the User form, that save wipes
	`roles` down to just that profile first (Frappe core behaviour); this
	hook then re-applies the multi-profile set and clears the native field
	again, self-healing the drift instead of leaving both places
	disagreeing about what the user's roles actually are.
	"""
	if frappe.flags.in_install or frappe.flags.in_patch or frappe.flags.in_migrate:
		return
	if getattr(frappe.local, "_uap_resyncing", None) == doc.name:
		return  # re-entrancy guard: our own corrective save re-enters this hook once
	if not frappe.db.exists("User Access Profile", doc.name):
		return
	frappe.local._uap_resyncing = doc.name
	try:
		sync_user_access_profile(doc.name)
	finally:
		frappe.local._uap_resyncing = None
