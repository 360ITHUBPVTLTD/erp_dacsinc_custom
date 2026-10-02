"""POS store paperwork: POS Material Requests, POS Stock Entries, closing report mail.

Only documents made from a POS login (POS Admin / POS Store Manager, admins excluded)
are touched. They get ticked automatically when created; every other Material
Request / Stock Entry is left exactly as it is.

- **Created by POS User** — Material Request `custom_is_pos_request`, Stock Entry
  `custom_is_pos_transfer`: set automatically when a POS Admin or POS Store Manager
  creates the document (admins excluded); `backfill_flags()` ticks older ones.
- **Material Request:** only those created by a **POS Store Manager** are emailed on
  submit, to Admin Settings › POS Emails › POS Material Request — Send To. Any other
  MR (POS Admin included) sends nothing.
- **Stock Entry** created by a POS user: one that moves stock to
  or from the stores' supply warehouse (Admin Settings › Source Warehouse, VV Puram -
  IND) needs warehouse approval: only Warehouse Incharge, Warehouse Executive, POS
  Admin (or an admin) may submit it. Whoever submits is recorded in Approved By
  (`custom_approved_by`). Store-to-store transfers keep the receiving-store rule
  (pos_scope.guard_pos_transfer_submit).
- **POS Closing Entry** submitted → a sales report is emailed to Admin Settings ›
  POS Closing Report — Send To. It covers the opening entry, the cash drawer
  statement and card / UPI check (cash_statement), invoices, returns, discounts, taxes and top
  items, and attaches an Excel (Summary / Invoices / Items / Payments). The Excel
  is built in memory and attached as content, so no File record is ever created.
"""

import io

import frappe
from frappe.utils import cint, flt, fmt_money, format_datetime, formatdate, get_url_to_form

POS_ROLES = ("POS Admin", "POS Store Manager")
APPROVER_ROLES = ("Warehouse Incharge", "Warhouse Executive", "POS Admin")


def ensure_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({
		"Material Request": [{
			"fieldname": "custom_is_pos_request", "fieldtype": "Check", "label": "Created by POS User", "read_only": 1,
			"insert_after": "material_request_type", "in_standard_filter": 1, "no_copy": 1,
			"depends_on": "eval:doc.custom_is_pos_request", "description": "Set automatically for POS users.",
		}],
		"Stock Entry": [
			{"fieldname": "custom_is_pos_transfer", "fieldtype": "Check", "label": "Created by POS User", "read_only": 1,
			 "insert_after": "stock_entry_type", "in_standard_filter": 1, "no_copy": 1,
			 "depends_on": "eval:doc.custom_is_pos_transfer", "description": "Set automatically for POS users."},
			{"fieldname": "custom_approved_by", "fieldtype": "Link", "options": "User", "label": "Approved By",
			 "read_only": 1, "insert_after": "custom_is_pos_transfer", "depends_on": "eval:doc.custom_is_pos_transfer",
			 "no_copy": 1},
		],
	}, update=True)


def _is_pos_login(user=None):
	from erp_dacsinc_custom.order_flow_permissions import is_admin

	user = user or frappe.session.user
	return bool(set(frappe.get_roles(user)) & set(POS_ROLES)) and not is_admin(user)


def _recipients(field):
	raw = frappe.db.get_single_value("Admin Settings", field) if frappe.get_meta("Admin Settings").has_field(field) else ""
	out = []
	for part in (raw or "").replace(";", ",").replace("\n", ",").split(","):
		part = part.strip()
		if part and frappe.utils.validate_email_address(part):
			out.append(part)
	return sorted(set(out))


# ------------------------------------------------------------------ ticks
def _is_store_manager(user=None):
	"""A POS Store Manager (admins excluded) — the only creator whose MRs are POS Requests."""
	from erp_dacsinc_custom.order_flow_permissions import is_admin

	user = user or frappe.session.user
	return "POS Store Manager" in frappe.get_roles(user) and not is_admin(user)


def mark_pos_request(doc, method=None):
	"""Material Request before_insert: "Created by POS User" (POS Admin / POS Store Manager)."""
	doc.custom_is_pos_request = 1 if _is_pos_login() else 0


def force_pos_transfer_type(doc, method=None):
	"""Material Request before_validate: a POS user's MR is always a Material Transfer.
	Runs before clear_mr_from_warehouse_unless_transfer, so the source warehouse stays."""
	if cint(doc.get("custom_is_pos_request")) or (doc.is_new() and _is_pos_login()):
		doc.material_request_type = "Material Transfer"


def mark_pos_transfer(doc, method=None):
	"""Stock Entry before_insert."""
	doc.custom_is_pos_transfer = 1 if _is_pos_login() else 0


