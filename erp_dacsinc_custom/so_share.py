"""Sales Order › Lead Owner (custom_lead_owner) gets the order shared with them.

The lead owner can open and edit the order (DocShare read + write; not submit, not
re-share), whatever their role's own Sales Order rights are (e.g. DAC CRM's "own
records only"). When the lead owner changes, the old one's share is removed and the
new one is shared. A share someone gave by hand with more rights is never reduced.

custom_lead_owner is read-only on the form. It's filled from the Lead, sometimes with
db.set_value inside Sales Order on_update (custom_script.sales_order_on_update), so
the value is read back from the database here, and this hook runs after that one.
"""

import frappe

SKIP_USERS = {"Administrator", "Guest"}


def _share(name, user):
	from frappe.share import add_docshare

	current = frappe.db.get_value("DocShare", {"share_doctype": "Sales Order", "share_name": name, "user": user},
								  ["read", "write", "submit", "share"], as_dict=True)
	if current and current.read and current.write:
		return
	add_docshare("Sales Order", name, user, read=1, write=1,
				 submit=(current or {}).get("submit") or 0, share=(current or {}).get("share") or 0,
				 flags={"ignore_share_permission": True}, notify=0)


def _unshare(name, user):
	share = frappe.db.get_value("DocShare", {"share_doctype": "Sales Order", "share_name": name, "user": user})
	if share:
		frappe.delete_doc("DocShare", share, ignore_permissions=True, flags={"ignore_share_permission": True})


def _valid(user):
	return user and user not in SKIP_USERS and frappe.db.get_value("User", user, "enabled")


def share_with_lead_owner(doc, method=None):
	"""Sales Order on_update / on_update_after_submit."""
	lead_owner = frappe.db.get_value("Sales Order", doc.name, "custom_lead_owner")
	before = doc.get_doc_before_save()
	old = before.get("custom_lead_owner") if before else None
	if old and old != lead_owner and old != doc.owner:
		_unshare(doc.name, old)
	if _valid(lead_owner):
		_share(doc.name, lead_owner)


def backfill():
	"""Share every existing Sales Order with its lead owner (patch, once)."""
	n = 0
	for so in frappe.get_all("Sales Order", filters={"custom_lead_owner": ["is", "set"], "docstatus": ["<", 2]},
							 fields=["name", "custom_lead_owner"]):
		if _valid(so.custom_lead_owner):
			_share(so.name, so.custom_lead_owner)
			n += 1
	return n
