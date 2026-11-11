"""Order Flow › Kits tab: make kits from separate items, and break them back (docs/kits.md).

Make Kit: the user picks the kit item (stock goes UP), how many kits, and the parts with their qty
in ONE kit (e.g. 2 Shirt + 1 Pant + 1 Shoe; stock goes DOWN by qty-per-kit × kits). Break Kit is
the reverse. Each is one submitted Repack Stock Entry, typed "Make Kit" / "Break Kit" (Stock Entry
Types with purpose Repack, made on first use) — the tab lists those.

Only free stock can be used (stock held for Sales Orders is not free — uniform_transfer_api.
_free_stock), no override. Valuation: Make Kit — ERPNext's Repack puts the parts' value on the kit.
Break Kit — several different items come in, which ERPNext's Repack cannot rate by itself, so the
kits' value is split over the parts in proportion to each part's current valuation (qty when none
has a valuation), and the stock value stays the same.
"""
import json

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from erp_dacsinc_custom.order_flow_permissions import guard_act, guard_tab
from erp_dacsinc_custom.order_flow_api import _paged_query, _attach_creator_names

TAB = "kit"
MAKE, BREAK = "Make Kit", "Break Kit"
DEFAULT_WAREHOUSE = KIT_WAREHOUSE = "VV Puram - IND"  # kits are made / broken here only
CANCEL_REASON = "Kit cancel reason: "


def _ensure_types():
	for name in (MAKE, BREAK):
		if not frappe.db.exists("Stock Entry Type", name):
			frappe.get_doc({"doctype": "Stock Entry Type", "name": name, "__newname": name,
			                "purpose": "Repack"}).insert(ignore_permissions=True)


def _check_item(item, what):
	"""A plain stock item: enabled, not a template, no serial / batch numbers (not handled here)."""
	d = frappe.db.get_value("Item", item, ["is_stock_item", "disabled", "has_variants", "has_serial_no", "has_batch_no"],
	                        as_dict=1)
	if not d:
		frappe.throw(_("{0} {1} does not exist.").format(what, item))
	if not d.is_stock_item:
		frappe.throw(_("{0} {1} is not a stock item.").format(what, item))
	if d.disabled:
		frappe.throw(_("{0} {1} is disabled.").format(what, item))
	if d.has_variants:
		frappe.throw(_("{0} {1} is a template — choose one of its variants.").format(what, item))
	if d.has_serial_no or d.has_batch_no:
		frappe.throw(_("{0} {1} has serial / batch numbers — make that kit as a Repack Stock Entry by hand.").format(what, item))


def _clean_parts(parts, kit_item):
	parts = json.loads(parts) if isinstance(parts, str) else (parts or [])
	out, seen = [], set()
	for n, p in enumerate(parts, 1):
		item, q = (p.get("item_code") or "").strip(), flt(p.get("qty_per_kit"))
		if not item and not q:
			continue
		if not item:
			frappe.throw(_("Part line {0}: choose the item.").format(n))
		if q <= 0:
			frappe.throw(_("Part line {0} ({1}): enter the qty in one kit.").format(n, item))
		if item == kit_item:
			frappe.throw(_("{0} is the kit item itself — it cannot also be a part.").format(item))
		if item in seen:
			frappe.throw(_("{0} is added twice — put its total qty per kit on one line.").format(item))
		_check_item(item, _("Part"))
		seen.add(item)
		out.append({"item_code": item, "qty_per_kit": q})
	if not out:
		frappe.throw(_("Add at least one part."))
	return out


def _check_free(needs, warehouse):
	"""needs: {item: qty}. Throws listing every item short of FREE stock."""
	from erp_dacsinc_custom.uniform_transfer_api import _free_stock
	short = []
	for item, q in needs.items():
		actual, held, free, _h = _free_stock(item, warehouse)
		if q - free > 0.0005:
			short.append(_("{0}: needs {1}, only {2} free in {3} (on hand {4}, held for Sales Orders {5})").format(
				item, flt(q, 3), free, warehouse, actual, held))
	if short:
		frappe.throw("<br>".join(short), title=_("Not enough free stock"))


