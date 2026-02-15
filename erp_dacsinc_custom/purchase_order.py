# frappe
from collections import defaultdict
import frappe
from frappe.utils import cint, flt, getdate

# --- HELPER FUNCTION ---
# This new helper function centralizes the logic for calculating reserved quantities 
# from Pick Lists, fixing the NameError from the original script.
def _get_pick_list_reserved_qty(sales_order, item_code):
    """
    Calculates the total quantity of a specific item reserved for a sales order
    across all relevant Pick Lists (both Draft and Submitted).
    """
    # Sum quantities from submitted (but not completed) Pick Lists
    pl_picked_qty = flt(frappe.db.sql("""
        SELECT SUM(pli.picked_qty) FROM `tabPick List Item` pli 
        JOIN `tabPick List` pl ON pl.name = pli.parent
        WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 1 
        AND pl.status NOT IN ('Completed', 'Cancelled')
    """, (sales_order, item_code))[0][0])
    
    # Sum quantities from draft Pick Lists
    pl_yet_to_pick_qty = flt(frappe.db.sql("""
        SELECT SUM(pli.qty) FROM `tabPick List Item` pli 
        JOIN `tabPick List` pl ON pl.name = pli.parent
        WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 0
    """, (sales_order, item_code))[0][0])
    
    return pl_picked_qty + pl_yet_to_pick_qty


# # The validation function is updated with the exact same logic for consistency.
# @frappe.whitelist()
# def validate_and_get_items_for_po(selected_items, is_subcontracted=False):
#     selected_items = frappe.parse_json(selected_items)
#     is_subcontracted = cint(is_subcontracted)
#     item_code_field = 'fg_item' if is_subcontracted else 'item_code'
    
#     valid_items = []
#     rejected_items = []
    
#     for item in selected_items:
#         # pendingQty is the Quantity to Purchase/Manufacture as entered by the user
#         qty_to_add = item.get('pendingQty', 0)

#         # Get original SO details.
#         so_item_details = frappe.db.get_value("Sales Order Item", 
#             {'parent': item.get('salesOrder'), 'item_code': item.get('itemCode')}, 
#             ['qty', 'delivered_qty'], 
#             as_dict=True
#         )
#         if not so_item_details:
#             rejected_items.append({"sales_order": item.get('salesOrder'), "item_name": item.get('itemName'), "reason": "Sales Order Item not found."})
#             continue

#         # 1. Calculate quantity already on other Purchase Orders.
#         ordered_on_pos_raw = frappe.db.sql("""
#             SELECT SUM(poi.qty) FROM `tabPurchase Order Item` AS poi
#             JOIN `tabPurchase Order` AS po ON po.name = poi.parent
#             WHERE po.docstatus = 1 AND poi.sales_order = %(sales_order)s AND poi.{field} = %(item_code)s
#         """.format(field=item_code_field), {'sales_order': item.get('salesOrder'),'item_code': item.get('itemCode')})
#         ordered_on_pos = (ordered_on_pos_raw[0][0] or 0) if ordered_on_pos_raw else 0

#         # 2. FIXED: Calculate the quantity reserved via Pick Lists for this Sales Order.
#         reserved_via_pick_list = _get_pick_list_reserved_qty(item.get('salesOrder'), item.get('itemCode'))
        
#         # 3. The true maximum allowable quantity for a new PO.
#         max_allowable_qty = so_item_details.qty - so_item_details.delivered_qty - ordered_on_pos - reserved_via_pick_list
        
#         # The Core Validation.
#         if qty_to_add > (max_allowable_qty + 0.001) or max_allowable_qty <= 0:
#             # We reject if quantity exceeds the max, or if max is effectively 0
#              rejected_items.append({
#                 "sales_order": item.get('salesOrder'),
#                 "item_name": item.get('itemName'),
#                 "reason": f"Cannot add {qty_to_add} units. {max_allowable_qty:.2f} pending procurement."
#             })
#         else:
#             # Item is valid, add it to the list.
#             item_details_data = {}
#             if is_subcontracted:
#                 service_item_code = None
#                 bom_name = item.get('bom_no')
#                 if bom_name:
#                     service_item_code = frappe.db.get_value("BOM", bom_name, "custom_service_item")

#                 # 2. If BOM not passed or custom_service_item is empty, try Default BOM of the Item
#                 if not service_item_code:
#                     default_bom = frappe.db.get_value("Item", item.get('itemCode'), "default_bom")
#                     if default_bom:
#                         service_item_code = frappe.db.get_value("BOM", default_bom, "custom_service_item")

#                 # 3. Fallback if still not found
#                 if not service_item_code:
#                     service_item_code = "Order Charges"
#                 # Fetch details for the Service Item
#                 item_details_data = get_item_details_for_po(service_item_code) or {}
                
#                 # Set Purchase Order Item standard fields (The Service Item):
#                 item_details_data['item_code'] = service_item_code
                
#                 # ----------------- QTY is SYNCHRONIZED WITH fg_item_qty -----------------
#                 # Service Item Qty
#                 item_details_data['qty'] = qty_to_add 

#                 # Set Subcontracting specific fields:
#                 # fg_item is set to BOM ID per previous request
#                 item_details_data['fg_item'] = item.get('itemCode')           
#                 # Finished Good QTY is set to user input Qty
#                 item_details_data['fg_item_qty'] = qty_to_add            
#                 # -----------------------------------------------------------------------

#                 item_details_data['sales_order'] = item.get('salesOrder') 
#                 item_details_data['bom'] = item.get('bom')                

#                 # Update description to be informative
#                 description = item_details_data.get('description', '')
#                 new_description_line = f"\n\nManufacturing of: {item.get('itemName')} ({item.get('itemCode')})\nRef SO: {item.get('salesOrder')}"
#                 item_details_data['description'] = (description + new_description_line).strip()
            
#             else:
#                 # Standard procurement (remains unchanged)
#                 item_details_data = get_item_details_for_po(item.get('itemCode')) or {}
                
#                 item_details_data['item_code'] = item.get('itemCode')
#                 item_details_data['qty'] = item.get('pendingQty')
#                 item_details_data['sales_order'] = item.get('salesOrder')
                
#             valid_items.append(item_details_data)
#     print(valid_items)
#     print(rejected_items)
#     return {
#         "valid_items": valid_items,
#         "rejected_items": rejected_items
#     }



# import frappe
# import json
# from frappe.utils import flt

# @frappe.whitelist()
# def validate_and_get_items_for_po(selected_items, is_subcontracted=0):
#     if isinstance(selected_items, str):
#         selected_items = json.loads(selected_items)

#     valid_items = []
#     is_subcontracted = int(is_subcontracted)

#     for entry in selected_items:
#         item_code = entry.get('item_code')
#         # Fetch standard item details required for a PO row
#         item_doc = frappe.get_cached_doc("Item", item_code)
        
#         # Get default warehouse from Item or Item Default
#         default_warehouse = item_doc.item_defaults[0].default_warehouse if item_doc.item_defaults else None

#         item_details = {
#             "item_code": item_code,
#             "item_name": item_doc.item_name,
#             "description": item_doc.description,
#             "uom": item_doc.stock_uom,
#             "stock_uom": item_doc.stock_uom,
#             "conversion_factor": 1.0,
#             "warehouse": default_warehouse or frappe.db.get_single_value('Stock Settings', 'default_warehouse'),
#             "sales_order": entry.get('sales_order'),
#             "bom": entry.get('bom'),
#         }

#         # Specific Logic for Subcontracting
#         if is_subcontracted:
#             # For Subcontract POs, the Item from SO is the 'fg_item'
#             item_details["fg_item"] = item_code
#             item_details["fg_item_qty"] = flt(entry.get('qty'))
#             # We must also fetch the primary raw material if applicable, 
#             # or rely on ERPNext to fetch via BOM later.
#             # But here we set the FG to ensure the PO understands what is being made.
        
#         # Fetch last purchase rate or standard rate
#         rate = frappe.db.get_value("Item Price", {"item_code": item_code, "price_list": "Standard Purchase"}, "price_list_rate")
#         item_details["rate"] = flt(rate) if rate else 0.0

#         valid_items.append(item_details)

#     return {"valid_items": valid_items}



import frappe
import json
from frappe.utils import flt, cint

@frappe.whitelist()
def validate_and_get_items_for_po(selected_items, is_subcontracted=0):
    if isinstance(selected_items, str):
        selected_items = json.loads(selected_items)

    is_subcontracted = cint(is_subcontracted)
    valid_items = []
    rejected_items = []

    for entry in selected_items:
        qty_to_add = flt(entry.get("pendingQty") or entry.get("qty"), 0)
        if qty_to_add <= 0:
            rejected_items.append({
                "sales_order": entry.get("salesOrder"),
                "item_name": entry.get("itemName", entry.get("item_code")),
                "reason": "Quantity ≤ 0"
            })
            continue

        sales_order = entry.get("salesOrder")
        item_code = entry.get("itemCode") or entry.get("item_code")

        # ── Basic SO item validation ──
        so_item = frappe.db.get_value(
            "Sales Order Item",
            {"parent": sales_order, "item_code": item_code},
            ["qty", "delivered_qty"],
            as_dict=True,
        )

        if not so_item:
            rejected_items.append({
                "sales_order": sales_order,
                "item_name": entry.get("itemName", item_code),
                "reason": "Sales Order Item not found"
            })
            continue

        # ── Subcontracted path ────────────────────────────────────────
        if is_subcontracted:
            service_item_code = None
            bom_name = entry.get("bom_no") or entry.get("bom")

            # 1. From passed BOM
            if bom_name:
                service_item_code = frappe.db.get_value("BOM", bom_name, "custom_service_item")

            # 2. Fallback to item's default BOM
            if not service_item_code:
                default_bom = frappe.db.get_value("Item", item_code, "default_bom")
                if default_bom:
                    service_item_code = frappe.db.get_value("BOM", default_bom, "custom_service_item")

            # 3. Ultimate fallback
            if not service_item_code:
                service_item_code = "Order Charges"   # ← change if you have a better default

            # Get base details using the **service item**
            item_details = get_item_details_for_po(service_item_code) or {}

            # Overwrite / set mandatory fields
            item_details.update({
                "item_code": service_item_code,
                "qty": qty_to_add,               # service qty = fg qty
                "fg_item": item_code,            # the item being manufactured
                "fg_item_qty": qty_to_add,
                "sales_order": sales_order,
                "bom": bom_name,
            })

            # Improve description
            base_desc = item_details.get("description", "")
            extra_desc = (
                f"\n\nManufacturing: {entry.get('itemName')} ({item_code})\n"
                f"Ref SO: {sales_order}"
            )
            item_details["description"] = (base_desc + extra_desc).strip()

        # ── Normal procurement path ───────────────────────────────────
        else:
            item_details = get_item_details_for_po(item_code) or {}

            item_details.update({
                "item_code": item_code,
                "qty": qty_to_add,
                "sales_order": sales_order,
                # Important: make sure subcontracting fields are NOT set
                "fg_item": None,
                "fg_item_qty": None,
                "bom": None,
            })

            # Optional: clean description if needed
            # item_details["description"] = ... 

        # Common fields (both paths)
        item_details.setdefault("warehouse", None)   # let ERPNext decide / ask user
        # You can add rate, uom, etc. here if get_item_details_for_po doesn't

        valid_items.append(item_details)

    return {
        "valid_items": valid_items,
        "rejected_items": rejected_items
    }

# @frappe.whitelist()
# def validate_and_get_items_for_po(selected_items, is_subcontracted=False):
#     from frappe.utils import cint, flt

#     selected_items = frappe.parse_json(selected_items)
#     is_subcontracted = cint(is_subcontracted)
#     item_code_field = 'fg_item' if is_subcontracted else 'item_code'
    
#     valid_items = []
    
#     # We collect rejected items to debug, though we aim to accept user input
#     rejected_items = [] 
    
#     for item in selected_items:
#         # pendingQty is the Quantity the user explicitly typed in the dialog
#         qty_to_add = flt(item.get('pendingQty', 0))
#         sales_order = item.get('salesOrder')
#         item_code = item.get('itemCode')
#         item_name = item.get('itemName')

#         if qty_to_add <= 0:
#             continue

#         # 1. Fetch SO Item Details
#         # We sum them up just in case the item appears twice in the SO (Split lines)
#         so_data = frappe.db.sql("""
#             SELECT SUM(qty) as qty, SUM(delivered_qty) as delivered_qty 
#             FROM `tabSales Order Item` 
#             WHERE parent = %s AND item_code = %s
#         """, (sales_order, item_code), as_dict=True)

#         if not so_data or not so_data[0].qty:
#             rejected_items.append({"item_code": item_code, "reason": "Item not found in Sales Order"})
#             continue
            
#         so_qty = flt(so_data[0].qty)
#         delivered_qty = flt(so_data[0].delivered_qty)

#         # 2. Prepare Item Data
#         item_details_data = {}

#         if is_subcontracted:
#             service_item_code = None
            
#             # FIX: Use 'bom' from JSON, not 'bom_no'
#             bom_name = item.get('bom') 
            
#             if bom_name:
#                 service_item_code = frappe.db.get_value("BOM", bom_name, "custom_service_item")

#             # Fallback to Item Default BOM
#             if not service_item_code:
#                 default_bom = frappe.db.get_value("Item", item_code, "default_bom")
#                 if default_bom:
#                     service_item_code = frappe.db.get_value("BOM", default_bom, "custom_service_item")

#             # Final Fallback
#             if not service_item_code:
#                 service_item_code = "Order Charges" # Ensure this Item exists in your system!

#             # Fetch basic details (UOM, Rate, etc) for the Service Item
#             # Using standard frappe call if your custom function doesn't exist
#             try:
#                 # Try your custom function if it exists globally
#                 item_details_data = get_item_details_for_po(service_item_code) or {}
#             except NameError:
#                 # Fallback to standard fetch
#                 item_details_data = frappe.db.get_value("Item", service_item_code, 
#                     ["item_name", "description", "stock_uom as uom", "purchase_uom"], as_dict=True) or {}
#                 item_details_data['conversion_factor'] = 1

#             # --- Subcontracting Mapping ---
#             item_details_data['item_code'] = service_item_code
#             item_details_data['qty'] = qty_to_add 
            
#             # Important: Map FG Item
#             item_details_data['fg_item'] = item_code
#             item_details_data['fg_item_qty'] = qty_to_add            
#             item_details_data['bom'] = bom_name
            
#             # Description
#             desc = item_details_data.get('description', '')
#             item_details_data['description'] = f"{desc}\nManufacturing: {item_name}\nRef SO: {sales_order}".strip()

#         else:
#             # Standard Buying
#             try:
#                 item_details_data = get_item_details_for_po(item_code) or {}
#             except NameError:
#                 item_details_data = frappe.db.get_value("Item", item_code, 
#                     ["item_name", "description", "stock_uom as uom"], as_dict=True) or {}
#                 item_details_data['conversion_factor'] = 1

#             item_details_data['item_code'] = item_code
#             item_details_data['qty'] = qty_to_add
#             item_details_data['description'] = item_details_data.get('description', item_name)

#         # Common Fields
#         item_details_data['sales_order'] = sales_order
        
#         # Add to valid list (We trust the user input)
#         valid_items.append(item_details_data)

#     return {
#         "valid_items": valid_items,
#         "rejected_items": rejected_items # Check this in console if list is still empty
#     }

# import frappe
# from frappe import _
# from frappe.utils import flt, cint
# from collections import defaultdict

# @frappe.whitelist()
# def get_pending_so_with_material_stock(is_subcontracted=False):
#     is_subcontracted = cint(is_subcontracted)
#     item_code_field = "fg_item" if is_subcontracted else "item_code"
    
#     # Existing helper is a placeholder - let's implement the specific logic in the loop for visibility
#     # We will rename the variable to what it actually represents: the total committed/reserved via Pick List
#     # We will assume you replace `frm.trigger('refresh');` with the necessary imports or logic
#     # if frappe's existing `_get_pick_list_reserved_qty` is not suitable/does not exist.
    
#     condition = "AND soi.bom_no IS NOT NULL AND soi.bom_no != ''" if is_subcontracted else "AND (soi.bom_no IS NULL OR soi.bom_no = '')"

#     pending_orders_raw = frappe.db.sql(f"""
#         SELECT
#             soi.name AS so_item_name, soi.parent AS sales_order, so.customer AS customer,
#             soi.item_code, soi.item_name, soi.qty, soi.bom_no AS bom,
#             soi.delivered_qty
#         FROM `tabSales Order Item` AS soi JOIN `tabSales Order` AS so ON so.name = soi.parent
#         WHERE so.docstatus = 1 AND so.status NOT IN ('On Hold', 'Completed', 'Cancelled')
#         AND soi.qty > soi.delivered_qty {condition}
#         ORDER BY so.transaction_date ASC, soi.item_code ASC
#     """, as_dict=True)

#     if not pending_orders_raw:
#         return {}

#     final_pending_orders = []
#     for so_item in pending_orders_raw:
        
#         # 1. Quantity of THIS Sales Order Item already accounted for on an open PO
#         ordered_on_pos_raw = frappe.db.sql("""
#             SELECT SUM(poi.qty) FROM `tabPurchase Order Item` AS poi
#             JOIN `tabPurchase Order` AS po ON po.name = poi.parent
#             WHERE po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled')
#             AND poi.sales_order = %(sales_order)s AND poi.{field} = %(item_code)s
#         """.format(field=item_code_field), {'sales_order': so_item.sales_order, 'item_code': so_item.item_code})
#         ordered_on_pos = flt(ordered_on_pos_raw[0][0])

#         # 2. Pick List reservation for THIS SO (The total committed via PL: Draft (yet to pick) and Submitted (picked))
        
#         # New: Get the submitted (picked) quantity
#         pl_picked_qty = flt(frappe.db.sql("""
#             SELECT SUM(pli.picked_qty) FROM `tabPick List Item` pli 
#             JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 1 
#             AND pl.status NOT IN ('Completed', 'Cancelled')
#         """, (so_item.sales_order, so_item.item_code))[0][0])
        
#         # New: Get the draft (yet to pick) quantity
#         pl_yet_to_pick_qty = flt(frappe.db.sql("""
#             SELECT SUM(pli.qty) FROM `tabPick List Item` pli 
#             JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 0
#         """, (so_item.sales_order, so_item.item_code))[0][0])
        
#         # Total committed by Pick List (Picked + Yet to Pick)
#         total_pl_committed = pl_picked_qty + pl_yet_to_pick_qty

#         # --- KEY CALCULATION: Remaining SO Quantity - Committed to Pick Lists ---
#         qty_uncommitted = so_item.qty - so_item.delivered_qty - total_pl_committed

#         if qty_uncommitted > 0.001:
#             # The SO item is not fully delivered AND has an uncommitted/unreserved quantity that needs procurement/picking.
            
#             # 3. FINAL Qty to purchase (The procurement need): 
#             # (Total Required - Delivered - Committed by PL) - Ordered (on PO)
#             qty_pending_purchase = qty_uncommitted - ordered_on_pos
            
#             # Use the procurement need as the item's main 'pending_qty'. Must not be negative.
#             so_item['pending_qty'] = max(0, flt(qty_pending_purchase)) 
            
#             # Detailed Breakdown for FE if needed (and total)
#             so_item['pl_picked_qty'] = pl_picked_qty
#             so_item['pl_yet_to_pick_qty'] = pl_yet_to_pick_qty
#             so_item['fg_reserved_for_so_qty'] = total_pl_committed # Renamed in the UI from previous value
            
#             if so_item['pending_qty'] > 0: # Only add items that require procurement
#                  final_pending_orders.append(so_item)


#     if not final_pending_orders:
#         return {}

#     # --- Building the summary and propagating item status (Aggregation remains the same) ---
#     item_summary_dict = defaultdict(lambda: {"total_qty": 0, "order_count": 0, "boms": set(), "item_name": ""})
#     for so in final_pending_orders:
#         item_code = so.item_code
#         item_summary_dict[item_code]["total_qty"] += so.pending_qty # Sum the procurement need
#         item_summary_dict[item_code]["order_count"] += 1
#         item_summary_dict[item_code]["item_name"] = so.item_name
#         if so.bom: item_summary_dict[item_code]["boms"].add(so.bom)
    
#     item_summary = []
#     for item_code, data in item_summary_dict.items():
        
#         # 1. Overall Total Stock (Actual) 
#         # Using a safer query if Bin doesn't have aggregate sum defined
#         fg_actual_res = frappe.db.sql("SELECT SUM(actual_qty) FROM `tabBin` WHERE item_code = %s", item_code)
#         fg_actual = flt(fg_actual_res[0][0])
        
#         # 2. Overall Reserved Quantity (from Stock Reservation Entry - the main commitment driver)
#         # SRE Total Committed
#         total_reserved_res = frappe.db.sql("SELECT SUM(reserved_qty) FROM `tabStock Reservation Entry` WHERE item_code = %s AND docstatus = 1", item_code)
#         total_reserved = flt(total_reserved_res[0][0])
        
#         # Available = Total Actual - Total Committed (from Stock Reservation)
#         fg_available = fg_actual - total_reserved
        
#         # Pick List aggregation is for reference/display, no change needed as it is non-additive in calculation here
#         total_picked_submitted = flt(frappe.db.sql("""
#             SELECT SUM(pli.picked_qty) FROM `tabPick List Item` pli 
#             JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.item_code = %s AND pl.docstatus = 1 AND pl.status NOT IN ('Completed', 'Cancelled')
#         """, (item_code))[0][0])

#         total_picked_draft = flt(frappe.db.sql("""
#             SELECT SUM(pli.qty) FROM `tabPick List Item` pli 
#             JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.item_code = %s AND pl.docstatus = 0
#         """, (item_code))[0][0])
        
        
#         bom = next(iter(data["boms"]), None)
#         # You'll need an implementation for _get_bom_stock_details if this is not a standard helper
#         # materials = _get_bom_stock_details(bom, data["total_qty"]) if bom and data["total_qty"] > 0 else [] 
        
#         # Temporarily removing the _get_bom_stock_details call as its logic is in the other Python function which you didn't provide.
#         # Ensure it's imported or defined if required. If not available, replace with []
#         materials = [] 
#         # Check if the needed BOM helper is a common one or defined below
#         try:
#              # Assume _get_bom_stock_details is a custom defined function like _get_pick_list_reserved_qty
#              materials = _get_bom_stock_details(bom, data["total_qty"]) if bom and data["total_qty"] > 0 else [] 
#         except NameError:
#              pass # Use empty list if helper is not defined in this scope

        
#         item_summary.append({
#             "item_code": item_code, 
#             "item_name": data["item_name"],
            
