"""Operations Manager — the Merchandiser User's job for every customer (docs/operations-manager.md).

The role is NOT Merchandiser User, so none of the "own customers only" scoping (keyed on that role
name) applies: an Operations Manager sees every Sales Order and what hangs off it. What it shares with
Merchandiser User is the kind of work:

- Purchase Orders: only Subcontract POs (sees and raises), like a merchandiser.
- Stock Entries: only the jobber transfers of Sales Orders (and entries they made themselves); the
  Stock Entry Type list offers Send to Subcontractor / Material Transfer / Repack (stock_entry_types).

Both limits drop when the user also holds another role that may create or edit that document
(Purchase Manager, Production Manager, …): the narrow role never wins over a broader one.
Admins are never limited. Access (documents, Order Flow tabs, reports, workflow) is the access
sheet's like every sheet role; patches/operations_manager_role.py set it up once per site.
"""
import frappe

ROLE = "Operations Manager"
# roles that never decide whether the limit applies
NEUTRAL_ROLES = {"All", "Guest", "Desk User", "Employee", "Employee Self Service", ROLE, "Merchandiser User"}


def is_ops_manager(user=None):
	"""Holds Operations Manager and is not an admin."""
	from erp_dacsinc_custom.order_flow_permissions import is_admin

	user = user or frappe.session.user
	return ROLE in set(frappe.get_roles(user)) and not is_admin(user)


def _roles_that_make(doctype):
	rows = frappe.get_all("Custom DocPerm", filters={"parent": doctype, "permlevel": 0},
	                      or_filters={"create": 1, "write": 1}, pluck="role")
	if not frappe.db.exists("Custom DocPerm", {"parent": doctype}):
		rows = frappe.get_all("DocPerm", filters={"parent": doctype, "permlevel": 0},
		                      or_filters={"create": 1, "write": 1}, pluck="role")
	return set(rows)


def is_limited(doctype, user=None):
	"""Is this Operations Manager kept to the merchandiser kind of `doctype` (Purchase Order,
	Stock Entry)? False when another role of theirs may create / edit it."""
	user = user or frappe.session.user
	if not is_ops_manager(user):
		return False
	others = set(frappe.get_roles(user)) - NEUTRAL_ROLES
	return not (others & _roles_that_make(doctype))


def stock_entry_clause(user, se="`tabStock Entry`"):
	"""Jobber transfers of any Sales Order (the entry's subcontracted PO, or its Subcontracting
	Order's PO, carries a Sales Order), plus entries the user made."""
	return """({se}.owner = {u} or exists (
        select poi.name from `tabPurchase Order Item` poi
        where ifnull(poi.sales_order, '') != ''
          and (poi.parent = {se}.purchase_order
               or poi.parent = (select sco.purchase_order from `tabSubcontracting Order` sco
                                where sco.name = {se}.subcontracting_order))
    ))""".format(se=se, u=frappe.db.escape(user))


def boot(bootinfo):
	"""The forms / lists hide the buttons the server would refuse anyway."""
	bootinfo.dacs_ops_limited = {dt: is_limited(dt) for dt in ("Purchase Order", "Stock Entry")}
