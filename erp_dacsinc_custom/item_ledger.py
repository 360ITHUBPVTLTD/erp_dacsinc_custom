"""Item Stock Ledger page (/app/item-stock-ledger) — docs/item-stock-ledger.md.

One item's every stock movement from the first one, each with what it was for: the jobber, Subcontracting Order,
Purchase Order and Sales Order of a material sent out or used, the supplier / customer of a receipt / delivery.
Made for "where did this stock go": all jobbers share one supplier warehouse, so what is with each jobber comes
from each Subcontracting Order's own counts (sent − used − returned), not from a warehouse balance.

Admin and Production Manager only (the page's roles, and checked here: the data skips document permissions).
"""

from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import flt, getdate

ROLES = ("Admin", "Production Manager")
MAX_ROWS = 20000


def _check():
	frappe.only_for(ROLES)


def _sales_orders_of_pos(pos):
	out = defaultdict(set)
	if pos:
		for r in frappe.get_all("Purchase Order Item", filters={"parent": ["in", list(pos)], "sales_order": ["is", "set"]},
								fields=["parent", "sales_order"]):
			out[r.parent].add(r.sales_order)
	return out


@frappe.whitelist()
def get_item_ledger(item_code, warehouse=None, from_date=None, to_date=None):
	_check()
	item = frappe.db.get_value("Item", item_code, ["name", "item_name", "stock_uom", "is_stock_item", "disabled"], as_dict=True)
	if not item:
		frappe.throw(_("Item {0} not found").format(item_code))

	jobber_whs = set(frappe.get_all("Subcontracting Order", filters={"docstatus": 1}, distinct=True, pluck="supplier_warehouse"))
	jobber_whs |= set(frappe.get_all("Warehouse", filters={"name": ["like", "%Jober%"]}, pluck="name"))

	stock = frappe.get_all("Bin", filters={"item_code": item_code, "actual_qty": ["!=", 0]},
						   fields=["warehouse", "actual_qty as qty", "reserved_qty", "reserved_stock"], order_by="actual_qty desc")
	for s in stock:
		s.is_jobber = s.warehouse in jobber_whs

	# ---- the movements ----
	cond, args = ["sle.item_code = %(item)s", "sle.is_cancelled = 0"], {"item": item_code}
	if warehouse:
		cond.append("sle.warehouse = %(wh)s"); args["wh"] = warehouse
	opening = 0.0
	if from_date:
		args["from"] = getdate(from_date)
		opening = flt(frappe.db.sql(f"select sum(actual_qty) from `tabStock Ledger Entry` sle where {' and '.join(cond)} "
									"and sle.posting_date < %(from)s", args)[0][0])
		cond.append("sle.posting_date >= %(from)s")
	if to_date:
		cond.append("sle.posting_date <= %(to)s"); args["to"] = getdate(to_date)
	sles = frappe.db.sql(f"""select sle.name, sle.posting_date, sle.posting_time, sle.voucher_type, sle.voucher_no,
			sle.voucher_detail_no, sle.warehouse, sle.actual_qty, sle.qty_after_transaction, sle.owner, sle.creation
		from `tabStock Ledger Entry` sle where {' and '.join(cond)}
		order by sle.posting_datetime, sle.creation, sle.actual_qty limit {MAX_ROWS + 1}""", args, as_dict=True)
	truncated = len(sles) > MAX_ROWS
	sles = sles[:MAX_ROWS]

	ctx = _voucher_context(sles)
	rows, by_detail = [], {}
	for e in sles:
		c = ctx.get((e.voucher_type, e.voucher_no), {})
		line = c.get("lines", {}).get(e.voucher_detail_no, {})
		# a transfer is two entries of one line (out of one warehouse, into another): one row, from → to
		key = (e.voucher_type, e.voucher_no, e.voucher_detail_no)
		pair = by_detail.get(key) if e.voucher_type == "Stock Entry" and e.voucher_detail_no else None
		if pair and ((flt(e.actual_qty) > 0 and not pair["to_wh"]) or (flt(e.actual_qty) < 0 and not pair["from_wh"])):
			if flt(e.actual_qty) > 0:
				pair.update(to_wh=e.warehouse, to_balance=e.qty_after_transaction, qty_in=e.actual_qty)
			else:
				pair.update(from_wh=e.warehouse, from_balance=e.qty_after_transaction, qty_out=-e.actual_qty)
			pair["kind"], pair["label"] = _kind(e.voucher_type, c, line, pair.get("from_wh"), pair.get("to_wh"), jobber_whs)
			continue
		qin, qout = max(flt(e.actual_qty), 0), max(-flt(e.actual_qty), 0)
		r = {
			"date": e.posting_date, "time": str(e.posting_time or "")[:5], "voucher_type": e.voucher_type,
			"voucher_no": e.voucher_no, "by": e.owner,
			"from_wh": e.warehouse if qout else None, "from_balance": e.qty_after_transaction if qout else None,
			"to_wh": e.warehouse if qin else None, "to_balance": e.qty_after_transaction if qin else None,
			"qty_in": qin, "qty_out": qout,
			"party": c.get("party"), "remarks": c.get("remarks"),
			"sco": line.get("sco") or c.get("sco"), "po": line.get("po") or c.get("po"),
			"so": sorted(set(line.get("so") or []) | set(c.get("so") or [])),
			"pick_list": line.get("pick_list"), "is_return": c.get("is_return"), "ewo": c.get("ewo"),
		}
		if not qin and not qout:   # a stock count that changed nothing
			r["to_wh"], r["to_balance"] = e.warehouse, e.qty_after_transaction
		r["kind"], r["label"] = _kind(e.voucher_type, c, line, r["from_wh"], r["to_wh"], jobber_whs)
		rows.append(r)
		if e.voucher_type == "Stock Entry" and e.voucher_detail_no:
			by_detail[key] = r
	# total of all (shown) warehouses after each row — from the finished rows: ERPNext writes a Stock Entry's
	# outgoing entries before its incoming ones, so a running sum over the entries dipped inside a transfer
	total = opening
	for r in rows:
		total += r["qty_in"] - r["qty_out"]
		r["total"] = total

	return {
		"item": item, "stock": stock, "jobber_warehouses": sorted(w for w in jobber_whs if w),
		"jobbers": _with_jobbers(item_code), "fg_orders": _fg_orders(item_code),
		"opening": opening if from_date else None, "rows": rows, "truncated": truncated, "max_rows": MAX_ROWS,
		"filters": {"warehouse": warehouse, "from_date": from_date, "to_date": to_date},
	}


