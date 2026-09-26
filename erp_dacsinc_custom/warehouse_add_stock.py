"""
Warehouse list view's "Add Stock" button (public/js/warehouse_list.js).

Adds the same qty of each item into each selected warehouse, for either
every enabled stock item or a chosen list, via submitted Material Receipt
Stock Entries — in the background.

Built for a million items and more. At ~0.12 s per stock row in ERPNext, a
million items is ~33 hours per warehouse, far beyond what one job, one
request or one worker's uptime can be trusted with. So a run is:

  * CHUNKED — a lane processes about CHUNK_ROWS rows, then enqueues its own
    next chunk. No job ever runs for hours; a worker restart only
    interrupts the chunk in hand.
  * RESUMABLE, WITHOUT DUPLICATES — items are walked in name order from a
    saved cursor (keyset, never OFFSET, never all names in memory). Every
    Stock Entry holds COMPLETE items (all their warehouses), and the lane's
    cursor is saved in the same commit as the entry. So after a crash the
    lane restarts exactly after the last committed item: nothing added
    twice, nothing missed. A failed entry is rolled back, logged and
    reported, and the cursor moves past it (a bad item never blocks a run).
  * PARALLEL — the item range is split into lanes, one per worker listening
    to the "long" queue (at most MAX_LANES). Lanes touch different items, so
    they never wait on each other's stock rows.
  * VISIBLE & CONTROLLABLE — run state lives in the database (DefaultValue
    rows under STATE_PARENT, no migration needed): the button shows live
    progress of a running run, with Stop, and Resume when a lane has
    stalled (no heartbeat and no job queued, e.g. after a restart).
    Progress is pushed over realtime; the final summary goes out over
    realtime AND as a Notification Log (bell), so closing the page loses
    nothing. Every entry of a run has the remark "Bulk Add Stock <run id>".

Rows ERPNext would reject are skipped up front and reported (not silently
dropped): variant templates, batch/serial items (they need a batch/serial
number), and item+warehouse pairs with no valuation rate. The rate check
mirrors erpnext.stock.stock_ledger.get_valuation_rate as
StockEntry.set_basic_rate calls it: last SLE rate for that item in that
warehouse, else Item.valuation_rate, else Item.standard_rate, else a buying
Item Price in the company currency; a zero rate only matters when perpetual
inventory is on.

System Manager only — matches the button, which the Warehouse list view
only shows to that role.
"""

import json
from urllib.parse import quote

import frappe
from frappe.utils import cint, flt, now_datetime, nowdate, strip_html, time_diff_in_seconds

import erpnext

ROWS_PER_ENTRY = 200  # ~0.12s/row -> ~24s per entry; keeps stock locks well under the 50s lock-wait timeout
CHUNK_ROWS = 3000  # rows one chunk job handles (~6 min) before it enqueues the next
ITEM_BATCH = 1000  # items read per query
MAX_LANES = 4
MIN_ITEMS_PER_LANE = 2000  # small runs stay single-lane
PROGRESS_EVENT = "dacsinc_add_stock_progress"
MAX_EXAMPLES = 20
STATE_PARENT = "__dacsinc_add_stock"
STALL_SECONDS = 15 * 60


# ---------------------------------------------------------------- state
def _key_row(defkey):
	return frappe.db.get_value("DefaultValue", {"parent": STATE_PARENT, "defkey": defkey}, "name")


def _load(defkey, for_update=False):
	name = _key_row(defkey)
	if not name:
		return None
	if for_update:
		value = frappe.db.sql("select defvalue from tabDefaultValue where name=%s for update", name)[0][0]
	else:
		value = frappe.db.get_value("DefaultValue", name, "defvalue")
	return json.loads(value or "{}")


def _save(defkey, data):
	name = _key_row(defkey)
	value = json.dumps(data, default=str)
	if name:
		frappe.db.set_value("DefaultValue", name, "defvalue", value, update_modified=False)
	else:
		frappe.get_doc({
			"doctype": "DefaultValue", "parent": STATE_PARENT, "parenttype": "__default",
			"parentfield": "system_defaults", "defkey": defkey, "defvalue": value,
		}).insert(ignore_permissions=True)


def _lanes(run):
	return [_load(f"{run['run_id']}:{i}") or {} for i in range(run["lanes"])]


def _long_workers():
	try:
		from frappe.utils.background_jobs import get_queue, get_workers
		return len(get_workers(get_queue("long")))
	except Exception:
		return 1


