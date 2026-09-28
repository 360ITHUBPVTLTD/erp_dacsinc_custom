"""Store-wise scoping for the POS roles.

A store is a POS Profile. A user's stores are the POS Profiles that list them
under "Applicable for Users" (POS Profile User).

Who is scoped: a user holding POS Admin and/or POS Store Manager and no other
access sheet role (a broader role, e.g. DAC CRM, keeps its normal view). Admins
are never scoped.

- **POS Admin** sees every store's POS Invoices / Opening / Closing Entries and
  POS Profiles, but only *POS customers*: customers with a POS Store set.
- **POS Store Manager** sees only their stores' POS Invoices / Opening / Closing
  Entries and POS Profiles, and only their stores' customers (plus customers they
  created themselves).

Customer › POS Store (``custom_pos_store``) is filled automatically:

- a customer created by POS staff (a scoped user, never an admin) → that user's first store;
- the first POS Invoice for a customer with no store → that invoice's store;
- ``backfill()`` (run once from a patch) → each store's default customer, customers
  on existing POS Invoices, and customers created by a store's users.

Off until the access sheet is switched on (``access_sync.is_active``). These
rules only narrow what the sheet's rights already allow: the hooks never
grant anything (Frappe's has_permission hooks can only deny).
"""

import frappe

POS_ROLES = ("POS Admin", "POS Store Manager")
STORE_FIELD = "custom_pos_store"
STORE_DOCTYPES = ("POS Invoice", "POS Opening Entry", "POS Closing Entry")


def ensure_field():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({"Material Request": [{
		"fieldname": "custom_stock_panel", "fieldtype": "HTML", "label": "Stock at the selected warehouses",
		"insert_after": "custom_description",
	}], "Customer": [{
		"fieldname": STORE_FIELD, "fieldtype": "Link", "options": "POS Profile", "label": "POS Store",
		"insert_after": "customer_group", "in_standard_filter": 1,
		"description": "Store (POS Profile) this customer belongs to. Set automatically for POS customers; "
					   "POS Admin sees customers with a store, a POS Store Manager only their stores' customers.",
	}]}, update=True)


def _user_stores(user):
	return frappe.get_all("POS Profile User", filters={"user": user}, pluck="parent", order_by="idx asc")


def is_pos_staff(user):
	"""POS Admin / POS Store Manager with no other sheet role, and not an admin.
	(Whether or not the scope is switched on — used to fill the POS Store.)"""
	from erp_dacsinc_custom.order_flow_permissions import is_admin
	from erp_dacsinc_custom.access_sync import sheet_roles

	if user in ("Administrator", "Guest") or is_admin(user):
		return False
	roles = set(frappe.get_roles(user))
	return bool(roles & set(POS_ROLES)) and not roles & (set(sheet_roles()) - set(POS_ROLES))


def _other_roles_read(user, doctype):
	"""Does any of the user's roles other than the POS roles read `doctype` by itself?"""
	roles = set(frappe.get_roles(user)) - set(POS_ROLES) - {"All", "Guest", "Desk User"}
	if not roles:
		return False
	table = "tabCustom DocPerm" if frappe.db.exists("Custom DocPerm", {"parent": doctype}) else "tabDocPerm"
	return bool(frappe.db.sql(f"""select 1 from `{table}` where parent=%(dt)s and permlevel=0 and `read`=1
		and if_owner=0 and role in %(roles)s limit 1""", {"dt": doctype, "roles": list(roles)}))


def get_scope(user=None, doctype=None):
	"""None (not limited) | ("all", None) for POS Admin | ("stores", [profiles]) for POS Store Manager.

	Per document type: a POS user is limited on `doctype` unless another of their
	roles reads it by itself (e.g. DAC CRM on Customer). Admins are never limited."""
	user = user or frappe.session.user
	if not hasattr(frappe.local, "pos_scope_cache"):
		frappe.local.pos_scope_cache = {}
	cache = frappe.local.pos_scope_cache
	key = (user, doctype)
	if key in cache:
		return cache[key]
	scope = None
	from erp_dacsinc_custom.access_sync import is_active
	from erp_dacsinc_custom.order_flow_permissions import is_admin

	if is_active() and user not in ("Administrator", "Guest") and not is_admin(user):
		roles = set(frappe.get_roles(user))
		pos = roles & set(POS_ROLES)
		if pos and not (doctype and _other_roles_read(user, doctype)):
			scope = ("all", None) if "POS Admin" in pos else ("stores", _user_stores(user))
	cache[key] = scope
	return scope


