"""Customers / suppliers paid as one group — branches of one firm that pay with one cheque (docs/bulk-payment.md ›
Group payment). The group is ERPNext's own Customer Group / Supplier Group: put the branches in one group.

- The Receive / Pay prompt lists the groups whose members owe something ("Whole group": adds every member that
  owes) — get_groups_due; one cheque for several members is then a Bulk Payment (one Payment Entry each).
- The Group Outstanding page (/app/group-outstanding) shows one group's open items member by member, totals at the
  top, ticks to choose what the cheque pays, and opens the prompt with them — get_group_outstanding.
A group's members are the parties in it or in a group under it.
"""

import frappe
from frappe import _
from frappe.utils import flt, getdate, today

from erp_dacsinc_custom.party_open_items import PAYABLE_KINDS, open_items
from erp_dacsinc_custom.search_words import pieces

GROUP = {"Customer": ("Customer Group", "customer_group", "customer_name"),
		 "Supplier": ("Supplier Group", "supplier_group", "supplier_name")}
PAYMENT_TYPE = {"Customer": "Receive", "Supplier": "Pay"}
# a group with more members than this is a catch-all (e.g. "Individual"), not one firm's branches: the prompt
# doesn't offer it, a search doesn't match it, the Account Summary doesn't link it
MAX_PROMPT_MEMBERS = 60


