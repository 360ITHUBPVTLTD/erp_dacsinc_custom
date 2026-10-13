"""POS store Material Requests: HO approval, HO's transfer, the store verifies and submits it.

Only Material Requests raised by a POS Store Manager (pos_notify.mark_pos_request ticks
"Created by POS User"; a POS Store Manager, admins excluded) take this path. They get a
POS Request Status (custom_pos_request_status) when created; every other Material Request
(POS Admin's included) has none and is left exactly as it is. docs/pos-store-scope.md.

  Draft ── store: Send for HO Approval ──▶ Pending HO Approval ── mail to HO
  Pending ── HO: Reject (reason) ──▶ Rejected (store fixes it, sends again) ── mail to store
  Pending ── HO: Approve (may change qty) ──▶ the request is submitted: Approved ── mail to store
  Approved ── HO: Create Transfer (or ERPNext's Create › Material Transfer) ──▶ a DRAFT
             Stock Entry VV Puram → the store: In Transit ── mail to store
  In Transit ── the store's POS user checks what arrived and submits it ──▶ Received
             (Partly Received when more is still to be sent)

- HO = Admin Settings › POS › Approver Roles (admins always). Every action is checked here,
  not only by hiding buttons. A store can't submit its own request; while Pending it
  can't change it either.
- A transfer into a POS store (for a request, store to store, or HO without a request) is
  accepted — submitted — by a POS user of the store it goes to who didn't make it, or by POS
  Admin, who can do everything (guard_transfer_submit). HO and admins without POS Admin
  can't. The store may lower the qty to what really arrived; HO then sends the rest.
- VV Puram short? HO's "Purchase shortfall" opens a draft Purchase Order into VV Puram for
  the missing qty (Purchase Order › POS Request links it back). The stock is sent to the
  store once it has arrived.
- "Free at VV Puram" leaves out stock held for Sales Orders (stock_hold.py), the same rule
  the Stock Entry submit check applies.
- The status after approval follows the request's Stock Entries (draft saved / deleted,
  submit, cancel), so it is never set by hand.
"""

import frappe
from frappe import _
from frappe.utils import cint, escape_html, flt, formatdate, get_url_to_form, getdate, now_datetime, today

from erp_dacsinc_custom import pos_notify as N

STATUS_FIELD = "custom_pos_request_status"
DRAFT, PENDING, REJECTED = "Draft", "Pending HO Approval", "Rejected"
APPROVED, IN_TRANSIT, PARTLY, RECEIVED, CANCELLED = "Approved", "In Transit", "Partly Received", "Received", "Cancelled"
STATUSES = (DRAFT, PENDING, REJECTED, APPROVED, IN_TRANSIT, PARTLY, RECEIVED, CANCELLED)
DISPATCHABLE = (APPROVED, IN_TRANSIT, PARTLY)
DEFAULT_APPROVER_ROLES = ("POS Admin", "Production Manager", "Warehouse Incharge")
EPS = 0.0001


# ------------------------------------------------------------------ setup (after_migrate, idempotent)
def ensure_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	ro = {"read_only": 1, "no_copy": 1, "allow_on_submit": 1}
	create_custom_fields({
		"Material Request": [
			{"fieldname": STATUS_FIELD, "fieldtype": "Select", "label": "POS Request Status", "bold": 1,
			 "options": "\n" + "\n".join(STATUSES), "insert_after": "custom_is_pos_request", "in_standard_filter": 1,
			 "depends_on": f"eval:doc.{STATUS_FIELD}", **ro},
			{"fieldname": "custom_pos_approval_section", "fieldtype": "Section Break", "label": "HO Approval",
			 "collapsible": 1, "insert_after": "custom_stock_panel", "depends_on": f"eval:doc.{STATUS_FIELD}"},
			{"fieldname": "custom_pos_sent_on", "fieldtype": "Datetime", "label": "Sent for Approval On",
			 "insert_after": "custom_pos_approval_section", **ro},
			{"fieldname": "custom_pos_approved_by", "fieldtype": "Link", "options": "User", "label": "Approved By",
			 "insert_after": "custom_pos_sent_on", **ro},
			{"fieldname": "custom_pos_approved_on", "fieldtype": "Datetime", "label": "Approved On",
			 "insert_after": "custom_pos_approved_by", **ro},
			{"fieldname": "custom_pos_approval_colbreak", "fieldtype": "Column Break",
			 "insert_after": "custom_pos_approved_on"},
			{"fieldname": "custom_pos_rejected_by", "fieldtype": "Link", "options": "User", "label": "Rejected By",
			 "insert_after": "custom_pos_approval_colbreak", "depends_on": "eval:doc.custom_pos_rejected_by", **ro},
			{"fieldname": "custom_pos_rejection_reason", "fieldtype": "Small Text", "label": "Rejection Reason",
			 "insert_after": "custom_pos_rejected_by", "depends_on": "eval:doc.custom_pos_rejection_reason", **ro},
		],
		"Purchase Order": [
			{"fieldname": "custom_pos_material_request", "fieldtype": "Link", "options": "Material Request",
			 "label": "POS Request", "insert_after": "schedule_date", "read_only": 1, "no_copy": 1,
			 "depends_on": "eval:doc.custom_pos_material_request",
			 "description": "The POS store request this purchase (into VV Puram) covers."},
		],
	}, update=True)


def setup():
	"""after_migrate: fields and the workspace board block."""
	ensure_fields()
	ensure_board_block()


BOARD_BLOCK = "POS Requests Board"


def ensure_board_block():
	"""The Custom HTML Block on the POS / POS Admin / POS HO workspaces. It only mounts the
	board from public/js/pos_requests_board.js, which every desk page loads (hooks
	app_include_js, ?v= bumped on change), so the board's code is in Git."""
	values = {
		"html": '<div class="pos-req-board"><div class="text-muted small" style="padding:12px">Loading…</div></div>',
		"script": 'window.erp_pos_requests && erp_pos_requests.mount(root_element.querySelector(".pos-req-board"));',
		"style": ":host { display: block; }",
		"private": 0,
	}
	if frappe.db.exists("Custom HTML Block", BOARD_BLOCK):
		doc = frappe.get_doc("Custom HTML Block", BOARD_BLOCK)
		if any(doc.get(k) != v for k, v in values.items()):
			doc.update(values)
			doc.save(ignore_permissions=True)
	else:
		frappe.get_doc({"doctype": "Custom HTML Block", "name": BOARD_BLOCK, **values}).insert(ignore_permissions=True)


