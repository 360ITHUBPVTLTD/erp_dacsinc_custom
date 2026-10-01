"""No second draft for the same source line.

When a document is made from another (a Purchase Order from a Material Request, a
Delivery Note from a Pick List, …) and a DRAFT made from the same source line already
exists, the new one is refused and the existing draft is named, to open and finish (or
delete) instead. Without this, a second draft for an already-drafted line is easy to make
by clicking the same "Create" button again, and both then compete for the same qty.

Only new documents are checked (before_insert): existing drafts — even old duplicates —
can still be edited and submitted. Submitted documents never block (their qty caps are
ERPNext's own job). No "create anyway": finish or delete the draft.
"""

import frappe
from frappe import _

# new document → [(child table field, child doctype, link field on the child row, what that link points at)]
SOURCES = {
	"Purchase Order": [("items", "Purchase Order Item", "material_request_item", "Material Request"),
					   ("items", "Purchase Order Item", "sales_order_item", "Sales Order")],
	"Subcontracting Order": [("items", "Subcontracting Order Item", "purchase_order_item", "Purchase Order")],
	"Purchase Receipt": [("items", "Purchase Receipt Item", "purchase_order_item", "Purchase Order")],
	"Purchase Invoice": [("items", "Purchase Invoice Item", "po_detail", "Purchase Order"),
						 ("items", "Purchase Invoice Item", "pr_detail", "Purchase Receipt")],
	"Subcontracting Receipt": [("items", "Subcontracting Receipt Item", "subcontracting_order_item", "Subcontracting Order")],
	"Material Request": [("items", "Material Request Item", "sales_order_item", "Sales Order")],
	"Delivery Note": [("items", "Delivery Note Item", "so_detail", "Sales Order"),
					  ("items", "Delivery Note Item", "pick_list_item", "Pick List")],
	"Sales Invoice": [("items", "Sales Invoice Item", "so_detail", "Sales Order"),
					  ("items", "Sales Invoice Item", "dn_detail", "Delivery Note")],
}


def existing_drafts(doctype, doc):
	"""{draft name: {source doctypes}} — drafts of `doctype` made from the same source
	lines as `doc` (a document or a dict, e.g. a mapped draft not saved yet)."""
	found = {}
	for table, child, field, source in SOURCES.get(doctype, []):
		values = tuple({r.get(field) for r in (doc.get(table) or []) if r.get(field)})
		if not values:
			continue
		for d in frappe.db.sql(f"""
			SELECT DISTINCT c.parent
			FROM `tab{child}` c JOIN `tab{doctype}` p ON p.name = c.parent
			WHERE p.docstatus = 0 AND c.`{field}` IN %(v)s
		""", {"v": values}, as_dict=True):
			found.setdefault(d.parent, set()).add(source)
	return found


def _message(doctype, found):
	links = ", ".join(frappe.utils.get_link_to_form(doctype, n) for n in sorted(found))
	sources = ", ".join(sorted({s for v in found.values() for s in v}))
	return _("A draft {0} already exists for the same {1} line(s): {2}.<br><br>"
			 "Open that draft and finish it (or delete it) instead of creating another.").format(
		_(doctype), sources, links)


@frappe.whitelist()
def find_existing_drafts(doc):
	"""Before a mapped draft is opened (Order Flow / Sales Order "Create …" preview):
	the same check as on save, so the user is sent to the existing draft up front."""
	doc = frappe._dict(frappe.parse_json(doc))
	if doc.get("doctype") not in SOURCES:
		return None
	frappe.has_permission(doc.doctype, "create", throw=True)
	found = existing_drafts(doc.doctype, doc)
	if not found:
		return None
	return {"drafts": sorted(found), "message": _message(doc.doctype, found)}


def guard_duplicate_draft(doc, method=None):
	"""before_insert of the documents in SOURCES."""
	if frappe.flags.in_import or frappe.flags.in_patch or frappe.flags.in_migrate or doc.flags.ignore_draft_guard:
		return
	found = existing_drafts(doc.doctype, doc)
	if found:
		frappe.throw(_message(doc.doctype, found), title=_("Draft already exists"))
