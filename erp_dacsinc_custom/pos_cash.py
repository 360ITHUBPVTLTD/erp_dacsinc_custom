"""Cash in the POS drawer, from one shift to the next (docs/pos-store-scope.md › Cash in the drawer).

- **Closing:** every Closing Amount starts at its expected amount (pos_closing.make_closing_entry);
  the cashier changes it only where the cash counted / machine / app differs. Cash
  taken out of the drawer at closing is "Cash handed over"; what stays is "Cash left in
  drawer" = counted cash − handed over. A closing with any short / extra amount needs a
  reason before it is submitted.
- **Opening:** one open shift per store (POS Profile) at a time: a store has one drawer.
  Card / UPI open at 0 (only cash sits in a drawer). The cash opening starts
  from the store's last submitted closing ("left in drawer", carried forward); opening
  with a different amount needs a reason. The first shift of a store has nothing to carry.
- **Store Cash Book** (report): one line per shift with all of it, and the mismatches.

Cash = a Mode of Payment of type Cash. Rules run on the documents themselves
(validate / before_submit), so they hold however the entry is made.
"""

import frappe
from frappe import _
from frappe.utils import flt, fmt_money, format_datetime

# Above the payment table, as steps: the cashier types the cash counted here (copied into
# the cash row's Closing Amount), says why if it's short / extra, and what is taken out.
DIFF_EVAL = ("eval:(doc.payment_reconciliation || []).some(r => Math.abs((r.closing_amount || 0) - "
			 "(r.expected_amount || 0)) > 0.004)")
CLOSING_FIELDS = [
	{"fieldname": "custom_cash_section", "fieldtype": "Section Break", "label": "Close the cash drawer",
	 "insert_after": "payment_reconciliation_details",
	 "description": "Fill in before submitting. Everything starts at the expected amount. "
					"1. Count the notes and coins in the drawer: change Cash counted only if the total differs. "
					"2. If anything is short or extra, say why. "
					"3. Enter the cash you take out now (to the office / bank), 0 if none. "
					"What stays is left in the drawer and the next shift starts with it. "
					"Then check card / UPI in Payment modes below."},
	{"fieldname": "custom_expected_cash", "fieldtype": "Currency", "label": "Cash expected in the drawer", "read_only": 1,
	 "insert_after": "custom_cash_section",
	 "description": "Opening cash + cash sales − change given back."},
	{"fieldname": "custom_cash_counted", "fieldtype": "Currency", "label": "1. Cash counted in the drawer", "bold": 1,
	 "insert_after": "custom_expected_cash",
	 "description": "Filled with the expected cash. Count the notes and coins; change it only if the total differs."},
	{"fieldname": "custom_cash_short_extra", "fieldtype": "Currency", "label": "Short (−) / extra (+)", "read_only": 1,
	 "insert_after": "custom_cash_counted"},
	{"fieldname": "custom_cash_cb", "fieldtype": "Column Break", "insert_after": "custom_cash_short_extra"},
	{"fieldname": "custom_difference_reason", "fieldtype": "Small Text", "label": "2. Why short / extra",
	 "insert_after": "custom_cash_cb", "depends_on": DIFF_EVAL, "mandatory_depends_on": DIFF_EVAL,
	 "description": "Needed when any payment mode's Closing Amount differs from Expected."},
	{"fieldname": "custom_cash_handed_over", "fieldtype": "Currency", "label": "3. Cash taken out now",
	 "insert_after": "custom_difference_reason",
	 "description": "Cash taken out of the drawer at closing (to the office / bank). 0 if none."},
	{"fieldname": "custom_cash_left_in_drawer", "fieldtype": "Currency", "label": "Cash left in drawer for the next shift",
	 "read_only": 1, "bold": 1, "insert_after": "custom_cash_handed_over",
	 "description": "Counted − taken out. The next shift of this store opens with it."},
]
OPENING_FIELDS = [
	{"fieldname": "custom_carry_section", "fieldtype": "Section Break", "label": "Carried from the last closing",
	 "insert_after": "balance_details"},
	{"fieldname": "custom_previous_closing", "fieldtype": "Link", "options": "POS Closing Entry", "read_only": 1,
	 "label": "Last closing of this store", "insert_after": "custom_carry_section"},
	{"fieldname": "custom_carried_forward", "fieldtype": "Currency", "label": "Cash left at that closing", "read_only": 1,
	 "insert_after": "custom_previous_closing"},
	{"fieldname": "custom_carry_cb", "fieldtype": "Column Break", "insert_after": "custom_carried_forward"},
	{"fieldname": "custom_opening_change_reason", "fieldtype": "Small Text", "label": "Reason the cash differs",
	 "insert_after": "custom_carry_cb",
	 "description": "Needed when the cash opening differs from the cash left at the last closing."},
]


