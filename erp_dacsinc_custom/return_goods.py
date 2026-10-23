"""Returns: the goods side and the money side, kept together.

A return is two documents in ERPNext: the goods (Sales Return = Delivery Note is_return /
Purchase Return = Purchase Receipt is_return) and the money (Credit Note = Sales Invoice
is_return / Debit Note = Purchase Invoice is_return). An invoice billed from a Delivery Note /
Purchase Receipt can't move stock itself (ERPNext hides Update Stock on it and on its notes), so
its Credit / Debit Note never brings the goods back — the Sales / Purchase Return must.

Matching. Both halves point at the ORIGINAL Delivery Note / Purchase Receipt line:

    Credit Note line  .dn_detail               Sales Return line    .dn_detail
    Debit Note line   .pr_detail               Purchase Return line .purchase_receipt_item

(a note made from a return's line — ERPNext's own button — points at the return's line, which is
resolved to the original and counts as linked to that return). Per original line, the notes' qty
and the returns' qty are paired: first the pairs that belong together — a return made for a note
(its custom_against_note) or the return a note names (custom_goods_return) — then whatever is
left, oldest first. So one note's return never covers another note's shortfall.

Rule (agreed 2026-10-23): never blocks. The missing half shows as "Stock not returned" /
"Credit Note not made" with a button that makes it (only the items and qty missing), on the forms
and on Order Flow › Finance › Returns / Notes. A note billed from a DN / PR may instead tick
"Update Stock (return the goods)": its Submit makes and submits the return (on_note_submit).
"""

from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt

NOTE = {  # money document → its goods document
	"Sales Invoice": {
		"goods": "Delivery Note", "goods_item": "Delivery Note Item", "note_item": "Sales Invoice Item",
		"note_key": "dn_detail", "goods_key": "dn_detail", "goods_label": _("Sales Return"), "note_label": _("Credit Note"),
	},
	"Purchase Invoice": {
		"goods": "Purchase Receipt", "goods_item": "Purchase Receipt Item", "note_item": "Purchase Invoice Item",
		"note_key": "pr_detail", "goods_key": "purchase_receipt_item", "goods_label": _("Purchase Return"), "note_label": _("Debit Note"),
	},
}
GOODS = {c["goods"]: n for n, c in NOTE.items()}  # goods document → its money document
EPS = 0.0005


def _stock_items(item_codes):
	if not item_codes:
		return set()
	return set(frappe.get_all("Item", filters={"name": ["in", list(item_codes)], "is_stock_item": 1}, pluck="name"))


def _resolve(note_dt, keys):
	"""A note line's key → (original goods line, the return document it came through or None)."""
	c = NOTE[note_dt]
	keys = [k for k in set(keys) if k]
	out = {k: (k, None) for k in keys}
	if keys:
		for r in frappe.db.sql(f"""SELECT gi.name, gi.parent, gi.{c['goods_key']} AS orig FROM `tab{c['goods_item']}` gi
				JOIN `tab{c['goods']}` g ON g.name = gi.parent WHERE gi.name IN %(k)s AND g.is_return = 1""",
							   {"k": tuple(keys)}, as_dict=1):
			if r.orig:
				out[r.name] = (r.orig, r.parent)
	return out


