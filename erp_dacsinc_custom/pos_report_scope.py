"""Reports for POS logins: only their brands' items and their stores' warehouses.

Query / script reports read the whole company with their own SQL, so the Item and
Warehouse rules of pos_scope.py don't reach them (Stock Balance showed every brand and
every store's stock to a store manager). Here every report a POS user runs — on screen,
exported, or as a prepared report in the background — is cut after it is built:

- a row whose Item column (a Link to Item) holds an item outside the user's brands goes;
- a row whose POS Profile column holds another store goes (POS Store Manager; the POS
  Profile filter is set to their store first — e.g. POS Register);
- a row whose Warehouse column (a Link to Warehouse) holds a warehouse outside their
  stores goes (POS Store Manager: their stores' warehouses; POS Admin: every store's
  warehouse plus the supply warehouse, Admin Settings › POS Stock Requests);
- only stock / selling reports and the POS Register run at all for a POS login
  (check_pos_report) — finance, GST, HR, projects, manufacturing, CRM reports and stock
  valuation checks are refused;
- charts and summary cards are dropped when rows were removed (they were built from all rows);
- before the report runs, the Warehouse filter is set to the user's store when they have
  one store (or replaced when it names a warehouse outside theirs), so reports that add
  stock up across warehouses (Stock Ageing) or show warehouses as columns count only it.

Reports without such columns are untouched. Non-POS users are never touched.
Installed on every request and background job (hooks before_request / before_job):
frappe.desk.query_report.generate_report_result is what both the screen and prepared
reports call.
"""

import frappe

from erp_dacsinc_custom import pos_scope


# Reports a POS login may run at all (pos_scope.is_pos_staff): stock and selling reports
# (cut to their brands / stores below) and the POS Register — never finance, GST, HR,
# projects, manufacturing or CRM reports, nor stock valuation / accounting checks.
POS_REPORT_MODULES = ("Stock", "Selling")
POS_REPORTS_ALLOWED = ("POS Register", "Stock Balance Summary", "Store Cash Book")
POS_REPORTS_BLOCKED = ("COGS By Item Group", "Stock and Account Value Comparison", "Incorrect Stock Value Report",
					   "Incorrect Serial No Valuation", "Stock Ledger Variance", "Incorrect Balance Qty After Transaction")


def check_pos_report(report, user):
	if not pos_scope.is_pos_staff(user):
		return
	name, module = report.name, report.module
	if name in POS_REPORTS_ALLOWED or (module in POS_REPORT_MODULES and name not in POS_REPORTS_BLOCKED):
		return
	frappe.throw(frappe._("The report {0} is not available for POS logins.").format(frappe.bold(name)),
				 frappe.PermissionError)


def install(*args, **kwargs):
	import frappe.desk.query_report as qr

	if getattr(qr.generate_report_result, "_dacs_scoped", False):
		return
	original = qr.generate_report_result

	def generate_report_result(report, filters=None, user=None, custom_columns=None, is_tree=False, parent_field=None):
		check_pos_report(report, user or frappe.session.user)
		run = lambda f: original(report, filters=f, user=user, custom_columns=custom_columns,
								 is_tree=is_tree, parent_field=parent_field)
		scoped = filters
		try:
			scoped = scope_filters(filters, user or frappe.session.user)
		except Exception:
			frappe.log_error(title="POS report scope (filters)")
		if scoped is filters:
			res = run(filters)
		else:
			# the report's Warehouse filter may be a single warehouse or a list
			try:
				res = run(scoped)
			except Exception:
				w = scoped.get("warehouse")
				try:
					res = run(frappe._dict(scoped, warehouse=w if isinstance(w, list) else [w]))
				except Exception:
					res = run(filters)  # rows are still cut below
		try:
			return scope_result(res, user or frappe.session.user)
		except Exception:
			frappe.log_error(title="POS report scope")
			return res

	generate_report_result._dacs_scoped = True
	qr.generate_report_result = generate_report_result
	try:
		import frappe.core.doctype.prepared_report.prepared_report as pr
		pr.generate_report_result = generate_report_result
	except ImportError:
		pass


def _store_profiles(user):
	"""POS Store Manager: their stores (POS Profiles); None for anyone else (POS Admin: all)."""
	scope = pos_scope.get_scope(user, "POS Invoice")
	return set(scope[1]) if scope and scope[0] == "stores" else None