# Form layout: what the cashier fills in first (cash drawer steps, then payment modes); the
# shift details (filled in automatically), totals and the bills after. Applied once
# (apply_closing_layout) and exported with the custom fields to custom/pos_closing_entry.json.
CLOSING_FIELD_ORDER = [
	"custom_cash_section", "custom_expected_cash", "custom_cash_counted", "custom_cash_short_extra", "custom_cash_cb",
	"custom_difference_reason", "custom_cash_handed_over", "custom_cash_left_in_drawer",
	"section_break_11", "payment_reconciliation", "section_break_9", "payment_reconciliation_details",
	"period_details_section", "pos_opening_entry", "pos_profile", "user", "company", "column_break_3",
	"period_start_date", "period_end_date", "posting_date", "posting_time", "status",
	"section_break_5", "column_break_7",
	"section_break_13", "grand_total", "net_total", "total_quantity", "column_break_16", "taxes",
	"section_break_12", "pos_transactions",
	"failure_description_section", "error_message", "section_break_14", "amended_from",
]
CLOSING_FIELD_PROPS = [
	("section_break_11", "label", "Payment modes"),
	("section_break_11", "description", "Card / UPI: check each Closing Amount against the card machine / UPI app; "
										"change it only if it differs. The cash row follows step 1 above."),
	("period_details_section", "label", "Shift (filled in automatically)"),
	("section_break_13", "label", "Totals"),
	("section_break_12", "label", "Bills in this shift"),
	("section_break_12", "collapsible", "1"),
]


def apply_closing_layout():
	"""Field order and section labels of POS Closing Entry (Property Setters)."""
	import json

	frappe.make_property_setter({"doctype": "POS Closing Entry", "doctype_or_field": "DocType", "property": "field_order",
								 "value": json.dumps(CLOSING_FIELD_ORDER), "property_type": "Data"},
								validate_fields_for_doctype=False)
	for field, prop, value in CLOSING_FIELD_PROPS:
		frappe.make_property_setter({"doctype": "POS Closing Entry", "doctype_or_field": "DocField", "fieldname": field,
									 "property": prop, "value": value,
									 "property_type": "Check" if prop == "collapsible" else "Text" if prop == "description" else "Data"},
									validate_fields_for_doctype=False)
	frappe.clear_cache(doctype="POS Closing Entry")


def create_fields():
	"""after_migrate (idempotent)."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({"POS Closing Entry": CLOSING_FIELDS, "POS Opening Entry": OPENING_FIELDS}, update=True)


def cash_modes(modes=None):
	filters = {"type": "Cash"}
	if modes is not None:
		filters["name"] = ["in", list(modes) or [""]]
	return set(frappe.get_all("Mode of Payment", filters=filters, pluck="name"))


@frappe.whitelist()
def which_are_cash(modes):
	"""The cash ones among these payment modes (the closing form, for any POS login)."""
	return sorted(cash_modes(frappe.parse_json(modes) if isinstance(modes, str) else modes))


def _m(v):
	return fmt_money(v, currency=frappe.db.get_default("currency") or "INR")


# ------------------------------------------------------------------ closing
def closing_cash(rows, handed_over=0):
	"""(counted cash, left in drawer) from a closing's payment rows."""
	cash = cash_modes(r.mode_of_payment for r in rows)
	counted = flt(sum(flt(r.closing_amount) for r in rows if r.mode_of_payment in cash), 2)
	return counted, flt(counted - flt(handed_over), 2)