def backfill_flags():
	"""Tick "Created by POS User" on existing MRs / Stock Entries made by POS users
	(owner holds POS Admin / POS Store Manager and is not an admin). Returns counts."""
	users = [u for u in set(frappe.get_all("Has Role", filters={"parenttype": "User", "role": ["in", POS_ROLES]},
											pluck="parent")) if _is_pos_login(u)]
	out = {}
	for dt, field in (("Material Request", "custom_is_pos_request"), ("Stock Entry", "custom_is_pos_transfer")):
		names = frappe.get_all(dt, filters={"owner": ["in", users], field: 0}, pluck="name") if users else []
		for n in names:
			frappe.db.set_value(dt, n, field, 1, update_modified=False)
		out[dt] = len(names)
	return out


# ------------------------------------------------------------------ Stock Entry approval
def needs_warehouse_approval(doc):
	if not cint(doc.get("custom_is_pos_transfer")):
		return False
	from erp_dacsinc_custom.pos_scope import pos_source_warehouse

	supply = pos_source_warehouse()
	if not supply:
		return False
	# The rows are what moves stock. The header warehouses are only defaults
	# (ERPNext fills the header target from Stock Settings even for store → store).
	whs = set()
	for d in doc.get("items") or []:
		whs |= {d.get("s_warehouse"), d.get("t_warehouse")}
	return supply in whs


def can_approve(user=None):
	from erp_dacsinc_custom.order_flow_permissions import is_admin

	user = user or frappe.session.user
	return is_admin(user) or bool(set(frappe.get_roles(user)) & set(APPROVER_ROLES))


def guard_pos_approval(doc, method=None):
	"""Stock Entry before_submit: POS transfers to / from the supply warehouse are
	approved (submitted) only by Warehouse Incharge / Warehouse Executive / POS Admin."""
	if not needs_warehouse_approval(doc):
		return
	if not can_approve():
		frappe.throw(
			frappe._("This POS transfer moves stock to or from {0}, so it needs warehouse approval: "
					 "Warehouse Incharge, Warehouse Executive or POS Admin submits it.").format(
				frappe.bold(frappe.utils.escape_html(doc.from_warehouse or doc.to_warehouse or ""))),
			title=frappe._("Waiting for warehouse approval"))
	doc.custom_approved_by = frappe.session.user


@frappe.whitelist()
def get_pos_transfer_state(name):
	"""For the Stock Entry form: does it need approval, and may this user approve it?"""
	doc = frappe.get_doc("Stock Entry", name)
	doc.check_permission("read")
	return {"needs_approval": needs_warehouse_approval(doc), "can_approve": can_approve()}


# ------------------------------------------------------------------ Material Request mail
def send_pos_mr_email(doc, method=None):
	"""Material Request on_submit: only POS Requests created by a POS Store Manager."""
	if not cint(doc.get("custom_is_pos_request")) or not _is_store_manager(doc.owner):
		return
	recipients = _recipients("pos_mr_email_recipients")
	if not recipients:
		return
	frappe.enqueue("erp_dacsinc_custom.pos_notify._mail_mr", queue="short", enqueue_after_commit=True,
				   name=doc.name, recipients=recipients)


def _mail_mr(name, recipients):
	doc = frappe.get_doc("Material Request", name)
	from erp_dacsinc_custom.pos_scope import get_stock_for_rows

	rows = [{"item_code": d.item_code, "warehouse": d.warehouse or doc.set_warehouse,
			 "from_warehouse": d.from_warehouse or doc.set_from_warehouse} for d in doc.items]
	stock = get_stock_for_rows(frappe.as_json(rows))
	store = doc.set_warehouse or (doc.items[0].warehouse if doc.items else "")
	source = doc.set_from_warehouse or (doc.items[0].from_warehouse if doc.items else "")

	def st(item, wh):
		v = stock.get(f"{item}||{wh}") if wh else None
		return f"{flt(v['actual']):g}" if v else "0"

	lines = "".join(f"""<tr>
		<td style="{TD}">{frappe.utils.escape_html(d.item_code)}<div style="color:#6b7280;font-size:12px;">{frappe.utils.escape_html(d.item_name or "")}</div></td>
		<td style="{TD}text-align:right;"><b>{flt(d.qty):g}</b> {frappe.utils.escape_html(d.uom or d.stock_uom or "")}</td>
		<td style="{TD}text-align:right;">{st(d.item_code, d.from_warehouse or doc.set_from_warehouse)}</td>
		<td style="{TD}text-align:right;">{st(d.item_code, d.warehouse or doc.set_warehouse)}</td></tr>""" for d in doc.items)
	body = _shell(
		f"Material Request from {frappe.utils.escape_html(store)}",
		f"{doc.name} · {formatdate(doc.transaction_date)}",
		_facts([("Store (target)", store), ("Requested from (source)", source), ("Type", doc.material_request_type),
				("Required by", formatdate(doc.schedule_date)), ("Raised by", frappe.utils.get_fullname(doc.owner)),
				("Items / total qty", f"{len(doc.items)} / {sum(flt(d.qty) for d in doc.items):g}")])
		+ f"""<h3 style="{H3}">Items</h3>
		<table style="{TABLE}"><tr><th style="{TH}text-align:left;">Item</th><th style="{TH}text-align:right;">Requested</th>
		<th style="{TH}text-align:right;">Stock at source</th><th style="{TH}text-align:right;">Stock at store</th></tr>{lines}</table>"""
		+ _button(get_url_to_form("Material Request", doc.name), "Open the Material Request"))
	frappe.sendmail(recipients=recipients, subject=f"POS Material Request {doc.name} — {store}", message=body,
					reference_doctype="Material Request", reference_name=doc.name)