# ------------------------------------------------------------------ who
def approver_roles():
	return frappe.get_all("Order Flow Tab Role", filters={"parenttype": "Admin Settings", "parent": "Admin Settings",
														  "parentfield": "pos_request_approver_roles"}, pluck="role")


def is_approver(user=None):
	from erp_dacsinc_custom.order_flow_permissions import is_admin

	user = user or frappe.session.user
	return is_admin(user) or bool(set(frappe.get_roles(user)) & set(approver_roles()))


def _targets(doc):
	return {d.warehouse for d in doc.get("items") or [] if d.warehouse} or {doc.get("set_warehouse")} - {None, ""}


def is_store_user(warehouses, user=None):
	"""A POS user of the store(s) these warehouses belong to (POS Store Manager on that POS
	Profile). Not HO, POS Admin or an admin: receiving is the store's own check."""
	from erp_dacsinc_custom.pos_scope import get_scope, store_warehouses

	user = user or frappe.session.user
	warehouses = {w for w in warehouses if w}
	scope = get_scope(user, "Stock Entry")
	return bool(warehouses and scope and scope[0] == "stores" and warehouses <= set(store_warehouses(scope[1])))


def is_pos_admin(user=None):
	"""POS Admin can do everything in the POS flows: send, approve, transfer, accept — any store."""
	return "POS Admin" in frappe.get_roles(user or frappe.session.user)


def can_send(doc, user=None):
	"""Sending for approval is the store's step: its creator, or a manager of that store (or POS Admin)."""
	from erp_dacsinc_custom.pos_scope import get_scope, store_warehouses

	user = user or frappe.session.user
	if doc.owner == user or is_pos_admin(user):
		return True
	scope = get_scope(user, "Material Request")
	targets = _targets(doc)
	return bool(scope and scope[0] == "stores" and targets and targets <= set(store_warehouses(scope[1])))


def _require_approver():
	if not is_approver():
		frappe.throw(_("Only HO approves POS requests (Admin Settings › POS › Approver Roles: {0}).").format(
			", ".join(approver_roles()) or _("none set")), frappe.PermissionError, title=_("Not allowed"))


# ------------------------------------------------------------------ Material Request hooks
def mark_request(doc, method=None):
	"""before_insert (after pos_notify.mark_pos_request): a POS Store Manager's request starts as Draft."""
	doc.set(STATUS_FIELD, DRAFT if cint(doc.get("custom_is_pos_request")) and N._is_store_manager(doc.owner or None) else None)
	for f in ("custom_pos_sent_on", "custom_pos_approved_by", "custom_pos_approved_on", "custom_pos_rejected_by",
			  "custom_pos_rejection_reason"):
		doc.set(f, None)


def guard_edit(doc, method=None):
	"""validate: the status is only changed by this module; a store can't change a request HO is reviewing."""
	if doc.is_new() or doc.docstatus != 0 or doc.flags.pos_request_action:
		return
	saved = frappe.db.get_value("Material Request", doc.name, STATUS_FIELD)
	if (doc.get(STATUS_FIELD) or None) != (saved or None):
		doc.set(STATUS_FIELD, saved)
	if saved == PENDING and not is_approver():
		frappe.throw(_("This request is waiting for HO approval, so it can't be changed now. "
					   "If something must change, ask HO to reject it; then edit it and send it again."),
					 title=_("Waiting for HO approval"))


def guard_submit(doc, method=None):
	"""before_submit: submitting a POS request is HO's approval."""
	status = doc.get(STATUS_FIELD)
	if not status:
		return
	if status != PENDING:
		frappe.throw(_("Send this request for HO approval first. HO approves it, which submits it."),
					 title=_("HO approval needed"))
	_require_approver()
	doc.set(STATUS_FIELD, APPROVED)
	doc.custom_pos_approved_by = frappe.session.user
	doc.custom_pos_approved_on = now_datetime()


def on_submit(doc, method=None):
	if doc.get(STATUS_FIELD):
		_enqueue_store_mail(doc.name, "approved")


def on_cancel(doc, method=None):
	if doc.get(STATUS_FIELD):
		doc.db_set(STATUS_FIELD, CANCELLED)


# ------------------------------------------------------------------ actions
def _get(name):
	doc = frappe.get_doc("Material Request", name)
	if not doc.get(STATUS_FIELD):
		frappe.throw(_("{0} is not a POS store request.").format(name))
	return doc


@frappe.whitelist(methods=["POST"])
def send_for_approval(name):
	doc = _get(name)
	doc.check_permission("write")
	if not can_send(doc):
		frappe.throw(_("The store sends its own request for approval."), frappe.PermissionError, title=_("Not allowed"))
	if doc.docstatus != 0 or doc.get(STATUS_FIELD) not in (DRAFT, REJECTED):
		frappe.throw(_("Only a draft or rejected request can be sent for approval."))
	if not doc.get("items"):
		frappe.throw(_("Add the items first."))
	doc.set(STATUS_FIELD, PENDING)
	doc.custom_pos_sent_on = now_datetime()
	doc.flags.pos_request_action = True
	doc.save()
	recipients = N._recipients("pos_mr_email_recipients")
	if recipients:
		frappe.enqueue("erp_dacsinc_custom.pos_request._mail_ho", queue="short", enqueue_after_commit=True,
					   name=doc.name, recipients=recipients)
	return {"status": PENDING, "mailed": recipients}


