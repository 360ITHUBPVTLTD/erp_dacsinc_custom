"""Stock held for Sales Orders can't be taken by anything else.

Stock in VV Puram - IND (custom_script.MAIN_WAREHOUSE, where every Pick List is made)
is HELD, for the order it belongs to, by:

- Pick Lists, draft or submitted, not Completed / Cancelled, whose order is still
  open: a submitted row holds picked − delivered, a draft row its qty (the same rule
  as order_flow_api._rm_stock_pools and the Item Stock & Action Plan);
- goods out at a Full Piece embroidery jobber on an order-raised Embroidery Work
  Order (they never left the Bin: so_embroidery.held_at_jobber_by_item);
- raw material bought against an order, not yet consumed by its own subcontracting
  (the earmark in _rm_stock_pools).

Nothing may take held stock out of VV Puram except the order it's held for:
Delivery Note, Sales Invoice with Update Stock, every Stock Entry, Stock
Reconciliation lowering the qty, purchase / subcontracting returns — checked on
submit — and cancelling a document that brought stock in (a Purchase Receipt,
Subcontracting Receipt, Stock Entry…), checked on cancel. A Pick List can't be
submitted for more than is free either.

The user named in Admin Settings › Stock Hold (and Administrator / System Manager)
may go past it: they get a warning, and the document gets a comment saying so.
ERPNext's own stock reservation stays off (see docs/stock-hold.md for why).
"""

from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import flt

HOLD_WAREHOUSE = "VV Puram - IND"
OVERRIDE_FIELD = "stock_hold_override_users"
CLOSED_SO = ("Closed", "Completed", "Cancelled")
EPS = 0.001