# ------------------------------------------------------------------ Closing report mail
def send_closing_report(doc, method=None):
	"""POS Closing Entry on_submit. Not for shifts closed automatically (pos_cash.close_stale_shifts)."""
	if doc.flags.dacs_auto_closed:
		return
	recipients = _recipients("pos_closing_email_recipients")
	if not recipients:
		return
	frappe.enqueue("erp_dacsinc_custom.pos_notify._mail_closing", queue="short", enqueue_after_commit=True,
				   name=doc.name, recipients=recipients)


def closing_data(name):
	c = frappe.get_doc("POS Closing Entry", name)
	opening = frappe.get_doc("POS Opening Entry", c.pos_opening_entry) if c.pos_opening_entry and \
		frappe.db.exists("POS Opening Entry", c.pos_opening_entry) else None
	names = [t.pos_invoice for t in c.pos_transactions if t.pos_invoice]
	inv_fields = ["name", "posting_date", "posting_time", "customer", "customer_name", "is_return", "return_against",
				  "total_qty", "net_total", "total_taxes_and_charges", "discount_amount", "grand_total",
				  "rounded_total", "change_amount", "owner"]
	if frappe.get_meta("POS Invoice").has_field("custom_walkin_name"):
		inv_fields += ["custom_walkin_name", "custom_walkin_mobile"]
	invoices = frappe.get_all("POS Invoice", filters={"name": ["in", names]}, fields=inv_fields,
							  order_by="posting_date, posting_time") if names else []
	items = frappe.get_all("POS Invoice Item", filters={"parent": ["in", names], "parenttype": "POS Invoice"},
						   fields=["parent", "idx", "item_code", "item_name", "item_group", "brand", "qty", "uom",
								   "price_list_rate", "discount_amount", "rate", "amount", "net_amount"],
						   order_by="parent, idx") if names else []
	pays = frappe.get_all("Sales Invoice Payment", filters={"parent": ["in", names], "parenttype": "POS Invoice"},
						  fields=["parent", "mode_of_payment", "amount"]) if names else []
	sales = [i for i in invoices if not i.is_return]
	returns = [i for i in invoices if i.is_return]
	line_disc = sum(flt(i.discount_amount) for i in items)
	top = {}
	for it in items:
		t = top.setdefault(it.item_code, {"item_code": it.item_code, "item_name": it.item_name, "qty": 0.0, "amount": 0.0})
		t["qty"] += flt(it.qty)
		t["amount"] += flt(it.amount)
	mode_totals = {}
	for p in pays:
		mode_totals[p.mode_of_payment] = mode_totals.get(p.mode_of_payment, 0) + flt(p.amount)
	return frappe._dict(
		closing=c, opening=opening, invoices=invoices, item_rows=items, payments=pays,
		sales_total=sum(flt(i.grand_total) for i in sales), returns_total=sum(flt(i.grand_total) for i in returns),
		sales_count=len(sales), returns_count=len(returns),
		qty=sum(flt(i.total_qty) for i in invoices), net=sum(flt(i.net_total) for i in invoices),
		taxes=sum(flt(i.total_taxes_and_charges) for i in invoices),
		bill_disc=sum(flt(i.discount_amount) for i in invoices), line_disc=line_disc,
		# what was actually paid: bills are paid at their rounded total
		grand=flt(sum(flt(i.rounded_total) or flt(i.grand_total) for i in invoices), 2), mode_totals=mode_totals,
		top=sorted(top.values(), key=lambda x: -x["amount"])[:15],
		currency=frappe.db.get_value("Company", c.company, "default_currency") or "INR",
	)


def _mail_closing(name, recipients):
	d = closing_data(name)
	c = d.closing
	m = lambda v: fmt_money(v, currency=d.currency)
	fname = f"POS Closing {c.pos_profile} {formatdate(c.posting_date, 'dd-MM-yyyy')} {c.name}.xlsx".replace("/", "-")
	frappe.sendmail(
		recipients=recipients, subject=f"POS Closing — {c.pos_profile} — {formatdate(c.posting_date)} — {m(d.grand)}",
		message=closing_mail_html(d), reference_doctype="POS Closing Entry", reference_name=c.name,
		attachments=[{"fname": fname, "fcontent": closing_excel(d)}])  # content, not a File


# ------------------------------------------------------------------ closing mail design
# Email-safe: tables and inline styles only (Gmail / Outlook / phones), 640 px wide.
INK, MUTED, LINE, SOFT = "#0f172a", "#64748b", "#e2e8f0", "#f8fafc"
ACCENT, GREEN, RED = "#4f46e5", "#059669", "#dc2626"
FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"


