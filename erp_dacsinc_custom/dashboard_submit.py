"""Order Flow: submit a draft straight from its dashboard row.

order_flow.js adds a "Submit" button to draft rows (add_submit_buttons). It shows the document
back (get_submit_preview) and submits only after a tick (submit_from_dashboard). The document
is submitted as the user with the full server-side validation every form submit runs, so
nothing a form submit would refuse gets through here.

Not offered for Sales Orders (they go through the approval workflow) or Pick Lists (they have
their own "Submit Pick List" review of what was picked).
"""

import frappe
from frappe import _
from frappe.utils import flt

from erp_dacsinc_custom.order_flow_permissions import can_act_tab

# doctype -> the Order Flow tabs that list its drafts (the user must be able to act on one)
SUBMITTABLE = {
    "Material Request": ("tracker", "purchase"),
    "Purchase Order": ("purchase", "jobwork"),
    "Purchase Receipt": ("purchase", "jobwork"),
    "Subcontracting Receipt": ("purchase", "jobwork"),
    "Embroidery Work Order": ("jobwork", "tracker"),
    "Sales Invoice": ("accounts",),
    "Purchase Invoice": ("accounts",),
}


def _load(doctype, name):
    if doctype not in SUBMITTABLE:
        frappe.throw(_("{0} can't be submitted from the dashboard.").format(_(doctype)))
    if not any(can_act_tab(t) for t in SUBMITTABLE[doctype]):
        frappe.throw(_("You can view this tab of Order Flow, but not act from it."), frappe.PermissionError)
    doc = frappe.get_doc(doctype, name)
    doc.check_permission("submit")
    if doc.docstatus != 0:
        frappe.throw(_("{0} {1} is not a draft any more.").format(_(doctype), name))
    return doc


def _party(doc):
    for f in ("customer_name", "supplier_name"):
        if doc.get(f):
            return doc.get(f)
    for f in ("customer", "supplier", "panel_jobber", "full_piece_jobber"):
        if doc.get(f):
            return doc.get(f)
    return ""


@frappe.whitelist()
def get_submit_preview(doctype, name):
    doc = _load(doctype, name)
    items = []
    for r in doc.get("items") or []:
        qty = r.get("qty") if r.get("qty") is not None else r.get("ordered_qty")
        items.append({
            "item_code": r.get("item_code") or r.get("item") or "",
            "item_name": r.get("item_name") or "",
            "qty": flt(qty),
            "uom": r.get("uom") or r.get("stock_uom") or "",
            "rate": flt(r.get("rate")) if r.get("rate") is not None else None,
            "amount": flt(r.get("amount")) if r.get("amount") is not None else None,
            "warehouse": r.get("warehouse") or "",
        })
    total = flt(doc.get("rounded_total")) or flt(doc.get("grand_total"))
    # Purchase Order lines over their Material Request: ERPNext would refuse the submit
    # ("Limit Crossed"); say so here and let the user correct them on the form.
    mr_over = []
    if doctype == "Purchase Order":
        from erp_dacsinc_custom.purchase_order import check_po_against_mr
        mr_over = check_po_against_mr([{
            "row": r.name, "material_request_item": r.material_request_item, "qty": r.qty,
            "stock_qty": r.stock_qty, "conversion_factor": r.conversion_factor, "uom": r.uom,
        } for r in doc.items if r.get("material_request_item")], doc.name)
    return {
        "mr_over": mr_over,
        "doctype": doctype,
        "name": doc.name,
        "party": _party(doc),
        "date": str(doc.get("posting_date") or doc.get("transaction_date") or doc.get("date") or ""),
        "total": total or None,
        "currency": doc.get("currency") or "",
        "bill_no": doc.get("bill_no") or "",
        "is_subcontracted": doc.get("is_subcontracted") or 0,
        "items": items,
    }


@frappe.whitelist()
def submit_from_dashboard(doctype, name):
    doc = _load(doctype, name)
    doc.submit()
    return {"name": doc.name, "status": doc.get("status") or "Submitted"}
