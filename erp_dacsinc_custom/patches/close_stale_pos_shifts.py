"""POS clean-up for the cash-drawer rules (pos_cash.py, 2026-10-02): setup-time test bills
(before 1 Sep 2026) that never reached the accounts are cancelled, and shifts left open from
before today are closed (closing = expected, not counted; no closing email). Today's shifts
are left alone. Runs once."""

import frappe


def execute():
	from erp_dacsinc_custom import pos_cash

	pos_cash.create_fields()  # the closing entries carry the cash fields
	frappe.reload_doctype("POS Closing Entry")
	frappe.reload_doctype("POS Opening Entry")
	done = pos_cash.close_stale_shifts()
	for k, v in done.items():
		print(f"{k}: {len(v)}")
		for line in v:
			print("  ", line)