def _kind(vt, c, line, from_wh, to_wh, jobber_whs):
	"""(kind key, label) of a movement — what a store person would call it."""
	to_jobber, from_jobber = to_wh in jobber_whs, from_wh in jobber_whs
	if vt == "Stock Reconciliation":
		return ("opening", _("Opening stock")) if c.get("purpose") == "Opening Stock" else ("count", _("Stock count"))
	if vt == "Stock Entry":
		t = c.get("type") or ""
		if c.get("ewo_way") == "sent":
			return "to_jobber", _("Sent for embroidery")
		if c.get("ewo_way") == "back":
			return "from_jobber", _("Back from embroidery")
		if t == "Send to Subcontractor" or (to_jobber and not from_jobber and from_wh):
			return "to_jobber", _("Sent to jobber")
		if from_jobber and to_wh and not to_jobber:
			return "from_jobber", _("Returned by jobber")
		if from_wh and to_wh:
			return "transfer", _("Transfer")
		if t in ("Material Receipt",) or (to_wh and not from_wh):
			return "in", _(t or "Received")
		return "out", _(t or "Issued")
	if vt == "Subcontracting Receipt":
		if c.get("is_return"):
			return "to_jobber", _("Returned to jobber")
		if from_jobber:
			return "used", _("Used by jobber")
		return "from_jobber", _("Received from jobber")
	if vt in ("Purchase Receipt", "Purchase Invoice"):
		return ("out", _("Returned to supplier")) if c.get("is_return") else ("in", _("Purchased"))
	if vt == "Delivery Note":
		return ("in", _("Customer return")) if c.get("is_return") else ("out", _("Delivered"))
	if vt in ("Sales Invoice", "POS Invoice"):
		return ("in", _("Sales return")) if c.get("is_return") else ("out", _("Sold"))
	return ("in" if to_wh else "out"), _(vt)