def _card(title, inner, note=""):
	head = (f"""<tr><td style="padding:16px 20px 6px;{FONT}">
		<div style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:{ACCENT};">{title}</div>
		{f'<div style="font-size:12px;color:{MUTED};margin-top:2px;">{note}</div>' if note else ''}</td></tr>""")
	return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid {LINE};
		border-radius:12px;margin:0 0 14px;border-collapse:separate;">{head}<tr><td style="padding:4px 20px 16px;{FONT}">{inner}</td></tr></table>"""


def _row(label, amount, note="", strong=False, alert=False, shade=False, dark=False):
	esc = frappe.utils.escape_html
	bg = INK if dark else (SOFT if shade else "#ffffff")
	col = "#ffffff" if dark else (RED if alert else INK)
	ncol = "#cbd5e1" if dark else (RED if alert else MUTED)
	w = "700" if strong or dark else "400"
	return f"""<tr>
		<td style="padding:9px 12px;background:{bg};border-bottom:1px solid {LINE};font-size:14px;color:{col};font-weight:{w};{FONT}">{esc(label)}
			{f'<div style="font-size:12px;font-weight:400;color:{ncol};margin-top:2px;">{esc(note)}</div>' if note else ''}</td>
		<td align="right" style="padding:9px 12px;background:{bg};border-bottom:1px solid {LINE};font-size:15px;color:{col};font-weight:{w};
			white-space:nowrap;{FONT}">{amount}</td></tr>"""


def _table(rows):
	return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid {LINE};
		border-radius:8px;overflow:hidden;">{rows}</table>"""


def _cash_html(d, m):
	"""Status line, the cash drawer statement and the card / UPI check."""
	st = cash_statement(d)
	esc = frappe.utils.escape_html
	issues = []
	if st.short_extra:
		issues.append(f"Cash {'short' if st.short_extra < 0 else 'extra'} by {m(abs(st.short_extra))}"
					  + (f" — {st.reason}" if st.reason else " — no reason given"))
	if st.opening_diff:
		issues.append(f"Opening cash differed from the last closing by {m(abs(st.opening_diff))}"
					  + (f" — {st.opening_reason}" if st.opening_reason else ""))
	for r in st.other_off:
		issues.append(f"{r.mode_of_payment} differs by {m(abs(flt(r.closing_amount) - flt(r.expected_amount)))}"
					  + (f" — {st.reason}" if st.reason else ""))
	if issues:
		banner = f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;"><tr>
			<td style="background:#fef2f2;border:1px solid #fecaca;border-left:5px solid {RED};border-radius:10px;padding:12px 16px;{FONT}">
			<div style="font-size:14px;font-weight:700;color:{RED};">&#9888; Please check</div>
			{''.join(f'<div style="font-size:13px;color:#7f1d1d;margin-top:4px;">• {esc(i)}</div>' for i in issues)}</td></tr></table>"""
	else:
		banner = f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;"><tr>
			<td style="background:#ecfdf5;border:1px solid #a7f3d0;border-left:5px solid {GREEN};border-radius:10px;padding:12px 16px;{FONT}">
			<span style="font-size:14px;font-weight:700;color:{GREEN};">&#10003; All amounts match</span>
			<span style="font-size:13px;color:#065f46;"> — cash counted equals the cash expected; card / UPI match.</span></td></tr></table>"""

	src = (f"left at the last closing {st.prev}" if st.prev else "no earlier closing for this store")
	rows = _row("Opening cash", m(st.opening), src)
	if st.opening_diff:
		rows += _row("Opening differs from the last closing", m(abs(st.opening_diff)), st.opening_reason or "no reason given", alert=True)
	rows += _row("+ Cash sales", m(st.sales))
	if st.refunds:
		rows += _row("− Cash refunds (returns)", m(st.refunds))
	rows += _row("− Change given back", m(st.change))
	rows += _row("= Cash expected in the drawer", m(st.expected), strong=True, shade=True)
	rows += _row("Cash counted", m(st.counted), strong=True)
	se = (("− " if st.short_extra < 0 else "+ ") + m(abs(st.short_extra))) if st.short_extra else m(0)
	rows += _row("Short (−) / extra (+)", se, (st.reason or "no reason given") if st.short_extra else "matches",
				 alert=bool(st.short_extra))
	rows += _row("− Cash taken out at closing", m(st.taken_out), "to the office / bank")
	rows += _row("Cash left in drawer for the next shift", m(st.left), dark=True)
	html = banner + _card("Cash drawer", _table(rows), "Opening + cash sales − change = expected; counted − taken out = left for the next shift")
	if st.other:
		orows = "".join(f"""<tr>
			<td style="padding:9px 8px;border-bottom:1px solid {LINE};font-size:14px;color:{INK};{FONT}">{esc(_mode_label(r.mode_of_payment))}</td>
			<td align="right" style="padding:9px 8px;border-bottom:1px solid {LINE};font-size:14px;color:{INK};white-space:nowrap;{FONT}">{m(r.expected_amount)}</td>
			<td align="right" style="padding:9px 8px;border-bottom:1px solid {LINE};font-size:14px;color:{INK};white-space:nowrap;{FONT}">{m(r.closing_amount)}</td>
			<td align="right" style="padding:9px 8px;border-bottom:1px solid {LINE};font-size:14px;font-weight:700;
				color:{RED if r in st.other_off else GREEN};{FONT}">{'&#10003;' if r not in st.other_off else m(flt(r.closing_amount) - flt(r.expected_amount))}</td></tr>"""
			for r in st.other)
		head = "".join(f'<td {"align=right " if i else ""}style="padding:8px 8px;background:{SOFT};border-bottom:1px solid {LINE};font-size:11px;'
					   f'font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:{MUTED};{FONT}">{h}</td>'
					   for i, h in enumerate(("Mode", "Sales", "Machine / app", "OK")))
		html += _card("Card / UPI", _table(f"<tr>{head}</tr>{orows}"), "Sales in the system against the card machine / UPI app")
	return html