# ------------------------------------------------------------------ holds
def holds_for(item_codes):
	"""{item_code: [{"kind", "doc", "sales_order", "qty"}]} in VV Puram."""
	codes = tuple(sorted({c for c in item_codes if c}))
	out = defaultdict(list)
	if not codes:
		return out
	for r in frappe.db.sql("""
		SELECT pli.item_code, pl.name AS doc, pl.docstatus, IFNULL(pli.sales_order, '') AS sales_order,
		       COALESCE(a2.creation, a1.creation, pl.creation) AS creation,
		       SUM(CASE WHEN pl.docstatus = 1
		                THEN GREATEST(IFNULL(pli.picked_qty, 0) - IFNULL(pli.delivered_qty, 0), 0)
		                ELSE IFNULL(pli.stock_qty, 0) END) AS qty
		FROM `tabPick List Item` pli
		JOIN `tabPick List` pl ON pl.name = pli.parent
		LEFT JOIN `tabPick List` a1 ON a1.name = pl.amended_from
		LEFT JOIN `tabPick List` a2 ON a2.name = a1.amended_from
		LEFT JOIN `tabSales Order` so ON so.name = pli.sales_order
		WHERE pli.item_code IN %(codes)s AND pl.docstatus < 2
		  AND pl.status NOT IN ('Completed', 'Cancelled')
		  AND pli.warehouse = %(wh)s
		  AND (so.name IS NULL OR so.status NOT IN %(closed)s)
		GROUP BY pli.item_code, pl.name, pl.docstatus, pli.sales_order, COALESCE(a2.creation, a1.creation, pl.creation)
	""", {"codes": codes, "wh": HOLD_WAREHOUSE, "closed": CLOSED_SO}, as_dict=True):
		if flt(r.qty) > EPS:
			out[r.item_code].append({"kind": "draft" if r.docstatus == 0 else "picked", "doc": r.doc,
									 "sales_order": r.sales_order, "qty": flt(r.qty, 3), "since": str(r.creation)})
	for r in frappe.db.sql("""
		SELECT c.item_code, ewo.name AS doc, ewo.saels_order_id AS sales_order, ewo.creation,
		       SUM(GREATEST(c.ordered_qty - IFNULL(c.received_qty, 0), 0)) AS qty
		FROM `tabEmbroidery Work Order Item` c
		JOIN `tabEmbroidery Work Order` ewo ON ewo.name = c.parent
		WHERE ewo.docstatus = 1 AND ewo.work_type = %(fp)s
		  AND IFNULL(ewo.purchase_order, '') = '' AND IFNULL(ewo.saels_order_id, '') != ''
		  AND c.item_code IN %(codes)s
		GROUP BY c.item_code, ewo.name, ewo.saels_order_id, ewo.creation
	""", {"codes": codes, "fp": _full_piece()}, as_dict=True):
		if flt(r.qty) > EPS:
			out[r.item_code].append({"kind": "embroidery", "doc": r.doc, "sales_order": r.sales_order, "qty": flt(r.qty, 3),
									 "since": str(r.creation)})
	# Goods sent to the jobber off an order's own draft Pick List are already in that
	# Pick List's qty (so_embroidery marks it with custom_embroidery_hold_qty): count them once.
	from erp_dacsinc_custom.so_embroidery import PL_HOLD_QTY_FIELD

	on_pl = defaultdict(float)
	for r in frappe.db.sql(f"""
		SELECT pli.item_code, pli.sales_order, MAX(IFNULL(pl.{PL_HOLD_QTY_FIELD}, 0)) AS hold
		FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent
		WHERE pl.docstatus = 0 AND pli.item_code IN %(codes)s AND IFNULL(pl.{PL_HOLD_QTY_FIELD}, 0) > 0
		GROUP BY pli.item_code, pli.sales_order, pl.name
	""", {"codes": codes}, as_dict=True):
		on_pl[(r.item_code, r.sales_order)] += flt(r.hold)
	for code in list(out):
		for h in out[code]:
			if h["kind"] == "embroidery" and on_pl.get((code, h["sales_order"]), 0) > EPS:
				take = min(h["qty"], on_pl[(code, h["sales_order"])])
				h["qty"] = flt(h["qty"] - take, 3)
				on_pl[(code, h["sales_order"])] -= take
		out[code] = [h for h in out[code] if h["qty"] > EPS]
	from erp_dacsinc_custom.order_flow_api import _rm_stock_pools

	for code, pool in (_rm_stock_pools(list(codes), HOLD_WAREHOUSE) or {}).items():
		for so, qty in (pool.get("earmarked") or {}).items():
			if flt(qty) > EPS:
				out[code].append({"kind": "earmark", "doc": so, "sales_order": so, "qty": flt(qty, 3), "since": "9999"})
	return out


def _full_piece():
	from erp_dacsinc_custom.so_embroidery import FULL_PIECE

	return FULL_PIECE


def on_hand(item_codes):
	codes = tuple({c for c in item_codes if c})
	if not codes:
		return {}
	return {r.item_code: flt(r.actual_qty) for r in frappe.get_all(
		"Bin", filters={"item_code": ["in", codes], "warehouse": HOLD_WAREHOUSE}, fields=["item_code", "actual_qty"])}


PRIORITY = {"embroidery": 0, "picked": 1, "draft": 1, "earmark": 2}


def allocate(holds, phys):
	"""When the holds on an item add up to more than is on the shelf, the oldest wins:
	goods out at the embroidery jobber first (they've physically gone), then Pick
	Lists by creation (draft or submitted alike), then raw-material earmarks. Returns
	[(hold, qty it really gets)] in that order."""
	left, out = max(flt(phys), 0.0), []
	for h in sorted(holds, key=lambda h: (PRIORITY[h["kind"]], h.get("since") or "", h["doc"])):
		take = min(left, h["qty"])
		left -= take
		out.append((h, flt(take, 3)))
	return out