def _voucher_context(sles):
	"""{(voucher_type, voucher_no): {party, sco, po, so, remarks, lines: {detail_no: {sco, po, so, pick_list}}}}"""
	by_type = defaultdict(set)
	for e in sles:
		by_type[e.voucher_type].add(e.voucher_no)
	ctx, scos, pos = {}, set(), set()

	def put(vt, name, **kw):
		ctx.setdefault((vt, name), {"lines": {}}).update({k: v for k, v in kw.items() if v is not None})

	def line(vt, name, detail, **kw):
		ctx.setdefault((vt, name), {"lines": {}})["lines"].setdefault(detail, {}).update({k: v for k, v in kw.items() if v})

	if names := by_type.get("Stock Entry"):
		for d in frappe.get_all("Stock Entry", filters={"name": ["in", list(names)]},
								fields=["name", "stock_entry_type", "purpose", "subcontracting_order", "supplier_name", "remarks",
										"purchase_order", "custom_reference_id"]):
			put("Stock Entry", d.name, type=d.stock_entry_type or d.purpose, sco=d.subcontracting_order, party=d.supplier_name,
				po=d.purchase_order, remarks=d.remarks or d.custom_reference_id)
			if d.subcontracting_order: scos.add(d.subcontracting_order)
		_embroidery_transfers(names, put)
	if names := by_type.get("Subcontracting Receipt"):
		for d in frappe.get_all("Subcontracting Receipt", filters={"name": ["in", list(names)]},
								fields=["name", "supplier_name", "is_return", "remarks", "supplier_delivery_note"]):
			put("Subcontracting Receipt", d.name, party=d.supplier_name, is_return=d.is_return,
				remarks=d.remarks or (d.supplier_delivery_note and _("Jobber DC {0}").format(d.supplier_delivery_note)))
		for r in frappe.get_all("Subcontracting Receipt Item", filters={"parent": ["in", list(names)]},
								fields=["parent", "name", "subcontracting_order", "purchase_order"]):
			line("Subcontracting Receipt", r.parent, r.name, sco=r.subcontracting_order, po=r.purchase_order)
			put("Subcontracting Receipt", r.parent, sco=r.subcontracting_order)
			if r.subcontracting_order: scos.add(r.subcontracting_order)
		for r in frappe.get_all("Subcontracting Receipt Supplied Item", filters={"parent": ["in", list(names)]},
								fields=["parent", "name", "subcontracting_order"]):
			line("Subcontracting Receipt", r.parent, r.name, sco=r.subcontracting_order)
			if r.subcontracting_order: scos.add(r.subcontracting_order)
	if names := by_type.get("Purchase Receipt"):
		for d in frappe.get_all("Purchase Receipt", filters={"name": ["in", list(names)]}, fields=["name", "supplier_name", "is_return", "remarks"]):
			put("Purchase Receipt", d.name, party=d.supplier_name, is_return=d.is_return, remarks=d.remarks)
		for r in frappe.get_all("Purchase Receipt Item", filters={"parent": ["in", list(names)]},
								fields=["parent", "name", "purchase_order", "sales_order"]):
			line("Purchase Receipt", r.parent, r.name, po=r.purchase_order, so=[r.sales_order] if r.sales_order else None)
			if r.purchase_order: pos.add(r.purchase_order)
	if names := by_type.get("Purchase Invoice"):
		for d in frappe.get_all("Purchase Invoice", filters={"name": ["in", list(names)]}, fields=["name", "supplier_name", "is_return"]):
			put("Purchase Invoice", d.name, party=d.supplier_name, is_return=d.is_return)
	if names := by_type.get("Delivery Note"):
		for d in frappe.get_all("Delivery Note", filters={"name": ["in", list(names)]}, fields=["name", "customer_name", "is_return"]):
			put("Delivery Note", d.name, party=d.customer_name, is_return=d.is_return)
		for r in frappe.get_all("Delivery Note Item", filters={"parent": ["in", list(names)]},
								fields=["parent", "name", "against_sales_order", "against_pick_list"]):
			line("Delivery Note", r.parent, r.name, so=[r.against_sales_order] if r.against_sales_order else None, pick_list=r.against_pick_list)
	for vt in ("Sales Invoice", "POS Invoice"):
		if names := by_type.get(vt):
			for d in frappe.get_all(vt, filters={"name": ["in", list(names)]}, fields=["name", "customer_name", "is_return"]):
				put(vt, d.name, party=d.customer_name, is_return=d.is_return)
			for r in frappe.get_all(f"{vt} Item", filters={"parent": ["in", list(names)]}, fields=["parent", "name", "sales_order"]):
				line(vt, r.parent, r.name, so=[r.sales_order] if r.sales_order else None)
	if names := by_type.get("Stock Reconciliation"):
		for d in frappe.get_all("Stock Reconciliation", filters={"name": ["in", list(names)]}, fields=["name", "purpose"]):
			put("Stock Reconciliation", d.name, purpose=d.purpose)

	# SCO → its PO, jobber; PO → the Sales Orders it buys for
	sco_info = {d.name: d for d in frappe.get_all("Subcontracting Order", filters={"name": ["in", list(scos)]},
												 fields=["name", "purchase_order", "supplier_name"])} if scos else {}
	pos |= {d.purchase_order for d in sco_info.values() if d.purchase_order}
	so_of_po = _sales_orders_of_pos(pos)
	for c in ctx.values():
		for holder in [c, *c["lines"].values()]:
			s = sco_info.get(holder.get("sco"))
			if s:
				holder.setdefault("po", s.purchase_order)
				c.setdefault("party", s.supplier_name)
			if holder.get("po"):
				holder["so"] = sorted(set(holder.get("so") or []) | so_of_po.get(holder["po"], set()))
	return ctx


