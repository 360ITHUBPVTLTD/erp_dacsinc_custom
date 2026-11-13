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
POS invoices are left to POS.

A return (Credit Note, Is Return) follows the same rule, the goods coming BACK (set_return_update_stock):
- made from an invoice billed from Delivery Notes (lines carry the DN line): **unticked** — ERPNext can't
  update stock there; the goods come back through "Update Stock (return the goods)" / Make Sales Return
  (return_goods.py), which returns them against the Delivery Note;
- made from a direct invoice: **as that invoice** — ticked when its goods left with it (they come back at
  the original cost, ERPNext's incoming_rate from the invoice), unticked when they did not;
- made directly (Sales Invoice › Is Return, no Return Against) with stock items: **ticked** — the goods come
  back into the line's warehouse (Set Warehouse, else the item's default, else Stock Settings'), valued by
  ERPNext at the warehouse's valuation rate;
- Delivery Note lines and direct lines together: refused; only service / charge lines: unticked.
"""

import frappe
from frappe import _
from frappe.utils import cint


def _moves_stock(item_code):
	return bool(cint(frappe.get_cached_value("Item", item_code, "is_stock_item"))
				or frappe.db.exists("Product Bundle", {"new_item_code": item_code, "disabled": 0}))


def _default_warehouse(doc, rows):
	default = doc.get("set_warehouse") or frappe.db.get_single_value("Stock Settings", "default_warehouse")
	for r in rows:
		if not r.get("warehouse"):
			r.warehouse = frappe.db.get_value("Item Default", {"parent": r.item_code, "company": doc.company},
											  "default_warehouse") or default


def set_return_update_stock(doc):
	stock = [r for r in doc.get("items") or [] if r.item_code and _moves_stock(r.item_code)]
	from_dn = [r for r in stock if r.get("delivery_note") or r.get("dn_detail")]
	direct = [r for r in stock if not (r.get("delivery_note") or r.get("dn_detail"))]
	if from_dn and direct:
		frappe.throw(_("Row(s) {0} were billed from a Delivery Note, row(s) {1} were not. Goods billed from a Delivery "
					   "Note come back with a Sales Return against it; the others would come back with this note. "
					   "Make separate Credit Notes.").format(
			", ".join(str(r.idx) for r in from_dn), ", ".join(str(r.idx) for r in direct)),
			title=_("Delivery Note and direct lines together"))
	if not direct:
		want, why = 0, (_("Update Stock unticked — these goods went out with a Delivery Note; they come back with "
						  "'Update Stock (return the goods)' / Make Sales Return.") if from_dn else
						_("Update Stock unticked — no stock item on this note."))
	elif doc.get("return_against"):
		want = cint(frappe.db.get_value("Sales Invoice", doc.return_against, "update_stock"))
		why = (_("Update Stock ticked — {0} took the goods out of stock; they come back with this note.") if want else
			   _("Update Stock unticked — {0} did not move stock, so this note doesn't either.")).format(doc.return_against)
	else:
		want, why = 1, _("Update Stock ticked — a direct return: the goods come back into stock with this note.")
	if cint(doc.update_stock) != want:
		doc.update_stock = want
		frappe.msgprint(why, indicator="blue", alert=True)
	if want:
		_default_warehouse(doc, direct)


def set_update_stock(doc, method=None):
	if doc.doctype != "Sales Invoice" or cint(doc.docstatus) != 0 or cint(doc.get("is_pos")):
		return
	if cint(doc.get("is_return")):
		return set_return_update_stock(doc)
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
		_default_warehouse(doc, direct)