def _in(values):
	return "({})".format(", ".join(frappe.db.escape(v) for v in values)) if values else "('')"


# ------------------------------------------------------------------ list conditions
def customer_query(user=None):
	scope = get_scope(user, "Customer")
	if not scope:
		return ""
	me = frappe.db.escape(user or frappe.session.user)
	if scope[0] == "all":
		return f"(ifnull(`tabCustomer`.`{STORE_FIELD}`, '') != '' or `tabCustomer`.`owner` = {me})"
	return f"(`tabCustomer`.`{STORE_FIELD}` in {_in(scope[1])} or `tabCustomer`.`owner` = {me})"


def _store_query(doctype, user):
	scope = get_scope(user, doctype)
	if not scope or scope[0] == "all":
		return ""
	return f"`tab{doctype}`.`pos_profile` in {_in(scope[1])}"


def pos_invoice_query(user=None):
	return _store_query("POS Invoice", user)


def pos_opening_query(user=None):
	return _store_query("POS Opening Entry", user)


def pos_closing_query(user=None):
	return _store_query("POS Closing Entry", user)


def pos_profile_query(user=None):
	scope = get_scope(user, "POS Profile")
	if not scope or scope[0] == "all":
		return ""
	return f"`tabPOS Profile`.`name` in {_in(scope[1])}"


# ------------------------------------------------------------------ single-record checks (None = no opinion)
def has_customer_permission(doc, ptype=None, user=None, debug=False):
	scope = get_scope(user, "Customer")
	if not scope or doc.is_new():
		return None
	store = doc.get(STORE_FIELD)
	if doc.owner == (user or frappe.session.user):
		return True  # customers they created are always theirs to see
	if scope[0] == "all":
		return bool(store)
	return store in scope[1]


def has_store_permission(doc, ptype=None, user=None, debug=False):
	scope = get_scope(user, doc.doctype)
	if not scope or scope[0] == "all" or doc.is_new():
		return None
	return doc.get("pos_profile") in scope[1]


def has_pos_profile_permission(doc, ptype=None, user=None, debug=False):
	scope = get_scope(user, "POS Profile")
	if not scope or scope[0] == "all" or doc.is_new():
		return None
	return doc.name in scope[1]


# ------------------------------------------------------------------ filling the store
def set_store_on_new_customer(doc, method=None):
	"""Customer before_insert: a customer created by POS staff belongs to their store."""
	if doc.get(STORE_FIELD):
		return
	user = frappe.session.user
	if is_pos_staff(user):  # POS staff only — never admins, who hold every role
		stores = _user_stores(user)
		if stores:
			doc.set(STORE_FIELD, stores[0])


def set_store_from_pos_invoice(doc, method=None):
	"""POS Invoice on_update: a customer's first POS Invoice gives them its store."""
	if not (doc.customer and doc.pos_profile):
		return
	if not frappe.db.get_value("Customer", doc.customer, STORE_FIELD):
		frappe.db.set_value("Customer", doc.customer, STORE_FIELD, doc.pos_profile, update_modified=False)


def backfill():
	"""Set POS Store on existing customers where it is empty. Returns how many were set."""
	done = 0

	def put(customer, store):
		nonlocal done
		if customer and store and frappe.db.exists("Customer", customer) \
				and not frappe.db.get_value("Customer", customer, STORE_FIELD):
			frappe.db.set_value("Customer", customer, STORE_FIELD, store, update_modified=False)
			done += 1

	for p in frappe.get_all("POS Profile", fields=["name", "customer"]):
		put(p.customer, p.name)
	for r in frappe.db.sql("""select customer, pos_profile from `tabPOS Invoice`
			where docstatus < 2 and ifnull(customer, '') != '' and ifnull(pos_profile, '') != ''
			order by posting_date, creation""", as_dict=True):
		put(r.customer, r.pos_profile)
	first_store = {}
	for r in frappe.get_all("POS Profile User", fields=["user", "parent"], order_by="idx asc"):
		first_store.setdefault(r.user, r.parent)
	pos_users = {u for u in frappe.get_all("Has Role", filters={"parenttype": "User", "role": ["in", POS_ROLES]},
										   pluck="parent") if is_pos_staff(u)}  # POS staff only, never admins
	for user in pos_users & set(first_store):
		for c in frappe.get_all("Customer", filters={"owner": user}, pluck="name"):
			put(c, first_store[user])
	return done