#             # --- POPULATED SUMMARY FIELDS ---
#             "fg_total_stock": flt(fg_actual), 
#             "fg_available_qty": flt(fg_available), # Unrestricted/Uncommitted stock based on general SRE
#             "fg_picked_submitted": flt(total_picked_submitted),
#             "fg_picked_draft": flt(total_picked_draft),
            
#             # --- OLD/GENERAL FIELDS ---
#             "total_pending_qty": data["total_qty"], # Total Procurement Need across all SOs for this item
#             "order_count": data["order_count"],
#             "total_reserved_qty": flt(total_reserved), # General item reserved from SREs
#             "raw_materials": materials
#         })
        
#     # Final Propagation Loop 
#     for so_item in final_pending_orders:
#         summary = next(i for i in item_summary if i['item_code'] == so_item.item_code)
        
#         # Attach *total* item data from the Summary back to the individual SO row
#         so_item['fg_total_stock'] = summary['fg_total_stock']
#         so_item['fg_total_reserved_qty'] = summary['total_reserved_qty']
#         so_item['fg_available_qty'] = summary['fg_available_qty'] 
#         so_item['fg_picked_submitted'] = summary['fg_picked_submitted']
#         so_item['fg_picked_draft'] = summary['fg_picked_draft']

#     return {
#         "item_summary": sorted(item_summary, key=lambda x: x['total_pending_qty'], reverse=True),
#         "sales_orders": final_pending_orders
#     }

# import frappe
# from frappe import _
# from frappe.utils import flt, cint
# from collections import defaultdict

# @frappe.whitelist()
# def get_pending_so_with_material_stock(is_subcontracted=False):
#     is_subcontracted = cint(is_subcontracted)
#     item_code_field = "fg_item" if is_subcontracted else "item_code"
    
#     # Filter to ensure we get relevant Sales Order items
#     condition = "AND soi.bom_no IS NOT NULL AND soi.bom_no != ''" if is_subcontracted else "AND (soi.bom_no IS NULL OR soi.bom_no = '')"

#     # 1. Fetch Sales Order Items that are open and have pending delivery quantity
#     pending_orders_raw = frappe.db.sql(f"""
#         SELECT
#             soi.name AS so_item_name, 
#             soi.parent AS sales_order, 
#             so.customer AS customer,
#             soi.item_code, 
#             soi.item_name, 
#             soi.qty, 
#             soi.bom_no AS bom,
#             soi.delivered_qty
#         FROM `tabSales Order Item` AS soi 
#         JOIN `tabSales Order` AS so ON so.name = soi.parent
#         WHERE so.docstatus = 1 
#         AND so.status NOT IN ('On Hold', 'Completed', 'Cancelled', 'Closed')
#         AND soi.qty > soi.delivered_qty {condition}
#         ORDER BY so.transaction_date ASC, soi.item_code ASC
#     """, as_dict=True)

#     if not pending_orders_raw:
#         return {}

#     final_pending_orders = []

#     # 2. Iterate through items to attach Stock, PO, and Pick List data
#     for so_item in pending_orders_raw:
        
#         # --- A. INCOMING PURCHASE ORDER DATA ---
#         # Fetch Total Qty, Received Qty, and List of PO Names linked to this specific SO Item
#         po_stats = frappe.db.sql("""
#             SELECT 
#                 SUM(poi.qty), 
#                 SUM(poi.received_qty),
#                 GROUP_CONCAT(DISTINCT po.name SEPARATOR ', ')
#             FROM `tabPurchase Order Item` AS poi
#             JOIN `tabPurchase Order` AS po ON po.name = poi.parent
#             WHERE po.docstatus = 1 
#             AND po.status NOT IN ('Closed', 'Cancelled', 'Completed')
#             AND poi.sales_order = %(sales_order)s 
#             AND poi.{field} = %(item_code)s
#         """.format(field=item_code_field), {
#             'sales_order': so_item.sales_order, 
#             'item_code': so_item.item_code
#         })
        
#         # Safe extraction of SQL results
#         ordered_on_pos = flt(po_stats[0][0]) if po_stats and po_stats[0][0] else 0.0
#         received_on_pos = flt(po_stats[0][1]) if po_stats and po_stats[0][1] else 0.0
#         incoming_po_names = po_stats[0][2] if po_stats and po_stats[0][2] else ""

#         # --- B. PICK LIST RESERVATIONS (Display Only) ---
#         # Pick List Submitted (Processed/Picked)
#         pl_picked_qty = flt(frappe.db.sql("""
#             SELECT SUM(pli.picked_qty) FROM `tabPick List Item` pli 
#             JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 1 
#             AND pl.status NOT IN ('Completed', 'Cancelled')
#         """, (so_item.sales_order, so_item.item_code))[0][0])
        
#         # Pick List Draft (Waiting to be picked)
#         pl_yet_to_pick_qty = flt(frappe.db.sql("""
#             SELECT SUM(pli.qty) FROM `tabPick List Item` pli 
#             JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 0
#         """, (so_item.sales_order, so_item.item_code))[0][0])
        
#         total_pl_committed = pl_picked_qty + pl_yet_to_pick_qty

#         # --- C. CALCULATION LOGIC ---
        
#         # 1. Net Required Qty (SO Qty - Delivered)
#         qty_net_required = so_item.qty - so_item.delivered_qty
        
#         # 2. Calculate Pending Purchase based strictly on External Demand
#         # Logic: We need 10. We have ordered 5 from Vendor. We need to buy 5 more.
#         # (We do NOT subtract the Pick List quantity from the procurement suggestion, 
#         # as requested, to keep the 'need' aligned with the PO shortage).
#         qty_pending_purchase = qty_net_required - ordered_on_pos

#         # Only add to list if there is a pending delivery requirement (Qty > 0.001)
#         if qty_net_required > 0.001:
            
#             # --- D. POPULATE RESPONSE OBJECT ---
#             so_item['pending_qty'] = max(0, flt(qty_pending_purchase)) 
            
#             # PO Data
#             so_item['incoming_po_qty'] = ordered_on_pos  
#             so_item['received_po_qty'] = received_on_pos
#             so_item['incoming_po_names'] = incoming_po_names
            
#             # Pick List Data
#             so_item['pl_picked_qty'] = pl_picked_qty
#             so_item['pl_yet_to_pick_qty'] = pl_yet_to_pick_qty
#             so_item['fg_reserved_for_so_qty'] = total_pl_committed

#             final_pending_orders.append(so_item)

#     if not final_pending_orders:
#         return {}

#     # --- 3. Build Global Item Summary (For the top table) ---
#     item_summary_dict = defaultdict(lambda: {"total_qty": 0, "order_count": 0, "boms": set(), "item_name": ""})
    
#     for so in final_pending_orders:
#         item_code = so.item_code
#         item_summary_dict[item_code]["total_qty"] += so.pending_qty 
#         item_summary_dict[item_code]["order_count"] += 1
#         item_summary_dict[item_code]["item_name"] = so.item_name
#         if so.bom: item_summary_dict[item_code]["boms"].add(so.bom)
    
#     item_summary = []
#     for item_code, data in item_summary_dict.items():
        
#         # Fetch Real Stock (Actual in Bins)
#         fg_actual = flt(frappe.db.sql("SELECT SUM(actual_qty) FROM `tabBin` WHERE item_code = %s", item_code)[0][0] or 0)
        
#         # Fetch Reserved Stock (Stock Reservation Entry)
#         total_reserved = flt(frappe.db.sql("SELECT SUM(reserved_qty) FROM `tabStock Reservation Entry` WHERE item_code = %s AND docstatus = 1", item_code)[0][0] or 0)
        
#         fg_available = fg_actual - total_reserved
        
#         # Fetch Aggregate Pick List Info
#         picked_stats = frappe.db.sql("""
#             SELECT 
#                 (SELECT SUM(pli.picked_qty) FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent WHERE pli.item_code = %(ic)s AND pl.docstatus = 1 AND pl.status != 'Completed'),
#                 (SELECT SUM(pli.qty) FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent WHERE pli.item_code = %(ic)s AND pl.docstatus = 0)
#         """, {'ic': item_code})
        
#         total_picked_submitted = flt(picked_stats[0][0]) if picked_stats and picked_stats[0][0] else 0.0
#         total_picked_draft = flt(picked_stats[0][1]) if picked_stats and picked_stats[0][1] else 0.0

#         # Try to fetch raw materials (Subcontracting logic) if function exists
#         materials = [] 
#         bom = next(iter(data["boms"]), None)
#         try:
#              # Assuming 'get_bom_stock_details' is a helper available in the same module scope or needs to be ignored
#              if "get_bom_stock_details" in globals() and bom:
#                  materials = get_bom_stock_details(bom, data["total_qty"])
#         except Exception:
#             pass # Skip material breakdown if helper not found

#         item_summary.append({
#             "item_code": item_code, 
#             "item_name": data["item_name"],
            
#             "fg_total_stock": fg_actual, 
#             "fg_available_qty": fg_available, 
#             "fg_picked_submitted": total_picked_submitted,
#             "fg_picked_draft": total_picked_draft,
            
#             "total_pending_qty": data["total_qty"], 
#             "order_count": data["order_count"],
#             "total_reserved_qty": total_reserved, 
#             "raw_materials": materials
#         })

#     # --- 4. Propagate Summary Status back to individual rows for detailed display ---
#     for so_item in final_pending_orders:
#         summary = next(i for i in item_summary if i['item_code'] == so_item.item_code)
#         so_item['fg_total_stock'] = summary['fg_total_stock']
#         so_item['fg_total_reserved_qty'] = summary['total_reserved_qty']
#         so_item['fg_available_qty'] = summary['fg_available_qty'] 
#         so_item['fg_picked_submitted'] = summary['fg_picked_submitted']
#         so_item['fg_picked_draft'] = summary['fg_picked_draft']

#     return {
#         "item_summary": sorted(item_summary, key=lambda x: x['total_pending_qty'], reverse=True),
#         "sales_orders": final_pending_orders
#     }





# import frappe
# from frappe import _
# from frappe.utils import flt, cint
# from collections import defaultdict

# @frappe.whitelist()
# def get_pending_so_with_material_stock(is_subcontracted=False):
#     """
#     Fetches Sales Orders with pending delivery items.
#     Calculates Procurement Need based on:
#     Need = (SO Qty - Delivered) - (Linked POs) - (Effective Stock Picked)
#     """
#     is_subcontracted = cint(is_subcontracted)
#     item_code_field = "fg_item" if is_subcontracted else "item_code"
    
#     # Filter conditions (Check BOM if Subcontracted)
#     condition = "AND soi.bom_no IS NOT NULL AND soi.bom_no != ''" if is_subcontracted else "AND (soi.bom_no IS NULL OR soi.bom_no = '')"

#     # 1. Base Query: Get Open Sales Order Items
#     pending_orders_raw = frappe.db.sql(f"""
#         SELECT
#             soi.name AS so_item_name, 
#             soi.parent AS sales_order, 
#             so.customer AS customer,
#             soi.item_code, 
#             soi.item_name, 
#             soi.qty, 
#             soi.bom_no AS bom,
#             soi.delivered_qty
#         FROM `tabSales Order Item` AS soi 
#         JOIN `tabSales Order` AS so ON so.name = soi.parent
#         WHERE so.docstatus = 1 
#         AND so.status NOT IN ('On Hold', 'Completed', 'Cancelled', 'Closed')
#         AND soi.qty > soi.delivered_qty {condition}
#         ORDER BY so.transaction_date ASC, soi.item_code ASC
#     """, as_dict=True)

#     if not pending_orders_raw:
#         return {}

#     final_pending_orders = []

#     # 2. Iterate Row-by-Row to calculate specific status
#     for so_item in pending_orders_raw:
        
#         # --- A. INCOMING PURCHASE ORDERS (SUPPLY) ---
#         # We need to know:
#         # 1. Total Ordered (Covers the requirement)
#         # 2. Total Received (Used to offset 'Pick List' counts to avoid double counting)
#         po_stats = frappe.db.sql("""
#             SELECT 
#                 SUM(poi.qty), 
#                 SUM(poi.received_qty),
#                 GROUP_CONCAT(DISTINCT po.name SEPARATOR ', ')
#             FROM `tabPurchase Order Item` AS poi
#             JOIN `tabPurchase Order` AS po ON po.name = poi.parent
#             WHERE po.docstatus = 1 
#             AND po.status NOT IN ('Closed', 'Cancelled', 'Completed')
#             AND poi.sales_order = %(sales_order)s 
#             AND poi.{field} = %(item_code)s
#         """.format(field=item_code_field), {
#             'sales_order': so_item.sales_order, 
#             'item_code': so_item.item_code
#         })
        
#         ordered_on_pos = flt(po_stats[0][0]) if po_stats and po_stats[0][0] else 0.0
#         received_on_pos = flt(po_stats[0][1]) if po_stats and po_stats[0][1] else 0.0
#         incoming_po_names = po_stats[0][2] if po_stats and po_stats[0][2] else ""

#         # --- B. STOCK RESERVATIONS (PICK LISTS) ---
#         # 1. Submitted Pick Lists (Physically picked or segregated)
#         pl_picked_qty = flt(frappe.db.sql("""
#             SELECT SUM(pli.picked_qty) FROM `tabPick List Item` pli 
#             JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 1 
#             AND pl.status NOT IN ('Completed', 'Cancelled')
#         """, (so_item.sales_order, so_item.item_code))[0][0])
        
#         # 2. Draft Pick Lists (Intention to pick)
#         pl_yet_to_pick_qty = flt(frappe.db.sql("""
#             SELECT SUM(pli.qty) FROM `tabPick List Item` pli 
#             JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 0
#         """, (so_item.sales_order, so_item.item_code))[0][0])
        
#         total_pl_committed = pl_picked_qty + pl_yet_to_pick_qty

#         # --- C. CALCULATION LOGIC (FIX FOR 10 vs 7) ---
        
#         qty_left_to_deliver = so_item.qty - so_item.delivered_qty
        
#         # Step C1: Calculate "Shelf Stock Used"
#         # Logic: If we ordered 5 on a PO and received 5, those 5 are now in stock.
#         # If we pick 3, it's likely from those 5. We shouldn't deduct 5 (PO) AND 3 (Pick).
#         # "Extra" stock used is: Total Picked - Received from Linked POs.
#         picked_from_shelf_stock = max(0, total_pl_committed - received_on_pos)
        
#         # Step C2: Total Coverage
#         # Coverage = External Supply (Ordered PO) + Internal Supply (Existing Shelf Stock)
#         deductible_coverage = ordered_on_pos + picked_from_shelf_stock
        
#         # Step C3: Pending Purchase
#         # If Req=10, PO=0, Pick=3. Shelf=3. Deduct=3. Result=7. (CORRECT)
#         qty_pending_purchase = qty_left_to_deliver - deductible_coverage

#         # --- D. APPEND RESULT ---
#         if qty_left_to_deliver > 0.001:
            
#             so_item['pending_qty'] = max(0, flt(qty_pending_purchase)) 
            
#             # Additional Context for UI
#             so_item['incoming_po_qty'] = ordered_on_pos  
#             so_item['received_po_qty'] = received_on_pos
#             so_item['incoming_po_names'] = incoming_po_names
            
#             so_item['pl_picked_qty'] = pl_picked_qty
#             so_item['pl_yet_to_pick_qty'] = pl_yet_to_pick_qty
#             so_item['fg_reserved_for_so_qty'] = total_pl_committed

#             final_pending_orders.append(so_item)

#     if not final_pending_orders:
#         return {}

#     # 3. Calculate Item Summaries (Top Table Aggregates)
#     item_summary_dict = defaultdict(lambda: {"total_qty": 0, "order_count": 0, "boms": set(), "item_name": ""})
    
#     for so in final_pending_orders:
#         item_code = so.item_code
#         item_summary_dict[item_code]["total_qty"] += so.pending_qty 
#         item_summary_dict[item_code]["order_count"] += 1
#         item_summary_dict[item_code]["item_name"] = so.item_name
#         if so.bom: item_summary_dict[item_code]["boms"].add(so.bom)
    
#     item_summary = []
#     for item_code, data in item_summary_dict.items():
        
#         # Global Stock Check
#         fg_actual = flt(frappe.db.sql("SELECT SUM(actual_qty) FROM `tabBin` WHERE item_code = %s", item_code)[0][0] or 0)
        
#         # Global Reservation Check (SRE)
#         total_reserved = flt(frappe.db.sql("SELECT SUM(reserved_qty) FROM `tabStock Reservation Entry` WHERE item_code = %s AND docstatus = 1", item_code)[0][0] or 0)
        
#         fg_available = fg_actual - total_reserved
        
#         # Global Pick Stats (For Display)
#         picked_stats = frappe.db.sql("""
#             SELECT 
#                 (SELECT SUM(pli.picked_qty) FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent WHERE pli.item_code = %(ic)s AND pl.docstatus = 1 AND pl.status != 'Completed'),
#                 (SELECT SUM(pli.qty) FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent WHERE pli.item_code = %(ic)s AND pl.docstatus = 0)
#         """, {'ic': item_code})
        
#         total_picked_submitted = flt(picked_stats[0][0]) if picked_stats and picked_stats[0][0] else 0.0
#         total_picked_draft = flt(picked_stats[0][1]) if picked_stats and picked_stats[0][1] else 0.0
        
#         # Raw Material Details (Optional Helper)
#         materials = [] 
#         bom = next(iter(data["boms"]), None)
#         try:
#              # Dynamically call BOM helper if available in system
#              if "get_bom_stock_details" in globals() and bom:
#                  materials = get_bom_stock_details(bom, data["total_qty"])
#         except Exception:
#             pass

#         item_summary.append({
#             "item_code": item_code, 
#             "item_name": data["item_name"],
            
#             "fg_total_stock": fg_actual, 
#             "fg_available_qty": fg_available, 
#             "fg_picked_submitted": total_picked_submitted,
#             "fg_picked_draft": total_picked_draft,
            
#             "total_pending_qty": data["total_qty"], 
#             "order_count": data["order_count"],
#             "total_reserved_qty": total_reserved, 
#             "raw_materials": materials
#         })

#     # 4. Attach Summaries back to Rows for Frontend
#     for so_item in final_pending_orders:
#         summary = next(i for i in item_summary if i['item_code'] == so_item.item_code)
#         so_item['fg_total_stock'] = summary['fg_total_stock']
#         so_item['fg_total_reserved_qty'] = summary['total_reserved_qty']
#         so_item['fg_available_qty'] = summary['fg_available_qty'] 
#         so_item['fg_picked_submitted'] = summary['fg_picked_submitted']
#         so_item['fg_picked_draft'] = summary['fg_picked_draft']

#     return {
#         "item_summary": sorted(item_summary, key=lambda x: x['total_pending_qty'], reverse=True),
#         "sales_orders": final_pending_orders
#     }



# import frappe
# from frappe.utils import flt, cint
# from collections import defaultdict

# @frappe.whitelist()
# def get_pending_so_with_material_stock(is_subcontracted=False):
#     is_subcontracted = cint(is_subcontracted)
#     join_field = "fg_item" if is_subcontracted else "item_code"
#     condition = "AND soi.bom_no IS NOT NULL AND soi.bom_no != ''" if is_subcontracted else "AND (soi.bom_no IS NULL OR soi.bom_no = '')"

#     # --- 1. Fetch Sales Order Lines ---
#     pending_orders = frappe.db.sql(f"""
#         SELECT
#             soi.name as so_row_name, soi.parent AS sales_order, so.customer, 
#             so.sales_partner AS jobber_name, soi.item_code, soi.item_name, 
#             soi.qty, soi.delivered_qty, soi.bom_no AS bom
#         FROM `tabSales Order Item` soi 
#         JOIN `tabSales Order` so ON so.name = soi.parent
#         WHERE so.docstatus = 1 AND so.status NOT IN ('On Hold', 'Completed', 'Cancelled', 'Closed')
#         AND soi.qty > soi.delivered_qty {condition}
#         ORDER BY so.transaction_date ASC, soi.item_code ASC
#     """, as_dict=True)

#     if not pending_orders: return {}

#     items = list(set(d.item_code for d in pending_orders))
#     item_summaries = defaultdict(lambda: {"draft_picks": 0, "sub_picks": 0, "qty_need": 0, "count": 0, "item_name": ""})

#     # --- 2. Global Inventory and All POs ---
#     po_data = frappe.db.sql(f"""
#         SELECT poi.parent as po_name, po.supplier, poi.sales_order, poi.qty, poi.{join_field} as item_code
#         FROM `tabPurchase Order Item` poi JOIN `tabPurchase Order` po ON po.name = poi.parent
#         WHERE poi.{join_field} IN %(items)s AND po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled', 'Completed')
#     """, {"items": items}, as_dict=True)

#     final_rows = []
#     # Allocation tracker to avoid double-deduction on multi-line SOs
#     so_linked_po_tracker = defaultdict(float)

#     for row in pending_orders:
#         it, so = row.item_code, row.sales_order
#         req = flt(row.qty) - flt(row.delivered_qty)
        
#         # --- A. PICK LISTS (This SO + Item) ---
#         picks = frappe.db.sql("""
#             SELECT SUM(pli.qty) as q, pl.docstatus 
#             FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.sales_order=%s AND pli.item_code=%s AND pl.docstatus != 2
#             GROUP BY pl.docstatus
#         """, (so, it), as_dict=True)
        
#         row["pick_draft"] = sum(p.q for p in picks if p.docstatus == 0)
#         row["pick_sub"] = sum(p.q for p in picks if p.docstatus == 1)

#         # --- B. INCOMING POs ---
#         # 1. Linked to THIS SO
#         this_so_pos = [p for p in po_data if p.item_code == it and p.sales_order == so]
#         total_so_linked = sum(flt(p.qty) for p in this_so_pos)
        
#         used_already = so_linked_po_tracker[(so, it)]
#         avail_linked = max(0, total_so_linked - used_already)
#         allocated = min(req, avail_linked)
#         so_linked_po_tracker[(so, it)] += allocated
        
#         row["linked_po_qty"] = allocated
#         row["linked_po_details"] = [{"id": p.po_name, "sup": p.supplier, "qty": p.qty} for p in this_so_pos]

#         # 2. Other POs
#         others = [p for p in po_data if p.item_code == it and p.sales_order != so]
#         row["other_po_qty"] = sum(flt(p.qty) for p in others)
#         row["other_po_list"] = [{"id": p.po_name, "sup": p.supplier, "qty": p.qty} for p in others]

#         # --- C. TOP TABLE DATA AGGREGATION ---
#         # Overall Draft/Sub picks for this ITEM (across ALL sales orders)
#         global_picks = frappe.db.sql("""
#             SELECT SUM(pli.qty) as q, pl.docstatus 
#             FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.item_code=%s AND pl.docstatus != 2
#             GROUP BY pl.docstatus
#         """, (it), as_dict=True)
        
