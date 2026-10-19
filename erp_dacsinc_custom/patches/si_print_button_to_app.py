"""The Sales Invoice "Print Sales Invoice" button moved into the app (public/js/sales_invoice.js,
with "All 4 copies"). The DB Client Script "sales invoice Form new" that added the old button (no
"All" choice) is disabled — its only live code was that button; its stock-overview table was
never called. Left alone if someone has since changed it to do more.
"""

import re

import frappe

SCRIPT = "sales invoice Form new"


def execute():
	if not frappe.db.exists("Client Script", SCRIPT):
		return
	s = frappe.get_doc("Client Script", SCRIPT)
	if not s.enabled:
		return
	live = "\n".join(l for l in (s.script or "").splitlines() if not l.strip().startswith("//"))
	if "Print Sales Invoice" not in live or re.search(r"(?<!function )generate_html_table\(", live):
		return
	frappe.db.set_value("Client Script", SCRIPT, "enabled", 0)
