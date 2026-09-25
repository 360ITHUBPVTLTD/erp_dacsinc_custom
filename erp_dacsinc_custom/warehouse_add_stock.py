"""
Warehouse list view's "Add Stock" button (public/js/warehouse_list.js).

Adds the same qty of each item into each selected warehouse, for either
every enabled stock item or a chosen list, via submitted Material Receipt
Stock Entries.

Built for 100,000+ items: "All Items" x several warehouses can mean
hundreds of thousands of rows, which neither fits in one web request nor
submits as one Stock Entry. So:
  - the whitelisted call only validates and enqueues a background job on
    the "long" queue (one run per user at a time);
  - the job walks items in batches of ITEM_BATCH, doing bulk queries per
    batch (item details, last ledger rate, buying price) instead of
    per-item lookups;
  - rows are written as Stock Entries of at most ROWS_PER_ENTRY rows, each
    committed on its own. A failing entry is rolled back, logged to Error
    Log and reported; the run carries on with the next entry. Every entry
    of a run shares the remark "Bulk Add Stock <run id>" so the whole run
    can be listed/cancelled together;
  - progress is pushed to the user over realtime, and the final summary is
    sent both over realtime and as a Notification Log (bell icon), so it
    survives the user closing the page.

Rows ERPNext would reject are skipped up front and reported (not silently
dropped): variant templates, batch/serial items (they need a batch/serial
number), and item+warehouse pairs with no valuation rate. The rate check
mirrors erpnext.stock.stock_ledger.get_valuation_rate exactly as
StockEntry.set_basic_rate calls it: last SLE rate for that item in that
warehouse, else Item.valuation_rate, else Item.standard_rate, else a buying
Item Price in the company currency; a zero rate only matters when
perpetual inventory is on.

System Manager only — matches the button, which the Warehouse list view
only shows to that role.
"""

from urllib.parse import quote

import frappe
from frappe.utils import cint, flt, nowdate, strip_html

import erpnext

ROWS_PER_ENTRY = 200  # ~0.12s/row in ERPNext -> ~24s per entry; keeps stock locks well under the 50s lock-wait timeout (500 rows held them ~49s)
ITEM_BATCH = 1000
PROGRESS_EVENT = "dacsinc_add_stock_progress"
MAX_EXAMPLES = 20


@frappe.whitelist()
def add_stock_to_warehouses(warehouses, qty, all_items=0, item_codes=None):
	from frappe.utils.background_jobs import is_job_enqueued

	if "System Manager" not in frappe.get_roles():
		frappe.throw("Only a System Manager can add stock this way.", frappe.PermissionError)

	if isinstance(warehouses, str):
		warehouses = frappe.parse_json(warehouses)
	if isinstance(item_codes, str):
		item_codes = frappe.parse_json(item_codes)
	warehouses = list(dict.fromkeys(warehouses or []))
	item_codes = list(dict.fromkeys(item_codes or []))
	all_items = cint(all_items)

	if not warehouses:
		frappe.throw("Select at least one warehouse.")
	qty = flt(qty)
	if qty <= 0:
		frappe.throw("Quantity must be greater than zero.")
	if not all_items and not item_codes:
		frappe.throw("Select at least one item.")
	company = _validate_warehouses(warehouses)

	job_id = f"dacsinc_add_stock::{frappe.session.user}"
	if is_job_enqueued(job_id):
		frappe.throw("An Add Stock run you started is still in progress. Wait for it to finish.")

	item_count = (
		frappe.db.count("Item", {"is_stock_item": 1, "disabled": 0}) if all_items else len(item_codes)
	)
	run_id = frappe.generate_hash(length=8)
	frappe.enqueue(
		"erp_dacsinc_custom.warehouse_add_stock.run_add_stock",
		queue="long",
		# generous ceiling (~0.5s per row); a timeout would stop mid-run
		timeout=max(1500, int(item_count * len(warehouses) * 0.5)),
		job_id=job_id,
		run_id=run_id,
		warehouses=warehouses,
		qty=qty,
		all_items=all_items,
		item_codes=item_codes,
		company=company,
	)
	return {"run_id": run_id, "items": item_count, "warehouses": len(warehouses)}


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


def run_add_stock(run_id, warehouses, qty, all_items, item_codes, company):
	"""Background job. Runs as the user who clicked (frappe.enqueue carries the session user)."""
	run = _Run(run_id, warehouses, qty, company)
	try:
		if all_items:
			all_codes = frappe.get_all(
				"Item", filters={"is_stock_item": 1, "disabled": 0}, pluck="name", order_by="name asc"
			)
		else:
			all_codes = item_codes
		run.total_items = len(all_codes)

		for start in range(0, len(all_codes), ITEM_BATCH):
			run.add_batch(all_codes[start : start + ITEM_BATCH])
		run.flush()
	except Exception:
		frappe.db.rollback()
		run.fatal = frappe.log_error(title=f"Bulk Add Stock {run_id} stopped").name
	finally:
		run.finish()