#         summ = item_summaries[it]
#         summ["draft_picks"] = sum(p.q for p in global_picks if p.docstatus == 0)
#         summ["sub_picks"] = sum(p.q for p in global_picks if p.docstatus == 1)
#         summ["item_name"] = row.item_name
#         summ["qty_need"] += max(0, req - allocated - row["pick_sub"])
#         summ["count"] += 1
        
#         final_rows.append(row)

#     # Convert summaries to list
#     summ_list = []
#     for code, data in item_summaries.items():
#         avail = flt(frappe.db.get_value("Bin", {"item_code": code}, "actual_qty"))
#         summ_list.append({
#             "item_code": code, "item_name": data["item_name"], "total_need": data["qty_need"],
#             "avail": avail, "draft_picks": data["draft_picks"], "sub_picks": data["sub_picks"],
#             "so_count": data["count"]
#         })

#     return {
#         "item_summary": sorted(summ_list, key=lambda x: x['total_need'], reverse=True),
#         "sales_orders": final_rows
#     }


import frappe
from frappe.utils import flt, cint
from collections import defaultdict

@frappe.whitelist()
def get_pending_so_with_material_stock(is_subcontracted=False):
    is_subcontracted = cint(is_subcontracted)
    join_field = "fg_item" if is_subcontracted else "item_code"
    condition = "AND soi.bom_no IS NOT NULL AND soi.bom_no != ''" if is_subcontracted else "AND (soi.bom_no IS NULL OR soi.bom_no = '')"

    # --- 1. Fetch Sales Order Lines ---
    pending_orders = frappe.db.sql(f"""
        SELECT
            soi.name as so_row_name, soi.parent AS sales_order, so.customer, 
            so.sales_partner AS jobber_name, soi.item_code, soi.item_name, 
            soi.qty, soi.delivered_qty, soi.bom_no AS bom
        FROM `tabSales Order Item` soi 
        JOIN `tabSales Order` so ON so.name = soi.parent
        WHERE so.docstatus = 1 AND so.status NOT IN ('On Hold', 'Completed', 'Cancelled', 'Closed')
        AND soi.qty > soi.delivered_qty {condition}
        ORDER BY so.transaction_date ASC, soi.item_code ASC, soi.idx ASC
    """, as_dict=True)

    if not pending_orders: return {}

    items = list(set(d.item_code for d in pending_orders))
    
    # --- 2. Global Inventory and All POs ---
    po_data = frappe.db.sql(f"""
        SELECT poi.parent as po_name, po.supplier, poi.sales_order, poi.qty, poi.{join_field} as item_code
        FROM `tabPurchase Order Item` poi JOIN `tabPurchase Order` po ON po.name = poi.parent
        WHERE poi.{join_field} IN %(items)s AND po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled', 'Completed')
    """, {"items": items}, as_dict=True)

    # --- 3. FETCH ALL PICK LIST DATA IN ONE GO ---
    # We get totals per Sales Order and Item to manage the "Allocation Bank"
    pick_data_raw = frappe.db.sql("""
        SELECT pli.sales_order, pli.item_code, SUM(pli.qty) as total_qty, pl.docstatus 
        FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent
        WHERE pli.item_code IN %s AND pl.docstatus != 2
        GROUP BY pli.sales_order, pli.item_code, pl.docstatus
    """, (items,), as_dict=True)

    # Convert Pick Data to a manageable dictionary: {(so, item, docstatus): qty}
    pick_bank = defaultdict(float)
    for p in pick_data_raw:
        pick_bank[(p.sales_order, p.item_code, p.docstatus)] = flt(p.total_qty)

    final_rows = []
    
    # Trackers to avoid double-deduction on multiple rows of same item in same SO
    so_linked_po_tracker = defaultdict(float)
    so_pick_sub_tracker = defaultdict(float)
    so_pick_draft_tracker = defaultdict(float)

    for row in pending_orders:
        it, so = row.item_code, row.sales_order
        req = flt(row.qty) - flt(row.delivered_qty)
        
        # --- A. DISTRIBUTE SUBMITTED PICKS (DOCSTATUS 1) ---
        total_sub_avail = pick_bank.get((so, it, 1), 0.0)
        already_used_sub = so_pick_sub_tracker[(so, it)]
        
        pick_sub_for_this_row = min(req, max(0, total_sub_avail - already_used_sub))
        row["pick_sub"] = pick_sub_for_this_row
        so_pick_sub_tracker[(so, it)] += pick_sub_for_this_row

        # --- B. DISTRIBUTE DRAFT PICKS (DOCSTATUS 0) ---
        # Note: We reduce need first by pick_sub before checking draft coverage
        rem_after_sub = max(0, req - pick_sub_for_this_row)
        total_draft_avail = pick_bank.get((so, it, 0), 0.0)
        already_used_draft = so_pick_draft_tracker[(so, it)]
        
        pick_draft_for_this_row = min(rem_after_sub, max(0, total_draft_avail - already_used_draft))
        row["pick_draft"] = pick_draft_for_this_row
        so_pick_draft_tracker[(so, it)] += pick_draft_for_this_row
        rem_after_all_picks = max(0, req - pick_sub_for_this_row - pick_draft_for_this_row)
        # --- C. DISTRIBUTE LINKED POs ---
        rem_after_picks = max(0, req - pick_sub_for_this_row)
        this_so_pos = [p for p in po_data if p.item_code == it and p.sales_order == so]
        total_so_linked = sum(flt(p.qty) for p in this_so_pos)
        
        used_po_already = so_linked_po_tracker[(so, it)]
        avail_linked_po = max(0, total_so_linked - used_po_already)
        allocated_po = min(rem_after_all_picks, avail_linked_po)
        
        so_linked_po_tracker[(so, it)] += allocated_po
        row["linked_po_qty"] = allocated_po
        row["linked_po_details"] = [{"id": p.po_name, "sup": p.supplier, "qty": p.qty} for p in this_so_pos]

        # D. Other Global PO Info (for display only, not row math)
        others = [p for p in po_data if p.item_code == it and p.sales_order != so]
        row["other_po_qty"] = sum(flt(p.qty) for p in others)
        row["other_po_list"] = [{"id": p.po_name, "sup": p.supplier, "qty": p.qty} for p in others]

        final_rows.append(row)

    # --- 4. ITEM SUMMARY (GLOBAL) ---
    item_summaries = defaultdict(lambda: {"qty_need": 0, "item_name": ""})
    for r in final_rows:
        it = r.item_code
        item_summaries[it]["item_name"] = r.item_name
        # Need = Req - Picked(Sub) - LinkedPO
        item_summaries[it]["qty_need"] += max(0, (flt(r.qty) - flt(r.delivered_qty)) - r.pick_sub - r.linked_po_qty)

    summ_list = []
    for it, data in item_summaries.items():
        avail = flt(frappe.db.get_value("Bin", {"item_code": it}, "actual_qty"))
        global_picks = frappe.db.sql("""
            SELECT SUM(pli.qty) as q, pl.docstatus 
            FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent
            WHERE pli.item_code=%s AND pl.docstatus != 2
            GROUP BY pl.docstatus
        """, (it), as_dict=True)
        
        summ_list.append({
            "item_code": it, "item_name": data["item_name"], "total_need": data["qty_need"], "avail": avail,
            "draft_picks": sum(p.q for p in global_picks if p.docstatus == 0),
            "sub_picks": sum(p.q for p in global_picks if p.docstatus == 1),
        })

    return {"item_summary": sorted(summ_list, key=lambda x: x['total_need'], reverse=True), "sales_orders": final_rows}

# import frappe
# from frappe import _
# from frappe.utils import flt, cint
# from collections import defaultdict

# @frappe.whitelist()
# def get_pending_so_with_material_stock(is_subcontracted=False):
#     """
#     Fetches pending Sales Order items, calculates stock and procurement status,
#     and correctly handles cases where the same FG item appears in multiple rows
#     (with and without BOM) within the same Sales Order.
#     Key improvement: picked/committed qty and PO qty are aggregated PER SO ITEM ROW
#     (using sales_order_item reference), so each row is independent.
#     """
#     is_subcontracted = cint(is_subcontracted)
#     item_code_field = "fg_item" if is_subcontracted else "item_code"
#     condition = "AND soi.bom_no IS NOT NULL AND soi.bom_no != ''" if is_subcontracted else "AND (soi.bom_no IS NULL OR soi.bom_no = '')"

#     # ── 1. Fetch all pending SO items ──
#     pending_orders_raw = frappe.db.sql(f"""
#         SELECT
#             soi.name AS so_item_name,
#             soi.parent AS sales_order,
#             so.customer AS customer,
#             soi.item_code,
#             soi.item_name,
#             soi.qty,
#             soi.bom_no AS bom,
#             soi.delivered_qty,
#             soi.warehouse
#         FROM `tabSales Order Item` soi
#         JOIN `tabSales Order` so ON so.name = soi.parent
#         WHERE so.docstatus = 1
#           AND so.status NOT IN ('On Hold', 'Completed', 'Cancelled')
#           AND soi.qty > soi.delivered_qty
#           {condition}
#         ORDER BY so.transaction_date ASC, soi.item_code ASC
#     """, as_dict=True)

#     if not pending_orders_raw:
#         return {"item_summary": [], "sales_orders": []}

#     # ── Prepare list for IN clause ──
#     so_item_names = [row['so_item_name'] for row in pending_orders_raw]
#     if not so_item_names:
#         return {"item_summary": [], "sales_orders": []}

#     placeholders = ', '.join(['%s'] * len(so_item_names))

#     # ── 2. Aggregate picked qty PER SO ITEM ROW ──
#     picked_sql = f"""
#         SELECT
#             pli.sales_order_item,
#             SUM(CASE WHEN pl.docstatus = 1 AND pl.status NOT IN ('Completed', 'Cancelled') THEN pli.picked_qty ELSE 0 END) AS pl_picked_qty,
#             SUM(CASE WHEN pl.docstatus = 0 THEN pli.qty ELSE 0 END) AS pl_yet_to_pick_qty
#         FROM `tabPick List Item` pli
#         JOIN `tabPick List` pl ON pl.name = pli.parent
#         WHERE pli.sales_order_item IN ({placeholders})
#         GROUP BY pli.sales_order_item
#     """
#     picked_qty_data = frappe.db.sql(picked_sql, so_item_names, as_dict=True)
#     picked_lookup = {row['sales_order_item']: row for row in picked_qty_data}

#     # ── 3. Aggregate existing PO qty PER SO ITEM ROW ──
#     po_sql = f"""
#         SELECT
#             poi.sales_order_item,
#             poi.{item_code_field} AS item_code,
#             SUM(poi.qty) AS ordered_qty,
#             SUM(poi.received_qty) AS received_qty,
#             GROUP_CONCAT(CONCAT(poi.parent, ' (Qty: ', poi.qty, ')') SEPARATOR ', ') AS po_info
#         FROM `tabPurchase Order Item` poi
#         JOIN `tabPurchase Order` po ON po.name = poi.parent
#         WHERE po.docstatus = 1
#           AND po.status NOT IN ('Closed', 'Cancelled', 'Completed')
#           AND poi.sales_order_item IN ({placeholders})
#         GROUP BY poi.sales_order_item
#     """.format(field=item_code_field)
#     po_qty_data = frappe.db.sql(po_sql, so_item_names, as_dict=True)
#     po_lookup = {row['sales_order_item']: row for row in po_qty_data}

#     # ── 4. Process rows — use per-row values ──
#     final_pending_orders = []
#     item_row_count = defaultdict(int)
#     for row in pending_orders_raw:
#         so_item = row['so_item_name']

#         # Per-row picked
#         picked = picked_lookup.get(so_item, {'pl_picked_qty': 0, 'pl_yet_to_pick_qty': 0})
#         total_pl_committed = flt(picked['pl_picked_qty']) + flt(picked['pl_yet_to_pick_qty'])

#         # Per-row PO
#         po = po_lookup.get(so_item, {'ordered_qty': 0, 'received_qty': 0, 'po_info': ''})

#         gross_pending = row['qty'] - row['delivered_qty'] - total_pl_committed
#         if gross_pending <= 0.001:
#             continue

#         net_pending_purchase = max(0, gross_pending - flt(po['ordered_qty']))

#         row.update({
#             'gross_pending_qty': flt(gross_pending),
#             'already_ordered_qty': flt(po['ordered_qty']),
#             'received_po_qty': flt(po.get('received_qty', 0)),
#             'incoming_po_qty': flt(po['ordered_qty']),  # for JS compatibility
#             'existing_pos_info': po['po_info'],
#             'pending_qty': flt(net_pending_purchase),
#             'pl_picked_qty': flt(picked['pl_picked_qty']),
#             'pl_yet_to_pick_qty': flt(picked['pl_yet_to_pick_qty']),
#             'total_pl_committed': total_pl_committed,
#             'fg_reserved_for_so_qty': total_pl_committed,
#             'fg_picked_submitted': flt(picked['pl_picked_qty']),
#             'fg_picked_draft': flt(picked['pl_yet_to_pick_qty'])
#         })
#         final_pending_orders.append(row)
#         item_row_count[row['item_code']] += 1

#     if not final_pending_orders:
#         return {"item_summary": [], "sales_orders": []}

#     # ── 5. Build item-level summary ──
#     item_summary_dict = defaultdict(lambda: {
#         "total_pending_qty": 0,
#         "order_count": 0,
#         "item_name": "",
#         "boms": set(),
#         "multiple_rows": False
#     })
#     for row in final_pending_orders:
#         item = row['item_code']
#         item_summary_dict[item]["total_pending_qty"] += row['pending_qty']
#         item_summary_dict[item]["order_count"] += 1
#         item_summary_dict[item]["item_name"] = row['item_name']
#         if row.get('bom'):
#             item_summary_dict[item]["boms"].add(row['bom'])
#         if item_row_count[item] > 1:
#             item_summary_dict[item]["multiple_rows"] = True

#     item_summary = []
#     for item_code, data in item_summary_dict.items():
#         fg_actual = flt(frappe.db.sql(
#             "SELECT SUM(actual_qty) FROM `tabBin` WHERE item_code = %s",
#             item_code
#         )[0][0] or 0)
#         total_reserved = flt(frappe.db.sql(
#             "SELECT SUM(reserved_qty) FROM `tabStock Reservation Entry` WHERE item_code = %s AND docstatus = 1",
#             item_code
#         )[0][0] or 0)
#         fg_available = fg_actual - total_reserved

#         total_picked_submitted = flt(frappe.db.sql("""
#             SELECT SUM(pli.picked_qty)
#             FROM `tabPick List Item` pli
#             JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.item_code = %s
#               AND pl.docstatus = 1
#               AND pl.status NOT IN ('Completed', 'Cancelled')
#         """, item_code)[0][0] or 0)
#         total_picked_draft = flt(frappe.db.sql("""
#             SELECT SUM(pli.qty)
#             FROM `tabPick List Item` pli
#             JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.item_code = %s
#               AND pl.docstatus = 0
#         """, item_code)[0][0] or 0)

#         item_summary.append({
#             "item_code": item_code,
#             "item_name": data["item_name"],
#             "fg_total_stock": fg_actual,
#             "fg_available_qty": fg_available,
#             "fg_picked_submitted": total_picked_submitted,
#             "fg_picked_draft": total_picked_draft,
#             "total_pending_qty": data["total_pending_qty"],
#             "order_count": data["order_count"],
#             "total_reserved_qty": total_reserved,
#             "raw_materials": [],
#             "multiple_rows_indication": " (Multiple rows in SO)" if data["multiple_rows"] else ""
#         })

#     return {
#         "item_summary": sorted(item_summary, key=lambda x: x['total_pending_qty'], reverse=True),
#         "sales_orders": final_pending_orders
#     }




def get_item_details_for_po(item_code):
    if not item_code: return {}
    details = frappe.db.get_value("Item", item_code, ["purchase_uom", "stock_uom", "description", "item_name"], as_dict=True)
    if not details: return {}
    uom = details.purchase_uom or details.stock_uom
    factor = frappe.db.get_value("UOM Conversion Detail", {"parent": item_code, "uom": uom}, "conversion_factor") or 1.0
    return {"uom": uom, "stock_uom": details.stock_uom, "description": details.description, "item_name": details.item_name, "conversion_factor": factor}


def _get_bom_stock_details(bom, fg_qty):
    if not bom or fg_qty <= 0:
        return []
    
    raw_materials_req = defaultdict(float)
    raw_materials_details = {}
    
    bom_items = frappe.get_all("BOM Item", filters={"parent": bom}, fields=["item_code", "item_name", "stock_uom", "stock_qty"])
    
    for bom_item in bom_items:
        required = flt(bom_item.stock_qty) * fg_qty
        raw_materials_req[bom_item.item_code] += required
        if bom_item.item_code not in raw_materials_details:
            raw_materials_details[bom_item.item_code] = {'item_name': bom_item.item_name, 'stock_uom': bom_item.stock_uom}
    
    materials = []
    item_codes = list(raw_materials_req.keys())
    if not item_codes:
        return []

    stock_data = frappe.get_all("Bin", filters={'item_code': ['in', item_codes]}, 
                               fields=['item_code', 'actual_qty'])
    
    item_stock_map = {d.item_code: d.actual_qty for d in stock_data}
    
    for rm_code, required_qty in raw_materials_req.items():
        details = raw_materials_details.get(rm_code, {})
        actual_qty = flt(item_stock_map.get(rm_code, 0))
        # Note: 'available_qty' for raw materials is simplified here. 
        # A full system-wide reservation check could be more complex.
        # This provides a good snapshot based on physical stock.
        materials.append({
            'item_code': rm_code, 'item_name': details.get('item_name', ''),
            'required_qty': required_qty, 'available_qty': actual_qty,
            'actual_qty': actual_qty, 'stock_uom': details.get('stock_uom', '')
        })
    return materials





import frappe
import json
from frappe import _
from frappe.utils import flt, getdate

# @frappe.whitelist()
# def get_pending_so_with_raw_materials_summary():
#     """
#     MODIFIED V8.1 (CORRECTED & FINAL):
#     - This is the full, unabbreviated version of the script.
#     - All SQL queries are complete, resolving the TypeError from the traceback.
#     - Contains all features: FG "In-Production" calculation, BOM-only SO item filtering,
#       and advanced raw material availability logic.
#     """
#     pending_sos = []
#     company = frappe.defaults.get_user_default("Company") or frappe.get_doc("Global Defaults").default_company

#     # Step 1: Get pending Sales Order Items that have a BOM.
#     so_items = frappe.db.sql("""
#         SELECT
#             si.parent as sales_order, si.item_code, si.item_name, si.qty,
#             COALESCE(si.delivered_qty, 0) as delivered_qty,
#             (si.qty - COALESCE(si.delivered_qty, 0)) as pending_qty,
#             so.customer, si.bom_no as bom, si.uom
#         FROM `tabSales Order Item` si JOIN `tabSales Order` so ON si.parent = so.name
#         WHERE so.docstatus = 1 AND so.status NOT IN ('Closed', 'Cancelled', 'On Hold')
#           AND (si.qty - COALESCE(si.delivered_qty, 0)) > 0.001
#           AND si.bom_no IS NOT NULL AND si.bom_no != ''
#         ORDER BY so.transaction_date DESC, so.name
#     """, as_dict=1)

#     if not so_items:
#         return {"sales_orders": []}

#     # Step 2: Collect all unique item codes and BOMs.
#     all_bom_item_codes = set()
#     all_finished_good_codes = {item['item_code'] for item in so_items}
#     boms_to_fetch = {item['bom'] for item in so_items}

#     all_bom_items = {}
#     if boms_to_fetch:
#         db_bom_items = frappe.get_all("BOM Item", filters={"parent": ("in", list(boms_to_fetch))}, fields=["parent", "item_code", "item_name", "stock_uom", "stock_qty"])
#         for bom_item in db_bom_items:
#             all_bom_items.setdefault(bom_item.parent, []).append(bom_item)
#             all_bom_item_codes.add(bom_item.item_code)

#     stock_info = {}
#     unallocated_ordered_map = {}
#     so_rm_ordered_map = {}
#     existing_pos_map = {}
#     in_production_fg_map = {}

#     # Step 3: Get physical stock for ALL items (RMs and FGs).
#     all_items_to_check = tuple(all_bom_item_codes.union(all_finished_good_codes))
#     if all_items_to_check:
#         bin_data = frappe.db.sql("""
#             SELECT b.item_code, SUM(COALESCE(b.actual_qty, 0) - COALESCE(b.reserved_qty, 0)) as available_qty
#             FROM `tabBin` b JOIN `tabWarehouse` w ON b.warehouse = w.name
#             WHERE b.item_code IN %s AND w.company = %s GROUP BY b.item_code
#         """, (all_items_to_check, company), as_dict=True)
#         stock_info = {row['item_code']: max(0, row.get('available_qty', 0)) for row in bin_data}

#     # Step 4: Calculate "In-Production" quantity for Finished Goods.
#     if all_finished_good_codes:
#         fg_codes = tuple(all_finished_good_codes)
#         in_production_data = frappe.db.sql("""
#             SELECT fg_item, SUM(fg_qty) as total_in_production FROM (
#                 SELECT DISTINCT rmb.source_finished_good as fg_item, rmb.order_for_fg as fg_qty,
#                                 rmb.parent, rmb.source_sales_order
#                 FROM `tabPurchase Order Raw Material Source` rmb
#                 JOIN `tabPurchase Order` po ON rmb.parent = po.name
#                 WHERE po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled')
#                   AND rmb.source_finished_good IN %s
#             ) as distinct_production_runs
#             GROUP BY fg_item
#         """, (fg_codes,), as_dict=1)
#         in_production_fg_map = {row['fg_item']: row['total_in_production'] for row in in_production_data}

#     # Step 5: Get all PO-related data for Raw Materials.
#     if all_bom_item_codes:
#         rm_item_codes = tuple(all_bom_item_codes)
        
#         total_ordered_items = frappe.db.sql("""
#             SELECT poi.item_code, SUM(poi.qty - COALESCE(poi.received_qty, 0)) AS total_ordered
#             FROM `tabPurchase Order Item` poi JOIN `tabPurchase Order` po ON poi.parent = po.name
#             WHERE poi.item_code IN %s AND po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled') AND po.company = %s
#             GROUP BY poi.item_code
#         """, (rm_item_codes, company), as_dict=True)
#         total_ordered_map = {row['item_code']: flt(row.get('total_ordered', 0)) for row in total_ordered_items}

#         linked_quantities = frappe.db.sql("""
#             SELECT rmb.raw_material_item, SUM(rmb.order_for_rm) as total_linked_qty
#             FROM `tabPurchase Order Raw Material Source` rmb JOIN `tabPurchase Order` po ON rmb.parent = po.name
#             WHERE rmb.raw_material_item IN %s AND po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled') AND po.company = %s
#             GROUP BY rmb.raw_material_item
#         """, (rm_item_codes, company), as_dict=1)
#         linked_map = {item['raw_material_item']: item['total_linked_qty'] for item in linked_quantities}