def _lines(note_dt, orig_keys):
	"""Every note and every goods return on these original lines (stock items only):
	notes[k] / goods[k] = {name: {name, docstatus, qty, order}} (qty positive, summed per document),
	links = {(note, return)} that belong together."""
	c = NOTE[note_dt]
	orig_keys = tuple(set(k for k in orig_keys if k))
	notes, goods, links = defaultdict(dict), defaultdict(dict), set()
	if not orig_keys:
		return notes, goods, links
	for r in frappe.db.sql(f"""SELECT gi.{c['goods_key']} AS k, g.name, g.docstatus, g.posting_date, g.creation,
				IFNULL(g.custom_against_note, '') AS note, SUM(ABS(gi.stock_qty)) AS q
			FROM `tab{c['goods_item']}` gi JOIN `tab{c['goods']}` g ON g.name = gi.parent
			WHERE g.is_return = 1 AND g.docstatus < 2 AND gi.{c['goods_key']} IN %(k)s
			GROUP BY gi.{c['goods_key']}, g.name""", {"k": orig_keys}, as_dict=1):
		goods[r.k][r.name] = {"name": r.name, "docstatus": cint(r.docstatus), "qty": flt(r.q), "order": (cstr(r.posting_date), cstr(r.creation))}
		if r.note:
			links.add((r.note, r.name))
	ret_lines = {r.name: (r.orig, r.parent) for r in frappe.db.sql(f"""SELECT gi.name, gi.parent, gi.{c['goods_key']} AS orig
			FROM `tab{c['goods_item']}` gi JOIN `tab{c['goods']}` g ON g.name = gi.parent
			WHERE g.is_return = 1 AND gi.{c['goods_key']} IN %(k)s""", {"k": orig_keys}, as_dict=1)}
	for r in frappe.db.sql(f"""SELECT ni.{c['note_key']} AS k, n.name, n.docstatus, n.posting_date, n.creation,
				IFNULL(n.custom_goods_return, '') AS ret, SUM(ABS(ni.stock_qty)) AS q
			FROM `tab{c['note_item']}` ni JOIN `tab{note_dt}` n ON n.name = ni.parent
			JOIN `tabItem` it ON it.name = ni.item_code AND it.is_stock_item = 1
			WHERE n.is_return = 1 AND n.docstatus < 2 AND IFNULL(n.update_stock, 0) = 0 AND ni.{c['note_key']} IN %(k)s
			GROUP BY ni.{c['note_key']}, n.name""", {"k": orig_keys + tuple(ret_lines)}, as_dict=1):
		k, via = ret_lines.get(r.k, (r.k, None))
		x = notes[k].setdefault(r.name, {"name": r.name, "docstatus": cint(r.docstatus), "qty": 0.0, "order": (cstr(r.posting_date), cstr(r.creation))})
		x["qty"] += flt(r.q)
		if via:
			links.add((r.name, via))
		for ret in cstr(r.ret).split(","):
			if ret.strip():
				links.add((r.name, ret.strip()))
	return notes, goods, links


def _match(needs, supplies, linked, need_is_note):
	"""Pair qty: linked pairs first, then oldest first. Returns ({need: qty}, {supply: qty}, {(need, supply)})."""
	got, used, pairs = defaultdict(float), defaultdict(float), set()
	needs = sorted(needs, key=lambda x: x["order"])
	supplies = sorted(supplies, key=lambda x: x["order"])
	for only_linked in (True, False):
		for n in needs:
			for s in supplies:
				pair = (n["name"], s["name"]) if need_is_note else (s["name"], n["name"])
				if only_linked and pair not in linked:
					continue
				a = min(n["qty"] - got[n["name"]], s["qty"] - used[s["name"]])
				if a > EPS:
					got[n["name"]] += a
					used[s["name"]] += a
					pairs.add((n["name"], s["name"]))
	return got, used, pairs


def note_goods(note_dt, names):
	"""Goods status of Credit / Debit Notes: {name: {status, text, docs, missing}}.

	status: self (the note moved the stock — Update Stock), none (no stock item), unlinked (stock
	items not billed from a Delivery Note / Purchase Receipt, and no Update Stock), done, draft (a
	draft return covers it), pending (stock not returned). missing = {original line: qty}."""
	c = NOTE[note_dt]
	out = {}
	docs = frappe.get_all(note_dt, filters={"name": ["in", list(names)], "is_return": 1},
						  fields=["name", "docstatus", "update_stock"]) if names else []
	rows = frappe.get_all(c["note_item"], filters={"parent": ["in", [d.name for d in docs]], "parenttype": note_dt},
						  fields=["parent", "item_code", c["note_key"] + " AS k"]) if docs else []
	stock = _stock_items({r.item_code for r in rows})
	rows = [r for r in rows if r.item_code in stock]
	resolved = _resolve(note_dt, [r.k for r in rows])
	notes, goods, links = _lines(note_dt, [v[0] for v in resolved.values()])
	for d in docs:
		mine = [r for r in rows if r.parent == d.name]
		if cint(d.update_stock):
			out[d.name] = {"status": "self", "text": _("Returned by this note (Update Stock)"), "docs": []}
			continue
		if not mine:
			out[d.name] = {"status": "none", "text": _("No stock item — nothing to return to the store"), "docs": []}
			continue
		keys = {resolved[r.k][0] for r in mine if r.k}
		if not keys:
			out[d.name] = {"status": "unlinked", "docs": [],
						   "text": _("Stock items not billed from a {0}: before submitting, tick Update Stock to bring them back").format(_(c["goods"]))}
			continue
		missing, short_sub, docs_ = {}, False, set()
		for k in keys:
			need = notes[k].get(d.name, {}).get("qty", 0)
			sub = [g for g in goods[k].values() if g["docstatus"] == 1]
			got_sub = _match(list(notes[k].values()), sub, links, True)[0]
			got_all, _used, pairs = _match(list(notes[k].values()), list(goods[k].values()), links, True)
			docs_ |= {(s, goods[k][s]["docstatus"]) for n, s in pairs if n == d.name}
			if need - got_sub[d.name] > EPS:
				short_sub = True
			if need - got_all[d.name] > EPS:
				missing[k] = need - got_all[d.name]
		names_ = ", ".join(sorted(x[0] for x in docs_))
		if not short_sub:
			st, text = "done", _("Back in stock — {0}").format(names_)
		elif not missing:
			st, text = "draft", _("{0} made but still a draft — the store must submit it: {1}").format(c["goods_label"], names_)
		else:
			st, text = "pending", _("Make the {0} so the goods come back into the store").format(c["goods_label"])
		out[d.name] = {"status": st, "text": text, "missing": missing,
					   "docs": [{"name": x[0], "docstatus": x[1]} for x in sorted(docs_)]}
	return out


