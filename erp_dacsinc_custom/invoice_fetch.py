"""A new Sales Invoice opened directly (not from Order Flow / a Delivery Note): fetch what is
waiting to be billed — the same thing Order Flow › Pending DN/SI invoices.

One route only (custom_script.guard_so_fulfillment_route_lock): Sales Order → Pick List →
Delivery Note → Sales Invoice made from that DN. So "waiting to be billed" = submitted Delivery
Note lines not yet fully invoiced: delivered qty − billed on ordinary submitted invoices − returned
on a Sales Return. Credit Notes are NOT netted off the billed qty (ERPNext's own map does that): a
credit note whose goods haven't come back would otherwise make the line billable again and the
goods could be invoiced twice — the goods side is handled by return_goods.py. Lines already on a draft invoice are
listed but can't be picked (draft_guard would refuse a second one). The invoice itself is built by
custom_script.make_sales_invoice_from_dn_items — ERPNext's DN → SI mapping for just those lines —
so rates, locks and the billed / returned caps are exactly those of every other route.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt


@frappe.whitelist()
def get_billable_dn_lines(customer, company=None):
	if not frappe.has_permission("Sales Invoice", "create"):
		frappe.throw(_("Not permitted to create a Sales Invoice"), frappe.PermissionError)
	if not customer:
		return []
	from erpnext.stock.doctype.delivery_note.delivery_note import get_returned_qty_map

	filters = {"docstatus": 1, "is_return": 0, "customer": customer, "per_billed": ["<", 100],
			   "status": ["not in", ["Closed", "Return Issued"]]}
	if company:
		filters["company"] = company
	# get_list: the user's own Delivery Note permissions apply (merchandiser / store scope)
	dns = frappe.get_list("Delivery Note", filters=filters, fields=["name", "posting_date", "currency", "company", "po_no", "customer_name"],
						  order_by="posting_date asc, name asc", limit_page_length=500)
	if not dns:
		return []
	items = frappe.get_all("Delivery Note Item", filters={"parent": ["in", [d.name for d in dns]], "parenttype": "Delivery Note"},
						   fields=["name", "parent", "idx", "item_code", "item_name", "qty", "uom", "rate", "against_sales_order"],
						   order_by="parent asc, idx asc")
	names = tuple(i.name for i in items)
	billed = {r.dn_detail: flt(r.q) for r in frappe.db.sql("""SELECT sii.dn_detail, SUM(sii.qty) AS q FROM `tabSales Invoice Item` sii
			JOIN `tabSales Invoice` si ON si.name = sii.parent
			WHERE si.docstatus = 1 AND IFNULL(si.is_return, 0) = 0 AND sii.dn_detail IN %(n)s GROUP BY sii.dn_detail""", {"n": names}, as_dict=1)}
	drafts = {}
	for r in frappe.db.sql("""SELECT sii.dn_detail, sii.parent FROM `tabSales Invoice Item` sii
			JOIN `tabSales Invoice` si ON si.name = sii.parent
			WHERE si.docstatus = 0 AND IFNULL(si.is_return, 0) = 0 AND sii.dn_detail IN %(n)s""", {"n": names}, as_dict=1):
		drafts.setdefault(r.dn_detail, r.parent)
	by_dn = {d.name: d for d in dns}
	out, maps = [], {}
	for it in items:
		if it.parent not in maps:
			maps[it.parent] = get_returned_qty_map(it.parent)
		invoiced, returned = billed.get(it.name, 0), flt(maps[it.parent].get(it.name))
		pending = flt(it.qty) - invoiced - returned
		if pending <= 0.0005:
			continue
		dn = by_dn[it.parent]
		out.append({
			"dn_detail": it.name, "delivery_note": it.parent, "posting_date": dn.posting_date, "currency": dn.currency,
			"company": dn.company, "po_no": dn.po_no, "customer_name": dn.customer_name, "sales_order": it.against_sales_order, "item_code": it.item_code,
			"item_name": it.item_name, "uom": it.uom, "rate": flt(it.rate), "delivered": flt(it.qty),
			"invoiced": invoiced, "returned": returned, "pending": pending, "amount": pending * flt(it.rate),
			"draft": drafts.get(it.name),
		})
	return out


@frappe.whitelist()
def billing_hint(customer):
	"""Orders of this customer picked but not delivered yet — they need their Delivery Note first."""
	if not customer:
		return 0
	return cint(frappe.db.sql("""SELECT COUNT(DISTINCT pl.name) FROM `tabPick List` pl
		JOIN `tabPick List Item` pli ON pli.parent = pl.name
		JOIN `tabSales Order` so ON so.name = pli.sales_order
		WHERE pl.docstatus = 1 AND pl.status IN ('Open', 'Partly Delivered') AND so.customer = %s""", customer)[0][0])