@frappe.whitelist(methods=["POST"])
def approve(name, qtys=None):
	"""qtys: {Material Request Item name: qty} HO changed; 0 takes the item off."""
	_require_approver()
	doc = _get(name)
	if doc.docstatus != 0 or doc.get(STATUS_FIELD) != PENDING:
		frappe.throw(_("Only a request waiting for HO approval can be approved."))
	qtys = frappe.parse_json(qtys) or {}
	changes, keep = [], []
	for d in doc.items:
		if d.name in qtys and abs(flt(qtys[d.name]) - flt(d.qty)) > EPS:
			q = flt(qtys[d.name])
			if q < 0:
				frappe.throw(_("Quantity can't be negative ({0}).").format(d.item_code))
			changes.append(f"{d.item_code}: {flt(d.qty):g} → {q:g}")
			if q <= EPS:
				continue
			d.qty = q
			d.stock_qty = q * flt(d.conversion_factor or 1)
		keep.append(d)
	if not keep:
		frappe.throw(_("Every item was set to 0. Reject the request instead."))
	doc.set("items", keep)
	doc.flags.pos_request_action = True
	doc.flags.ignore_permissions = True  # HO may hold only View on Material Request; checked above
	doc.submit()
	if changes:
		doc.add_comment("Info", _("HO changed quantities on approval: {0}").format("; ".join(changes)))
	return {"status": doc.get(STATUS_FIELD)}


@frappe.whitelist(methods=["POST"])
def reject(name, reason):
	_require_approver()
	reason = (reason or "").strip()
	if not reason:
		frappe.throw(_("Give the reason, so the store knows what to change."))
	doc = _get(name)
	if doc.docstatus != 0 or doc.get(STATUS_FIELD) != PENDING:
		frappe.throw(_("Only a request waiting for HO approval can be rejected."))
	doc.set(STATUS_FIELD, REJECTED)
	doc.custom_pos_rejected_by = frappe.session.user
	doc.custom_pos_rejection_reason = reason
	doc.flags.pos_request_action = True
	doc.flags.ignore_permissions = True
	doc.save()
	doc.add_comment("Info", _("Rejected by HO: {0}").format(reason))
	_enqueue_store_mail(doc.name, "rejected")
	return {"status": REJECTED}


def _free_at(items, warehouse):
	"""{item: stock qty free} at warehouse: on hand, less stock held for Sales Orders (VV Puram,
	stock_hold.py), less what HO's draft transfers for POS requests already take from it
	(sent, not yet submitted by the store) — so the same stock isn't sent to two stores."""
	from erp_dacsinc_custom import stock_hold as SH

	items = sorted({i for i in items if i})
	if not items or not warehouse:
		return {}
	actual = {b.item_code: flt(b.actual_qty) for b in frappe.get_all(
		"Bin", filters={"item_code": ["in", items], "warehouse": warehouse}, fields=["item_code", "actual_qty"])}
	if warehouse == SH.HOLD_WAREHOUSE:
		holds = SH.holds_for(items)
		free = {i: max(0.0, actual.get(i, 0) - sum(got for _, got in SH.allocate(holds.get(i, []), actual.get(i, 0))))
				for i in items}
	else:
		free = {i: actual.get(i, 0) for i in items}
	for item, qty in _in_draft_transfers(items, warehouse).items():
		free[item] = max(0.0, free.get(item, 0) - qty)
	return free


def _in_draft_transfers(items, warehouse):
	"""{item: stock qty} in draft Stock Entries made against POS requests, out of warehouse."""
	return {item: flt(qty) for item, qty in frappe.db.sql(f"""
		select sed.item_code, sum(sed.transfer_qty)
		from `tabStock Entry Detail` sed
		join `tabStock Entry` se on se.name = sed.parent and se.docstatus = 0
		join `tabMaterial Request` mr on mr.name = sed.material_request and ifnull(mr.`{STATUS_FIELD}`, '') != ''
		where sed.s_warehouse = %(wh)s and sed.item_code in %(items)s
		group by sed.item_code""", {"wh": warehouse, "items": tuple(items)})}


def _source(doc):
	from erp_dacsinc_custom.pos_scope import pos_source_warehouse

	return doc.get("set_from_warehouse") or next((d.from_warehouse for d in doc.items if d.from_warehouse), None) \
		or pos_source_warehouse()


def _can_purchase():
	return is_approver() and frappe.has_permission("Purchase Order", "create")


@frappe.whitelist()
def get_request(name):
	"""Everything the review / transfer / receive dialogs show."""
	doc = _get(name)
	doc.check_permission("read")
	source = _source(doc)
	codes = [d.item_code for d in doc.items]
	free = _free_at(codes, source)
	at_store = {}
	targets = sorted(_targets(doc))
	for b in frappe.get_all("Bin", filters={"item_code": ["in", codes or [""]], "warehouse": ["in", targets or [""]]},
							fields=["item_code", "warehouse", "actual_qty"]):
		at_store[(b.item_code, b.warehouse)] = flt(b.actual_qty)
	received, pending = _moved_by_row(doc.name)
	rows = []
	for d in doc.items:
		cf = flt(d.conversion_factor or 1)
		got, coming = flt(received.get(d.name)) / cf, flt(pending.get(d.name)) / cf
		rows.append({
			"name": d.name, "item_code": d.item_code, "item_name": d.item_name, "uom": d.uom, "qty": flt(d.qty),
			"received": got, "in_transit": coming, "remaining": max(0.0, flt(d.qty) - got - coming),
			"free_at_source": flt(free.get(d.item_code)) / cf,
			"at_store": at_store.get((d.item_code, d.warehouse or doc.set_warehouse), 0) / cf,
		})
	status = doc.get(STATUS_FIELD)
	open_send = bool(doc.docstatus == 1 and status in DISPATCHABLE and any(r["remaining"] > EPS for r in rows))
	transfers = _transfers(doc.name)
	return {
		"name": doc.name, "status": status, "docstatus": doc.docstatus, "store": doc.set_warehouse or (targets[0] if targets else ""),
		"store_label": _store_labels().get(doc.set_warehouse or (targets[0] if targets else "")),
		"source": source, "owner": doc.owner, "owner_name": frappe.utils.get_fullname(doc.owner),
		"transaction_date": doc.transaction_date, "schedule_date": doc.schedule_date,
		"rejection_reason": doc.get("custom_pos_rejection_reason"), "rows": rows, "transfers": transfers,
		"purchase_orders": frappe.get_all("Purchase Order", filters={"custom_pos_material_request": doc.name, "docstatus": ["<", 2]},
										  fields=["name", "status", "docstatus"]),
		"can": {
			"send": doc.docstatus == 0 and status in (DRAFT, REJECTED) and can_send(doc)
			and frappe.has_permission("Material Request", "write", doc=doc),
			"review": doc.docstatus == 0 and status == PENDING and is_approver(),
			"dispatch": open_send and is_approver(),
			"purchase": open_send and _can_purchase(),
			"receive": bool(transfers) and (is_store_user(targets) or is_pos_admin()),
		},
	}