def _mode_label(mode):
	"""'Card Payment - JP Nagar' → 'Card Payment' (the store is in the header)."""
	return (mode or "").split(" - ")[0]


def _n(k, word):
	return f"{k} {word}{'' if k == 1 else 's'}"


def _list_table(headers, rows, aligns):
	head = "".join(f'<td align="{a}" style="padding:8px 10px;background:{SOFT};border-bottom:1px solid {LINE};font-size:11px;font-weight:700;'
				   f'letter-spacing:.05em;text-transform:uppercase;color:{MUTED};{FONT}">{h}</td>' for h, a in zip(headers, aligns))
	body = "".join("<tr>" + "".join(f'<td align="{a}" style="padding:8px 10px;border-bottom:1px solid {LINE};font-size:13px;color:{INK};'
									f'background:{"#ffffff" if k % 2 == 0 else SOFT};{FONT}">{v}</td>' for v, a in zip(r, aligns)) + "</tr>"
				   for k, r in enumerate(rows))
	return _table(f"<tr>{head}</tr>{body}")


def closing_mail_html(d):
	"""The closing report mail, designed: header with net collected, status, how it was paid,
	cash drawer, card / UPI, shift details, taxes, top items, bills."""
	from erp_dacsinc_custom.pos_cash import cash_modes

	c = d.closing
	m = lambda v: fmt_money(v, currency=d.currency)
	esc = frappe.utils.escape_html
	st = cash_statement(d)
	cashier = frappe.utils.get_fullname(c.user)
	when = (f"{format_datetime(c.period_start_date, 'dd MMM yyyy, HH:mm')} → "
			f"{format_datetime(c.period_end_date, 'dd MMM yyyy, HH:mm')}")

	# how it was paid: cash received (net of change / refunds) and each other mode's sales
	paid = [("Cash", flt(st.sales - st.refunds - st.change, 2))] + [
		(_mode_label(r.mode_of_payment), flt(flt(r.expected_amount) - flt(r.opening_amount), 2)) for r in st.other]
	total = sum(v for _k, v in paid) or 1
	colors = ["#059669", "#4f46e5", "#0891b2", "#d97706", "#db2777"]
	tiles = "".join(f"""<td width="{int(100 / len(paid))}%" style="padding:4px;">
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid {LINE};border-radius:10px;border-collapse:separate;">
		<tr><td style="padding:12px 10px 4px;{FONT}"><div style="font-size:12px;font-weight:700;color:{colors[i % 5]};text-transform:uppercase;letter-spacing:.05em;">{esc(k)}</div>
			<div style="font-size:17px;font-weight:700;color:{INK};margin-top:4px;white-space:nowrap;">{m(v)}</div>
			<div style="font-size:12px;color:{MUTED};margin-top:2px;">{(max(v, 0) / total * 100):.0f}% of takings</div></td></tr>
		<tr><td style="padding:6px 10px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
			<td style="background:{colors[i % 5]};height:6px;border-radius:3px;font-size:0;line-height:0;" width="{max(int(max(v, 0) / total * 100), 1)}%">&nbsp;</td>
			<td style="background:{LINE};height:6px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr></table></td>"""
		for i, (k, v) in enumerate(paid))
	paid_html = f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;"><tr>{tiles}</tr></table>"""

	stats = [("Bills", f"{d.sales_count}"), ("Returns", f"{d.returns_count} · {m(d.returns_total)}"),
			 ("Items sold", f"{d.qty:g}"), ("Discounts", m(d.line_disc + d.bill_disc))]
	stats_html = "<tr>" + "".join(f"""<td width="25%" style="padding:12px 8px;text-align:center;border-right:{'1px solid ' + LINE if i < 3 else '0'};{FONT}">
		<div style="font-size:11px;color:{MUTED};text-transform:uppercase;letter-spacing:.05em;">{k}</div>
		<div style="font-size:16px;font-weight:700;color:{INK};margin-top:3px;">{v}</div></td>""" for i, (k, v) in enumerate(stats)) + "</tr>"
	stats_html = f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{SOFT};border:1px solid {LINE};
		border-radius:12px;margin:0 0 14px;border-collapse:separate;">{stats_html}</table>"""

	def facts(pairs):
		return "".join(f"""<tr><td style="padding:5px 0;font-size:12px;color:{MUTED};{FONT}">{esc(k)}</td>
			<td align="right" style="padding:5px 0;font-size:13px;color:{INK};font-weight:600;{FONT}">{esc(str(v))}</td></tr>""" for k, v in pairs)
	details = f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
		<td width="50%" valign="top" style="padding-right:12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">{facts([
			("Store", c.pos_profile), ("Cashier", cashier), ("Opening entry", c.pos_opening_entry or "—"),
			("Opened", format_datetime(d.opening.period_start_date, "dd-MM-yyyy HH:mm") if d.opening else "—"),
			("Closing entry", c.name), ("Closed", format_datetime(c.period_end_date, "dd-MM-yyyy HH:mm"))])}</table></td>
		<td width="50%" valign="top" style="padding-left:12px;border-left:1px solid {LINE};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">{facts([
			("Total sales", m(d.sales_total)), ("Net (before tax)", m(d.net)), ("Taxes", m(d.taxes)),
			("Item discounts", m(d.line_disc)), ("Bill discounts", m(d.bill_disc)), ("Grand total", m(c.grand_total))])}</table></td>
		</tr></table>"""

	parts = [_cash_html(d, m), _card("How it was paid", paid_html), stats_html, _card("Shift details", details)]
	taxes = [(esc(t.account_head), f"{flt(t.rate):g}%" if flt(t.rate) else "", m(t.amount)) for t in c.taxes if abs(flt(t.amount)) > 0.004]
	if taxes:
		parts.append(_card("Taxes", _list_table(("Tax", "Rate", "Amount"), taxes, ("left", "right", "right"))))
	if d.top:
		rank = lambda k: f'<span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:10px;background:{ACCENT};color:#fff;font-size:11px;font-weight:700;text-align:center;margin-right:8px;">{k}</span>'
		parts.append(_card("Top items", _list_table(("Item", "Qty", "Amount"),
			[(f"{rank(k + 1)}{esc(t['item_name'] or t['item_code'])}", f"{t['qty']:g}", m(t["amount"])) for k, t in enumerate(d.top)],
			("left", "right", "right"))))
	if d.invoices:
		bills = [(esc(i.name) + (f' <span style="color:{RED};font-weight:700;">RETURN</span>' if i.is_return else ""),
				  esc(str(i.posting_time or "")[:5]),
				  esc(" · ".join(x for x in (i.get("custom_walkin_name"), i.get("custom_walkin_mobile")) if x) or i.customer_name or ""),
				  f"{flt(i.total_qty):g}", m(i.grand_total)) for i in d.invoices[:60]]
		more = f"{len(d.invoices) - 60} more bills in the attached Excel." if len(d.invoices) > 60 else ""
		parts.append(_card(f"Bills ({len(d.invoices)})", _list_table(("Bill", "Time", "Customer", "Qty", "Amount"), bills,
							("left", "left", "left", "right", "right")), more))
	else:
		parts.append(_card("Bills", f'<div style="font-size:13px;color:{MUTED};">No bills in this shift.</div>'))

	button = f"""<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px auto 0;"><tr>
		<td style="background:{ACCENT};border-radius:8px;"><a href="{get_url_to_form('POS Closing Entry', c.name)}"
		style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;{FONT}">Open the closing entry &rarr;</a></td></tr></table>"""
	return f"""<div style="margin:0;padding:20px 6px;background:#eef2f7;{FONT}">
	<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;border-collapse:separate;">
	<tr><td style="background:{INK};background-image:linear-gradient(135deg,#0f172a 0%,#312e81 100%);border-radius:14px 14px 0 0;padding:22px 18px 20px;">
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
		<td valign="top" style="{FONT}">
			<div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#a5b4fc;">POS closing report</div>
			<div style="font-size:26px;font-weight:800;color:#ffffff;margin-top:6px;">{esc(c.pos_profile)}</div>
			<div style="font-size:13px;color:#cbd5e1;margin-top:6px;">{esc(when)}</div>
			<div style="font-size:13px;color:#cbd5e1;margin-top:2px;">Cashier: <b style="color:#ffffff;">{esc(cashier)}</b> · {esc(c.name)}</div>
		</td>
		<td valign="top" align="right" style="{FONT}">
			<div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#a5b4fc;">Net collected</div>
			<div style="font-size:24px;font-weight:800;color:#ffffff;margin-top:6px;">{m(d.grand)}</div>
			<div style="font-size:12px;color:#cbd5e1;margin-top:4px;">{_n(d.sales_count, "bill")}{f" · {_n(d.returns_count, 'return')}" if d.returns_count else ""}</div>
		</td></tr></table></td></tr>
	<tr><td style="background:#f8fafc;border:1px solid {LINE};border-top:0;border-radius:0 0 14px 14px;padding:16px 10px 22px;">
		{''.join(parts)}
		{button}
		<div style="text-align:center;font-size:12px;color:{MUTED};margin-top:16px;{FONT}">Full bill and item details are in the attached Excel.<br>
			Sent automatically by Dacsinc ERP when the shift was closed.</div>
	</td></tr></table></div>"""


