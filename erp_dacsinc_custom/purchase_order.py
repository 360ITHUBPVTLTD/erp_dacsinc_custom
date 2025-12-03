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


# The validation function is updated with the exact same logic for consistency.
@frappe.whitelist()
def validate_and_get_items_for_po(selected_items, is_subcontracted=False):
    selected_items = frappe.parse_json(selected_items)
    is_subcontracted = cint(is_subcontracted)
    item_code_field = 'fg_item' if is_subcontracted else 'item_code'
    
    valid_items = []
    rejected_items = []
    
    for item in selected_items:
        # pendingQty is the Quantity to Purchase/Manufacture as entered by the user
        qty_to_add = item.get('pendingQty', 0)

        # Get original SO details.
        so_item_details = frappe.db.get_value("Sales Order Item", 
            {'parent': item.get('salesOrder'), 'item_code': item.get('itemCode')}, 
            ['qty', 'delivered_qty'], 
            as_dict=True
        )
        if not so_item_details:
            rejected_items.append({"sales_order": item.get('salesOrder'), "item_name": item.get('itemName'), "reason": "Sales Order Item not found."})
            continue

        # 1. Calculate quantity already on other Purchase Orders.
        ordered_on_pos_raw = frappe.db.sql("""
            SELECT SUM(poi.qty) FROM `tabPurchase Order Item` AS poi
            JOIN `tabPurchase Order` AS po ON po.name = poi.parent
            WHERE po.docstatus = 1 AND poi.sales_order = %(sales_order)s AND poi.{field} = %(item_code)s
        """.format(field=item_code_field), {'sales_order': item.get('salesOrder'),'item_code': item.get('itemCode')})
        ordered_on_pos = (ordered_on_pos_raw[0][0] or 0) if ordered_on_pos_raw else 0

        # 2. FIXED: Calculate the quantity reserved via Pick Lists for this Sales Order.
        reserved_via_pick_list = _get_pick_list_reserved_qty(item.get('salesOrder'), item.get('itemCode'))
        
        # 3. The true maximum allowable quantity for a new PO.
        max_allowable_qty = so_item_details.qty - so_item_details.delivered_qty - ordered_on_pos - reserved_via_pick_list
        
        # The Core Validation.
        if qty_to_add > (max_allowable_qty + 0.001) or max_allowable_qty <= 0:
            # We reject if quantity exceeds the max, or if max is effectively 0
             rejected_items.append({
                "sales_order": item.get('salesOrder'),
                "item_name": item.get('itemName'),
                "reason": f"Cannot add {qty_to_add} units. {max_allowable_qty:.2f} pending procurement."
            })
        else:
            # Item is valid, add it to the list.
            item_details_data = {}
            if is_subcontracted:
                service_item_code = None
                bom_name = item.get('bom_no')
                if bom_name:
                    service_item_code = frappe.db.get_value("BOM", bom_name, "custom_service_item")

                # 2. If BOM not passed or custom_service_item is empty, try Default BOM of the Item
                if not service_item_code:
                    default_bom = frappe.db.get_value("Item", item.get('itemCode'), "default_bom")
                    if default_bom:
                        service_item_code = frappe.db.get_value("BOM", default_bom, "custom_service_item")

                # 3. Fallback if still not found
                if not service_item_code:
                    service_item_code = "Order Charges"
                # Fetch details for the Service Item
                item_details_data = get_item_details_for_po(service_item_code) or {}
                
                # Set Purchase Order Item standard fields (The Service Item):
                item_details_data['item_code'] = service_item_code
                
                # ----------------- QTY is SYNCHRONIZED WITH fg_item_qty -----------------
                # Service Item Qty
                item_details_data['qty'] = qty_to_add 

                # Set Subcontracting specific fields:
                # fg_item is set to BOM ID per previous request
                item_details_data['fg_item'] = item.get('itemCode')           
                # Finished Good QTY is set to user input Qty
                item_details_data['fg_item_qty'] = qty_to_add            
                # -----------------------------------------------------------------------

                item_details_data['sales_order'] = item.get('salesOrder') 
                item_details_data['bom'] = item.get('bom')                

                # Update description to be informative
                description = item_details_data.get('description', '')
                new_description_line = f"\n\nManufacturing of: {item.get('itemName')} ({item.get('itemCode')})\nRef SO: {item.get('salesOrder')}"
                item_details_data['description'] = (description + new_description_line).strip()
            
            else:
                # Standard procurement (remains unchanged)
                item_details_data = get_item_details_for_po(item.get('itemCode')) or {}
                
                item_details_data['item_code'] = item.get('itemCode')
                item_details_data['qty'] = item.get('pendingQty')
                item_details_data['sales_order'] = item.get('salesOrder')
                
            valid_items.append(item_details_data)

    return {
        "valid_items": valid_items,
        "rejected_items": rejected_items
    }

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