def closing_validate(doc, method=None):
	"""POS Closing Entry validate: differences, counted cash, handed over, left in drawer."""
	if doc.docstatus == 2:
		return
	rows = doc.get("payment_reconciliation") or []
	for r in rows:
		r.difference = flt(flt(r.closing_amount) - flt(r.expected_amount), 2)
	handed = flt(doc.get("custom_cash_handed_over"), 2)
	counted, left = closing_cash(rows, handed)
	if handed < 0:
		frappe.throw(_("Cash handed over can't be less than 0."))
	if handed > counted + 0.004:
		frappe.throw(_("Cash taken out ({0}) is more than the cash counted ({1}). Enter the cash counted first (step 1).").format(
			_m(handed), _m(counted)))
	cash = cash_modes(r.mode_of_payment for r in rows)
	expected = flt(sum(flt(r.expected_amount) for r in rows if r.mode_of_payment in cash), 2)
	doc.custom_expected_cash = expected
	doc.custom_cash_counted = counted
	doc.custom_cash_short_extra = flt(counted - expected, 2)
	doc.custom_cash_left_in_drawer = left


def closing_before_submit(doc, method=None):
	"""A short / extra amount needs its reason."""
	off = [r for r in doc.get("payment_reconciliation") or [] if abs(flt(r.difference)) > 0.004]
	if off and not (doc.get("custom_difference_reason") or "").strip():
		lines = "".join(
			f"<li>{frappe.bold(r.mode_of_payment)}: counted {_m(r.closing_amount)}, expected {_m(r.expected_amount)} "
			f"({_('short') if flt(r.difference) < 0 else _('extra')} {_m(abs(flt(r.difference)))})</li>" for r in off)
		frappe.throw(_("Enter the amount actually counted for each mode. Where it still differs from Expected, "
					   "give the reason in <b>2. Why short / extra</b>:") + f"<ul>{lines}</ul>",
					 title=_("Closing amount differs"))


# ------------------------------------------------------------------ opening
def last_closing(pos_profile, before=None, exclude_opening=None):
	"""The store's last submitted closing (optionally ending before a time): its cash left
	in the drawer. Older closings (before these fields) count their cash rows, nothing handed over."""
	filters = {"pos_profile": pos_profile, "docstatus": 1}
	if before:
		filters["period_end_date"] = ["<=", before]
	if exclude_opening:
		filters["pos_opening_entry"] = ["!=", exclude_opening]
	name = frappe.db.get_value("POS Closing Entry", filters, "name", order_by="period_end_date desc, creation desc")
	if not name:
		return None
	c = frappe.get_doc("POS Closing Entry", name)
	handed = flt(c.get("custom_cash_handed_over"), 2)
	counted, left = closing_cash(c.payment_reconciliation, handed)
	return frappe._dict(name=c.name, period_end_date=c.period_end_date, user=c.user,
						user_name=frappe.utils.get_fullname(c.user), counted=counted, handed_over=handed, left=left)