def missing_by_pick_list(pick_lists):
	"""{pick_list: qty} its hold is short of what's on the shelf in VV Puram: the shelf
	stock goes to the oldest Pick Lists first (by creation); what's left over is missing
	— the picked stock went (typically a receipt cancelled after picking). Shown on the
	Order Flow › Pick Lists tab so it's fixed before the Delivery Note is made."""
	names = [p for p in pick_lists if p]
	if not names:
		return {}
	items = [r[0] for r in frappe.db.sql("""SELECT DISTINCT item_code FROM `tabPick List Item`
		WHERE parent IN %(n)s AND warehouse = %(wh)s""", {"n": tuple(names), "wh": HOLD_WAREHOUSE})]
	if not items:
		return {}
	have = on_hand(items)
	out = defaultdict(float)
	for item, hs in holds_for(items).items():
		for h, got in allocate(hs, have.get(item, 0)):
			if h["kind"] in ("draft", "picked") and h["doc"] in names and h["qty"] - got > EPS:
				out[h["doc"]] += flt(h["qty"] - got, 3)
	return dict(out)


# ------------------------------------------------------------------ the check
def check(doc, wanted, action, own_sos=None, own_docs=None, skip_kinds=()):
	"""wanted: {item_code: qty leaving VV Puram}. own_sos / own_docs: {item_code: set}
	— holds of these orders / documents belong to this document and don't count.
	Throws (or, for an override user, warns and records) when held stock would go."""
	wanted = {i: flt(q, 3) for i, q in wanted.items() if flt(q) > EPS}
	if not wanted:
		return
	have = on_hand(wanted)
	holds = holds_for(wanted)
	problems = []
	for item, qty in sorted(wanted.items()):
		mine_so = (own_sos or {}).get(item, set())
		mine_doc = (own_docs or {}).get(item, set())
		counted = [h for h in holds.get(item, []) if h["kind"] not in skip_kinds]
		is_mine = lambda h: h["doc"] in mine_doc or bool(h["sales_order"] and h["sales_order"] in mine_so)
		phys = flt(have.get(item, 0), 3)
		# oldest claim wins (allocate): other orders stop this document only by what they
		# really get ahead of it — two orders claiming the same few units don't lock each other
		got = allocate(counted, phys)
		others = [dict(h, qty=g) for h, g in got if not is_mine(h) and g > EPS]
		held = sum(h["qty"] for h in others)
		free = flt(phys - held, 3)
		if qty <= free + EPS:
			continue
		if held <= EPS and not [h for h in counted if is_mine(h) and h["qty"] > phys + EPS]:
			# nothing is held by anyone: it's a plain shortage, ERPNext's own stock check says so
			continue
		lines = []
		for h in sorted(others, key=lambda h: -h["qty"])[:6]:
			what = {"picked": _("Pick List {0}"), "draft": _("draft Pick List {0}"),
					"embroidery": _("at the embroidery jobber on {0}"), "earmark": _("raw material bought for it")}[h["kind"]]
			lines.append(_("{0} held for {1} ({2})").format(
				flt(h["qty"], 3), frappe.bold(h["sales_order"] or _("no order")), what.format(h["doc"])))
		mine = [h for h in counted if is_mine(h)]
		mine_held = sum(h["qty"] for h in mine)
		msg = _("{0}: {1} would leave {2}, but only {3} of the {4} there is free.").format(
			frappe.bold(item), qty, HOLD_WAREHOUSE, max(free, 0), phys)
		if lines:
			msg += "<br>" + "<br>".join("&nbsp;&nbsp;• " + l for l in lines)
		if mine_held > phys + EPS:
			msg += "<br>&nbsp;&nbsp;• " + _("This order's own hold is {0}, more than is on the shelf: the picked stock has gone "
											"(e.g. a receipt was cancelled). Fix its Pick List on the Order Flow dashboard.").format(flt(mine_held, 3))
		problems.append(msg)
	if not problems:
		return
	body = "<br><br>".join(problems)
	if can_override():
		frappe.msgprint(body + "<br><br>" + _("Allowed because you're on the Stock Hold override list. This is recorded on the document."),
						title=_("Held stock used"), indicator="orange")
		if doc.name and not doc.is_new():
			doc.add_comment("Comment", _("{0} used held stock ({1}, Stock Hold override): {2}").format(
				frappe.utils.get_fullname(frappe.session.user), action,
				frappe.utils.strip_html(body.replace("<br>", " ").replace("&nbsp;", " ")))[:1500])
		return
	frappe.throw(body + "<br><br>" + _("Stock held for a Sales Order can't be {0}. Deliver that order, or release its Pick List "
									   "(Order Flow › Pick Lists), first.").format(action), title=_("Stock is held for another order"))