import frappe
from frappe import _
from frappe.utils import flt, cint
from collections import defaultdict

@frappe.whitelist()
def get_pending_so_with_material_stock(is_subcontracted=False):
    """
    Fetches Sales Orders with pending delivery items.
    Calculates Procurement Need based on:
    Need = (SO Qty - Delivered) - (Linked POs) - (Effective Stock Picked)
    """
    is_subcontracted = cint(is_subcontracted)
    item_code_field = "fg_item" if is_subcontracted else "item_code"
    
    # Filter conditions (Check BOM if Subcontracted)
    condition = "AND soi.bom_no IS NOT NULL AND soi.bom_no != ''" if is_subcontracted else "AND (soi.bom_no IS NULL OR soi.bom_no = '')"

    # 1. Base Query: Get Open Sales Order Items
    pending_orders_raw = frappe.db.sql(f"""
        SELECT
            soi.name AS so_item_name, 
            soi.parent AS sales_order, 
            so.customer AS customer,
            soi.item_code, 
            soi.item_name, 
            soi.qty, 
            soi.bom_no AS bom,
            soi.delivered_qty
        FROM `tabSales Order Item` AS soi 
        JOIN `tabSales Order` AS so ON so.name = soi.parent
        WHERE so.docstatus = 1 
        AND so.status NOT IN ('On Hold', 'Completed', 'Cancelled', 'Closed')
        AND soi.qty > soi.delivered_qty {condition}
        ORDER BY so.transaction_date ASC, soi.item_code ASC
    """, as_dict=True)

    if not pending_orders_raw:
        return {}

    final_pending_orders = []

    # 2. Iterate Row-by-Row to calculate specific status
    for so_item in pending_orders_raw:
        
        # --- A. INCOMING PURCHASE ORDERS (SUPPLY) ---
        # We need to know:
        # 1. Total Ordered (Covers the requirement)
        # 2. Total Received (Used to offset 'Pick List' counts to avoid double counting)
        po_stats = frappe.db.sql("""
            SELECT 
                SUM(poi.qty), 
                SUM(poi.received_qty),
                GROUP_CONCAT(DISTINCT po.name SEPARATOR ', ')
            FROM `tabPurchase Order Item` AS poi
            JOIN `tabPurchase Order` AS po ON po.name = poi.parent
            WHERE po.docstatus = 1 
            AND po.status NOT IN ('Closed', 'Cancelled', 'Completed')
            AND poi.sales_order = %(sales_order)s 
            AND poi.{field} = %(item_code)s
        """.format(field=item_code_field), {
            'sales_order': so_item.sales_order, 
            'item_code': so_item.item_code
        })
        
        ordered_on_pos = flt(po_stats[0][0]) if po_stats and po_stats[0][0] else 0.0
        received_on_pos = flt(po_stats[0][1]) if po_stats and po_stats[0][1] else 0.0
        incoming_po_names = po_stats[0][2] if po_stats and po_stats[0][2] else ""

        # --- B. STOCK RESERVATIONS (PICK LISTS) ---
        # 1. Submitted Pick Lists (Physically picked or segregated)
        pl_picked_qty = flt(frappe.db.sql("""
            SELECT SUM(pli.picked_qty) FROM `tabPick List Item` pli 
            JOIN `tabPick List` pl ON pl.name = pli.parent
            WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 1 
            AND pl.status NOT IN ('Completed', 'Cancelled')
        """, (so_item.sales_order, so_item.item_code))[0][0])
        
        # 2. Draft Pick Lists (Intention to pick)
        pl_yet_to_pick_qty = flt(frappe.db.sql("""
            SELECT SUM(pli.qty) FROM `tabPick List Item` pli 
            JOIN `tabPick List` pl ON pl.name = pli.parent
            WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 0
        """, (so_item.sales_order, so_item.item_code))[0][0])
        
        total_pl_committed = pl_picked_qty + pl_yet_to_pick_qty

        # --- C. CALCULATION LOGIC (FIX FOR 10 vs 7) ---
        
        qty_left_to_deliver = so_item.qty - so_item.delivered_qty
        
        # Step C1: Calculate "Shelf Stock Used"
        # Logic: If we ordered 5 on a PO and received 5, those 5 are now in stock.
        # If we pick 3, it's likely from those 5. We shouldn't deduct 5 (PO) AND 3 (Pick).
        # "Extra" stock used is: Total Picked - Received from Linked POs.
        picked_from_shelf_stock = max(0, total_pl_committed - received_on_pos)
        
        # Step C2: Total Coverage
        # Coverage = External Supply (Ordered PO) + Internal Supply (Existing Shelf Stock)
        deductible_coverage = ordered_on_pos + picked_from_shelf_stock
        
        # Step C3: Pending Purchase
        # If Req=10, PO=0, Pick=3. Shelf=3. Deduct=3. Result=7. (CORRECT)
        qty_pending_purchase = qty_left_to_deliver - deductible_coverage

        # --- D. APPEND RESULT ---
        if qty_left_to_deliver > 0.001:
            
            so_item['pending_qty'] = max(0, flt(qty_pending_purchase)) 
            
            # Additional Context for UI
            so_item['incoming_po_qty'] = ordered_on_pos  
            so_item['received_po_qty'] = received_on_pos
            so_item['incoming_po_names'] = incoming_po_names
            
            so_item['pl_picked_qty'] = pl_picked_qty
            so_item['pl_yet_to_pick_qty'] = pl_yet_to_pick_qty
            so_item['fg_reserved_for_so_qty'] = total_pl_committed

            final_pending_orders.append(so_item)

    if not final_pending_orders:
        return {}

    # 3. Calculate Item Summaries (Top Table Aggregates)
    item_summary_dict = defaultdict(lambda: {"total_qty": 0, "order_count": 0, "boms": set(), "item_name": ""})
    
    for so in final_pending_orders:
        item_code = so.item_code
        item_summary_dict[item_code]["total_qty"] += so.pending_qty 
        item_summary_dict[item_code]["order_count"] += 1
        item_summary_dict[item_code]["item_name"] = so.item_name
        if so.bom: item_summary_dict[item_code]["boms"].add(so.bom)
    
    item_summary = []
    for item_code, data in item_summary_dict.items():
        
        # Global Stock Check
        fg_actual = flt(frappe.db.sql("SELECT SUM(actual_qty) FROM `tabBin` WHERE item_code = %s", item_code)[0][0] or 0)
        
        # Global Reservation Check (SRE)
        total_reserved = flt(frappe.db.sql("SELECT SUM(reserved_qty) FROM `tabStock Reservation Entry` WHERE item_code = %s AND docstatus = 1", item_code)[0][0] or 0)
        
        fg_available = fg_actual - total_reserved
        
        # Global Pick Stats (For Display)
        picked_stats = frappe.db.sql("""
            SELECT 
                (SELECT SUM(pli.picked_qty) FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent WHERE pli.item_code = %(ic)s AND pl.docstatus = 1 AND pl.status != 'Completed'),
                (SELECT SUM(pli.qty) FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent WHERE pli.item_code = %(ic)s AND pl.docstatus = 0)
        """, {'ic': item_code})
        
        total_picked_submitted = flt(picked_stats[0][0]) if picked_stats and picked_stats[0][0] else 0.0
        total_picked_draft = flt(picked_stats[0][1]) if picked_stats and picked_stats[0][1] else 0.0
        
        # Raw Material Details (Optional Helper)
        materials = [] 
        bom = next(iter(data["boms"]), None)
        try:
             # Dynamically call BOM helper if available in system
             if "get_bom_stock_details" in globals() and bom:
                 materials = get_bom_stock_details(bom, data["total_qty"])
        except Exception:
            pass

        item_summary.append({
            "item_code": item_code, 
            "item_name": data["item_name"],
            
            "fg_total_stock": fg_actual, 
            "fg_available_qty": fg_available, 
            "fg_picked_submitted": total_picked_submitted,
            "fg_picked_draft": total_picked_draft,
            
            "total_pending_qty": data["total_qty"], 
            "order_count": data["order_count"],
            "total_reserved_qty": total_reserved, 
            "raw_materials": materials
        })

    # 4. Attach Summaries back to Rows for Frontend
    for so_item in final_pending_orders:
        summary = next(i for i in item_summary if i['item_code'] == so_item.item_code)
        so_item['fg_total_stock'] = summary['fg_total_stock']
        so_item['fg_total_reserved_qty'] = summary['total_reserved_qty']
        so_item['fg_available_qty'] = summary['fg_available_qty'] 
        so_item['fg_picked_submitted'] = summary['fg_picked_submitted']
        so_item['fg_picked_draft'] = summary['fg_picked_draft']

    return {
        "item_summary": sorted(item_summary, key=lambda x: x['total_pending_qty'], reverse=True),
        "sales_orders": final_pending_orders
    }





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