# ---------------------------------------------------------------- start
@frappe.whitelist()
def add_stock_to_warehouses(warehouses, qty, all_items=0, item_codes=None, no_rate_action="skip", fallback_rate=0):
	if "System Manager" not in frappe.get_roles():
		frappe.throw("Only a System Manager can add stock this way.", frappe.PermissionError)

	if isinstance(warehouses, str):
		warehouses = frappe.parse_json(warehouses)
	if isinstance(item_codes, str):
		item_codes = frappe.parse_json(item_codes)
	warehouses = list(dict.fromkeys(warehouses or []))
	item_codes = sorted(set(item_codes or []))
	all_items = cint(all_items)

	if not warehouses:
		frappe.throw("Select at least one warehouse.")
	qty = flt(qty)
	if qty <= 0:
		frappe.throw("Quantity must be greater than zero.")
	if not all_items and not item_codes:
		frappe.throw("Select at least one item.")
	company = _validate_warehouses(warehouses)
	# Items with no valuation rate (only matters with perpetual inventory):
	#   skip — report them;  zero — add at zero value (allow_zero_valuation_rate);
	#   rate — add at `fallback_rate` (items WITH a rate always keep their own).
	no_rate_action = no_rate_action if no_rate_action in ("skip", "zero", "rate") else "skip"
	fallback_rate = flt(fallback_rate)
	if no_rate_action == "rate" and fallback_rate <= 0:
		frappe.throw("Enter the rate to use for items that have no valuation rate.")

	current = _current_run(frappe.session.user)
	if current and current.get("status") in ("running", "stopping"):
		frappe.throw("An Add Stock run you started is still in progress — open Add Stock to see it, stop it or resume it.")

	total = frappe.db.count("Item", {"is_stock_item": 1, "disabled": 0}) if all_items else len(item_codes)
	lanes = max(1, min(MAX_LANES, _long_workers(), max(1, total // MIN_ITEMS_PER_LANE)))
	bounds = _lane_bounds(all_items, item_codes, total, lanes)
	lanes = len(bounds)

	run_id = frappe.generate_hash(length=8)
	run = {
		"run_id": run_id, "user": frappe.session.user, "warehouses": warehouses, "qty": qty,
		"all_items": all_items, "item_codes": item_codes if not all_items else [],
		"company": company, "lanes": lanes, "total_items": total, "status": "running",
		"no_rate_action": no_rate_action, "fallback_rate": fallback_rate,
		"started": str(now_datetime()), "remark": f"Bulk Add Stock {run_id}",
	}
	_save(run_id, run)
	for i, (start_after, end_at) in enumerate(bounds):
		_save(f"{run_id}:{i}", {
			"lane": i, "cursor": start_after, "end_at": end_at, "processed": 0, "added_rows": 0,
			"entries": 0, "first_entry": None, "last_entry": None, "skipped": {}, "failed": [],
			"done": False, "heartbeat": str(now_datetime()), "seq": 0,
		})
	_save(f"user:{frappe.session.user}", {"run_id": run_id})
	frappe.db.commit()
	for i in range(lanes):
		_enqueue_lane(run_id, i, 0)
	return {"run_id": run_id, "items": total, "warehouses": len(warehouses), "lanes": lanes}


def _validate_warehouses(warehouses):
	rows = frappe.get_all(
		"Warehouse",
		filters={"name": ["in", warehouses]},
		fields=["name", "company", "is_group", "disabled"],
	)
	by_name = {d.name: d for d in rows}
	for name in warehouses:
		wh = by_name.get(name)
		if not wh:
			frappe.throw(f"Warehouse {name} does not exist.")
		if wh.is_group:
			frappe.throw(f"Warehouse {name} is a group warehouse — stock can only go into a leaf warehouse.")
		if wh.disabled:
			frappe.throw(f"Warehouse {name} is disabled.")
	companies = {d.company for d in rows}
	if len(companies) > 1:
		frappe.throw("All selected warehouses must belong to the same company.")
	return companies.pop()


def _lane_bounds(all_items, item_codes, total, lanes):
	"""[(start_after, end_at)] per lane over item names in order; '' = from the start, None = to the end."""
	if lanes <= 1 or total <= 1:
		return [("", None)]
	cuts = []
	for i in range(1, lanes):
		k = total * i // lanes - 1
		if all_items:
			name = frappe.db.sql(
				"select name from tabItem where is_stock_item=1 and disabled=0 order by name limit 1 offset %s", k
			)
			cuts.append(name[0][0] if name else None)
		else:
			cuts.append(item_codes[k])
	cuts = [c for c in dict.fromkeys(cuts) if c]
	starts = [""] + cuts
	ends = cuts + [None]
	return list(zip(starts, ends))


def _enqueue_lane(run_id, lane, seq):
	frappe.enqueue(
		"erp_dacsinc_custom.warehouse_add_stock.run_lane_chunk",
		queue="long",
		timeout=max(1800, int(CHUNK_ROWS * 0.6)),
		job_id=f"dacsinc_add_stock::{run_id}::{lane}::{seq}",
		enqueue_after_commit=True,
		run_id=run_id,
		lane=lane,
	)


# ---------------------------------------------------------------- worker
def run_lane_chunk(run_id, lane):
	"""Background job: one chunk of one lane, then the next chunk is enqueued."""
	run = _load(run_id)
	state = _load(f"{run_id}:{lane}")
	if not run or not state or state.get("done"):
		return
	worker = _Lane(run, state)
	try:
		more = worker.work_chunk()
	except Exception:
		frappe.db.rollback()
		state = _load(f"{run_id}:{lane}") or state
		state.setdefault("failed", []).append({"rows": 0, "error": "lane stopped unexpectedly",
		                                       "log": frappe.log_error(title=f"Bulk Add Stock {run_id} lane {lane} stopped").name})
		state["heartbeat"] = str(now_datetime())
		_save(f"{run_id}:{lane}", state)
		frappe.db.commit()
		return  # left not-done: shows as stalled -> Resume
	if more:
		state = _load(f"{run_id}:{lane}")
		state["seq"] = cint(state.get("seq")) + 1
		_save(f"{run_id}:{lane}", state)
		frappe.db.commit()
		_enqueue_lane(run_id, lane, state["seq"])
		frappe.db.commit()
	else:
		_maybe_finish(run_id)


class _Lane:
	def __init__(self, run, state):
		self.run = run
		self.s = state
		self.key = f"{run['run_id']}:{state['lane']}"
		self.warehouses = run["warehouses"]
		self.qty = flt(run["qty"])
		self.company = run["company"]
		self.currency = erpnext.get_company_currency(self.company)
		self.perpetual = cint(erpnext.is_perpetual_inventory_enabled(self.company))
		self.items_per_entry = max(1, ROWS_PER_ENTRY // max(1, len(self.warehouses)))
		self.chunk_items = max(self.items_per_entry, CHUNK_ROWS // max(1, len(self.warehouses)))
		self.no_rate_action = run.get("no_rate_action") or "skip"
		self.fallback_rate = flt(run.get("fallback_rate"))

	# -- item stream (keyset from the saved cursor, bounded by end_at)
	def next_items(self, after, limit):
		if self.run["all_items"]:
			cond, args = ["is_stock_item = 1", "disabled = 0", "name > %(after)s"], {"after": after or "", "limit": limit}
			if self.s.get("end_at"):
				cond.append("name <= %(end)s")
				args["end"] = self.s["end_at"]
			return frappe.db.sql(f"""
				select name, is_stock_item, disabled, has_variants, has_batch_no, has_serial_no,
				       valuation_rate, standard_rate
				from tabItem where {' and '.join(cond)} order by name limit %(limit)s""", args, as_dict=1)
		codes = [c for c in self.run["item_codes"] if c > (after or "") and (not self.s.get("end_at") or c <= self.s["end_at"])][:limit]
		if not codes:
			return []
		found = {d.name: d for d in frappe.get_all("Item", filters={"name": ["in", codes]}, fields=[
			"name", "is_stock_item", "disabled", "has_variants", "has_batch_no", "has_serial_no",
			"valuation_rate", "standard_rate"])}
		return [found.get(c) or frappe._dict(name=c, missing=1) for c in codes]

	def skip(self, pending, reason, label):
		entry = pending.setdefault(reason, {"count": 0, "examples": []})
		entry["count"] += 1
		if len(entry["examples"]) < MAX_EXAMPLES:
			entry["examples"].append(label)

	def work_chunk(self):
		"""Returns True when this lane has more to do."""
		done_items = 0
		while done_items < self.chunk_items:
			if (_load(self.run["run_id"]) or {}).get("status") == "stopping":
				self.s["done"] = True
				self.s["stopped"] = True
				self.commit_state()
				return False
			batch = self.next_items(self.s.get("cursor"), min(ITEM_BATCH, self.chunk_items - done_items))
			if not batch:
				self.s["done"] = True
				self.commit_state()
				return False
			self.process_batch(batch)
			done_items += len(batch)
		return True

	def process_batch(self, batch):
		eligible = [d for d in batch if not d.get("missing") and not d.disabled and d.is_stock_item
		            and not d.has_variants and not d.has_batch_no and not d.has_serial_no]
		rates = self.get_rates(eligible) if self.perpetual else {}
		group, rows, pending_skips = [], [], {}
		for item in batch:
			reason = None
			if item.get("missing"):
				reason = "Item not found"
			elif item.disabled:
				reason = "Item is disabled"
			elif not item.is_stock_item:
				reason = "Not a stock item"
			elif item.has_variants:
				reason = "Variant template — add stock to its variants"
			elif item.has_batch_no or item.has_serial_no:
				reason = "Needs a batch / serial number"
			if reason:
				self.skip(pending_skips, reason, item.name)
			else:
				for wh in self.warehouses:
					row = {"item_code": item.name, "t_warehouse": wh, "qty": self.qty}
					if self.perpetual and not rates.get((item.name, wh)):
						if self.no_rate_action == "zero":
							row["allow_zero_valuation_rate"] = 1
						elif self.no_rate_action == "rate":
							row["basic_rate"] = self.fallback_rate
							row["set_basic_rate_manually"] = 1
						else:
							self.skip(pending_skips, "No valuation rate — set one on the Item", f"{item.name} ({wh})")
							continue
					rows.append(row)
			group.append(item.name)
			if len(group) >= self.items_per_entry:
				self.commit_entry(group, rows, pending_skips)
				group, rows, pending_skips = [], [], {}
		if group:
			self.commit_entry(group, rows, pending_skips)

	def commit_entry(self, group, rows, pending_skips):
		"""One Stock Entry for complete items + the cursor past them, in ONE commit."""
		entry = None
		if rows:
			try:
				se = frappe.new_doc("Stock Entry")
				se.stock_entry_type = "Material Receipt"
				se.company = self.company
				se.posting_date = nowdate()
				se.remarks = self.run["remark"]
				for row in rows:
					se.append("items", row)
				se.insert()
				se.submit()
				entry = se.name
			except Exception as e:
				frappe.db.rollback()
				log = frappe.log_error(title=f"Bulk Add Stock {self.run['run_id']}: entry of {len(rows)} rows failed")
				fails = self.s.setdefault("failed", [])
				if len(fails) < 50:
					fails.append({"rows": len(rows), "error": strip_html(str(e))[:300], "log": log.name,
					              "items": f"{group[0]} … {group[-1]}"})
				self.s["failed_rows"] = cint(self.s.get("failed_rows")) + len(rows)
			finally:
				frappe.local.message_log = []
		if entry:
			self.s["zero_rows"] = cint(self.s.get("zero_rows")) + sum(1 for r in rows if r.get("allow_zero_valuation_rate"))
			self.s["rate_rows"] = cint(self.s.get("rate_rows")) + sum(1 for r in rows if r.get("set_basic_rate_manually"))
			self.s["added_rows"] = cint(self.s.get("added_rows")) + len(rows)
			self.s["entries"] = cint(self.s.get("entries")) + 1
			self.s["first_entry"] = self.s.get("first_entry") or entry
			self.s["last_entry"] = entry
		for reason, e in pending_skips.items():
			tgt = self.s.setdefault("skipped", {}).setdefault(reason, {"count": 0, "examples": []})
			tgt["count"] += e["count"]
			tgt["examples"] = (tgt["examples"] + e["examples"])[:MAX_EXAMPLES]
		self.s["processed"] = cint(self.s.get("processed")) + len(group)
		self.s["cursor"] = group[-1]
		self.commit_state()

	def commit_state(self):
		self.s["heartbeat"] = str(now_datetime())
		_save(self.key, self.s)
		frappe.db.commit()
		_publish_progress(self.run)

	def get_rates(self, items):
		"""(item_code, warehouse) -> the rate get_valuation_rate would return, in bulk."""
		if not items:
			return {}
		codes = [d.name for d in items]
		last_sle = frappe.db.sql(
			"""
			select item_code, warehouse, valuation_rate from (
				select item_code, warehouse, valuation_rate,
					row_number() over (
						partition by item_code, warehouse
						order by posting_datetime desc, creation desc
					) as rn
				from `tabStock Ledger Entry`
				where item_code in %(codes)s and warehouse in %(warehouses)s
					and valuation_rate >= 0 and is_cancelled = 0
			) t where rn = 1
			""",
			{"codes": codes, "warehouses": self.warehouses},
		)
		sle_rate = {(code, wh): flt(rate) for code, wh, rate in last_sle}
		buying_price = dict(frappe.db.sql(
			"""
			select item_code, max(price_list_rate) from `tabItem Price`
			where item_code in %(codes)s and buying = 1 and currency = %(currency)s
			group by item_code
			""",
			{"codes": codes, "currency": self.currency},
		))
		rates = {}
		for item in items:
			fallback = flt(item.valuation_rate or item.standard_rate or buying_price.get(item.name))
			for wh in self.warehouses:
				key = (item.name, wh)
				rates[key] = sle_rate[key] if key in sle_rate else fallback
		return rates


# ---------------------------------------------------------------- progress / finish
def _totals(run, lanes):
	t = {"processed": 0, "added_rows": 0, "entries": 0, "failed_rows": 0, "lanes_done": 0}
	for s in lanes:
		t["processed"] += cint(s.get("processed"))
		t["added_rows"] += cint(s.get("added_rows"))
		t["entries"] += cint(s.get("entries"))
		t["failed_rows"] += cint(s.get("failed_rows"))
		t["lanes_done"] += 1 if s.get("done") else 0
	return t


def _publish_progress(run):
	t = _totals(run, _lanes(run))
	frappe.publish_realtime(PROGRESS_EVENT, {
		"run_id": run["run_id"], "processed": t["processed"], "total": run["total_items"],
		"added_rows": t["added_rows"], "entries": t["entries"],
	}, user=run["user"])


def _maybe_finish(run_id):
	run = _load(run_id, for_update=True)  # serialises the last lanes finishing together
	if not run or run.get("status") in ("done", "stopped"):
		frappe.db.commit()
		return
	lanes = _lanes(run)
	if not all(s.get("done") for s in lanes):
		frappe.db.commit()
		return
	run["status"] = "stopped" if any(s.get("stopped") for s in lanes) else "done"
	run["finished"] = str(now_datetime())
	_save(run_id, run)
	frappe.db.commit()
	html, ok = _summary_html(run, lanes)
	frappe.publish_realtime(PROGRESS_EVENT, {"run_id": run_id, "done": 1, "ok": 1 if ok else 0, "message": html},
	                        user=run["user"])
	try:
		t = _totals(run, lanes)
		frappe.get_doc({
			"doctype": "Notification Log", "for_user": run["user"], "type": "Alert",
			"subject": f"Add Stock {'stopped' if run['status'] == 'stopped' else 'finished'} — {t['added_rows']} row(s) added"
			+ ("" if ok else " (see details)"),
			"email_content": html,
		}).insert(ignore_permissions=True)
		frappe.db.commit()
	except Exception:
		frappe.log_error(title=f"Bulk Add Stock {run_id}: summary notification failed")


def _summary_html(run, lanes):
	esc = frappe.utils.escape_html
	t = _totals(run, lanes)
	n_wh = len(run["warehouses"])
	parts = [
		f"<p>Added <b>{t['added_rows']}</b> row(s) (qty {run['qty']} each) for "
		f"{t['processed']} of {run['total_items']} item(s) across {n_wh} warehouse(s) "
		f"in <b>{t['entries']}</b> Stock Entr{'y' if t['entries'] == 1 else 'ies'}.</p>"
	]
	zero = sum(cint(s.get("zero_rows")) for s in lanes)
	at_rate = sum(cint(s.get("rate_rows")) for s in lanes)
	if zero:
		parts.append(f"<p>{zero} row(s) had no valuation rate and were added at <b>zero value</b>.</p>")
	if at_rate:
		parts.append(f"<p>{at_rate} row(s) had no valuation rate and were added at <b>{flt(run.get('fallback_rate'))}</b> per unit.</p>")
	if run.get("status") == "stopped":
		parts.append("<p><b>Stopped on request</b> — everything counted above was saved.</p>")
	if t["entries"]:
		parts.append(f'<p><a href="/app/stock-entry?remarks={quote(run["remark"])}" target="_blank">View the Stock Entries of this run</a></p>')
	failed = [f for s in lanes for f in (s.get("failed") or [])]
	if failed:
		parts.append(f"<p><b>{len(failed)} problem(s)</b> ({t['failed_rows']} rows not added):</p><ul>")
		for f in failed[:5]:
			parts.append(f"<li>{f.get('rows', 0)} rows {esc(f.get('items', ''))} — {esc(f['error'])} (Error Log {esc(f['log'])})</li>")
		parts.append("</ul>")
	skipped = {}
	for s in lanes:
		for reason, e in (s.get("skipped") or {}).items():
			tgt = skipped.setdefault(reason, {"count": 0, "examples": []})
			tgt["count"] += e["count"]
			tgt["examples"] = (tgt["examples"] + e["examples"])[:MAX_EXAMPLES]
	for reason, e in skipped.items():
		more = e["count"] - len(e["examples"])
		parts.append(
			f"<p>Skipped {e['count']} — {esc(reason)}:</p><ul>"
			+ "".join(f"<li>{esc(x)}</li>" for x in e["examples"])
			+ (f"<li>… and {more} more</li>" if more > 0 else "") + "</ul>"
		)
	ok = t["added_rows"] and not failed and run.get("status") == "done"
	return "".join(parts), ok


# ---------------------------------------------------------------- status / stop / resume
def _current_run(user):
	ptr = _load(f"user:{user}")
	return _load(ptr["run_id"]) if ptr and ptr.get("run_id") else None


def _lane_queued(run_id, lane, seq):
	from frappe.utils.background_jobs import is_job_enqueued
	try:
		return is_job_enqueued(f"dacsinc_add_stock::{run_id}::{lane}::{seq}")
	except Exception:
		return False


@frappe.whitelist()
def get_add_stock_status():
	"""The caller's current (or last) run: progress, per-lane state, and whether it can be resumed."""
	if "System Manager" not in frappe.get_roles():
		frappe.throw("Only a System Manager can add stock this way.", frappe.PermissionError)
	run = _current_run(frappe.session.user)
	if not run:
		return None
	lanes = _lanes(run)
	now = now_datetime()
	stalled = []
	for s in lanes:
		if s.get("done") or run["status"] not in ("running", "stopping"):
			continue
		idle = time_diff_in_seconds(now, s.get("heartbeat") or run["started"])
		if idle > STALL_SECONDS and not _lane_queued(run["run_id"], s["lane"], cint(s.get("seq"))):
			stalled.append(s["lane"])
	t = _totals(run, lanes)
	elapsed = time_diff_in_seconds(now, run["started"])
	rate = (t["processed"] / elapsed) if elapsed > 0 else 0
	remaining = run["total_items"] - t["processed"]
	return {
		"run_id": run["run_id"], "status": run["status"], "warehouses": run["warehouses"], "qty": run["qty"],
		"total": run["total_items"], "lanes": run["lanes"], "started": run["started"], "finished": run.get("finished"),
		**t, "stalled_lanes": stalled,
		"eta_seconds": int(remaining / rate) if rate > 0 and run["status"] == "running" else None,
		"remark": run["remark"],
	}


@frappe.whitelist()
def stop_add_stock(run_id):
	"""Ask every lane to stop after the Stock Entry in hand (nothing half-done)."""
	run = _load(run_id)
	if not run or run["user"] != frappe.session.user:
		frappe.throw("Run not found.")
	if run["status"] == "running":
		run["status"] = "stopping"
		_save(run_id, run)
		frappe.db.commit()
	# lanes that are not running any more finish the run right away
	for s in _lanes(run):
		if not s.get("done") and not _lane_queued(run_id, s["lane"], cint(s.get("seq"))):
			s["done"] = True
			s["stopped"] = True
			_save(f"{run_id}:{s['lane']}", s)
	frappe.db.commit()
	_maybe_finish(run_id)
	return get_add_stock_status()


@frappe.whitelist()
def resume_add_stock(run_id):
	"""Re-enqueue lanes that stalled (e.g. a worker restart) — they continue from their saved cursor."""
	run = _load(run_id)
	if not run or run["user"] != frappe.session.user:
		frappe.throw("Run not found.")
	if run["status"] not in ("running", "stopping"):
		frappe.throw("This run has already finished.")
	resumed = 0
	for s in _lanes(run):
		if s.get("done") or _lane_queued(run_id, s["lane"], cint(s.get("seq"))):
			continue
		s["seq"] = cint(s.get("seq")) + 1
		s["heartbeat"] = str(now_datetime())
		# the interruption itself lost nothing (work after the last commit is
		# redone from the cursor), so it is not reported as a failure
		s["failed"] = [f for f in (s.get("failed") or []) if cint(f.get("rows"))]
		_save(f"{run_id}:{s['lane']}", s)
		frappe.db.commit()
		_enqueue_lane(run_id, s["lane"], s["seq"])
		resumed += 1
	frappe.db.commit()
	return {"resumed": resumed, **(get_add_stock_status() or {})}