@frappe.whitelist(methods=["POST"])
def dispatch(name, qtys=None):
	"""HO's transfer for this request: a DRAFT Stock Entry VV Puram → the store. The store's
	POS user submits it once the stock has arrived (guard_transfer_submit).
	qtys: {Material Request Item name: qty to send}; default what is left, up to what is free."""
	from erpnext.stock.doctype.material_request.material_request import make_stock_entry

	_require_approver()
	doc = _get(name)
	if doc.docstatus != 1 or doc.get(STATUS_FIELD) not in DISPATCHABLE:
		frappe.throw(_("Only an approved request can be sent."))
	qtys = frappe.parse_json(qtys) or {}
	received, pending = _moved_by_row(doc.name)
	left = {d.name: max(0.0, flt(d.stock_qty) - flt(received.get(d.name)) - flt(pending.get(d.name))) for d in doc.items}
	se = make_stock_entry(doc.name)
	free = _free_at([d.item_code for d in se.items], _source(doc))
	keep = []
	for d in se.items:
		cf = flt(d.conversion_factor or 1)
		most = left.get(d.material_request_item, 0) / cf
		q = flt(qtys[d.material_request_item]) if d.material_request_item in qtys else most
		q = min(q, most)
		if q <= EPS:
			continue
		if q * cf > flt(free.get(d.item_code)) + EPS:
			frappe.throw(_("{0}: only {1} free at {2} (stock held for Sales Orders, and stock already in transfers the stores "
						   "haven't submitted yet, don't count). "
						   "Send less, or buy the rest first (Purchase shortfall).").format(
				frappe.bold(d.item_code), f"{flt(free.get(d.item_code)):g}", d.s_warehouse), title=_("Not enough stock"))
		free[d.item_code] = flt(free.get(d.item_code)) - q * cf
		d.qty = q
		keep.append(d)
	if not keep:
		frappe.throw(_("Nothing left to send: everything is received or already on its way."))
	se.set("items", keep)
	se.remarks = _("POS request {0} → {1}. The store checks what arrived and submits it.").format(doc.name, doc.set_warehouse or "")
	se.insert()
	return {"stock_entry": se.name}


def _transfers(mr_name):
	"""Draft Stock Entries made against this request: on their way, waiting for the store."""
	return [r[0] for r in frappe.db.sql("""
		select distinct se.name from `tabStock Entry` se join `tabStock Entry Detail` sed on sed.parent = se.name
		where sed.material_request = %s and se.docstatus = 0 order by se.name""", mr_name)]


@frappe.whitelist()
def purchase_shortfall(name):
	"""What VV Puram is short for this request (left to send − free there), for a new
	Purchase Order into VV Puram that the form opens."""
	if not _can_purchase():
		frappe.throw(_("You can't create Purchase Orders."), frappe.PermissionError)
	doc = _get(name)
	data = get_request(name)
	items = []
	for r in data["rows"]:
		short = r["remaining"] - r["free_at_source"]
		if short > EPS:
			items.append({"item_code": r["item_code"], "qty": flt(short, 3), "uom": r["uom"]})
	if not items:
		frappe.throw(_("{0} has enough free stock for this request. Send it instead.").format(data["source"]))
	return {"company": doc.company, "warehouse": data["source"], "material_request": doc.name, "items": items,
			"schedule_date": str(max(getdate(doc.schedule_date or today()), getdate(today())))}


# ------------------------------------------------------------------ status from the Stock Entries
def _moved_by_row(mr_name, exclude=None):
	"""({row: stock qty received}, {row: stock qty on its way}) — submitted / draft Stock
	Entries made against this request. exclude: a Stock Entry being deleted."""
	received, pending = {}, {}
	for row, docstatus, qty in frappe.db.sql("""
		select sed.material_request_item, se.docstatus, sum(sed.transfer_qty)
		from `tabStock Entry Detail` sed join `tabStock Entry` se on se.name = sed.parent
		where sed.material_request = %(mr)s and se.docstatus < 2 and se.name != %(ex)s
		group by sed.material_request_item, se.docstatus""", {"mr": mr_name, "ex": exclude or ""}):
		target = received if docstatus == 1 else pending
		target[row] = target.get(row, 0) + flt(qty)
	return received, pending


def compute_status(mr_name, exclude=None):
	requested = sum(flt(q) for q in frappe.get_all("Material Request Item", filters={"parent": mr_name}, pluck="stock_qty"))
	received, pending = _moved_by_row(mr_name, exclude)
	got, coming = sum(received.values()), sum(pending.values())
	if requested > EPS and got >= requested - EPS:
		return RECEIVED
	if coming > EPS:
		return IN_TRANSIT
	if got > EPS:
		return PARTLY
	return APPROVED


def _requests_of(se):
	names = {d.material_request for d in se.items if d.get("material_request")}
	if not names:
		return []
	return frappe.get_all("Material Request", filters={"name": ["in", list(names)], "docstatus": 1,
													   STATUS_FIELD: ["in", list(DISPATCHABLE) + [RECEIVED]]}, pluck="name")


def update_from_stock_entry(doc, method=None):
	"""Stock Entry on_update (draft saved) / on_submit / on_cancel / on_trash: the requests
	it moves stock for follow it."""
	exclude = doc.name if method == "on_trash" else None
	for name in _requests_of(doc):
		status = compute_status(name, exclude)
		if frappe.db.get_value("Material Request", name, STATUS_FIELD) != status:
			frappe.db.set_value("Material Request", name, STATUS_FIELD, status)


