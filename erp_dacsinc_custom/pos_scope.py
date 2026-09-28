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

	create_custom_fields({"Customer": [{
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


def get_scope(user=None):
	"""None (not scoped) | ("all", None) for POS Admin | ("stores", [profiles]) for POS Store Manager."""
	user = user or frappe.session.user
	if not hasattr(frappe.local, "pos_scope_cache"):
		frappe.local.pos_scope_cache = {}
	cache = frappe.local.pos_scope_cache
	if user in cache:
		return cache[user]
	scope = None
	from erp_dacsinc_custom.order_flow_permissions import is_admin

	from erp_dacsinc_custom.access_sync import is_active

	if is_active() and user not in ("Administrator", "Guest") and not is_admin(user):
		roles = set(frappe.get_roles(user))
		pos = roles & set(POS_ROLES)
		if pos:
			from erp_dacsinc_custom.access_sync import sheet_roles

			if not roles & (set(sheet_roles()) - set(POS_ROLES)):
				scope = ("all", None) if "POS Admin" in pos else ("stores", _user_stores(user))
	cache[user] = scope
	return scope


def _in(values):
	return "({})".format(", ".join(frappe.db.escape(v) for v in values)) if values else "('')"


# ------------------------------------------------------------------ list conditions
def customer_query(user=None):
	scope = get_scope(user)
	if not scope:
		return ""
	if scope[0] == "all":
		return f"ifnull(`tabCustomer`.`{STORE_FIELD}`, '') != ''"
	return (f"(`tabCustomer`.`{STORE_FIELD}` in {_in(scope[1])} "
			f"or `tabCustomer`.`owner` = {frappe.db.escape(user or frappe.session.user)})")


def _store_query(doctype, user):
	scope = get_scope(user)
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
	scope = get_scope(user)
	if not scope or scope[0] == "all":
		return ""
	return f"`tabPOS Profile`.`name` in {_in(scope[1])}"


# ------------------------------------------------------------------ single-record checks (None = no opinion)
def has_customer_permission(doc, ptype=None, user=None, debug=False):
	scope = get_scope(user)
	if not scope or doc.is_new():
		return None
	store = doc.get(STORE_FIELD)
	if scope[0] == "all":
		return bool(store)
	return bool(store in scope[1] or doc.owner == (user or frappe.session.user))


def has_store_permission(doc, ptype=None, user=None, debug=False):
	scope = get_scope(user)
	if not scope or scope[0] == "all" or doc.is_new():
		return None
	return doc.get("pos_profile") in scope[1]


def has_pos_profile_permission(doc, ptype=None, user=None, debug=False):
	scope = get_scope(user)
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
