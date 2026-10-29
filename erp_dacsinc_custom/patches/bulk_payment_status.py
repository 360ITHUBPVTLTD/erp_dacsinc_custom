"""Bulk Payment › Status (Draft / Submitted / Partly Cancelled / Cancelled) is new: existing Bulk Payments get it from
their docstatus (the column's default made them all Draft) — a submitted one whose Payment Entries are all cancelled cannot exist yet (that was refused), so
Submitted / Cancelled / Draft. A dated comment on each. docs/bulk-payment.md › Bulk Payment lifecycle."""

import frappe

DAY = "2026-10-29"
STATUS = {0: "Draft", 1: "Submitted", 2: "Cancelled"}


def execute():
	n = 0
	# adding the field gives every row its default (Draft): put each right from its docstatus
	for bp in frappe.get_all("Bulk Payment", fields=["name", "docstatus", "status"]):
		if bp.status == STATUS[bp.docstatus] or (bp.docstatus == 1 and bp.status == "Partly Cancelled"):
			continue
		frappe.db.set_value("Bulk Payment", bp.name, "status", STATUS[bp.docstatus], update_modified=False)
		frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Bulk Payment",
						"reference_name": bp.name, "content": f"{DAY}: Status set to {STATUS[bp.docstatus]} (new field)."}).insert(ignore_permissions=True)
		n += 1
	print(f"bulk_payment_status: {n} Bulk Payment(s)")
