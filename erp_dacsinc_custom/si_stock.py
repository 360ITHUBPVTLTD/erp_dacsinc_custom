"""Sales Invoice › Update Stock follows where the goods went out (docs/returns.md › Update Stock).

A normal Sales Invoice's Update Stock is read-only (Property Setter: editable only on a return); this
sets it on every save of a draft:
- a **direct** invoice — no stock line comes from a Delivery Note (a counter / POS-style sale, or billed
  straight from a Sales Order or Pick List) — **ticks** it: the goods leave the warehouse with the
  invoice. A stock line without a warehouse gets the invoice's Set Warehouse, else the item's default,
  else Stock Settings' default;
- an invoice **made from Delivery Notes** **unticks** it: the Delivery Note already moved the stock;
- an invoice that **mixes** both is refused — part would go out twice or not at all;
- only service / charge lines (no stock item, no product bundle): unticked, nothing moves.
Returns (Credit Notes) keep their own Update Stock choice; POS invoices are left to POS.
"""

import frappe
from frappe import _
from frappe.utils import cint


def _moves_stock(item_code):
	return bool(cint(frappe.get_cached_value("Item", item_code, "is_stock_item"))
				or frappe.db.exists("Product Bundle", {"new_item_code": item_code, "disabled": 0}))


def set_update_stock(doc, method=None):
	if doc.doctype != "Sales Invoice" or cint(doc.docstatus) != 0 or cint(doc.get("is_return")) or cint(doc.get("is_pos")):
		return
	stock = [r for r in doc.get("items") or [] if r.item_code and _moves_stock(r.item_code)]
	from_dn = [r for r in stock if r.get("delivery_note") or r.get("dn_detail")]
	direct = [r for r in stock if not (r.get("delivery_note") or r.get("dn_detail"))]
	if from_dn and direct:
		frappe.throw(_("Row(s) {0} come from a Delivery Note, row(s) {1} do not. A Delivery Note already moved its "
					   "goods; the others would move with this invoice. Bill them separately (one invoice from the "
					   "Delivery Notes, one direct), or make a Delivery Note for the others first.").format(
			", ".join(str(r.idx) for r in from_dn), ", ".join(str(r.idx) for r in direct)),
			title=_("Delivery Note and direct lines together"))
	want = 1 if direct else 0
	if cint(doc.update_stock) != want:
		doc.update_stock = want
		frappe.msgprint(_("Update Stock ticked — a direct invoice: the goods leave the warehouse with it.") if want
						else _("Update Stock unticked — the Delivery Note already moved the goods."),
						indicator="blue", alert=True)
	if want:
		default = doc.get("set_warehouse") or frappe.db.get_single_value("Stock Settings", "default_warehouse")
		for r in direct:
			if not r.get("warehouse"):
				r.warehouse = frappe.db.get_value("Item Default", {"parent": r.item_code, "company": doc.company},
												  "default_warehouse") or default