# ------------------------------------------------------------------ Stock Entry / Material Request
# A store's warehouse is its POS Profile's warehouse.
#   POS Admin: every POS store's Stock Entries / Material Requests, plus any made by
#              POS staff.
#   POS Store Manager: those touching their stores' warehouses, plus their own.
# A Material Transfer into a store is submitted by that store (its target warehouse);
# POS Admin may submit any (guard_pos_transfer_submit).

def store_warehouses(stores):
	return sorted({w for w in frappe.get_all("POS Profile", filters={"name": ["in", list(stores)]}, pluck="warehouse") if w}) \
		if stores else []


def all_store_warehouses():
	return sorted({w for w in frappe.get_all("POS Profile", filters={"disabled": 0}, pluck="warehouse") if w})


def _pos_staff_users():
	users = set(frappe.get_all("Has Role", filters={"parenttype": "User", "role": ["in", POS_ROLES]}, pluck="parent"))
	return sorted(u for u in users if is_pos_staff(u))


def _stock_scope(user, doctype):
	"""None | (warehouses, extra owners) for the Stock Entry / Material Request rules."""
	scope = get_scope(user, doctype)
	if not scope:
		return None
	if scope[0] == "all":
		return all_store_warehouses(), _pos_staff_users()
	return store_warehouses(scope[1]), []


def stock_entry_query(user=None):
	user = user or frappe.session.user
	sc = _stock_scope(user, "Stock Entry")
	if not sc:
		return ""
	wh, owners = sc
	w = _in(wh)
	return (f"(`tabStock Entry`.`owner` in {_in([user] + owners)}"
			f" or `tabStock Entry`.`from_warehouse` in {w} or `tabStock Entry`.`to_warehouse` in {w}"
			f" or exists (select 1 from `tabStock Entry Detail` sed where sed.parent = `tabStock Entry`.`name`"
			f" and (sed.s_warehouse in {w} or sed.t_warehouse in {w})))")


def material_request_query(user=None):
	user = user or frappe.session.user
	sc = _stock_scope(user, "Material Request")
	if not sc:
		return ""
	wh, owners = sc
	w = _in(wh)
	return (f"(`tabMaterial Request`.`owner` in {_in([user] + owners)}"
			f" or `tabMaterial Request`.`set_warehouse` in {w} or `tabMaterial Request`.`set_from_warehouse` in {w}"
			f" or exists (select 1 from `tabMaterial Request Item` mri where mri.parent = `tabMaterial Request`.`name`"
			f" and (mri.warehouse in {w} or mri.from_warehouse in {w})))")


def _doc_warehouses(doc, head, rows):
	out = {doc.get(f) for f in head}
	for d in doc.get("items") or []:
		out |= {d.get(f) for f in rows}
	return {w for w in out if w}


def has_stock_entry_permission(doc, ptype=None, user=None, debug=False):
	user = user or frappe.session.user
	sc = _stock_scope(user, "Stock Entry")
	if not sc or doc.is_new():
		return None
	wh, owners = sc
	if doc.owner in [user] + owners:
		return True
	return bool(_doc_warehouses(doc, ("from_warehouse", "to_warehouse"), ("s_warehouse", "t_warehouse")) & set(wh))


def has_material_request_permission(doc, ptype=None, user=None, debug=False):
	user = user or frappe.session.user
	sc = _stock_scope(user, "Material Request")
	if not sc or doc.is_new():
		return None
	wh, owners = sc
	if doc.owner in [user] + owners:
		return True
	return bool(_doc_warehouses(doc, ("set_warehouse", "set_from_warehouse"), ("warehouse", "from_warehouse")) & set(wh))


