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
  POS Closing Report — Send To. It covers the opening entry, payments (opening /
  expected / closing / difference), invoices, returns, discounts, taxes and top
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
	"""POS Closing Entry on_submit."""
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
				  "rounded_total", "owner"]
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
		grand=sum(flt(i.grand_total) for i in invoices), mode_totals=mode_totals,
		top=sorted(top.values(), key=lambda x: -x["amount"])[:15],
		currency=frappe.db.get_value("Company", c.company, "default_currency") or "INR",
	)


def _mail_closing(name, recipients):
	d = closing_data(name)
	c, cur = d.closing, d.currency
	m = lambda v: fmt_money(v, currency=cur)
	esc = frappe.utils.escape_html
	opening_rows = {b.mode_of_payment: flt(b.opening_amount) for b in (d.opening.balance_details if d.opening else [])}
	pay_rows = "".join(f"""<tr><td style="{TD}">{esc(p.mode_of_payment)}</td>
		<td style="{TD}text-align:right;">{m(p.opening_amount)}</td><td style="{TD}text-align:right;">{m(d.mode_totals.get(p.mode_of_payment, 0))}</td>
		<td style="{TD}text-align:right;">{m(p.expected_amount)}</td><td style="{TD}text-align:right;">{m(p.closing_amount)}</td>
		<td style="{TD}text-align:right;color:{'#b91c1c' if abs(flt(p.difference)) > 0.009 else '#15803d'};font-weight:600;">{m(p.difference)}</td></tr>"""
		for p in c.payment_reconciliation)
	tax_rows = "".join(f"""<tr><td style="{TD}">{esc(t.account_head)}</td><td style="{TD}text-align:right;">{f"{flt(t.rate):g}%" if flt(t.rate) else ""}</td>
		<td style="{TD}text-align:right;">{m(t.amount)}</td></tr>""" for t in c.taxes if abs(flt(t.amount)) > 0.004)
	top_rows = "".join(f"""<tr><td style="{TD}">{esc(t['item_code'])}</td><td style="{TD}text-align:right;">{t['qty']:g}</td>
		<td style="{TD}text-align:right;">{m(t['amount'])}</td></tr>""" for t in d.top)
	inv_rows = "".join(f"""<tr><td style="{TD}">{esc(i.name)}{' <span style="color:#b91c1c;">(return)</span>' if i.is_return else ''}</td>
		<td style="{TD}">{esc(str(i.posting_time or '')[:5])}</td>
		<td style="{TD}">{esc(' · '.join(x for x in (i.get('custom_walkin_name'), i.get('custom_walkin_mobile')) if x) or i.customer_name or '')}</td>
		<td style="{TD}text-align:right;">{flt(i.total_qty):g}</td><td style="{TD}text-align:right;">{m(i.grand_total)}</td></tr>"""
		for i in d.invoices[:60])
	more = f'<p style="color:#6b7280;font-size:12px;">{len(d.invoices) - 60} more invoices in the attached Excel.</p>' if len(d.invoices) > 60 else ""

	kpis = _kpis([("Total sales", m(d.sales_total)), ("Returns", m(d.returns_total)), ("Net collected", m(d.grand)),
				  ("Invoices", f"{d.sales_count} + {d.returns_count} returns"), ("Items sold (qty)", f"{d.qty:g}"),
				  ("Discounts", m(d.line_disc + d.bill_disc))])
	body = _shell(
		f"POS Closing — {esc(c.pos_profile)}",
		f"{c.name} · {format_datetime(c.period_start_date, 'dd-MM-yyyy HH:mm')} → {format_datetime(c.period_end_date, 'dd-MM-yyyy HH:mm')}",
		kpis
		+ _facts([("Store", c.pos_profile), ("Cashier", frappe.utils.get_fullname(c.user)),
				  ("Opening entry", f"{c.pos_opening_entry or '—'}" + (f" · opened {format_datetime(d.opening.period_start_date, 'dd-MM-yyyy HH:mm')}" if d.opening else "")),
				  ("Closing entry", f"{c.name} · posted {formatdate(c.posting_date)} {str(c.posting_time or '')[:5]}"),
				  ("Net total (before tax)", m(d.net)), ("Taxes", m(d.taxes)), ("Item discounts", m(d.line_disc)),
				  ("Bill discounts", m(d.bill_disc)), ("Grand total (closing entry)", m(c.grand_total))])
		+ f"""<h3 style="{H3}">Payments</h3><table style="{TABLE}"><tr><th style="{TH}text-align:left;">Mode</th>
			<th style="{TH}text-align:right;">Opening</th><th style="{TH}text-align:right;">Sales</th><th style="{TH}text-align:right;">Expected</th>
			<th style="{TH}text-align:right;">Closing</th><th style="{TH}text-align:right;">Difference</th></tr>{pay_rows}</table>"""
		+ (f"""<h3 style="{H3}">Taxes</h3><table style="{TABLE}"><tr><th style="{TH}text-align:left;">Tax</th>
			<th style="{TH}text-align:right;">Rate</th><th style="{TH}text-align:right;">Amount</th></tr>{tax_rows}</table>""" if tax_rows else "")
		+ (f"""<h3 style="{H3}">Top items</h3><table style="{TABLE}"><tr><th style="{TH}text-align:left;">Item</th>
			<th style="{TH}text-align:right;">Qty</th><th style="{TH}text-align:right;">Amount</th></tr>{top_rows}</table>""" if top_rows else "")
		+ (f"""<h3 style="{H3}">Invoices</h3><table style="{TABLE}"><tr><th style="{TH}text-align:left;">Invoice</th>
			<th style="{TH}text-align:left;">Time</th><th style="{TH}text-align:left;">Customer</th><th style="{TH}text-align:right;">Qty</th>
			<th style="{TH}text-align:right;">Amount</th></tr>{inv_rows}</table>{more}""" if inv_rows else
		   f'<p style="color:#6b7280;">No invoices in this shift.</p>')
		+ '<p style="color:#6b7280;font-size:12px;margin-top:14px;">Full invoice and item details are in the attached Excel.</p>'
		+ _button(get_url_to_form("POS Closing Entry", c.name), "Open the POS Closing Entry"))
	fname = f"POS Closing {c.pos_profile} {formatdate(c.posting_date, 'dd-MM-yyyy')} {c.name}.xlsx".replace("/", "-")
	frappe.sendmail(
		recipients=recipients, subject=f"POS Closing — {c.pos_profile} — {formatdate(c.posting_date)} — {m(d.grand)}",
		message=body, reference_doctype="POS Closing Entry", reference_name=c.name,
		attachments=[{"fname": fname, "fcontent": closing_excel(d)}])  # content, not a File


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