@frappe.whitelist()
def get_linked_subcontracting_docs(purchase_order_name):
    """
    Finds all linked subcontracting documents and efficiently injects their
    child Item details into them for display on the Purchase Order dashboard.
    This is a refactored, efficient, and correct version.
    """
    # Initialize the dictionary with all required keys, including 'ewo'
    docs = {"sco": [], "ste": [], "scr": [], "pr": [], "pi": [], "ewo": []}

    # Helper function to efficiently fetch and attach child table items to parent documents
    def attach_items(parent_list, child_doctype, child_fields):
        if not parent_list:
            return
        
        parent_names = [d["name"] for d in parent_list]
        
        # Fetch all related child items in a single database query
        items = frappe.db.get_all(
            child_doctype,
            filters={"parent": ["in", parent_names]},
            fields=["parent"] + child_fields
        )
        
        # Map items to their parent document using a dictionary for quick lookups
        item_map = collections.defaultdict(list)
        for item in items:
            item_map[item["parent"]].append(item)
            
        # Attach the list of items to each parent document
        for p in parent_list:
            p["items"] = item_map.get(p["name"], [])

    # 1. Embroidery Work Orders (EWO)
    ewo_names = frappe.db.get_all(
        "Embroidery Work Order",
        filters={"purchase_order": purchase_order_name, "docstatus": 1},
        pluck="name"
    )
    if ewo_names:
        docs["ewo"] = frappe.db.get_all("Embroidery Work Order", filters={"name": ["in", ewo_names]},
            fields=["name", "date", "status", "notes", "per_received", "stage","supplier"])
        attach_items(docs["ewo"], "Embroidery Work Order Item", ["item_code", "item_name", "ordered_qty", "received_qty"])
    # 2. Subcontracting Orders (SCO)
    sco_names = frappe.db.get_all(
        "Subcontracting Order",
        filters={"purchase_order": purchase_order_name, "docstatus": 1},
        pluck="name"
    )
    if sco_names:
        docs["sco"] = frappe.db.get_all("Subcontracting Order", filters={"name": ["in", sco_names]},
            fields=["name", "transaction_date", "total", "status"])
        attach_items(docs["sco"], "Subcontracting Order Item", ["item_code", "item_name", "qty", "received_qty", "amount"])

        # 3. Material Transfers (Stock Entry linked to SCO)
        ste_names = frappe.db.get_all(
            "Stock Entry",
            filters={"subcontracting_order": ["in", sco_names], "docstatus": 1},
            pluck="name"
        )
        if ste_names:
            docs["ste"] = frappe.db.get_all("Stock Entry", filters={"name": ["in", ste_names]},
                fields=["name", "posting_date", "stock_entry_type"])
            attach_items(docs["ste"], "Stock Entry Detail", ["item_code", "item_name", "qty", "uom"])

        # 4. Subcontracting Receipts (linked to SCO)
        scr_names = frappe.db.get_all(
            "Subcontracting Receipt",
            filters={"subcontracting_order": ["in", sco_names], "docstatus": 1},
            pluck="name"
        )
        if scr_names:
            docs["scr"] = frappe.db.get_all("Subcontracting Receipt", filters={"name": ["in", scr_names]},
                fields=["name", "posting_date", "status"])
            attach_items(docs["scr"], "Subcontracting Receipt Item", ["item_code", "item_name", "qty", "amount"])

    # 5. Purchase Receipts (PR - linked via PO field in child table)
    pr_parents = frappe.db.get_all(
        "Purchase Receipt Item", filters={"purchase_order": purchase_order_name},
        pluck="parent", distinct=True
    )
    if pr_parents:
        pr_names = frappe.db.get_all("Purchase Receipt", filters={"name": ["in", pr_parents], "docstatus": 1}, pluck="name")
        if pr_names:
            docs["pr"] = frappe.db.get_all("Purchase Receipt", filters={"name": ["in", pr_names]},
                fields=["name", "posting_date", "rounded_total", "status"])
            attach_items(docs["pr"], "Purchase Receipt Item", ["item_code", "item_name", "qty", "rate", "amount"])

    # 6. Purchase Invoices (PI - linked via PO field in child table)
    pi_parents = frappe.db.get_all(
        "Purchase Invoice Item", filters={"purchase_order": purchase_order_name},
        pluck="parent", distinct=True
    )
    if pi_parents:
        pi_names = frappe.db.get_all("Purchase Invoice", filters={"name": ["in", pi_parents], "docstatus": 1}, pluck="name")
        if pi_names:
            docs["pi"] = frappe.db.get_all("Purchase Invoice", filters={"name": ["in", pi_names]},
                fields=["name", "posting_date", "due_date", "status"])
            attach_items(docs["pi"], "Purchase Invoice Item", ["item_code", "item_name", "qty", "rate", "amount"])

    return docs


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