def mail_store_on_transfer(doc, method=None):
	"""Stock Entry after_insert: stock is on its way to a store — tell the store. For a POS
	request its creator (with the request); otherwise the receiving store's POS users."""
	names = _requests_of(doc)
	for name in names:
		_enqueue_store_mail(name, "dispatched", stock_entry=doc.name)
	if not names and doc.docstatus == 0 and store_targets(doc):
		frappe.enqueue("erp_dacsinc_custom.pos_request._mail_incoming", queue="short", enqueue_after_commit=True,
					   stock_entry=doc.name)


# ------------------------------------------------------------------ every transfer into a POS store
# Any Material Transfer whose target is a POS store's warehouse — a store-to-store transfer,
# HO's transfer for a POS request, or HO sending stock to a store without one — stays a
# draft (In Transit) until the RECEIVING store accepts it: a POS Store Manager of that store,
# who is not the one who made it, checks what arrived and submits it — or POS Admin, who can
# do everything. Nobody else submits it (not the sender, HO or an admin without POS Admin).
# One transfer goes to one store.
def store_targets(doc):
	from erp_dacsinc_custom.pos_scope import all_store_warehouses

	if (doc.get("purpose") or doc.get("stock_entry_type")) != "Material Transfer":
		return set()
	stores = set(all_store_warehouses())
	return {d.t_warehouse for d in doc.get("items") or [] if d.t_warehouse in stores}


def can_accept(doc, user=None):
	"""The receiving store's POS user (not the sender), or POS Admin (any transfer)."""
	user = user or frappe.session.user
	targets = store_targets(doc)
	return bool(targets) and (is_pos_admin(user) or (doc.owner != user and is_store_user(targets, user)))


def _pos_requests_of(doc):
	return sorted(n for n in {d.material_request for d in doc.items if d.get("material_request")}
				  if frappe.db.get_value("Material Request", n, STATUS_FIELD))


def _labels(warehouses):
	labels = _store_labels()
	return ", ".join(sorted(labels.get(w, w) for w in warehouses if w))


@frappe.whitelist()
def get_transfer_state(name):
	"""For the Stock Entry form: a transfer into a POS store — who accepts it, and may this user?"""
	doc = frappe.get_doc("Stock Entry", name)
	doc.check_permission("read")
	targets = store_targets(doc)
	if not targets:
		return {}
	return {"requests": _pos_requests_of(doc), "store": _labels(targets),
			"source": _labels({d.s_warehouse for d in doc.items}), "can_submit": can_accept(doc),
			"is_sender": doc.owner == frappe.session.user}


def guard_transfer_submit(doc, method=None):
	"""Stock Entry before_submit: only the receiving store accepts a transfer into a POS store
	(see above); one made against a POS request never sends more than the request still needs."""
	targets = store_targets(doc)
	if not targets:
		return
	if len(targets) > 1:
		frappe.throw(_("This transfer goes to several stores ({0}). Make one transfer per store, so each store "
					   "accepts its own.").format(_labels(targets)), title=_("One store per transfer"))
	if not can_accept(doc):
		store = frappe.bold(_labels(targets))
		if doc.owner == frappe.session.user:
			msg = _("You made this transfer, so {0} accepts it: a POS user there checks what arrived and "
					"submits it. Until then it stays In Transit.").format(store)
		else:
			msg = _("Only a POS user of {0} accepts this transfer, after checking what arrived. "
					"Until then it stays In Transit.").format(store)
		frappe.throw(msg, title=_("The receiving store accepts it"))
	for name in _pos_requests_of(doc):
		received, _pending = _moved_by_row(name, exclude=doc.name)
		need = {r.name: flt(r.stock_qty) for r in frappe.get_all("Material Request Item", filters={"parent": name},
																   fields=["name", "stock_qty"])}
		this = {}
		for d in doc.items:
			if d.get("material_request") == name and d.material_request_item:
				this[d.material_request_item] = this.get(d.material_request_item, 0) + flt(d.transfer_qty or d.qty)
		for row, qty in this.items():
			if flt(received.get(row)) + qty > need.get(row, 0) + EPS:
				frappe.throw(_("This sends more than request {0} still needs ({1} left).").format(
					name, f"{max(0, need.get(row, 0) - flt(received.get(row))):g}"), title=_("Too much"))


def _store_users(warehouses, exclude=None):
	"""Enabled POS Store Managers (not admins / POS Admin) of the stores these warehouses belong to."""
	from erp_dacsinc_custom.pos_scope import store_manager_warehouses

	profiles = frappe.get_all("POS Profile", filters={"warehouse": ["in", list(warehouses) or [""]]}, pluck="name")
	users = set(frappe.get_all("POS Profile User", filters={"parent": ["in", profiles or [""]]}, pluck="user"))
	out = []
	for u in sorted(users - {exclude}):
		email = frappe.db.get_value("User", {"name": u, "enabled": 1}, "email")
		if email and store_manager_warehouses(u) is not None:
			out.append(email)
	return out


def _mail_incoming(stock_entry):
	doc = frappe.get_doc("Stock Entry", stock_entry)
	targets = store_targets(doc)
	to = _store_users(targets, exclude=doc.owner)
	if not to or doc.docstatus != 0:
		return
	source = _labels({d.s_warehouse for d in doc.items})
	inner = (f'<p style="font-size:14px;color:#111827;">{escape_html(frappe.utils.get_fullname(doc.owner))} sent stock '
			 f'from {escape_html(source)}. When it arrives, open the transfer, check the qty that really came '
			 f'(lower it if less arrived) and Submit to accept it.</p>'
			 + _dispatched_table(doc.name) + N._button(get_url_to_form("Stock Entry", doc.name), "Open the transfer"))
	frappe.sendmail(recipients=to, subject=f"Stock on its way to {_labels(targets)}: {doc.name} from {source}",
					message=N._shell(f"Incoming transfer {doc.name}", f"from {escape_html(source)}", inner),
					reference_doctype="Stock Entry", reference_name=doc.name)


