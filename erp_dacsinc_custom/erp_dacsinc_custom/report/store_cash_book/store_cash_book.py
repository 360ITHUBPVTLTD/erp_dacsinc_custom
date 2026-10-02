"""Store Cash Book: one line per POS shift (opening → closing) with the cash in the drawer
(docs/pos-store-scope.md › Cash in the drawer).

What was left at the store's previous closing, what the shift opened with (and why it
differs), the shift's sales by cash / card / UPI, expected and counted cash, short /
extra (and why), cash handed over and cash left in the drawer for the next shift.
POS logins see only their stores (pos_report_scope: the POS Profile filter and column).
"""

import frappe
from frappe import _
from frappe.utils import add_days, flt, get_datetime, getdate, nowdate

from erp_dacsinc_custom.pos_cash import cash_modes


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return columns(), data(filters)


def columns():
	cur = lambda fn, label, w=110: {"fieldname": fn, "label": _(label), "fieldtype": "Currency", "width": w}
	return [
		{"fieldname": "pos_profile", "label": _("Store"), "fieldtype": "Link", "options": "POS Profile", "width": 120},
		{"fieldname": "opened_on", "label": _("Opened"), "fieldtype": "Datetime", "width": 150},
		{"fieldname": "cashier", "label": _("Cashier"), "fieldtype": "Data", "width": 130},
		{"fieldname": "status", "label": _("Shift"), "fieldtype": "Data", "width": 70},
		cur("carried", "Left at previous closing", 120),
		cur("opening_cash", "Opening cash"),
		cur("opening_mismatch", "Opening differs by", 110),
		{"fieldname": "opening_reason", "label": _("Why the opening differs"), "fieldtype": "Data", "width": 170},
		cur("cash_sales", "Cash sales (net of change)", 120),
		cur("card", "Card"),
		cur("upi", "UPI"),
		cur("other", "Other modes", 100),
		cur("expected_cash", "Expected cash"),
		cur("counted_cash", "Counted cash"),
		cur("short_extra", "Short (−) / extra (+)", 120),
		{"fieldname": "difference_reason", "label": _("Why short / extra"), "fieldtype": "Data", "width": 170},
		cur("handed_over", "Handed over"),
		cur("left_in_drawer", "Left in drawer"),
		{"fieldname": "opening_entry", "label": _("Opening Entry"), "fieldtype": "Link", "options": "POS Opening Entry", "width": 150},
		{"fieldname": "closing_entry", "label": _("Closing Entry"), "fieldtype": "Link", "options": "POS Closing Entry", "width": 160},
		{"fieldname": "closed_on", "label": _("Closed"), "fieldtype": "Datetime", "width": 150},
	]


def _rows(child, parents, fields):
	out = {}
	if parents:
		for r in frappe.get_all(child, filters={"parent": ["in", list(parents)]}, fields=["parent", *fields]):
			out.setdefault(r.parent, []).append(r)
	return out


def data(filters):
	from_date = getdate(filters.from_date or add_days(nowdate(), -30))
	to_date = getdate(filters.to_date or nowdate())
	of = {"docstatus": 1, "period_start_date": ["between", [get_datetime(from_date), get_datetime(f"{to_date} 23:59:59")]]}
	if filters.pos_profile:
		of["pos_profile"] = filters.pos_profile
	openings = frappe.get_all("POS Opening Entry", filters=of, order_by="pos_profile, period_start_date",
							  fields=["name", "pos_profile", "period_start_date", "user", "status", "custom_opening_change_reason"])
	if not openings:
		return []
	stores = sorted({o.pos_profile for o in openings})
	# every submitted closing of these stores up to the end of the range (the previous one may be older)
	closings = frappe.get_all("POS Closing Entry", filters={"docstatus": 1, "pos_profile": ["in", stores],
			"period_end_date": ["<=", get_datetime(f"{to_date} 23:59:59")]},
			fields=["name", "pos_profile", "pos_opening_entry", "period_end_date", "custom_cash_handed_over",
					"custom_difference_reason"], order_by="period_end_date")
	pay = _rows("POS Closing Entry Detail", [c.name for c in closings],
				["mode_of_payment", "opening_amount", "expected_amount", "closing_amount"])
	bal = _rows("POS Opening Entry Detail", [o.name for o in openings], ["mode_of_payment", "opening_amount"])
	modes = {r.mode_of_payment for rows in list(pay.values()) + list(bal.values()) for r in rows}
	cash = cash_modes(modes)
	for c in closings:
		rows = pay.get(c.name, [])
		c.counted = flt(sum(flt(r.closing_amount) for r in rows if r.mode_of_payment in cash), 2)
		c.left = flt(c.counted - flt(c.custom_cash_handed_over), 2)
	by_opening = {c.pos_opening_entry: c for c in closings if c.pos_opening_entry}
	names = {u: frappe.utils.get_fullname(u) for u in {o.user for o in openings}}

	out = []
	for o in openings:
		prev = None
		for c in closings:  # the store's last closing before this shift opened
			if c.pos_profile == o.pos_profile and c.period_end_date <= o.period_start_date and c.pos_opening_entry != o.name:
				prev = c
		opening_cash = flt(sum(flt(b.opening_amount) for b in bal.get(o.name, []) if b.mode_of_payment in cash), 2)
		row = frappe._dict(
			pos_profile=o.pos_profile, opened_on=o.period_start_date, cashier=names.get(o.user) or o.user,
			status=_("Open") if o.status == "Open" else _("Closed"), opening_entry=o.name,
			carried=prev.left if prev else None, opening_cash=opening_cash,
			opening_mismatch=flt(opening_cash - prev.left, 2) if prev else None,
			opening_reason=o.custom_opening_change_reason or "",
		)
		c = by_opening.get(o.name)
		if c:
			rows = pay.get(c.name, [])
			exp_cash = flt(sum(flt(r.expected_amount) for r in rows if r.mode_of_payment in cash), 2)
			open_cash = flt(sum(flt(r.opening_amount) for r in rows if r.mode_of_payment in cash), 2)
			other = [r for r in rows if r.mode_of_payment not in cash]
			kind = lambda r: "upi" if "upi" in r.mode_of_payment.lower() else "card" if "card" in r.mode_of_payment.lower() else "other"
			row.update(
				closing_entry=c.name, closed_on=c.period_end_date, expected_cash=exp_cash, counted_cash=c.counted,
				cash_sales=flt(exp_cash - open_cash, 2), short_extra=flt(c.counted - exp_cash, 2),
				difference_reason=c.custom_difference_reason or "", handed_over=flt(c.custom_cash_handed_over),
				left_in_drawer=c.left,
				**{k: flt(sum(flt(r.expected_amount) - flt(r.opening_amount) for r in other if kind(r) == k), 2)
				   for k in ("card", "upi", "other")},
			)
		out.append(row)
	return out
