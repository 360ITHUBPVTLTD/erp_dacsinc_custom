# -*- coding: utf-8 -*-
# Copyright (c) 2026, Administrator and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import nowdate, flt

from erp_dacsinc_custom.order_flow_permissions import guard_tab

@frappe.whitelist()
def create_embroidery_transfer(source_item, target_item, qty, from_warehouse, wip_warehouse):
    """
    Creates a Uniform Embroidery Transfer record and automatically generates & submits
    a Stock Entry of type 'Material Transfer' to move the plain item to WIP.
    """
    guard_tab("uniform")  # exclusively invoked from that tab's "Create Transfer" dialog
    qty = flt(qty)
    if qty <= 0:
        frappe.throw("Quantity must be greater than 0.")
        
    # Check if source item exists and has stock in from_warehouse
    stock_qty = frappe.db.get_value("Bin", {"item_code": source_item, "warehouse": from_warehouse}, "actual_qty") or 0.0
    if stock_qty < qty:
        frappe.throw(f"Insufficient stock for {source_item} in {from_warehouse}. Available: {stock_qty}, Required: {qty}")
        
    # Create the Stock Entry for Material Transfer
    se = frappe.new_doc("Stock Entry")
    se.purpose = "Material Transfer"
    se.stock_entry_type = "Material Transfer"
    se.from_warehouse = from_warehouse
    se.to_warehouse = wip_warehouse
    
    # Append the source item
    row = se.append("items", {})
    row.item_code = source_item
    row.qty = qty
    row.uom = frappe.db.get_value("Item", source_item, "stock_uom")
    row.s_warehouse = from_warehouse
    row.t_warehouse = wip_warehouse
    
    se.insert(ignore_permissions=True)
    se.submit()
    
    # Create the Uniform Embroidery Transfer document
    uet = frappe.new_doc("Uniform Embroidery Transfer")
    uet.source_item = source_item
    uet.target_item = target_item
    uet.qty = qty
    uet.from_warehouse = from_warehouse
    uet.wip_warehouse = wip_warehouse
    uet.status = "Sent"
    uet.date_sent = nowdate()
    uet.stock_entry_sent = se.name
    uet.insert(ignore_permissions=True)
    
    return uet.name

@frappe.whitelist()
def receive_embroidery_transfer(transfer_id, to_warehouse, qty=None):
    """
    Records one receipt against an embroidery transfer — producing the
    embroidered item and consuming the plain item from WIP for `qty` (or, if
    omitted, everything still outstanding). Generates and submits a Stock
    Entry of type 'Repack' for exactly that quantity.

    A transfer can be received in more than one call: each call logs its own
    row in the `receipts` child table and adds to `received_qty`, so an
    embroiderer who returns a batch in parts (e.g. 20 of 50 today, the rest
    later) is represented accurately rather than forcing an all-or-nothing
    receipt. Status becomes "Partially Received" until received_qty reaches
    the original qty, then "Received".
    """
    guard_tab("uniform")  # exclusively invoked from that tab's "Receive" button
    uet = frappe.get_doc("Uniform Embroidery Transfer", transfer_id)
    if uet.status not in ("Sent", "Partially Received"):
        frappe.throw(f"Transfer {transfer_id} has already been fully received or cancelled.")

    outstanding = flt(uet.qty) - flt(uet.received_qty)
    qty = flt(qty) if qty not in (None, "") else outstanding
    if qty <= 0:
        frappe.throw("Quantity to receive must be greater than 0.")
    if qty > outstanding:
        frappe.throw(f"Cannot receive {qty} — only {outstanding} is still outstanding on this transfer.")

    # Create Stock Entry for Repack, for THIS receipt's quantity only.
    se = frappe.new_doc("Stock Entry")
    se.purpose = "Repack"
    se.stock_entry_type = "Repack"

    # 1. Source row (consume plain item from WIP)
    row_source = se.append("items", {})
    row_source.item_code = uet.source_item
    row_source.qty = qty
    row_source.uom = frappe.db.get_value("Item", uet.source_item, "stock_uom")
    row_source.s_warehouse = uet.wip_warehouse

    # 2. Target row (receive embroidered item into target warehouse)
    row_target = se.append("items", {})
    row_target.item_code = uet.target_item
    row_target.qty = qty
    row_target.uom = frappe.db.get_value("Item", uet.target_item, "stock_uom")
    row_target.t_warehouse = to_warehouse

    se.insert(ignore_permissions=True)
    se.submit()

    # Update Transfer Record — append this receipt, and the summary fields
    # reflect the most recent receipt (see field descriptions on the doctype).
    uet.append("receipts", {
        "date": nowdate(),
        "qty": qty,
        "to_warehouse": to_warehouse,
        "stock_entry": se.name,
    })
    uet.received_qty = flt(uet.received_qty) + qty
    uet.to_warehouse = to_warehouse
    uet.status = "Received" if uet.received_qty >= flt(uet.qty) else "Partially Received"
    uet.date_received = nowdate()
    uet.stock_entry_received = se.name
    uet.save(ignore_permissions=True)

    return {"status": uet.status, "received_qty": uet.received_qty, "outstanding": flt(uet.qty) - uet.received_qty}

@frappe.whitelist()
def get_embroidery_transfers(status=None, search=None, scope=None, **kwargs):
    """
    Returns the list of Uniform Embroidery Transfers, optionally filtered by status and search query.
    Note: We show all transfers (Sent and Received) even under open scope so the user can track them.
    """
    guard_tab("uniform")
    conditions = []
    values = {}
    
    if status:
        conditions.append("status = %(status)s")
        values["status"] = status
        
    if search:
        conditions.append("(name LIKE %(search)s OR source_item LIKE %(search)s OR target_item LIKE %(search)s)")
        values["search"] = f"%{search}%"
        
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    
    return frappe.db.sql(f"""
        SELECT name, source_item, target_item, qty, received_qty, from_warehouse, wip_warehouse,
               to_warehouse, status, date_sent, date_received, stock_entry_sent, stock_entry_received
        FROM `tabUniform Embroidery Transfer`
        {where_clause}
        ORDER BY creation DESC
        LIMIT 300
    """, values, as_dict=1)

@frappe.whitelist()
def get_item_stock_details(item_code, warehouse):
    """
    Returns detailed stock quantities for an item in a specific warehouse,
    subtracting reserved/allocated stock to compute net unreserved qty.
    """
    guard_tab("uniform")  # exclusively invoked from that tab's transfer dialog
    bin_data = frappe.db.get_value(
        "Bin", 
        {"item_code": item_code, "warehouse": warehouse}, 
        [
            "actual_qty", 
            "reserved_qty", 
            "reserved_qty_for_production", 
            "reserved_qty_for_sub_contract"
        ], 
        as_dict=1
    )
    if not bin_data:
        return {
            "actual_qty": 0.0,
            "reserved_qty": 0.0,
            "reserved_qty_for_production": 0.0,
            "reserved_qty_for_sub_contract": 0.0,
            "net_available": 0.0
        }
    
    bin_data = {k: float(v) for k, v in bin_data.items()}
    bin_data["net_available"] = max(
        0.0, 
        bin_data["actual_qty"] - 
        bin_data["reserved_qty"] - 
        bin_data["reserved_qty_for_production"] - 
        bin_data["reserved_qty_for_sub_contract"]
    )
    return bin_data