def _check(party_type):
	from erp_dacsinc_custom.party_balance import can_see_balances
	if party_type not in GROUP:
		frappe.throw(_("Choose Customer or Supplier."))
	if not can_see_balances() or not frappe.has_permission(party_type, "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


def _owing(party_type, company):
	"""The parties with something due (invoices, opening balances, Journal Entries) that this user may see."""
	owing = frappe.db.sql("""SELECT DISTINCT party FROM (SELECT party FROM `tabPayment Ledger Entry`
		WHERE delinked = 0 AND company = %s AND party_type = %s
		GROUP BY party, against_voucher_type, against_voucher_no HAVING SUM(amount) > 0.005) t""",
		(company, party_type), pluck=True)
	return frappe.get_list(party_type, filters={"name": ["in", owing]}, pluck="name", limit_page_length=0) if owing else []


def members(party_type, group):
	"""The parties in this group or in a group under it."""
	group_dt, field = GROUP[party_type][:2]
	lft, rgt = frappe.db.get_value(group_dt, group, ["lft", "rgt"]) or (None, None)
	if lft is None:
		return []
	groups = frappe.get_all(group_dt, filters={"lft": [">=", lft], "rgt": ["<=", rgt]}, pluck="name")
	return frappe.get_list(party_type, filters={field: ["in", groups], "disabled": 0}, pluck="name", limit_page_length=0)


def matching_groups(party_type, txt):
	"""The groups whose name has `txt`, leaving out catch-alls (more than MAX_PROMPT_MEMBERS members) — a search for
	a group's name finds its members."""
	group_dt, field = GROUP[party_type][:2]
	names = frappe.get_all(group_dt, filters=[["name", "like", f"%{w}%"] for w in pieces(txt)], pluck="name", limit=20) if txt else []
	if not names:
		return []
	counts = dict(frappe.db.sql(f"SELECT {field}, COUNT(*) FROM `tab{party_type}` WHERE {field} IN %s GROUP BY {field}", (tuple(names),)))
	return [g for g in names if 0 < (counts.get(g) or 0) <= MAX_PROMPT_MEMBERS]


def _dues(items):
	return [i for i in items if i.outstanding > 0.005 and i.kind in PAYABLE_KINDS]


@frappe.whitelist()
def get_groups_due(payment_type, company=None, txt=None):
	"""For the prompt: the groups with at least two members owing something — group, parties ([id, name] of the
	members that owe), total due, oldest due date (most due first). `txt` filters by the group's name, and then a
	group with one member owing is listed too (it was searched for)."""
	from erp_dacsinc_custom.erp_dacsinc_custom.doctype.bulk_payment.bulk_payment import INVOICE, _can_pay
	party_type, inv_dt = INVOICE[payment_type][:2]
	if not _can_pay() or not frappe.has_permission(inv_dt, "read"):   # as the prompt's own party list
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	company = company or frappe.defaults.get_user_default("Company")
	field, name_field = GROUP[party_type][1:]
	owing = _owing(party_type, company)
	if not owing:
		return []
	group_of, label = {}, {}
	for r in frappe.get_all(party_type, filters={"name": ["in", owing]}, fields=["name", field, name_field], as_list=True):
		group_of[r[0]], label[r[0]] = r[1], r[2] or r[0]
	txt = (txt or "").strip().lower()
	by = {}
	for party, its in open_items(party_type, owing, company).items():
		due = _dues(its)
		g = group_of.get(party)
		if not due or not g or (txt and not all(w in g.lower() for w in pieces(txt))):
			continue
		x = by.setdefault(g, frappe._dict(group=g, parties=[], due=0.0, oldest_due=None))
		x.parties.append([party, label.get(party) or party])
		x.due = flt(x.due + sum(i.outstanding for i in due), 2)
		oldest = min(getdate(i.due_date) for i in due)
		x.oldest_due = min(x.oldest_due, oldest) if x.oldest_due else oldest
	size = dict(frappe.db.sql(f"SELECT {field}, COUNT(*) FROM `tab{party_type}` WHERE {field} IN %s GROUP BY {field}",
		(tuple(by),))) if by else {}
	rows = [x for x in by.values() if len(x.parties) >= (1 if txt else 2) and (size.get(x.group) or 0) <= MAX_PROMPT_MEMBERS]
	rows.sort(key=lambda x: -x.due)
	return rows[:12]


@frappe.whitelist()
def get_groups_outstanding(party_type, company=None):
	"""For the Group Outstanding page before a group is chosen: every group with something open — members (all /
	owing), items, they owe, overdue, held for them, net; most owed first. Catch-all groups (more than
	MAX_PROMPT_MEMBERS members) are listed too but marked, as their "group" is not one firm."""
	_check(party_type)
	company = company or frappe.defaults.get_user_default("Company")
	field = GROUP[party_type][1]
	owing = _owing(party_type, company)
	if not owing:
		return {"company": company, "currency": frappe.get_cached_value("Company", company, "default_currency"), "groups": []}
	group_of = dict(frappe.get_all(party_type, filters={"name": ["in", owing]}, fields=["name", field], as_list=True))
	now = getdate(today())
	by = {}
	for party, its in open_items(party_type, owing, company).items():
		due, credits = _dues(its), [i for i in its if i.outstanding < -0.005]
		if not due and not credits:
			continue
		g = group_of.get(party) or _("(no group)")
		x = by.setdefault(g, frappe._dict(group=g, owing=0, n_items=0, due=0.0, overdue=0.0, credits=0.0, oldest_due=None))
		x.owing += 1 if due else 0
		x.n_items += len(due)
		x.due += sum(i.outstanding for i in due)
		x.overdue += sum(i.outstanding for i in due if i.due_date and getdate(i.due_date) < now)
		x.credits += -sum(i.outstanding for i in credits)
		if due:
			oldest = min(getdate(i.due_date) for i in due)
			x.oldest_due = min(x.oldest_due, oldest) if x.oldest_due else oldest
	size = dict(frappe.db.sql(f"SELECT {field}, COUNT(*) FROM `tab{party_type}` WHERE disabled = 0 GROUP BY {field}"))
	rows = []
	for x in by.values():
		x.members = size.get(x.group) or 0
		x.catch_all = x.members > MAX_PROMPT_MEMBERS
		for k in ("due", "overdue", "credits"):
			x[k] = flt(x[k], 2)
		x.net = flt(x.due - x.credits, 2)
		rows.append(x)
	rows.sort(key=lambda x: (x.catch_all, -x.due))
	return {"company": company, "currency": frappe.get_cached_value("Company", company, "default_currency"), "groups": rows}


@frappe.whitelist()
def get_parties_outstanding(party_type, company=None):
	"""For the Group Outstanding page's "By customer / supplier" view: every customer / supplier with something
	open — group, items, they owe, overdue, held for them, net, oldest due; most owed first."""
	_check(party_type)
	company = company or frappe.defaults.get_user_default("Company")
	field, name_field = GROUP[party_type][1], GROUP[party_type][2]
	owing = _owing(party_type, company)
	rows = []
	if owing:
		info = {r.name: r for r in frappe.get_all(party_type, filters={"name": ["in", owing]}, fields=["name", name_field, field])}
		now = getdate(today())
		for party, its in open_items(party_type, owing, company).items():
			due, credits = _dues(its), [i for i in its if i.outstanding < -0.005]
			if not due and not credits:
				continue
			r = info.get(party) or {}
			x = frappe._dict(party=party, party_name=r.get(name_field) or party, group=r.get(field), n_items=len(due),
							 due=flt(sum(i.outstanding for i in due), 2),
							 overdue=flt(sum(i.outstanding for i in due if i.due_date and getdate(i.due_date) < now), 2),
							 credits=flt(-sum(i.outstanding for i in credits), 2),
							 oldest_due=min((getdate(i.due_date) for i in due if i.due_date), default=None))
			x.net = flt(x.due - x.credits, 2)
			rows.append(x)
	rows.sort(key=lambda x: (-x.due, x.party_name))
	return {"company": company, "currency": frappe.get_cached_value("Company", company, "default_currency"), "parties": rows}


@frappe.whitelist()
def get_group_outstanding(party_type, group, company=None):
	"""For the Group Outstanding page: every member of the group, with what each owes (items to pay) and what is
	held for them (credits), and the group's totals. Members with nothing open are counted, not listed."""
	_check(party_type)
	company = company or frappe.defaults.get_user_default("Company")
	group_dt, name_field = GROUP[party_type][0], GROUP[party_type][2]
	if not frappe.db.exists(group_dt, group):
		frappe.throw(_("{0} {1} not found.").format(_(group_dt), group))
	names = members(party_type, group)
	out, tot = _views(party_type, names, company)
	return {"group": group, "party_type": party_type, "payment_type": PAYMENT_TYPE[party_type], "company": company,
			"currency": frappe.get_cached_value("Company", company, "default_currency"),
			"members_total": len(names), "members": out, "totals": tot,
			"can_pay": bool(frappe.has_permission("Payment Entry", "create") and frappe.has_permission("Payment Entry", "submit")),
			"letter_head": _letter_head_html(company)}


def _views(party_type, names, company):
	"""Each party (of `names`) with something open: its dues (items, tickable), credits held, totals; and the totals
	of all of them. Most owed first."""
	name_field = GROUP[party_type][2]
	items = open_items(party_type, names, company) if names else {}
	info = {}
	if items:
		from erp_dacsinc_custom.erp_dacsinc_custom.doctype.bulk_payment.bulk_payment import _party_info
		info = _party_info(party_type, list(items))
	label = dict(frappe.get_all(party_type, filters={"name": ["in", names]}, fields=["name", name_field], as_list=True)) if names else {}
	now = getdate(today())
	out, tot = [], frappe._dict(due=0.0, overdue=0.0, credits=0.0, items=0)
	for party, its in items.items():
		due = _dues(its)
		credits = [i for i in its if i.outstanding < -0.005]
		other = [i for i in its if i.outstanding > 0.005 and i.kind not in PAYABLE_KINDS]   # e.g. a refund paid out
		m = frappe._dict(party=party, party_name=label.get(party) or party, **(info.get(party) or {}))
		m["items"] = [dict(i, outstanding=flt(i.outstanding, 2), late=(now - getdate(i.due_date)).days if i.due_date and getdate(i.due_date) < now else 0)
					  for i in due + other]
		m.credits = [dict(i, amount=flt(-i.outstanding, 2)) for i in credits]
		m.due = flt(sum(i.outstanding for i in due + other), 2)
		m.overdue = flt(sum(i["outstanding"] for i in m["items"] if i["late"]), 2)
		m.credit = flt(sum(i["amount"] for i in m.credits), 2)
		m.net = flt(m.due - m.credit, 2)
		tot.due += m.due; tot.overdue += m.overdue; tot.credits += m.credit; tot["items"] += len(due)
		out.append(m)
	out.sort(key=lambda m: (-m.due, m.party_name))
	for k in ("due", "overdue", "credits"):
		tot[k] = flt(tot[k], 2)
	tot.net = flt(tot.due - tot.credits, 2)
	return out, tot


@frappe.whitelist()
def search(party_type, txt, company=None, scope=None):
	"""The page's one search bar: groups whose name has `txt`, and customers / suppliers matching it on id, name,
	mobile, email, GSTIN, group, address or contact phone (as the payment prompt) — each with what is open.
	scope "group": groups only; "party": customers / suppliers only (the page's By group / By customer)."""
	_check(party_type)
	txt = (txt or "").strip()
	if len(txt) < 2:
		return {"groups": [], "parties": []}
	company = company or frappe.defaults.get_user_default("Company")
	group_dt, field, name_field = GROUP[party_type]
	groups = frappe.get_all(group_dt, filters=[["name", "like", f"%{w}%"] for w in pieces(txt)], pluck="name",
							limit=20) if scope != "party" else []
	size = dict(frappe.db.sql(f"SELECT {field}, COUNT(*) FROM `tab{party_type}` WHERE disabled = 0 AND {field} IN %s GROUP BY {field}",
		(tuple(groups),))) if groups else {}
	from erp_dacsinc_custom.erp_dacsinc_custom.doctype.bulk_payment.bulk_payment import _party_info, _search_parties
	names = _search_parties(party_type, txt, limit=60)[:30] if scope != "group" else []
	rows = frappe.get_all(party_type, filters={"name": ["in", names]}, fields=["name", name_field, field]) if names else []
	info = _party_info(party_type, names)
	due = {}
	for party, its in (open_items(party_type, names, company) if names else {}).items():
		due[party] = (flt(sum(i.outstanding for i in _dues(its)), 2), flt(-sum(i.outstanding for i in its if i.outstanding < -0.005), 2))
	parties = [dict(party=r.name, party_name=r.get(name_field) or r.name, group=r.get(field), due=due.get(r.name, (0, 0))[0],
					credit=due.get(r.name, (0, 0))[1], **(info.get(r.name) or {})) for r in rows]
	parties.sort(key=lambda r: (-r["due"], r["party_name"]))
	return {"groups": [{"group": g, "members": size.get(g) or 0} for g in groups], "parties": parties}


@frappe.whitelist()
def get_party_view(party_type, party, from_date=None, to_date=None, company=None):
	"""One customer / supplier on the page: what is open (as a group member, tickable for a payment) and the ledger
	for the dates (opening, every entry with a running balance, closing — party_statement's statement data)."""
	from frappe.utils import add_months, nowdate

	from erp_dacsinc_custom.party_statement import _statement_data

	_check(party_type)
	if not frappe.has_permission(party_type, "read", party):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	company = company or frappe.defaults.get_user_default("Company")
	to_date = getdate(to_date or nowdate())
	from_date = getdate(from_date or add_months(to_date, -12))
	group_dt, field, name_field = GROUP[party_type]
	doc = frappe.db.get_value(party_type, party, [name_field, field, "disabled"], as_dict=True)
	out, tot = _views(party_type, [party], company)
	from erp_dacsinc_custom.erp_dacsinc_custom.doctype.bulk_payment.bulk_payment import _party_info
	m = out[0] if out else frappe._dict(party=party, party_name=doc.get(name_field) or party, items=[], credits=[],
										due=0, overdue=0, credit=0, net=0, **(_party_info(party_type, [party]).get(party) or {}))
	opening, entries, closing, receivable = _statement_data(party_type, party, from_date, to_date, company)
	gsize = frappe.db.count(party_type, {field: doc.get(field), "disabled": 0}) if doc.get(field) else 0
	return {"party_type": party_type, "payment_type": PAYMENT_TYPE[party_type], "company": company,
			"currency": frappe.get_cached_value("Company", company, "default_currency"),
			"party": party, "party_name": doc.get(name_field) or party, "disabled": doc.disabled,
			"group": doc.get(field), "group_is_firm": 2 <= gsize <= MAX_PROMPT_MEMBERS,
			"member": m, "totals": tot, "from_date": from_date, "to_date": to_date,
			"ledger": {"opening": opening, "entries": entries, "closing": closing, "receivable": receivable},
			"can_pay": bool(frappe.has_permission("Payment Entry", "create") and frappe.has_permission("Payment Entry", "submit")),
			"letter_head": _letter_head_html(company)}


def _letter_head_html(company):
	"""the company's default letter head, rendered, for the page's Print (same as the statement of account)"""
	from frappe.www.printview import get_letter_head

	lh = get_letter_head(frappe._dict(company=company), False) or {}
	return frappe.render_template(lh["content"], {"doc": frappe._dict(company=company)}) if lh.get("content") else ""