def can_override(user=None):
	user = user or frappe.session.user
	if user == "Administrator" or "System Manager" in frappe.get_roles(user):
		return True
	try:
		listed = {d.user for d in (frappe.get_cached_doc("Admin Settings").get(OVERRIDE_FIELD) or []) if d.get("user")}
	except Exception:
		listed = set()
	return user in listed


# ------------------------------------------------------------------ doc events
def _rows_out(doc, qty_field, wh_field="warehouse", so_field=None, sign=1):
	wanted, sos = defaultdict(float), defaultdict(set)
	for d in doc.get("items") or []:
		if d.get("item_code") and d.get(wh_field) == HOLD_WAREHOUSE:
			q = sign * flt(d.get(qty_field) or 0)
			if q > 0:
				wanted[d.item_code] += q
				if so_field and d.get(so_field):
					sos[d.item_code].add(d.get(so_field))
	return wanted, sos


def guard_delivery_note(doc, method=None):
	"""Delivery Note before_submit: only its own orders' held stock may go."""
	if doc.get("is_return"):
		return
	wanted, sos = _rows_out(doc, "stock_qty", so_field="against_sales_order")
	pls = defaultdict(set)
	for d in doc.get("items") or []:
		if d.get("pick_list_item"):
			pl = frappe.db.get_value("Pick List Item", d.pick_list_item, "parent")
			if pl:
				pls[d.item_code].add(pl)
	check(doc, wanted, _("delivered"), sos, pls)


def guard_sales_invoice(doc, method=None):
	"""Sales Invoice before_submit, when it moves stock (Update Stock)."""
	if not doc.get("update_stock") or doc.get("is_return"):
		return
	wanted, sos = _rows_out(doc, "stock_qty", so_field="sales_order")
	check(doc, wanted, _("invoiced out"), sos)


def guard_stock_entry(doc, method=None):
	"""Stock Entry before_submit, every purpose, for rows leaving VV Puram."""
	wanted, _sos = _rows_out(doc, "transfer_qty", wh_field="s_warehouse")
	# Send to Subcontractor keeps its own raw-material rule (custom_script.flag_subcontract_rm_borrowing:
	# borrowing another order's earmark is a visible, confirmed act), so earmarks aren't counted here.
	skip = ("earmark",) if doc.get("purpose") == "Send to Subcontractor" else ()
	check(doc, wanted, _("moved out"), skip_kinds=skip)


def guard_stock_reconciliation(doc, method=None):
	"""Stock Reconciliation before_submit: the qty can't go below what's held."""
	wanted = defaultdict(float)
	for d in doc.get("items") or []:
		if d.get("warehouse") == HOLD_WAREHOUSE and d.get("item_code") and d.get("qty") is not None:
			drop = flt(d.get("current_qty")) - flt(d.get("qty"))
			if drop > EPS:
				wanted[d.item_code] += drop
	check(doc, wanted, _("reconciled away"))


def guard_return(doc, method=None):
	"""Purchase Receipt / Purchase Invoice (Update Stock) / Subcontracting Receipt returns
	send stock back out of VV Puram."""
	if not doc.get("is_return"):
		return
	if doc.doctype == "Purchase Invoice" and not doc.get("update_stock"):
		return
	wanted, _sos = _rows_out(doc, "stock_qty" if doc.doctype != "Subcontracting Receipt" else "qty", sign=-1)
	check(doc, wanted, _("returned"))