def cash_statement(d):
	"""The shift's cash drawer, line by line (pos_cash.py), and card / UPI checks:
	opening (and where it came from) + cash sales − cash refunds − change given back =
	expected; counted; short / extra (why); taken out; left for the next shift."""
	from erp_dacsinc_custom.pos_cash import cash_modes

	c, opening = d.closing, d.opening
	rows = c.payment_reconciliation
	cash = cash_modes(r.mode_of_payment for r in rows)
	is_return = {i.name: i.is_return for i in d.invoices}
	cash_pays = [p for p in d.payments if p.mode_of_payment in cash]
	st = frappe._dict(
		opening=flt(sum(flt(r.opening_amount) for r in rows if r.mode_of_payment in cash), 2),
		sales=flt(sum(flt(p.amount) for p in cash_pays if not is_return.get(p.parent)), 2),
		refunds=flt(-sum(flt(p.amount) for p in cash_pays if is_return.get(p.parent)), 2),
		change=flt(sum(flt(i.get("change_amount")) for i in d.invoices), 2),
		expected=flt(sum(flt(r.expected_amount) for r in rows if r.mode_of_payment in cash), 2),
		counted=flt(sum(flt(r.closing_amount) for r in rows if r.mode_of_payment in cash), 2),
		taken_out=flt(c.get("custom_cash_handed_over"), 2),
		reason=c.get("custom_difference_reason") or "",
		prev=opening.get("custom_previous_closing") if opening else None,
		carried=flt(opening.get("custom_carried_forward"), 2) if opening else 0,
		opening_reason=(opening.get("custom_opening_change_reason") or "") if opening else "",
		other=[r for r in rows if r.mode_of_payment not in cash],
	)
	st.short_extra = flt(st.counted - st.expected, 2)
	st.left = flt(st.counted - st.taken_out, 2)
	st.opening_diff = flt(st.opening - st.carried, 2) if st.prev else 0
	st.other_off = [r for r in st.other if abs(flt(r.closing_amount) - flt(r.expected_amount)) > 0.004]
	return st