def _new_entry(stock_entry_type, warehouse):
	se = frappe.new_doc("Stock Entry")
	se.stock_entry_type, se.purpose, se.posting_date = stock_entry_type, "Repack", nowdate()
	se.company = frappe.db.get_value("Warehouse", warehouse, "company")
	return se


def _uom(item):
	return frappe.db.get_value("Item", item, "stock_uom")


def _remark(action, kit_item, kits, parts, notes):
	recipe = " + ".join(f"{flt(p['qty_per_kit'])} × {p['item_code']}" for p in parts)
	text = f"{action}: {flt(kits)} × {kit_item} — one kit = {recipe}"
	return text + (f"\n{notes}" if notes else "")


def _qty(item, warehouse):
	return flt(frappe.db.get_value("Bin", {"item_code": item, "warehouse": warehouse}, "actual_qty"))


def _who():
	return frappe.utils.get_fullname(frappe.session.user)


def _history(se, action, lines, note=None):
	"""Dated history comment on the Stock Entry AND on the kit item (survives a later delete):
	who, what, and each item's stock before → after. lines: [(item, change, before)]."""
	rows = "".join(
		f"<tr><td>{frappe.utils.escape_html(i)}</td><td style='text-align:right'>{'+' if c > 0 else ''}{flt(c, 3)}</td>"
		f"<td style='text-align:right'>{flt(b, 3)} → {flt(b + c, 3)}</td></tr>" for i, c, b in lines)
	text = (f"<b>{action}</b> — {frappe.utils.escape_html(_who())} on {frappe.utils.format_datetime(frappe.utils.now_datetime())}"
	        f" · {frappe.utils.escape_html(se.name)} · {frappe.utils.escape_html(lines and _warehouse_of(se) or '')}"
	        f"{('<br>' + frappe.utils.escape_html(note)) if note else ''}"
	        f"<table class='table table-bordered' style='margin-top:6px'><tr><th>Item</th><th>Change</th><th>Stock (before → after)</th></tr>{rows}</table>")
	se.add_comment("Comment", text)
	kit = _kit_item_of(se)
	if kit:
		frappe.get_doc("Item", kit).add_comment("Comment", text)


def _warehouse_of(se):
	for d in se.items:
		return d.s_warehouse or d.t_warehouse
	return ""


def _kit_item_of(se):
	"""Make Kit: the item coming in; Break Kit: the item going out."""
	for d in se.items:
		if (se.stock_entry_type == MAKE and d.t_warehouse) or (se.stock_entry_type == BREAK and d.s_warehouse):
			return d.item_code
	return None


def _lines(se, sign=1):
	"""[(item, change, stock now)] from the entry's rows (sign -1: the reversal of a cancel)."""
	wh = _warehouse_of(se)
	return [(d.item_code, sign * (flt(d.transfer_qty or d.qty) if d.t_warehouse else -flt(d.transfer_qty or d.qty)),
	         _qty(d.item_code, wh)) for d in se.items]


def _validate_common(kit_item, kits, warehouse):
	guard_tab(TAB)
	guard_act(TAB)
	kits = flt(kits)
	if not kit_item:
		frappe.throw(_("Choose the kit item."))
	_check_item(kit_item, _("Kit item"))
	if kits <= 0:
		frappe.throw(_("Enter how many kits."))
	if (warehouse or KIT_WAREHOUSE) != KIT_WAREHOUSE:
		frappe.throw(_("Kits are made and broken at {0} only.").format(KIT_WAREHOUSE))
	return kits


