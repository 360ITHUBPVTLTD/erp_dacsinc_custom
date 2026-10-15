"""Which Modes of Payment are offered for Payment Entries.

Mode of Payment › "Show in Payment Entry" (custom_show_in_payment_entry). Only ticked modes are
offered in the Payment Entry form's Mode of Payment and in Order Flow › Finance › Receive / Pay
(dashboard_payment), and record_payment refuses any other. The POS modes ("Cash - Counter 3",
"UPI - VV Puram", …) stay out by leaving them unticked; POS itself never reads this flag.
"""

import frappe

FLAG = "custom_show_in_payment_entry"


def ensure_field():
	"""after_migrate: the tick on Mode of Payment. The first time it is created, the enabled modes
	that no POS Profile uses are ticked, so the lists are never empty on day one."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	is_new = not frappe.db.has_column("Mode of Payment", FLAG)
	create_custom_fields({"Mode of Payment": [{
		"fieldname": FLAG, "fieldtype": "Check", "label": "Show in Payment Entry",
		"insert_after": "enabled", "default": "0", "in_list_view": 1, "in_standard_filter": 1,
		"description": "Offered in the Payment Entry form and in Order Flow › Finance › Receive / Pay. "
					   "Leave POS modes (counters, store UPI / card) unticked.",
	}]}, update=True)
	if is_new:
		pos_modes = {r[0] for r in frappe.db.sql("SELECT DISTINCT mode_of_payment FROM `tabPOS Payment Method`")}
		for name in frappe.get_all("Mode of Payment", filters={"enabled": 1}, pluck="name"):
			if name not in pos_modes:
				frappe.db.set_value("Mode of Payment", name, FLAG, 1, update_modified=False)


def shown(mode_of_payment):
	"""True when this mode may be used on a Payment Entry (the flag is ticked)."""
	if not frappe.db.has_column("Mode of Payment", FLAG):
		return True
	return bool(frappe.db.get_value("Mode of Payment", mode_of_payment, FLAG))