def _signed(v):
	return ("+ " if v > 0 else "− " if v < 0 else "") + f"{abs(v):,.2f}"


def cash_lines(d):
	"""[(label, amount text, note, alert)] for the Excel summary and the mail."""
	st = cash_statement(d)
	src = (f"left at {st.prev}: {st.carried:,.2f}" + (f" — differs by {_signed(st.opening_diff)}" if st.opening_diff else "")
		   if st.prev else "no earlier closing for this store")
	out = [("Opening cash", f"{st.opening:,.2f}", src, bool(st.opening_diff))]
	if st.opening_diff:
		out.append(("Why the opening differs", "", st.opening_reason or "—", True))
	out += [("+ Cash sales", f"{st.sales:,.2f}", "", False)]
	if st.refunds:
		out.append(("− Cash refunds (returns)", f"{st.refunds:,.2f}", "", False))
	out += [("− Change given back", f"{st.change:,.2f}", "", False),
			("= Cash expected in the drawer", f"{st.expected:,.2f}", "", False),
			("Cash counted", f"{st.counted:,.2f}", "", False),
			("Short (−) / extra (+)", _signed(st.short_extra) if st.short_extra else "0.00",
			 "matches" if not st.short_extra else (st.reason or "no reason given"), bool(st.short_extra)),
			("− Cash taken out at closing", f"{st.taken_out:,.2f}", "", False),
			("= Cash left in drawer for the next shift", f"{st.left:,.2f}", "", False)]
	for r in st.other:
		diff = flt(flt(r.closing_amount) - flt(r.expected_amount), 2)
		out.append((f"{r.mode_of_payment}", f"{flt(r.closing_amount):,.2f}",
					f"expected {flt(r.expected_amount):,.2f}" + (f", differs by {_signed(diff)} — {st.reason or 'no reason given'}" if diff else " — matches"),
					bool(diff)))
	return out