# ------------------------------------------------------------------ Warehouse Incharge & co: POS requests only
def _pos_only_reader(user):
	"""True for a user who reads Material Requests only through a View-only approver role
	(e.g. Warehouse Incharge): they see POS store requests, nothing else."""
	from erp_dacsinc_custom.order_flow_permissions import is_admin

	if not hasattr(frappe.local, "pos_request_reader"):
		frappe.local.pos_request_reader = {}
	cache = frappe.local.pos_request_reader
	if user in cache:
		return cache[user]
	result = False
	if user not in ("Administrator", "Guest") and not is_admin(user):
		roles = set(frappe.get_roles(user))
		perms = frappe.get_all("Custom DocPerm", filters={"parent": "Material Request", "permlevel": 0, "role": ["in", list(roles)]},
							   fields=["role", "read", "write", "create", "submit"])
		readers = [p for p in perms if p.read]
		result = bool(readers) and not any(p.write or p.create or p.submit for p in perms) \
			and bool({p.role for p in readers} & set(approver_roles()))
	cache[user] = result
	return result


def material_request_query(user=None):
	user = user or frappe.session.user
	if _pos_only_reader(user):
		return f"ifnull(`tabMaterial Request`.`{STATUS_FIELD}`, '') != ''"
	return ""


def has_material_request_permission(doc, ptype=None, user=None, debug=False):
	user = user or frappe.session.user
	if _pos_only_reader(user) and not doc.is_new():
		return bool(doc.get(STATUS_FIELD))
	return None


# ------------------------------------------------------------------ board (workspace block)
LATE_DAYS = 2  # a transfer waiting longer for the store is shown in orange on the board

TABS = {
	"pending": {"label": "Pending Approval", "filters": [[STATUS_FIELD, "=", PENDING]], "order": "custom_pos_sent_on asc"},
	"draft": {"label": "Draft & Rejected", "filters": [[STATUS_FIELD, "in", [DRAFT, REJECTED]], ["docstatus", "=", 0]],
			  "order": "modified desc"},
	"dispatch": {"label": "To Send", "filters": [[STATUS_FIELD, "in", [APPROVED, PARTLY]], ["docstatus", "=", 1]],
				 "order": "custom_pos_approved_on asc"},
	"transit": {"label": "In Transit", "filters": [[STATUS_FIELD, "=", IN_TRANSIT]], "order": "modified asc"},
	"received": {"label": "Received", "filters": [[STATUS_FIELD, "=", RECEIVED]], "order": "modified desc"},  # + RECEIVED_DAYS
}


RECEIVED_DAYS = 30  # the Received card shows the last 30 days (requests and accepted transfers)


def _store_transfers(store=None, received=False):
	"""Transfers into a POS store not made for a POS request (store to store, or HO sending stock
	without one). Drafts waiting for the receiving store to accept; or, received=True, the ones
	accepted in the last RECEIVED_DAYS. Through the user's own Stock Entry permissions, so a
	store sees what comes to it and what it sent."""
	user = frappe.session.user
	filters = {"docstatus": 1 if received else 0, "purpose": "Material Transfer"}
	if received:
		filters["modified"] = [">=", frappe.utils.add_days(now_datetime(), -RECEIVED_DAYS)]
	heads = frappe.get_list("Stock Entry", filters=filters, fields=["name", "owner", "creation", "modified", "modified_by"],
							order_by="modified desc" if received else "creation asc", limit_page_length=500)
	if not heads:
		return []
	lines = {}
	for r in frappe.get_all("Stock Entry Detail", filters={"parent": ["in", [h.name for h in heads]]},
							fields=["parent", "item_code", "qty", "uom", "s_warehouse", "t_warehouse", "material_request"],
							order_by="idx asc"):
		lines.setdefault(r.parent, []).append(r)
	from erp_dacsinc_custom.pos_scope import all_store_warehouses

	stores, labels, out = set(all_store_warehouses()), _store_labels(), []
	for h in heads:
		its = lines.get(h.name, [])
		targets = {r.t_warehouse for r in its if r.t_warehouse in stores}
		sources = {r.s_warehouse for r in its if r.s_warehouse}
		if not targets or any(r.material_request for r in its):
			continue
		if store and store not in targets | sources:
			continue
		doc_like = frappe._dict(purpose="Material Transfer", owner=h.owner, items=its)
		incoming = is_store_user(targets)
		out.append({
			"kind": "transfer", "name": h.name, "status": "Received" if received else "In Transit", "owner": h.owner,
			"accepted_by": frappe.utils.get_fullname(h.modified_by) if received else None,
			"accepted_on": h.modified if received else None,
			"owner_name": frappe.utils.get_fullname(h.owner), "sent_on": h.creation,
			"waiting_days": (now_datetime() - h.creation).days,
			"from": ", ".join(sorted(labels.get(w, w) for w in sources)), "to": ", ".join(sorted(labels.get(w, w) for w in targets)),
			"direction": "incoming" if incoming and h.owner != user else ("outgoing" if h.owner == user or is_store_user(sources) else ""),
			"items": [{"item_code": r.item_code, "qty": flt(r.qty), "uom": r.uom} for r in its],
			"total_qty": sum(flt(r.qty) for r in its),
			"can": {"accept": not received and can_accept(doc_like)},
		})
	return out


def _store_labels():
	return {p.warehouse: (p.custom_store_name or p.name) for p in frappe.get_all(
		"POS Profile", filters={"disabled": 0}, fields=["name", "warehouse", "custom_store_name"]) if p.warehouse}


