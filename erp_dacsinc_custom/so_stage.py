"""The Order Flow stage of each Sales Order, kept on the order so the Sales Order list can show it and filter by
it (docs/order-flow-dashboard.md, "The stage on the Sales Order list").

The stage is the Sales Tracker's own: order_flow_api._get_tracker_rows + _compute_stage_info, never a second copy
of the rules. It is recomputed

  - in the background after any document the dashboard tracks changes (order_flow_api.broadcast_order_flow_change
    names the Sales Orders it touches), and when a Sales Order's status is set directly (Close / Re-open run
    on_change, not on_update);
  - hourly for every open order (stock arriving for an item changes orders the receipt doesn't name);
  - for every order by the patch that adds the fields.

Written with frappe.db.set_value (no modified change, no hooks), then a list_update so open lists refresh.
"""

import re

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import cstr, get_datetime, strip_html, time_diff_in_seconds

# list option → the dashboard stage_keys it covers (labels as on the dashboard's Stage bar)
STAGES = {
	"Draft (Awaiting Approval)": ("draft",),
	"Rejected": (),
	"Nothing Raised Yet": ("newly_created", "partially_delivered", "partial_rm_shortage"),
	"MR Raised": ("mr_raised",),
	"Awaiting Stock (PO)": ("awaiting_stock",),
	"In Job Work": ("in_jobwork",),
	"Embroidery": ("in_embroidery",),
	"Receiving (Draft PR)": ("receipt_draft",),
	"Stock Arrived": ("stock_received", "stock_received_partial"),
	"Draft Pick List": ("draft_pick_list",),
	"Ready to Dispatch": ("ready_to_deliver",),
	"Dispatched — Invoice Pending": ("need_to_bill",),
	"Completed": ("completed",),
	"Closed": (),
	"Cancelled": (),
}
_BY_KEY = {k: opt for opt, keys in STAGES.items() for k in keys}
# the form alert's colour (the list's are in public/js/sales_order_list.js)
COLORS = {"Rejected": "red", "Cancelled": "red", "Completed": "green", "Closed": "gray",
		  "Dispatched — Invoice Pending": "pink", "Ready to Dispatch": "blue", "Stock Arrived": "cyan",
		  "In Job Work": "purple", "Embroidery": "purple", "Awaiting Stock (PO)": "yellow",
		  "MR Raised": "orange", "Nothing Raised Yet": "orange"}

FIELDS = ("custom_order_stage", "custom_stage_detail", "custom_needs_invoice", "custom_rm_ready_for_sco")
_CHUNK = 500


def setup_fields():
	create_custom_fields({"Sales Order": [
		{"fieldname": "custom_order_stage", "label": "Order Stage", "fieldtype": "Select",
		 "options": "\n" + "\n".join(STAGES), "insert_after": "status", "read_only": 1, "no_copy": 1,
		 "in_standard_filter": 1, "in_list_view": 1, "search_index": 1,
		 "description": "As on the Order Flow dashboard; updated by itself"},
		{"fieldname": "custom_stage_detail", "label": "Stage Detail", "fieldtype": "Data",
		 "insert_after": "custom_order_stage", "read_only": 1, "no_copy": 1},
		{"fieldname": "custom_needs_invoice", "label": "Also Needs Invoice", "fieldtype": "Check",
		 "insert_after": "custom_stage_detail", "read_only": 1, "no_copy": 1, "in_standard_filter": 1,
		 "description": "Some delivered qty is not invoiced yet, whatever the stage"},
		{"fieldname": "custom_rm_ready_for_sco", "label": "RM Ready for Subcontract PO", "fieldtype": "Check",
		 "insert_after": "custom_needs_invoice", "read_only": 1, "no_copy": 1, "in_standard_filter": 1},
	]}, update=True)


