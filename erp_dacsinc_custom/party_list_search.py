"""The Customer / Supplier lists' "Search everything" box (public/js/party_list_search.js, docs/list-search.md): one
text matched on id, name, mobile, email, GSTIN, group, any of their addresses (lines, city, pincode, phone) or a phone on
any of their contacts — the same search as the payment prompt (bulk_payment._search_parties). The list then shows those."""

import frappe
from frappe import _

LIMIT = 500


@frappe.whitelist()
def search(doctype, txt):
	"""ids of the customers / suppliers matching `txt` that this user may read (at most LIMIT)."""
	if doctype not in ("Customer", "Supplier"):
		frappe.throw(_("Only for Customer and Supplier."))
	if not frappe.has_permission(doctype, "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	txt = (txt or "").strip()
	if not txt:
		return []
	from erp_dacsinc_custom.erp_dacsinc_custom.doctype.bulk_payment.bulk_payment import _search_parties
	return _search_parties(doctype, txt, limit=LIMIT)