def _embroidery_transfers(se_names, put):
	"""Stock Entries of an Embroidery Transfer (Order Flow › Embroidery Transfers: an Embroidery Work Order of work
	type Stock Transfer): the sending Material Transfer (stock_entry_sent) and each receipt's Repack (Embroidery Work
	Order Receipt) get the transfer (EM/…), its jobber and its notes — read from the transfer, so entries made before
	their Remarks named it show it too."""
	sent = frappe.get_all("Embroidery Work Order", filters={"stock_entry_sent": ["in", list(se_names)], "work_type": "Stock Transfer"},
						  fields=["name", "stock_entry_sent as se"])
	back = frappe.get_all("Embroidery Work Order Receipt", filters={"stock_entry": ["in", list(se_names)], "parenttype": "Embroidery Work Order"},
						  fields=["parent as name", "stock_entry as se"])
	if not sent and not back:
		return
	ewos = {d.name: d for d in frappe.get_all("Embroidery Work Order", filters={"name": ["in", list({r.name for r in sent + back})]},
											 fields=["name", "full_piece_jobber", "notes"])}
	jobbers = {d.name: d.supplier_name for d in frappe.get_all("Supplier", filters={
		"name": ["in", list({e.full_piece_jobber for e in ewos.values() if e.full_piece_jobber}) or [""]]}, fields=["name", "supplier_name"])}
	for rows, way in ((sent, "sent"), (back, "back")):
		for r in rows:
			e = ewos.get(r.name)
			if not e:
				continue
			put("Stock Entry", r.se, ewo=e.name, ewo_way=way, party=jobbers.get(e.full_piece_jobber) or e.full_piece_jobber,
				remarks=(e.notes or "").strip() or None)


def _with_jobbers(item_code):
	"""This item as a raw material on Subcontracting Orders: per order, sent / used / returned / still with the jobber."""
	rows = frappe.db.sql("""select sco.name sco, sco.transaction_date, sco.status, sco.purchase_order po, sco.supplier,
			sco.supplier_name, sum(si.required_qty) required, sum(si.supplied_qty) sent, sum(si.consumed_qty) used,
			sum(si.returned_qty) returned
		from `tabSubcontracting Order Supplied Item` si join `tabSubcontracting Order` sco on sco.name = si.parent
		where si.rm_item_code = %s and sco.docstatus = 1
		group by sco.name order by sco.transaction_date, sco.name""", item_code, as_dict=True)
	so_of_po = _sales_orders_of_pos({r.po for r in rows if r.po})
	for r in rows:
		r.balance = flt(r.sent) - flt(r.used) - flt(r.returned)
		r.so = sorted(so_of_po.get(r.po, set()))
	return rows


def _fg_orders(item_code):
	"""This item as the finished good of Subcontracting Orders: ordered from the jobber, received back."""
	rows = frappe.db.sql("""select sco.name sco, sco.transaction_date, sco.status, sco.purchase_order po, sco.supplier_name,
			sum(i.qty) qty, sum(i.received_qty) received
		from `tabSubcontracting Order Item` i join `tabSubcontracting Order` sco on sco.name = i.parent
		where i.item_code = %s and sco.docstatus = 1
		group by sco.name order by sco.transaction_date, sco.name""", item_code, as_dict=True)
	so_of_po = _sales_orders_of_pos({r.po for r in rows if r.po})
	for r in rows:
		r.so = sorted(so_of_po.get(r.po, set()))
	return rows
