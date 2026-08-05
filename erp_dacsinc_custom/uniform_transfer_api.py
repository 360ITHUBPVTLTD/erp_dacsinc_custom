# -*- coding: utf-8 -*-
# Copyright (c) 2026, Administrator and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import nowdate, flt

@frappe.whitelist()
def create_embroidery_transfer(source_item, target_item, qty, from_warehouse, wip_warehouse):
    """
    Creates a Uniform Embroidery Transfer record and automatically generates & submits
    a Stock Entry of type 'Material Transfer' to move the plain item to WIP.
    """
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
def receive_embroidery_transfer(transfer_id, to_warehouse):
    """
    Finalizes the transfer by producing the embroidered item and consuming the plain item from WIP.
    Generates and submits a Stock Entry of type 'Repack'.
    """
    uet = frappe.get_doc("Uniform Embroidery Transfer", transfer_id)
    if uet.status != "Sent":
        frappe.throw(f"Transfer {transfer_id} has already been completed or cancelled.")
        
    # Create Stock Entry for Repack
    se = frappe.new_doc("Stock Entry")
    se.purpose = "Repack"
    
    # 1. Source row (consume plain item from WIP)
    row_source = se.append("items", {})
    row_source.item_code = uet.source_item
    row_source.qty = uet.qty
    row_source.uom = frappe.db.get_value("Item", uet.source_item, "stock_uom")
    row_source.s_warehouse = uet.wip_warehouse
    
    # 2. Target row (receive embroidered item into target warehouse)
    row_target = se.append("items", {})
    row_target.item_code = uet.target_item
    row_target.qty = uet.qty
    row_target.uom = frappe.db.get_value("Item", uet.target_item, "stock_uom")
    row_target.t_warehouse = to_warehouse
    
    se.insert(ignore_permissions=True)
    se.submit()
    
    # Update Transfer Record
    uet.to_warehouse = to_warehouse
    uet.status = "Received"
    uet.date_received = nowdate()
    uet.stock_entry_received = se.name
    uet.save(ignore_permissions=True)
    
    return True

@frappe.whitelist()
def get_embroidery_transfers(status=None):
    """
    Returns the list of Uniform Embroidery Transfers, optionally filtered by status.
    """
    filters = {}
    if status:
        filters["status"] = status
        
    return frappe.get_all(
        "Uniform Embroidery Transfer",
        filters=filters,
        fields=["name", "source_item", "target_item", "qty", "from_warehouse", "wip_warehouse", "to_warehouse", "status", "date_sent", "date_received", "stock_entry_sent", "stock_entry_received"],
        order_by="creation desc"
    )
