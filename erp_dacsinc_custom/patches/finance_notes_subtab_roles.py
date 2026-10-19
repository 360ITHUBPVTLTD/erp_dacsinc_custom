"""Finance › Returns / Notes (new sub-tab): start with the same roles as Receivables, so whoever
sees / acts on Receivables keeps seeing / acting on the returns too (docs/order-flow-dashboard.md)."""

import frappe


def execute():
	if not frappe.db.exists("DocType", "Admin Settings"):
		return
	doc = frappe.get_doc("Admin Settings")
	changed = False
	for src, dst in (("of_sub_accounts_receivables_roles", "of_sub_accounts_notes_roles"),
					 ("of_sub_accounts_receivables_act_roles", "of_sub_accounts_notes_act_roles")):
		if not doc.meta.has_field(dst) or doc.get(dst):
			continue
		roles = [d.role for d in (doc.get(src) or []) if d.role]
		if roles:
			doc.set(dst, [{"role": r} for r in roles])
			changed = True
	if changed:
		doc.flags.ignore_permissions = True
		doc.flags.dacs_access_applying = True
		doc.save()
