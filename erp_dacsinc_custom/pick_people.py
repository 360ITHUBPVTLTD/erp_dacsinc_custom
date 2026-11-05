"""Whom to ask about another order's Pick List — to reduce its qty or delete it.

Shown wherever a Pick List of another Sales Order is listed (SO › Stock Conflicts, Other orders
waiting, stale Pick Lists; Order Flow › Stock › reservation details), so a merchandiser who needs
the stock knows whom to ask. Display only. Per Pick List:

  pl_created_by     who made it
  merchandiser      the order's customer's Merchandiser User ("" = none assigned, then every
                    merchandiser can open it: any_merchandiser = 1)
  can_edit          who can open and change it (reduce qty): first that order's people — its
                    creator, the customer's merchandiser, the Sales Order's creator and Lead Owner
                    (the rule in custom_script._so_linked_has_permission), each only if a role of
                    theirs may write a Pick List — then everyone who may write any Pick List
                    without a merchandiser scope (stock, production, warehouse, admin)
  can_delete        users whose role may delete a Pick List (a Merchandiser User cannot)

See docs/so-rm-po-subcontracting-flow.md › "Whom to ask about another order's Pick List".
"""
from collections import defaultdict

import frappe


def _role_users(ptype):
	"""Enabled desk users (not Administrator) holding a role that may `ptype` a Pick List.
	Kept for the request: the Stock Conflicts call asks once per item line."""
	memo = getattr(frappe.local, "pick_people_role_users", None)
	if memo is None:
		memo = frappe.local.pick_people_role_users = {}
	if ptype not in memo:
		memo[ptype] = _role_users_uncached(ptype)
	return memo[ptype]


def _role_users_uncached(ptype):
	roles = {r.role for r in frappe.get_all("Custom DocPerm", filters={"parent": "Pick List", "permlevel": 0, ptype: 1},
	                                        fields=["role"])}
	roles.discard("All")
	if not roles:
		return set()
	return {r[0] for r in frappe.db.sql("""
		SELECT DISTINCT u.name FROM `tabHas Role` hr JOIN `tabUser` u ON u.name = hr.parent
		WHERE hr.parenttype = 'User' AND hr.role IN %(roles)s AND u.enabled = 1
		  AND u.user_type = 'System User' AND u.name NOT IN ('Administrator', 'Guest')""", {"roles": tuple(roles)})}


def _full_names(users):
	users = [u for u in set(users) if u]
	if not users:
		return {}
	return {u.name: (u.full_name or u.name) for u in frappe.get_all(
		"User", filters={"name": ["in", users]}, fields=["name", "full_name"])}


def people(pairs):
	"""pairs: [(pick_list, sales_order)] → {(pick_list, sales_order): {pl_created_by, merchandiser,
	any_merchandiser, can_edit, can_delete}}."""
	pairs = {(p, s) for p, s in pairs if p}
	if not pairs:
		return {}
	pls = {p for p, _ in pairs}
	sos = {s for _, s in pairs if s}
	owners = {p.name: p.owner for p in frappe.get_all("Pick List", filters={"name": ["in", list(pls)]},
	                                                   fields=["name", "owner"])}
	so_info = {r.name: r for r in frappe.db.sql("""
		SELECT so.name, so.owner, so.custom_lead_owner AS lead_owner, cust.custom_merchandiser_user AS merch
		FROM `tabSales Order` so LEFT JOIN `tabCustomer` cust ON cust.name = so.customer
		WHERE so.name IN %(sos)s""", {"sos": tuple(sos)}, as_dict=1)} if sos else {}
	writers, deleters = _role_users("write"), _role_users("delete")
	# writers a merchandiser scope does not hold back (stock, production, warehouse, admin): they
	# can change every Pick List, so they are named on every one
	from erp_dacsinc_custom.order_flow_api import is_scoped_merchandiser_for_doctype
	memo = frappe.local.pick_people_role_users
	if "unscoped" not in memo:
		memo["unscoped"] = {u for u in writers if not is_scoped_merchandiser_for_doctype("Pick List", u)}
	unscoped = memo["unscoped"]
	names = _full_names(list(owners.values()) + list(deleters) + list(unscoped)
	                    + [u for s in so_info.values() for u in (s.owner, s.lead_owner, s.merch)])
	can_delete = sorted(names.get(u, u) for u in deleters)
	out = {}
	for p, s in pairs:
		so = so_info.get(s) or frappe._dict()
		edit = []
		for u in (owners.get(p), so.merch, so.owner, so.lead_owner):
			if u and u in writers and names.get(u, u) not in edit:
				edit.append(names.get(u, u))
		for n in sorted(names.get(u, u) for u in unscoped):
			if n not in edit:
				edit.append(n)
		out[(p, s)] = {
			"pl_created_by": names.get(owners.get(p), owners.get(p) or ""),
			"merchandiser": names.get(so.merch, so.merch or ""),
			"any_merchandiser": 0 if so.merch else 1,
			"can_edit": edit,
			"can_delete": can_delete,
		}
	return out


def attach(rows, pl_key="pick_list_name", so_key="sales_order"):
	"""Add the people fields (see module doc) to each row in place."""
	if rows:
		info = people((r.get(pl_key), r.get(so_key)) for r in rows)
		for r in rows:
			r.update(info.get((r.get(pl_key), r.get(so_key))) or {})
	return rows


def open_pick_lists(item_codes, so_names):
	"""{(sales_order, item_code): [{name, docstatus, qty, + people fields}]} — the Pick Lists still
	holding stock for these orders' lines (draft: its qty; submitted: picked, not yet delivered)."""
	item_codes, so_names = tuple(set(i for i in item_codes if i)), tuple(set(s for s in so_names if s))
	if not item_codes or not so_names:
		return {}
	rows = frappe.db.sql("""
		SELECT pli.sales_order, pli.item_code, pl.name, pl.docstatus,
		       SUM(CASE WHEN pl.docstatus = 1 THEN GREATEST(IFNULL(pli.picked_qty, 0) - IFNULL(pli.delivered_qty, 0), 0)
		                ELSE IFNULL(pli.qty, 0) END) AS qty
		FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent
		WHERE pli.item_code IN %(items)s AND pli.sales_order IN %(sos)s
		  AND pl.docstatus < 2 AND pl.status NOT IN ('Completed', 'Cancelled')
		GROUP BY pli.sales_order, pli.item_code, pl.name, pl.docstatus
		HAVING qty > 0
		ORDER BY pl.creation""", {"items": item_codes, "sos": so_names}, as_dict=1)
	attach(rows, pl_key="name")
	out = defaultdict(list)
	for r in rows:
		out[(r.sales_order, r.item_code)].append(r)
	return out


def attach_merchandiser(rows, so_key="sales_order"):
	"""Add merchandiser / any_merchandiser to Sales Order rows (no Pick List of their own)."""
	sos = [r.get(so_key) for r in rows if r.get(so_key)]
	if not sos:
		return rows
	merch = dict(frappe.db.sql("""SELECT so.name, cust.custom_merchandiser_user FROM `tabSales Order` so
		LEFT JOIN `tabCustomer` cust ON cust.name = so.customer WHERE so.name IN %(sos)s""", {"sos": tuple(set(sos))}))
	names = _full_names(merch.values())
	for r in rows:
		m = merch.get(r.get(so_key)) or ""
		r["merchandiser"] = names.get(m, m)
		r["any_merchandiser"] = 0 if m else 1
	return rows