def _limits(user):
	"""(brands or None, warehouses or None) for a POS user; (None, None) for anyone else."""
	brands = pos_scope._scope_brands(pos_scope.get_scope(user, "Item"))
	wscope = pos_scope.get_scope(user, "Warehouse")
	warehouses = None
	if wscope:
		if wscope[0] == "all":
			warehouses = set(pos_scope.all_store_warehouses())
			source = frappe.db.get_single_value("Admin Settings", "pos_stock_source_warehouse")
			if source:
				warehouses.add(source)
		else:
			warehouses = set(pos_scope.store_warehouses(wscope[1]))
	return brands, warehouses


def scope_filters(filters, user):
	"""Before the report runs: a POS user's Warehouse filter is always one of their
	warehouses (their store when they have one) — reports that add stock up across
	warehouses, or show warehouses as columns, then only count their store."""
	brands, warehouses = _limits(user)
	stores = _store_profiles(user)
	if not warehouses and not stores:
		return filters
	if isinstance(filters, str):
		filters = frappe.parse_json(filters or "{}")
	filters = frappe._dict(filters or {})
	if stores and filters.get("pos_profile") not in stores:
		filters["pos_profile"] = sorted(stores)[0]  # e.g. POS Register: their store
	if not warehouses:
		return filters
	chosen = filters.get("warehouse")
	chosen_list = chosen if isinstance(chosen, list) else ([chosen] if chosen else [])
	if chosen_list and all(w in warehouses for w in chosen_list):
		return filters
	if len(warehouses) == 1 or chosen_list:
		mine = sorted(warehouses)[0] if len(warehouses) == 1 else sorted(w for w in warehouses)[0]
		filters["warehouse"] = [mine] if isinstance(chosen, list) else mine
	return filters


def _link_columns(columns):
	"""{'Item': [key…], 'Warehouse': [key…]} — key is the fieldname (dict rows) and index (list rows)."""
	out = {"Item": [], "Warehouse": [], "POS Profile": []}
	for i, c in enumerate(columns or []):
		if isinstance(c, dict):
			ftype, opts, fname = c.get("fieldtype"), c.get("options"), c.get("fieldname")
		else:  # "Label:Link/Item:150"
			parts = str(c).split(":")
			typ = parts[1] if len(parts) > 1 else ""
			ftype, _, opts = typ.partition("/")
			fname = frappe.scrub(parts[0])
		if ftype == "Link" and opts in out:
			out[opts].append((fname, i))
	return out


def scope_result(res, user):
	if not isinstance(res, dict) or not res.get("result"):
		return res
	brands, warehouses = _limits(user)
	stores = _store_profiles(user)
	if brands is None and warehouses is None and stores is None:
		return res
	cols = _link_columns(res.get("columns"))
	if not (cols["Item"] and brands is not None) and not (cols["Warehouse"] and warehouses is not None) \
			and not (cols["POS Profile"] and stores is not None):
		return res

	def values(row, keys):
		if isinstance(row, dict):
			return [row.get(f) for f, _i in keys]
		if isinstance(row, (list, tuple)):
			return [row[i] if i < len(row) else None for _f, i in keys]
		return []

	rows = res["result"]
	item_brand = {}
	if brands is not None and cols["Item"]:
		codes = {v for r in rows for v in values(r, cols["Item"]) if v}
		for chunk in [list(codes)[i:i + 2000] for i in range(0, len(codes), 2000)]:
			item_brand.update(dict(frappe.get_all("Item", filters={"name": ["in", chunk]}, fields=["name", "brand"], as_list=True)))

	def keep(row):
		if brands is not None:
			for v in values(row, cols["Item"]):
				if v and item_brand.get(v) not in brands:
					return False
		if warehouses is not None:
			for v in values(row, cols["Warehouse"]):
				if v and v not in warehouses:
					return False
		if stores is not None:
			for v in values(row, cols["POS Profile"]):
				if v and v not in stores:
					return False
		return True

	kept = [r for r in rows if keep(r)]
	if len(kept) != len(rows):
		res["result"] = kept
		res["chart"] = None
		res["report_summary"] = None
	return res