#         for item_code, total_ordered in total_ordered_map.items():
#             unallocated_ordered_map[item_code] = max(0, total_ordered - linked_map.get(item_code, 0))

#         sales_order_names = tuple(so['sales_order'] for so in so_items)
#         if sales_order_names:
#             so_rm_links = frappe.db.sql("""
#                 SELECT rmb.source_sales_order, rmb.raw_material_item, SUM(rmb.order_for_rm) as ordered_qty
#                 FROM `tabPurchase Order Raw Material Source` rmb JOIN `tabPurchase Order` po ON rmb.parent = po.name
#                 WHERE rmb.source_sales_order IN %s AND po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled')
#                 GROUP BY rmb.source_sales_order, rmb.raw_material_item
#             """, (sales_order_names,), as_dict=1)
#             so_rm_ordered_map = {(link['source_sales_order'], link['raw_material_item']): link['ordered_qty'] for link in so_rm_links}

#         pos_data = frappe.db.sql("""
#             SELECT po.name, po.supplier, poi.item_code FROM `tabPurchase Order Item` poi
#             JOIN `tabPurchase Order` po ON poi.parent = po.name
#             WHERE poi.item_code IN %s AND po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled') AND po.company = %s
#         """, (rm_item_codes, company), as_dict=True)
#         for pos in pos_data:
#             po_link_text = f"{pos['name']} ({pos['supplier'] or 'N/A'})"
#             existing_pos_map.setdefault(pos['item_code'], []).append(po_link_text)

#     # Step 6: Process each SO item and package the final data for the UI.
#     for so_item in so_items:
#         sales_order, item_code = so_item['sales_order'], so_item['item_code']
        
#         picked_submitted_query = frappe.db.sql("""
#             SELECT COALESCE(SUM(pli.picked_qty), 0) as total FROM `tabPick List Item` pli
#             JOIN `tabPick List` pl ON pli.parent = pl.name
#             WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 1
#         """, (sales_order, item_code), as_dict=True)
#         picked_submitted = picked_submitted_query[0].get('total', 0) if picked_submitted_query else 0

#         picked_draft_query = frappe.db.sql("""
#             SELECT COALESCE(SUM(pli.qty), 0) as total FROM `tabPick List Item` pli
#             JOIN `tabPick List` pl ON pli.parent = pl.name
#             WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 0
#         """, (sales_order, item_code), as_dict=True)
#         picked_draft = picked_draft_query[0].get('total', 0) if picked_draft_query else 0
        
#         qty_awaiting_pick = max(0, so_item['pending_qty'] - picked_submitted - picked_draft)
        
#         if qty_awaiting_pick <= 0.001: 
#             continue
        
#         physical_stock = flt(stock_info.get(item_code, 0))
#         in_production_qty = flt(in_production_fg_map.get(item_code, 0))

#         so_item.update({
#             'picked_submitted': picked_submitted,
#             'picked_draft': picked_draft,
#             'qty_awaiting_pick': qty_awaiting_pick,
#             'available_fg_qty': physical_stock + in_production_qty
#         })

#         raw_materials = []
#         for bom_item in all_bom_items.get(so_item['bom'], []):
#             rm_code = bom_item['item_code']
#             raw_materials.append({
#                 "item_code": rm_code,
#                 "item_name": bom_item['item_name'],
#                 "uom": bom_item['stock_uom'],
#                 "base_stock_qty": flt(bom_item['stock_qty']),
#                 "available_qty": flt(stock_info.get(rm_code, 0)),
#                 "unallocated_ordered_qty": flt(unallocated_ordered_map.get(rm_code, 0)),
#                 "ordered_for_this_so": flt(so_rm_ordered_map.get((sales_order, rm_code), 0)),
#                 "existing_pos": ', '.join(existing_pos_map.get(rm_code, []))
#             })
        
#         so_item["raw_materials"] = raw_materials
#         pending_sos.append(so_item)
    
#     return {"sales_orders": pending_sos}

import frappe
from frappe.utils import flt, cint

@frappe.whitelist()
def get_pending_so_with_raw_materials_summary():
    company = frappe.defaults.get_user_default("Company") or frappe.get_doc("Global Defaults").default_company
    pending_sos = []

    # 1. Fetch Sales Order Items (Pending only)
    # ------------------------------------------------------------------
    so_items = frappe.db.sql("""
        SELECT
            si.parent as sales_order, si.item_code, si.item_name, si.qty,
            COALESCE(si.delivered_qty, 0) as delivered_qty,
            (si.qty - COALESCE(si.delivered_qty, 0)) as pending_qty,
            so.customer, si.bom_no as bom, si.uom
        FROM `tabSales Order Item` si 
        JOIN `tabSales Order` so ON si.parent = so.name
        WHERE so.docstatus = 1 AND so.status NOT IN ('Closed', 'Cancelled', 'On Hold')
          AND (si.qty - COALESCE(si.delivered_qty, 0)) > 0.001
          AND si.bom_no IS NOT NULL AND si.bom_no != ''
        ORDER BY so.transaction_date DESC, so.name
    """, as_dict=1)

    if not so_items:
        return {"sales_orders": []}

    # 2. Extract Keys for Bulk Queries
    # ------------------------------------------------------------------
    boms_to_fetch = {item['bom'] for item in so_items}
    all_bom_item_codes = set()
    
    # Map BOM -> List of RMs
    all_bom_items = {}
    if boms_to_fetch:
        db_bom_items = frappe.get_all("BOM Item", 
            filters={"parent": ("in", list(boms_to_fetch))}, 
            fields=["parent", "item_code", "item_name", "stock_uom", "stock_qty"]
        )
        for bom_item in db_bom_items:
            all_bom_items.setdefault(bom_item.parent, []).append(bom_item)
            all_bom_item_codes.add(bom_item.item_code)

    all_finished_good_codes = {item['item_code'] for item in so_items}
    all_material_codes = tuple(all_bom_item_codes.union(all_finished_good_codes))
    
    stock_map = {}           # Physical Stock
    incoming_po_map = {}     # General incoming POs (Net pending)
    so_linked_po_map = {}    # Specific SO-Linked POs (Net pending)
    existing_po_refs = {}    # Links for UI

    if all_material_codes:
        # A. Get Physical Actual Stock (In Bin)
        # -------------------------------------
        bin_data = frappe.db.sql("""
            SELECT b.item_code, SUM(COALESCE(b.actual_qty, 0) - COALESCE(b.reserved_qty, 0)) as free_qty
            FROM `tabBin` b 
            JOIN `tabWarehouse` w ON b.warehouse = w.name
            WHERE b.item_code IN %s AND w.company = %s 
            GROUP BY b.item_code
        """, (all_material_codes, company), as_dict=True)
        stock_map = {r['item_code']: max(0, flt(r['free_qty'])) for r in bin_data}

        # B. Get Pending (Unreceived) Purchase Orders
        #    NOTE: We calculate `qty - received_qty` to avoid double counting received goods 
        #    which are already in `stock_map`.
        # -------------------------------------
        if all_bom_item_codes:
            rm_tuple = tuple(all_bom_item_codes)
            
            # 1. General Incoming Quantity
            incoming_data = frappe.db.sql("""
                SELECT poi.item_code, SUM(poi.qty - COALESCE(poi.received_qty, 0)) AS net_pending
                FROM `tabPurchase Order Item` poi 
                JOIN `tabPurchase Order` po ON poi.parent = po.name
                WHERE poi.item_code IN %s 
                  AND po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled', 'Completed') 
                  AND po.company = %s
                  AND (poi.qty - COALESCE(poi.received_qty, 0)) > 0
                GROUP BY poi.item_code
            """, (rm_tuple, company), as_dict=True)
            incoming_po_map = {r['item_code']: flt(r['net_pending']) for r in incoming_data}

            # 2. Linked SO Quantity (Via Custom Table `Purchase Order Raw Material Source`)
            #    We approximate pending link by joining PO Status. 
            #    Strict logic: Ratio of Item Pending Qty vs Total Order.
            linked_data = frappe.db.sql("""
                SELECT 
                    rmb.source_sales_order, 
                    rmb.raw_material_item, 
                    SUM(
                        IF(poi.qty > 0, 
                           (rmb.order_for_rm * ((poi.qty - COALESCE(poi.received_qty, 0)) / poi.qty)), 
                           0)
                    ) as net_linked_pending
                FROM `tabPurchase Order Raw Material Source` rmb 
                JOIN `tabPurchase Order` po ON rmb.parent = po.name
                JOIN `tabPurchase Order Item` poi ON (po.name = poi.parent AND rmb.raw_material_item = poi.item_code)
                WHERE rmb.raw_material_item IN %s
                  AND po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled', 'Completed')
                GROUP BY rmb.source_sales_order, rmb.raw_material_item
            """, (rm_tuple,), as_dict=1)
            
            for row in linked_data:
                so_linked_po_map[(row['source_sales_order'], row['raw_material_item'])] = flt(row['net_linked_pending'])

            # 3. Existing PO Links (String for UI)
            po_refs = frappe.db.sql("""
                SELECT DISTINCT po.name, poi.item_code 
                FROM `tabPurchase Order Item` poi JOIN `tabPurchase Order` po ON poi.parent = po.name
                WHERE poi.item_code IN %s AND po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled', 'Completed')
            """, (rm_tuple,), as_dict=True)
            for ref in po_refs:
                existing_po_refs.setdefault(ref['item_code'], []).append(ref['name'])

    # 3. FG In-Production Data
    # ------------------------------------------------------------------
    in_production_map = {}
    if all_finished_good_codes:
        fg_in_prod = frappe.db.sql("""
             SELECT source_finished_good, SUM(order_for_fg) as qty 
             FROM `tabPurchase Order Raw Material Source` rmb 
             JOIN `tabPurchase Order` po ON rmb.parent = po.name 
             WHERE po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled')
             GROUP BY source_finished_good
        """, as_dict=1)
        in_production_map = {r['source_finished_good']: flt(r['qty']) for r in fg_in_prod}


    # 4. Construct Final Data
    # ------------------------------------------------------------------
    for so_item in so_items:
        sales_order = so_item['sales_order']
        item_code = so_item['item_code']

        # Get Picking Info (Optional context)
        picked_stats = frappe.db.sql("""
            SELECT 
                (SELECT SUM(pli.picked_qty) FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pli.parent=pl.name WHERE pli.sales_order=%s AND pli.item_code=%s AND pl.docstatus=1) as sub,
                (SELECT SUM(pli.qty) FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pli.parent=pl.name WHERE pli.sales_order=%s AND pli.item_code=%s AND pl.docstatus=0) as drft
        """, (sales_order, item_code, sales_order, item_code), as_dict=1)
        
        picked_submitted = flt(picked_stats[0]['sub']) if picked_stats else 0
        picked_draft = flt(picked_stats[0]['drft']) if picked_stats else 0
        
        # Max quantity remaining
        qty_awaiting_pick = max(0, so_item['pending_qty'] - picked_submitted - picked_draft)
        
        # Available FGs
        so_item['available_fg_stock'] = stock_map.get(item_code, 0)
        so_item['fg_in_production'] = in_production_map.get(item_code, 0)
        so_item['picked_submitted'] = picked_submitted
        so_item['picked_draft'] = picked_draft
        so_item['qty_awaiting_pick'] = qty_awaiting_pick

        # Attach RMs
        raw_materials_list = []
        bom_rows = all_bom_items.get(so_item['bom'], [])
        
        for rm in bom_rows:
            rm_code = rm['item_code']
            
            # Qty ordered specifically for this SO that hasn't arrived yet
            linked_pending = so_linked_po_map.get((sales_order, rm_code), 0)
            
            # Total pending for this Item across all POs
            total_pending = incoming_po_map.get(rm_code, 0)
            
            # Unallocated = Total Pending - Linked Pending (Ensure no double count or negative)
            unallocated_pending = max(0, total_pending - linked_pending)

            raw_materials_list.append({
                "item_code": rm_code,
                "item_name": rm['item_name'],
                "uom": rm['stock_uom'],
                "bom_qty_per_unit": flt(rm['stock_qty']),
                "available_qty": stock_map.get(rm_code, 0),        # Only Real Warehouse Stock
                "ordered_linked_qty": linked_pending,              # Only unreceived specific POs
                "incoming_general_qty": unallocated_pending,       # Only unreceived general POs
                "existing_po_list": existing_po_refs.get(rm_code, [])
            })

        so_item['raw_materials'] = raw_materials_list
        pending_sos.append(so_item)

    return {"sales_orders": pending_sos}

import frappe
import collections
import json
# @frappe.whitelist()
# def get_linked_subcontracting_docs(purchase_order_name):
#     """
#     Finds all linked subcontracting documents and injects child Item details 
#     for display on the Purchase Order dashboard.
#     """
#     docs = {"sco": [], "ste": [], "scr": [], "pr": [], "pi": [], "ewo": []}

#     # Helper function to efficiently attach child table items
#     def attach_items(parent_list, child_doctype, child_fields):
#         if not parent_list:
#             return
        
#         parent_names = [d["name"] for d in parent_list]
        
#         items = frappe.db.get_all(
#             child_doctype,
#             filters={"parent": ["in", parent_names]},
#             fields=["parent"] + child_fields
#         )
        
#         item_map = collections.defaultdict(list)
#         for item in items:
#             item_map[item["parent"]].append(item)
            
#         for p in parent_list:
#             p["items"] = item_map.get(p["name"], [])

#     # 1. Embroidery Work Orders (EWO)
#     ewo_names = frappe.db.get_all(
#         "Embroidery Work Order",
#         filters={"purchase_order": purchase_order_name, "docstatus": ["!=", 2]}, 
#         pluck="name"
#     )
#     if ewo_names:
#         docs["ewo"] = frappe.db.get_all("Embroidery Work Order", 
#             filters={"name": ["in", ewo_names], "docstatus": 1},
#             fields=[
#                 "name", "date", "status", "notes", "per_received", "stage", "supplier", 
#                 "work_type", 
#                 # Panel Fields
#                 "panel_jobber", "panel_stage",
#                 # Full Piece Fields (ADDED THESE)
#                 "full_piece_jobber", "full_piece_stage"
#             ], 
#             order_by="creation desc"
#         )
        
#         attach_items(docs["ewo"], "Embroidery Work Order Item", ["item_code", "item_name", "ordered_qty", "received_qty"])

#     # 2. Subcontracting Orders (SCO)
#     sco_names = frappe.db.get_all(
#         "Subcontracting Order",
#         filters={"purchase_order": purchase_order_name, "docstatus": 1},
#         pluck="name"
#     )
#     if sco_names:
#         docs["sco"] = frappe.db.get_all("Subcontracting Order", filters={"name": ["in", sco_names]},
#             fields=["name", "transaction_date", "total", "status"])
#         attach_items(docs["sco"], "Subcontracting Order Item", ["item_code", "item_name", "qty", "received_qty", "amount"])

#         # 3. Material Transfers (Stock Entry linked to SCO)
#         ste_names = frappe.db.get_all(
#             "Stock Entry",
#             filters={"subcontracting_order": ["in", sco_names], "docstatus": 1},
#             pluck="name"
#         )
#         if ste_names:
#             docs["ste"] = frappe.db.get_all("Stock Entry", filters={"name": ["in", ste_names]},
#                 fields=["name", "posting_date", "stock_entry_type"])
#             attach_items(docs["ste"], "Stock Entry Detail", ["item_code", "item_name", "qty", "uom"])

#         # 4. Subcontracting Receipts (linked to SCO)
#         scr_names = frappe.db.get_all(
#             "Subcontracting Receipt",
#             filters={"subcontracting_order": ["in", sco_names], "docstatus": 1},
#             pluck="name"
#         )
#         if scr_names:
#             docs["scr"] = frappe.db.get_all("Subcontracting Receipt", filters={"name": ["in", scr_names]},
#                 fields=["name", "posting_date", "status"])
#             attach_items(docs["scr"], "Subcontracting Receipt Item", ["item_code", "item_name", "qty", "amount"])

#     # 5. Purchase Receipts (linked via Child Table)
#     pr_parents = frappe.db.get_all(
#         "Purchase Receipt Item", filters={"purchase_order": purchase_order_name},
#         pluck="parent", distinct=True
#     )
#     if pr_parents:
#         pr_names = frappe.db.get_all("Purchase Receipt", filters={"name": ["in", pr_parents], "docstatus": 1}, pluck="name")
#         if pr_names:
#             docs["pr"] = frappe.db.get_all("Purchase Receipt", filters={"name": ["in", pr_names]},
#                 fields=["name", "posting_date", "rounded_total", "status"])
#             attach_items(docs["pr"], "Purchase Receipt Item", ["item_code", "item_name", "qty", "rate", "amount"])

#     # 6. Purchase Invoices (linked via Child Table)
#     pi_parents = frappe.db.get_all(
#         "Purchase Invoice Item", filters={"purchase_order": purchase_order_name},
#         pluck="parent", distinct=True
#     )
#     if pi_parents:
#         pi_names = frappe.db.get_all("Purchase Invoice", filters={"name": ["in", pi_parents], "docstatus": 1}, pluck="name")
#         if pi_names:
#             docs["pi"] = frappe.db.get_all("Purchase Invoice", filters={"name": ["in", pi_names]},
#                 fields=["name", "posting_date", "due_date", "status"])
#             attach_items(docs["pi"], "Purchase Invoice Item", ["item_code", "item_name", "qty", "rate", "amount"])

#     return docs
import frappe
import collections
import frappe
import collections
import frappe
import collections

@frappe.whitelist()
def get_linked_subcontracting_docs(purchase_order_name):
    docs = { "sco": [], "ste": [], "scr": [], "pr": [], "pi": [], "ewo": [] }

    def attach_items(parent_list, child_doctype, child_fields):
        if not parent_list: return
        parent_names = [d["name"] for d in parent_list]
        items = frappe.db.get_all(child_doctype, 
            filters={"parent": ["in", parent_names]}, 
            fields=["parent"] + child_fields
        )
        item_map = collections.defaultdict(list)
        for item in items: item_map[item["parent"]].append(item)
        for p in parent_list: p["items"] = item_map.get(p["name"], [])

    # 1. Embroidery Work Orders
    docs["ewo"] = frappe.db.get_all("Embroidery Work Order", 
        filters={"purchase_order": purchase_order_name, "docstatus": ["!=", 2]},
        fields=["name", "work_type", "status", "stage", "panel_stage"], 
        order_by="creation desc")
    attach_items(docs["ewo"], "Embroidery Work Order Item", ["item_code", "ordered_qty", "received_qty"])

    # 2. Subcontract Orders
    sco_list = frappe.db.get_all("Subcontracting Order", 
        filters={"purchase_order": purchase_order_name, "docstatus": 1},
        fields=["name", "transaction_date", "total", "status"])
    docs["sco"] = sco_list
    sco_names = [d["name"] for d in sco_list]
    attach_items(docs["sco"], "Subcontracting Order Item", ["item_code", "qty", "received_qty"])

    # 3. Subcontract Receipts
    if sco_names:
        docs["scr"] = frappe.db.get_all("Subcontracting Receipt", 
            filters={"subcontracting_order": ["in", sco_names], "docstatus": 1},
            fields=["name", "posting_date", "status"])
        attach_items(docs["scr"], "Subcontracting Receipt Item", ["item_code", "qty"])

    # 4. Stock Entries (Consolidated Logic)
    ste_normal = []
    if sco_names:
        ste_normal = frappe.db.get_all("Stock Entry", 
            filters={"subcontracting_order": ["in", sco_names], "docstatus": 1}, 
            fields=["name", "posting_date", "stock_entry_type"])
    
    ste_extra = frappe.db.get_all("Stock Entry", filters={
        "custom_reference_id": purchase_order_name,
        "custom_extra_fg_collect_from_jobbers": 1,
        "docstatus": 1
    }, fields=["name", "posting_date", "stock_entry_type", "custom_extra_fg_collect_from_jobbers"])
    
    for s in ste_extra: s["is_extra"] = 1
    
    all_ste_map = {d["name"]: d for d in ste_normal}
    for e in ste_extra: all_ste_map[e["name"]] = e
    docs["ste"] = list(all_ste_map.values())
    
    # --- FIX: Removed "item_name" which is not a valid column in Stock Entry Detail ---
    attach_items(docs["ste"], "Stock Entry Detail", ["item_code", "qty", "uom"])

    # 5. Purchase Receipts
    pr_normal_names = frappe.db.get_all("Purchase Receipt Item", 
        filters={"purchase_order": purchase_order_name, "docstatus": 1}, 
        pluck="parent", distinct=True)
    pr_normal = []
    if pr_normal_names:
        pr_normal = frappe.db.get_all("Purchase Receipt", 
            filters={"name": ["in", pr_normal_names]}, 
            fields=["name", "posting_date", "rounded_total", "status"])
            
    pr_extra = frappe.db.get_all("Purchase Receipt", filters={
        "custom_reference_id": purchase_order_name,
        "custom_extra_fg_collect_from_jobbers": 1,
        "docstatus": 1
    }, fields=["name", "posting_date", "rounded_total", "status", "custom_extra_fg_collect_from_jobbers"])
    
    for p in pr_extra: p["is_extra"] = 1

    all_pr_map = {d["name"]: d for d in pr_normal}
    for e in pr_extra: all_pr_map[e["name"]] = e
    docs["pr"] = list(all_pr_map.values())
    attach_items(docs["pr"], "Purchase Receipt Item", ["item_code", "qty", "rate"])

    # 6. Purchase Invoices
    pi_parents = frappe.db.get_all("Purchase Invoice Item", 
        filters={"purchase_order": purchase_order_name}, 
        pluck="parent", distinct=True)
    if pi_parents:
        docs["pi"] = frappe.db.get_all("Purchase Invoice", 
            filters={"name": ["in", pi_parents], "docstatus": 1}, 
            fields=["name", "due_date", "status"])
        attach_items(docs["pi"], "Purchase Invoice Item", ["item_code", "qty"])

    return docs
@frappe.whitelist()
def get_ewo_details(name):
    """ Helper to get child table details for Receiving Dialog """
    doc = frappe.get_doc("Embroidery Work Order", name)
    return {"items": doc.items}
