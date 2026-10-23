"""Subcontracting Receipts submitted without "Original Document References" (ITC-04: the Send to
Subcontractor Stock Entries their goods went out on) get them — India Compliance's own suggestion
(job_work.itc04_references). New receipts are filled on save (job_work.fill_itc04_references). The
table is not editable after submit, so the rows are written directly; a dated comment on each.
"""

import frappe

from erp_dacsinc_custom.job_work import itc04_references


def execute():
	if not frappe.db.has_column("Subcontracting Receipt", "name") or not frappe.get_meta("Subcontracting Receipt").has_field("doc_references"):
		return
	done = 0
	for name in frappe.get_all("Subcontracting Receipt", filters={"docstatus": 1, "is_return": 0}, pluck="name"):
		if frappe.db.exists("Dynamic Link", {"parenttype": "Subcontracting Receipt", "parent": name, "parentfield": "doc_references"}):
			continue
		doc = frappe.get_doc("Subcontracting Receipt", name)
		added = []
		for doctype, names in itc04_references(doc).items():
			for link in names:
				row = doc.append("doc_references", {"link_doctype": doctype, "link_name": link})
				row.db_insert()
				added.append(link)
		if added:
			frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Subcontracting Receipt",
							"reference_name": name, "content": "2026-10-23: Original Document References for ITC-04 added — "
							+ ", ".join(added) + " (the challans its goods were sent on)."}).insert(ignore_permissions=True)
			done += 1
	print(f"itc04_subcontracting_receipt_references: {done} receipt(s) filled")