def closing_excel(d):
	"""Summary / Invoices / Items / Payments workbook, in memory (bytes)."""
	from openpyxl import Workbook
	from openpyxl.styles import Font, PatternFill

	c = d.closing
	wb = Workbook()
	bold, fill = Font(bold=True), PatternFill("solid", fgColor="E5E7EB")

	def sheet(ws, header, rows, widths):
		ws.append(header)
		for cell in ws[1]:
			cell.font, cell.fill = bold, fill
		for r in rows:
			ws.append(r)
		for i, w in enumerate(widths):
			ws.column_dimensions[chr(65 + i)].width = w
		ws.freeze_panes = "A2"

	ws = wb.active
	ws.title = "Summary"
	summary = [("Store", c.pos_profile), ("Cashier", frappe.utils.get_fullname(c.user)),
			   ("Closing entry", c.name), ("Opening entry", c.pos_opening_entry or ""),
			   ("Period from", str(c.period_start_date)), ("Period to", str(c.period_end_date)),
			   ("Invoices", d.sales_count), ("Returns", d.returns_count), ("Items sold (qty)", d.qty),
			   ("Total sales", d.sales_total), ("Returns amount", d.returns_total), ("Net total (before tax)", d.net),
			   ("Taxes", d.taxes), ("Item discounts", d.line_disc), ("Bill discounts", d.bill_disc),
			   ("Net collected", d.grand), ("Grand total (closing entry)", flt(c.grand_total))]
	summary += [("", "")] + [("Cash drawer", "")] + [(k, f"{v}  {n}".strip()) for k, v, n, _alert in cash_lines(d)]
	sheet(ws, ["Field", "Value"], summary, [28, 40])
	ws.append([])
	ws.append(["Mode of payment", "Opening", "Expected", "Closing", "Difference"])
	for cell in ws[ws.max_row]:
		cell.font, cell.fill = bold, fill
	for p in c.payment_reconciliation:
		ws.append([p.mode_of_payment, flt(p.opening_amount), flt(p.expected_amount), flt(p.closing_amount), flt(p.difference)])

	sheet(wb.create_sheet("Invoices"),
		  ["Invoice", "Date", "Time", "Customer", "Walk-in Name", "Walk-in Mobile", "Return", "Return Against",
		   "Qty", "Net Total", "Taxes", "Bill Discount", "Grand Total", "Created By"],
		  [[i.name, str(i.posting_date), str(i.posting_time or "")[:8], i.customer_name or i.customer,
			i.get("custom_walkin_name") or "", i.get("custom_walkin_mobile") or "", "Yes" if i.is_return else "",
			i.return_against or "", flt(i.total_qty), flt(i.net_total), flt(i.total_taxes_and_charges),
			flt(i.discount_amount), flt(i.grand_total), i.owner] for i in d.invoices],
		  [16, 12, 10, 24, 20, 16, 8, 16, 8, 12, 10, 12, 12, 26])
	sheet(wb.create_sheet("Items"),
		  ["Invoice", "Item Code", "Item Name", "Item Group", "Brand", "Qty", "UOM", "Price List Rate",
		   "Discount Amount", "Rate", "Amount", "Net Amount"],
		  [[i.parent, i.item_code, i.item_name, i.item_group, i.brand or "", flt(i.qty), i.uom,
			flt(i.price_list_rate), flt(i.discount_amount), flt(i.rate), flt(i.amount), flt(i.net_amount)]
		   for i in d.item_rows],
		  [16, 22, 30, 18, 14, 8, 8, 14, 14, 12, 12, 12])
	sheet(wb.create_sheet("Payments"), ["Invoice", "Mode of Payment", "Amount"],
		  [[p.parent, p.mode_of_payment, flt(p.amount)] for p in d.payments], [16, 26, 12])
	buf = io.BytesIO()
	wb.save(buf)
	return buf.getvalue()


# ------------------------------------------------------------------ email layout
TABLE = "width:100%;border-collapse:collapse;font-size:13px;margin:6px 0 4px;"
TH = "background:#f3f4f6;border-bottom:1px solid #e5e7eb;padding:7px 8px;font-weight:600;color:#374151;"
TD = "border-bottom:1px solid #f0f0f0;padding:7px 8px;color:#111827;vertical-align:top;"
H3 = "margin:22px 0 4px;font-size:15px;color:#111827;"


def _shell(title, subtitle, inner):
	return f"""<div style="font-family:Arial,Helvetica,sans-serif;background:#f6f7f9;padding:18px;">
	<div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
		<div style="background:#1f2937;color:#ffffff;padding:16px 20px;">
			<div style="font-size:18px;font-weight:700;">{title}</div>
			<div style="font-size:12px;opacity:.8;margin-top:3px;">{subtitle}</div>
		</div>
		<div style="padding:16px 20px 20px;">{inner}</div>
	</div></div>"""


def _facts(pairs):
	rows = "".join(f"""<tr><td style="padding:5px 8px;color:#6b7280;width:42%;">{frappe.utils.escape_html(str(k))}</td>
		<td style="padding:5px 8px;color:#111827;font-weight:600;">{frappe.utils.escape_html(str(v or '—'))}</td></tr>""" for k, v in pairs)
	return f'<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px;">{rows}</table>'


def _kpis(pairs):
	"""Summary tiles, three per row."""
	def tile(k, v):
		return f"""<td style="width:33%;padding:6px;"><div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;">
		<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.03em;">{frappe.utils.escape_html(k)}</div>
		<div style="font-size:17px;font-weight:700;color:#111827;margin-top:3px;">{frappe.utils.escape_html(v)}</div></div></td>"""
	items = list(pairs)
	rows = ["".join(tile(k, v) for k, v in items[i:i + 3]) for i in range(0, len(items), 3)]
	return '<table style="width:100%;border-collapse:collapse;">' + "".join(f"<tr>{r}</tr>" for r in rows) + "</table>"


def _button(url, label):
	return f"""<div style="margin-top:18px;"><a href="{url}" style="display:inline-block;background:#1f2937;color:#ffffff;
		text-decoration:none;padding:9px 16px;border-radius:6px;font-size:13px;font-weight:600;">{frappe.utils.escape_html(label)}</a></div>"""