def opening_validate(doc, method=None):
	"""POS Opening Entry validate (a draft, and on submit): card / UPI open at 0; the cash
	opening is the last closing's cash left in the drawer, or comes with a reason."""
	if doc.docstatus == 2:
		return
	# One drawer per store (POS Profile): one open shift at a time, so the cash is counted once
	# and the next shift carries the right amount.
	other = frappe.db.get_value("POS Opening Entry", {"pos_profile": doc.pos_profile, "docstatus": 1, "status": "Open",
			"name": ["!=", doc.name or ""]}, ["name", "user", "period_start_date"], as_dict=True) if doc.pos_profile else None
	if other:
		frappe.throw(_("{0} already has an open shift ({1}, opened by {2} on {3}). A store has one cash drawer: "
					   "close that shift first.").format(frappe.bold(doc.pos_profile), other.name,
						frappe.utils.get_fullname(other.user), format_datetime(other.period_start_date, "dd-MM-yyyy HH:mm")),
					 title=_("Shift already open"))
	rows = doc.get("balance_details") or []
	cash = cash_modes(r.mode_of_payment for r in rows)
	bad = [r for r in rows if r.mode_of_payment not in cash and abs(flt(r.opening_amount)) > 0.004]
	if bad:
		frappe.throw(_("Only cash has an opening amount; card and UPI start each shift at 0. Set these to 0: {0}").format(
			", ".join(frappe.bold(r.mode_of_payment) for r in bad)))
	if any(flt(r.opening_amount) < 0 for r in rows):
		frappe.throw(_("An opening amount can't be less than 0."))
	prev = last_closing(doc.pos_profile, before=doc.period_start_date) if doc.pos_profile else None
	doc.custom_previous_closing = prev.name if prev else None
	doc.custom_carried_forward = prev.left if prev else 0
	opening_cash = flt(sum(flt(r.opening_amount) for r in rows if r.mode_of_payment in cash), 2)
	if prev and abs(opening_cash - prev.left) > 0.004 and not (doc.get("custom_opening_change_reason") or "").strip():
		frappe.throw(
			_("The cash opening ({0}) differs from the cash left in the drawer at the last closing of {1}: {2} "
			  "({3}, {4}, {5}). Open with {2}, or give the reason the cash differs.").format(
				_m(opening_cash), frappe.bold(doc.pos_profile), frappe.bold(_m(prev.left)), prev.name,
				format_datetime(prev.period_end_date, "dd-MM-yyyy HH:mm"), prev.user_name),
			title=_("Cash opening differs"))


def _check_profile(pos_profile):
	if not frappe.has_permission("POS Profile", "read", pos_profile) and not frappe.db.exists(
			"POS Profile User", {"parent": pos_profile, "user": frappe.session.user}):
		frappe.throw(_("Not permitted."), frappe.PermissionError)


@frappe.whitelist()
def opening_defaults(pos_profile):
	"""For the opening dialog: the store's payment modes (cash first) and what the last
	closing left in the drawer."""
	_check_profile(pos_profile)
	modes = [p.mode_of_payment for p in frappe.get_all("POS Payment Method", filters={"parent": pos_profile,
			"parenttype": "POS Profile"}, fields=["mode_of_payment"], order_by="idx")]
	cash = cash_modes(modes)
	prev = last_closing(pos_profile)
	return {"cash": [m for m in modes if m in cash], "other": [m for m in modes if m not in cash],
			"last": dict(prev, period_end=format_datetime(prev.period_end_date, "dd-MM-yyyy HH:mm")) if prev else None}


@frappe.whitelist(methods=["POST"])
def create_opening(pos_profile, company, balance_details, reason=None):
	"""The opening dialog's Submit: ERPNext's create_opening_voucher, plus the reason."""
	_check_profile(pos_profile)
	doc = frappe.get_doc({
		"doctype": "POS Opening Entry", "period_start_date": frappe.utils.get_datetime(),
		"posting_date": frappe.utils.getdate(), "user": frappe.session.user, "pos_profile": pos_profile,
		"company": company, "custom_opening_change_reason": (reason or "").strip() or None,
	})
	doc.set("balance_details", frappe.parse_json(balance_details))
	doc.submit()
	return doc.as_dict()


# ------------------------------------------------------------------ one-time clean-up
# Live had shifts left open for months and setup-time test bills that never reached the
# accounts (patch close_stale_pos_shifts, 2026-10-02, the user's choice: cancel the test bills).
TEST_BILLS_BEFORE = "2026-09-01"  # real store sales start in September 2026