@frappe.whitelist()
def receive_panel_items(name, items_data, notes=""):
    """
    Updates Received Qty.
    If ALL items are fully received, advances stage.
    If NOT fully received, keeps stage as is (allowing more receipts).
    """
    import json
    import frappe.utils
    
    received_items = json.loads(items_data) # List of { name: row_id, qty: current_session_qty }
    
    doc = frappe.get_doc("Embroidery Work Order", name)
    
    updated_any = False
    
    # 1. Update Cumulative Received Qty
    for row_input in received_items:
        current_input_qty = float(row_input['qty'])
        if current_input_qty > 0:
            for doc_item in doc.items:
                if doc_item.name == row_input['name']:
                    # Add to existing. NOTE: Front end handles logic to send the DELTA (current input), not total.
                    # Or simpler: Front end calculates total. 
                    # Let's assume input is "Qty receiving NOW".
                    
                    doc_item.received_qty = (doc_item.received_qty or 0) + current_input_qty
                    updated_any = True
    
    if updated_any:
        # 2. Check if FULLY COMPLETED
        all_fully_received = True
        for i in doc.items:
            # Tolerence for small float diffs
            if i.received_qty < i.ordered_qty:
                all_fully_received = False
                break
        
        timestamp = frappe.utils.format_datetime(frappe.utils.now(), "dd-MM-yyyy hh:mm a")

        if all_fully_received:
            # ALL GOOD -> MOVE TO NEXT STAGE
            doc.panel_stage = "Received from Panel Jobber"
            doc.notes = (doc.notes or "") + f"\n• {timestamp}: Full Receipt Complete. Workflow moved to Step 4."
        else:
            # PARTIAL -> STAY ON SAME STAGE
            # doc.panel_stage remains "Sent to Panel Jobber"
            doc.notes = (doc.notes or "") + f"\n• {timestamp}: Partial Receipt logged. Workflow remains active for balance."
        
        if notes:
            doc.notes += f" Comment: {notes}"
            
        doc.save(ignore_permissions=True)
    
    return True

from erpnext.subcontracting.doctype.subcontracting_order.subcontracting_order import make_subcontracting_receipt
from erpnext.subcontracting.doctype.subcontracting_receipt.subcontracting_receipt import make_purchase_receipt as make_purchase_receipt_from_scr
from erpnext.stock.doctype.purchase_receipt.purchase_receipt import make_purchase_invoice


# @frappe.whitelist()
# def get_sco_status_for_po(purchase_order_name):
#     """
#     Checks the status of the Subcontracting Order linked to a Purchase Order.
#     Returns the SCO name and whether there are items pending receipt.
#     """
#     sco_info = frappe.db.get_value(
#         "Subcontracting Order",
#         {"purchase_order": purchase_order_name, "docstatus": 1},
#         ["name", "per_received"],
#         as_dict=True
#     )

#     if not sco_info:
#         return {"sco_exists": False, "items_pending": False}

#     return {
#         "sco_exists": True,
#         "sco_name": sco_info.name,
#         "items_pending": flt(sco_info.per_received) < 100
#     }



import frappe
from frappe import _
from frappe.utils import flt, get_abbr, nowdate
from collections import defaultdict

# # --- NEW FUNCTION TO GET REQUIRED MATERIALS ---
# @frappe.whitelist()
# def get_required_raw_materials_for_po(purchase_order_name):
#     """
#     Aggregates all required raw materials for a subcontracting Purchase Order.
#     Fetches FG Items from PO, finds their default BOMs, and calculates total RM requirements.
#     """
#     po = frappe.get_doc("Purchase Order", purchase_order_name)
#     if not po.is_subcontracted:
#         frappe.throw(_("This action is only available for Subcontracting Purchase Orders."))

#     # Aggregate required FG quantities from the PO
#     fg_requirements = defaultdict(float)
#     for item in po.items:
#         if item.fg_item and item.fg_item_qty > 0:
#             fg_requirements[item.fg_item] += flt(item.fg_item_qty)
    
#     if not fg_requirements:
#         return []

#     # Aggregate raw material requirements based on the BOM of each FG
#     rm_requirements = defaultdict(float)
#     for fg_item_code, total_fg_qty in fg_requirements.items():
#         # Get the default BOM for the finished good
#         default_bom = frappe.db.get_value("Item", fg_item_code, "default_bom")
#         if not default_bom:
#             frappe.throw(_("Please set a default BOM for Finished Good: {0}").format(fg_item_code))
        
#         # Get BOM items (raw materials)
#         bom_items = frappe.get_all("BOM Item", filters={"parent": default_bom}, fields=["item_code", "qty"])
#         for bom_item in bom_items:
#             required_qty = flt(bom_item.qty) * flt(total_fg_qty)
#             rm_requirements[bom_item.item_code] += required_qty
            
#     # Get stock levels for each required raw material
#     results = []
#     for rm_code, req_qty in rm_requirements.items():
#         item_details = frappe.db.get_value("Item", rm_code, ["item_name", "stock_uom"], as_dict=1)
        
#         # Get available quantity from Bin
#         # Get available quantity from Bin
#         stock_data = frappe.db.sql("""
#             SELECT SUM(actual_qty), SUM(reserved_qty)
#             FROM `tabBin` WHERE item_code = %s
#         """, (rm_code), as_list=True)

#         actual_qty = flt(stock_data[0][0])
#         reserved_qty = flt(stock_data[0][1])

#         # Prevent negative available qty
#         available_qty = max(actual_qty - reserved_qty, 0)

#         # print(f"DEBUG: RM {rm_code} - Actual: {actual_qty}, Reserved: {reserved_qty}, Available: {available_qty}")
#         results.append({
#             "item_code": rm_code,
#             "item_name": item_details.item_name,
#             "uom": item_details.stock_uom,
#             "required_qty": req_qty,
#             "available_qty": actual_qty
#         })
        
#     return sorted(results, key=lambda x: x['item_name'])



@frappe.whitelist()
def get_required_raw_materials_for_po(purchase_order_name):
    po = frappe.get_doc("Purchase Order", purchase_order_name)
    if not po.is_subcontracted:
        frappe.throw(_("This action is only available for Subcontracting Purchase Orders."))

    # Target warehouse specified by the user
    target_warehouse = "VV Puram - IND"

    fg_requirements = defaultdict(float)
    for item in po.items:
        if item.fg_item and item.fg_item_qty > 0:
            fg_requirements[item.fg_item] += flt(item.fg_item_qty)
    
    if not fg_requirements:
        return []

    rm_requirements = defaultdict(float)
    for fg_item_code, total_fg_qty in fg_requirements.items():
        default_bom = frappe.db.get_value("Item", fg_item_code, "default_bom")
        if not default_bom:
            frappe.throw(_("Please set a default BOM for Finished Good: {0}").format(fg_item_code))
        
        bom_items = frappe.get_all("BOM Item", filters={"parent": default_bom}, fields=["item_code", "qty"])
        for bom_item in bom_items:
            required_qty = flt(bom_item.qty) * flt(total_fg_qty)
            rm_requirements[bom_item.item_code] += required_qty
            
    results = []
    for rm_code, req_qty in rm_requirements.items():
        item_details = frappe.db.get_value("Item", rm_code, ["item_name", "stock_uom"], as_dict=1)
        
        # CHANGED: Query filtered by the specific Warehouse
        stock_data = frappe.db.get_value("Bin", 
            filters={"item_code": rm_code, "warehouse": target_warehouse}, 
            fieldname=["actual_qty", "reserved_qty"], 
            as_dict=True
        )

        # Handle cases where the item might not have a Bin record in that warehouse yet
        actual_qty = flt(stock_data.actual_qty) if stock_data else 0.0
        reserved_qty = flt(stock_data.reserved_qty) if stock_data else 0.0

        # Calculate "Real" available stock in that warehouse
        available_qty = max(actual_qty - reserved_qty, 0)

        results.append({
            "item_code": rm_code,
            "item_name": item_details.item_name,
            "uom": item_details.stock_uom,
            "required_qty": req_qty,
            "available_qty": actual_qty  # User mentioned "Real Stock", usually means Actual
        })
        
    return sorted(results, key=lambda x: x['item_name'])


from erpnext.buying.doctype.purchase_order.purchase_order import make_subcontracting_order
from erpnext.controllers.subcontracting_controller import make_rm_stock_entry

# @frappe.whitelist()
# # @frappe.db.transaction
# def create_subcontracting_docs(purchase_order_name):
#     """
#     Creates and submits a Subcontracting Order, and then immediately creates and
#     submits the corresponding Material Transfer Stock Entry to a common warehouse.
#     This is a single, atomic transaction.
#     """
#     po = frappe.get_doc("Purchase Order", purchase_order_name)

#     subcontractor_warehouse = "Jobers Warehouse - IND"

#     if not frappe.db.exists("Warehouse", subcontractor_warehouse):
#         frappe.throw(_("The common subcontracting warehouse '{0}' does not exist. Please create it before proceeding.").format(subcontractor_warehouse))

#     # Create the Subcontracting Order
#     sco = make_subcontracting_order(purchase_order_name)
    
#     # Set custom/required values before saving
#     sco.supplier = po.supplier
#     target_warehouse = "VV Puram - IND"
#     sco.set_warehouse = target_warehouse
#     for item in sco.items:
#         item.warehouse = target_warehouse
    
#     # Save and submit the SCO
#     sco.insert(ignore_permissions=True)
#     sco.submit()
#     po.add_comment("Comment", _("Created Subcontracting Order: {0}").format(sco.name))

#     # --- START OF FIX ---

#     # 1. Get the doclist from the controller function
#     # The name is changed to `ste_doclist` for clarity.
#     ste_doclist = make_rm_stock_entry(subcontract_order=sco.name, order_doctype=sco.doctype)
    
#     # 2. Convert the returned doclist (list of dicts) into a proper Document object.
#     ste_doc = frappe.get_doc(ste_doclist)
    
#     # --- END OF FIX ---
    
#     # Now, `ste_doc` is a proper Document object, and the rest of the code will work.
#     for item in ste_doc.items:
#         item.t_warehouse = subcontractor_warehouse
    
#     # Save and submit the now-corrected Stock Entry
#     ste_doc.insert(ignore_permissions=True)
#     ste_doc.submit()
#     po.add_comment("Comment", _("Created Material Transfer: {0}").format(ste_doc.name))
    
#     return {
#         "sco_name": sco.name,
#         "ste_name": ste_doc.name
#     }

@frappe.whitelist()
def create_subcontracting_docs(purchase_order_name, updated_materials_for_supply=None):
    """
    Creates a Subcontracting Order and its corresponding Material Transfer.
    Uses 'qty_to_supply' from `updated_materials_for_supply` for the Stock Entry.
    """
    po = frappe.get_doc("Purchase Order", purchase_order_name)
    subcontractor_warehouse = "Jobers Warehouse - IND" # Ensure this warehouse exists

    if not frappe.db.exists("Warehouse", subcontractor_warehouse):
        frappe.throw(_("Warehouse '{0}' not found. Please create it first.").format(subcontractor_warehouse))

    # --- Create the Subcontracting Order ---
    sco = make_subcontracting_order(purchase_order_name)
    sco.supplier = po.supplier
    target_warehouse = "VV Puram - IND" # The warehouse from which materials are transferred
    sco.set_warehouse = target_warehouse # This sets the default for the SCO items
    for item in sco.items:
        item.warehouse = target_warehouse # Ensure each item also has the source warehouse
    sco.insert(ignore_permissions=True)
    sco.submit()
    po.add_comment("Comment", _("Created Subcontracting Order: {0}").format(sco.name))

    # --- Create the Material Transfer Stock Entry ---
    ste_doclist = make_rm_stock_entry(subcontract_order=sco.name, order_doctype=sco.doctype)
    ste_doc = frappe.get_doc(ste_doclist)

    # --- NEW: LOGIC TO UPDATE QUANTITIES BASED ON 'qty_to_supply' ---
    if updated_materials_for_supply:
        supply_quantities = {
            item['item_code']: flt(item['qty_to_supply']) for item in json.loads(updated_materials_for_supply)
        }
        
        # Adjust quantities in the stock entry items
        for item in ste_doc.items:
            if item.item_code in supply_quantities:
                item.qty = supply_quantities[item.item_code]
                item.t_warehouse = subcontractor_warehouse # Transfer to subcontractor's warehouse
            else:
                # If an item is somehow not in the updated_materials_for_supply, 
                # you might want to remove it or set its qty to 0
                item.qty = 0 
                item.t_warehouse = subcontractor_warehouse # Still transfer to subcontractor
    else:
        # If no updated_materials_for_supply, default all to 0 or original SCO quantities
        # Depending on desired default behavior. For this, we'll set to 0.
        for item in ste_doc.items:
            item.qty = 0
            item.t_warehouse = subcontractor_warehouse

    # Filter out items with 0 quantity if desired
    ste_doc.items = [item for item in ste_doc.items if item.qty > 0]
    
    # If no items are to be transferred, prevent submission of an empty Stock Entry
    if not ste_doc.items:
        frappe.throw(_("No raw materials selected for transfer. Stock Entry cannot be created."))

    # Save and submit the now-corrected Stock Entry
    ste_doc.insert(ignore_permissions=True)
    ste_doc.submit()
    po.add_comment("Comment", _("Created Material Transfer: {0}").format(ste_doc.name))
    
    return {
        "sco_name": sco.name,
        "ste_name": ste_doc.name
    }


import frappe
from frappe import _
from frappe.utils import flt, nowdate
import json # Ensure json is imported


@frappe.whitelist()
def create_material_request_for_shortage(purchase_order_name, materials_for_mr_calculation=None):
    """
    Creates a Material Request for items with a stock shortage based on the
    original required quantities and available stock.
    """
    if not materials_for_mr_calculation:
        frappe.throw(_("No materials data received for Material Request calculation."))
    
    materials_data = json.loads(materials_for_mr_calculation)
    shortage_items = []

    for item_data in materials_data:
        # These quantities are the initial 'required_qty' and 'available_qty'
        # passed from the client for MR calculation.
        required_qty = flt(item_data['required_qty'])
        available_qty = flt(item_data['available_qty']) # This should be the current available stock

        # Calculate shortage
        shortage = required_qty - available_qty
        
        if shortage > 0:
            shortage_items.append({
                "item_code": item_data['item_code'],
                "qty": shortage
            })

    if not shortage_items:
        return frappe.utils.data.cstr("No stock shortage found. Material Request not created.")
        
    # --- Create the Material Request ---
    mr = frappe.new_doc("Material Request")
    mr.material_request_type = "Purchase" # Or "Manufacture" if it's for internal production
    mr.schedule_date = nowdate() # Set today's date or a future date

    for item in shortage_items:
        mr.append("items", item)

    mr.insert(ignore_permissions=True)
    mr.submit()

    return {"mr_name": mr.name}

@frappe.whitelist()
def get_pending_sco_items(sco_name):
    """
    Gets items from a Subcontracting Order that are pending to be received.
    """
    sco = frappe.get_doc("Subcontracting Order", sco_name)
    pending_items = []
    for item in sco.items:
        pending_qty = flt(item.qty) - flt(item.received_qty)
        if pending_qty > 0:
            pending_items.append({
                "name": item.name, # Child Doc ID is important
                "item_code": item.item_code,
                "item_name": item.item_name,
                "ordered_qty": item.qty,
                "received_qty": item.received_qty,
                "pending_qty": pending_qty,
                
                # --- THIS IS THE FIX ---
                # The correct field name is 'stock_uom' not 'uom'
                "uom": item.stock_uom
            })
    return pending_items




# @frappe.whitelist()
# def create_receipt_documents(sco_name, items_to_receive):
#     """
#     1. Creates and submits a Subcontracting Receipt (SCR).
#     2. Creates and submits a Purchase Receipt (PR) from the SCR.
#     3. Creates and submits a Purchase Invoice (PI) from the PR.
#     """
#     items_to_receive = frappe.parse_json(items_to_receive)

#     # 1. Create Subcontracting Receipt (SCR)
#     scr = make_subcontracting_receipt(sco_name)
    
#     # Filter items and update quantities based on user input
#     final_items = []
#     for item_in_scr in scr.items:
#         matching_item = next((i for i in items_to_receive if i.get("name") == item_in_scr.subcontracting_order_item), None)
#         if matching_item:
#             qty_to_receive = flt(matching_item.get("qty_to_receive"))
#             if qty_to_receive > 0:
#                 item_in_scr.qty = qty_to_receive
#                 final_items.append(item_in_scr)

#     if not final_items:
#         frappe.throw(_("No items with a quantity greater than zero were selected for receipt."))
        
#     scr.items = final_items
#     scr.insert(ignore_permissions=True)
#     scr.submit()
    
#     # 2. Create Purchase Receipt (PR) from the SCR
#     pr = make_purchase_receipt_from_scr(scr.name)
#     pr.insert(ignore_permissions=True)
#     pr.submit()
    
#     # --- START OF NEW LOGIC ---
#     # 3. Create Purchase Invoice (PI) from the PR
#     # pi = make_purchase_invoice(pr.name)
#     # pi.insert(ignore_permissions=True)
#     # Note: Depending on your company's process, you may want to leave the PI in Draft.
#     # To save as draft, comment out the line below.
#     # pi.submit()
#     # --- END OF NEW LOGIC ---

#     # Add comments back to the original Purchase Order for full traceability
#     po_name = None
#     if scr.items:
#         source_sco_name = scr.items[0].subcontracting_order
#         if source_sco_name:
#             po_name = frappe.db.get_value("Subcontracting Order", source_sco_name, "purchase_order")
            
#     if po_name:
#         po = frappe.get_doc("Purchase Order", po_name)
#         po.add_comment("Comment", _("Created Purchase Receipt: {0}").format(pr.name))
#         # po.add_comment("Comment", _("Created Purchase Invoice: {0}").format(pi.name))

#     # Return the names of ALL documents created
#     return {"scr_name": scr.name, "pr_name": pr.name}



@frappe.whitelist()
def get_pending_sco_items(sco_name):
    perc = frappe.get_single("Admin Settings").allow_over_collecting_of_fg or 0.0
    sco = frappe.get_doc("Subcontracting Order", sco_name)
    items = []
    for item in sco.items:
        ordered_qty = flt(item.qty)
        received_qty = flt(item.received_qty)
        allowed_max = ordered_qty * (1 + perc / 100)
        if received_qty >= allowed_max:
            continue
        pending_qty = max(0, ordered_qty - received_qty)
        items.append({
            "name": item.name,
            "item_name": item.item_name,
            "ordered_qty": ordered_qty,
            "received_qty": received_qty,
            "pending_qty": pending_qty,
        })
    return {"items": items, "allow_over_fg_perc": perc}



# @frappe.whitelist()
# def create_receipt_documents(sco_name, items_to_receive):
#     items_to_receive = frappe.parse_json(items_to_receive)
#     sco = frappe.get_doc("Subcontracting Order", sco_name)
#     perc = frappe.get_single("Admin Settings").allow_over_collecting_of_fg or 0.0

#     po_name = sco.purchase_order

#     scr = make_subcontracting_receipt(sco_name)

#     final_items = []
#     extra_quantities = []
#     processed_ids = set()

#     def get_best_warehouse(item_wh=None):
#         wh = (
#             item_wh
#             or sco.set_warehouse
#             or frappe.db.get_single_value("Stock Settings", "default_warehouse")
#             or frappe.db.get_value("Company", sco.company, "default_warehouse")
#         )
#         if not wh:
#             frappe.throw(
#                 title="Warehouse Configuration Missing",
#                 msg=(
#                     "Target warehouse is mandatory for Material Receipt Stock Entry, but no warehouse was found.\n\n"
#                     "Please set a warehouse in **at least one** of these locations:\n"
#                     "• Stock Settings → Default Warehouse (recommended - global)\n"
#                     "• Company → Default Warehouse\n"
#                     "• Subcontracting Order header → Set Warehouse\n"
#                     "• Subcontracting Order Items table → Warehouse column\n\n"
#                     f"SCO: {sco_name} | Company: {sco.company}"
#                 )
#             )
#         return wh

#     # ── Normal items ──
#     for item_in_scr in scr.items:
#         matching = next((i for i in items_to_receive if i.get("name") == item_in_scr.subcontracting_order_item), None)
#         if matching:
#             qty_to_receive = flt(matching.get("qty_to_receive"))
#             processed_ids.add(matching.get("name"))
#             if qty_to_receive > 0:
#                 pending_qty = flt(item_in_scr.qty)
#                 ordered_qty = flt(frappe.db.get_value("Subcontracting Order Item", item_in_scr.subcontracting_order_item, "qty"))
#                 allowed_qty = pending_qty + (ordered_qty * perc / 100)

#                 if qty_to_receive > allowed_qty:
#                     frappe.throw(_("Quantity exceeds allowed limit for {0}").format(item_in_scr.item_name))

#                 normal_qty = min(qty_to_receive, pending_qty)
#                 extra_qty = qty_to_receive - normal_qty

#                 if normal_qty > 0:
#                     item_in_scr.qty = normal_qty
#                     final_items.append(item_in_scr)

#                 if extra_qty > 0:
#                     extra_quantities.append({
#                         "item_code": item_in_scr.item_code,
#                         "item_name": item_in_scr.item_name,
#                         "description": item_in_scr.description or item_in_scr.item_name,
#                         "qty": extra_qty,
#                         "stock_uom": item_in_scr.stock_uom,
#                         "conversion_factor": flt(item_in_scr.conversion_factor) or 1,
#                         "warehouse": get_best_warehouse(item_in_scr.warehouse)
#                     })

#     # ── Extra for pending=0 items ──
#     for user_item in items_to_receive:
#         child_id = user_item.get("name")
#         if child_id in processed_ids:
#             continue
#         qty_to_receive = flt(user_item.get("qty_to_receive"))
#         if qty_to_receive <= 0:
#             continue

#         sco_item = next((i for i in sco.items if i.name == child_id), None)
#         if not sco_item:
#             frappe.throw(_("Invalid item {0}").format(child_id))

#         ordered_qty = flt(sco_item.qty)
#         received_qty = flt(sco_item.received_qty)
#         pending_qty = max(0, ordered_qty - received_qty)
#         allowed_qty = pending_qty + (ordered_qty * perc / 100)

#         if qty_to_receive > allowed_qty:
#             frappe.throw(_("Quantity exceeds allowed limit for {0}").format(sco_item.item_name))

#         extra_quantities.append({
#             "item_code": sco_item.item_code,
#             "item_name": sco_item.item_name,
#             "description": sco_item.description or sco_item.item_name,
#             "qty": qty_to_receive,
#             "stock_uom": sco_item.stock_uom,
#             "conversion_factor": flt(sco_item.conversion_factor) or 1,
#             "warehouse": get_best_warehouse(sco_item.warehouse)
#         })

#     if not final_items and not extra_quantities:
#         frappe.throw(_("No valid quantities selected for receipt."))

#     scr_name = pr_name = se_name = None

#     if final_items:
#         scr.items = final_items
#         scr.insert(ignore_permissions=True)
#         scr.submit()
#         scr_name = scr.name

#         pr = make_purchase_receipt_from_scr(scr.name)
#         pr.insert(ignore_permissions=True)
#         pr.submit()
#         pr_name = pr.name