def rejection(name):
	"""Who rejected this Sales Order, when, at which approval and why — {by, on, at, reason} or None.

	The workflow's own "Rejected" comment says who and when (also for a Reject clicked on the form);
	order_flow_api.reject_sales_orders adds "Rejected[ at Final Approval] by <name> on <date>: <reason>"
	right after it, which gives the stage and the reason.
	"""
	wf = frappe.get_all("Comment", fields=["owner", "creation"], order_by="creation desc", limit=1,
						filters={"reference_doctype": "Sales Order", "reference_name": name,
								 "comment_type": "Workflow", "content": "Rejected"})
	notes = frappe.get_all("Comment", fields=["content", "creation"], order_by="creation desc", limit=1,
						   filters={"reference_doctype": "Sales Order", "reference_name": name,
									"comment_type": "Comment", "content": ["like", "%Rejected%"]})
	if not wf and not notes:
		return None
	out = {"by": None, "on": None, "at": None, "reason": None}
	if wf:
		out["by"] = frappe.db.get_value("User", wf[0].owner, "full_name") or wf[0].owner
		out["on"] = wf[0].creation
	# the note belongs to this rejection only if written with it (not an older rejection's)
	if notes and (not wf or abs(time_diff_in_seconds(notes[0].creation, wf[0].creation)) < 120):
		m = re.match(r"\s*(Rejected(?: at Final Approval)?) by (.+?) on (\d{2}-\w{3}-\d{4} \d{2}:\d{2} [AP]M)(?::\s*(.*))?$",
					 strip_html(notes[0].content or ""), re.S)
		if m:
			out["at"] = "Final Approval" if "Final" in m.group(1) else "Merchandiser Approval"
			out["by"] = out["by"] or m.group(2)
			out["reason"] = (m.group(4) or "").strip() or None
		out["on"] = out["on"] or notes[0].creation
	out["on"] = get_datetime(out["on"]) if out["on"] else None
	return out


def _values(so, row):
	if so.docstatus == 0 and so.workflow_state == "Rejected":
		r = rejection(so.name) or {}
		detail = "Rejected" + (f" by {r['by']}" if r.get("by") else "") + (f": {r['reason']}" if r.get("reason") else "")
		return {"custom_order_stage": "Rejected", "custom_stage_detail": detail[:140],
				"custom_needs_invoice": 0, "custom_rm_ready_for_sco": 0}
	if so.docstatus == 2:
		return {"custom_order_stage": "Cancelled", "custom_stage_detail": "Cancelled",
				"custom_needs_invoice": 0, "custom_rm_ready_for_sco": 0}
	if so.status == "Closed":
		return {"custom_order_stage": "Closed", "custom_stage_detail": "Closed",
				"custom_needs_invoice": 0, "custom_rm_ready_for_sco": 0}
	st = (row or {}).get("stage") or {}
	# a draft's detail is where its approval stands (Pending Merchandiser / Final Approval)
	detail = so.workflow_state if so.docstatus == 0 and so.workflow_state else st.get("stage_label")
	return {
		"custom_order_stage": _BY_KEY.get(st.get("stage_key"), ""),
		"custom_stage_detail": cstr(detail)[:140],
		"custom_needs_invoice": 1 if st.get("secondary_action") or st.get("stage_key") == "need_to_bill" else 0,
		"custom_rm_ready_for_sco": 1 if (row or {}).get("rm_ready_for_sco") else 0,
	}


def refresh(names=None):
	"""Recompute and store the stage of these Sales Orders; returns how many changed."""
	from erp_dacsinc_custom.order_flow_api import _get_tracker_rows

	if isinstance(names, str):
		names = [names]
	names = sorted({n for n in names or [] if n})
	changed = 0
	for i in range(0, len(names), _CHUNK):
		chunk = names[i:i + _CHUNK]
		rows = {r["name"]: r for r in _get_tracker_rows(names=chunk)["rows"]}
		for so in frappe.get_all("Sales Order", filters={"name": ["in", chunk]},
								 fields=["name", "docstatus", "status", "workflow_state", *FIELDS]):
			new = _values(so, rows.get(so.name))
			if all(cstr(so.get(f)) == cstr(v) for f, v in new.items()):
				continue
			frappe.db.set_value("Sales Order", so.name, new, update_modified=False)
			frappe.publish_realtime("list_update", {"doctype": "Sales Order", "name": so.name},
									doctype="Sales Order", after_commit=True)
			changed += 1
	return changed


def refresh_open():
	"""Hourly: every order not finished yet, and any never computed."""
	names = frappe.get_all("Sales Order", pluck="name", filters={"docstatus": ["<", 2]},
						   or_filters={"status": ["not in", ["Completed", "Closed"]],
									   "custom_order_stage": ["in", ["", None]]})
	return refresh(names)


def refresh_all():
	return refresh(frappe.get_all("Sales Order", pluck="name"))


def for_form(name):
	"""The Sales Order form's alert: the stage computed now (and stored), and the rejection if rejected."""
	refresh([name])
	out = frappe.db.get_value("Sales Order", name, ["workflow_state", *FIELDS], as_dict=True) or {}
	out["rejection"] = rejection(name) if out.get("workflow_state") == "Rejected" else None
	out["color"] = COLORS.get(out.get("custom_order_stage"), "gray")
	return out


def on_change(doc, method=None):
	"""Sales Order on_change: Close / Re-open / Hold set the status with db_set, which runs no on_update."""
	frappe.enqueue("erp_dacsinc_custom.so_stage.refresh", queue="short", names=[doc.name], enqueue_after_commit=True)
