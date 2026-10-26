"""Delivery Note "Custom Print › With Amount / Without Amount" moved into the app (public/js/delivery_note.js).
The DB Client Script "Delivery Note" that added them opened "Delivery Note Without Amount Version 3" from both
buttons, so "With Amount" printed no amounts. It is disabled — its only live code was those buttons. Left alone
if someone has since changed it to do more. Dated comment on change.
"""

import frappe
from frappe.utils import nowdate

SCRIPT = "Delivery Note"


def execute():
	if not frappe.db.exists("Client Script", SCRIPT):
		return
	s = frappe.get_doc("Client Script", SCRIPT)
	if not s.enabled:
		return
	live = "\n".join(l for l in (s.script or "").splitlines() if not l.strip().startswith("//"))
	if "Custom Print" not in live or "frappe.call" in live or "set_query" in live or live.count("add_custom_button") != 2:
		return
	frappe.db.set_value("Client Script", SCRIPT, "enabled", 0)
	frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Client Script",
					"reference_name": SCRIPT,
					"content": f"{nowdate()}: disabled — Custom Print › With / Without Amount now in the app "
							   "(public/js/delivery_note.js); both buttons here opened \"Delivery Note Without Amount Version 3\""}).insert(ignore_permissions=True)