# --- NEW FUNCTION TO GET REQUIRED MATERIALS ---
@frappe.whitelist()
def get_required_raw_materials_for_po(purchase_order_name):
    """
    Aggregates all required raw materials for a subcontracting Purchase Order.
    Fetches FG Items from PO, finds their default BOMs, and calculates total RM requirements.
    """
    po = frappe.get_doc("Purchase Order", purchase_order_name)
    if not po.is_subcontracted:
        frappe.throw(_("This action is only available for Subcontracting Purchase Orders."))

    # Aggregate required FG quantities from the PO
    fg_requirements = defaultdict(float)
    for item in po.items:
        if item.fg_item and item.fg_item_qty > 0:
            fg_requirements[item.fg_item] += flt(item.fg_item_qty)
    
    if not fg_requirements:
        return []

    # Aggregate raw material requirements based on the BOM of each FG
    rm_requirements = defaultdict(float)
    for fg_item_code, total_fg_qty in fg_requirements.items():
        # Get the default BOM for the finished good
        default_bom = frappe.db.get_value("Item", fg_item_code, "default_bom")
        if not default_bom:
            frappe.throw(_("Please set a default BOM for Finished Good: {0}").format(fg_item_code))
        
        # Get BOM items (raw materials)
        bom_items = frappe.get_all("BOM Item", filters={"parent": default_bom}, fields=["item_code", "qty"])
        for bom_item in bom_items:
            required_qty = flt(bom_item.qty) * flt(total_fg_qty)
            rm_requirements[bom_item.item_code] += required_qty
            
    # Get stock levels for each required raw material
    results = []
    for rm_code, req_qty in rm_requirements.items():
        item_details = frappe.db.get_value("Item", rm_code, ["item_name", "stock_uom"], as_dict=1)
        
        # Get available quantity from Bin
        # Get available quantity from Bin
        stock_data = frappe.db.sql("""
            SELECT SUM(actual_qty), SUM(reserved_qty)
            FROM `tabBin` WHERE item_code = %s
        """, (rm_code), as_list=True)

        actual_qty = flt(stock_data[0][0])
        reserved_qty = flt(stock_data[0][1])

        # Prevent negative available qty
        available_qty = max(actual_qty - reserved_qty, 0)

        # print(f"DEBUG: RM {rm_code} - Actual: {actual_qty}, Reserved: {reserved_qty}, Available: {available_qty}")
        results.append({
            "item_code": rm_code,
            "item_name": item_details.item_name,
            "uom": item_details.stock_uom,
            "required_qty": req_qty,
            "available_qty": actual_qty
        })
        
    return sorted(results, key=lambda x: x['item_name'])