def close_stale_shifts(dry_run=False):
	"""1. Cancel submitted POS bills dated before TEST_BILLS_BEFORE that never reached the
	accounts (no consolidated Sales Invoice) — setup-time tests.
	2. Close every shift still open from before today: a closing entry with closing amounts =
	expected (not counted; a comment says so), no closing email. A real bill in such a shift
	is posted as usual. Today's shifts (in use) are left alone. Each step on its own: one
	failure is logged and the rest go on. Returns what was (or would be) done."""
	from frappe.utils import nowdate

	from erp_dacsinc_custom.pos_closing import make_closing_entry

	out = {"cancelled_bills": [], "closed_shifts": [], "failed": [], "bills_outside_any_shift": []}
	bills = frappe.get_all("POS Invoice", filters={"docstatus": 1, "posting_date": ["<", TEST_BILLS_BEFORE],
			"consolidated_invoice": ["in", ["", None]]}, fields=["name", "pos_profile", "posting_date", "grand_total"],
			order_by="is_return desc, posting_date")  # returns first: a return blocks cancelling its bill
	for b in bills:
		out["cancelled_bills"].append(f"{b.name} ({b.pos_profile}, {b.posting_date}, {flt(b.grand_total):.2f})")
		if dry_run:
			continue
		frappe.db.savepoint("dacs_bill")
		try:
			inv = frappe.get_doc("POS Invoice", b.name)
			inv.flags.ignore_permissions = True
			inv.cancel()
			inv.add_comment("Comment", "Cancelled automatically: a setup-time test bill (before "
							f"{TEST_BILLS_BEFORE}) that never reached the accounts.")
		except Exception:
			frappe.db.rollback(save_point="dacs_bill")
			out["failed"].append(f"cancel {b.name}: {frappe.get_traceback().strip().splitlines()[-1]}")
			frappe.log_error(title=f"POS clean-up: cancel {b.name}")

	today = nowdate()
	shifts = frappe.get_all("POS Opening Entry", filters={"docstatus": 1, "status": "Open",
			"period_start_date": ["<", today]}, fields=["name", "pos_profile", "user", "period_start_date"],
			order_by="period_start_date")
	for o in shifts:
		label = f"{o.name} ({o.pos_profile}, {frappe.utils.get_fullname(o.user)}, opened {o.period_start_date:%d-%m-%Y})"
		if dry_run:
			out["closed_shifts"].append(label)
			continue
		frappe.db.savepoint("dacs_shift")
		try:
			c = make_closing_entry(o.name)
			c.flags.ignore_permissions = True
			c.flags.dacs_auto_closed = True
			c.insert()
			c.submit()
			c.add_comment("Comment", "Closed automatically when the cash-drawer rules were installed: the shift had been "
							"left open. Closing amounts are the expected amounts; the cash was not counted.")
			out["closed_shifts"].append(f"{label} → {c.name}, {len(c.pos_transactions)} bills")
		except Exception:
			frappe.db.rollback(save_point="dacs_shift")
			out["failed"].append(f"close {o.name}: {frappe.get_traceback().strip().splitlines()[-1]}")
			frappe.log_error(title=f"POS clean-up: close {o.name}")
	# Listed only: bills that no shift will ever close (made without an open shift of that
	# cashier and store), so they never reach the accounts.
	out["bills_outside_any_shift"] = [f"{r[0]} ({r[1]}, {r[2]}, {r[3]})" for r in frappe.db.sql("""
		select i.name, i.pos_profile, i.owner, i.posting_date from `tabPOS Invoice` i
		where i.docstatus = 1 and ifnull(i.consolidated_invoice, '') = '' and i.posting_date >= %s
		  and not exists (select 1 from `tabPOS Opening Entry` o where o.docstatus = 1 and o.status = 'Open'
			and o.pos_profile = i.pos_profile and o.user = i.owner
			and o.period_start_date <= timestamp(i.posting_date, i.posting_time))
		  and not exists (select 1 from `tabPOS Invoice Reference` r join `tabPOS Closing Entry` c
			on c.name = r.parent and c.docstatus = 1 where r.pos_invoice = i.name)""", TEST_BILLS_BEFORE)]
	return out
