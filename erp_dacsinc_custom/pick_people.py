"""Whom to ask about another order's Pick List — to reduce its qty or delete it.

Shown wherever a Pick List of another Sales Order is listed (SO › Stock Conflicts, Other orders
waiting, stale Pick Lists; Order Flow › Stock › reservation details), so a merchandiser who needs
the stock knows whom to ask. Display only — no permission is set or changed here. Per Pick List:

  pl_created_by     who made it
  merchandiser      the order's customer's Merchandiser User ("" = none assigned: any_merchandiser = 1)
  submitted         1 when the Pick List is submitted
  can_edit          who can really reduce its qty — Frappe's own permission check
                    (frappe.has_permission: role permissions, the merchandiser scope in
                    custom_script._so_linked_has_permission, user permissions) run for every user:
                      draft      write
                      submitted  cancel (Cancel, or Revert to Draft — so_embroidery.revert_pick_list
                                 checks cancel)
  can_delete        draft: delete; submitted: cancel and delete (it is cancelled first)

See docs/so-rm-po-subcontracting-flow.md › "Whom to ask about another order's Pick List".
"""
from collections import defaultdict

import frappe


def _memo():
	m = getattr(frappe.local, "pick_people_memo", None)
	if m is None:
		m = frappe.local.pick_people_memo = {}
	return m


def _candidates():
	"""Enabled desk users (not Administrator) holding any role that may read a Pick List — the
	only people a permission check can say yes for. Kept for the request."""
	m = _memo()
	if "candidates" not in m:
		roles = {r.role for r in frappe.get_all("Custom DocPerm", filters={"parent": "Pick List", "permlevel": 0, "read": 1},
		                                        fields=["role"])}
		roles.discard("All")
		m["candidates"] = sorted({r[0] for r in frappe.db.sql("""
			SELECT DISTINCT u.name FROM `tabHas Role` hr JOIN `tabUser` u ON u.name = hr.parent
			WHERE hr.parenttype = 'User' AND hr.role IN %(roles)s AND u.enabled = 1
			  AND u.user_type = 'System User' AND u.name NOT IN ('Administrator', 'Guest')""",
			{"roles": tuple(roles)})}) if roles else []
	return m["candidates"]


def _full_names(users):
	users = [u for u in set(users) if u]
	if not users:
		return {}
	return {u.name: (u.full_name or u.name) for u in frappe.get_all(
		"User", filters={"name": ["in", users]}, fields=["name", "full_name"])}


def _can(pl_doc, ptype, user):
	m = _memo()
	key = ("perm", pl_doc.name, ptype, user)
	if key not in m:
		m[key] = bool(frappe.has_permission("Pick List", ptype, doc=pl_doc, user=user))
	return m[key]


def _who(pl_name):
	"""(can_edit users, can_delete users, submitted) for one Pick List."""
	m = _memo()
	key = ("who", pl_name)
	if key not in m:
		doc = frappe.get_doc("Pick List", pl_name)
		submitted = doc.docstatus == 1
		edit, delete = [], []
		for u in _candidates():
			if submitted:
				if _can(doc, "cancel", u):
					edit.append(u)
					if _can(doc, "delete", u):
						delete.append(u)
			else:
				if _can(doc, "write", u):
					edit.append(u)
				if _can(doc, "delete", u):
					delete.append(u)
		m[key] = (edit, delete, 1 if submitted else 0, doc.owner)
	return m[key]


def people(pairs):
	"""pairs: [(pick_list, sales_order)] → {(pick_list, sales_order): {pl_created_by, merchandiser,
	any_merchandiser, submitted, can_edit, can_delete}}."""
	pairs = {(p, s) for p, s in pairs if p}
	if not pairs:
		return {}
	sos = {s for _, s in pairs if s}
	merch = dict(frappe.db.sql("""SELECT so.name, cust.custom_merchandiser_user FROM `tabSales Order` so
		LEFT JOIN `tabCustomer` cust ON cust.name = so.customer WHERE so.name IN %(sos)s""", {"sos": tuple(sos)})) if sos else {}
	who = {p: _who(p) for p, _ in pairs}
	names = _full_names([u for w in who.values() for u in w[0] + w[1] + [w[3]]] + list(merch.values()))
	nm = lambda u: names.get(u, u or "")
	out = {}
	for p, s in pairs:
		edit, delete, submitted, owner = who[p]
		mu = merch.get(s) or ""
		out[(p, s)] = {
			"pl_created_by": nm(owner),
			"merchandiser": nm(mu),
			"any_merchandiser": 0 if mu else 1,
			"submitted": submitted,
			"can_edit": sorted(nm(u) for u in edit),
			"can_delete": sorted(nm(u) for u in delete),
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