def _billed(note_dt, orig_keys):
	"""Per original goods line: qty billed on ordinary submitted invoices (what a note can credit)."""
	c = NOTE[note_dt]
	if not orig_keys:
		return {}
	return {r.k: flt(r.q) for r in frappe.db.sql(f"""SELECT ni.{c['note_key']} AS k, SUM(ni.stock_qty) AS q
			FROM `tab{c['note_item']}` ni JOIN `tab{note_dt}` n ON n.name = ni.parent
			WHERE n.is_return = 0 AND n.docstatus = 1 AND ni.{c['note_key']} IN %(k)s
			GROUP BY ni.{c['note_key']}""", {"k": tuple(set(orig_keys))}, as_dict=1)}


def goods_credit(goods_dt, names):
	"""Money status of Sales / Purchase Returns: {name: {status, text, docs, missing}}.

	status: not_billed (the original goods were never invoiced — no note needed), done, draft,
	pending (Credit / Debit Note still to make)."""
	note_dt = GOODS[goods_dt]
	c = NOTE[note_dt]
	out = {}
	docs = frappe.get_all(goods_dt, filters={"name": ["in", list(names)], "is_return": 1}, fields=["name", "docstatus"]) if names else []
	rows = frappe.get_all(c["goods_item"], filters={"parent": ["in", [d.name for d in docs]], "parenttype": goods_dt},
						  fields=["parent", "item_code", c["goods_key"] + " AS k"]) if docs else []
	stock = _stock_items({r.item_code for r in rows})
	rows = [r for r in rows if r.item_code in stock and r.k]
	keys_all = {r.k for r in rows}
	notes, goods, links = _lines(note_dt, keys_all)
	billed = _billed(note_dt, keys_all)
	for d in docs:
		keys = {r.k for r in rows if r.parent == d.name and billed.get(r.k, 0) > EPS}
		if not keys:
			out[d.name] = {"status": "not_billed", "docs": [],
						   "text": _("The goods were not invoiced yet — no {0} needed; they simply won't be billed").format(c["note_label"])}
			continue
		missing, short_sub, docs_ = {}, False, set()
		for k in keys:
			need = goods[k].get(d.name, {}).get("qty", 0)
			sub = [n for n in notes[k].values() if n["docstatus"] == 1]
			got_sub = _match(list(goods[k].values()), sub, links, False)[0]
			got_all, _used, pairs = _match(list(goods[k].values()), list(notes[k].values()), links, False)
			docs_ |= {(n, notes[k][n]["docstatus"]) for g, n in pairs if g == d.name}
			if need - got_sub[d.name] > EPS:
				short_sub = True
			if need - got_all[d.name] > EPS:
				credited = sum(n["qty"] for n in notes[k].values())
				m = min(need - got_all[d.name], billed[k] - credited)   # never credit more than was billed
				if m > EPS:
					missing[k] = m
		names_ = ", ".join(sorted(x[0] for x in docs_))
		if not short_sub:
			st, text = "done", _("{0} made — {1}").format(c["note_label"], names_)
		elif not missing:
			st, text = ("draft", _("{0} made but still a draft: {1}").format(c["note_label"], names_)) if docs_ else \
				("done", _("Already credited in full on the invoice"))
		elif note_dt == "Sales Invoice":
			st, text = "pending", _("Make the {0} — the customer is still charged for these goods").format(c["note_label"])
		else:
			st, text = "pending", _("Make the {0} — we still owe the supplier for these goods").format(c["note_label"])
		out[d.name] = {"status": st, "text": text, "missing": missing,
					   "docs": [{"name": x[0], "docstatus": x[1]} for x in sorted(docs_)]}
	return out