def guard_cancel(doc, method=None):
	"""before_cancel of any stock document: cancelling what brought stock into VV Puram
	takes it out again, and must not take held stock with it."""
	wanted = defaultdict(float)
	for r in frappe.db.sql("""
		SELECT item_code, SUM(actual_qty) AS qty FROM `tabStock Ledger Entry`
		WHERE voucher_type = %s AND voucher_no = %s AND warehouse = %s AND is_cancelled = 0
		GROUP BY item_code
	""", (doc.doctype, doc.name, HOLD_WAREHOUSE), as_dict=True):
		if flt(r.qty) > EPS:
			wanted[r.item_code] += flt(r.qty)
	own = {}
	if doc.doctype == "Purchase Receipt":
		# its own draft put-away Pick Lists are deleted by this cancel (purchase_order.delete_putaway_picklist)
		mine = set(frappe.get_all("Pick List", filters={"custom_purchase_receipt": doc.name, "docstatus": 0}, pluck="name"))
		own = {i: mine for i in wanted}
	check(doc, wanted, _("removed by cancelling {0}").format(doc.name), own_docs=own)


def guard_pick_list_submit(doc, method=None):
	"""Pick List before_submit: can't pick more than is free (other holds excluded)."""
	wanted = defaultdict(float)
	for d in doc.get("items") or []:
		if d.get("warehouse") == HOLD_WAREHOUSE and d.get("item_code"):
			wanted[d.item_code] += flt(d.get("picked_qty") or d.get("stock_qty"))
	check(doc, wanted, _("picked"), own_docs={i: {doc.name} for i in wanted})


# ------------------------------------------------------------------ report (read-only)
def report_missing():
	"""Every open Pick List whose held stock isn't on the shelf in VV Puram any more, with
	its order and what's missing. Read-only; run on a site after deploying:
	    bench --site <site> execute erp_dacsinc_custom.stock_hold.report_missing"""
	pls = frappe.get_all("Pick List", filters={"docstatus": ["<", 2], "status": ["not in", ["Completed", "Cancelled"]]}, pluck="name")
	miss = missing_by_pick_list(pls)
	rows = []
	for pl in sorted(miss):
		d = frappe.get_doc("Pick List", pl)
		for r in d.locations:
			if r.warehouse != HOLD_WAREHOUSE:
				continue
			held = flt(r.stock_qty) if d.docstatus == 0 else max(0.0, flt(r.picked_qty) - flt(r.delivered_qty))
			rows.append({"pick_list": pl, "state": "draft" if d.docstatus == 0 else "submitted", "created": str(d.creation.date()),
						 "sales_order": r.sales_order, "item_code": r.item_code, "held": flt(held, 3),
						 "on_shelf": flt(on_hand([r.item_code]).get(r.item_code, 0), 3), "missing": flt(miss[pl], 3)})
	print(f"{len(miss)} of {len(pls)} open Pick Lists hold stock that isn't in {HOLD_WAREHOUSE}:")
	for x in rows:
		print(" | ".join(str(x[k]) for k in ("pick_list", "state", "created", "sales_order", "item_code", "held", "on_shelf", "missing")))
	return rows


# ------------------------------------------------------------------ Pick Lists only claim stock that is there
def _seniority(doc):
	"""An amended Pick List (reverted to draft) keeps its original's place in the queue."""
	name, since = doc.get("amended_from"), doc.get("creation") or frappe.utils.now()
	for _i in range(5):
		if not name:
			break
		prev = frappe.db.get_value("Pick List", name, ["creation", "amended_from"], as_dict=True)
		if not prev:
			break
		since, name = prev.creation, prev.amended_from
	return str(since)