def guard_pos_transfer_submit(doc, method=None):
	"""Stock Entry before_submit: a POS Store Manager may submit a transfer only into
	their own store (its target warehouse). POS Admin may submit any."""
	scope = get_scope(None, "Stock Entry")
	if not scope or scope[0] == "all":
		return
	targets = {d.t_warehouse for d in doc.get("items") or [] if d.t_warehouse}
	if not targets:
		return
	mine = set(store_warehouses(scope[1]))
	other = sorted(targets - mine)
	if other:
		frappe.throw(
			frappe._("Only the receiving store can submit this transfer: {0} is not your store's warehouse.")
			.format(", ".join(other)), title=frappe._("Not your store"))


DEFAULT_SOURCE_WAREHOUSE = "VV Puram - IND"


def pos_source_warehouse():
	"""Admin Settings › POS Stock Requests › Source Warehouse (VV Puram - IND if unset)."""
	wh = frappe.db.get_single_value("Admin Settings", "pos_stock_source_warehouse") \
		if frappe.get_meta("Admin Settings").has_field("pos_stock_source_warehouse") else None
	if not wh and frappe.db.exists("Warehouse", DEFAULT_SOURCE_WAREHOUSE):
		wh = DEFAULT_SOURCE_WAREHOUSE
	return wh


@frappe.whitelist()
def get_my_pos_defaults():
	"""Defaults for a new Material Request / Stock Entry made from a POS login
	(POS Admin / POS Store Manager, admins excluded):
	- warehouse: the user's store's warehouse (first store they are listed on);
	- source_warehouse: where stores request stock from (pos_source_warehouse)."""
	from erp_dacsinc_custom.order_flow_permissions import is_admin

	user = frappe.session.user
	roles = set(frappe.get_roles(user))
	if not roles & set(POS_ROLES) or is_admin(user):
		return {}
	stores = _user_stores(user)
	wh = store_warehouses(stores[:1])
	return {"warehouse": wh[0] if wh else None, "stores": stores, "source_warehouse": pos_source_warehouse()}


@frappe.whitelist()
def get_stock_for_rows(rows):
	"""[{item_code, warehouse, from_warehouse}] → actual / projected qty at each (for the MR panel)."""
	rows = frappe.parse_json(rows) or []
	pairs = {(r.get("item_code"), w) for r in rows for w in (r.get("warehouse"), r.get("from_warehouse"))
			 if r.get("item_code") and w}
	if not pairs:
		return {}
	items = sorted({p[0] for p in pairs}); whs = sorted({p[1] for p in pairs})
	out = {}
	for b in frappe.get_all("Bin", filters={"item_code": ["in", items], "warehouse": ["in", whs]},
							fields=["item_code", "warehouse", "actual_qty", "projected_qty", "reserved_qty"]):
		out[f"{b.item_code}||{b.warehouse}"] = {"actual": b.actual_qty, "projected": b.projected_qty}
	return out


# ------------------------------------------------------------------ Items by the stores' brands
# POS Profile › Brands (custom_brands, see pos_brand_filter.py) also decides which
# Items a POS login sees anywhere (Item list, item pickers on MR / Stock Entry /
# POS Invoice): Store Manager → their stores' brands; POS Admin → every store's.
# A store with no brands listed sells everything, so it lifts the limit.

def _scope_brands(scope):
	"""Set of brands, or None for no limit."""
	if not scope:
		return None
	profiles = frappe.get_all("POS Profile", filters={"disabled": 0}, pluck="name") if scope[0] == "all" else scope[1]
	if not profiles:
		return set()
	if not frappe.db.exists("DocType", "POS Brand"):
		return None
	brands = set()
	for p in profiles:
		b = {d.brand for d in frappe.get_all("POS Brand", filters={"parent": p, "parenttype": "POS Profile"}, fields=["brand"]) if d.brand}
		if not b and scope[0] != "all":
			return None  # a store of theirs with no brands sells everything
		brands |= b
	# POS Admin: the brands the stores list (stores without brands are ignored).
	return brands or None


def item_query(user=None):
	brands = _scope_brands(get_scope(user, "Item"))
	if brands is None:
		return ""
	return f"`tabItem`.`brand` in {_in(sorted(brands))}"


def has_item_permission(doc, ptype=None, user=None, debug=False):
	if doc.is_new():
		return None
	brands = _scope_brands(get_scope(user, "Item"))
	if brands is None:
		return None
	return doc.get("brand") in brands