from erpnext.buying.doctype.purchase_order.purchase_order import make_subcontracting_order
from erpnext.controllers.subcontracting_controller import make_rm_stock_entry

@frappe.whitelist()
# @frappe.db.transaction
def create_subcontracting_docs(purchase_order_name):
    """
    Creates and submits a Subcontracting Order, and then immediately creates and
    submits the corresponding Material Transfer Stock Entry to a common warehouse.
    This is a single, atomic transaction.
    """
    po = frappe.get_doc("Purchase Order", purchase_order_name)

    subcontractor_warehouse = "Jobers Warehouse - IND"

    if not frappe.db.exists("Warehouse", subcontractor_warehouse):
        frappe.throw(_("The common subcontracting warehouse '{0}' does not exist. Please create it before proceeding.").format(subcontractor_warehouse))

    # Create the Subcontracting Order
    sco = make_subcontracting_order(purchase_order_name)
    
    # Set custom/required values before saving
    sco.supplier = po.supplier
    target_warehouse = "VV Puram - IND"
    sco.set_warehouse = target_warehouse
    for item in sco.items:
        item.warehouse = target_warehouse
    
    # Save and submit the SCO
    sco.insert(ignore_permissions=True)
    sco.submit()
    po.add_comment("Comment", _("Created Subcontracting Order: {0}").format(sco.name))

    # --- START OF FIX ---

    # 1. Get the doclist from the controller function
    # The name is changed to `ste_doclist` for clarity.
    ste_doclist = make_rm_stock_entry(subcontract_order=sco.name, order_doctype=sco.doctype)
    
    # 2. Convert the returned doclist (list of dicts) into a proper Document object.
    ste_doc = frappe.get_doc(ste_doclist)
    
    # --- END OF FIX ---
    
    # Now, `ste_doc` is a proper Document object, and the rest of the code will work.
    for item in ste_doc.items:
        item.t_warehouse = subcontractor_warehouse
    
    # Save and submit the now-corrected Stock Entry
    ste_doc.insert(ignore_permissions=True)
    ste_doc.submit()
    po.add_comment("Comment", _("Created Material Transfer: {0}").format(ste_doc.name))
    
    return {
        "sco_name": sco.name,
        "ste_name": ste_doc.name
    }



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