#     if extra_quantities:
#         se = frappe.new_doc("Stock Entry")
#         se.stock_entry_type = "Material Receipt"
#         se.company = sco.company
#         se.posting_date = frappe.utils.nowdate()
#         se.posting_time = frappe.utils.nowtime()
#         se.set_posting_time = 1

#         comment = f"Extra FG receipt for SCO {sco_name}\nPO: {po_name or 'N/A'}\nAllowed over: {perc}%\n\n"
#         for ex in extra_quantities:
#             comment += f"• {ex['item_name']}: {ex['qty']} {ex['stock_uom']} → {ex['warehouse']}\n"
#         se.add_comment("Comment", comment)

#         if po_name and "custom_extra_so_order_po_reference" in se.meta.get_valid_columns():
#             se.custom_extra_so_order_po_reference = po_name

#         for ex in extra_quantities:
#             se.append("items", {
#                 "item_code": ex["item_code"],
#                 "qty": ex["qty"],
#                 "uom": ex["stock_uom"],
#                 "stock_uom": ex["stock_uom"],
#                 "conversion_factor": ex["conversion_factor"],
#                 "t_warehouse": ex["warehouse"],
#                 "basic_rate": 0.0,
#                 "amount": 0.0,
#                 "is_scrap_item": 0,
#             })

#         se.insert(ignore_permissions=True)
#         se.submit()
#         se_name = se.name

#     if po_name:
#         po = frappe.get_doc("Purchase Order", po_name)
#         if pr_name:
#             po.add_comment("Comment", f"Created PR (normal): {pr_name}")
#         if se_name:
#             po.add_comment("Comment", f"Created Stock Entry (extra): {se_name}")

#     return {"scr_name": scr_name, "pr_name": pr_name, "se_name": se_name}
from frappe import _
from frappe.utils import flt
import math
import json

@frappe.whitelist()
def check_over_collection_limit(sco_name, items_to_receive_json):
    """
    Validates limits with rounding (No changes to logic here).
    """
    items_to_receive = frappe.parse_json(items_to_receive_json)
    
    settings = frappe.get_single("Admin Settings")
    perc = flt(getattr(settings, 'allow_over_collecting_of_fg', 0.0))
    
    sco = frappe.get_doc("Subcontracting Order", sco_name)
    
    over_items = []
    blocked_items = []
    has_extra = False
    block_action = False 

    for req in items_to_receive:
        child_name = req.get("name")
        requested_qty = flt(req.get("qty_to_receive"))

        sco_item = next((i for i in sco.items if i.name == child_name), None)
        if not sco_item: continue

        ordered_qty = flt(sco_item.qty)
        received_qty = flt(sco_item.received_qty)
        
        # Rounding Logic: Ceiling
        exact_max = ordered_qty * (1 + (perc / 100.0))
        rounded_max = math.ceil(exact_max)
        
        max_allowed_remaining = max(0, rounded_max - received_qty)
        pending_qty = max(0, ordered_qty - received_qty)
        extra_qty = requested_qty - pending_qty

        # Validation
        if requested_qty > (max_allowed_remaining + 0.001):
            block_action = True
            blocked_items.append({
                "item": sco_item.item_name, "req": requested_qty, "max": max_allowed_remaining
            })

        if extra_qty > 0.001 and not block_action:
            has_extra = True
            over_items.append({
                "item_name": sco_item.item_name,
                "pending_qty": pending_qty, "requested_qty": requested_qty, "extra_qty": extra_qty
            })

    # Prepare Messages
    error_msg = ""
    if block_action:
        error_msg = f"<h5>Action Blocked</h5>Qty exceeds the {perc}% limit (rounded up)."

    confirm_msg = ""
    if has_extra and not block_action:
        confirm_msg = "<h5>Extra Production Detected</h5>"
        confirm_msg += f"Quantity exceeds pending order but is within {perc}% limit.<br><br>"
        confirm_msg += "<table class='table table-bordered table-sm'><thead><tr class='small'><th>Item</th><th>Pending</th><th>Receive</th><th>Extra</th></tr></thead><tbody>"
        for i in over_items:
            confirm_msg += (f"<tr><td>{i['item_name']}</td><td>{flt(i['pending_qty'], 2)}</td>"
                            f"<td>{flt(i['requested_qty'], 2)}</td><td class='text-danger'>+{flt(i['extra_qty'], 2)}</td></tr>")
        confirm_msg += "</tbody></table>"

    return {
        "block_action": block_action,
        "error_msg": error_msg,
        "has_extra": has_extra,
        "confirm_msg": confirm_msg,
        "allow_perc": perc
    }


@frappe.whitelist()
def create_receipt_documents(sco_name, items_to_receive):
    items_to_receive = frappe.parse_json(items_to_receive)
    sco = frappe.get_doc("Subcontracting Order", sco_name)
    
    if not sco.purchase_order:
        frappe.throw(_("No Purchase Order linked to this SCO."))
        
    po_doc = frappe.get_doc("Purchase Order", sco.purchase_order)
    
    # --- FIND SERVICE ITEM IN PO (To prevent Stock Error) ---
    # We prioritize Finding a Non-Stock item in the PO
    service_item_data = {}
    
    # 1. Try to find explicitly non-stock item in PO
    for pi in po_doc.items:
        is_stock = frappe.db.get_value("Item", pi.item_code, "is_stock_item")
        if not is_stock: 
            service_item_data = {
                "item_code": pi.item_code, "item_name": pi.item_name,
                "rate": pi.rate, "uom": pi.uom
            }
            break
            
    # 2. Fallback: Take first item if no service item found
    if not service_item_data and po_doc.items:
        pi = po_doc.items[0]
        service_item_data = {
            "item_code": pi.item_code, "item_name": pi.item_name,
            "rate": pi.rate, "uom": pi.uom
        }

    # Imports
    try:
        from erpnext.subcontracting.doctype.subcontracting_order.subcontracting_order import make_subcontracting_receipt
        from erpnext.subcontracting.doctype.subcontracting_receipt.subcontracting_receipt import make_purchase_receipt
    except ImportError:
        pass

    scr = make_subcontracting_receipt(sco_name)

    final_scr_items = []
    extra_items = []
    processed_guids = set()

    def get_qty_split(sco_line, total_q):
        pending = max(0, flt(sco_line.qty) - flt(sco_line.received_qty))
        if total_q <= pending: return total_q, 0.0
        return pending, (total_q - pending)

    # 1. PROCESS SCR ITEMS
    for item_in_scr in scr.items:
        match = next((i for i in items_to_receive if i.get("name") == item_in_scr.subcontracting_order_item), None)
        if match:
            processed_guids.add(match.get("name"))
            qty_input = flt(match.get("qty_to_receive"))
            sco_line = frappe.get_doc("Subcontracting Order Item", item_in_scr.subcontracting_order_item)
            
            norm_q, extra_q = get_qty_split(sco_line, qty_input)
            
            if norm_q > 0:
                item_in_scr.qty = norm_q
                final_scr_items.append(item_in_scr)
            
            if extra_q > 0:
                wh = (sco_line.warehouse or sco.set_warehouse or 
                      frappe.db.get_value("Company", sco.company, "default_warehouse"))
                
                extra_items.append({
                    "fg_item": sco_line.item_code,
                    "fg_name": sco_line.item_name,
                    "qty": extra_q,
                    "warehouse": wh,
                    "uom": sco_line.stock_uom,
                    "svc_code": service_item_data.get("item_code"),
                    "svc_rate": service_item_data.get("rate"),
                    "svc_uom": service_item_data.get("uom")
                })

    # 2. PROCESS PURELY EXTRA ITEMS
    for user_item in items_to_receive:
        if user_item.get("name") in processed_guids: continue
        qty = flt(user_item.get("qty_to_receive"))
        if qty <= 0: continue
        
        sco_line = next((i for i in sco.items if i.name == user_item.get("name")), None)
        if sco_line:
            wh = (sco_line.warehouse or sco.set_warehouse or 
                  frappe.db.get_value("Company", sco.company, "default_warehouse"))
            
            extra_items.append({
                "fg_item": sco_line.item_code,
                "fg_name": sco_line.item_name,
                "qty": qty,
                "warehouse": wh,
                "uom": sco_line.stock_uom,
                "svc_code": service_item_data.get("item_code"),
                "svc_rate": service_item_data.get("rate"),
                "svc_uom": service_item_data.get("uom")
            })

    # --- DOCUMENT GENERATION ---
    scr_name, pr_name, se_name, extra_pr_name = None, None, None, None

    # A. NORMAL FLOW
    if final_scr_items:
        scr.items = final_scr_items
        scr.save(ignore_permissions=True)
        scr.submit()
        scr_name = scr.name
        
        pr = make_purchase_receipt_from_scr(scr.name)
        pr.save(ignore_permissions=True)
        pr.submit()
        pr_name = pr.name

    # B. EXTRA FLOW (With Custom Fields)
    if extra_items:
        # 1. STOCK ENTRY (Material Receipt)
        se = frappe.new_doc("Stock Entry")
        se.stock_entry_type = "Material Receipt"
        se.company = sco.company
        se.set_posting_time = 1
        
        # --- CUSTOM FIELDS SET HERE ---
        se.custom_extra_fg_collect_from_jobbers = 1
        se.custom_reference_id = sco.purchase_order 
        # ------------------------------

        for ex in extra_items:
            se.append("items", {
                "item_code": ex["fg_item"], # Real FG
                "qty": ex["qty"],
                "uom": ex["uom"],
                "t_warehouse": ex["warehouse"],
                "basic_rate": 0.0,
                "is_scrap_item": 0
            })
        se.insert(ignore_permissions=True)
        se.submit()
        se_name = se.name

        # 2. PURCHASE RECEIPT (Liability/Service)
        pr_svc = frappe.new_doc("Purchase Receipt")
        pr_svc.supplier = sco.supplier
        pr_svc.company = sco.company
        pr_svc.currency = po_doc.currency
        pr_svc.conversion_rate = po_doc.conversion_rate or 1
        pr_svc.set_posting_time = 1
        
        # REQUESTED SETTINGS
        pr_svc.is_subcontracted = 1
        
        # --- CUSTOM FIELDS SET HERE ---
        pr_svc.custom_extra_fg_collect_from_jobbers = 1
        pr_svc.custom_reference_id = sco.purchase_order
        # ------------------------------

        for ex in extra_items:
            pr_svc.append("items", {
                "item_code": ex["svc_code"], # Service/PO Item
                "qty": ex["qty"],
                "rate": ex["svc_rate"],
                "uom": ex["svc_uom"],
                "warehouse": "", # Non-stock ideally
                "description": f"Service charge for Extra {ex['fg_name']}"
            })
            
        pr_svc.insert(ignore_permissions=True)
        pr_svc.submit()
        extra_pr_name = pr_svc.name

    return {
        "scr_name": scr_name,
        "pr_name": pr_name,
        "se_name": se_name,
        "extra_pr_name": extra_pr_name
    }

# Mocking helper for function call, replace with standard frappe method
def make_subcontracting_receipt(sco_name):
    # This usually exists in erpnext.subcontracting.doctype.subcontracting_order.subcontracting_order
    from erpnext.subcontracting.doctype.subcontracting_order.subcontracting_order import make_subcontracting_receipt
    return make_subcontracting_receipt(sco_name)

def make_purchase_receipt_from_scr(scr_name):
    # This usually exists in erpnext.subcontracting.doctype.subcontracting_receipt.subcontracting_receipt
    from erpnext.subcontracting.doctype.subcontracting_receipt.subcontracting_receipt import make_purchase_receipt
    return make_purchase_receipt(scr_name)
# @frappe.whitelist()
# def check_over_collection_limit(sco_name, items_to_receive_json):
#     items_to_receive = frappe.parse_json(items_to_receive_json)
#     perc = frappe.get_single("Admin Settings").allow_over_collecting_of_fg or 0.0

#     sco = frappe.get_doc("Subcontracting Order", sco_name)
#     over_items = []
#     has_extra = False
#     is_over = False

#     for req in items_to_receive:
#         child_name = req.get("name")
#         requested_qty = flt(req.get("qty_to_receive"))

#         sco_item = next((i for i in sco.items if i.name == child_name), None)
#         if not sco_item:
#             continue

#         ordered_qty = flt(sco_item.qty)
#         received_qty = flt(sco_item.received_qty)
#         pending_qty = max(0, ordered_qty - received_qty)
#         max_allowed_total = ordered_qty * (1 + perc / 100)
#         max_allowed_remaining = max(0, max_allowed_total - received_qty)

#         extra_qty = requested_qty - pending_qty

#         if extra_qty > 0:
#             has_extra = True

#         if requested_qty > max_allowed_remaining:
#             is_over = True

#         if extra_qty > 0 or requested_qty > pending_qty:
#             over_items.append({
#                 "item_name": sco_item.item_name,
#                 "ordered_qty": ordered_qty,
#                 "received_qty": received_qty,
#                 "requested_qty": requested_qty,
#                 "max_allowed_qty": max_allowed_remaining,
#                 "pending_qty": pending_qty
#             })

#     return {
#         "has_extra": has_extra,
#         "is_over": is_over,
#         "allow_pct": perc,
#         "over_items": over_items
#     }

# def get_item_details_for_po(item_code):
#     if not item_code: return {}
#     details = frappe.db.get_value("Item", item_code, ["purchase_uom", "stock_uom", "description", "item_name"], as_dict=True)
#     if not details: return {}
#     uom = details.purchase_uom or details.stock_uom
#     factor = frappe.db.get_value("UOM Conversion Detail", {"parent": item_code, "uom": uom}, "conversion_factor") or 1.0
#     return {"uom": uom, "stock_uom": details.stock_uom, "description": details.description, "item_name": details.item_name, "conversion_factor": factor}



# import frappe
# from collections import defaultdict

# # -------------------------------------------------------------------------
# # 1. CREATE PICK LIST (Event: on_submit)
# # -------------------------------------------------------------------------
# @frappe.whitelist()
# def create_putaway_picklist(doc, method=None):
#     # Skip Subcontracting logic as per requirement (modify if needed)
#     if doc.is_subcontracted: 
#         return

#     try:
#         so_items_map = defaultdict(list)
        
#         # Loop over PR items to group them by Sales Order
#         for row in doc.items:
#             valid_qty = row.qty - (row.get("rejected_qty") or 0)
#             if valid_qty <= 0: continue
            
#             # Identify Link (new vs old naming convention)
#             po_item_link = row.get("purchase_order_item") or row.get("po_detail")
#             if not po_item_link: continue

#             # Fetch linked Sales Order details
#             po_data = frappe.db.get_value("Purchase Order Item", po_item_link, ["sales_order", "sales_order_item"], as_dict=True)
#             if not po_data or not po_data.sales_order: continue

#             so_items_map[po_data.sales_order].append({
#                 "item_code": row.item_code,
#                 "item_name": row.item_name,
#                 "warehouse": row.warehouse,
#                 "qty": valid_qty,
#                 "uom": row.uom,
#                 "stock_uom": row.stock_uom,
#                 "conversion_factor": row.conversion_factor or 1,
#                 "sales_order_item": po_data.sales_order_item,
#                 "serial_no": row.serial_no,
#                 "batch_no": row.batch_no
#             })

#         # Create Pick Lists
#         for so_name, items in so_items_map.items():
#             customer = frappe.db.get_value("Sales Order", so_name, "customer")
            
#             pl = frappe.new_doc("Pick List")
#             pl.company = doc.company
#             pl.purpose = "Delivery"
#             pl.customer = customer
            
#             # --- KEY CHANGE: Assign the Custom Link Field ---
#             pl.custom_purchase_receipt = doc.name 
            
#             # Set optional note for user reference
#             pl.custom_notes = f"Auto-created from PR: {doc.name}"
            
#             for i in items:
#                 pl.append("locations", {
#                     "item_code": i["item_code"],
#                     "item_name": i["item_name"],
#                     "warehouse": i["warehouse"],
#                     "qty": i["qty"],
#                     "uom": i["uom"],
#                     "stock_uom": i["stock_uom"],
#                     "stock_qty": i["qty"] * i["conversion_factor"],
#                     "conversion_factor": i["conversion_factor"],
#                     "sales_order": so_name,
#                     "sales_order_item": i["sales_order_item"],
#                     "serial_no": i["serial_no"],
#                     "batch_no": i["batch_no"]
#                 })
            
#             pl.insert(ignore_permissions=True)
#             frappe.msgprint(f"Pick List Created: <a href='/app/pick-list/{pl.name}'><b>{pl.name}</b></a>", indicator="green")

#     except Exception as e:
#         frappe.log_error(f"PL Creation Error: {str(e)}", "Pick List Automation")


# # -------------------------------------------------------------------------
# # 2. DELETE PICK LIST (Event: on_cancel)
# # -------------------------------------------------------------------------
# @frappe.whitelist()
# def delete_putaway_picklist(doc, method=None):
#     """
#     On Purchase Receipt Cancel:
#     - Finds linked Pick Lists via 'custom_purchase_receipt'.
#     - If Draft -> Deletes.
#     - If Submitted -> Cancels (un-reserves stock), then Deletes.
#     """
#     try:
#         # 1. Find all linked Pick Lists (Draft or Submitted)
#         # docstatus < 2 means getting Draft (0) and Submitted (1)
#         linked_pick_lists = frappe.db.get_all(
#             "Pick List",
#             filters={
#                 "custom_purchase_receipt": doc.name,
#                 "docstatus": ["<", 2] 
#             },
#             fields=["name", "docstatus"]
#         )

#         if not linked_pick_lists:
#             return

#         for pl_info in linked_pick_lists:
#             pl_doc = frappe.get_doc("Pick List", pl_info.name)

#             # A. If Submitted, Cancel it first to un-reserve items
#             if pl_info.docstatus == 1:
#                 pl_doc.cancel()
#                 # frappe.msgprint(f"Cancelled linked Pick List: {pl_info.name}")

#             # B. Now that it is Cancelled (or was Draft), Delete it
#             pl_doc.delete()

#         # Feedback to User
#         names = ", ".join([d.name for d in linked_pick_lists])
#         frappe.msgprint(
#             f"Auto-Cancelled and Deleted linked Pick List(s): <b>{names}</b>",
#             title="Cleanup Successful",
#             indicator="red"
#         )

#     except frappe.LinkExistsError:
#         # Standard error if Pick List is used in a Delivery Note
#         frappe.throw(
#             f"Cannot Cancel Purchase Receipt <b>{doc.name}</b> because the automated Pick List <b>{pl_doc.name}</b> "
#             "is already linked to a Delivery Note or another document. <br><br>"
#             "Please cancel the downstream document first."
#         )

#     except Exception as e:
#         frappe.log_error(f"PL Cancellation Error: {str(e)}", "Pick List Automation")
#         frappe.throw(f"Could not auto-cancel linked Pick List. Error: {str(e)}")






@frappe.whitelist()
def create_putaway_picklist(doc, method=None):
    from collections import defaultdict

    so_items_map = defaultdict(list)

    try:
        for row in doc.items:
            # 1. Basic Validation
            valid_qty = row.qty - (row.get("rejected_qty") or 0)
            if valid_qty <= 0:
                continue

            # 2. Detect linked PO Item
            po_item_link = row.get("purchase_order_item") or row.get("po_detail")
            if not po_item_link:
                continue

            # 3. Get PO Data
            # We try to get sales_order_item here, but sometimes it is None in the DB
            po_data = frappe.db.get_value(
                "Purchase Order Item",
                po_item_link,
                ["fg_item", "item_code", "sales_order", "sales_order_item"],
                as_dict=True,
            )

            if not po_data or not po_data.sales_order:
                continue

            # 4. Determine correct Item Code (Subcontracting vs Normal)
            if doc.is_subcontracted:
                # Use FG Item logic
                final_item_code = po_data.fg_item
                if not final_item_code:
                    continue
                final_item_name = frappe.db.get_value("Item", final_item_code, "item_name")
            else:
                final_item_code = row.item_code
                final_item_name = row.item_name

            # -----------------------------------------------------------
            # CRITICAL FIX: Find the Sales Order Row ID (sales_order_item)
            # -----------------------------------------------------------
            so_item_id = po_data.sales_order_item

            # If the PO doesn't have the link, we must find it manually in the SO
            if not so_item_id:
                so_item_id = frappe.db.get_value(
                    "Sales Order Item",
                    {
                        "parent": po_data.sales_order, 
                        "item_code": final_item_code
                    },
                    "name"
                )

            # If we still don't have a link, we can't create a valid Pick List item
            if not so_item_id:
                frappe.log_error(f"Skipping Item {final_item_code}: Linked Sales Order Item not found in {po_data.sales_order}")
                continue

            # 5. Add to Map
            so_items_map[po_data.sales_order].append({
                "item_code": final_item_code,
                "item_name": final_item_name,
                "warehouse": row.warehouse,
                "qty": valid_qty,
                "uom": row.uom,
                "stock_uom": row.stock_uom,
                "conversion_factor": row.conversion_factor or 1,
                "sales_order_item": so_item_id, # <--- This is the variable that fixes the DN issue
                "serial_no": row.serial_no,
                "batch_no": row.batch_no
            })

        # -----------------------------------------------------------
        # BUILD PICK LISTS (Draft Mode)
        # -----------------------------------------------------------
        for so_name, items in so_items_map.items():
            customer = frappe.db.get_value("Sales Order", so_name, "customer")
            
            pl = frappe.new_doc("Pick List")
            pl.company = doc.company
            pl.purpose = "Delivery"
            pl.customer = customer
            pl.parent_warehouse = doc.set_warehouse
            pl.custom_purchase_receipt = doc.name
            pl.custom_notes = f"Created from PR {doc.name}"

            for i in items:
                pl.append("locations", {
                    "item_code": i["item_code"],
                    "item_name": i["item_name"],
                    "warehouse": i["warehouse"],
                    "qty": i["qty"],
                    "uom": i["uom"],
                    "stock_uom": i["stock_uom"],
                    "stock_qty": i["qty"] * i["conversion_factor"],
                    "conversion_factor": i["conversion_factor"],
                    "sales_order": so_name,
                    "sales_order_item": i["sales_order_item"], # Ensure this is populated
                    "serial_no": i["serial_no"],
                    "batch_no": i["batch_no"]
                })

            # Save as Draft (No Submit)
            pl.insert(ignore_permissions=True)
            
            frappe.msgprint(
                f"Pick List Created (Draft): <a href='/app/pick-list/{pl.name}'><b>{pl.name}</b></a>", 
                indicator="green"
            )

    except Exception as e:
        frappe.log_error(f"PL Creation Error: {str(e)}", "Pick List Automation")