@frappe.whitelist()
def get_status(doctype, name):
	frappe.has_permission(doctype, "read", name, throw=True)
	if doctype in NOTE:
		return note_goods(doctype, [name]).get(name)
	if doctype in GOODS:
		return goods_credit(doctype, [name]).get(name)


def _trim(doc, key_field, missing):
	"""Keep only the lines still missing, with the missing qty (negative, a return)."""
	missing = dict(missing)
	keep = []
	for row in doc.get("items"):
		k = row.get(key_field)
		m = missing.get(k, 0)
		if m <= EPS:
			continue
		cf = flt(row.conversion_factor) or 1
		qty = -min(abs(flt(row.qty)), flt(m / cf, row.precision("qty")))
		row.qty = qty
		row.stock_qty = qty * cf
		# Purchase Return lines carry received qty = returned qty; a Debit Note line's received qty
		# follows its qty too (sync_debit_note_received_qty) — only where ERPNext mapped one
		for f in ("received_qty", "received_stock_qty"):
			if row.meta.has_field(f) and flt(row.get(f)):
				row.set(f, qty if f == "received_qty" else qty * cf)
		if row.meta.has_field("rejected_qty"):
			row.rejected_qty = 0
		missing[k] = m - abs(row.stock_qty)
		keep.append(row)
	if not keep:
		frappe.throw(_("Nothing left to return on this document."))
	doc.set("items", keep)
	for i, row in enumerate(keep, 1):
		row.idx = i
	doc.run_method("calculate_taxes_and_totals")
	return doc


def _goods_returns_for(note_dt, note_name, missing):
	"""The Sales / Purchase Returns (unsaved) for a note's missing lines — one per original DN / PR."""
	c = NOTE[note_dt]
	parents = {r.name: r.parent for r in frappe.get_all(c["goods_item"], filters={"name": ["in", list(missing)]}, fields=["name", "parent"])}
	if note_dt == "Sales Invoice":
		from erpnext.stock.doctype.delivery_note.delivery_note import make_sales_return as make
	else:
		from erpnext.stock.doctype.purchase_receipt.purchase_receipt import make_purchase_return as make
	out = []
	for src in sorted(set(parents.values())):
		doc = _trim(make(src), c["goods_key"], {k: v for k, v in missing.items() if parents.get(k) == src})
		doc.custom_against_note = note_name
		out.append(doc)
	return out


@frappe.whitelist()
def make_goods_return(source_name, target_doc=None, args=None):
	"""From a Credit / Debit Note: the Sales / Purchase Return for its goods not yet returned —
	ERPNext's own mapping from the original Delivery Note / Purchase Receipt, cut down to those
	lines and qty, marked as made for this note. Called by frappe.model.open_mapped_doc (the form
	opens unsaved; a note from two DNs / PRs gets one return now, the button stays for the next)."""
	note_dt = "Sales Invoice" if frappe.db.exists("Sales Invoice", source_name) else "Purchase Invoice"
	frappe.has_permission(note_dt, "read", source_name, throw=True)
	st = note_goods(note_dt, [source_name]).get(source_name) or {}
	if st.get("status") != "pending" or not st.get("missing"):
		frappe.throw(st.get("text") or _("Nothing to return."))
	return _goods_returns_for(note_dt, source_name, st["missing"])[0]