@frappe.whitelist()
def create_receipt_documents(sco_name, items_to_receive):
    """
    1. Creates and submits a Subcontracting Receipt (SCR).
    2. Creates and submits a Purchase Receipt (PR) from the SCR.
    3. Creates and submits a Purchase Invoice (PI) from the PR.
    """
    items_to_receive = frappe.parse_json(items_to_receive)

    # 1. Create Subcontracting Receipt (SCR)
    scr = make_subcontracting_receipt(sco_name)
    
    # Filter items and update quantities based on user input
    final_items = []
    for item_in_scr in scr.items:
        matching_item = next((i for i in items_to_receive if i.get("name") == item_in_scr.subcontracting_order_item), None)
        if matching_item:
            qty_to_receive = flt(matching_item.get("qty_to_receive"))
            if qty_to_receive > 0:
                item_in_scr.qty = qty_to_receive
                final_items.append(item_in_scr)

    if not final_items:
        frappe.throw(_("No items with a quantity greater than zero were selected for receipt."))
        
    scr.items = final_items
    scr.insert(ignore_permissions=True)
    scr.submit()
    
    # 2. Create Purchase Receipt (PR) from the SCR
    pr = make_purchase_receipt_from_scr(scr.name)
    pr.insert(ignore_permissions=True)
    pr.submit()
    
    # --- START OF NEW LOGIC ---
    # 3. Create Purchase Invoice (PI) from the PR
    # pi = make_purchase_invoice(pr.name)
    # pi.insert(ignore_permissions=True)
    # Note: Depending on your company's process, you may want to leave the PI in Draft.
    # To save as draft, comment out the line below.
    # pi.submit()
    # --- END OF NEW LOGIC ---

    # Add comments back to the original Purchase Order for full traceability
    po_name = None
    if scr.items:
        source_sco_name = scr.items[0].subcontracting_order
        if source_sco_name:
            po_name = frappe.db.get_value("Subcontracting Order", source_sco_name, "purchase_order")
            
    if po_name:
        po = frappe.get_doc("Purchase Order", po_name)
        po.add_comment("Comment", _("Created Purchase Receipt: {0}").format(pr.name))
        # po.add_comment("Comment", _("Created Purchase Invoice: {0}").format(pi.name))

    # Return the names of ALL documents created
    return {"scr_name": scr.name, "pr_name": pr.name}




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
            valid_qty = row.qty - (row.get("rejected_qty") or 0)
            if valid_qty <= 0:
                continue

            # Detect linked PO Item
            po_item_link = row.get("purchase_order_item") or row.get("po_detail")
            if not po_item_link:
                continue

            # Get PO Item details
            po_data = frappe.db.get_value(
                "Purchase Order Item",
                po_item_link,
                ["fg_item", "item_code", "sales_order", "sales_order_item"],
                as_dict=True,
            )

            if not po_data or not po_data.sales_order:
                continue

            # -----------------------------------------------------------
            # FIX: Ensure sales_order_item (Row ID) exists
            # -----------------------------------------------------------
            so_item_name = po_data.sales_order_item
            
            # Subcontracting or Normal Item Logic
            if doc.is_subcontracted:
                # Use FG Item logic
                final_item_code = frappe.db.get_value("Purchase Order Item", po_item_link, "fg_item")
                if not final_item_code:
                    continue
                final_item_name = frappe.db.get_value("Item", final_item_code, "item_name")
            else:
                final_item_code = row.item_code
                final_item_name = row.item_name

            # If PO didn't have the specific SO Row ID, search for it in the Sales Order
            if not so_item_name:
                so_item_name = frappe.db.get_value(
                    "Sales Order Item",
                    {
                        "parent": po_data.sales_order, 
                        "item_code": final_item_code
                    },
                    "name"
                )

            # If we still can't find the link, we cannot add it to the map
            if not so_item_name:
                frappe.msgprint(f"Skipping {final_item_code}: Could not find matching item in Sales Order {po_data.sales_order}")
                continue

            # Add to SO grouping
            so_items_map[po_data.sales_order].append({
                "item_code": final_item_code,
                "item_name": final_item_name,
                "warehouse": row.warehouse,
                "qty": valid_qty,
                "uom": row.uom,
                "stock_uom": row.stock_uom,
                "conversion_factor": row.conversion_factor or 1,
                "sales_order_item": so_item_name, # Use the robust variable
                "serial_no": row.serial_no,
                "batch_no": row.batch_no
            })

        # -----------------------------------------------------------
        # BUILD PICK LISTS
        # -----------------------------------------------------------
        for so_name, items in so_items_map.items():
            customer = frappe.db.get_value("Sales Order", so_name, "customer")
            
            pl = frappe.new_doc("Pick List")
            pl.company = doc.company
            pl.purpose = "Delivery"
            pl.customer = customer
            pl.warehouse = doc.set_warehouse # Ensure this is not None
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
                    "sales_order_item": i["sales_order_item"], # Critical for DN creation
                    "serial_no": i["serial_no"],
                    "batch_no": i["batch_no"]
                })

            pl.insert(ignore_permissions=True)
            
            # OPTIONAL: Automatically Submit the Pick List
            # If you don't submit, you cannot create a DN immediately.
            try:
                pl.submit()
                frappe.msgprint(
                    f"Pick List Created & Submitted: <a href='/app/pick-list/{pl.name}'><b>{pl.name}</b></a>", 
                    indicator="green"
                )
            except Exception as e:
                frappe.msgprint(f"Pick List saved (Draft) but failed to submit: {str(e)}", indicator="orange")

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
import frappe