class _Run:
	def __init__(self, run_id, warehouses, qty, company):
		self.run_id = run_id
		self.remark = f"Bulk Add Stock {run_id}"
		self.warehouses = warehouses
		self.qty = qty
		self.company = company
		self.currency = erpnext.get_company_currency(company)
		self.perpetual = cint(erpnext.is_perpetual_inventory_enabled(company))
		self.total_items = 0
		self.processed_items = 0
		self.buffer = []
		self.entries = []
		self.added_rows = 0
		self.skipped = {}  # reason -> {"count": n, "examples": [...]}
		self.failed = []  # {"rows": n, "error": str, "log": name}
		self.fatal = None

	def skip(self, reason, label):
		entry = self.skipped.setdefault(reason, {"count": 0, "examples": []})
		entry["count"] += 1
		if len(entry["examples"]) < MAX_EXAMPLES:
			entry["examples"].append(label)

	def add_batch(self, codes):
		items = {
			d.name: d
			for d in frappe.get_all(
				"Item",
				filters={"name": ["in", codes]},
				fields=[
					"name", "is_stock_item", "disabled", "has_variants",
					"has_batch_no", "has_serial_no", "valuation_rate", "standard_rate",
				],
			)
		}
		eligible = []
		for code in codes:
			item = items.get(code)
			if not item:
				self.skip("Item not found", code)
			elif item.disabled:
				self.skip("Item is disabled", code)
			elif not item.is_stock_item:
				self.skip("Not a stock item", code)
			elif item.has_variants:
				self.skip("Variant template — add stock to its variants", code)
			elif item.has_batch_no or item.has_serial_no:
				self.skip("Needs a batch / serial number", code)
			else:
				eligible.append(item)

		rates = self.get_rates(eligible) if self.perpetual else {}
		for item in eligible:
			for warehouse in self.warehouses:
				if self.perpetual and not rates.get((item.name, warehouse)):
					self.skip("No valuation rate — set one on the Item", f"{item.name} ({warehouse})")
					continue
				self.buffer.append({"item_code": item.name, "t_warehouse": warehouse, "qty": self.qty})
				if len(self.buffer) >= ROWS_PER_ENTRY:
					self.flush()

		self.processed_items += len(codes)
		self.publish_progress()

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
		buying_price = dict(
			frappe.db.sql(
				"""
				select item_code, max(price_list_rate) from `tabItem Price`
				where item_code in %(codes)s and buying = 1 and currency = %(currency)s
				group by item_code
				""",
				{"codes": codes, "currency": self.currency},
			)
		)

		rates = {}
		for item in items:
			fallback = flt(item.valuation_rate or item.standard_rate or buying_price.get(item.name))
			for warehouse in self.warehouses:
				key = (item.name, warehouse)
				rates[key] = sle_rate[key] if key in sle_rate else fallback
		return rates

	def flush(self):
		rows, self.buffer = self.buffer, []
		if not rows:
			return
		try:
			se = frappe.new_doc("Stock Entry")
			se.stock_entry_type = "Material Receipt"
			se.company = self.company
			se.posting_date = nowdate()
			se.remarks = self.remark
			for row in rows:
				se.append("items", row)
			se.insert()
			se.submit()
			frappe.db.commit()
			self.entries.append(se.name)
			self.added_rows += len(rows)
		except Exception as e:
			frappe.db.rollback()
			log = frappe.log_error(title=f"Bulk Add Stock {self.run_id}: entry of {len(rows)} rows failed")
			self.failed.append({"rows": len(rows), "error": strip_html(str(e))[:300], "log": log.name})
		finally:
			# frappe.throw/msgprint inside insert/submit pile up here over a long run
			frappe.local.message_log = []

	def publish_progress(self):
		frappe.publish_realtime(
			PROGRESS_EVENT,
			{
				"run_id": self.run_id,
				"processed": self.processed_items,
				"total": self.total_items,
				"added_rows": self.added_rows,
				"entries": len(self.entries),
			},
			user=frappe.session.user,
		)

	def summary_html(self):
		esc = frappe.utils.escape_html
		parts = [
			f"<p>Added <b>{self.added_rows}</b> row(s) (qty {self.qty} each) of "
			f"{self.processed_items} item(s) across {len(self.warehouses)} warehouse(s) "
			f"in <b>{len(self.entries)}</b> Stock Entr{'y' if len(self.entries) == 1 else 'ies'}.</p>"
		]
		if self.entries:
			route = f"/app/stock-entry?remarks={quote(self.remark)}"
			parts.append(f'<p><a href="{route}" target="_blank">View the Stock Entries of this run</a></p>')
		if self.fatal:
			parts.append(
				f"<p><b>The run stopped early</b> — see Error Log {esc(self.fatal)}. "
				"Everything listed above as added was saved.</p>"
			)
		if self.failed:
			parts.append(
				f"<p><b>{len(self.failed)} Stock Entr{'y' if len(self.failed) == 1 else 'ies'} failed</b> "
				f"({sum(f['rows'] for f in self.failed)} rows not added):</p><ul>"
			)
			for f in self.failed[:5]:
				parts.append(f"<li>{f['rows']} rows — {esc(f['error'])} (Error Log {esc(f['log'])})</li>")
			parts.append("</ul>")
		for reason, entry in self.skipped.items():
			more = entry["count"] - len(entry["examples"])
			parts.append(
				f"<p>Skipped {entry['count']} — {esc(reason)}:</p><ul>"
				+ "".join(f"<li>{esc(x)}</li>" for x in entry["examples"])
				+ (f"<li>… and {more} more</li>" if more > 0 else "")
				+ "</ul>"
			)
		return "".join(parts)

	def finish(self):
		html = self.summary_html()
		ok = self.added_rows and not self.failed and not self.fatal
		frappe.publish_realtime(
			PROGRESS_EVENT,
			{"run_id": self.run_id, "done": 1, "ok": 1 if ok else 0, "message": html},
			user=frappe.session.user,
		)
		try:
			frappe.get_doc(
				{
					"doctype": "Notification Log",
					"for_user": frappe.session.user,
					"type": "Alert",
					"subject": f"Add Stock finished — {self.added_rows} row(s) added"
					+ ("" if ok else " (see details)"),
					"email_content": html,
				}
			).insert(ignore_permissions=True)
			frappe.db.commit()
		except Exception:
			frappe.log_error(title=f"Bulk Add Stock {self.run_id}: summary notification failed")