@frappe.whitelist()
def make_note_from_goods(source_name, target_doc=None, args=None):
	"""From a Sales / Purchase Return: the Credit / Debit Note for the goods not yet credited —
	made from the ORIGINAL invoice (so it is against that invoice, as GST needs), cut down to
	those lines and qty, naming this return. ERPNext's own "Create › Credit / Debit Note" on a
	return is not used: it makes a note not linked to the invoice."""
	goods_dt = "Delivery Note" if frappe.db.exists("Delivery Note", source_name) else "Purchase Receipt"
	frappe.has_permission(goods_dt, "read", source_name, throw=True)
	note_dt = GOODS[goods_dt]
	c = NOTE[note_dt]
	st = goods_credit(goods_dt, [source_name]).get(source_name) or {}
	missing = st.get("missing") or {}
	if st.get("status") != "pending" or not missing:
		frappe.throw(st.get("text") or _("Nothing to credit."))
	inv = frappe.db.sql(f"""SELECT ni.parent, ni.{c['note_key']} AS k FROM `tab{c['note_item']}` ni JOIN `tab{note_dt}` n ON n.name = ni.parent
			WHERE n.is_return = 0 AND n.docstatus = 1 AND ni.{c['note_key']} IN %(k)s ORDER BY n.posting_date, n.name""",
						{"k": tuple(missing)}, as_dict=1)
	source_inv = inv[0].parent
	if note_dt == "Sales Invoice":
		from erpnext.accounts.doctype.sales_invoice.sales_invoice import make_sales_return as make
	else:
		from erpnext.accounts.doctype.purchase_invoice.purchase_invoice import make_debit_note as make
	keys_here = {r.k for r in inv if r.parent == source_inv}
	doc = _trim(make(source_inv), c["note_key"], {k: v for k, v in missing.items() if k in keys_here})
	doc.custom_goods_return = source_name
	doc.remarks = _("Goods returned: {0}").format(source_name)
	return doc


# ── "Update Stock (return the goods)" on a Credit / Debit Note ──────────────────────────────────
# ERPNext's own Update Stock can't be used on a note whose invoice was billed from a Delivery Note /
# Purchase Receipt ("Stock cannot be updated against Delivery Note"). Agreed 2026-10-23: such a note
# gets its own tick instead (custom_return_goods, shown only there); on Submit the Sales / Purchase
# Return is made from the original DN / PR for this note's lines and qty and submitted with it —
# the goods come back at their original cost, the DN / PR knows they were returned, they can't be
# returned twice. Cancelling the note cancels that return first.


def on_note_submit(doc, method=None):
	if doc.doctype not in NOTE or not (cint(doc.get("is_return")) and cint(doc.get("custom_return_goods"))):
		return
	st = note_goods(doc.doctype, [doc.name]).get(doc.name) or {}
	if st.get("status") != "pending" or not st.get("missing"):
		frappe.msgprint(_("No goods returned by this note: {0}").format(st.get("text") or ""), indicator="orange", alert=True)
		return
	made = []
	for ret in _goods_returns_for(doc.doctype, doc.name, st["missing"]):
		if doc.get("custom_return_warehouse"):
			for row in ret.items:
				row.warehouse = doc.custom_return_warehouse
		ret.flags.ignore_permissions = True   # part of submitting the note, like ERPNext's Update Stock
		ret.insert()
		ret.submit()
		made.append(ret.name)
	doc.db_set("custom_goods_return", ", ".join(made), update_modified=False)
	doc.add_comment("Info", _("Goods returned with {0}").format(", ".join(made)))
	frappe.msgprint(_("{0} made and submitted: {1}").format(NOTE[doc.doctype]["goods_label"], ", ".join(made)),
					indicator="green", alert=True)


def on_note_cancel(doc, method=None):
	"""Before a note that ticked Update Stock is cancelled: cancel the returns its Submit made."""
	if doc.doctype not in NOTE or not cint(doc.get("is_return")) or not cint(doc.get("custom_return_goods")):
		return
	gdt = NOTE[doc.doctype]["goods"]
	for name in [x.strip() for x in cstr(doc.get("custom_goods_return")).split(",") if x.strip()]:
		if frappe.db.get_value(gdt, name, ["docstatus", "custom_against_note"]) == (1, doc.name):
			ret = frappe.get_doc(gdt, name)
			ret.flags.ignore_permissions = True
			ret.cancel()
			frappe.msgprint(_("{0} {1} cancelled with this note").format(NOTE[doc.doctype]["goods_label"], name), alert=True)


def sync_debit_note_received_qty(doc, method=None):
	"""Debit Note (Purchase Invoice return) without Update Stock: received qty follows qty.

	ERPNext's mapping fills received qty with everything still returnable, and changing Qty on the
	form doesn't change it — a Debit Note for 12 of 120 then records 120 as returned, and no later
	Debit Note on that line is possible ("has already been returned"). Runs before validate, where
	ERPNext checks the quantities."""
	if doc.doctype != "Purchase Invoice" or not cint(doc.get("is_return")) or cint(doc.get("update_stock")):
		return
	for row in doc.get("items"):
		if flt(row.received_qty) != flt(row.qty):
			row.received_qty = row.qty
			row.rejected_qty = 0