@frappe.whitelist()
def get_pending_pr_items(supplier):
    if not supplier:
        return []

    # FIX: We Calculate Billed Qty dynamically by joining 'tabPurchase Invoice Item'
    # We look for Purchase Invoice Items that point to this PR Detail (pr_detail)
    # and are submitted (docstatus=1).
    
    sql_query = """
        SELECT 
            pr.name as pr_name, 
            pr.posting_date,
            pri.name as pr_detail, 
            pri.item_code, 
            pri.item_name, 
            pri.uom,
            pri.rate, 
            pri.qty as order_qty, 
            pri.received_qty, 
            
            -- Calculate Total Billed Qty from linked Invoice Items
            IFNULL(SUM(pii.qty), 0) as billed_qty,
            
            -- Calculate Pending
            (pri.received_qty - IFNULL(SUM(pii.qty), 0)) as pending_qty,
            
            pri.amount,
            pri.cost_center,
            pri.expense_account
        FROM 
            `tabPurchase Receipt` pr
        JOIN 
            `tabPurchase Receipt Item` pri ON pri.parent = pr.name
        
        -- LEFT JOIN to find linked Invoice Items
        LEFT JOIN
            `tabPurchase Invoice Item` pii ON pii.pr_detail = pri.name AND pii.docstatus = 1
            
        WHERE 
            pr.supplier = %s 
            AND pr.docstatus = 1 
            AND pr.status != 'Closed'
            AND pr.status != 'Completed'
            
        GROUP BY
            pri.name
            
        HAVING 
            pending_qty > 0
            
        ORDER BY 
            pr.posting_date DESC
    """
    
    data = frappe.db.sql(sql_query, (supplier,), as_dict=True)
    return data 