@frappe.whitelist()
def make_kit(kit_item, kits, parts, warehouse=DEFAULT_WAREHOUSE, notes=None):
	"""Parts out of `warehouse` (qty_per_kit × kits each), `kits` × kit_item into it. Submitted."""
	kits = _validate_common(kit_item, kits, warehouse)
	warehouse = KIT_WAREHOUSE
	parts = _clean_parts(parts, kit_item)
	_check_free({p["item_code"]: p["qty_per_kit"] * kits for p in parts}, warehouse)
	_ensure_types()
	se = _new_entry(MAKE, warehouse)
	for p in parts:
		se.append("items", {"item_code": p["item_code"], "qty": flt(p["qty_per_kit"] * kits, 6),
		                    "s_warehouse": warehouse, "uom": _uom(p["item_code"])})
	se.append("items", {"item_code": kit_item, "qty": kits, "t_warehouse": warehouse, "uom": _uom(kit_item)})
	se.remarks = _remark(MAKE, kit_item, kits, parts, notes)
	se.insert()
	kit_row = se.items[-1]
	if flt(kit_row.basic_amount) <= 0:
		# parts carried no value (stock loaded at 0): the kit comes in at 0 too, allowed explicitly
		kit_row.allow_zero_valuation_rate = 1
		se.save()
	before = _lines(se)
	se.submit()
	_history(se, _("Kit made: {0} × {1}").format(flt(kits), kit_item), before, notes)
	return {"stock_entry": se.name}


@frappe.whitelist()
def break_kit(kit_item, kits, parts, warehouse=DEFAULT_WAREHOUSE, notes=None):
	"""`kits` × kit_item out of `warehouse`, the parts (qty_per_kit × kits each) into it. Submitted.
	The kits' value is split over the parts (module doc)."""
	kits = _validate_common(kit_item, kits, warehouse)
	warehouse = KIT_WAREHOUSE
	parts = _clean_parts(parts, kit_item)
	_check_free({kit_item: kits}, warehouse)
	_ensure_types()

	weights = []
	for p in parts:
		rate = flt(frappe.db.get_value("Bin", {"item_code": p["item_code"], "warehouse": warehouse}, "valuation_rate")) \
			or flt(frappe.db.get_value("Item", p["item_code"], "valuation_rate"))
		weights.append(rate * p["qty_per_kit"])
	if not sum(weights):
		weights = [p["qty_per_kit"] for p in parts]

	se = _new_entry(BREAK, warehouse)
	se.append("items", {"item_code": kit_item, "qty": kits, "s_warehouse": warehouse, "uom": _uom(kit_item)})
	for p in parts:
		se.append("items", {"item_code": p["item_code"], "qty": flt(p["qty_per_kit"] * kits, 6), "t_warehouse": warehouse,
		                    "uom": _uom(p["item_code"]), "set_basic_rate_manually": 1, "basic_rate": 0})
	se.remarks = _remark(BREAK, kit_item, kits, parts, notes)
	se.insert()  # ERPNext works out the kits' real outgoing value (FIFO / moving average) here
	_split_value(se, weights)
	se.save()
	before = _lines(se)
	se.submit()
	_history(se, _("Kit broken: {0} × {1}").format(flt(kits), kit_item), before, notes)
	return {"stock_entry": se.name}


def _split_value(se, weights):
	"""Spread the kit row's outgoing value over the part rows by `weights`, to the paisa: amounts
	rounded to the currency, the last part takes the remainder, so value in = value out and nothing
	goes to Stock Adjustment. Zero value (kits stocked at 0): the parts come in at 0, allowed."""
	kit_row, part_rows = se.items[0], se.items[1:]
	value = flt(kit_row.basic_amount, 2)
	total_w = sum(weights) or 1
	left = value
	for n, (row, w) in enumerate(zip(part_rows, weights)):
		amount = left if n == len(part_rows) - 1 else flt(value * w / total_w, 2)
		left = flt(left - amount, 2)
		row.set_basic_rate_manually = 1
		row.basic_rate = flt(amount / flt(row.transfer_qty or row.qty), 9) if amount else 0
		# ERPNext skips the amount of a manually rated row; set it, or the entry shows 0 for the parts
		row.basic_amount = amount
		row.allow_zero_valuation_rate = 0 if amount else 1