def fit_pick_list_to_free(doc, method=None):
	"""Pick List before_save (after ERPNext's own allocation): a draft can't claim more of
	VV Puram than is really free for it — on the shelf, minus what older claims hold
	(allocate). Rows are cut down to that, rows with nothing left are dropped, and a
	Pick List with nothing left isn't saved. So a Pick List never holds stock that
	isn't there, and the Delivery Note made from it always goes through."""
	from erp_dacsinc_custom.so_embroidery import PL_HOLD_QTY_FIELD

	if doc.docstatus != 0 or flt(doc.get(PL_HOLD_QTY_FIELD)) > EPS:
		return  # on hold for embroidery: so_embroidery guards its qty
	rows = [l for l in doc.get("locations") or [] if l.get("item_code") and l.get("warehouse") == HOLD_WAREHOUSE]
	if not rows:
		return
	items = {l.item_code for l in rows}
	have, holds = on_hand(items), holds_for(items)
	since, sos = _seniority(doc), {l.get("sales_order") for l in rows if l.get("sales_order")}
	cuts = []
	for item in items:
		mine = [l for l in rows if l.item_code == item]
		want = sum(flt(l.stock_qty) for l in mine)
		others = [h for h in holds.get(item, []) if h["doc"] != doc.name and not (h["kind"] == "earmark" and h["sales_order"] in sos)]
		me = {"kind": "draft", "doc": doc.name or "__this__", "sales_order": "", "qty": want, "since": since}
		gets = next(g for h, g in allocate(others + [me], have.get(item, 0)) if h is me)
		if gets >= want - EPS:
			continue
		cuts.append(_("{0}: {1} → {2} (only {2} of the {3} in {4} is free for this order)").format(
			frappe.bold(item), flt(want, 3), flt(gets, 3), flt(have.get(item, 0), 3), HOLD_WAREHOUSE))
		left = gets
		for l in mine:
			cf = flt(l.get("conversion_factor")) or 1
			take = min(flt(l.stock_qty), left)
			left -= take
			l.stock_qty = flt(take, 3)
			l.qty = flt(take / cf, 3)
	if not cuts:
		return
	doc.set("locations", [l for l in doc.locations if not (l.get("warehouse") == HOLD_WAREHOUSE and flt(l.stock_qty) <= EPS)])
	for i, l in enumerate(doc.locations, start=1):
		l.idx = i
	if not doc.locations:
		frappe.throw("<br>".join(cuts) + "<br><br>" + _("Nothing is free to pick. Stock held for older orders stays theirs; "
														 "pick this when stock arrives."), title=_("No free stock"))
	frappe.msgprint("<br>".join(cuts), title=_("Pick List cut to the free stock"), indicator="orange")


# ------------------------------------------------------------------ correcting existing Pick Lists
def correct_pick_lists(dry_run=0):
	"""Make every open Pick List claim only stock that is on the shelf (oldest claim first).
	- a draft is cut down to what it really gets (a draft with nothing left is deleted);
	- a submitted one goes back to draft (cancel + amend, keeping its place in the queue)
	  and is cut the same way; one that gets nothing is cancelled. Its draft Delivery
	  Notes, which can't be submitted anyway, are deleted first.
	- one already partly delivered, on a submitted Delivery Note, or with goods at the
	  embroidery jobber is left alone and reported.
	Every change is noted on the Pick List's Sales Order. dry_run=1 only reports.
	    bench --site <site> execute erp_dacsinc_custom.stock_hold.correct_pick_lists --kwargs "{'dry_run': 1}"
	"""
	from erp_dacsinc_custom.so_embroidery import PL_HOLD_QTY_FIELD, revert_pick_list_to_draft

	dry_run = frappe.utils.cint(dry_run)
	pls = frappe.get_all("Pick List", filters={"docstatus": ["<", 2], "status": ["not in", ["Completed", "Cancelled"]]}, pluck="name")
	missing = missing_by_pick_list(pls)
	docs = {n: frappe.get_doc("Pick List", n) for n in missing}
	# drafts first, so older submitted ones get their stock back when re-allocated
	order = sorted(missing, key=lambda n: (docs[n].docstatus, str(docs[n].creation)))
	report = []

	def note(pl, text):
		report.append(f"{pl.name}: {text}")
		if not dry_run:
			for so in {l.sales_order for l in pl.locations if l.sales_order}:
				frappe.get_doc("Sales Order", so).add_comment("Comment", _("Stock hold correction: {0} — {1}").format(pl.name, text))

	for name in order:
		# one Pick List at a time: one that can't be corrected is reported and skipped,
		# never stopping the rest (or a migrate running this as a patch)
		frappe.db.savepoint("dacs_pl_fix")
		mark = len(report)
		try:
			_correct_one(docs[name], flt(missing[name], 3), dry_run, report, note, PL_HOLD_QTY_FIELD, revert_pick_list_to_draft)
		except Exception as e:
			frappe.db.rollback(save_point="dacs_pl_fix")
			del report[mark:]  # nothing of it was kept
			report.append(f"{name}: could not be corrected ({frappe.utils.strip_html(str(e))[:160]}) — fix by hand")
			frappe.log_error(title=f"Stock hold correction failed for {name}", message=frappe.get_traceback())
	for line in report:
		print(line)
	return report