# -------------------------------------------------------------------------
# 2. DELETE PICK LIST (Event: on_cancel)
# -------------------------------------------------------------------------
# No changes needed here, keeping logic consistent
@frappe.whitelist()
def delete_putaway_picklist(doc, method=None):
    try:
        linked_pick_lists = frappe.db.get_all(
            "Pick List",
            filters={
                "custom_purchase_receipt": doc.name,
                "docstatus": ["<", 2] 
            },
            fields=["name", "docstatus"]
        )

        if not linked_pick_lists:
            return

        for pl_info in linked_pick_lists:
            pl_doc = frappe.get_doc("Pick List", pl_info.name)
            if pl_info.docstatus == 1:
                pl_doc.cancel()
            pl_doc.delete()

        names = ", ".join([d.name for d in linked_pick_lists])
        frappe.msgprint(
            f"Auto-Cancelled and Deleted linked Pick List(s): <b>{names}</b>",
            title="Cleanup Successful",
            indicator="red"
        )

    except frappe.LinkExistsError:
        frappe.throw(
            f"Cannot Cancel Purchase Receipt <b>{doc.name}</b> because the automated Pick List <b>{pl_doc.name}</b> "
            "is already linked to a Delivery Note or another document. <br><br>"
            "Please cancel the downstream document first."
        )

    except Exception as e:
        frappe.log_error(f"PL Cancellation Error: {str(e)}", "Pick List Automation")
        frappe.throw(f"Could not auto-cancel linked Pick List. Error: {str(e)}")












####Purchase Invoice####
# import frappe

# @frappe.whitelist()
# def get_pending_pr_items(supplier):
#     if not supplier:
#         return []

#     # FIX: We Calculate Billed Qty dynamically by joining 'tabPurchase Invoice Item'
#     # We look for Purchase Invoice Items that point to this PR Detail (pr_detail)
#     # and are submitted (docstatus=1).
    
#     sql_query = """
#         SELECT 
#             pr.name as pr_name, 
#             pr.posting_date,
#             pri.name as pr_detail, 
#             pri.item_code, 
#             pri.item_name, 
#             pri.uom,
#             pri.rate, 
#             pri.qty as order_qty, 
#             pri.received_qty, 
            
#             -- Calculate Total Billed Qty from linked Invoice Items
#             IFNULL(SUM(pii.qty), 0) as billed_qty,
            
#             -- Calculate Pending
#             (pri.received_qty - IFNULL(SUM(pii.qty), 0)) as pending_qty,
            
#             pri.amount,
#             pri.cost_center,
#             pri.expense_account
#         FROM 
#             `tabPurchase Receipt` pr
#         JOIN 
#             `tabPurchase Receipt Item` pri ON pri.parent = pr.name
        
#         -- LEFT JOIN to find linked Invoice Items
#         LEFT JOIN
#             `tabPurchase Invoice Item` pii ON pii.pr_detail = pri.name AND pii.docstatus = 1
            
#         WHERE 
#             pr.supplier = %s 
#             AND pr.docstatus = 1 
#             AND pr.status != 'Closed'
#             AND pr.status != 'Completed'
            
#         GROUP BY
#             pri.name
            
#         HAVING 
#             pending_qty > 0
            
#         ORDER BY 
#             pr.posting_date DESC
#     """
    
#     data = frappe.db.sql(sql_query, (supplier,), as_dict=True)
#     return data 





# ############# embroidery work order #############
# @frappe.whitelist()
# def create_embroidery_work_order(po_name, sco_name, items_to_send, notes="", supplier=None, stage="Pre-Receipt"):
#     """
#     Creates an Embroidery Work Order and sets its stage (Pre/Post-Receipt).
#     """
#     import json
#     items = json.loads(items_to_send)
#     po_doc = frappe.get_doc("Purchase Order", po_name)

#     ewo = frappe.new_doc("Embroidery Work Order")
#     ewo.purchase_order = po_name
#     ewo.subcontracting_order = sco_name
#     ewo.supplier = supplier if supplier else po_doc.supplier
#     ewo.date = nowdate()
#     ewo.notes = notes
#     ewo.stage = stage  # <-- SET THE STAGE HERE

#     for item_data in items:
#         ewo.append("items", {
#             "item_code": item_data.get("item_code"),
#             "item_name": item_data.get("item_name"),
#             "ordered_qty": item_data.get("qty_to_send"),
#             "received_qty": 0,
#             "pending_qty": item_data.get("qty_to_send")
#         })

#     ewo.insert(ignore_permissions=True)
#     ewo.submit()
#     return ewo.name



# import frappe
# from frappe.utils import cint

# @frappe.whitelist()
# def get_pending_pr_items(supplier, is_subcontracted=0):
#     if not supplier:
#         return []

#     # Ensure we have an integer 0 or 1 for the SQL query
#     is_subcontracted_val = cint(is_subcontracted)
    
#     sql_query = """
#         SELECT 
#             pr.name as pr_name, 
#             pr.posting_date,
#             pr.is_subcontracted,
#             pri.name as pr_detail, 
#             pri.item_code, 
#             pri.item_name, 
#             pri.uom,
#             pri.rate, 
#             pri.received_qty, 
            
#             -- Calculate Total Billed Qty (using subquery for accuracy)
#             IFNULL((
#                 SELECT SUM(pii.qty) 
#                 FROM `tabPurchase Invoice Item` pii 
#                 WHERE pii.pr_detail = pri.name 
#                 AND pii.docstatus = 1
#             ), 0) as billed_qty,
            
#             -- Calculate Pending
#             (pri.received_qty - IFNULL((
#                 SELECT SUM(pii.qty) 
#                 FROM `tabPurchase Invoice Item` pii 
#                 WHERE pii.pr_detail = pri.name 
#                 AND pii.docstatus = 1
#             ), 0)) as pending_qty,
            
#             pri.cost_center,
#             pri.expense_account
#         FROM 
#             `tabPurchase Receipt` pr
#         JOIN 
#             `tabPurchase Receipt Item` pri ON pri.parent = pr.name
#         WHERE 
#             pr.supplier = %(supplier)s 
#             AND pr.docstatus = 1 
#             AND IFNULL(pr.is_subcontracted, 0) = %(is_subcontracted)s
#             AND pr.status NOT IN ('Closed', 'Completed')
#         HAVING 
#             pending_qty > 0.0001
#         ORDER BY 
#             pr.posting_date DESC
#     """
    
#     return frappe.db.sql(sql_query, {
#         "supplier": supplier,
#         "is_subcontracted": is_subcontracted_val
#     }, as_dict=True)














import frappe
from frappe.utils import cint

@frappe.whitelist()
def get_pending_pr_items(supplier, is_subcontracted=0):
    if not supplier:
        return []

    is_subcontracted_val = cint(is_subcontracted)
    
    sql_query = """
        SELECT 
            pr.name as pr_name, 
            pr.posting_date,
            pr.is_subcontracted,
            pri.name as pr_detail, 
            pri.item_code, 
            pri.item_name, 
            pri.uom,
            pri.rate, 
            pri.received_qty, 
            
            -- Calculate Total Billed Qty (using subquery for accuracy)
            IFNULL((
                SELECT SUM(pii.qty) 
                FROM `tabPurchase Invoice Item` pii 
                WHERE pii.pr_detail = pri.name 
                AND pii.docstatus = 1
            ), 0) as billed_qty,
            
            -- Calculate Pending
            (pri.received_qty - IFNULL((
                SELECT SUM(pii.qty) 
                FROM `tabPurchase Invoice Item` pii 
                WHERE pii.pr_detail = pri.name 
                AND pii.docstatus = 1
            ), 0)) as pending_qty,
            
            pri.cost_center,
            pri.expense_account,
            pr.supplier_warehouse, # Make sure this is still here
            po_item.fg_item as finished_good_item_code, # Make sure this is still here
            po_item.qty as po_item_qty, 
            po_item.item_code as po_item_code 
        FROM 
            `tabPurchase Receipt` pr
        JOIN 
            `tabPurchase Receipt Item` pri ON pri.parent = pr.name
        LEFT JOIN 
            `tabPurchase Order Item` po_item ON po_item.name = pri.purchase_order_item
        WHERE 
            pr.supplier = %(supplier)s 
            AND pr.docstatus = 1 
            AND IFNULL(pr.is_subcontracted, 0) = %(is_subcontracted)s
            AND pr.status NOT IN ('Closed', 'Completed')
        HAVING 
            pending_qty > 0.0001
        ORDER BY 
            pr.posting_date DESC
    """
    
    return frappe.db.sql(sql_query, {
        "supplier": supplier,
        "is_subcontracted": is_subcontracted_val
    }, as_dict=True)









# @frappe.whitelist()
# def get_sco_status_for_po(purchase_order_name):
#     """
#     Determines status to toggle buttons on the PO.
#     - fg_received=False: Show Panel Job Buttons
#     - fg_received=True:  Show Full Piece Job Buttons
#     """
#     # Find linked Subcontracting Order (SCO)
#     sco_list = frappe.get_all("Subcontracting Order", filters={"purchase_order": purchase_order_name, "docstatus": 1}, fields=["name"])
    
#     if not sco_list:
#         return {"sco_exists": False}

#     sco_name = sco_list[0].name
#     sco_doc = frappe.get_doc("Subcontracting Order", sco_name)
    
#     # Analyze Items in SCO
#     items_pending = False      # Is there balance to receive from Main Jobber?
#     fg_received_total = 0      # Have we received ANY finished goods yet?
#     is_panel_job_open = False  # To lock "Receive" button if panel work is running

#     # Check for active panel jobs (prevents user from Receiving FG if active)
#     active_panel = frappe.db.count("Embroidery Work Order", {
#         "subcontracting_order": sco_name, 
#         "work_type": "Panel Job Work", 
#         "stage": ["in", ["Received from Jobber (Internal)", "Sent to Panel Jobber", "Received from Panel Jobber"]] 
#     })
#     if active_panel > 0:
#         is_panel_job_open = True

#     # Check Stock Levels on SCO
#     for item in sco_doc.items:
#         if item.received_qty < item.qty:
#             items_pending = True
#         fg_received_total += item.received_qty

#     return {
#         "sco_exists": True,
#         "sco_name": sco_name,
#         "items_pending": items_pending, 
#         "is_panel_job_open": is_panel_job_open,
#         "fg_received": fg_received_total > 0 # This determines the Button Switch
#     }




# @frappe.whitelist()
# def get_sco_status_for_po(purchase_order_name):
#     """
#     Checks status using 'panel_stage' field specifically.
#     """
#     # 1. Find SCO
#     sco_list = frappe.get_all("Subcontracting Order", filters={"purchase_order": purchase_order_name, "docstatus": 1}, fields=["name"])
#     if not sco_list:
#         return {"sco_exists": False}

#     sco_name = sco_list[0].name
#     sco_doc = frappe.get_doc("Subcontracting Order", sco_name)

#     # 2. Check Items Pending on SCO
#     items_pending = False
#     fg_received_total = 0
#     for item in sco_doc.items:
#         if item.received_qty < item.qty:
#             items_pending = True
#         fg_received_total += item.received_qty
#     # print("items_pending", items_pending)
#     # print("fg_received_total", fg_received_total)
#     # 3. Check Embroidery Work Orders using 'panel_stage'
#     # Fetching specifically the field 'panel_stage'
#     panel_jobs = frappe.get_all("Embroidery Work Order", 
#         filters={
#             "purchase_order": purchase_order_name, 
#             "work_type": "Panel Job Work",
#             "docstatus": 1
#         },
#         fields=["name", "panel_stage"] 
#     )

#     is_panel_job_open = False
#     has_closed_panel_job = False
    
#     # Exact text to match
#     closed_status = "Returned to Jobber (Closed)"
#     # Statuses that count as "Finished" (Job is not running)
#     ignore_statuses = [closed_status]

#     for job in panel_jobs:
#         current_stage = (job.get("panel_stage") or "").strip()

#         # Condition 1: Check if this specific job is the closed one
#         if current_stage == closed_status:
#             has_closed_panel_job = True

#         # Condition 2: Check if this job is currently "Open" / Running
#         # If it's NOT in our list of ignored/closed statuses, we assume it is open/running.
#         if current_stage not in ignore_statuses:
#             is_panel_job_open = True

#     return {
#         "sco_exists": True,
#         "sco_name": sco_name,
#         "items_pending": items_pending, 
#         "is_panel_job_open": is_panel_job_open,
#         "fg_received": fg_received_total > 0,
#         "has_closed_panel_job": has_closed_panel_job
#     }



@frappe.whitelist()
def get_sco_status_for_po(purchase_order_name):
    po_doc = frappe.get_doc("Purchase Order", purchase_order_name)
    sco_name = frappe.db.get_value("Subcontracting Order", 
        {"purchase_order": purchase_order_name, "docstatus": 1}, "name")

    items_pending = False
    fg_received_total = 0

    if sco_name:
        sco_doc = frappe.get_doc("Subcontracting Order", sco_name)
        for item in sco_doc.items:
            if flt(item.received_qty) < flt(item.qty): items_pending = True
            fg_received_total += flt(item.received_qty)
    else:
        # For non-subcontracted orders (Direct)
        for item in po_doc.items:
            if flt(item.received_qty) < flt(item.qty): items_pending = True
            fg_received_total += flt(item.received_qty)

    # Embroidery Check
    panel_jobs = frappe.get_all("Embroidery Work Order", 
        filters={"purchase_order": purchase_order_name, "work_type": "Panel Job Work", "docstatus": 1},
        fields=["name", "panel_stage"] 
    )

    is_panel_job_open = False
    has_closed_panel_job = False
    closed_text = "Returned to Jobber (Closed)"

    for job in panel_jobs:
        if job.panel_stage == closed_text:
            has_closed_panel_job = True
        else:
            is_panel_job_open = True

    return {
        "sco_exists": sco_name is not None,
        "sco_name": sco_name,
        "items_pending": items_pending, 
        "is_panel_job_open": is_panel_job_open,
        "fg_received": fg_received_total > 0,
        "has_closed_panel_job": has_closed_panel_job
    }



# @frappe.whitelist()
# def get_panel_work_summary(sco_name):
#     # 1. Fetch Aggregated Ordered Qty (Grouping by Item Code)
#     sql = """
#         SELECT 
#             item_code, 
#             MIN(item_name) as item_name, 
#             SUM(qty) as ordered_qty 
#         FROM `tabSubcontracting Order Item` 
#         WHERE parent = %s 
#         GROUP BY item_code
#     """
#     all_sco_items = frappe.db.sql(sql, (sco_name), as_dict=1)
    
#     # 2. Fetch Work Orders
#     ewos = frappe.db.get_all("Embroidery Work Order", 
#         filters={"subcontracting_order": sco_name, "docstatus": ["!=", 2]}, 
#         fields=["name", "panel_stage", "date", "panel_jobber"],
#         order_by="creation desc"
#     )
    
#     # ... (Logic for separating active/closed remains the same)
    
#     active_ewo_names = []
#     closed_ewos = []
#     for e in ewos:
#         if e.panel_stage == 'Returned to Jobber (Closed)':
#             closed_ewos.append(e.name)
#         else:
#             active_ewo_names.append(e.name)

#     # 3. Sum Quantities (Map Logic)
#     proc_map = {} 
#     qty_in_progress = {}
#     qty_completed = {}

#     if ewos:
#         all_ewo_items = frappe.db.get_all("Embroidery Work Order Item", 
#             filters={"parent": ["in", [x.name for x in ewos]]}, 
#             fields=["parent", "item_code", "ordered_qty", "received_qty", "item_name"]
#         )
        
#         for i in all_ewo_items:
#             # Map for Active Table details
#             if i.parent not in proc_map: proc_map[i.parent] = []
#             proc_map[i.parent].append(i)

#             # Sum for Summary Table
#             if i.parent in closed_ewos:
#                 qty_completed[i.item_code] = qty_completed.get(i.item_code, 0) + i.ordered_qty
#             else:
#                 qty_in_progress[i.item_code] = qty_in_progress.get(i.item_code, 0) + i.ordered_qty

#     # 4. Final Processing
#     processed_items = []
#     for item in all_sco_items:
#         comp = qty_completed.get(item.item_code, 0)
#         prog = qty_in_progress.get(item.item_code, 0)
        
#         # Calculation for Total Collected so far (Active + Done)
#         total_collected = comp + prog
        
#         # Only cap display for cleanliness; pending math allows new creation logic if needed
#         item['completed_qty'] = comp
#         item['progress_qty'] = prog
#         item['collected_qty'] = total_collected 
#         # Calculate real pending based on TOTAL order vs TOTAL collected
#         item['pending_qty'] = max(0, item.ordered_qty - total_collected)
        
#         processed_items.append(item)

#     # 5. Generate Active Process List Details (Unchanged logic)
#     active_processes = []
#     for p in ewos:
#         if p.name in active_ewo_names: 
#             p_items = proc_map.get(p.name, [])
#             parts = []
#             for pi in p_items:
#                 sent = int(pi.ordered_qty)
#                 rec = int(pi.received_qty or 0)
                
#                 # Visual Logic
#                 status_color = "#e67e22" # Orange (Partial)
#                 status_label = f"Pending Recv ({rec})"
                
#                 if rec >= sent: 
#                     status_color = "#28a745" # Green
#                     status_label = f"<b>✔ All Recv ({rec})</b>"
#                 elif rec > 0:
#                     status_label = f"<b>Partial ({rec}/{sent})</b>"
#                 else:
#                     status_color = "#e74c3c" # Red
                
#                 # Clean visual item
#                 html = f"""<div style='border-left:3px solid {status_color}; padding-left:6px; margin-bottom:3px;'>
#                     <div style='font-weight:600;font-size:11px;color:#333;'>{pi.item_name}</div>
#                     <div style='font-size:10px;color:#666;'>Sent: {sent} | <span style='color:{status_color}'>{status_label}</span></div>
#                 </div>"""
#                 parts.append(html)
            
#             p['details_html'] = "".join(parts) if parts else "-"
#             active_processes.append(p)

#     return { "all_items": processed_items, "active_processes": active_processes }


@frappe.whitelist()
def get_panel_work_summary(po_name):
    # 1. Determine Context (Check if an SCO exists for this PO)
    sco_name = frappe.db.get_value("Subcontracting Order", 
        {"purchase_order": po_name, "docstatus": 1}, "name")
    
    # 2. Fetch Base Items (Where process begins)
    # If Subcontracting Order exists, we follow its Finished Goods.
    # Otherwise, we follow the items on the Purchase Order itself.
    if sco_name:
        sql = """
            SELECT 
                item_code, 
                MIN(item_name) as item_name, 
                SUM(qty) as ordered_qty 
            FROM `tabSubcontracting Order Item` 
            WHERE parent = %s 
            GROUP BY item_code
        """
        all_items = frappe.db.sql(sql, (sco_name), as_dict=1)
    else:
        sql = """
            SELECT 
                item_code, 
                MIN(item_name) as item_name, 
                SUM(qty) as ordered_qty 
            FROM `tabPurchase Order Item` 
            WHERE parent = %s 
            GROUP BY item_code
        """
        all_items = frappe.db.sql(sql, (po_name), as_dict=1)

    # 3. Fetch all Work Orders linked to this Purchase Order (Works for both)
    ewos = frappe.db.get_all("Embroidery Work Order", 
        filters={"purchase_order": po_name, "work_type": "Panel Job Work", "docstatus": ["!=", 2]}, 
        fields=["name", "panel_stage", "date", "panel_jobber"],
        order_by="creation desc"
    )
    
    active_ewo_names = []
    closed_ewo_names = []
    for e in ewos:
        if e.panel_stage == 'Returned to Jobber (Closed)':
            closed_ewo_names.append(e.name)
        else:
            active_ewo_names.append(e.name)

    # 4. Map Work Order progress to summary items
    proc_map = {} 
    qty_in_progress = {}
    qty_completed = {}

    if ewos:
        # Get all child items for these Work Orders
        all_ewo_items = frappe.db.get_all("Embroidery Work Order Item", 
            filters={"parent": ["in", [x.name for x in ewos]]}, 
            fields=["parent", "item_code", "ordered_qty", "received_qty", "item_name"]
        )
        
        for i in all_ewo_items:
            # Table visualization mapping
            if i.parent not in proc_map: proc_map[i.parent] = []
            proc_map[i.parent].append(i)

            # Calculation mapping
            if i.parent in closed_ewo_names:
                qty_completed[i.item_code] = qty_completed.get(i.item_code, 0) + i.ordered_qty
            else:
                qty_in_progress[i.item_code] = qty_in_progress.get(i.item_code, 0) + i.ordered_qty

    # 5. Build final "Incoming/Summary" table
    processed_items = []
    for item in all_items:
        comp = qty_completed.get(item.item_code, 0)
        prog = qty_in_progress.get(item.item_code, 0)
        total_collected = comp + prog
        
        item['completed_qty'] = comp
        item['progress_qty'] = prog
        item['collected_qty'] = total_collected 
        item['pending_qty'] = max(0, item.ordered_qty - total_collected)
        processed_items.append(item)

    # 6. Build final "Active Process" details for HTML
    active_processes = []
    for p in ewos:
        if p.name in active_ewo_names: 
            p_items = proc_map.get(p.name, [])
            parts = []
            for pi in p_items:
                sent = int(pi.ordered_qty)
                rec = int(pi.received_qty or 0)
                
                status_color = "#e67e22" if rec < sent else "#28a745"
                status_label = f"Partial ({rec}/{sent})" if 0 < rec < sent else (f"<b>✔ Recv ({rec})</b>" if rec >= sent else "Waiting")
                
                html = f"""<div style='border-left:3px solid {status_color}; padding-left:6px; margin-bottom:3px;'>
                    <div style='font-weight:600;font-size:11px;'>{pi.item_name}</div>
                    <div style='font-size:10px;color:#666;'>Qty: {sent} | <span style='color:{status_color}'>{status_label}</span></div>
                </div>"""
                parts.append(html)
            
            p['details_html'] = "".join(parts) if parts else "-"
            active_processes.append(p)

    return { "all_items": processed_items, "active_processes": active_processes, "sco_name": sco_name }





@frappe.whitelist()
def create_embroidery_work_order(po_name, sco_name, items_to_send, notes="", supplier=None, panel_jobber=None, type="Normal Embroidery", stage="Pre-Receipt"):
    import json
    items = json.loads(items_to_send)
    po_doc = frappe.get_doc("Purchase Order", po_name)

    ewo = frappe.new_doc("Embroidery Work Order")
    ewo.purchase_order = po_name
    ewo.subcontracting_order = sco_name
    ewo.supplier = supplier if supplier else po_doc.supplier # Actual Jobber
    ewo.date = frappe.utils.nowdate()
    ewo.notes = notes
    
    # 1. Save Work Type
    if hasattr(ewo, 'work_type'):
        ewo.work_type = type
    
    if type == "Panel Job Work":
        # 2. Save Panel Fields
        if hasattr(ewo, 'panel_jobber'):
             ewo.panel_jobber = panel_jobber
        if hasattr(ewo, 'panel_stage'):
             ewo.panel_stage = stage # Starts as "1. Received from Actual Jobber"
    else:
        # Normal flow
        ewo.stage = stage

    # Add Items
    for item_data in items:
        ewo.append("items", {
            "item_code": item_data.get("item_code"),
            "item_name": item_data.get("item_name"),
            "ordered_qty": item_data.get("qty_to_send"),
            "received_qty": 0,
            "pending_qty": item_data.get("qty_to_send")
        })

    ewo.insert(ignore_permissions=True)
    ewo.submit()
    return ewo.name