@frappe.whitelist()
def last_recipe(kit_item):
	"""Parts per kit of the latest Make Kit for this item — Break Kit fills its lines from it."""
	guard_tab(TAB)
	se = frappe.db.sql("""
		SELECT se.name FROM `tabStock Entry` se JOIN `tabStock Entry Detail` d ON d.parent = se.name
		WHERE se.stock_entry_type = %s AND se.docstatus = 1 AND d.item_code = %s AND IFNULL(d.t_warehouse, '') != ''
		ORDER BY se.posting_date DESC, se.creation DESC LIMIT 1""", (MAKE, kit_item))
	if not se:
		return []
	rows = frappe.get_all("Stock Entry Detail", filters={"parent": se[0][0]},
	                      fields=["item_code", "qty", "s_warehouse", "t_warehouse"], order_by="idx asc")
	kits = sum(flt(r.qty) for r in rows if r.t_warehouse and r.item_code == kit_item) or 1
	return [{"item_code": r.item_code, "qty_per_kit": flt(r.qty / kits, 6)} for r in rows if r.s_warehouse]


@frappe.whitelist()
def get_item_stock(item_code, warehouse=DEFAULT_WAREHOUSE):
	"""On hand / held for Sales Orders / free, for the Kits dialogs."""
	guard_tab(TAB)
	from erp_dacsinc_custom.uniform_transfer_api import _free_stock
	actual, held, free, holds = _free_stock(item_code, warehouse)
	return {"actual_qty": actual, "held_qty": held, "net_available": free, "holds": holds, "stock_uom": _uom(item_code),
	        "valuation_rate": flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "valuation_rate"))
	        or flt(frappe.db.get_value("Item", item_code, "valuation_rate"))}


@frappe.whitelist()
def get_kit_entries(search=None, scope=None, page=1, page_size=100, kind=None, **kwargs):
	"""The tab's list: Make Kit / Break Kit Stock Entries, newest first, each with its kit item, kits
	and parts. `kind`: make / break; scope "mine": made by me; the page's custom date range applies."""
	guard_tab(TAB)
	conditions = ["se.stock_entry_type IN (%(make)s, %(break)s)"]
	values = {"make": MAKE, "break": BREAK}
	if kind in ("make", "break"):
		conditions.append("se.stock_entry_type = %(kind)s")
		values["kind"] = MAKE if kind == "make" else BREAK
	if scope == "mine":
		conditions.append("se.owner = %(me)s")
		values["me"] = frappe.session.user
	if search:
		conditions.append("""(se.name LIKE %(search)s OR EXISTS (SELECT 1 FROM `tabStock Entry Detail` d
		    WHERE d.parent = se.name AND (d.item_code LIKE %(search)s OR d.item_name LIKE %(search)s)))""")
		values["search"] = f"%{search}%"
	days = kwargs.get("days")
	if days and "~" in str(days):
		from erp_dacsinc_custom.order_flow_api import _from_date, _to_next
		conditions.append("se.posting_date >= %(from_date)s AND se.posting_date < %(to_next)s")
		values["from_date"], values["to_next"] = _from_date(days), _to_next(days)

	out = _paged_query(f"""
		SELECT se.name, se.stock_entry_type, se.posting_date, se.docstatus, se.owner, se.remarks, se.modified, se.modified_by
		FROM `tabStock Entry` se
		WHERE {' AND '.join(conditions)}
		ORDER BY se.posting_date DESC, se.creation DESC
	""", values, page, page_size)
	names = [r.name for r in out["rows"]]
	lines = {}
	if names:
		for d in frappe.get_all("Stock Entry Detail", filters={"parent": ["in", names]},
		                        fields=["parent", "item_code", "item_name", "qty", "uom", "s_warehouse", "t_warehouse"],
		                        order_by="idx asc"):
			lines.setdefault(d.parent, []).append(d)
	for r in out["rows"]:
		is_make = r.stock_entry_type == MAKE
		ls = lines.get(r.name, [])
		kit = [d for d in ls if (d.t_warehouse if is_make else d.s_warehouse)]
		part_rows = [d for d in ls if (d.s_warehouse if is_make else d.t_warehouse)]
		r["kind"] = "make" if is_make else "break"
		r["kit_item"] = kit[0].item_code if kit else ""
		r["kit_item_name"] = kit[0].item_name if kit else ""
		r["kits"] = flt(sum(flt(d.qty) for d in kit))
		r["uom"] = kit[0].uom if kit else ""
		r["warehouse"] = (kit[0].t_warehouse or kit[0].s_warehouse) if kit else ""
		r["can_cancel"] = 1 if r.docstatus == 1 and frappe.has_permission("Stock Entry", "cancel", r.name) else 0
		r["can_delete"] = 1 if r.docstatus == 2 and frappe.has_permission("Stock Entry", "delete", r.name) else 0
		r["parts"] = [{"item_code": d.item_code, "item_name": d.item_name, "qty": flt(d.qty), "uom": d.uom,
		               "qty_per_kit": flt(flt(d.qty) / r["kits"], 6) if r["kits"] else 0} for d in part_rows]
	for r in out["rows"]:
		if r.docstatus == 2:
			r["cancelled_by"] = frappe.utils.get_fullname(r.modified_by)
			c = frappe.db.sql("""SELECT content FROM `tabComment` WHERE reference_doctype = 'Stock Entry'
				AND reference_name = %s AND comment_type = 'Info' AND content LIKE %s
				ORDER BY creation DESC LIMIT 1""", (r.name, CANCEL_REASON + "%"))
			r["cancel_reason"] = c[0][0][len(CANCEL_REASON):] if c else ""
	_attach_creator_names(out["rows"])
	return out


