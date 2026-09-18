"""
Why a purchase exists: raw material for a BOM, or goods to sell.

The RM allocation (order_flow_api._rm_stock_pools) has to tell those apart —
material bought to sell on a Sales Order cannot also be consumed by that
order's BOM. It INFERS this today from whether the line's `sales_order_item`
points at a sold line of the same item, which is correct on current data but
indirect: ERPNext populates that link on its own in places, and an item that
is both sold and consumed makes the inference genuinely ambiguous.

This field records the answer instead of deducing it. Left blank, the old
inference still applies, so nothing has to be backfilled.
"""

import frappe

PURPOSE_FIELD = "custom_procurement_purpose"
PURPOSE_DOCTYPES = ("Material Request Item", "Purchase Order Item", "Purchase Receipt Item")
RAW_MATERIAL = "Raw Material"
FOR_SALE = "For Sale"


def create_procurement_purpose_fields():
    """
    Idempotent — safe to re-run, and wired to after_migrate so a deploy
    creates it. Inserting a Custom Field adds the column itself, so no
    separate schema step is needed.
    """
    for doctype in PURPOSE_DOCTYPES:
        name = f"{doctype}-{PURPOSE_FIELD}"
        if frappe.db.exists("Custom Field", name):
            continue
        try:
            frappe.get_doc({
                "doctype": "Custom Field",
                "dt": doctype,
                "fieldname": PURPOSE_FIELD,
                "label": "Procurement Purpose",
                "fieldtype": "Select",
                # Blank first: an existing line that predates this field, or
                # one nobody set, must fall back to the inference rather than
                # silently claiming to be one or the other.
                "options": "\n".join(["", RAW_MATERIAL, FOR_SALE]),
                "insert_after": "sales_order_item" if doctype != "Material Request Item" else "sales_order",
                "description": (
                    "Raw Material = consumed by a BOM. For Sale = delivered to the customer. "
                    "Leave blank to let the system work it out from the Sales Order link."
                ),
                "allow_on_submit": 1,
                "translatable": 0,
            }).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(title=f"Could not create {PURPOSE_FIELD} on {doctype}",
                              message=frappe.get_traceback())
    frappe.db.commit()


def _infer_purpose(sales_order, item_code, sales_order_item):
    """
    Raw Material or For Sale for one line, or None when it genuinely cannot
    be told (no Sales Order behind it — general stock).

    An explicit sales_order_item pointing at a SOLD line of this same item is
    the strongest signal there is: somebody tied this purchase to the line it
    ships against. Otherwise, an item that appears in a BOM on that order is
    raw material. Order matters for an item that is BOTH sold and consumed on
    the same order (Fabric blue on SAL-ORD-2026-00131 is exactly that) — the
    link decides it, and without a link it is treated as raw material, which
    is how the RM planner raises these lines.
    """
    if not sales_order or not item_code:
        return None

    if sales_order_item and frappe.db.get_value(
            "Sales Order Item", sales_order_item, "item_code") == item_code:
        return FOR_SALE

    is_bom_component = frappe.db.sql("""
        SELECT 1 FROM `tabSales Order Item` soi
        JOIN `tabBOM Item` bi ON bi.parent = soi.bom_no
        WHERE soi.parent = %s AND bi.item_code = %s AND IFNULL(soi.bom_no, '') != ''
        LIMIT 1
    """, (sales_order, item_code))
    if is_bom_component:
        return RAW_MATERIAL

    if frappe.db.exists("Sales Order Item", {"parent": sales_order, "item_code": item_code}):
        return FOR_SALE
    return None


def set_procurement_purpose(doc, method=None):
    """
    Fill Procurement Purpose on every line that hasn't got one.

    Server-side rather than in material_request.js / purchase_order.js so it
    also covers the rows nobody types by hand — the "Fetch Raw Materials from
    SO" and Global Procurement Planning dialogs, MR -> PO mapping, imports and
    API calls all land here. A value already on the row is never overwritten:
    once a human has said what a line is for, that is the answer.
    """
    for row in doc.get("items") or []:
        if row.get(PURPOSE_FIELD):
            continue
        purpose = _infer_purpose(row.get("sales_order"), row.get("item_code"),
                                 row.get("sales_order_item"))
        if purpose:
            row.set(PURPOSE_FIELD, purpose)