@frappe.whitelist()
def get_board(tab=None, store=None, limit=50):
	"""Counts per tab and the rows of one tab, through the user's own list permissions
	(a store sees its store, POS Admin / HO every store)."""
	from erp_dacsinc_custom.pos_scope import get_scope

	approver = is_approver()
	scope = get_scope(None, "Material Request")
	is_store = bool(scope and scope[0] == "stores")
	base = [[STATUS_FIELD, "is", "set"]]
	if store:
		base.append(["set_warehouse", "=", store])
	counts = {k: frappe.get_list("Material Request", filters=base + t["filters"], fields=["count(name) as n"])[0].n
			  for k, t in TABS.items()}
	store_transfers = _store_transfers(store)
	counts["transfers"] = len(store_transfers)
	received_transfers = _store_transfers(store, received=True)
	recent = [["modified", ">=", frappe.utils.add_days(now_datetime(), -RECEIVED_DAYS)]]
	counts["received"] = frappe.get_list("Material Request", filters=base + TABS["received"]["filters"] + recent,
										 fields=["count(name) as n"])[0].n + len(received_transfers)
	if tab not in TABS and tab != "transfers":
		order = ("pending", "dispatch", "transit", "transfers", "draft", "received") if approver and not is_store else \
			("transit", "transfers", "draft", "pending", "dispatch", "received")
		tab = next((k for k in order if counts.get(k)), order[0])
	t = TABS.get(tab) or {"filters": [["name", "=", ""]], "order": "modified desc"}
	docs = [] if tab == "transfers" else frappe.get_list("Material Request", order_by=t["order"],
						   filters=base + t["filters"] + (recent if tab == "received" else []),
						   limit_page_length=min(cint(limit) or 50, 200),
						   fields=["name", "set_warehouse", "set_from_warehouse", "owner", "transaction_date", "schedule_date",
								   STATUS_FIELD + " as status", "custom_pos_sent_on", "custom_pos_approved_by",
								   "custom_pos_approved_on", "custom_pos_rejection_reason", "per_ordered", "docstatus",
								   "modified", "creation"])
	names = [d.name for d in docs]
	items = {}
	if names:
		for r in frappe.get_all("Material Request Item", filters={"parent": ["in", names]},
								fields=["parent", "item_code", "item_name", "qty", "uom", "ordered_qty", "conversion_factor"],
								order_by="idx asc"):
			items.setdefault(r.parent, []).append(r)
	pos = {}
	if names:
		for p in frappe.get_all("Purchase Order", filters={"custom_pos_material_request": ["in", names], "docstatus": ["<", 2]},
								fields=["name", "status", "custom_pos_material_request"]):
			pos.setdefault(p.custom_pos_material_request, []).append({"name": p.name, "status": p.status})
	transfers, sent_on = {}, {}
	if names:
		for mr_name, se_name, created in frappe.db.sql("""select distinct sed.material_request, se.name, se.creation
			from `tabStock Entry Detail` sed join `tabStock Entry` se on se.name = sed.parent
			where sed.material_request in %(n)s and se.docstatus = 0 order by se.creation""", {"n": tuple(names)}):
			transfers.setdefault(mr_name, []).append(se_name)
			sent_on.setdefault(mr_name, created)  # the oldest one still waiting
	labels = _store_labels()
	can_purchase = _can_purchase()
	rows = []
	for d in docs:
		its = items.get(d.name, [])
		doc_like = frappe._dict(items=[frappe._dict(warehouse=None)], set_warehouse=d.set_warehouse, owner=d.owner)
		rows.append({
			**d, "store": labels.get(d.set_warehouse, d.set_warehouse), "owner_name": frappe.utils.get_fullname(d.owner),
			"items": [{"item_code": i.item_code, "item_name": i.item_name, "qty": flt(i.qty), "uom": i.uom,
					   "dispatched": flt(i.ordered_qty) / flt(i.conversion_factor or 1)} for i in its],
			"total_qty": sum(flt(i.qty) for i in its), "purchase_orders": pos.get(d.name, []),
			"transfers": transfers.get(d.name, []),
			"sent_on": sent_on.get(d.name),
			"waiting_days": (now_datetime() - sent_on[d.name]).days if d.name in sent_on else None,
			"can": {
				"send": d.docstatus == 0 and d.status in (DRAFT, REJECTED) and can_send(doc_like)
				and frappe.has_permission("Material Request", "write", doc=d.name),
				"review": d.docstatus == 0 and d.status == PENDING and approver,
				"dispatch": d.docstatus == 1 and d.status in (APPROVED, PARTLY) and approver,
				"purchase": d.docstatus == 1 and d.status in (APPROVED, PARTLY) and can_purchase,
				"receive": d.status == IN_TRANSIT and (is_store_user(_targets(doc_like)) or is_pos_admin()),
			},
		})
	stores = []
	if not is_store:
		stores = [{"value": w, "label": l} for w, l in sorted(labels.items(), key=lambda x: x[1])]
	late = 0
	if counts.get("transit"):
		late = frappe.db.sql(f"""select count(distinct mr.name) from `tabMaterial Request` mr
			join `tabStock Entry Detail` sed on sed.material_request = mr.name
			join `tabStock Entry` se on se.name = sed.parent and se.docstatus = 0
			where mr.`{STATUS_FIELD}` = %(st)s and se.creation < %(cut)s and mr.name in %(seen)s""",
			{"st": IN_TRANSIT, "cut": frappe.utils.add_days(now_datetime(), -LATE_DAYS),
			 "seen": tuple(frappe.get_list("Material Request", filters=base + TABS["transit"]["filters"], pluck="name",
										   limit_page_length=0)) or ("",)})[0][0]
	if tab == "transfers":
		rows = store_transfers[:min(cint(limit) or 50, 200)]
	elif tab == "received":
		# received requests and accepted store transfers together, newest first
		rows = sorted(rows + received_transfers, key=lambda r: str(r.get("accepted_on") or r.get("modified") or ""),
					  reverse=True)[:min(cint(limit) or 50, 200)]
	tabs = [{"key": k, "label": v["label"], "count": counts[k]} for k, v in TABS.items()]
	tabs.insert(4, {"key": "transfers", "label": "Store Transfers", "count": counts["transfers"]})
	return {"tab": tab, "tabs": tabs,
			"late": late, "late_days": LATE_DAYS,
			"late_transfers": sum(1 for r in store_transfers if r["waiting_days"] >= LATE_DAYS),
			"rows": rows, "stores": stores, "is_approver": approver, "is_store": is_store,
			"can_create": frappe.has_permission("Material Request", "create") and is_store,
			"can_transfer": frappe.has_permission("Stock Entry", "create") and is_store}