############# embroidery work order #############
@frappe.whitelist()
def create_embroidery_work_order(po_name, sco_name, items_to_send, notes="", supplier=None, stage="Pre-Receipt"):
    """
    Creates an Embroidery Work Order and sets its stage (Pre/Post-Receipt).
    """
    import json
    items = json.loads(items_to_send)
    po_doc = frappe.get_doc("Purchase Order", po_name)

    ewo = frappe.new_doc("Embroidery Work Order")
    ewo.purchase_order = po_name
    ewo.subcontracting_order = sco_name
    ewo.supplier = supplier if supplier else po_doc.supplier
    ewo.date = nowdate()
    ewo.notes = notes
    ewo.stage = stage  # <-- SET THE STAGE HERE

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
def get_sco_status_for_po(purchase_order_name):
    """
    Checks status of Subcontracting and Embroidery Orders.
    Differentiates between an open EWO and a completed EWO.
    """
    response = {
        "sco_exists": False,
        "items_pending": False,
        "sco_name": None,
        "is_embroidery_open": False,  # True if EWO is "Open" or "Partially Received"
        "open_ewo_name": None,
        "has_completed_ewo": False # NEW: True if an EWO exists and is "Completed"
    }
    
    # Standard Subcontracting Order check
    sco_list = frappe.get_all("Subcontracting Order", filters={"purchase_order": purchase_order_name}, fields=["name", "per_received"])
    if not sco_list:
        return response
    
    sco_name = sco_list[0].name
    response.update({"sco_exists": True, "sco_name": sco_name})
    if flt(sco_list[0].per_received) < 100:
        response["items_pending"] = True

    # --- REVISED EWO LOGIC ---
    # First, check for any EWO that is NOT completed
    open_ewo = frappe.db.get_value("Embroidery Work Order", {
        "purchase_order": purchase_order_name, 
        "status": ["!=", "Completed"], 
        "docstatus": 1
    }, "name")
    
    if open_ewo:
        response["is_embroidery_open"] = True
        response["open_ewo_name"] = open_ewo
    else:
        # If no EWO is open, check if one has been completed
        completed_ewo_exists = frappe.db.exists("Embroidery Work Order", {
            "purchase_order": purchase_order_name,
            "status": "Completed",
            "docstatus": 1
        })
        if completed_ewo_exists:
            response["has_completed_ewo"] = True
            
    return response

# # --- MODIFY the existing get_linked_subcontracting_docs function ---
# # Add the new "Embroidery Work Order" to the documents being fetched
# @frappe.whitelist()
# def get_linked_subcontracting_docs(purchase_order_name):
#     # (previous code...)
#     # Add a new key 'ewo' to fetch Embroidery Work Orders
#     docs["ewo"] = frappe.get_all("Embroidery Work Order", 
#         filters={"purchase_order": purchase_order_name, "docstatus": ["!=", 2]},
#         fields=["name", "date", "status", "material_count_given"]
#     )
#     # (return docs...)




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