@frappe.whitelist()
def update_panel_process_stage(name, next_stage, notes="", panel_jobber=None):
    # Fetch doc
    doc = frappe.get_doc("Embroidery Work Order", name)
    
    # 1. Update the Stage
    doc.panel_stage = next_stage
    
    # 2. Update Panel Jobber if provided
    if panel_jobber and hasattr(doc, 'panel_jobber'):
        doc.panel_jobber = panel_jobber

    # 3. Append Notes (FIXED DATE FORMATTING)
    # Formats to: 05-12-2025 02:30 PM
    formatted_now = frappe.utils.format_datetime(frappe.utils.now(), "dd-MM-yyyy hh:mm a")
    
    # Clean string construction
    new_note = f"\n• {formatted_now}: Status changed to '{next_stage}'."
    if notes:
        new_note += f" Comment: {notes}"

    doc.notes = (doc.notes or "") + new_note
    
    doc.save(ignore_permissions=True)
    return True




@frappe.whitelist()
def get_pending_sco_items_for_embroidery(sco_name):
    sco = frappe.get_doc("Subcontracting Order", sco_name)
    pending_items = []
    for item in sco.items:
        # We need to find the pending qty for subcontracting
        pending_qty = item.qty - item.received_qty
        if pending_qty > 0.001:
            pending_items.append({
                "item_code": item.item_code,
                "item_name": item.item_name,
                "pending_qty": pending_qty,
                "sco_item_child_id": item.name # To link back if needed
            })
    return pending_items





@frappe.whitelist()
def receive_embroidery_items(ewo_name, items_to_receive):
    import json
    items = json.loads(items_to_receive)
    ewo = frappe.get_doc("Embroidery Work Order", ewo_name)

    for received_item in items:
        for ewo_item in ewo.items:
            if ewo_item.name == received_item.get("child_id"):
                new_received_qty = flt(ewo_item.received_qty) + flt(received_item.get("qty_to_receive"))
                ewo_item.received_qty = new_received_qty
                ewo_item.pending_qty = flt(ewo_item.ordered_qty) - new_received_qty
                break # Move to the next received item

    # The custom script on the doctype will handle status updates, but we can also do it here for safety
    total_ordered = sum(item.ordered_qty for item in ewo.items)
    total_received = sum(item.received_qty for item in ewo.items)
    ewo.per_received = (total_received / total_ordered) * 100 if total_ordered else 100
    if ewo.per_received >= 100:
        ewo.status = "Completed"
    elif ewo.per_received > 0:
        ewo.status = "Partially Received"
    
    ewo.save(ignore_permissions=True)
    return ewo.name

@frappe.whitelist()
def get_pending_ewo_items(ewo_name):
    ewo = frappe.get_doc("Embroidery Work Order", ewo_name)
    pending_items = []
    for item in ewo.items:
        if item.pending_qty > 0.001:
            pending_items.append({
                "child_id": item.name,
                "item_code": item.item_code,
                "item_name": item.item_name,
                "ordered_qty": item.ordered_qty,
                "previously_received_qty": item.received_qty, # NEW
                "pending_qty": item.pending_qty
            })
    return pending_items


@frappe.whitelist()
def get_received_sco_items_for_embroidery(sco_name):
    """
    Fetches items that have already been RECEIVED against a Subcontracting Order.
    This is used for creating a post-receipt Embroidery Work Order.
    """
    sco = frappe.get_doc("Subcontracting Order", sco_name)
    received_items = []
    for item in sco.items:
        # We only care about items that have a received quantity > 0
        if item.received_qty > 0:
            received_items.append({
                "item_code": item.item_code,
                "item_name": item.item_name,
                # The quantity available to send is the quantity that was received.
                "available_qty": item.received_qty 
            })
    return received_items





@frappe.whitelist()
def get_po_full_piece_summary(po_name):
    # 1. Identify Linked SCO
    sco = frappe.db.get_value("Subcontracting Order", {"purchase_order": po_name, "docstatus": 1}, "name")
    
    # 2. Get TOTAL Physically Received Goods from Manufacturer
    # We group by Item Code because multiple SCO receipts might exist
    sql_received = """
        SELECT item_code, MIN(item_name) as item_name, SUM(received_qty) as total_received
        FROM `tabSubcontracting Order Item`
        WHERE parent = %s
        GROUP BY item_code
        HAVING SUM(received_qty) > 0
    """
    fg_items = frappe.db.sql(sql_received, (sco), as_dict=1)

    # 3. Calculate usage (How many sent for Full Piece Job already?)
    # Strict Filter: work_type = "Full Piece Job Work"
    ewos = frappe.db.get_all("Embroidery Work Order", 
        filters={
            "purchase_order": po_name,
            "work_type": "Full Piece Job Work",
            "docstatus": ["!=", 2]
        },
        fields=["name", "full_piece_stage", "date", "full_piece_jobber"],
        order_by="creation desc"
    )

    used_map = {}
    proc_map = {} # For Detailed HTML mapping

    if ewos:
        # Sum up qty sent to Full Piece Jobbers
        ewo_items = frappe.db.get_all("Embroidery Work Order Item", 
            filters={"parent": ["in", [x.name for x in ewos]]},
            fields=["parent", "item_code", "ordered_qty", "received_qty", "item_name"]
        )
        
        for i in ewo_items:
            used_map[i.item_code] = used_map.get(i.item_code, 0) + i.ordered_qty
            
            # Organize active details
            if i.parent not in proc_map: proc_map[i.parent] = []
            proc_map[i.parent].append(i)

    # 4. Prepare "Pending" List (Inventory Logic)
    processed_items = []
    for item in fg_items:
        used = used_map.get(item.item_code, 0)
        
        # LOGIC:
        # Available for Full Piece = (Total Received from Manuf.) - (Already Sent for Full Piece)
        balance = max(0, item.total_received - used)
        
        item['sent_qty'] = used
        item['pending_qty'] = balance
        processed_items.append(item)

    # 5. HTML Details for Dashboard
    active_processes = []
    for p in ewos:
        p_items = proc_map.get(p.name, [])
        parts = []
        for pi in p_items:
            sent = int(pi.ordered_qty)
            rec = int(pi.received_qty or 0)
            
            # Status colors
            if rec >= sent:
                status = f"<span class='text-success font-weight-bold'>✓ Recv: {rec}</span>"
            else:
                status = f"<span class='text-info'>In Work: {sent}</span>"
            
            # Clean layout for the table cell
            parts.append(f"<div style='border-bottom:1px dashed #eee; margin-bottom:2px;'><b>{pi.item_name}</b> {status}</div>")
        
        p['details_html'] = "".join(parts) if parts else "-"
        active_processes.append(p)

    return { "all_items": processed_items, "active_processes": active_processes }






@frappe.whitelist()
def get_full_piece_summary(sco_name):
    """
    Calculates quantities for Full Piece Dashboard.
    Source: Finished Goods Received from SCO (via Purchase Receipt).
    Minus: Quantities already sent to Full Piece Jobber.
    """
    sco_doc = frappe.get_doc("Subcontracting Order", sco_name)
    summary_items = []

    # Get Active Full Piece Processes
    active_processes = frappe.get_all("Embroidery Work Order", 
        filters={
            "subcontracting_order": sco_name,
            "work_type": "Full Piece Job Work",
            "full_piece_stage": "Sent to Full Piece Jobber", # Only show active/sent ones in bottom list
            "docstatus": 1
        },
        fields=["name", "date", "full_piece_jobber", "full_piece_stage"],
        order_by="creation desc"
    )

    # Process items to check Stock Availability for Full Piece
    for item in sco_doc.items:
        # 1. Total Finished Good Qty Received from Main Jobber (Base Availability)
        total_received_from_po = item.received_qty 

        # 2. Calculate how many are already sent for Full Piece Work
        total_sent_full_piece = frappe.db.sql("""
            SELECT SUM(child.ordered_qty) 
            FROM `tabEmbroidery Work Order` par
            JOIN `tabEmbroidery Work Order Item` child ON child.parent = par.name
            WHERE par.subcontracting_order = %s 
            AND par.work_type = 'Full Piece Job Work'
            AND child.item_code = %s
            AND par.docstatus = 1
        """, (sco_name, item.item_code))[0][0] or 0
        
        balance_qty = total_received_from_po - total_sent_full_piece
        
        # We need this item logic if there is balance to send
        summary_items.append({
            "item_code": item.item_code,
            "item_name": item.item_name,
            "total_recvd_from_po": total_received_from_po,
            "already_sent_full_piece": total_sent_full_piece,
            "balance_pending": balance_qty if balance_qty > 0 else 0
        })

    # Add HTML details for active processes
    for proc in active_processes:
        items = frappe.get_all("Embroidery Work Order Item", filters={"parent": proc.name}, fields=["item_name", "ordered_qty"])
        details_html = "<ul class='pl-3 mb-0'>" + "".join([f"<li><b>{i.item_name}:</b> {int(i.ordered_qty)} pcs</li>" for i in items]) + "</ul>"
        proc["details_html"] = details_html

    return {
        "available_items": summary_items,
        "active_processes": active_processes
    }




@frappe.whitelist()
def update_full_piece_stage(name, next_stage, notes=""):
    """ Updates the Full Piece Stage to close it. """
    doc = frappe.get_doc("Embroidery Work Order", name)
    doc.full_piece_stage = next_stage
    doc.notes = notes
    doc.save(ignore_permissions=True)

@frappe.whitelist()
def create_full_piece_order(sco_name, items_data, supplier):
    """ Creates EWO for Full Piece """
    import json
    from frappe.utils import nowdate
    items = json.loads(items_data)
    
    # Fetch SCO to get PO link
    sco = frappe.db.get_value("Subcontracting Order", sco_name, "purchase_order")
    
    ewo = frappe.new_doc("Embroidery Work Order")
    ewo.subcontracting_order = sco_name
    ewo.purchase_order = sco # Optional based on your logic
    ewo.type = "Full Piece Job Work"
    ewo.full_piece_jobber = supplier
    ewo.full_piece_stage = "Sent to Full Piece Jobber" # Initial Step
    ewo.date = nowdate()
    
    for i in items:
        ewo.append("items", {
            "item_code": i['item_code'],
            "item_name": i['item_name'],
            "ordered_qty": i['qty'],
            "pending_qty": i['qty'], # Used for next step
        })
        
    ewo.insert(ignore_permissions=True)
    ewo.submit()




@frappe.whitelist()
def create_full_piece_receipt(ewo_name, items_data, notes=None):
    """ STEP 2: RECEIVE BACK """
    items = json.loads(items_data) # [{name: row_name, qty: received_qty}, ...]
    doc = frappe.get_doc("Embroidery Work Order", ewo_name)
    
    all_done = True
    
    for input_row in items:
        # Match input to Child Table Row
        for row in doc.items:
            if row.name == input_row['name']:
                current_recv = flt(row.received_qty) + flt(input_row['qty'])
                
                # Validation
                if current_recv > row.ordered_qty:
                    frappe.throw(f"Cannot receive {current_recv}. Max allowed is {row.ordered_qty} for {row.item_code}")
                
                row.received_qty = current_recv
                row.pending_qty = row.ordered_qty - current_recv
    
    # Check if doc is fully complete
    for row in doc.items:
        if row.pending_qty > 0.0:
            all_done = False
            
    doc.notes = notes
    if all_done:
        doc.full_piece_stage = "Received from Full Piece Jobber" # Close it
        
    doc.save(ignore_permissions=True)



import json
import frappe
from frappe.utils import nowdate, flt

@frappe.whitelist()
def create_full_piece_send(items_data, supplier, sco_name=None, po_name=None):
    """
    Creates an Embroidery Work Order for the Full Piece stage.
    Handles both Subcontracted (via sco_name) and Direct POs (via po_name).
    """
    items = json.loads(items_data)
    
    # 1. Resolve the target Purchase Order
    # If po_name is passed directly from JS, use it. 
    # Otherwise, try to find the linked PO from the SCO.
    final_po_name = po_name
    
    if not final_po_name and sco_name:
        final_po_name = frappe.db.get_value("Subcontracting Order", sco_name, "purchase_order")
        
    if not final_po_name:
        frappe.throw("Reference Purchase Order not found. Cannot link Job Work.")

    # 2. Initialize the Embroidery Work Order
    ewo = frappe.new_doc("Embroidery Work Order")
    ewo.subcontracting_order = sco_name # Will be None for Direct POs (OK)
    ewo.purchase_order = final_po_name
    ewo.work_type = "Full Piece Job Work"
    ewo.full_piece_jobber = supplier
    ewo.full_piece_stage = "Sent to Full Piece Jobber" 
    ewo.date = nowdate()
    
    # 3. Add Line Items
    for i in items:
        qty = flt(i.get('qty', 0))
        ewo.append("items", {
            "item_code": i.get('item_code'),
            "item_name": i.get('item_name'),
            "ordered_qty": qty,     # Qty currently sending to assembly
            "received_qty": 0,      # Qty received back (initially 0)
            "pending_qty": qty      # Remaining balance
        })
    
    # 4. Save and Submit
    ewo.save(ignore_permissions=True)
    ewo.submit()
    
    return ewo.name


# @frappe.whitelist()
# def get_full_piece_dashboard_data(po_name):
#     """
#     Unified provider for Full Piece Dashboard. 
#     Source: SCO (if subcontracted) OR PO (if direct).
#     """
#     # 1. Identify context (Does a Subcontracting Order exist?)
#     sco_name = frappe.db.get_value("Subcontracting Order", 
#         {"purchase_order": po_name, "docstatus": 1}, "name")
    
#     # 2. GET ALL EMBROIDERY WORK ORDERS (Both types)
#     # Linked via purchase_order field to ensure we find everything for this specific PO
#     ewos = frappe.get_all("Embroidery Work Order", 
#         filters={"purchase_order": po_name, "docstatus": 1},
#         fields=["name", "date", "full_piece_jobber", "full_piece_stage", "work_type", "panel_stage"],
#         order_by="creation desc"
#     )

#     full_piece_processes = []
#     qty_assigned_to_fp = {}      # Track items already sent for Full Piece
#     qty_returned_from_panel = {} # Track items cleared from Panel work

#     if ewos:
#         # Optimized: Fetch all items for all EWOs in one query
#         ewo_items = frappe.get_all("Embroidery Work Order Item", 
#             filters={"parent": ["in", [e.name for e in ewos]]}, 
#             fields=["parent", "item_code", "item_name", "ordered_qty", "received_qty"]
#         )
        
#         # Build maps for calculation
#         for i in ewo_items:
#             parent_ewo = next((e for e in ewos if e.name == i.parent), None)
#             if not parent_ewo: continue

#             # Accumulate assigned qty for Full Piece phase
#             if parent_ewo.work_type == 'Full Piece Job Work':
#                 qty_assigned_to_fp[i.item_code] = qty_assigned_to_fp.get(i.item_code, 0) + i.ordered_qty
            
#             # Accumulate successful Panel returns (which makes them available for Full Piece)
#             if parent_ewo.work_type == 'Panel Job Work' and parent_ewo.panel_stage == 'Returned to Jobber (Closed)':
#                 qty_returned_from_panel[i.item_code] = qty_returned_from_panel.get(i.item_code, 0) + i.ordered_qty

#         # Generate History List for Part 2 of the Dashboard
#         for e in ewos:
#             if e.work_type == 'Full Piece Job Work':
#                 # Link line item HTML visualization
#                 item_details = [i for i in ewo_items if i.parent == e.name]
#                 html = "<div style='font-size:11px;'>"
#                 for idtl in item_details:
#                     bal = flt(idtl.ordered_qty) - flt(idtl.received_qty)
#                     color = "#28a745" if bal <= 0 else "#e67e22"
#                     status = "Finished" if bal <= 0 else f"Bal {int(bal)}"
#                     html += f"<div><b>{idtl.item_name}</b>: {int(idtl.ordered_qty)} sent | <span style='color:{color};'>{status}</span></div>"
#                 html += "</div>"
#                 e["details_html"] = html
#                 full_piece_processes.append(e)

#     # 3. GET SOURCE ITEMS (Fallback: SCO -> PO)
#     if sco_name:
#         # Subcontracting Logic
#         items_source = frappe.get_all("Subcontracting Order Item", 
#             filters={"parent": sco_name}, 
#             fields=["item_code", "item_name", "received_qty"])
#     else:
#         # Direct Purchase Order Logic
#         items_source = frappe.get_all("Purchase Order Item", 
#             filters={"parent": po_name}, 
#             fields=["item_code", "item_name", "received_qty"])

#     available_items = []
#     for item in items_source:
#         # Official Quantity Received at warehouse
#         official_received = flt(item.received_qty)
#         # Quantity physically cleared from Panel Work
#         panel_cleared = flt(qty_returned_from_panel.get(item.item_code, 0))
#         # Total already assigned to Full Piece jobbers
#         already_sent_to_fp = flt(qty_assigned_to_fp.get(item.item_code, 0))
        
#         # Rule: Items are ready for Full Piece if they are either:
#         # Officially Received OR Returned from Panels
#         available_in_hand = max(official_received, panel_cleared)
#         balance = available_in_hand - already_sent_to_fp
        
#         available_items.append({
#             "item_code": item.item_code,
#             "item_name": item.item_name,
#             "stock_in_factory": int(available_in_hand), # Show what we can use
#             "already_assigned": int(already_sent_to_fp),
#             "balance_avail": int(balance) if balance > 0 else 0
#         })

#     return {
#         "available_items": available_items,
#         "active_processes": full_piece_processes,
#         "sco_name": sco_name
#     }





@frappe.whitelist()
def get_full_piece_dashboard_data(po_name):
    """
    Data provider for Full Piece Dashboard. 
    Allows direct POs to dispatch work based on 'Ordered Qty'.
    """
    po_doc = frappe.get_doc("Purchase Order", po_name)
    sco_name = frappe.db.get_value("Subcontracting Order", 
        {"purchase_order": po_name, "docstatus": 1}, "name")
    
    # 1. GET ALL EMBROIDERY WORK ORDERS (Jobs)
    ewos = frappe.get_all("Embroidery Work Order", 
        filters={"purchase_order": po_name, "docstatus": 1},
        fields=["name", "date", "full_piece_jobber", "full_piece_stage", "work_type", "panel_stage"],
        order_by="creation desc"
    )

    full_piece_processes = []
    qty_assigned_to_fp = {}      
    qty_returned_from_panel = {} 

    if ewos:
        ewo_items = frappe.get_all("Embroidery Work Order Item", 
            filters={"parent": ["in", [e.name for e in ewos]]}, 
            fields=["parent", "item_code", "item_name", "ordered_qty", "received_qty"]
        )
        
        for i in ewo_items:
            parent_ewo = next((e for e in ewos if e.name == i.parent), None)
            if not parent_ewo: continue

            if parent_ewo.work_type == 'Full Piece Job Work':
                qty_assigned_to_fp[i.item_code] = qty_assigned_to_fp.get(i.item_code, 0) + i.ordered_qty
            
            if parent_ewo.work_type == 'Panel Job Work' and parent_ewo.panel_stage == 'Returned to Jobber (Closed)':
                qty_returned_from_panel[i.item_code] = qty_returned_from_panel.get(i.item_code, 0) + i.ordered_qty

        for e in ewos:
            if e.work_type == 'Full Piece Job Work':
                items = [i for i in ewo_items if i.parent == e.name]
                html = "<div style='font-size:11px;'>"
                for itm in items:
                    bal = flt(itm.ordered_qty) - flt(itm.received_qty)
                    clr = "#28a745" if bal <= 0 else "#e67e22"
                    html += f"<div><b>{itm.item_name}</b>: {int(itm.ordered_qty)} | <span style='color:{clr}; font-weight:700;'>{ 'Done' if bal <=0 else f'Bal {int(bal)}'}</span></div>"
                html += "</div>"
                e["details_html"] = html
                full_piece_processes.append(e)

    # 2. SOURCE ITEMS SELECTION
    if sco_name:
        items_source = frappe.get_all("Subcontracting Order Item", filters={"parent": sco_name}, fields=["item_code", "item_name", "received_qty", "qty"])
    else:
        items_source = frappe.get_all("Purchase Order Item", filters={"parent": po_name}, fields=["item_code", "item_name", "received_qty", "qty"])

    available_items = []
    for item in items_source:
        already_sent_to_fp = flt(qty_assigned_to_fp.get(item.item_code, 0))
        
        # --- LOGIC CORE ---
        if po_doc.is_subcontracted == 0:
            # DIRECT PO: New work. Everything ordered is "available" for Jobber
            total_basis = flt(item.qty)
        else:
            # SUBCONTRACTED PO: Factory work. Must wait for Official Receipt or Panel Return
            total_basis = max(flt(item.received_qty), flt(qty_returned_from_panel.get(item.item_code, 0)))

        balance = total_basis - already_sent_to_fp
        
        available_items.append({
            "item_code": item.item_code,
            "item_name": item.item_name,
            "stock_in_factory": int(total_basis), 
            "already_assigned": int(already_sent_to_fp),
            "balance_avail": int(balance) if balance > 0 else 0
        })

    return {
        "available_items": available_items,
        "active_processes": full_piece_processes,
        "sco_name": sco_name
    }



import frappe
from frappe.utils import flt
@frappe.whitelist()
def get_detailed_pending_pos(supplier):
    if not supplier:
        return []

    return frappe.db.sql("""
        SELECT 
            po.name as purchase_order,
            po.transaction_date as po_date,
            poi.name as po_item_id,
            poi.item_code,
            
            poi.item_name,
            poi.uom,
            (poi.qty - poi.received_qty) as pending_qty,
            poi.rate,
            poi.warehouse,
            poi.schedule_date,
            poi.sales_order,
            so.customer as customer,  -- Changed alias from customer_id to customer
            so.customer_name as customer_name
        FROM `tabPurchase Order Item` poi
        JOIN `tabPurchase Order` po ON poi.parent = po.name
        LEFT JOIN `tabSales Order` so ON poi.sales_order = so.name
        WHERE po.supplier = %s 
            AND po.docstatus = 1 
            AND po.is_subcontracted = 0
            AND po.status NOT IN ('Closed', 'Cancelled')
            AND (poi.qty - poi.received_qty) > 0
        ORDER BY po.transaction_date DESC, po.name DESC
    """, (supplier), as_dict=1)