# ------------------------------------------------------------------ mails
def _items_table(doc, stock=True):
	source = _source(doc)
	free = _free_at([d.item_code for d in doc.items], source) if stock else {}
	at_store = {}
	if stock:
		for b in frappe.get_all("Bin", filters={"item_code": ["in", [d.item_code for d in doc.items] or [""]],
												"warehouse": doc.set_warehouse or ""}, fields=["item_code", "actual_qty"]):
			at_store[b.item_code] = flt(b.actual_qty)
	head = f'<th style="{N.TH}text-align:left;">Item</th><th style="{N.TH}text-align:right;">Qty</th>'
	if stock:
		head += (f'<th style="{N.TH}text-align:right;">Free at {escape_html(source or "")}</th>'
				 f'<th style="{N.TH}text-align:right;">At store</th>')
	body = ""
	for d in doc.items:
		body += f"""<tr><td style="{N.TD}">{escape_html(d.item_code)}<div style="color:#6b7280;font-size:12px;">{escape_html(d.item_name or "")}</div></td>
			<td style="{N.TD}text-align:right;"><b>{flt(d.qty):g}</b> {escape_html(d.uom or "")}</td>"""
		if stock:
			body += (f'<td style="{N.TD}text-align:right;">{flt(free.get(d.item_code)):g}</td>'
					 f'<td style="{N.TD}text-align:right;">{flt(at_store.get(d.item_code)):g}</td>')
		body += "</tr>"
	return f'<h3 style="{N.H3}">Items</h3><table style="{N.TABLE}"><tr>{head}</tr>{body}</table>'


def _facts(doc):
	return N._facts([("Store", _store_labels().get(doc.set_warehouse, doc.set_warehouse)), ("From", _source(doc)),
					 ("Required by", formatdate(doc.schedule_date)), ("Raised by", frappe.utils.get_fullname(doc.owner)),
					 ("Items / total qty", f"{len(doc.items)} / {sum(flt(d.qty) for d in doc.items):g}")])


def _mail_ho(name, recipients):
	doc = frappe.get_doc("Material Request", name)
	store = _store_labels().get(doc.set_warehouse, doc.set_warehouse)
	body = N._shell(f"Approval needed: stock request from {escape_html(store or '')}",
					f"{doc.name} · sent {frappe.utils.format_datetime(doc.custom_pos_sent_on)}",
					_facts(doc) + _items_table(doc) + N._button(get_url_to_form("Material Request", doc.name), "Review the request"))
	frappe.sendmail(recipients=recipients, subject=f"Approval needed: POS request {doc.name} — {store}", message=body,
					reference_doctype="Material Request", reference_name=doc.name)


def _enqueue_store_mail(name, kind, stock_entry=None):
	frappe.enqueue("erp_dacsinc_custom.pos_request._mail_store", queue="short", enqueue_after_commit=True,
				   name=name, kind=kind, stock_entry=stock_entry)


def _mail_store(name, kind, stock_entry=None):
	doc = frappe.get_doc("Material Request", name)
	to = frappe.db.get_value("User", {"name": doc.owner, "enabled": 1}, "email")
	if not to:
		return
	who = frappe.utils.get_fullname
	if kind == "approved":
		title, note = "Approved by HO", f"Approved by {who(doc.custom_pos_approved_by)}. HO will send the stock."
	elif kind == "rejected":
		title, note = "Rejected by HO", f"Rejected by {who(doc.custom_pos_rejected_by)}: {doc.custom_pos_rejection_reason}"
	else:
		title, note = "Stock is on its way", (f"HO has sent it: Stock Entry {stock_entry}. When it arrives, open that "
											  "Stock Entry, check the qty that really came (lower it if less arrived) and Submit.")
	inner = (f'<p style="font-size:14px;color:#111827;">{escape_html(note)}</p>' + _facts(doc)
			 + (_items_table(doc, stock=False) if kind != "dispatched" else _dispatched_table(stock_entry))
			 + N._button(get_url_to_form("Material Request", doc.name), "Open the request"))
	frappe.sendmail(recipients=[to], subject=f"{title}: your request {doc.name}",
					message=N._shell(f"{title}: {doc.name}", formatdate(today()), inner),
					reference_doctype="Material Request", reference_name=doc.name)


def _dispatched_table(stock_entry):
	rows = frappe.get_all("Stock Entry Detail", filters={"parent": stock_entry},
						  fields=["item_code", "item_name", "qty", "uom"], order_by="idx asc") if stock_entry else []
	body = "".join(f"""<tr><td style="{N.TD}">{escape_html(r.item_code)}<div style="color:#6b7280;font-size:12px;">{escape_html(r.item_name or "")}</div></td>
		<td style="{N.TD}text-align:right;"><b>{flt(r.qty):g}</b> {escape_html(r.uom or "")}</td></tr>""" for r in rows)
	return (f'<h3 style="{N.H3}">Sent</h3><table style="{N.TABLE}"><tr><th style="{N.TH}text-align:left;">Item</th>'
			f'<th style="{N.TH}text-align:right;">Qty</th></tr>{body}</table>')


# ------------------------------------------------------------------ one-time (patch)
def backfill():
	"""Default approver roles when none are set, and Draft on the POS Store Manager requests
	still in draft. Requests already submitted before this flow existed keep no status:
	they were handled the old way, so they stay out of HO's To Dispatch."""
	if not approver_roles():
		settings = frappe.get_single("Admin Settings")
		for role in DEFAULT_APPROVER_ROLES:
			if frappe.db.exists("Role", role):
				settings.append("pos_request_approver_roles", {"role": role})
		settings.flags.ignore_permissions = True
		settings.save()
	out = {"draft": 0, "submitted_left_alone": 0}
	for mr in frappe.get_all("Material Request", filters={"custom_is_pos_request": 1, STATUS_FIELD: ["in", ["", None]],
														  "docstatus": ["<", 2]}, fields=["name", "owner", "docstatus"]):
		if not N._is_store_manager(mr.owner):
			continue
		if mr.docstatus == 0:
			frappe.db.set_value("Material Request", mr.name, STATUS_FIELD, DRAFT, update_modified=False)
			out["draft"] += 1
		else:
			out["submitted_left_alone"] += 1
	return out