def _correct_one(pl, short, dry_run, report, note, PL_HOLD_QTY_FIELD, revert_pick_list_to_draft):
	name = pl.name
	if True:
		held = sum(flt(l.stock_qty) if pl.docstatus == 0 else max(0.0, flt(l.picked_qty) - flt(l.delivered_qty)) for l in pl.locations)
		if flt(pl.get(PL_HOLD_QTY_FIELD)) > EPS:
			report.append(f"{name}: left alone (goods at the embroidery jobber); {short} missing")
			return
		if pl.docstatus == 0:
			keep = flt(held - short, 3)
			if dry_run:
				note(pl, f"draft cut {held} → {keep}" if keep > EPS else f"draft deleted (nothing of {held} is free)")
				return
			if keep > EPS:
				pl.save()  # fit_pick_list_to_free cuts it
				note(pl, f"draft cut {held} → {sum(flt(l.stock_qty) for l in pl.locations)}: {short} was not on the shelf")
			else:
				note(pl, f"draft deleted: none of its {held} is on the shelf")
				frappe.delete_doc("Pick List", name, ignore_permissions=True)
			return
		if any(flt(l.delivered_qty) > EPS for l in pl.locations) or frappe.db.sql(
				"SELECT 1 FROM `tabDelivery Note Item` WHERE against_pick_list=%s AND docstatus=1 LIMIT 1", name):
			report.append(f"{name}: left alone (already partly delivered); {short} missing — fix by hand")
			return
		draft_dns = frappe.db.sql_list("SELECT DISTINCT parent FROM `tabDelivery Note Item` WHERE against_pick_list=%s AND docstatus=0", name)
		keep = flt(held - short, 3)
		if dry_run:
			what = f"back to draft for {keep}" if keep > EPS else "cancelled (nothing on the shelf)"
			note(pl, f"submitted, {held} picked, {short} not on the shelf → {what}" + (f"; draft DN {', '.join(draft_dns)} deleted" if draft_dns else ""))
			return
		for dn in draft_dns:
			frappe.delete_doc("Delivery Note", dn, ignore_permissions=True)
		if keep > EPS:
			new = revert_pick_list_to_draft(name)
			got = sum(flt(l.stock_qty) for l in frappe.get_doc("Pick List", new).locations)
			note(pl, f"{short} of the {held} picked was not on the shelf; back to draft as {new} for {got} — submit it and make the Delivery Note"
					 + (f" (draft DN {', '.join(draft_dns)} deleted: it could not be submitted)" if draft_dns else ""))
		else:
			pl.flags.ignore_links = True
			pl.cancel()
			note(pl, f"cancelled: none of the {held} picked is on the shelf — pick again when stock arrives"
					 + (f" (draft DN {', '.join(draft_dns)} deleted)" if draft_dns else ""))