def _kit_entry(name):
	se = frappe.get_doc("Stock Entry", name)
	if se.stock_entry_type not in (MAKE, BREAK):
		frappe.throw(_("{0} is not a Make Kit / Break Kit entry.").format(name))
	return se


@frappe.whitelist()
def cancel_kit(name, reason):
	"""Cancel a Make Kit / Break Kit entry: ERPNext reverses its stock (and refuses when that would make
	stock negative — e.g. kits already sold or broken). The reason goes into the history."""
	guard_tab(TAB)
	guard_act(TAB)
	reason = (reason or "").strip()
	if not reason:
		frappe.throw(_("Give the reason for cancelling."))
	se = _kit_entry(name)
	if se.docstatus != 1:
		frappe.throw(_("{0} is not submitted — nothing to cancel.").format(name))
	se.check_permission("cancel")
	before = _lines(se, -1)
	se.flags.kit_cancel_reason = reason
	se.cancel()
	_history(se, _("Cancelled — stock reversed"), before, _("Reason: {0}").format(reason))
	se.add_comment("Info", CANCEL_REASON + reason)  # read back by the tab's list
	return {"stock_entry": se.name}


@frappe.whitelist()
def delete_kit(name):
	"""Delete a CANCELLED Make Kit / Break Kit entry (a submitted one is cancelled first, so its stock is
	reversed). Frappe keeps a copy in Deleted Documents; the history stays on the kit item."""
	guard_tab(TAB)
	guard_act(TAB)
	se = _kit_entry(name)
	if se.docstatus == 1:
		frappe.throw(_("{0} is submitted — cancel it first (that reverses the stock), then delete.").format(name))
	se.check_permission("delete")
	kit = _kit_item_of(se)
	if kit:
		frappe.get_doc("Item", kit).add_comment("Comment", _("<b>Deleted</b> {0} ({1}) — {2} on {3}").format(
			frappe.utils.escape_html(name), se.stock_entry_type, frappe.utils.escape_html(_who()),
			frappe.utils.format_datetime(frappe.utils.now_datetime())))
	frappe.delete_doc("Stock Entry", name)
	return {"deleted": name}


def on_cancel_comment(doc, method=None):
	"""Stock Entry on_cancel: a kit entry cancelled from its own form (not from the tab, which writes its
	own history with the reason) still gets a history line."""
	if doc.stock_entry_type in (MAKE, BREAK) and not doc.flags.get("kit_cancel_reason"):
		# runs after the stock is reversed: "now" is the after-figure, so before = now − change
		lines = [(i, c, now - c) for i, c, now in _lines(doc, -1)]
		_history(doc, _("Cancelled from the Stock Entry form — stock reversed"), lines)
