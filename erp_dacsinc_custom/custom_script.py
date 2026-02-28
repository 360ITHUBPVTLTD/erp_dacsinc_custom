import frappe



def copy_custom_fields(doc, method):
    if doc.custom_tax_rate:
        update_tax_child(doc)





# def item_after_insert(doc, method):
#     doc.description = ''
#     if doc.custom_tax_rate:
#         update_tax_child(doc)

# def item_after_insert(doc, method):
#     # Set description safely
#     if not doc.description:
#         doc.db_set("description", doc.item_name)

#     # Update children
#     update_tax_child(doc)
#     update_barcode_child(doc)

#     # Create prices ONLY if valid
#     if doc.custom_standard_selling_price is not None:
#         create_or_update_item_price(doc, "Selling", doc.custom_standard_selling_price)

#     if doc.custom_standard_buying_price is not None:
#         create_or_update_item_price(doc, "Buying", doc.custom_standard_buying_price)

# def item_on_update(doc, method):
#     update_barcode_child(doc)

#     doc_before = doc.get_doc_before_save()
#     if not doc_before:
#         return

#     if doc.custom_standard_selling_price != doc_before.custom_standard_selling_price:
#         if doc.custom_standard_selling_price is not None:
#             create_or_update_item_price(
#                 doc, "Selling", doc.custom_standard_selling_price
#             )

#     if doc.custom_standard_buying_price != doc_before.custom_standard_buying_price:
#         if doc.custom_standard_buying_price is not None:
#             create_or_update_item_price(
#                 doc, "Buying", doc.custom_standard_buying_price
#             )
# def create_or_update_item_price(doc, price_type, rate):
#     if rate is None:
#         return

#     price_list_name = f"Standard {price_type}"

#     item_price = frappe.db.get_value(
#         "Item Price",
#         {"item_code": doc.name, "price_list": price_list_name},
#         "name"
#     )

#     if item_price:
#         frappe.db.set_value(
#             "Item Price",
#             item_price,
#             "price_list_rate",
#             rate
#         )
#     else:
#         ip = frappe.new_doc("Item Price")
#         ip.item_code = doc.name
#         ip.price_list = price_list_name
#         ip.price_list_rate = rate
#         ip.insert(ignore_permissions=True)

# def item_before_save(doc, method):
#     if doc.custom_tax_rate:
#         update_tax_child(doc)


import frappe
import re
from frappe.utils import flt
def item_before_save(doc, method):
    doc_before = doc.get_doc_before_save()
    
    # 1. Check if any tax-related field has changed
    tax_fields = ["custom_tax_rate", "custom_alternative_gst_", "custom_alternative_amount"]
    tax_changed = False
    
    if not doc_before:
        tax_changed = True # New record
    else:
        for field in tax_fields:
            if doc.get(field) != doc_before.get(field):
                tax_changed = True
                break

    # 2. Update Tax Table ONLY if fields changed
    if tax_changed:
        update_tax_child(doc)

    # 3. Calculate POS Price (based on the applicable slab rate)
    if tax_changed or (doc_before and flt(doc.custom_standard_selling_price) != flt(doc_before.custom_standard_selling_price)):
        calculate_and_set_pos_price(doc)

# def item_after_insert(doc, method):
#     # Set description if empty
#     if not doc.description:
#         doc.db_set("description", doc.item_name)
    
    # Sync prices to Item Price List records after creation
#     sync_all_item_prices(doc)

# def item_on_update(doc, method):
#     # Sync prices on every update/save
#     sync_all_item_prices(doc)

# --- Internal Logic ---

def extract_rate_from_string(tax_string):
    if not tax_string: return 0.0
    match = re.search(r"(\d+\.?\d*)", str(tax_string))
    return flt(match.group(1)) if match else 0.0
def calculate_and_set_pos_price(doc):
    """Calculates POS price based on applicable tax slab"""
    selling_price = flt(doc.custom_standard_selling_price)
    threshold = flt(doc.get("custom_alternative_amount"))
    
    # Determine which tax template applies to the current selling price
    applicable_template = doc.custom_tax_rate
    if threshold > 0 and selling_price >= threshold:
        applicable_template = doc.get("custom_alternative_gst_") or doc.custom_tax_rate

    # Extract numeric rate (e.g., 5 from 'GST 5%')
    tax_percent = extract_rate_from_string(applicable_template)
    
    if selling_price > 0:
        doc.custom_pos_price = flt(selling_price / (1 + (tax_percent / 100)), 2)
    else:
        doc.custom_pos_price = 0

# def update_tax_child(doc):
#     """Updates the Item Tax child table (field name 'taxes')"""
#     # Clear existing rows to prevent duplicates on every save
#     doc.set("taxes", [])
    
#     # Add the template selected in the custom_tax_rate field
#     doc.append("taxes", {
#         "item_tax_template": doc.custom_tax_rate
#     })

def sync_all_item_prices(doc):
    """Syncs the prices to Item Price list"""
    prices = [
        ("Standard Selling", doc.custom_standard_selling_price),
        ("Standard Buying", doc.custom_standard_buying_price),
        ("POS Price", doc.custom_pos_price)
    ]
    for price_list, rate in prices:
        if rate is not None:
            sync_price_record(doc.name, price_list, rate)

def sync_price_record(item_code, price_list, rate):
    name = frappe.db.get_value("Item Price", {"item_code": item_code, "price_list": price_list})
    if name:
        frappe.db.set_value("Item Price", name, "price_list_rate", flt(rate), update_modified=True)
    else:
        ip = frappe.new_doc("Item Price")
        ip.item_code = item_code
        ip.price_list = price_list
        ip.price_list_rate = flt(rate)
        ip.insert(ignore_permissions=True)

# --- Standard Hooks ---

def item_after_insert(doc, method):
    if not doc.description: doc.db_set("description", doc.item_name)
    sync_all_item_prices(doc)
    update_barcode_child(doc)
def item_on_update(doc, method):
    sync_all_item_prices(doc)
    update_barcode_child(doc)
# --- Reverse Sync (Price List -> Item Master) ---

def item_price_on_update(doc, method):
    """If a user manually changes an Item Price record, update the Item Master field"""
    field_map = {
        "Standard Selling": "custom_standard_selling_price",
        "Standard Buying": "custom_standard_buying_price",
        "POS Price": "custom_pos_price"
    }

    if doc.price_list in field_map:
        target_field = field_map[doc.price_list]
        current_val = frappe.db.get_value("Item", doc.item_code, target_field)

        # Update Item field if different
        if flt(current_val) != flt(doc.price_list_rate):
            frappe.db.set_value("Item", doc.item_code, target_field, flt(doc.price_list_rate))

            # Trigger POS Price recalculation if Standard Selling was the one changed
            if doc.price_list == "Standard Selling":
                tax_rate_str = frappe.db.get_value("Item", doc.item_code, "custom_tax_rate")
                tax_percent = extract_rate_from_string(tax_rate_str)
                new_pos = flt(flt(doc.price_list_rate) / (1 + (tax_percent / 100)), 2)
                
                # Update both the Item Field and the POS Price list record
                frappe.db.set_value("Item", doc.item_code, "custom_pos_price", new_pos)
                sync_price_record(doc.item_code, "POS Price", new_pos)





import frappe

@frappe.whitelist()
def get_bom_data_for_item(item_code):
    """
    Fetches raw BOM data for a given item_code, including child items with extended details,
    and returns it as a list of dictionaries.
    """
    boms = frappe.get_all(
        "BOM",
        filters={"item": item_code,"docstatus": 1},
        fields=["name", "is_active", "is_default"]
    )

    if not boms:
        return []

    for bom in boms:
        # --- MODIFICATION ---
        # Added 'item_name', 'rate', and 'amount' to the fields list.
        bom['items'] = frappe.get_all(
            "BOM Item", 
            filters={"parent": bom.name},
            fields=["item_code", "item_name", "qty", "uom", "rate", "amount"]
        )
        # --- END MODIFICATION ---

    return boms

# def update_tax_child(doc):
#     try:
#         # Clear existing taxes
#         doc.taxes = []

#         # Fetch tax_rate
#         tax_rate = doc.custom_tax_rate  # Assuming this stores your tax template

#         if tax_rate and tax_rate != 'Non-GST - IND':
#             # Add In-State entry
#             doc.append('taxes', {
#                 "tax_category": "In-State",
#                 "item_tax_template": tax_rate
#             })

#             # Add Out-State entry
#             doc.append('taxes', {
#                 "tax_category": "Out-State",
#                 "item_tax_template": tax_rate
#             })

#         # # Always add Non-GST entry
#         # doc.append('taxes', {
#         #     # "tax_category": "Non-GST",
#         #     "item_tax_template": "Non-GST - IND"
#         # })
#         doc.save()
#     except Exception as e:
#         frappe.log_error(f"Error in updating taxes: {str(e)}")


# def update_tax_child(doc):
#     try:
#         # Clear existing taxes
#         doc.taxes = []

#         tax_rate = doc.custom_tax_rate  # Primary GST template
#         alt_tax = doc.get("custom_alternative_gst_") # Slab GST template
#         alt_amount = flt(doc.get("custom_alternative_amount")) # Threshold Amount

#         if tax_rate:
#             if alt_tax and alt_amount > 0:
#                 # SLAB 1: For rates less than custom_alternative_amount
#                 # We set maximum_net_rate to (threshold - 1)
#                 for category in ["In-State", "Out-State"]:
#                     doc.append('taxes', {
#                         "tax_category": category,
#                         "item_tax_template": tax_rate,
#                         "maximum_net_rate": alt_amount - 1
#                     })

#                 # SLAB 2: For rates greater than or equal to custom_alternative_amount
#                 # We set minimum_net_rate to threshold and maximum to 99999
#                 for category in ["In-State", "Out-State"]:
#                     doc.append('taxes', {
#                         "tax_category": category,
#                         "item_tax_template": alt_tax,
#                         "minimum_net_rate": alt_amount,
#                         "maximum_net_rate": 99999
#                     })
#             else:
#                 # Fallback: Normal logic if alternative amount/gst is not provided
#                 if tax_rate != 'Non-GST - IND':
#                     for category in ["In-State", "Out-State"]:
#                         doc.append('taxes', {
#                             "tax_category": category,
#                             "item_tax_template": tax_rate
#                         })

#     except Exception as e:
#         frappe.log_error(f"Error in updating taxes for {doc.name}: {str(e)}")



def update_tax_child(doc):
    """Your provided logic with protection"""
    try:
        # Clear existing taxes
        doc.set("taxes", [])

        tax_rate = doc.custom_tax_rate  # Primary GST template
        alt_tax = doc.get("custom_alternative_gst_") # Slab GST template
        alt_amount = flt(doc.get("custom_alternative_amount")) # Threshold Amount

        if tax_rate:
            if alt_tax and alt_amount > 0:
                # SLAB 1: Below threshold
                for category in ["In-State", "Out-State"]:
                    doc.append('taxes', {
                        "tax_category": category,
                        "item_tax_template": tax_rate,
                        "maximum_net_rate": alt_amount - 0.01
                    })

                # SLAB 2: Above or equal to threshold
                for category in ["In-State", "Out-State"]:
                    doc.append('taxes', {
                        "tax_category": category,
                        "item_tax_template": alt_tax,
                        "minimum_net_rate": alt_amount,
                        "maximum_net_rate": 0 # 0 usually means no limit in ERPNext
                    })
            else:
                # Fallback: Normal logic
                if tax_rate != 'Non-GST - IND':
                    for category in ["In-State", "Out-State"]:
                        doc.append('taxes', {
                            "tax_category": category,
                            "item_tax_template": tax_rate
                        })

    except Exception as e:
        frappe.log_error(title="Error in update_tax_child", message=frappe.get_traceback())




def update_barcode_child(doc):
    try:
        # Assuming you have a custom field 'custom_barcode_input' to capture the value
        # or checking if there's any value in 'barcode' field to append
        barcode_value = doc.get("barcode") or doc.get("custom_barcode")
        
        if barcode_value:
            # Check if this barcode already exists in the child table to avoid duplicates
            exists = False
            for b in doc.get("barcodes"):
                if b.barcode == barcode_value:
                    exists = True
                    break
            
            if not exists:
                doc.set("barcodes", [])
                doc.append("barcodes", {
                    "barcode": barcode_value,
                    "barcode_type": "CODE-39"
                })
    except Exception as e:
        frappe.log_error(f"Error in updating barcodes for {doc.name}: {str(e)}")
import frappe

@frappe.whitelist()
def get_customer_contacts(customer):
    """Return all contacts linked to a given customer with phone and email details"""
    return frappe.db.sql("""
        SELECT 
            c.name, 
            c.first_name,
            c.last_name,
            (SELECT phone FROM `tabContact Phone` WHERE parent=c.name AND is_primary_phone=1 LIMIT 1) AS phone,
            (SELECT email_id FROM `tabContact Email` WHERE parent=c.name AND is_primary=1 LIMIT 1) AS email
        FROM `tabContact` c
        INNER JOIN `tabDynamic Link` dl ON dl.parent = c.name
        WHERE dl.link_doctype = 'Customer' AND dl.link_name = %s
    """, (customer,), as_dict=1)




########### warehouse stock and last prices ###########
import frappe

# This is your existing function - no changes needed
@frappe.whitelist()
def get_item_details(item_code, sales_order=None):
    """
    Get available stock, last selling price, sales order info,
    total picked qty (for this SO), picked_qty (actual picked from Pick List Item),
    and open overall picked qty (all Pick Lists).
    """
    warehouse_data = []

    # Get stock balance by warehouse
    stock_entries = frappe.db.sql("""
        SELECT
            sle.warehouse,
            SUM(sle.actual_qty) AS available_qty
        FROM `tabStock Ledger Entry` sle
        WHERE sle.item_code = %s
        GROUP BY sle.warehouse
        HAVING SUM(sle.actual_qty) > 0
    """, (item_code,), as_dict=True)

    total_available_stock = sum([d.available_qty for d in stock_entries]) if stock_entries else 0

    # Get last selling price
    last_price = frappe.db.sql("""
        SELECT
            si_item.base_rate AS last_selling_price
        FROM `tabSales Invoice Item` si_item
        JOIN `tabSales Invoice` si ON si.name = si_item.parent
        WHERE si_item.item_code = %s AND si.docstatus = 1
        ORDER BY si.posting_date DESC
        LIMIT 1
    """, (item_code,), as_dict=True)

    total_qty, delivered_qty, pending_qty = 0, 0, 0
    total_picked, total_picked_qty, open_overall_picked_qty = 0, 0, 0

    if sales_order:
        so_item = frappe.db.get_value("Sales Order Item", {"parent": sales_order, "item_code": item_code}, ["qty", "delivered_qty"], as_dict=True)
        if so_item:
            total_qty = so_item.qty or 0
            delivered_qty = so_item.delivered_qty or 0
            pending_qty = max(total_qty - delivered_qty, 0)

        picked = frappe.db.sql("""
            SELECT SUM(pli.qty) AS total_picked, SUM(pli.picked_qty) AS total_picked_qty
            FROM `tabPick List Item` pli
            JOIN `tabPick List` pl ON pli.parent = pl.name
            WHERE pli.item_code = %s AND pli.sales_order = %s AND pl.docstatus IN (0, 1)
        """, (item_code, sales_order), as_dict=True)
        if picked:
            total_picked = picked[0].total_picked or 0
            total_picked_qty = picked[0].total_picked_qty or 0

    open_pick = frappe.db.sql("""
        SELECT SUM(pli.picked_qty) AS open_picked_qty
        FROM `tabPick List Item` pli
        JOIN `tabPick List` pl ON pli.parent = pl.name
        WHERE pli.item_code = %s AND pl.docstatus IN (0, 1)
    """, (item_code,), as_dict=True)
    if open_pick:
        open_overall_picked_qty = open_pick[0].open_picked_qty or 0

    return {
        "warehouse_data": stock_entries,
        "last_selling_price": last_price[0].last_selling_price if last_price else "N/A",
        "total_available_stock": total_available_stock,
        "total_qty": total_qty,
        "delivered_qty": delivered_qty,
        "pending_qty": pending_qty,
        "total_picked": total_picked,
        "total_picked_qty": total_picked_qty,
        "open_overall_picked_qty": open_overall_picked_qty
    }


# NEW function to get the detailed picklist data for the modal view
@frappe.whitelist()
def get_overall_picklist_details(item_code):
    """
    Get detailed information for all open/submitted pick lists for a given item,
    including Sales Order and Customer details.
    """
    if not item_code:
        return []

    picklist_details = frappe.db.sql("""
        SELECT
            pl.name as pick_list,
            pl.docstatus,
            pli.sales_order,
            so.customer,
            pli.qty,
            pli.picked_qty
        FROM `tabPick List Item` AS pli
        JOIN `tabPick List` AS pl ON pli.parent = pl.name
        LEFT JOIN `tabSales Order` AS so ON pli.sales_order = so.name
        WHERE pli.item_code = %s
          AND pl.docstatus IN (0, 1)  -- Consider only Draft and Submitted Pick Lists
        ORDER BY pl.modified DESC
    """, (item_code,), as_dict=True)

    return picklist_details



import frappe
from frappe import _
from frappe.utils import flt

# ==============================================================================
# 1. MAIN FUNCTION: Gathers all stock, allocation, and incoming PO data.
# ==============================================================================
@frappe.whitelist()
def get_item_stock_details(item_code, sales_order_name):
    """
    Enhanced version. Fetches all data needed for the enhanced UI,
    including details on incoming stock from purchase orders.
    """
    so_item_details = frappe.db.get_value("Sales Order Item", {"parent": sales_order_name, "item_code": item_code}, ["delivered_qty", "qty"], as_dict=True)
    delivered_qty = flt(so_item_details.get('delivered_qty')) if so_item_details else 0
    required_qty = flt(so_item_details.get('qty')) if so_item_details else 0

    # Get available physical stock
    warehouse_stock = frappe.db.sql("""
        SELECT warehouse, actual_qty FROM `tabBin` WHERE item_code = %s AND actual_qty > 0
    """, (item_code,), as_dict=True)
    total_available_stock = sum(flt(w.get('actual_qty')) for w in warehouse_stock)

    # Get quantities picked for the current Sales Order (Submitted and Draft)
    picked_for_current_so = frappe.db.sql("""
        SELECT
            SUM(CASE WHEN pl.docstatus = 1 THEN pli.picked_qty ELSE 0 END) as picked_submitted_qty,
            SUM(CASE WHEN pl.docstatus = 0 THEN pli.qty ELSE 0 END) as picked_draft_qty
        FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pli.parent = pl.name
        WHERE pli.item_code = %s AND pli.sales_order = %s
    """, (item_code, sales_order_name), as_dict=True)
    
    picked_submitted_qty_so = flt(picked_for_current_so[0].get('picked_submitted_qty')) if picked_for_current_so else 0
    picked_draft_qty_so = flt(picked_for_current_so[0].get('picked_draft_qty')) if picked_for_current_so else 0

    # Get stock reserved for other open Sales Orders
    reserved_for_others_qty = frappe.db.sql("""
        SELECT SUM(pli.qty)
        FROM `tabPick List Item` pli
        JOIN `tabPick List` pl ON pli.parent = pl.name
        JOIN `tabSales Order Item` so_item ON pli.sales_order = so_item.parent AND pli.item_code = so_item.item_code
        WHERE pli.item_code = %(item_code)s
          AND pli.sales_order != %(sales_order_name)s
          AND pl.docstatus = 1
          AND so_item.delivered_qty < so_item.qty
    """, {"item_code": item_code, "sales_order_name": sales_order_name}, as_list=True)
    
    reserved_for_others_qty = flt(reserved_for_others_qty[0][0]) if reserved_for_others_qty and reserved_for_others_qty[0] else 0

    # NEW: Get incoming stock from open Purchase Orders
    incoming_stock_details = get_incoming_stock_details(item_code)
    total_incoming_qty = sum(flt(po.get('pending_qty')) for po in incoming_stock_details)

    return {
        "delivered_qty": delivered_qty,
        "required_qty": required_qty,
        "warehouse_stock": warehouse_stock,
        "total_available_stock": total_available_stock,
        "picked_submitted_qty_so": picked_submitted_qty_so,
        "picked_draft_qty_so": picked_draft_qty_so,
        "reserved_for_others_qty": reserved_for_others_qty,
        "incoming_stock": incoming_stock_details, # List of POs
        "total_incoming_qty": total_incoming_qty,   # Sum of pending PO quantities
    }

# ==============================================================================
# 2. NEW HELPER FUNCTION: Gets details of incoming stock from open POs.
# ==============================================================================
@frappe.whitelist()
def get_incoming_stock_details(item_code):
    """
    Returns a list of submitted, non-closed Purchase Orders for a given item.
    """
    return frappe.db.sql("""
        SELECT
            po.name as po_name,
            po.supplier,
            po_item.qty as ordered_qty,
            po_item.received_qty,
            (po_item.qty - po_item.received_qty) as pending_qty,
            po_item.schedule_date
        FROM `tabPurchase Order Item` as po_item
        JOIN `tabPurchase Order` as po ON po_item.parent = po.name
        WHERE
            po_item.item_code = %(item_code)s
            AND po.docstatus = 1 -- Submitted
            AND po.status NOT IN ('Closed', 'Cancelled', 'Completed')
        ORDER BY
            po_item.schedule_date ASC
    """, {"item_code": item_code}, as_dict=True)

# ==============================================================================
# 3. HELPER FUNCTION: Gets details for the "Manage Allocation" dialog.
# ==============================================================================
@frappe.whitelist()
def get_conflicting_picklists(item_code, current_sales_order):
    """
    Returns the list of Pick Lists reserving stock for other orders.
    """
    return frappe.db.sql("""
        SELECT
            pl.name as pick_list_name,
            pli.sales_order,
            so.customer,
            pli.qty
        FROM `tabPick List Item` AS pli
        JOIN `tabPick List` AS pl ON pli.parent = pl.name
        JOIN `tabSales Order` AS so ON pli.sales_order = so.name
        JOIN `tabSales Order Item` AS soi ON pli.sales_order = soi.parent AND pli.item_code = soi.item_code
        WHERE
            pli.item_code = %(item_code)s
            AND pli.sales_order != %(current_sales_order)s
            AND pl.docstatus = 1
            AND soi.delivered_qty < soi.qty
        ORDER BY
            so.transaction_date ASC
    """, {"item_code": item_code, "current_sales_order": current_sales_order}, as_dict=True)

# ==============================================================================
# 4. ACTION FUNCTION: Cancels a Pick List to release stock.
# ==============================================================================
@frappe.whitelist()
def release_stock_from_picklist(picklist_name):
    """
    Cancels the specified pick list to free up reserved stock.
    """
    try:
        picklist_doc = frappe.get_doc("Pick List", picklist_name)
        picklist_doc.check_permission("cancel")
        if picklist_doc.docstatus != 1:
            frappe.throw(_(f"Pick List {picklist_name} is not in a 'Submitted' state."))
        
        picklist_doc.cancel()
        frappe.db.commit() # Important to commit the change
        return {"status": "success", "message": _(f"Successfully cancelled Pick List <strong>{picklist_name}</strong>. Stock released.")}
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Pick List Cancellation Error")
        return {"status": "error", "message": _(f"Could not cancel Pick List: {str(e)}")}




@frappe.whitelist()
def get_stock_reservations(sales_order, item_code=None):
    """
    Fetch stock reservations for a given Sales Order.
    If item_code is provided, filter reservations for that item only.
    Includes item_name from the Item doctype.
    """
    try:
        # Base SQL and args
        sql = """
            SELECT 
                sre.creation AS date, 
                sre.warehouse, 
                sre.reserved_qty, 
                sre.voucher_qty, 
                sre.status, 
                sre.item_code,
                i.item_name
            FROM `tabStock Reservation Entry` sre
            LEFT JOIN `tabItem` i ON i.name = sre.item_code
            WHERE sre.voucher_no = %s
            AND sre.status != 'Cancelled'
        """
        args = [sales_order]

        # Add item_code filter if provided
        if item_code:
            sql += " AND sre.item_code = %s"
            args.append(item_code)

        # Order by creation descending
        sql += " ORDER BY sre.creation DESC"

        reservations = frappe.db.sql(sql, tuple(args), as_dict=True)
    except Exception:
        # fallback if table doesn't exist
        reservations = []

    return reservations

import frappe
import json
from frappe.utils import flt


# @frappe.whitelist()
# def get_item_stock_details_bulk(item_codes, sales_order_name):
#     """
#     FINAL MERGED VERSION
#     Aggregated stock details for a list of items in the context of a Sales Order.
    
#     Includes:
#     1. Global Warehouse Stock
#     2. SO-Specific Stock Reservation (Received vs Delivered logic)
#     3. Pick List Status (Reserved for This SO vs Conflicts/Others)
#     4. Incoming Stock (Purchase Orders + Embroidery Work Orders)
#     5. RM Procurement Status (BOM breakdown linked to specific SO-POs)
#     """

#     if isinstance(item_codes, str):
#         item_codes = json.loads(item_codes)
#     if not isinstance(item_codes, list):
#         frappe.throw("Invalid item_codes format. Expected a list.")

#     # 1. Fetch Context
#     try:
#         so_doc = frappe.get_doc("Sales Order", sales_order_name) if sales_order_name else None
#     except frappe.DoesNotExistError:
#         so_doc = None

#     so_items_list = so_doc.items if so_doc else []
#     so_items_map = {i.item_code: i for i in so_items_list}
#     results = {}

#     for item_code in item_codes:
#         so_item = so_items_map.get(item_code, frappe._dict())

#         # =========================================================
#         # 2. BASIC METRICS
#         # =========================================================
#         required_qty = flt(so_item.qty or 0)
#         delivered_qty = flt(so_item.delivered_qty or 0)
#         warehouse = so_item.warehouse or (so_doc.set_warehouse if so_doc else None)
#         bom_no = so_item.bom_no if so_item else None
#         stock_uom = so_item.stock_uom or frappe.db.get_value("Item", item_code, "stock_uom")

#         # =========================================================
#         # 3. PHYSICAL WAREHOUSE STOCK
#         # =========================================================
#         warehouse_stock = frappe.db.sql("""
#             SELECT warehouse, actual_qty 
#             FROM `tabBin` 
#             WHERE item_code = %s AND actual_qty > 0
#             ORDER BY actual_qty DESC
#         """, item_code, as_dict=1)

#         total_available_stock = sum(flt(w.actual_qty) for w in warehouse_stock)

#         # =========================================================
#         # 4. COMPLETED RECEIPTS (Standard PR + Subcontracting Receipt)
#         # =========================================================
#         # Determine how much stock currently in the warehouse was specifically 
#         # "Received" for this Sales Order history.
#         completed_receipt_docs = frappe.db.sql("""
#             (
#                 -- 1. STANDARD PURCHASE RECEIPT
#                 SELECT 
#                     pr.name AS pr_name, '' AS sr_name,
#                     pri.purchase_order AS po_name, pri.sales_order AS so_name,
#                     pr.posting_date, pri.received_qty, pr.is_subcontracted
#                 FROM `tabPurchase Receipt Item` pri
#                 JOIN `tabPurchase Receipt` pr ON pri.parent = pr.name
#                 WHERE pri.item_code = %(item)s AND pri.sales_order = %(so_name)s
#                 AND pr.docstatus = 1 AND pr.is_subcontracted = 0
#             )
#             UNION
#             (
#                 -- 2. SUBCONTRACTING RECEIPT
#                 SELECT 
#                     '' AS pr_name, scr.name AS sr_name,
#                     scri.purchase_order AS po_name, poi.sales_order AS so_name,
#                     scr.posting_date, scri.qty AS received_qty, 1 AS is_subcontracted
#                 FROM `tabSubcontracting Receipt Item` scri
#                 JOIN `tabSubcontracting Receipt` scr ON scri.parent = scr.name
#                 JOIN `tabPurchase Order Item` poi ON scri.purchase_order_item = poi.name
#                 WHERE scri.item_code = %(item)s AND scr.docstatus = 1 AND poi.sales_order = %(so_name)s
#             )
#             ORDER BY posting_date DESC
#         """, {"so_name": sales_order_name, "item": item_code}, as_dict=1)

#         total_historical_received_for_so = sum(flt(r.received_qty) for r in completed_receipt_docs)
        
#         # Calculate Net "Remaining" Stock specifically for this SO
#         total_delivered_from_this_so = sum(flt(i.delivered_qty) for i in so_items_list if i.item_code == item_code)
#         remaining_so_specific_stock = max(0, total_historical_received_for_so - total_delivered_from_this_so)
        
#         # Partition logic:
#         # If we have 10 available globally, and 2 are specifically remaining for this SO,
#         # Then Received_For_SO = 2, General_Stock = 8.
#         received_for_so_qty = min(remaining_so_specific_stock, total_available_stock)
#         general_stock_qty = max(0, total_available_stock - received_for_so_qty)

#         # =========================================================
#         # 5. PICK LIST STATUS
#         # =========================================================
#         # A. For THIS Sales Order
#         picked_for_this_so_details = frappe.db.sql("""
#             SELECT 
#                 pl.name AS pick_list_name, pl.docstatus, pl.per_delivered, 
#                 pl.delivery_status, pli.qty, pli.picked_qty
#             FROM `tabPick List Item` pli
#             JOIN `tabPick List` pl ON pli.parent = pl.name
#             WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus < 2
#         """, (sales_order_name, item_code), as_dict=1)

#         picked_draft_qty_so = sum(flt(p.qty) for p in picked_for_this_so_details if p.docstatus == 0)
#         picked_submitted_qty_so_actual = sum(flt(p.picked_qty) for p in picked_for_this_so_details if p.docstatus == 1)
#         picked_submitted_undelivered_qty = sum(
#             flt(p.picked_qty) * (1 - flt(p.per_delivered or 0) / 100)
#             for p in picked_for_this_so_details if p.docstatus == 1
#         )

#         # B. For OTHERS (Conflicts)
#         if sales_order_name:
#             picked_for_others_details = frappe.db.sql("""
#                 SELECT pl.name AS pick_list_name, pl.customer, pli.sales_order, 'Submitted' AS status,
#                        (pli.picked_qty * (100 - IFNULL(pl.per_delivered, 0)) / 100) AS qty
#                 FROM `tabPick List` pl JOIN `tabPick List Item` pli ON pl.name = pli.parent
#                 WHERE pl.docstatus = 1 AND pl.status NOT IN ('Completed', 'Cancelled')
#                   AND pli.item_code = %s AND pli.sales_order != %s
#             """, (item_code, sales_order_name), as_dict=1)
            
#             draft_for_others_details = frappe.db.sql("""
#                 SELECT pl.name AS pick_list_name, pl.customer, pli.sales_order, 'Draft' AS status, pli.qty
#                 FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pli.parent = pl.name
#                 WHERE pl.docstatus = 0 AND pli.item_code = %s AND pli.sales_order != %s
#             """, (item_code, sales_order_name), as_dict=1)
#         else:
#              picked_for_others_details = frappe.db.sql("""
#                 SELECT pl.name AS pick_list_name, pl.customer, pli.sales_order, 'Submitted' AS status,
#                        (pli.picked_qty * (100 - IFNULL(pl.per_delivered, 0)) / 100) AS qty
#                 FROM `tabPick List` pl JOIN `tabPick List Item` pli ON pl.name = pli.parent
#                 WHERE pl.docstatus = 1 AND pl.status NOT IN ('Completed', 'Cancelled') AND pli.item_code = %s
#             """, (item_code,), as_dict=1)
             
#              draft_for_others_details = frappe.db.sql("""
#                 SELECT pl.name AS pick_list_name, pl.customer, pli.sales_order, 'Draft' AS status, pli.qty
#                 FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pli.parent = pl.name
#                 WHERE pl.docstatus = 0 AND pli.item_code = %s
#             """, (item_code,), as_dict=1)

#         picked_for_others_qty = sum(flt(r.qty) for r in picked_for_others_details)
#         draft_qty_for_others = sum(flt(r.qty) for r in draft_for_others_details)
#         conflict_details = picked_for_others_details + draft_for_others_details

#         # =========================================================
#         # 6. INCOMING STOCK
#         # =========================================================
#         incoming_stock = []
#         total_incoming_qty = 0
#         total_incoming_po_count = 0
#         total_incoming_ewo_count = 0

#         # 6A. PURCHASE ORDERS
#         # Merged logic: Checks standard PO Items vs Subcontracted FG Items
#         po_data = frappe.db.sql("""
#             SELECT 
#                 po.name, po.supplier, po.schedule_date, po.is_subcontracted, 
#                 poi.warehouse,
#                 CASE 
#                     WHEN po.is_subcontracted = 1 THEN (poi.fg_item_qty - poi.received_qty) 
#                     ELSE (poi.qty - poi.received_qty) 
#                 END AS pending_qty
#             FROM `tabPurchase Order Item` poi 
#             JOIN `tabPurchase Order` po ON poi.parent = po.name
#             WHERE 
#                 poi.sales_order = %(so)s 
#                 AND po.docstatus = 1
#                 AND (
#                     (po.is_subcontracted=0 AND poi.item_code=%(item)s AND (poi.qty-poi.received_qty)>0)
#                     OR 
#                     (po.is_subcontracted=1 AND poi.fg_item=%(item)s AND (poi.fg_item_qty-poi.received_qty)>0)
#                 )
#         """, {"so": sales_order_name, "item": item_code}, as_dict=1)

#         for row in po_data:
#             pending = flt(row.pending_qty)
#             incoming_stock.append({
#                 "doc_type": "Purchase Order",
#                 "name": row.name,
#                 "info": row.supplier,
#                 "pending_qty": pending,
#                 "warehouse": row.warehouse,
#                 "is_ewo": 0,
#                 "is_subcontracted": row.is_subcontracted
#             })
#             total_incoming_qty += pending
#             total_incoming_po_count += 1

#         # 6B. EMBROIDERY WORK ORDERS
#         # Merged logic: Uses robust joining for SO validation + Extended selection for UI
#         ewo_data = frappe.db.sql("""
#             SELECT 
#                 parent.name, 
#                 parent.date,
#                 parent.purchase_order,
#                 parent.subcontracting_order,
#                 parent.work_type,
#                 /* Detailed Display Info */
#                 parent.panel_jobber, 
#                 parent.panel_stage,
#                 parent.full_piece_jobber, 
#                 parent.full_piece_stage,
                
#                 child.ordered_qty, 
#                 child.received_qty,
#                 child.pending_qty
#             FROM `tabEmbroidery Work Order` parent
#             JOIN `tabEmbroidery Work Order Item` child ON child.parent = parent.name
#             /* Enforce valid SO link via Parent PO Item */
#             JOIN `tabPurchase Order Item` poi ON poi.parent = parent.purchase_order
#             WHERE 
#                 child.item_code = %(item)s 
#                 AND parent.docstatus = 1
#                 AND poi.sales_order = %(so)s
#                 /* Check Standard or Subcontract (FG) Item match */
#                 AND (poi.item_code = child.item_code OR poi.fg_item = child.item_code)
#                 /* Validation: Pending must exist either in column or via calc */
#                 AND (IFNULL(child.pending_qty, 0) > 0 OR (child.ordered_qty - IFNULL(child.received_qty, 0)) > 0)
#         """, {"so": sales_order_name, "item": item_code}, as_dict=1)
        
#         for row in ewo_data:
#             # Check explicit pending_qty first (robust), else calculate
#             if flt(row.pending_qty) > 0:
#                 qty = flt(row.pending_qty)
#             else:
#                 qty = max(0, flt(row.ordered_qty) - flt(row.received_qty))

#             # UI Field mapping
#             if row.work_type == "Full Piece Job Work":
#                 jobber_display = row.full_piece_jobber
#                 stage_display = row.full_piece_stage
#             else:
#                 jobber_display = row.panel_jobber
#                 stage_display = row.panel_stage
            
#             # Combine UI properties
#             incoming_stock.append({
#                 "doc_type": "Embroidery Work Order",
#                 "name": row.name,
#                 "date": row.date,
#                 "work_type": row.work_type,
#                 "info": jobber_display or "Job Work", 
#                 "stage": stage_display,
#                 "po_ref": row.purchase_order,
                
#                 "pending_qty": qty,
#                 "ordered_qty": flt(row.ordered_qty),
#                 "received_qty": flt(row.received_qty),
                
#                 "warehouse": "",
#                 "is_ewo": 1
#             })
#             total_incoming_qty += qty
#             total_incoming_ewo_count += 1

#         # =========================================================
#         # 7. RM PROCUREMENT (BOM ITEMS) - UPDATED
#         # =========================================================
#         rm_procurement_status = {
#             "rm_shortfall_exists": False, 
#             "rm_items_status": [],
#             "fg_shortfall": 0
#         }

#         # CALCULATE FG SHORTFALL (Match the UI Logic: Required - Delivered - Available - Picked)
#         # In your example: (7 - 0) - 1 available = 6 units needing production/material
#         all_res = (picked_submitted_undelivered_qty + picked_draft_qty_so + picked_for_others_qty + draft_qty_for_others)
#         truly_available_fg = max(0, total_available_stock - all_res)
#         fg_remaining_to_plan = (required_qty - delivered_qty) - (picked_submitted_undelivered_qty + picked_draft_qty_so)
#         fg_shortfall = max(0, fg_remaining_to_plan - truly_available_fg)
        
#         rm_procurement_status["fg_shortfall"] = fg_shortfall

#         # Only proceed if we have an actual FG shortfall needing raw materials
#         if bom_no and fg_shortfall > 0:
#             try:
#                 bom_doc = frappe.get_doc("BOM", bom_no)
#                 rm_codes = [i.item_code for i in bom_doc.items]
#                 rm_map = {}
                
#                 for bi in bom_doc.items:
#                     rm_code = bi.item_code
#                     qty_per_fg = flt(bi.stock_qty) if bi.stock_qty else flt(bi.qty)
                    
#                     rm_map[rm_code] = {
#                         "rm_code": rm_code,
#                         "rm_uom": bi.uom or bi.stock_uom,
#                         "rm_needed_for_shortfall": fg_shortfall * qty_per_fg,  # The 6 units x Qty
#                         "rm_required_total": (required_qty - delivered_qty) * qty_per_fg, # The total order qty x Qty
#                         "rm_available_stock": 0,         
#                         "rm_pending_so_linked_total": 0,
#                         "rm_shortfall_total": 0,
#                         "po_documents": []
#                     }

#                 if rm_codes:
#                     # B. Get Global Warehouse Stock
#                     stock_data = frappe.db.sql("""
#                         SELECT item_code, SUM(actual_qty) as qty
#                         FROM `tabBin`
#                         WHERE item_code IN %s AND actual_qty > 0
#                         GROUP BY item_code
#                     """, (tuple(rm_codes),), as_dict=1) # Search globally or specify warehouse
                    
#                     for s in stock_data:
#                         if s.item_code in rm_map:
#                             rm_map[s.item_code]["rm_available_stock"] = flt(s.qty)

#                     # C. SO Specific Procurement Source Check
#                     so_procurement_data = frappe.db.sql("""
#                         SELECT 
#                             source.raw_material_item,
#                             SUM(poi.qty) as total_ordered,
#                             SUM(poi.received_qty) as total_received,
#                             GROUP_CONCAT(DISTINCT source.parent) as po_list
#                         FROM `tabPurchase Order Raw Material Source` source
#                         JOIN `tabPurchase Order Item` poi 
#                             ON poi.parent = source.parent 
#                             AND poi.item_code = source.raw_material_item 
#                         WHERE source.source_sales_order = %s
#                           AND source.raw_material_item IN %s
#                           AND poi.docstatus = 1  
#                         GROUP BY source.raw_material_item
#                     """, (sales_order_name, tuple(rm_codes)), as_dict=1)

#                     for d in so_procurement_data:
#                         rm = rm_map.get(d.raw_material_item)
#                         if rm:
#                             rm["rm_ordered_so_total"] = flt(d.total_ordered)
#                             rm["rm_received_so_total"] = flt(d.total_received)
#                             rm["rm_pending_so_linked_total"] = max(0, flt(d.total_ordered) - flt(d.total_received))
#                             if d.po_list:
#                                 rm["po_documents"] = d.po_list.split(",")

#                 # D. Updated Shortfall Calculation Logic
#                 for rm in rm_map.values():
#                     # Gap = Needed for production - (what we have + what's already on PO)
#                     coverage = rm["rm_available_stock"] + rm["rm_pending_so_linked_total"]
#                     shortfall = max(0, rm["rm_needed_for_shortfall"] - coverage)
#                     rm["rm_shortfall_total"] = shortfall
                    
#                     if shortfall > 0:
#                         rm_procurement_status["rm_shortfall_exists"] = True
#                         rm["status"] = "Shortage"
#                     else:
#                         rm["status"] = "Covered"

#                     rm_procurement_status["rm_items_status"].append(rm)

#             except Exception as e:
#                 frappe.log_error(f"RM Error {item_code}", str(e))
        
#         # =========================================================
#         # 8. FINAL DATA PACKAGING
#         # =========================================================
#         results[item_code] = {
#             # Metrics
#             "required_qty": required_qty,
#             "delivered_qty": delivered_qty,
#             "total_available_stock": total_available_stock,
#             "received_for_so_qty": received_for_so_qty,
#             "general_stock_qty": general_stock_qty,
#             "warehouse_stock": warehouse_stock,
#             "completed_receipt_docs": completed_receipt_docs,

#             # Pick Lists
#             "picked_for_this_so_details": picked_for_this_so_details,
#             "picked_draft_qty_so": picked_draft_qty_so,
#             "picked_submitted_qty_so_actual": picked_submitted_qty_so_actual,
#             "picked_submitted_undelivered_qty": picked_submitted_undelivered_qty,
#             "picked_for_others_qty": picked_for_others_qty,
#             "draft_qty_for_others": draft_qty_for_others,
#             "conflict_details": conflict_details,

#             # Incoming
#             "incoming_stock": incoming_stock,
#             "total_incoming_qty": total_incoming_qty,
#             "total_incoming_po_count": total_incoming_po_count,
#             "total_incoming_ewo_count": total_incoming_ewo_count,
#             "total_incoming_se_count": 0,

#             # RM / BOM
#             "rm_procurement_status": rm_procurement_status,
#             "is_bom_item": bool(bom_no),
            
#             # Context
#             "customer": so_doc.customer if so_doc else None,
#             "warehouse": warehouse,
#             "stock_uom": stock_uom
#         }

#     return results






# @frappe.whitelist()
# def get_item_stock_details_bulk(item_codes, sales_order_name):
#     """
#     FINAL MERGED VERSION
#     Aggregated stock details for a list of items in the context of a Sales Order.
    
#     Includes:
#     1. Global Warehouse Stock
#     2. SO-Specific Stock Reservation (Received vs Delivered logic)
#     3. Pick List Status (Reserved for This SO vs Conflicts/Others)
#     4. Incoming Stock (Purchase Orders + Embroidery Work Orders)
#     5. RM Procurement Status (BOM breakdown linked to specific SO-POs)
#     """

#     if isinstance(item_codes, str):
#         item_codes = json.loads(item_codes)
#     if not isinstance(item_codes, list):
#         frappe.throw("Invalid item_codes format. Expected a list.")

#     # 1. Fetch Context
#     try:
#         so_doc = frappe.get_doc("Sales Order", sales_order_name) if sales_order_name else None
#     except frappe.DoesNotExistError:
#         so_doc = None

#     so_items_list = so_doc.items if so_doc else []
#     from collections import defaultdict

#     so_items_map = defaultdict(list)
#     for i in so_items_list:
#         so_items_map[i.item_code].append(i)
#     results = {}

#     for item_code in item_codes:
#         so_items = so_items_map.get(item_code, [])

#         required_qty = sum(flt(i.qty) for i in so_items)
#         delivered_qty = sum(flt(i.delivered_qty) for i in so_items)

#         # pick BOM & warehouse safely
#         bom_no = next((i.bom_no for i in so_items if i.bom_no), None)
#         warehouse = next((i.warehouse for i in so_items if i.warehouse), None)
#         stock_uom = so_items[0].stock_uom if so_items else frappe.db.get_value("Item", item_code, "stock_uom")


#         # =========================================================
#         # 3. PHYSICAL WAREHOUSE STOCK
#         # =========================================================
#         warehouse_stock = frappe.db.sql("""
#             SELECT warehouse, actual_qty 
#             FROM `tabBin` 
#             WHERE item_code = %s AND actual_qty > 0
#             ORDER BY actual_qty DESC
#         """, item_code, as_dict=1)

#         total_available_stock = sum(flt(w.actual_qty) for w in warehouse_stock)

#         # =========================================================
#         # 4. COMPLETED RECEIPTS (Standard PR + Subcontracting Receipt)
#         # =========================================================
#         # Determine how much stock currently in the warehouse was specifically 
#         # "Received" for this Sales Order history.
#         completed_receipt_docs = frappe.db.sql("""
#             (
#                 -- 1. STANDARD PURCHASE RECEIPT
#                 SELECT 
#                     pr.name AS pr_name, '' AS sr_name,
#                     pri.purchase_order AS po_name, pri.sales_order AS so_name,
#                     pr.posting_date, pri.received_qty, pr.is_subcontracted
#                 FROM `tabPurchase Receipt Item` pri
#                 JOIN `tabPurchase Receipt` pr ON pri.parent = pr.name
#                 WHERE pri.item_code = %(item)s AND pri.sales_order = %(so_name)s
#                 AND pr.docstatus = 1 AND pr.is_subcontracted = 0
#             )
#             UNION
#             (
#                 -- 2. SUBCONTRACTING RECEIPT
#                 SELECT 
#                     '' AS pr_name, scr.name AS sr_name,
#                     scri.purchase_order AS po_name, poi.sales_order AS so_name,
#                     scr.posting_date, scri.qty AS received_qty, 1 AS is_subcontracted
#                 FROM `tabSubcontracting Receipt Item` scri
#                 JOIN `tabSubcontracting Receipt` scr ON scri.parent = scr.name
#                 JOIN `tabPurchase Order Item` poi ON scri.purchase_order_item = poi.name
#                 WHERE scri.item_code = %(item)s AND scr.docstatus = 1 AND poi.sales_order = %(so_name)s
#             )
#             ORDER BY posting_date DESC
#         """, {"so_name": sales_order_name, "item": item_code}, as_dict=1)

#         total_historical_received_for_so = sum(flt(r.received_qty) for r in completed_receipt_docs)
        
#         # Calculate Net "Remaining" Stock specifically for this SO
#         total_delivered_from_this_so = sum(flt(i.delivered_qty) for i in so_items_list if i.item_code == item_code)
#         remaining_so_specific_stock = max(0, total_historical_received_for_so - total_delivered_from_this_so)
        
#         # Partition logic:
#         # If we have 10 available globally, and 2 are specifically remaining for this SO,
#         # Then Received_For_SO = 2, General_Stock = 8.
#         received_for_so_qty = min(remaining_so_specific_stock, total_available_stock)
#         general_stock_qty = max(0, total_available_stock - received_for_so_qty)

#         # =========================================================
#         # 5. PICK LIST STATUS
#         # =========================================================
#         # A. For THIS Sales Order
#         picked_for_this_so_details = frappe.db.sql("""
#             SELECT 
#                 pl.name AS pick_list_name, pl.docstatus, pl.per_delivered, 
#                 pl.delivery_status, pli.qty, pli.picked_qty
#             FROM `tabPick List Item` pli
#             JOIN `tabPick List` pl ON pli.parent = pl.name
#             WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus < 2
#         """, (sales_order_name, item_code), as_dict=1)

#         picked_draft_qty_so = sum(flt(p.qty) for p in picked_for_this_so_details if p.docstatus == 0)
#         picked_submitted_qty_so_actual = sum(flt(p.picked_qty) for p in picked_for_this_so_details if p.docstatus == 1)
#         picked_submitted_undelivered_qty = sum(
#             flt(p.picked_qty) * (1 - flt(p.per_delivered or 0) / 100)
#             for p in picked_for_this_so_details if p.docstatus == 1
#         )

#         # B. For OTHERS (Conflicts)
#         if sales_order_name:
#             picked_for_others_details = frappe.db.sql("""
#                 SELECT pl.name AS pick_list_name, pl.customer, pli.sales_order, 'Submitted' AS status,
#                        (pli.picked_qty * (100 - IFNULL(pl.per_delivered, 0)) / 100) AS qty
#                 FROM `tabPick List` pl JOIN `tabPick List Item` pli ON pl.name = pli.parent
#                 WHERE pl.docstatus = 1 AND pl.status NOT IN ('Completed', 'Cancelled')
#                   AND pli.item_code = %s AND pli.sales_order != %s
#             """, (item_code, sales_order_name), as_dict=1)
            
#             draft_for_others_details = frappe.db.sql("""
#                 SELECT pl.name AS pick_list_name, pl.customer, pli.sales_order, 'Draft' AS status, pli.qty
#                 FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pli.parent = pl.name
#                 WHERE pl.docstatus = 0 AND pli.item_code = %s AND pli.sales_order != %s
#             """, (item_code, sales_order_name), as_dict=1)
#         else:
#              picked_for_others_details = frappe.db.sql("""
#                 SELECT pl.name AS pick_list_name, pl.customer, pli.sales_order, 'Submitted' AS status,
#                        (pli.picked_qty * (100 - IFNULL(pl.per_delivered, 0)) / 100) AS qty
#                 FROM `tabPick List` pl JOIN `tabPick List Item` pli ON pl.name = pli.parent
#                 WHERE pl.docstatus = 1 AND pl.status NOT IN ('Completed', 'Cancelled') AND pli.item_code = %s
#             """, (item_code,), as_dict=1)
             
#              draft_for_others_details = frappe.db.sql("""
#                 SELECT pl.name AS pick_list_name, pl.customer, pli.sales_order, 'Draft' AS status, pli.qty
#                 FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pli.parent = pl.name
#                 WHERE pl.docstatus = 0 AND pli.item_code = %s
#             """, (item_code,), as_dict=1)

#         picked_for_others_qty = sum(flt(r.qty) for r in picked_for_others_details)
#         draft_qty_for_others = sum(flt(r.qty) for r in draft_for_others_details)
#         conflict_details = picked_for_others_details + draft_for_others_details

#         # =========================================================
#         # 6. INCOMING STOCK
#         # =========================================================
#         incoming_stock = []
#         total_incoming_qty = 0
#         total_incoming_po_count = 0
#         total_incoming_ewo_count = 0

#         # 6A. PURCHASE ORDERS
#         # Merged logic: Checks standard PO Items vs Subcontracted FG Items
#         po_data = frappe.db.sql("""
#             SELECT 
#                 po.name, po.supplier, po.schedule_date, po.is_subcontracted, 
#                 poi.warehouse,
#                 CASE 
#                     WHEN po.is_subcontracted = 1 THEN (poi.fg_item_qty - poi.received_qty) 
#                     ELSE (poi.qty - poi.received_qty) 
#                 END AS pending_qty
#             FROM `tabPurchase Order Item` poi 
#             JOIN `tabPurchase Order` po ON poi.parent = po.name
#             WHERE 
#                 poi.sales_order = %(so)s 
#                 AND po.docstatus = 1
#                 AND (
#                     (po.is_subcontracted=0 AND poi.item_code=%(item)s AND (poi.qty-poi.received_qty)>0)
#                     OR 
#                     (po.is_subcontracted=1 AND poi.fg_item=%(item)s AND (poi.fg_item_qty-poi.received_qty)>0)
#                 )
#         """, {"so": sales_order_name, "item": item_code}, as_dict=1)

#         for row in po_data:
#             pending = flt(row.pending_qty)
#             incoming_stock.append({
#                 "doc_type": "Purchase Order",
#                 "name": row.name,
#                 "info": row.supplier,
#                 "pending_qty": pending,
#                 "warehouse": row.warehouse,
#                 "is_ewo": 0,
#                 "is_subcontracted": row.is_subcontracted
#             })
#             total_incoming_qty += pending
#             total_incoming_po_count += 1

#         # 6B. EMBROIDERY WORK ORDERS
#         # Merged logic: Uses robust joining for SO validation + Extended selection for UI
#         ewo_data = frappe.db.sql("""
#             SELECT 
#                 parent.name, 
#                 parent.date,
#                 parent.purchase_order,
#                 parent.subcontracting_order,
#                 parent.work_type,
#                 /* Detailed Display Info */
#                 parent.panel_jobber, 
#                 parent.panel_stage,
#                 parent.full_piece_jobber, 
#                 parent.full_piece_stage,
                
#                 child.ordered_qty, 
#                 child.received_qty,
#                 child.pending_qty
#             FROM `tabEmbroidery Work Order` parent
#             JOIN `tabEmbroidery Work Order Item` child ON child.parent = parent.name
#             /* Enforce valid SO link via Parent PO Item */
#             JOIN `tabPurchase Order Item` poi ON poi.parent = parent.purchase_order
#             WHERE 
#                 child.item_code = %(item)s 
#                 AND parent.docstatus = 1
#                 AND poi.sales_order = %(so)s
#                 /* Check Standard or Subcontract (FG) Item match */
#                 AND (poi.item_code = child.item_code OR poi.fg_item = child.item_code)
#                 /* Validation: Pending must exist either in column or via calc */
#                 AND (IFNULL(child.pending_qty, 0) > 0 OR (child.ordered_qty - IFNULL(child.received_qty, 0)) > 0)
#         """, {"so": sales_order_name, "item": item_code}, as_dict=1)
        
#         for row in ewo_data:
#             # Check explicit pending_qty first (robust), else calculate
#             if flt(row.pending_qty) > 0:
#                 qty = flt(row.pending_qty)
#             else:
#                 qty = max(0, flt(row.ordered_qty) - flt(row.received_qty))

#             # UI Field mapping
#             if row.work_type == "Full Piece Job Work":
#                 jobber_display = row.full_piece_jobber
#                 stage_display = row.full_piece_stage
#             else:
#                 jobber_display = row.panel_jobber
#                 stage_display = row.panel_stage
            
#             # Combine UI properties
#             incoming_stock.append({
#                 "doc_type": "Embroidery Work Order",
#                 "name": row.name,
#                 "date": row.date,
#                 "work_type": row.work_type,
#                 "info": jobber_display or "Job Work", 
#                 "stage": stage_display,
#                 "po_ref": row.purchase_order,
                
#                 "pending_qty": qty,
#                 "ordered_qty": flt(row.ordered_qty),
#                 "received_qty": flt(row.received_qty),
                
#                 "warehouse": "",
#                 "is_ewo": 1
#             })
#             total_incoming_qty += qty
#             total_incoming_ewo_count += 1

#         # =========================================================
#         # 7. RM PROCUREMENT (BOM ITEMS) - UPDATED
#         # =========================================================
#         rm_procurement_status = {
#             "rm_shortfall_exists": False, 
#             "rm_items_status": [],
#             "fg_shortfall": 0
#         }

#         # CALCULATE FG SHORTFALL (Match the UI Logic: Required - Delivered - Available - Picked)
#         # In your example: (7 - 0) - 1 available = 6 units needing production/material
#         # TOTAL pick impact for this item (already merged-safe)
#         # =========================================================
#         # TRULY AVAILABLE FG (merge-safe)
#         # =========================================================
#         truly_available_fg = max(
#             0,
#             received_for_so_qty
#             + general_stock_qty
#             - picked_for_others_qty
#             - draft_qty_for_others
#         )

        
#         total_picked_for_this_so = picked_submitted_undelivered_qty + picked_draft_qty_so

#         fg_remaining_to_plan = max(
#             0,
#             (required_qty - delivered_qty) - total_picked_for_this_so
#         )

#         fg_shortfall = max(
#             0,
#             fg_remaining_to_plan - truly_available_fg
#         )

#         rm_procurement_status["fg_shortfall"] = fg_shortfall



#         # Only proceed if we have an actual FG shortfall needing raw materials
#         rm_procurement_status = None

#         if bom_no:
#             rm_procurement_status = {
#                 "rm_shortfall_exists": False,
#                 "rm_items_status": [],
#                 "fg_shortfall": fg_shortfall
#             }

#             if fg_shortfall > 0:
                
#                 try:
#                     bom_doc = frappe.get_doc("BOM", bom_no)
#                     rm_codes = [i.item_code for i in bom_doc.items]
#                     rm_map = {}
                    
#                     for bi in bom_doc.items:
#                         rm_code = bi.item_code
#                         qty_per_fg = flt(bi.stock_qty) if bi.stock_qty else flt(bi.qty)
                        
#                         rm_map[rm_code] = {
#                             "rm_code": rm_code,
#                             "rm_uom": bi.uom or bi.stock_uom,
#                             "rm_needed_for_shortfall": fg_shortfall * qty_per_fg,  # The 6 units x Qty
#                             "rm_required_total": required_qty * qty_per_fg,
#                             "rm_available_stock": 0,         
#                             "rm_pending_so_linked_total": 0,
#                             "rm_shortfall_total": 0,
#                             "po_documents": []
#                         }

#                     if rm_codes:
#                         # B. Get Global Warehouse Stock
#                         stock_data = frappe.db.sql("""
#                             SELECT item_code, SUM(actual_qty) as qty
#                             FROM `tabBin`
#                             WHERE item_code IN %s AND actual_qty > 0
#                             GROUP BY item_code
#                         """, (tuple(rm_codes),), as_dict=1) # Search globally or specify warehouse
                        
#                         for s in stock_data:
#                             if s.item_code in rm_map:
#                                 rm_map[s.item_code]["rm_available_stock"] = flt(s.qty)

#                         # C. SO Specific Procurement Source Check
#                         so_procurement_data = frappe.db.sql("""
#                             SELECT 
#                                 source.raw_material_item,
#                                 SUM(poi.qty) as total_ordered,
#                                 SUM(poi.received_qty) as total_received,
#                                 GROUP_CONCAT(DISTINCT source.parent) as po_list
#                             FROM `tabPurchase Order Raw Material Source` source
#                             JOIN `tabPurchase Order Item` poi 
#                                 ON poi.parent = source.parent 
#                                 AND poi.item_code = source.raw_material_item 
#                             WHERE source.source_sales_order = %s
#                             AND source.raw_material_item IN %s
#                             AND poi.docstatus = 1  
#                             GROUP BY source.raw_material_item
#                         """, (sales_order_name, tuple(rm_codes)), as_dict=1)

#                         for d in so_procurement_data:
#                             rm = rm_map.get(d.raw_material_item)
#                             if rm:
#                                 rm["rm_ordered_so_total"] = flt(d.total_ordered)
#                                 rm["rm_received_so_total"] = flt(d.total_received)
#                                 rm["rm_pending_so_linked_total"] = max(0, flt(d.total_ordered) - flt(d.total_received))
#                                 if d.po_list:
#                                     rm["po_documents"] = d.po_list.split(",")

#                     # D. Updated Shortfall Calculation Logic
#                     for rm in rm_map.values():
#                         # Gap = Needed for production - (what we have + what's already on PO)
#                         coverage = rm["rm_available_stock"] + rm["rm_pending_so_linked_total"]
#                         shortfall = max(0, rm["rm_needed_for_shortfall"] - coverage)
#                         rm["rm_shortfall_total"] = shortfall
                        
#                         if shortfall > 0:
#                             rm_procurement_status["rm_shortfall_exists"] = True
#                             rm["status"] = "Shortage"
#                         else:
#                             rm["status"] = "Covered"

#                         rm_procurement_status["rm_items_status"].append(rm)

#                 except Exception as e:
#                     frappe.log_error(f"RM Error {item_code}", str(e))
        
#         # =========================================================
#         # 8. FINAL DATA PACKAGING
#         # =========================================================
#         results[item_code] = {
#             # Metrics
#             "required_qty": required_qty,
#             "delivered_qty": delivered_qty,
#             "total_available_stock": total_available_stock,
#             "received_for_so_qty": received_for_so_qty,
#             "general_stock_qty": general_stock_qty,
#             "warehouse_stock": warehouse_stock,
#             "completed_receipt_docs": completed_receipt_docs,

#             # Pick Lists
#             "picked_for_this_so_details": picked_for_this_so_details,
#             "picked_draft_qty_so": picked_draft_qty_so,
#             "picked_submitted_qty_so_actual": picked_submitted_qty_so_actual,
#             "picked_submitted_undelivered_qty": picked_submitted_undelivered_qty,
#             "picked_for_others_qty": picked_for_others_qty,
#             "draft_qty_for_others": draft_qty_for_others,
#             "conflict_details": conflict_details,

#             # Incoming
#             "incoming_stock": incoming_stock,
#             "total_incoming_qty": total_incoming_qty,
#             "total_incoming_po_count": total_incoming_po_count,
#             "total_incoming_ewo_count": total_incoming_ewo_count,
#             "total_incoming_se_count": 0,

#             # RM / BOM
#             # "rm_procurement_status": rm_procurement_status,
#             # "is_bom_item": bool(bom_no),
#             "is_bom_item": bool(bom_no),
#             "rm_procurement_status": rm_procurement_status if bom_no else None,

            
#             # Context
#             "customer": so_doc.customer if so_doc else None,
#             "warehouse": warehouse,
#             "stock_uom": stock_uom
#         }

#     return results


# import json
# import frappe
# from frappe.utils import flt
# from collections import defaultdict

# @frappe.whitelist()
# def get_item_stock_details_bulk(item_bom_pairs, sales_order_name):
#     if isinstance(item_bom_pairs, str):
#         item_bom_pairs = json.loads(item_bom_pairs)
#     if not isinstance(item_bom_pairs, list):
#         frappe.throw("Invalid item_bom_pairs format. Expected a list.")
        
#     try:
#         so_doc = frappe.get_doc("Sales Order", sales_order_name) if sales_order_name else None
#     except frappe.DoesNotExistError:
#         so_doc = None
    
#     so_items_list = so_doc.items if so_doc else []
    
#     # Group SO items by Item Code and BOM strictly (with trimming)
#     so_groups = defaultdict(list)
#     for i in so_items_list:
#         item_key = (i.item_code or "").strip()
#         bom_key = (i.bom_no or "").strip() or 'no_bom'
#         so_groups[(item_key, bom_key)].append(i)

#     results = {}
#     for pair in item_bom_pairs:
#         # 1. INITIALIZE ALL VARIABLES
#         parts = pair.split('||', 1)
#         item_code = parts[0].strip()
#         bom_key = parts[1].strip()
#         bom_no = bom_key if bom_key != 'no_bom' else None
        
#         total_other_po_qty = 0
#         total_other_po_count = 0
#         other_po_list = []
#         incoming_stock = []
#         total_incoming_qty = 0
#         total_incoming_po_count = 0
#         total_incoming_ewo_count = 0
        
#         # 2. Get Grouped SO Item details
#         so_items = so_groups.get((item_code, bom_key), [])
#         required_qty = sum(flt(i.qty) for i in so_items)
#         delivered_qty = sum(flt(i.delivered_qty) for i in so_items)
#         warehouse = next((i.warehouse for i in so_items if i.warehouse), None)
#         stock_uom = so_items[0].stock_uom if so_items else frappe.db.get_value("Item", item_code, "stock_uom")
        
#         # 3. Physical Stock (tabBin)
#         warehouse_stock = frappe.db.sql("""
#             SELECT warehouse, actual_qty 
#             FROM `tabBin` 
#             WHERE item_code = %s AND actual_qty > 0
#             ORDER BY actual_qty DESC
#         """, item_code, as_dict=1)
#         total_available_stock = sum(flt(w.actual_qty) for w in warehouse_stock)

#         # 4. Receipt History
#         completed_receipt_docs = frappe.db.sql("""
#             (SELECT pr.name AS pr_name, '' AS sr_name, pri.purchase_order AS po_name, pri.sales_order AS so_name, pr.posting_date, pri.received_qty, pr.is_subcontracted FROM `tabPurchase Receipt Item` pri JOIN `tabPurchase Receipt` pr ON pri.parent = pr.name WHERE pri.item_code = %(item)s AND pri.sales_order = %(so_name)s AND pr.docstatus = 1 AND pr.is_subcontracted = 0)
#             UNION
#             (SELECT '' AS pr_name, scr.name AS sr_name, scri.purchase_order AS po_name, poi.sales_order AS so_name, scr.posting_date, scri.qty AS received_qty, 1 AS is_subcontracted FROM `tabSubcontracting Receipt Item` scri JOIN `tabSubcontracting Receipt` scr ON scri.parent = scr.name JOIN `tabPurchase Order Item` poi ON scri.purchase_order_item = poi.name WHERE scri.item_code = %(item)s AND scr.docstatus = 1 AND poi.sales_order = %(so_name)s)
#             ORDER BY posting_date DESC
#         """, {"so_name": sales_order_name, "item": item_code}, as_dict=1)
        
#         total_hist_recv = sum(flt(r.received_qty) for r in completed_receipt_docs)
#         recv_for_so_qty = min(max(0, total_hist_recv - delivered_qty), total_available_stock)
#         general_stock_qty = max(0, total_available_stock - recv_for_so_qty)
        
#         # 5. Pick List Details (Current SO)
#         picked_for_this_so_details = frappe.db.sql("""
#             SELECT
#                 pl.name AS pick_list_name, pl.docstatus, pl.per_delivered,
#                 pl.delivery_status, pli.qty, pli.picked_qty, soi.bom_no
#             FROM `tabPick List Item` pli
#             JOIN `tabPick List` pl ON pli.parent = pl.name
#             JOIN `tabSales Order Item` soi ON pli.sales_order_item = soi.name
#             WHERE pli.sales_order = %s 
#               AND pli.item_code = %s 
#               AND pl.docstatus < 2
#         """, (sales_order_name, item_code), as_dict=1)
#         current_picks = [
#             p for p in picked_for_this_so_details 
#             if (p.bom_no or "").strip() == (bom_no or "").strip()
#         ]

#         picked_draft_qty_so = sum(flt(p.qty) for p in current_picks if p.docstatus == 0)
#         picked_sub_qty_so = sum(flt(p.picked_qty) for p in current_picks if p.docstatus == 1)
#         picked_sub_undelivered = sum(
#             flt(p.picked_qty) * (1 - flt(p.per_delivered or 0) / 100) 
#             for p in current_picks if p.docstatus == 1
#         )
#         # picked_for_this_so_details = frappe.db.sql("""
#         #     SELECT pl.name AS pick_list_name, pl.docstatus, pl.per_delivered, pli.qty, pli.picked_qty
#         #     FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pli.parent = pl.name
#         #     WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus < 2
#         # """, (sales_order_name, item_code), as_dict=1)

#         picked_draft_qty_so = sum(flt(p.qty) for p in picked_for_this_so_details if p.docstatus == 0)
#         picked_sub_qty_so = sum(flt(p.picked_qty) for p in picked_for_this_so_details if p.docstatus == 1)
#         picked_sub_undelivered = sum(flt(p.picked_qty) * (1 - flt(p.per_delivered or 0) / 100) for p in picked_for_this_so_details if p.docstatus == 1)

#         # 6. Conflicts (Picks for OTHER orders)
#         conflict_details = []
#         if sales_order_name:
#             conflict_sql = """
#                 SELECT pl.name AS pick_list_name, pl.customer, pli.sales_order, pli.sales_order_item AS so_item, 
#                        pl.docstatus, CASE WHEN pl.docstatus=1 THEN 'Submitted' ELSE 'Draft' END AS status, 
#                        pli.qty, pli.picked_qty
#                 FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent
#                 WHERE pli.item_code = %s AND pli.sales_order != %s AND pl.docstatus < 2 
#                 AND pl.status NOT IN ('Completed', 'Cancelled')
#             """
#             conflict_details = frappe.db.sql(conflict_sql, (item_code, sales_order_name), as_dict=1)

#         picked_for_others_qty = sum(flt(r.picked_qty) for r in conflict_details if r.docstatus == 1)
#         draft_qty_for_others = sum(flt(r.qty) for r in conflict_details if r.docstatus == 0)

#         # 7. Incoming Pipeline (POs and EWOs for Current SO)
#         po_data = frappe.db.sql("""
#             SELECT po.name, po.supplier, po.is_subcontracted, MAX(poi.warehouse) AS warehouse,
#                 SUM(CASE WHEN po.is_subcontracted = 1 THEN (poi.fg_item_qty - poi.received_qty) ELSE (poi.qty - poi.received_qty) END) AS pending_qty
#             FROM `tabPurchase Order Item` poi JOIN `tabPurchase Order` po ON poi.parent = po.name
#             WHERE poi.sales_order = %(so)s AND po.docstatus = 1 
#             AND ((po.is_subcontracted=0 AND poi.item_code=%(item)s) OR (po.is_subcontracted=1 AND poi.fg_item=%(item)s))
#             GROUP BY po.name, po.supplier, po.is_subcontracted HAVING pending_qty > 0
#         """, {"so": sales_order_name, "item": item_code}, as_dict=1)

#         for row in po_data:
#             qty = flt(row.pending_qty)
#             incoming_stock.append({"doc_type": "Purchase Order", "name": row.name, "info": row.supplier, "pending_qty": qty, "warehouse": row.warehouse, "is_ewo": 0, "is_subcontracted": row.is_subcontracted})
#             total_incoming_qty += qty
#             total_incoming_po_count += 1
        
#         ewo_data = frappe.db.sql("""
#              SELECT parent.name, parent.date, parent.purchase_order, parent.work_type, parent.panel_jobber, parent.panel_stage, parent.full_piece_jobber, parent.full_piece_stage,
#                 SUM(child.ordered_qty) AS ordered_qty, SUM(child.received_qty) AS received_qty, SUM(IFNULL(child.pending_qty, 0)) AS pending_qty
#             FROM `tabEmbroidery Work Order Item` child JOIN `tabEmbroidery Work Order` parent ON child.parent = parent.name
#             WHERE child.item_code = %(item)s AND parent.docstatus = 1 
#             AND EXISTS (SELECT 1 FROM `tabPurchase Order Item` poi WHERE poi.parent = parent.purchase_order AND poi.sales_order = %(so)s)
#             GROUP BY parent.name, parent.date, parent.purchase_order, parent.work_type, parent.panel_jobber, parent.panel_stage, parent.full_piece_jobber, parent.full_piece_stage
#             HAVING (SUM(IFNULL(child.pending_qty, 0)) > 0 OR SUM(child.ordered_qty - IFNULL(child.received_qty, 0)) > 0)
#         """, {"so": sales_order_name, "item": item_code}, as_dict=1)

#         unique_ewos = set()
#         for row in ewo_data:
#             qty = flt(row.pending_qty) or max(0, flt(row.ordered_qty) - flt(row.received_qty))
#             if qty <= 0: continue
#             jobber = row.full_piece_jobber if row.work_type == "Full Piece Job Work" else row.panel_jobber
#             stage = row.full_piece_stage if row.work_type == "Full Piece Job Work" else row.panel_stage
#             incoming_stock.append({"doc_type": "Embroidery Work Order", "name": row.name, "date": row.date, "work_type": row.work_type, "info": jobber or "Job Work", "stage": stage, "po_ref": row.purchase_order, "pending_qty": qty, "is_ewo": 1})
#             total_incoming_qty += qty
#             unique_ewos.add(row.name)
#         total_incoming_ewo_count = len(unique_ewos)

#         # 8. Incoming Pipeline (POs for OTHER SOs)
#         other_po_data = frappe.db.sql("""
#             SELECT po.name, po.supplier, poi.sales_order, SUM(poi.qty - poi.received_qty) AS pending_qty
#             FROM `tabPurchase Order Item` poi JOIN `tabPurchase Order` po ON poi.parent = po.name
#             WHERE poi.item_code = %(item)s AND po.docstatus = 1 AND (poi.sales_order != %(so)s OR poi.sales_order IS NULL)
#             AND (poi.qty - poi.received_qty) > 0 GROUP BY po.name, po.supplier, poi.sales_order
#         """, {"so": sales_order_name, "item": item_code}, as_dict=1)

#         for row in other_po_data:
#             qty = flt(row.pending_qty)
#             total_other_po_qty += qty
#             other_po_list.append({"name": row.name, "info": row.supplier, "sales_order": row.sales_order or "General Stock", "pending_qty": qty})
#         total_other_po_count = len(other_po_data)

#         # 9. Shortfall & RM Procurement Logic
#         truly_available_fg = max(0, recv_for_so_qty + general_stock_qty - picked_for_others_qty - draft_qty_for_others)
#         fg_remaining_to_plan = max(0, (required_qty - delivered_qty) - picked_sub_undelivered - picked_draft_qty_so)
#         fg_shortfall = max(0, (required_qty - delivered_qty) - truly_available_fg)
        
#         rm_procurement_status = {
#             "rm_shortfall_exists": False,
#             "rm_items_status": [],
#             "fg_shortfall": fg_shortfall
#         }

#         # CALCULATE RAW MATERIALS (If BOM exists)
#         if bom_no and fg_shortfall > 0:
#             try:
#                 bom_doc = frappe.get_doc("BOM", bom_no)
#                 rm_codes = [i.item_code for i in bom_doc.items]
#                 rm_map = {}
#                 for bi in bom_doc.items:
#                     rm_code = bi.item_code
#                     qty_per_fg = flt(bi.stock_qty) if bi.stock_qty else flt(bi.qty)
#                     rm_map[rm_code] = {
#                         "rm_code": rm_code,
#                         "rm_uom": bi.uom or bi.stock_uom,
#                         "rm_needed_for_shortfall": fg_shortfall * qty_per_fg,
#                         "rm_required_total": required_qty * qty_per_fg,
#                         "rm_available_stock": 0,
#                         "rm_pending_so_linked_total": 0,
#                         "rm_shortfall_total": 0,
#                         "po_documents": []
#                     }
                
#                 if rm_codes:
#                     # RM Physical Stock
#                     stock_data = frappe.db.sql("""
#                         SELECT item_code, SUM(actual_qty) as qty
#                         FROM `tabBin`
#                         WHERE item_code IN %s AND actual_qty > 0
#                         GROUP BY item_code
#                     """, (tuple(rm_codes),), as_dict=1)
#                     for s in stock_data:
#                         if s.item_code in rm_map:
#                             rm_map[s.item_code]["rm_available_stock"] = flt(s.qty)
                    
#                     # RM Linked POs (via RM Source table)
#                     so_procurement_data = frappe.db.sql("""
#                         SELECT
#                             source.raw_material_item,
#                             SUM(poi.qty - poi.received_qty) as pending_ordered,
#                             GROUP_CONCAT(DISTINCT source.parent) as po_list
#                         FROM `tabPurchase Order Raw Material Source` source
#                         JOIN `tabPurchase Order Item` poi
#                             ON poi.parent = source.parent
#                             AND poi.item_code = source.raw_material_item
#                         WHERE source.source_sales_order = %s
#                         AND source.raw_material_item IN %s
#                         AND poi.docstatus = 1
#                         GROUP BY source.raw_material_item
#                     """, (sales_order_name, tuple(rm_codes)), as_dict=1)
                    
#                     for d in so_procurement_data:
#                         rm = rm_map.get(d.raw_material_item)
#                         if rm:
#                             rm["rm_pending_so_linked_total"] = max(0, flt(d.pending_ordered))
#                             if d.po_list:
#                                 rm["po_documents"] = d.po_list.split(",")

#                 # Final calculation for each RM item
#                 for rm in rm_map.values():
#                     coverage = rm["rm_available_stock"] + rm["rm_pending_so_linked_total"]
#                     shortfall = max(0, rm["rm_needed_for_shortfall"] - coverage)
#                     rm["rm_shortfall_total"] = shortfall
#                     rm["status"] = "Shortage" if shortfall > 0 else "Covered"
#                     if shortfall > 0:
#                         rm_procurement_status["rm_shortfall_exists"] = True
#                     rm_procurement_status["rm_items_status"].append(rm)
                    
#             except Exception as e:
#                 frappe.log_error(f"RM Breakdown Error {item_code}", str(e))

#         results[pair] = {
#             "item_code": item_code, "required_qty": required_qty, "delivered_qty": delivered_qty,
#             "total_available_stock": total_available_stock, "received_for_so_qty": recv_for_so_qty, "general_stock_qty": general_stock_qty,
#             "warehouse_stock": warehouse_stock, "completed_receipt_docs": completed_receipt_docs,
#             "picked_for_this_so_details": picked_for_this_so_details, "picked_draft_qty_so": picked_draft_qty_so, "picked_submitted_qty_so_actual": picked_sub_qty_so, "picked_submitted_undelivered_qty": picked_sub_undelivered,
#             "picked_for_others_qty": picked_for_others_qty, "draft_qty_for_others": draft_qty_for_others, "conflict_details": conflict_details,
#             "incoming_stock": incoming_stock, "total_incoming_qty": total_incoming_qty, "total_incoming_po_count": total_incoming_po_count, "total_incoming_ewo_count": total_incoming_ewo_count,
#             "total_other_po_qty": total_other_po_qty, "total_other_po_count": total_other_po_count, "other_po_list": other_po_list,
#             "is_bom_item": bool(bom_no), "rm_procurement_status": rm_procurement_status, 
#             "customer": so_doc.customer if so_doc else None, "warehouse": warehouse, "stock_uom": stock_uom
#         }

#     return results

# import json
# import frappe
# from frappe.utils import flt
# from collections import defaultdict

# @frappe.whitelist()
# def get_item_stock_details_bulk(item_bom_pairs, sales_order_name):
#     if isinstance(item_bom_pairs, str):
#         item_bom_pairs = json.loads(item_bom_pairs)
#     if not isinstance(item_bom_pairs, list):
#         frappe.throw("Invalid item_bom_pairs format. Expected a list.")
        
#     try:
#         so_doc = frappe.get_doc("Sales Order", sales_order_name) if sales_order_name else None
#     except frappe.DoesNotExistError:
#         so_doc = None
    
#     so_items_list = so_doc.items if so_doc else []
    
#     # Group SO items by Item Code and BOM strictly (with trimming)
#     so_groups = defaultdict(list)
#     for i in so_items_list:
#         item_key = (i.item_code or "").strip()
#         bom_key = (i.bom_no or "").strip() or 'no_bom'
#         so_groups[(item_key, bom_key)].append(i)

#     results = {}
#     for pair in item_bom_pairs:
#         # 1. INITIALIZE ALL VARIABLES
#         parts = pair.split('||', 1)
#         item_code = parts[0].strip()
#         bom_key = parts[1].strip()
#         bom_no = bom_key if bom_key != 'no_bom' else None
        
#         total_other_po_qty = 0
#         total_other_po_count = 0
#         other_po_list = []
#         incoming_stock = []
#         total_incoming_qty = 0
#         total_incoming_po_count = 0
#         total_incoming_ewo_count = 0
        
#         # 2. Get Grouped SO Item details
#         so_items = so_groups.get((item_code, bom_key), [])
#         required_qty = sum(flt(i.qty) for i in so_items)
#         delivered_qty = sum(flt(i.delivered_qty) for i in so_items)
#         warehouse = next((i.warehouse for i in so_items if i.warehouse), None)
#         stock_uom = so_items[0].stock_uom if so_items else frappe.db.get_value("Item", item_code, "stock_uom")
        
#         # 3. Physical Stock (tabBin)
#         warehouse_stock = frappe.db.sql("""
#             SELECT warehouse, actual_qty 
#             FROM `tabBin` 
#             WHERE item_code = %s AND actual_qty > 0
#             ORDER BY actual_qty DESC
#         """, item_code, as_dict=1)
#         total_available_stock = sum(flt(w.actual_qty) for w in warehouse_stock)

#         # 4. Receipt History
#         completed_receipt_docs = frappe.db.sql("""
#             (SELECT
#                 pr.name AS pr_name,
#                 '' AS sr_name,
#                 pri.purchase_order AS po_name,
#                 pri.sales_order AS so_name,
#                 pr.posting_date,
#                 pri.received_qty,
#                 pr.is_subcontracted,
#                 -- For Purchase Receipts: Fetch supplier from linked Purchase Order
#                 (SELECT po.supplier FROM `tabPurchase Order` po WHERE po.name = pri.purchase_order) AS supplier_name
#             FROM `tabPurchase Receipt Item` pri
#             JOIN `tabPurchase Receipt` pr ON pri.parent = pr.name
#             WHERE pri.item_code = %(item)s
#               AND pri.sales_order = %(so_name)s
#               AND pr.docstatus = 1
#               AND pr.is_subcontracted = 0)

#             UNION ALL -- Use UNION ALL instead of UNION to preserve all matching rows

#             (SELECT
#                 '' AS pr_name,
#                 scr.name AS sr_name,
#                 scri.purchase_order AS po_name,
#                 poi.sales_order AS so_name,
#                 scr.posting_date,
#                 scri.qty AS received_qty,
#                 1 AS is_subcontracted,
#                 -- For Subcontracting Receipts: Fetch supplier from the Subcontracting Receipt itself (which is the jobber)
#                 scr.supplier AS supplier_name
#             FROM `tabSubcontracting Receipt Item` scri
#             JOIN `tabSubcontracting Receipt` scr ON scri.parent = scr.name
#             JOIN `tabPurchase Order Item` poi ON scri.purchase_order_item = poi.name
#             WHERE scri.item_code = %(item)s
#               AND scr.docstatus = 1
#               AND poi.sales_order = %(so_name)s)

#             ORDER BY posting_date DESC
#         """, {"so_name": sales_order_name, "item": item_code}, as_dict=1)
#         total_hist_recv = sum(flt(r.received_qty) for r in completed_receipt_docs)
#         recv_for_so_qty = min(max(0, total_hist_recv - delivered_qty), total_available_stock)
#         general_stock_qty = max(0, total_available_stock - recv_for_so_qty)
        
#         # 5. Pick List Details (Match specifically by BOM to prevent leakage)
#         raw_picks = frappe.db.sql("""
#             SELECT
#                 pl.name AS pick_list_name, pl.docstatus, pl.per_delivered,
#                 pl.delivery_status, pli.qty, pli.picked_qty, soi.bom_no
#             FROM `tabPick List Item` pli
#             JOIN `tabPick List` pl ON pli.parent = pl.name
#             JOIN `tabSales Order Item` soi ON pli.sales_order_item = soi.name
#             WHERE pli.sales_order = %s 
#               AND pli.item_code = %s 
#               AND pl.docstatus < 2
#         """, (sales_order_name, item_code), as_dict=1)
        
#         # Filter: Only picks that match this row's BOM
#         current_picks = [
#             p for p in raw_picks 
#             if (p.bom_no or "").strip() == (bom_key if bom_key != 'no_bom' else "").strip()
#         ]

#         picked_draft_qty_so = sum(flt(p.qty) for p in current_picks if p.docstatus == 0)
#         picked_sub_qty_so_actual = sum(flt(p.picked_qty) for p in current_picks if p.docstatus == 1)
#         picked_sub_undelivered = sum(
#             flt(p.picked_qty) * (1 - flt(p.per_delivered or 0) / 100) 
#             for p in current_picks if p.docstatus == 1
#         )

#         # 6. Conflicts (Picks for OTHER orders)
#         conflict_details = []
#         if sales_order_name:
#             conflict_sql = """
#                 SELECT pl.name AS pick_list_name, pl.customer, pli.sales_order, pli.sales_order_item AS so_item, 
#                        pl.docstatus, CASE WHEN pl.docstatus=1 THEN 'Submitted' ELSE 'Draft' END AS status, 
#                        pli.qty, pli.picked_qty
#                 FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent
#                 WHERE pli.item_code = %s AND pli.sales_order != %s AND pl.docstatus < 2 
#                 AND pl.status NOT IN ('Completed', 'Cancelled')
#             """
#             conflict_details = frappe.db.sql(conflict_sql, (item_code, sales_order_name), as_dict=1)

#         picked_for_others_qty = sum(flt(r.picked_qty) for r in conflict_details if r.docstatus == 1)
#         draft_qty_for_others = sum(flt(r.qty) for r in conflict_details if r.docstatus == 0)

#         # 7. Incoming Pipeline (Current SO POs/EWOs)
#         po_data = frappe.db.sql("""
#             SELECT po.name, po.supplier, po.is_subcontracted, MAX(poi.warehouse) AS warehouse,
#                 SUM(CASE WHEN po.is_subcontracted = 1 THEN (poi.fg_item_qty - poi.received_qty) ELSE (poi.qty - poi.received_qty) END) AS pending_qty
#             FROM `tabPurchase Order Item` poi JOIN `tabPurchase Order` po ON poi.parent = po.name
#             WHERE poi.sales_order = %(so)s AND po.docstatus = 1 
#             AND ((po.is_subcontracted=0 AND poi.item_code=%(item)s) OR (po.is_subcontracted=1 AND poi.fg_item=%(item)s))
#             GROUP BY po.name, po.supplier, po.is_subcontracted HAVING pending_qty > 0
#         """, {"so": sales_order_name, "item": item_code}, as_dict=1)

#         for row in po_data:
#             qty = flt(row.pending_qty)
#             incoming_stock.append({"doc_type": "Purchase Order", "name": row.name, "info": row.supplier, "pending_qty": qty, "warehouse": row.warehouse, "is_ewo": 0, "is_subcontracted": row.is_subcontracted})
#             total_incoming_qty += qty
#             total_incoming_po_count += 1
        
#         ewo_data = frappe.db.sql("""
#              SELECT parent.name, parent.date, parent.purchase_order, parent.work_type, parent.panel_jobber, parent.panel_stage, parent.full_piece_jobber, parent.full_piece_stage,
#                 SUM(child.ordered_qty) AS ordered_qty, SUM(child.received_qty) AS received_qty, SUM(IFNULL(child.pending_qty, 0)) AS pending_qty
#             FROM `tabEmbroidery Work Order Item` child JOIN `tabEmbroidery Work Order` parent ON child.parent = parent.name
#             WHERE child.item_code = %(item)s AND parent.docstatus = 1 
#             AND EXISTS (SELECT 1 FROM `tabPurchase Order Item` poi WHERE poi.parent = parent.purchase_order AND poi.sales_order = %(so)s)
#             GROUP BY parent.name, parent.date, parent.purchase_order, parent.work_type, parent.panel_jobber, parent.panel_stage, parent.full_piece_jobber, parent.full_piece_stage
#             HAVING (SUM(IFNULL(child.pending_qty, 0)) > 0 OR SUM(child.ordered_qty - IFNULL(child.received_qty, 0)) > 0)
#         """, {"so": sales_order_name, "item": item_code}, as_dict=1)

#         unique_ewos = set()
#         for row in ewo_data:
#             qty = flt(row.pending_qty) or max(0, flt(row.ordered_qty) - flt(row.received_qty))
#             if qty <= 0: continue
#             jobber = row.full_piece_jobber if row.work_type == "Full Piece Job Work" else row.panel_jobber
#             stage = row.full_piece_stage if row.work_type == "Full Piece Job Work" else row.panel_stage
#             incoming_stock.append({"doc_type": "Embroidery Work Order", "name": row.name, "date": row.date, "work_type": row.work_type, "info": jobber or "Job Work", "stage": stage, "po_ref": row.purchase_order, "pending_qty": qty, "is_ewo": 1})
#             total_incoming_qty += qty
#             unique_ewos.add(row.name)
#         total_incoming_ewo_count = len(unique_ewos)

#         # 8. Incoming Pipeline (Other SO POs)
#         # other_po_data = frappe.db.sql("""
#         #     SELECT po.name, po.supplier, poi.sales_order, SUM(poi.qty - poi.received_qty) AS pending_qty
#         #     FROM `tabPurchase Order Item` poi JOIN `tabPurchase Order` po ON poi.parent = po.name
#         #     WHERE poi.item_code = %(item)s AND po.docstatus = 1 AND (poi.sales_order != %(so)s OR poi.sales_order IS NULL)
#         #     AND (poi.qty - poi.received_qty) > 0 GROUP BY po.name, po.supplier, poi.sales_order
#         # """, {"so": sales_order_name, "item": item_code}, as_dict=1)

#         # for row in other_po_data:
#         #     qty = flt(row.pending_qty)
#         #     total_other_po_qty += qty
#         #     other_po_list.append({"name": row.name, "info": row.supplier, "sales_order": row.sales_order or "General Stock", "pending_qty": qty})
#         # total_other_po_count = len(other_po_data)

#         # 8. Incoming Pipeline (Other SO POs)
#         other_po_data = frappe.db.sql("""
#             SELECT 
#                 po.name, 
#                 po.supplier, 
#                 poi.sales_order, 
#                 SUM(poi.qty - poi.received_qty) AS pending_qty
#             FROM `tabPurchase Order Item` poi 
#             JOIN `tabPurchase Order` po ON poi.parent = po.name
#             WHERE 
#                 poi.item_code = %(item)s 
#                 AND po.docstatus = 1 
#                 -- CRITICAL FIX: Ensure strictly NOT this Sales Order
#                 AND (poi.sales_order != %(so)s OR poi.sales_order IS NULL OR poi.sales_order = '')
#                 AND (poi.qty - poi.received_qty) > 0 
#             GROUP BY po.name, po.supplier, poi.sales_order
#         """, {"so": sales_order_name, "item": item_code}, as_dict=1)

#         for row in other_po_data:
#             qty = flt(row.pending_qty)
#             total_other_po_qty += qty
#             other_po_list.append({
#                 "name": row.name, 
#                 "info": row.supplier, 
#                 "sales_order": row.sales_order or "General Stock", 
#                 "pending_qty": qty
#             })
#         total_other_po_count = len(other_po_data)

#         # 9. Shortfall & RM Logic
#         # truly_available is what is physically there MINUS what others have already claimed
#         # truly_available_fg = max(0, recv_for_so_qty + general_stock_qty - picked_for_others_qty - draft_qty_for_others)
#         truly_available_fg = max(0, total_available_stock - picked_for_others_qty - draft_qty_for_others)
#         # Shortfall for RM = (Requirement) - (Delivered) - (Physical Stock available to us)
#         pending_fg_for_so = max(0, required_qty - delivered_qty)

#         # `fg_shortfall` is the quantity we must produce after consuming all available stock.
#         fg_shortfall = max(0, pending_fg_for_so - truly_available_fg)
#         # fg_shortfall = max(0, (required_qty - delivered_qty) - truly_available_fg)
        
#         rm_procurement_status = {
#             "rm_shortfall_exists": False,
#             "rm_items_status": [],
#             "fg_shortfall": fg_shortfall
#         }

#         if bom_no:
#             rm_procurement_status = {
#                 "rm_shortfall_exists": False,
#                 "rm_items_status": [],
#                 "fg_shortfall": fg_shortfall
#             }
#             try:
#                 bom_doc = frappe.get_doc("BOM", bom_no)
#                 rm_codes = [i.item_code for i in bom_doc.items]
#                 rm_map = {}
#                 for bi in bom_doc.items:
#                     rm_code = bi.item_code
#                     qty_per_fg = flt(bi.stock_qty) if bi.stock_qty else flt(bi.qty)
#                     rm_map[rm_code] = {
#                         "rm_code": rm_code,
#                         "rm_uom": bi.uom or bi.stock_uom,
#                         "rm_needed_for_shortfall": fg_shortfall * qty_per_fg, # Will be 0 if no shortfall
#                         "rm_required_total": required_qty * qty_per_fg, # For full SO qty
#                         "rm_available_stock": 0,
#                         "rm_pending_so_linked_total": 0,
#                         "rm_shortfall_total": 0,
#                         "po_documents": []
#                     }
                
#                 if rm_codes:
#                     stock_data = frappe.db.sql("""SELECT item_code, SUM(actual_qty) as qty FROM `tabBin` WHERE item_code IN %s AND actual_qty > 0 GROUP BY item_code""", (tuple(rm_codes),), as_dict=1)
#                     for s in stock_data:
#                         if s.item_code in rm_map: rm_map[s.item_code]["rm_available_stock"] = flt(s.qty)
                    
#                     so_procurement_data = frappe.db.sql("""
#                         SELECT source.raw_material_item, SUM(poi.qty - poi.received_qty) as pending_ordered, GROUP_CONCAT(DISTINCT source.parent) as po_list
#                         FROM `tabPurchase Order Raw Material Source` source JOIN `tabPurchase Order Item` poi ON poi.parent = source.parent AND poi.item_code = source.raw_material_item
#                         WHERE source.source_sales_order = %s AND source.raw_material_item IN %s AND poi.docstatus = 1 GROUP BY source.raw_material_item
#                     """, (sales_order_name, tuple(rm_codes)), as_dict=1)
                    
#                     for d in so_procurement_data:
#                         rm = rm_map.get(d.raw_material_item)
#                         if rm:
#                             rm["rm_pending_so_linked_total"] = max(0, flt(d.pending_ordered))
#                             if d.po_list: rm["po_documents"] = d.po_list.split(",")

#                 for rm in rm_map.values():
#                     coverage = rm["rm_available_stock"] + rm["rm_pending_so_linked_total"]
#                     shortfall = max(0, rm["rm_needed_for_shortfall"] - coverage)
#                     rm["rm_shortfall_total"] = shortfall
#                     rm["status"] = "Shortage" if shortfall > 0 else "Covered"
#                     if shortfall > 0: rm_procurement_status["rm_shortfall_exists"] = True
#                     rm_procurement_status["rm_items_status"].append(rm)

#             except Exception as e:
#                 frappe.log_error(f"RM Breakdown Error for {item_code}", str(e))

#         results[pair] = {
#             "item_code": item_code, "required_qty": required_qty, "delivered_qty": delivered_qty,
#             "total_available_stock": total_available_stock, "received_for_so_qty": recv_for_so_qty, "general_stock_qty": general_stock_qty,
#             "warehouse_stock": warehouse_stock, "completed_receipt_docs": completed_receipt_docs,
#             "picked_for_this_so_details": current_picks, # RETURN ONLY MATCHING PICKS
#             "picked_draft_qty_so": picked_draft_qty_so, 
#             "picked_submitted_qty_so_actual": picked_sub_qty_so_actual, 
#             "picked_submitted_undelivered_qty": picked_sub_undelivered,
#             "picked_for_others_qty": picked_for_others_qty, "draft_qty_for_others": draft_qty_for_others, "conflict_details": conflict_details,
#             "incoming_stock": incoming_stock, "total_incoming_qty": total_incoming_qty, "total_incoming_po_count": total_incoming_po_count, "total_incoming_ewo_count": total_incoming_ewo_count,
#             "total_other_po_qty": total_other_po_qty, "total_other_po_count": total_other_po_count, "other_po_list": other_po_list,
#             "is_bom_item": bool(bom_no), "rm_procurement_status": rm_procurement_status, 
#             "customer": so_doc.customer if so_doc else None, "warehouse": warehouse, "stock_uom": stock_uom
#         }

#     return results



# import json
# import frappe
# from frappe.utils import flt
# from collections import defaultdict

# @frappe.whitelist()
# def get_item_stock_details_bulk(item_bom_pairs, sales_order_name):
#     if isinstance(item_bom_pairs, str):
#         item_bom_pairs = json.loads(item_bom_pairs)
#     if not isinstance(item_bom_pairs, list):
#         frappe.throw("Invalid item_bom_pairs format. Expected a list.")
        
#     try:
#         so_doc = frappe.get_doc("Sales Order", sales_order_name) if sales_order_name else None
#     except frappe.DoesNotExistError:
#         so_doc = None
    
#     so_items_list = so_doc.items if so_doc else []
    
#     # Group SO items by Item Code and BOM strictly (with trimming)
#     so_groups = defaultdict(list)
#     for i in so_items_list:
#         item_key = (i.item_code or "").strip()
#         bom_key = (i.bom_no or "").strip() or 'no_bom'
#         so_groups[(item_key, bom_key)].append(i)

#     results = {}
#     for pair in item_bom_pairs:
#         # 1. INITIALIZE ALL VARIABLES
#         parts = pair.split('||', 1)
#         item_code = parts[0].strip()
#         bom_key = parts[1].strip()
#         bom_no = bom_key if bom_key != 'no_bom' else None
        
#         total_other_po_qty = 0
#         total_other_po_count = 0
#         other_po_list = []
#         incoming_stock = []
#         total_incoming_qty = 0
#         total_incoming_po_count = 0
#         total_incoming_ewo_count = 0
        
#         # 2. Get Grouped SO Item details
#         so_items = so_groups.get((item_code, bom_key), [])
#         required_qty = sum(flt(i.qty) for i in so_items)
#         delivered_qty = sum(flt(i.delivered_qty) for i in so_items)
#         warehouse = next((i.warehouse for i in so_items if i.warehouse), None)
#         stock_uom = so_items[0].stock_uom if so_items else frappe.db.get_value("Item", item_code, "stock_uom")
        
#         # 3. Physical Stock (tabBin)
#         warehouse_stock = frappe.db.sql("""
#             SELECT warehouse, actual_qty 
#             FROM `tabBin` 
#             WHERE item_code = %s AND actual_qty > 0
#             ORDER BY actual_qty DESC
#         """, item_code, as_dict=1)
#         total_available_stock = sum(flt(w.actual_qty) for w in warehouse_stock)

#         # 4. Receipt History
#         completed_receipt_docs = frappe.db.sql("""
#             (SELECT
#                 pr.name AS pr_name,
#                 '' AS sr_name,
#                 pri.purchase_order AS po_name,
#                 pri.sales_order AS so_name,
#                 pr.posting_date,
#                 pri.received_qty,
#                 pr.is_subcontracted,
#                 -- For Purchase Receipts: Fetch supplier from linked Purchase Order
#                 (SELECT po.supplier FROM `tabPurchase Order` po WHERE po.name = pri.purchase_order) AS supplier_name
#             FROM `tabPurchase Receipt Item` pri
#             JOIN `tabPurchase Receipt` pr ON pri.parent = pr.name
#             WHERE pri.item_code = %(item)s
#               AND pri.sales_order = %(so_name)s
#               AND pr.docstatus = 1
#               AND pr.is_subcontracted = 0)

#             UNION ALL -- Use UNION ALL instead of UNION to preserve all matching rows

#             (SELECT
#                 '' AS pr_name,
#                 scr.name AS sr_name,
#                 scri.purchase_order AS po_name,
#                 poi.sales_order AS so_name,
#                 scr.posting_date,
#                 scri.qty AS received_qty,
#                 1 AS is_subcontracted,
#                 -- For Subcontracting Receipts: Fetch supplier from the Subcontracting Receipt itself (which is the jobber)
#                 scr.supplier AS supplier_name
#             FROM `tabSubcontracting Receipt Item` scri
#             JOIN `tabSubcontracting Receipt` scr ON scri.parent = scr.name
#             JOIN `tabPurchase Order Item` poi ON scri.purchase_order_item = poi.name
#             WHERE scri.item_code = %(item)s
#               AND scr.docstatus = 1
#               AND poi.sales_order = %(so_name)s)

#             ORDER BY posting_date DESC
#         """, {"so_name": sales_order_name, "item": item_code}, as_dict=1)
#         total_hist_recv = sum(flt(r.received_qty) for r in completed_receipt_docs)
#         recv_for_so_qty = min(max(0, total_hist_recv - delivered_qty), total_available_stock)
#         general_stock_qty = max(0, total_available_stock - recv_for_so_qty)
        
#         # 5. Pick List Details (Match specifically by BOM to prevent leakage)
#         raw_picks = frappe.db.sql("""
#             SELECT
#                 pl.name AS pick_list_name, pl.docstatus, pl.per_delivered,
#                 pl.delivery_status, pli.qty, pli.picked_qty, soi.bom_no
#             FROM `tabPick List Item` pli
#             JOIN `tabPick List` pl ON pli.parent = pl.name
#             JOIN `tabSales Order Item` soi ON pli.sales_order_item = soi.name
#             WHERE pli.sales_order = %s 
#               AND pli.item_code = %s 
#               AND pl.docstatus < 2
#         """, (sales_order_name, item_code), as_dict=1)
        
#         # Filter: Only picks that match this row's BOM
#         current_picks = [
#             p for p in raw_picks 
#             if (p.bom_no or "").strip() == (bom_key if bom_key != 'no_bom' else "").strip()
#         ]

#         picked_draft_qty_so = sum(flt(p.qty) for p in current_picks if p.docstatus == 0)
#         picked_sub_qty_so_actual = sum(flt(p.picked_qty) for p in current_picks if p.docstatus == 1)
#         picked_sub_undelivered = sum(
#             flt(p.picked_qty) * (1 - flt(p.per_delivered or 0) / 100) 
#             for p in current_picks if p.docstatus == 1
#         )

#         # 6. Conflicts (Picks for OTHER orders)
#         conflict_details = []
#         if sales_order_name:
#             conflict_sql = """
#                 SELECT pl.name AS pick_list_name, pl.customer, pli.sales_order, pli.sales_order_item AS so_item, 
#                        pl.docstatus, CASE WHEN pl.docstatus=1 THEN 'Submitted' ELSE 'Draft' END AS status, 
#                        pli.qty, pli.picked_qty
#                 FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent
#                 WHERE pli.item_code = %s AND pli.sales_order != %s AND pl.docstatus < 2 
#                 AND pl.status NOT IN ('Completed', 'Cancelled')
#             """
#             conflict_details = frappe.db.sql(conflict_sql, (item_code, sales_order_name), as_dict=1)

#         picked_for_others_qty = sum(flt(r.picked_qty) for r in conflict_details if r.docstatus == 1)
#         draft_qty_for_others = sum(flt(r.qty) for r in conflict_details if r.docstatus == 0)

#         # 7. Incoming Pipeline (Current SO POs/EWOs)
#         po_data = frappe.db.sql("""
#             SELECT po.name, po.supplier, po.is_subcontracted, MAX(poi.warehouse) AS warehouse,
#                 SUM(CASE WHEN po.is_subcontracted = 1 THEN (poi.fg_item_qty - poi.received_qty) ELSE (poi.qty - poi.received_qty) END) AS pending_qty
#             FROM `tabPurchase Order Item` poi JOIN `tabPurchase Order` po ON poi.parent = po.name
#             WHERE poi.sales_order = %(so)s AND po.docstatus = 1 
#             AND ((po.is_subcontracted=0 AND poi.item_code=%(item)s) OR (po.is_subcontracted=1 AND poi.fg_item=%(item)s))
#             GROUP BY po.name, po.supplier, po.is_subcontracted HAVING pending_qty > 0
#         """, {"so": sales_order_name, "item": item_code}, as_dict=1)

#         for row in po_data:
#             qty = flt(row.pending_qty)
#             incoming_stock.append({"doc_type": "Purchase Order", "name": row.name, "info": row.supplier, "pending_qty": qty, "warehouse": row.warehouse, "is_ewo": 0, "is_subcontracted": row.is_subcontracted})
#             total_incoming_qty += qty
#             total_incoming_po_count += 1
        
#         # ------------- MODIFICATION STARTS HERE ------------------
#         # Modified the query to JOIN with tabSupplier to fetch the supplier_name for the jobber
#         ewo_data = frappe.db.sql("""
#              SELECT
#                 parent.name, parent.date, parent.purchase_order, parent.work_type,
#                 parent.panel_jobber, parent.panel_stage, parent.full_piece_jobber, parent.full_piece_stage,
#                 COALESCE(fp_sup.supplier_name, panel_sup.supplier_name) AS jobber_name,
#                 SUM(child.ordered_qty) AS ordered_qty,
#                 SUM(child.received_qty) AS received_qty,
#                 SUM(IFNULL(child.pending_qty, 0)) AS pending_qty
#             FROM `tabEmbroidery Work Order Item` child
#             JOIN `tabEmbroidery Work Order` parent ON child.parent = parent.name
#             LEFT JOIN `tabSupplier` fp_sup ON parent.full_piece_jobber = fp_sup.name
#             LEFT JOIN `tabSupplier` panel_sup ON parent.panel_jobber = panel_sup.name
#             WHERE
#                 child.item_code = %(item)s AND parent.docstatus = 1
#                 AND EXISTS (SELECT 1 FROM `tabPurchase Order Item` poi WHERE poi.parent = parent.purchase_order AND poi.sales_order = %(so)s)
#             GROUP BY
#                 parent.name, parent.date, parent.purchase_order, parent.work_type,
#                 parent.panel_jobber, parent.panel_stage, parent.full_piece_jobber, parent.full_piece_stage,
#                 jobber_name
#             HAVING (SUM(IFNULL(child.pending_qty, 0)) > 0 OR SUM(child.ordered_qty - IFNULL(child.received_qty, 0)) > 0)
#         """, {"so": sales_order_name, "item": item_code}, as_dict=1)

#         unique_ewos = set()
#         for row in ewo_data:
#             qty = flt(row.pending_qty) or max(0, flt(row.ordered_qty) - flt(row.received_qty))
#             if qty <= 0: continue

#             jobber_id = row.full_piece_jobber if row.work_type == "Full Piece Job Work" else row.panel_jobber
#             jobber_name = row.jobber_name  # Fetched directly from the SQL query
            
#             # Use the fetched name, fallback to the ID if the name is missing
#             info_text = jobber_name if jobber_name else (jobber_id or "Job Work")
            
#             stage = row.full_piece_stage if row.work_type == "Full Piece Job Work" else row.panel_stage
            
#             incoming_stock.append({
#                 "doc_type": "Embroidery Work Order",
#                 "name": row.name,
#                 "date": row.date,
#                 "work_type": row.work_type,
#                 "info": info_text,
#                 "jobber_id": jobber_id, # Keep the original ID as well
#                 "stage": stage,
#                 "po_ref": row.purchase_order,
#                 "pending_qty": qty,
#                 "is_ewo": 1
#             })
#             total_incoming_qty += qty
#             unique_ewos.add(row.name)
#         total_incoming_ewo_count = len(unique_ewos)
#         # ------------- MODIFICATION ENDS HERE --------------------

#         # 8. Incoming Pipeline (Other SO POs)
#         other_po_data = frappe.db.sql("""
#             SELECT 
#                 po.name, 
#                 po.supplier, 
#                 poi.sales_order, 
#                 SUM(poi.qty - poi.received_qty) AS pending_qty
#             FROM `tabPurchase Order Item` poi 
#             JOIN `tabPurchase Order` po ON poi.parent = po.name
#             WHERE 
#                 poi.item_code = %(item)s 
#                 AND po.docstatus = 1 
#                 -- CRITICAL FIX: Ensure strictly NOT this Sales Order
#                 AND (poi.sales_order != %(so)s OR poi.sales_order IS NULL OR poi.sales_order = '')
#                 AND (poi.qty - poi.received_qty) > 0 
#             GROUP BY po.name, po.supplier, poi.sales_order
#         """, {"so": sales_order_name, "item": item_code}, as_dict=1)

#         for row in other_po_data:
#             qty = flt(row.pending_qty)
#             total_other_po_qty += qty
#             other_po_list.append({
#                 "name": row.name, 
#                 "info": row.supplier, 
#                 "sales_order": row.sales_order or "General Stock", 
#                 "pending_qty": qty
#             })
#         total_other_po_count = len(other_po_data)

#         # 9. Shortfall & RM Logic
#         # truly_available is what is physically there MINUS what others have already claimed
#         truly_available_fg = max(0, total_available_stock - picked_for_others_qty - draft_qty_for_others)
#         # Shortfall for RM = (Requirement) - (Delivered) - (Physical Stock available to us)
#         pending_fg_for_so = max(0, required_qty - delivered_qty)

#         # `fg_shortfall` is the quantity we must produce after consuming all available stock.
#         fg_shortfall = max(0, pending_fg_for_so - truly_available_fg)
        
#         rm_procurement_status = {
#             "rm_shortfall_exists": False,
#             "rm_items_status": [],
#             "fg_shortfall": fg_shortfall
#         }

#         if bom_no:
#             rm_procurement_status = {
#                 "rm_shortfall_exists": False,
#                 "rm_items_status": [],
#                 "fg_shortfall": fg_shortfall
#             }
#             try:
#                 bom_doc = frappe.get_doc("BOM", bom_no)
#                 rm_codes = [i.item_code for i in bom_doc.items]
#                 rm_map = {}
#                 for bi in bom_doc.items:
#                     rm_code = bi.item_code
#                     qty_per_fg = flt(bi.stock_qty) if bi.stock_qty else flt(bi.qty)
#                     rm_map[rm_code] = {
#                         "rm_code": rm_code,
#                         "rm_uom": bi.uom or bi.stock_uom,
#                         "rm_needed_for_shortfall": fg_shortfall * qty_per_fg, # Will be 0 if no shortfall
#                         "rm_required_total": required_qty * qty_per_fg, # For full SO qty
#                         "rm_available_stock": 0,
#                         "rm_pending_so_linked_total": 0,
#                         "rm_shortfall_total": 0,
#                         "po_documents": []
#                     }
                
#                 if rm_codes:
#                     stock_data = frappe.db.sql("""SELECT item_code, SUM(actual_qty) as qty FROM `tabBin` WHERE item_code IN %s AND actual_qty > 0 GROUP BY item_code""", (tuple(rm_codes),), as_dict=1)
#                     for s in stock_data:
#                         if s.item_code in rm_map: rm_map[s.item_code]["rm_available_stock"] = flt(s.qty)
                    
#                     so_procurement_data = frappe.db.sql("""
#                         SELECT source.raw_material_item, SUM(poi.qty - poi.received_qty) as pending_ordered, GROUP_CONCAT(DISTINCT source.parent) as po_list
#                         FROM `tabPurchase Order Raw Material Source` source JOIN `tabPurchase Order Item` poi ON poi.parent = source.parent AND poi.item_code = source.raw_material_item
#                         WHERE source.source_sales_order = %s AND source.raw_material_item IN %s AND poi.docstatus = 1 GROUP BY source.raw_material_item
#                     """, (sales_order_name, tuple(rm_codes)), as_dict=1)
                    
#                     for d in so_procurement_data:
#                         rm = rm_map.get(d.raw_material_item)
#                         if rm:
#                             rm["rm_pending_so_linked_total"] = max(0, flt(d.pending_ordered))
#                             if d.po_list: rm["po_documents"] = d.po_list.split(",")

#                 for rm in rm_map.values():
#                     coverage = rm["rm_available_stock"] + rm["rm_pending_so_linked_total"]
#                     shortfall = max(0, rm["rm_needed_for_shortfall"] - coverage)
#                     rm["rm_shortfall_total"] = shortfall
#                     rm["status"] = "Shortage" if shortfall > 0 else "Covered"
#                     if shortfall > 0: rm_procurement_status["rm_shortfall_exists"] = True
#                     rm_procurement_status["rm_items_status"].append(rm)

#             except Exception as e:
#                 frappe.log_error(f"RM Breakdown Error for {item_code}", str(e))

#         results[pair] = {
#             "item_code": item_code, "required_qty": required_qty, "delivered_qty": delivered_qty,
#             "total_available_stock": total_available_stock, "received_for_so_qty": recv_for_so_qty, "general_stock_qty": general_stock_qty,
#             "warehouse_stock": warehouse_stock, "completed_receipt_docs": completed_receipt_docs,
#             "picked_for_this_so_details": current_picks, # RETURN ONLY MATCHING PICKS
#             "picked_draft_qty_so": picked_draft_qty_so, 
#             "picked_submitted_qty_so_actual": picked_sub_qty_so_actual, 
#             "picked_submitted_undelivered_qty": picked_sub_undelivered,
#             "picked_for_others_qty": picked_for_others_qty, "draft_qty_for_others": draft_qty_for_others, "conflict_details": conflict_details,
#             "incoming_stock": incoming_stock, "total_incoming_qty": total_incoming_qty, "total_incoming_po_count": total_incoming_po_count, "total_incoming_ewo_count": total_incoming_ewo_count,
#             "total_other_po_qty": total_other_po_qty, "total_other_po_count": total_other_po_count, "other_po_list": other_po_list,
#             "is_bom_item": bool(bom_no), "rm_procurement_status": rm_procurement_status, 
#             "customer": so_doc.customer if so_doc else None, "warehouse": warehouse, "stock_uom": stock_uom
#         }

#     return results


import json
import frappe
from frappe.utils import flt
from collections import defaultdict

@frappe.whitelist()
def get_item_stock_details_bulk(item_bom_pairs, sales_order_name):
    if isinstance(item_bom_pairs, str):
        item_bom_pairs = json.loads(item_bom_pairs)
    if not isinstance(item_bom_pairs, list):
        frappe.throw("Invalid item_bom_pairs format. Expected a list.")
        
    try:
        so_doc = frappe.get_doc("Sales Order", sales_order_name) if sales_order_name else None
    except frappe.DoesNotExistError:
        so_doc = None
    
    so_items_list = so_doc.items if so_doc else []
    
    # Group SO items by Item Code and BOM strictly (with trimming)
    so_groups = defaultdict(list)
    for i in so_items_list:
        item_key = (i.item_code or "").strip()
        bom_key = (i.bom_no or "").strip() or 'no_bom'
        so_groups[(item_key, bom_key)].append(i)

    results = {}
    for pair in item_bom_pairs:
        # 1. INITIALIZE ALL VARIABLES
        parts = pair.split('||', 1)
        item_code = parts[0].strip()
        bom_key = parts[1].strip()
        bom_no = bom_key if bom_key != 'no_bom' else None
        
        total_other_po_qty = 0
        total_other_po_count = 0
        other_po_list = []
        incoming_stock = []
        total_incoming_qty = 0
        total_incoming_po_count = 0
        total_incoming_ewo_count = 0
        
        # 2. Get Grouped SO Item details
        so_items = so_groups.get((item_code, bom_key), [])
        required_qty = sum(flt(i.qty) for i in so_items)
        delivered_qty = sum(flt(i.delivered_qty) for i in so_items)
        warehouse = next((i.warehouse for i in so_items if i.warehouse), None)
        stock_uom = so_items[0].stock_uom if so_items else frappe.db.get_value("Item", item_code, "stock_uom")
        
        # 3. Physical Stock (tabBin)
        warehouse_stock = frappe.db.sql("""
            SELECT warehouse, actual_qty 
            FROM `tabBin` 
            WHERE item_code = %s AND actual_qty > 0
            ORDER BY actual_qty DESC
        """, item_code, as_dict=1)
        total_available_stock = sum(flt(w.actual_qty) for w in warehouse_stock)

        # 4. Receipt History
        # ------------- MODIFICATION STARTS HERE (Receipt History) ------------------
        # Modified both parts of the UNION to fetch supplier_name instead of the ID.
        completed_receipt_docs = frappe.db.sql("""
            (SELECT
                pr.name AS pr_name,
                '' AS sr_name,
                pri.purchase_order AS po_name,
                pri.sales_order AS so_name,
                pr.posting_date,
                pri.received_qty,
                pr.is_subcontracted,
                -- Fetch supplier NAME from linked Purchase Order
                (SELECT sup.supplier_name
                 FROM `tabPurchase Order` po
                 LEFT JOIN `tabSupplier` sup ON po.supplier = sup.name
                 WHERE po.name = pri.purchase_order) AS supplier
            FROM `tabPurchase Receipt Item` pri
            JOIN `tabPurchase Receipt` pr ON pri.parent = pr.name
            WHERE pri.item_code = %(item)s
              AND pri.sales_order = %(so_name)s
              AND pr.docstatus = 1
              AND pr.is_subcontracted = 0)

            UNION ALL

            (SELECT
                '' AS pr_name,
                scr.name AS sr_name,
                scri.purchase_order AS po_name,
                poi.sales_order AS so_name,
                scr.posting_date,
                scri.qty AS received_qty,
                1 AS is_subcontracted,
                -- Fetch supplier NAME from the Subcontracting Receipt
                (SELECT sup.supplier_name FROM `tabSupplier` sup WHERE sup.name = scr.supplier) AS supplier
            FROM `tabSubcontracting Receipt Item` scri
            JOIN `tabSubcontracting Receipt` scr ON scri.parent = scr.name
            JOIN `tabPurchase Order Item` poi ON scri.purchase_order_item = poi.name
            WHERE scri.item_code = %(item)s
              AND scr.docstatus = 1
              AND poi.sales_order = %(so_name)s)

            ORDER BY posting_date DESC
        """, {"so_name": sales_order_name, "item": item_code}, as_dict=1)
        # ------------- MODIFICATION ENDS HERE (Receipt History) --------------------

        total_hist_recv = sum(flt(r.received_qty) for r in completed_receipt_docs)
        recv_for_so_qty = min(max(0, total_hist_recv - delivered_qty), total_available_stock)
        general_stock_qty = max(0, total_available_stock - recv_for_so_qty)
        
        # 5. Pick List Details (Match specifically by BOM to prevent leakage)
        raw_picks = frappe.db.sql("""
            SELECT
                pl.name AS pick_list_name, pl.docstatus, pl.per_delivered,
                pl.delivery_status, pli.qty, pli.picked_qty, soi.bom_no
            FROM `tabPick List Item` pli
            JOIN `tabPick List` pl ON pli.parent = pl.name
            JOIN `tabSales Order Item` soi ON pli.sales_order_item = soi.name
            WHERE pli.sales_order = %s 
              AND pli.item_code = %s 
              AND pl.docstatus < 2
        """, (sales_order_name, item_code), as_dict=1)
        
        # Filter: Only picks that match this row's BOM
        current_picks = [
            p for p in raw_picks 
            if (p.bom_no or "").strip() == (bom_key if bom_key != 'no_bom' else "").strip()
        ]

        picked_draft_qty_so = sum(flt(p.qty) for p in current_picks if p.docstatus == 0)
        picked_sub_qty_so_actual = sum(flt(p.picked_qty) for p in current_picks if p.docstatus == 1)
        picked_sub_undelivered = sum(
            flt(p.picked_qty) * (1 - flt(p.per_delivered or 0) / 100) 
            for p in current_picks if p.docstatus == 1
        )

        # 6. Conflicts (Picks for OTHER orders)
        conflict_details = []
        if sales_order_name:
            conflict_sql = """
                SELECT pl.name AS pick_list_name, pl.customer, pli.sales_order, pli.sales_order_item AS so_item, 
                       pl.docstatus, CASE WHEN pl.docstatus=1 THEN 'Submitted' ELSE 'Draft' END AS status, 
                       pli.qty, pli.picked_qty
                FROM `tabPick List Item` pli JOIN `tabPick List` pl ON pl.name = pli.parent
                WHERE pli.item_code = %s AND pli.sales_order != %s AND pl.docstatus < 2 
                AND pl.status NOT IN ('Completed', 'Cancelled')
            """
            conflict_details = frappe.db.sql(conflict_sql, (item_code, sales_order_name), as_dict=1)

        picked_for_others_qty = sum(flt(r.picked_qty) for r in conflict_details if r.docstatus == 1)
        draft_qty_for_others = sum(flt(r.qty) for r in conflict_details if r.docstatus == 0)

        # 7. Incoming Pipeline (Current SO POs/EWOs)
        # ------------- MODIFICATION STARTS HERE (Current SO POs) ------------------
        po_data = frappe.db.sql("""
            SELECT
                po.name, po.supplier, sup.supplier_name, po.is_subcontracted,
                MAX(poi.warehouse) AS warehouse,
                SUM(CASE WHEN po.is_subcontracted = 1 THEN (poi.fg_item_qty - poi.received_qty) ELSE (poi.qty - poi.received_qty) END) AS pending_qty
            FROM `tabPurchase Order Item` poi
            JOIN `tabPurchase Order` po ON poi.parent = po.name
            LEFT JOIN `tabSupplier` sup ON po.supplier = sup.name
            WHERE poi.sales_order = %(so)s AND po.docstatus = 1 
            AND ((po.is_subcontracted=0 AND poi.item_code=%(item)s) OR (po.is_subcontracted=1 AND poi.fg_item=%(item)s))
            GROUP BY po.name, po.supplier, sup.supplier_name, po.is_subcontracted
            HAVING pending_qty > 0
        """, {"so": sales_order_name, "item": item_code}, as_dict=1)

        for row in po_data:
            qty = flt(row.pending_qty)
            info_text = row.supplier_name or row.supplier # Use name, fallback to ID
            incoming_stock.append({
                "doc_type": "Purchase Order", "name": row.name, "info": info_text, "pending_qty": qty, 
                "warehouse": row.warehouse, "is_ewo": 0, "is_subcontracted": row.is_subcontracted
            })
            total_incoming_qty += qty
            total_incoming_po_count += 1
        # ------------- MODIFICATION ENDS HERE (Current SO POs) ------------------

        ewo_data = frappe.db.sql("""
             SELECT
                parent.name, parent.date, parent.purchase_order, parent.work_type,
                parent.panel_jobber, parent.panel_stage, parent.full_piece_jobber, parent.full_piece_stage,
                COALESCE(fp_sup.supplier_name, panel_sup.supplier_name) AS jobber_name,
                SUM(child.ordered_qty) AS ordered_qty,
                SUM(child.received_qty) AS received_qty,
                SUM(IFNULL(child.pending_qty, 0)) AS pending_qty
            FROM `tabEmbroidery Work Order Item` child
            JOIN `tabEmbroidery Work Order` parent ON child.parent = parent.name
            LEFT JOIN `tabSupplier` fp_sup ON parent.full_piece_jobber = fp_sup.name
            LEFT JOIN `tabSupplier` panel_sup ON parent.panel_jobber = panel_sup.name
            WHERE
                child.item_code = %(item)s AND parent.docstatus = 1
                AND EXISTS (SELECT 1 FROM `tabPurchase Order Item` poi WHERE poi.parent = parent.purchase_order AND poi.sales_order = %(so)s)
            GROUP BY
                parent.name, parent.date, parent.purchase_order, parent.work_type,
                parent.panel_jobber, parent.panel_stage, parent.full_piece_jobber, parent.full_piece_stage,
                jobber_name
            HAVING (SUM(IFNULL(child.pending_qty, 0)) > 0 OR SUM(child.ordered_qty - IFNULL(child.received_qty, 0)) > 0)
        """, {"so": sales_order_name, "item": item_code}, as_dict=1)

        unique_ewos = set()
        for row in ewo_data:
            qty = flt(row.pending_qty) or max(0, flt(row.ordered_qty) - flt(row.received_qty))
            if qty <= 0: continue
            jobber_id = row.full_piece_jobber if row.work_type == "Full Piece Job Work" else row.panel_jobber
            info_text = row.jobber_name if row.jobber_name else (jobber_id or "Job Work")
            stage = row.full_piece_stage if row.work_type == "Full Piece Job Work" else row.panel_stage
            incoming_stock.append({
                "doc_type": "Embroidery Work Order", "name": row.name, "date": row.date,
                "work_type": row.work_type, "info": info_text, "jobber_id": jobber_id, "stage": stage, 
                "po_ref": row.purchase_order, "pending_qty": qty, "is_ewo": 1
            })
            total_incoming_qty += qty
            unique_ewos.add(row.name)
        total_incoming_ewo_count = len(unique_ewos)

        # 8. Incoming Pipeline (Other SO POs)
        # ------------- MODIFICATION STARTS HERE (Other SO POs) ------------------
        other_po_data = frappe.db.sql("""
            SELECT 
                po.name, po.supplier, sup.supplier_name, poi.sales_order, 
                SUM(poi.qty - poi.received_qty) AS pending_qty
            FROM `tabPurchase Order Item` poi 
            JOIN `tabPurchase Order` po ON poi.parent = po.name
            LEFT JOIN `tabSupplier` sup ON po.supplier = sup.name
            WHERE 
                poi.item_code = %(item)s AND po.docstatus = 1 
                AND (poi.sales_order != %(so)s OR poi.sales_order IS NULL OR poi.sales_order = '')
                AND (poi.qty - poi.received_qty) > 0 
            GROUP BY po.name, po.supplier, sup.supplier_name, poi.sales_order
        """, {"so": sales_order_name, "item": item_code}, as_dict=1)

        for row in other_po_data:
            qty = flt(row.pending_qty)
            total_other_po_qty += qty
            info_text = row.supplier_name or row.supplier # Use name, fallback to ID
            other_po_list.append({
                "name": row.name, "info": info_text, "sales_order": row.sales_order or "General Stock", 
                "pending_qty": qty
            })
        total_other_po_count = len(other_po_data)
        # ------------- MODIFICATION ENDS HERE (Other SO POs) ------------------

        # 9. Shortfall & RM Logic
        truly_available_fg = max(0, total_available_stock - picked_for_others_qty - draft_qty_for_others)
        pending_fg_for_so = max(0, required_qty - delivered_qty)
        fg_shortfall = max(0, pending_fg_for_so - truly_available_fg)
        
        rm_procurement_status = {
            "rm_shortfall_exists": False, "rm_items_status": [], "fg_shortfall": fg_shortfall
        }

        if bom_no:
            try:
                bom_doc = frappe.get_doc("BOM", bom_no)
                rm_codes = [i.item_code for i in bom_doc.items]
                rm_map = {}
                for bi in bom_doc.items:
                    rm_code = bi.item_code
                    qty_per_fg = flt(bi.stock_qty) if bi.stock_qty else flt(bi.qty)
                    rm_map[rm_code] = {
                        "rm_code": rm_code, "rm_uom": bi.uom or bi.stock_uom,
                        "rm_needed_for_shortfall": fg_shortfall * qty_per_fg,
                        "rm_required_total": required_qty * qty_per_fg, "rm_available_stock": 0,
                        "rm_pending_so_linked_total": 0, "rm_shortfall_total": 0,
                        "po_documents": []
                    }
                
                # if rm_codes:
                #     stock_data = frappe.db.sql("""SELECT item_code, SUM(actual_qty) as qty FROM `tabBin` WHERE item_code IN %s AND actual_qty > 0 GROUP BY item_code""", (tuple(rm_codes),), as_dict=1)
                #     for s in stock_data:
                #         if s.item_code in rm_map: rm_map[s.item_code]["rm_available_stock"] = flt(s.qty)
                    
                #     so_procurement_data = frappe.db.sql("""
                #         SELECT source.raw_material_item, SUM(poi.qty - poi.received_qty) as pending_ordered, GROUP_CONCAT(DISTINCT source.parent) as po_list
                #         FROM `tabPurchase Order Raw Material Source` source JOIN `tabPurchase Order Item` poi ON poi.parent = source.parent AND poi.item_code = source.raw_material_item
                #         WHERE source.source_sales_order = %s AND source.raw_material_item IN %s AND poi.docstatus = 1 GROUP BY source.raw_material_item
                #     """, (sales_order_name, tuple(rm_codes)), as_dict=1)
                    
                #     for d in so_procurement_data:
                #         rm = rm_map.get(d.raw_material_item)
                #         if rm:
                #             rm["rm_pending_so_linked_total"] = max(0, flt(d.pending_ordered))
                #             if d.po_list: rm["po_documents"] = d.po_list.split(",")

                # for rm in rm_map.values():
                #     coverage = rm["rm_available_stock"] + rm["rm_pending_so_linked_total"]
                #     shortfall = max(0, rm["rm_needed_for_shortfall"] - coverage)
                #     rm["rm_shortfall_total"] = shortfall
                #     rm["status"] = "Shortage" if shortfall > 0 else "Covered"
                #     if shortfall > 0: rm_procurement_status["rm_shortfall_exists"] = True
                #     rm_procurement_status["rm_items_status"].append(rm)
                # ... (previous code in the bom_no block)
                if rm_codes:
                    # 1. Physical Stock (Bin)
                    stock_data = frappe.db.sql("""SELECT item_code, SUM(actual_qty) as qty FROM `tabBin` WHERE item_code IN %s AND actual_qty > 0 GROUP BY item_code""", (tuple(rm_codes),), as_dict=1)
                    for s in stock_data:
                        if s.item_code in rm_map: rm_map[s.item_code]["rm_available_stock"] = flt(s.qty)
                    
                    # 2. Material Requests (MR) linked to this SO
                    mr_data = frappe.db.sql("""
                        SELECT 
                            mri.item_code, 
                            SUM(mri.qty - mri.ordered_qty) as pending_mr, 
                            GROUP_CONCAT(DISTINCT mri.parent) as mr_list
                        FROM `tabMaterial Request Item` mri
                        JOIN `tabMaterial Request` mr ON mri.parent = mr.name
                        WHERE mri.sales_order = %(so)s 
                          AND mri.item_code IN %(items)s 
                          AND mr.docstatus = 1 
                          AND mr.status != 'Stopped'
                        GROUP BY mri.item_code
                    """, {"so": sales_order_name, "items": tuple(rm_codes)}, as_dict=1)

                    for d in mr_data:
                        if d.item_code in rm_map:
                            rm_map[d.item_code]["rm_pending_mr_total"] = max(0, flt(d.pending_mr))
                            rm_map[d.item_code]["mr_documents"] = d.mr_list.split(",") if d.mr_list else []

                    # 3. Purchase Orders (PO) linked to this SO (Subcontracting + Direct)
                    # We also fetch the Material Request reference from the PO Item
                    so_procurement_data = frappe.db.sql("""
                        SELECT 
                            poi.item_code, 
                            SUM(poi.qty - poi.received_qty) as pending_ordered, 
                            GROUP_CONCAT(DISTINCT poi.parent) as po_list,
                            GROUP_CONCAT(DISTINCT poi.material_request) as linked_mrs
                        FROM `tabPurchase Order Item` poi 
                        JOIN `tabPurchase Order` po ON poi.parent = po.name
                        WHERE poi.sales_order = %(so)s 
                          AND poi.item_code IN %(items)s 
                          AND po.docstatus = 1
                        GROUP BY poi.item_code
                        
                        UNION
                        
                        SELECT 
                            source.raw_material_item as item_code, 
                            SUM(poi.qty - poi.received_qty) as pending_ordered, 
                            GROUP_CONCAT(DISTINCT source.parent) as po_list,
                            GROUP_CONCAT(DISTINCT poi.material_request) as linked_mrs
                        FROM `tabPurchase Order Raw Material Source` source 
                        JOIN `tabPurchase Order Item` poi ON poi.parent = source.parent 
                        WHERE source.source_sales_order = %(so)s 
                          AND source.raw_material_item IN %(items)s 
                          AND poi.docstatus = 1 
                        GROUP BY source.raw_material_item
                    """, {"so": sales_order_name, "items": tuple(rm_codes)}, as_dict=1)
                    
                    for d in so_procurement_data:
                        rm = rm_map.get(d.item_code)
                        if rm:
                            rm["rm_pending_so_linked_total"] = max(0, flt(d.pending_ordered))
                            rm["po_documents"] = list(set(rm.get("po_documents", []) + (d.po_list.split(",") if d.po_list else [])))
                            # Store which MRs are now covered by POs
                            rm["mrs_in_pos"] = d.linked_mrs.split(",") if d.linked_mrs else []

                for rm in rm_map.values():
                    # Coverage = Physical + PO + MR (MR is usually what's left to order)
                    coverage = rm["rm_available_stock"] + rm["rm_pending_so_linked_total"] + rm.get("rm_pending_mr_total", 0)
                    shortfall = max(0, rm["rm_needed_for_shortfall"] - coverage)
                    rm["rm_shortfall_total"] = shortfall
                    rm["status"] = "Shortage" if shortfall > 0 else "Covered"
                    if shortfall > 0: rm_procurement_status["rm_shortfall_exists"] = True
                    rm_procurement_status["rm_items_status"].append(rm)

            except Exception as e:
                frappe.log_error(f"RM Breakdown Error for {item_code}", str(e))

        results[pair] = {
            "item_code": item_code, "required_qty": required_qty, "delivered_qty": delivered_qty,
            "total_available_stock": total_available_stock, "received_for_so_qty": recv_for_so_qty, "general_stock_qty": general_stock_qty,
            "warehouse_stock": warehouse_stock, "completed_receipt_docs": completed_receipt_docs,
            "picked_for_this_so_details": current_picks,
            "picked_draft_qty_so": picked_draft_qty_so, 
            "picked_submitted_qty_so_actual": picked_sub_qty_so_actual, 
            "picked_submitted_undelivered_qty": picked_sub_undelivered,
            "picked_for_others_qty": picked_for_others_qty, "draft_qty_for_others": draft_qty_for_others, "conflict_details": conflict_details,
            "incoming_stock": incoming_stock, "total_incoming_qty": total_incoming_qty, "total_incoming_po_count": total_incoming_po_count, "total_incoming_ewo_count": total_incoming_ewo_count,
            "total_other_po_qty": total_other_po_qty, "total_other_po_count": total_other_po_count, "other_po_list": other_po_list,
            "is_bom_item": bool(bom_no), "rm_procurement_status": rm_procurement_status, 
            "customer": so_doc.customer if so_doc else None, "warehouse": warehouse, "stock_uom": stock_uom, "fg_shortfall_for_ewO": fg_shortfall 

        }

    return results

import frappe
from frappe.utils import flt

@frappe.whitelist()
def get_full_piece_dashboard_data(po_name=None, doc_name=None):
    """
    Data provider for Full Piece Dashboard. 
    """
    target_id = doc_name or po_name
    
    if not target_id:
        frappe.throw("Document ID is required")

    doctype = "Purchase Order"
    
    if target_id.startswith("SAL-ORD") or frappe.db.exists("Sales Order", target_id):
        doctype = "Sales Order"
    elif not frappe.db.exists("Purchase Order", target_id):
         frappe.throw(f"Document {target_id} not found.")

    parent_doc = frappe.get_doc(doctype, target_id)
    sco_name = None
    
    # 3. CONFIGURE FILTERS
    ewo_filters = {"docstatus": 1}
    
    if doctype == "Purchase Order":
        sco_name = frappe.db.get_value("Subcontracting Order", {"purchase_order": target_id, "docstatus": 1}, "name")
        ewo_filters["purchase_order"] = target_id
    else:
        # Verify link field exists, else fallback logic might be needed
        if frappe.get_meta("Embroidery Work Order").has_field("sales_order_ref"):
            ewo_filters["sales_order_ref"] = target_id

    # 4. GET LINKED WORK ORDERS (Jobs)
    ewos = frappe.get_all("Embroidery Work Order", 
        filters=ewo_filters,
        fields=["name", "date", "full_piece_jobber", "full_piece_stage", "work_type", "panel_stage"],
        order_by="creation desc"
    )

    full_piece_processes = []
    qty_assigned_to_fp = {}      

    if ewos:
        ewo_names = [e.name for e in ewos]
        ewo_items = frappe.get_all("Embroidery Work Order Item", 
            filters={"parent": ["in", ewo_names]}, 
            fields=["parent", "item_code", "item_name", "ordered_qty", "received_qty"]
        )
        
        for i in ewo_items:
            parent_ewo = next((e for e in ewos if e.name == i.parent), None)
            if not parent_ewo: continue

            if parent_ewo.work_type == 'Full Piece Job Work':
                qty_assigned_to_fp[i.item_code] = qty_assigned_to_fp.get(i.item_code, 0) + i.ordered_qty

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

    # 5. SOURCE ITEMS & AVAILABILITY
    available_items = []
    
    for item in parent_doc.items:
        # Total Amount currently sitting in Job Cards/Work Orders
        already_sent = flt(qty_assigned_to_fp.get(item.item_code, 0))
        
        stock_qty = 0      # Physical Stock
        balance_avail = 0  # Physical Stock
        required_qty = 0   # How much the dashboard suggests sending
        
        if doctype == "Purchase Order":
            # [LEGACY PO LOGIC]
            total_basis = flt(item.qty) if parent_doc.is_subcontracted == 0 else flt(item.received_qty) 
            stock_qty = total_basis
            balance_avail = total_basis - already_sent # For PO, stock implies "Recvd vs Sent"
            required_qty = balance_avail
        else:
            # [SALES ORDER LOGIC - CORRECTION]
            
            # A. Get Physical Stock from Warehouse (The 'Green' Badge)
            bin_qty = frappe.db.get_value("Bin", 
                {"item_code": item.item_code, "warehouse": item.warehouse}, 
                "actual_qty"
            ) or 0
            
            stock_qty = flt(bin_qty)
            balance_avail = stock_qty
            
            # B. Calculate "Required" (The 'Yellow' Badge)
            # Sales Order Qty - Already Delivered - Already Sent to Jobber (Work in Progress)
            total_needed = flt(item.qty) - flt(item.delivered_qty)
            net_needed = max(0, total_needed - already_sent)
            
            required_qty = net_needed

        available_items.append({
            "item_code": item.item_code,
            "item_name": item.item_name,
            "warehouse": item.warehouse,  # Must return warehouse for frontend to read
            "stock_in_factory": flt(stock_qty), 
            "already_assigned": flt(already_sent),
            "balance_avail": flt(balance_avail) if balance_avail > 0 else 0, # Physical Unpicked Stock
            "required_qty": flt(required_qty) if required_qty > 0 else 0     # Needed Logic
        })

    return {
        "available_items": available_items,
        "active_processes": full_piece_processes,
        "sco_name": sco_name
    }
import frappe
import json
from frappe.utils import flt
from collections import defaultdict # Added for get_item_stock_details_bulk

@frappe.whitelist()
def create_full_piece_receipt(ewo_name, items_data):
    """
    Updates the Embroidery Work Order with received quantities and creates
    a Stock Entry linked to the original Sales Order.
    """
    if isinstance(items_data, str):
        items_data = json.loads(items_data)

    if not items_data:
        frappe.throw("No item data received")

    # 1. Get the Work Order Document and the linked Sales Order
    doc = frappe.get_doc("Embroidery Work Order", ewo_name)
    sales_order_ref = doc.sales_order_ref  # Get the Sales Order ID from the EWO

    if not sales_order_ref:
        # We can still receive stock but it won't be linked. Let's inform the user.
        frappe.msgprint(f"Warning: Sales Order reference not found on {ewo_name}. Stock Entry will be created without a Sales Order link.")

    received_items = []
    # 2. Iterate through incoming data and update EWO rows
    for entry in items_data:
        row_name = entry.get("name") # Child Table Row ID
        qty_received_now = flt(entry.get("qty"))

        for item in doc.items:
            if item.name == row_name:
                current_bal = flt(item.ordered_qty) - flt(item.received_qty)
                if qty_received_now > current_bal:
                    frappe.throw(f"Cannot receive {qty_received_now} for {item.item_code}. Max allowed is {current_bal}.")
                
                item.received_qty = flt(item.received_qty) + qty_received_now
                item.pending_qty = flt(item.ordered_qty) - item.received_qty
                
                if qty_received_now > 0:
                    received_items.append({
                        'item_code': item.item_code,
                        'qty': qty_received_now,
                        'warehouse': item.warehouse
                    })
                break

    doc.save()

    # 3. Create a Stock Entry linked to the Sales Order if items were received
    if received_items:
        se = frappe.new_doc("Stock Entry")
        se.stock_entry_type = "Material Receipt"
        se.posting_date = frappe.utils.nowdate()
        
        # You can add a link to the EWO itself if you have a custom field on Stock Entry
        # e.g., se.custom_ewo_reference = doc.name
        
        for ri in received_items:
            item_row = {
                'item_code': ri['item_code'],
                't_warehouse': ri['warehouse'],
                'qty': ri['qty'],
                'from_bom': 1  # Standard practice for receiving finished goods
            }
            # THIS IS THE KEY CHANGE: Add the sales order link to each item
            if sales_order_ref:
                item_row['sales_order'] = sales_order_ref
            
            se.append("items", item_row)
        
        se.insert()
        se.submit()

    # 4. Check for Global Completion of the EWO
    all_complete = all(flt(item.received_qty) >= flt(item.ordered_qty) for item in doc.items)
    
    if all_complete:
        doc.full_piece_stage = "Received from Full Piece Jobber"
        doc.save()
    
    frappe.msgprint(f"Stock received successfully against {doc.name}")
    return "Success"

@frappe.whitelist()
def get_linked_delivery_notes(sales_order_name):
    if not sales_order_name: return []
    dn_names = frappe.db.get_all("Delivery Note Item", filters={"against_sales_order": sales_order_name, "docstatus": 1}, pluck="parent", distinct=True)
    if not dn_names: return []
    return frappe.db.get_all("Delivery Note", filters={"name": ["in", dn_names]}, fields=["name", "customer", "posting_date", "status", "grand_total"], order_by="posting_date desc")
    
@frappe.whitelist()
def get_linked_sales_invoices(sales_order_name):
    if not sales_order_name: return []
    si_names = frappe.db.get_all("Sales Invoice Item", filters={"sales_order": sales_order_name, "docstatus": 1}, pluck="parent", distinct=True)
    if not si_names: return []
    return frappe.db.get_all("Sales Invoice", filters={"name": ["in", si_names]}, fields=["name", "customer", "posting_date", "status", "grand_total"], order_by="posting_date desc")

@frappe.whitelist()
def release_stock_from_picklist(picklist_name):
    try:
        picklist = frappe.get_doc("Pick List", picklist_name)
        if picklist.docstatus == 1:
            picklist.cancel()
            frappe.db.commit()
            return {"status": "success", "message": _("Pick List {0} cancelled.").format(picklist_name)}
        else:
            return {"status": "fail", "message": _("Pick List {0} is not submitted.").format(picklist_name)}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Release Stock Error")
        return {"status": "fail", "message": str(e)}
def _calculate_pick_list_delivery_status(pl_doc):
    # ... (code to calculate total_qty and total_delivered_qty as before) ...
    total_qty = 0
    total_delivered_qty_raw = 0

    # 1. Loop through each item in the Pick List to calculate totals
    for item in pl_doc.get("locations"):
        total_qty += item.qty
        
        # Find the delivered quantity for this specific item from any submitted Delivery Note
        if item.sales_order_item:
            # Query remains focused on SO Detail (as per your original code)
            delivered_qty = frappe.db.get_value("Delivery Note Item",
                {"so_detail": item.sales_order_item, "docstatus": 1},
                "SUM(qty)"
            )
            # Use raw delivered qty for accurate count of what *has been* delivered via SO Item link
            total_delivered_qty_raw += flt(delivered_qty) 
    
    
    # 2. CAP the effective delivered quantity at the Pick List's total requested quantity
    # This prevents the percentage from ever exceeding 100%.
    total_delivered_qty = min(total_delivered_qty_raw, total_qty)

    # Calculate the percentage
    per_delivered = (total_delivered_qty * 100) / total_qty if total_qty else 0
    # Set it as a maximum of 100 for display safety, although 'min' handles this already
    per_delivered = min(100, per_delivered)

    # 3. Determine the custom delivery_status and the primary 'status'
    delivery_status = "Not Delivered"
    new_doc_status = "Submitted" # Only submitted docs are processed, so this is the default pre-delivery status

    # Only change the status if the percentage has progressed.
    if per_delivered > 0 and per_delivered < 100:
        delivery_status = "Partially Delivered"
        new_doc_status = "Partially Delivered"

    elif per_delivered >= 100:
        delivery_status = "Fully Delivered"
        new_doc_status = "Completed"

    # If status is currently Completed, do not revert to Submitted/Partially Delivered (Status Lock)
    # The hook only runs on DN submit, so it should move forward, but sometimes errors can occur.
    # We will assume if it's Completed it stays Completed.
    # Note: If your Pick List needs a 'Cancelled' status this is a good place to lock 'Completed'.
    if pl_doc.status == "Completed" and new_doc_status != "Completed":
        # Keep it completed, something might be slightly off with delivery quantity tracking
        new_doc_status = "Completed"
        
    # 4. Return the results
    return {
        "per_delivered": per_delivered,
        "delivery_status": delivery_status,
        "status": new_doc_status # THIS IS THE PRIMARY STATUS UPDATE
    }

def update_pick_lists_on_dn_submit(doc, method):
    """
    Finds related Pick Lists and uses the helper function to update their status and delivery status fields.
    """
    try:
        related_sales_orders = list({
            item.against_sales_order for item in doc.items if item.against_sales_order
        })
        if not related_sales_orders:
            return

        # Find *submitted* Pick Lists related to these SOs
        related_pick_lists = frappe.db.get_all("Pick List Item",
            filters={"sales_order": ["in", related_sales_orders], "docstatus": 1},
            pluck="parent",
            distinct=True
        )
        if not related_pick_lists:
            return

        for pl_name in related_pick_lists:
            try:
                # We need a copy of the original doc (especially its initial status)
                pl_doc = frappe.get_doc("Pick List", pl_name)

                # Step 1: Call the new helper function to get all calculated status data
                new_status_data = _calculate_pick_list_delivery_status(pl_doc)

                # Step 2: Save the new data to the database (including 'status')
                frappe.db.set_value("Pick List", pl_name, new_status_data)

            except Exception as e:
                frappe.log_error(title=f"Hook failed for PL {pl_name}", message=f"DN: {doc.name}, Error: {e}")

    except Exception as e:
        frappe.log_error(title="General Pick List Hook Failed", message=frappe.get_traceback())


@frappe.whitelist()
def get_linked_sales_invoices(sales_order_name):
    """
    (Called from Sales Order JavaScript)
    Fetches Sales Invoices that are linked to the given Sales Order for the
    'Related Sales Invoices' custom table.
    """
    if not sales_order_name:
        return []

    # Find all unique Sales Invoice names that reference this Sales Order
    si_names = frappe.db.get_all(
        "Sales Invoice Item",
        filters={
            "sales_order": sales_order_name,
            "docstatus": ["!=", 2]
        },
        pluck="parent",
        distinct=True
    )

    if not si_names:
        return []

    # Get the details for those Sales Invoices
    return frappe.db.get_all(
        "Sales Invoice",
        filters={"name": ["in", si_names]},
        fields=["name", "customer", "posting_date", "status", "grand_total"],
        order_by="posting_date desc"
    )



################### material request #####################
import frappe
from frappe.model.mapper import get_mapped_doc
import frappe
from frappe.model.mapper import get_mapped_doc

@frappe.whitelist()
def make_purchase_order(source_name, supplier=None):
    """
    Create a Subcontracted Purchase Order from Material Request (in memory only).
    - Sets is_subcontracted = 1
    - Copies sales_order from Material Request Item to Purchase Order Item
    - Clears item_code for display (cannot save without valid item)
    """

    mr = frappe.get_doc("Material Request", source_name)

    # Prevent duplicate PO creation for same MR
    existing_po = frappe.get_all(
        "Purchase Order",
        filters={"material_request": mr.name, "is_subcontracted": 1, "docstatus": ("<", 2)},
        limit=1
    )
    if existing_po:
        frappe.throw(f"A Subcontracted Purchase Order already exists for this Material Request: {existing_po[0].name}")

    def update_item(source, target, source_parent):
        # For display, clear item_code (cannot save)
        target.item_code = ""  

        target.qty = source.qty
        target.schedule_date = source.schedule_date or source.required_by

        if getattr(source, "sales_order", None):
            target.sales_order = source.sales_order

        if getattr(source, "bom_no", None):
            target.fg_item = source.item_code
            target.fg_item_qty = source.qty

    po = get_mapped_doc(
        "Material Request",
        source_name,
        {
            "Material Request": {
                "doctype": "Purchase Order",
                "field_map": {},
                "postprocess": lambda source, target, source_parent=None: target.update({
                    "is_subcontracted": 1,
                    "supplier": supplier or mr.supplier
                }),
            },
            "Material Request Item": {
                "doctype": "Purchase Order Item",
                "field_map": {
                    "name": "material_request_item",
                    "parent": "material_request",
                    "uom": "stock_uom",
                    "stock_uom": "stock_uom",
                },
                "postprocess": update_item,
                "condition": lambda doc: doc.qty > 0
            }
        },
        ignore_permissions=True
    )

    # Do NOT insert/save
    return po
import frappe, json
from frappe.utils import flt

@frappe.whitelist()
def get_material_request_stock_html(items):
    if isinstance(items, str):
        items = json.loads(items)

    html = """<style>
    table.custom-stock-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
        font-size: 13px;
    }
    .custom-stock-table th, .custom-stock-table td {
        border: 1px solid #ddd;
        padding: 6px;
        vertical-align: top;
    }
    .custom-stock-table th {
        background-color: #3498DB;
        color: white;
        font-weight: bold;
        text-align: left;
    }
    .inner-table {
        width: 95%;
        margin: 5px;
        border-collapse: collapse;
        font-size: 12px;
    }
    .inner-table th, .inner-table td {
        border: 1px solid #ccc;
        padding: 4px;
        text-align: left;
    }
    .inner-table th {
        font-weight: bold;
        text-align: center;
    }
    .no-bom {
        color: #888;
        font-style: italic;
    }
</style>
<table class="custom-stock-table">
    <thead>
        <tr>
            <th>Item</th>
            <th>BOM No</th>
            <th>Finished Good Stock</th>
            <th style="text-align:center;">Raw Materials</th>
        </tr>
    </thead>
    <tbody>"""


    for row in items:
        item_code = row.get("item_code")
        bom_no = row.get("bom_no")
        sales_order = row.get("sales_order")

        if not item_code:
            continue

        item_name = frappe.db.get_value("Item", item_code, "item_name") or ''
        item_link = f'<a href="/app/item/{item_code}" target="_blank">{item_code} - {item_name}</a>'

        # ---- Finished Good Stock ----
        fg_bins = frappe.get_all("Bin", filters={"item_code": item_code}, fields=["warehouse", "actual_qty"])
        fg_total = sum(b.actual_qty for b in fg_bins)

        reserved_qty = frappe.db.get_value(
            "Sales Order Item",
            {"parent": sales_order, "item_code": item_code},
            "stock_reserved_qty"
        ) or 0

        total_text = f"{flt(fg_total, 2)}"
        if reserved_qty:
            total_text += f" ({flt(reserved_qty, 2)} Reserved)"

        fg_stock_html = f"<b>Total:</b> {total_text}<br><table class='inner-table'><tr><th>Warehouse (Available Qty)</th></tr>"
        for b in fg_bins:
            fg_stock_html += f"<tr><td>{b.warehouse} ({flt(b.actual_qty, 2)})</td></tr>"
        fg_stock_html += "</table>" if fg_bins else "<i>No Stock Data</i>"

        # ---- Raw Materials ----
        rm_stock_html = "<i class='no-bom'>No BOM Linked</i>"
        if bom_no and sales_order:
            # Get sales order item quantity for this finished good
            so_item_qty = frappe.db.get_value(
                "Sales Order Item",
                {"parent": sales_order, "item_code": item_code},
                "qty"
            ) or 0

            bom_items = frappe.get_all("BOM Item", filters={"parent": bom_no}, fields=["item_code", "qty"])
            if bom_items:
                rm_stock_html = "<table class='inner-table'><tr><th>Item</th><th>Needed Qty</th><th>Total Qty</th><th>Balance Needed</th><th>Warehouse (Available Qty)</th></tr>"
                for bi in bom_items:
                    raw_name = frappe.db.get_value("Item", bi.item_code, "item_name") or ''
                    raw_link = f'<a href="/app/item/{bi.item_code}" target="_blank">{bi.item_code} - {raw_name}</a>'
                    raw_bins = frappe.get_all("Bin", filters={"item_code": bi.item_code}, fields=["warehouse", "actual_qty"])

                    # Total available stock for this raw material
                    total_rm_qty = sum(r.actual_qty for r in raw_bins)

                    # Needed qty = BOM qty * Sales Order Item qty
                    needed_qty = flt(bi.qty) * flt(so_item_qty)

                    # Balance needed
                    balance_needed = max(needed_qty - total_rm_qty, 0)

                    # Warehouse text with available qty
                    warehouse_text = ", ".join([f"{r.warehouse} ({flt(r.actual_qty, 2)})" for r in raw_bins]) or "-"

                    rm_stock_html += f"""
                        <tr>
                            <td>{raw_link}</td>
                            <td>{flt(needed_qty,2)}</td>
                            <td>{flt(total_rm_qty,2)}</td>
                            <td>{flt(balance_needed,2)}</td>
                            <td>{warehouse_text}</td>
                        </tr>
                    """
                rm_stock_html += "</table>"


        # ---- Row HTML ----
        html += f"""
        <tr>
            <td>{item_link}</td>
            <td>{bom_no or '-'}</td>
            <td>{fg_stock_html}</td>
            <td>{rm_stock_html}</td>
        </tr>
        """

    html += "</tbody></table>"
    return html


def before_insert(doc, method):
    # ✅ 1. Auto-fetch terms
    if doc.tc_name and not doc.terms:
        doc.terms = frappe.db.get_value("Terms and Conditions", doc.tc_name, "terms")

    # ✅ 2. Handle tax category for Lead-based quotations
    if doc.quotation_to == "Lead" and doc.party_name:
        lead_state = frappe.db.get_value("Lead", doc.party_name, "state")

        # If Lead state not found or empty, default to In-State
        if not lead_state:
            doc.tax_category = "In-State"
        else:
            # ✅ Get the primary company address
            company_address = frappe.db.get_value(
                "Dynamic Link",
                {
                    "link_doctype": "Company",
                    "link_name": doc.company,
                    "parenttype": "Address"
                },
                "parent"
            )

            company_state = frappe.db.get_value("Address", company_address, "state") if company_address else None

            # Compare Lead and Company states
            if company_state and lead_state.strip().lower() == company_state.strip().lower():
                doc.tax_category = "In-State"
            else:
                doc.tax_category = "Out-State"



# def quotation_on_cancel(doc, method):
#     """If the last quotation of a lead is cancelled, revert Lead.custom_lead_category"""
#     if doc.quotation_to == "Lead" and doc.party_name:
#         # ✅ Get last active (non-cancelled) quotation for this lead
#         latest_quotation = frappe.db.sql("""
#             SELECT name FROM `tabQuotation`
#             WHERE quotation_to='Lead' AND party_name=%s AND docstatus=1
#             ORDER BY creation DESC LIMIT 1
#         """, (doc.party_name,), as_dict=True)

#         # ✅ If the cancelled one is the latest, revert category
#         if not latest_quotation or latest_quotation[0].name == doc.name:
#             lead = frappe.get_doc("Lead", doc.party_name)
#             lead.custom_lead_category = "Enquiry"
#             lead.save(ignore_permissions=True)
import frappe

def quotation_on_submit(doc, method):
    """When Quotation submitted → if linked Lead is 'Enquiry', change to 'Pipeline'."""
    if doc.custom_lead_id:
        lead = frappe.get_doc("Lead", doc.custom_lead_id)
        if lead.custom_lead_category == "Enquiry":
            lead.custom_lead_category = "Pipeline"
            lead.save(ignore_permissions=True)
        if hasattr(lead, "lead_owner"):
            doc.custom_lead_owner = lead.lead_owner
            frappe.db.set_value("Quotation", doc.name, "custom_lead_owner", lead.lead_owner)
       
# def sales_order_on_submit(doc, method):
#     """When Sales Order is submitted:
#     - If created from a Quotation linked to a Lead → update Lead to 'Order' & custom_po_value
#     """
#     lead_name = None

#     # ✅ CASE: Sales Order created from Quotation linked to a Lead
#     if doc.items and doc.items[0].prevdoc_docname:
#         quotation_name = doc.items[0].prevdoc_docname
#         quotation_to, party_name = frappe.db.get_value(
#             "Quotation", quotation_name, ["quotation_to", "party_name"]
#         ) or (None, None)

#         if quotation_to == "Lead" and party_name:
#             lead_name = party_name

#     # ✅ Only proceed if Lead found via Quotation
#     if lead_name:
#         lead = frappe.get_doc("Lead", lead_name)

#         # Update lead category
#         if lead.custom_lead_category == "Pipeline":
#             lead.custom_lead_category = "Order"

#         # Update custom_po_value with the latest SO amount for this lead (from any quotation-based SO)
#         latest_so = frappe.db.sql("""
#             SELECT so.grand_total
#             FROM `tabSales Order Item` soi
#             INNER JOIN `tabSales Order` so ON soi.parent = so.name
#             INNER JOIN `tabQuotation` q ON soi.prevdoc_docname = q.name
#             WHERE q.quotation_to = 'Lead'
#               AND q.party_name = %s
#               AND so.docstatus = 1
#             ORDER BY so.creation DESC
#             LIMIT 1
#         """, (lead_name,), as_dict=True)

#         if latest_so:
#             lead.custom_po_value = latest_so[0].grand_total

#         # ✅ Update Lead Owner into Sales Order
#         if hasattr(lead, "lead_owner"):
#             frappe.db.set_value("Sales Order", doc.name, "custom_lead_owner", lead.lead_owner)


#         lead.save(ignore_permissions=True)

#     try:
#         from erpnext.selling.doctype.sales_order.sales_order import create_pick_list

#         # Create pick list using the official method
#         pick_list = create_pick_list(doc.name)

#         # --- CRITICAL CHANGE START ---
#         # Only proceed if the Pick List has actual line items (i.e., stock was reserved)
#         if pick_list.locations:
#             # Insert in draft mode
#             pick_list.insert(ignore_permissions=True)

#             frappe.msgprint(f"Pick List <b>{pick_list.name}</b> created in Draft.", alert=True)
#         else:
#             # Optionally show a message that Pick List creation was skipped due to no available stock
#             frappe.msgprint("Stock allocation not possible at this time. Pick List creation skipped.", indicator="orange", alert=True)
#         # --- CRITICAL CHANGE END ---

#     except Exception as e:
#         frappe.log_error(
#             f"Error creating Pick List for Sales Order {doc.name}: {str(e)}",
#             "Pick List Creation Error"
#         )

        





# def sales_order_on_cancel(doc, method):
#     """When Sales Order is cancelled:
#     - If it was created from a Quotation linked to a Lead → revert or update PO value
#     """
#     lead_name = None

#     # ✅ CASE: Cancelled SO created from Quotation linked to a Lead
#     if doc.items and doc.items[0].prevdoc_docname:
#         quotation_name = doc.items[0].prevdoc_docname
#         quotation_to, party_name = frappe.db.get_value(
#             "Quotation", quotation_name, ["quotation_to", "party_name"]
#         ) or (None, None)

#         if quotation_to == "Lead" and party_name:
#             lead_name = party_name

#     # ✅ Only proceed if Lead found via Quotation
#     if lead_name:
#         lead = frappe.get_doc("Lead", lead_name)

#         # Check if there are other active Sales Orders created from Quotations for this Lead
#         active_so = frappe.db.sql("""
#             SELECT so.name, so.grand_total
#             FROM `tabSales Order Item` soi
#             INNER JOIN `tabSales Order` so ON soi.parent = so.name
#             INNER JOIN `tabQuotation` q ON soi.prevdoc_docname = q.name
#             WHERE q.quotation_to = 'Lead'
#               AND q.party_name = %s
#               AND so.docstatus = 1
#             ORDER BY so.creation DESC
#             LIMIT 1
#         """, (lead_name,), as_dict=True)

#         if active_so:
#             # ✅ Update latest active SO value
#             lead.custom_po_value = active_so[0].grand_total
#         else:
#             # ✅ No active SO → revert Lead category & clear PO value
#             lead.custom_lead_category = "Pipeline"
#             lead.custom_po_value = 0

#         lead.save(ignore_permissions=True)

import frappe
from frappe.utils import flt
from erpnext.selling.doctype.sales_order.sales_order import create_pick_list

def get_lead_from_so_items(doc):
    """
    Finds the Lead ID by checking the custom_lead_id field in the 
    Quotation linked to the Sales Order items.
    """
    if not doc.get("items"):
        return None

    for item in doc.items:
        prev_doc = item.get("prevdoc_docname")
        if prev_doc:
            # We fetch the custom_lead_id from the Quotation linked to this item
            lead_id = frappe.db.get_value("Quotation", prev_doc, "custom_lead_id")
            if lead_id:
                return lead_id
    return None

def sync_lead_data(lead_name, exclude_so_name=None):
    """
    Synchronizes Lead data. 
    PRIORITY: Latest Submitted Sales Order (docstatus 1) > Latest Draft (docstatus 0).
    """
    if not lead_name:
        return

    # Prepare SQL filters and arguments
    query_filters = "AND so.docstatus < 2"  # Exclude Cancelled
    args = [lead_name]
    
    if exclude_so_name:
        query_filters += " AND so.name != %s"
        args.append(exclude_so_name)

    # SQL logic: 
    # 1. 'ORDER BY so.docstatus DESC' ensures Submitted (1) comes before Draft (0).
    # 2. 'ORDER BY so.creation DESC' ensures the newest record within that status is picked.
    latest_so = frappe.db.sql(f"""
        SELECT so.grand_total, so.customer, so.name, so.docstatus
        FROM `tabSales Order` so
        WHERE EXISTS (
            SELECT 1 FROM `tabSales Order Item` soi
            INNER JOIN `tabQuotation` q ON soi.prevdoc_docname = q.name
            WHERE soi.parent = so.name AND q.custom_lead_id = %s
        )
        {query_filters}
        ORDER BY so.docstatus DESC, so.creation DESC
        LIMIT 1
    """, tuple(args), as_dict=True)

    if latest_so:
        data = latest_so[0]
        # Valid SO exists: Update Lead
        frappe.db.set_value("Lead", lead_name, {
            "custom_po_value": flt(data.grand_total),
            "custom_lead_category": "Order",
            "custom_lead_type": "WON",
            "custom_lead_customer": data.customer or ""
        }, update_modified=True)
    else:
        # No valid Sales Orders remain: Revert Lead
        frappe.db.set_value("Lead", lead_name, {
            "custom_po_value": 0,
            "custom_lead_category": "Pipeline",
            "custom_lead_type": "WARM"
        }, update_modified=True)

# -------------------------------------------------------------------------
# EVENT HOOKS (Sales Order)
# -------------------------------------------------------------------------

def sales_order_on_update(doc, method):
    """Draft Save: Updates Lead with Draft total (unless a Submitted SO already exists)."""
    lead_name = get_lead_from_so_items(doc)
    if lead_name:
        # Sync Lead Owner to Sales Order for Drafts
        if doc.docstatus == 0:
            lead_owner = frappe.db.get_value("Lead", lead_name, "lead_owner")
            if lead_owner and doc.get("custom_lead_owner") != lead_owner:
                frappe.db.set_value("Sales Order", doc.name, "custom_lead_owner", lead_owner)
        
        sync_lead_data(lead_name)

def sales_order_on_submit(doc, method):
    """Submit: Prioritizes this SO's total for the Lead PO Value."""
    lead_name = get_lead_from_so_items(doc)
    if lead_name:
        sync_lead_data(lead_name)

    # Standard ERPNext logic: Create Pick List on Submit
    try:
        pick_list = create_pick_list(doc.name)
        if pick_list.locations:
            pick_list.insert(ignore_permissions=True)
    except Exception:
        pass

def sales_order_on_cancel(doc, method):
    """Cancel: Automatically finds the next most recent Submitted/Draft SO."""
    lead_name = get_lead_from_so_items(doc)
    sync_lead_data(lead_name)

def sales_order_on_trash(doc, method):
    """Delete: Manually excludes this doc to find the next valid record."""
    lead_name = get_lead_from_so_items(doc)
    sync_lead_data(lead_name, exclude_so_name=doc.name)












# import frappe

# @frappe.whitelist()
# def get_pending_sales_orders(is_subcontracted=False):
#     print("Fetching pending Sales sssssssssssssssssssssOrders. is_subcontracted =", is_subcontracted)
#     """
#     Fetch pending Sales Orders and their items.
#     - If is_subcontracted = 1 → only include items WITH BOM
#     - If is_subcontracted = 0 → only include items WITHOUT BOM
#     """
#     is_subcontracted = frappe.utils.cint(is_subcontracted)

#     # ✅ This condition is the key
#     if is_subcontracted:
#         condition = "AND soi.bom_no IS NOT NULL AND soi.bom_no != ''"
#     else:
#         condition = "AND (soi.bom_no IS NULL OR soi.bom_no = '')"

#     query = f"""
#         SELECT 
#             so.name AS sales_order,
#             soi.item_code,
#             soi.item_name,
#             soi.qty,
#             soi.bom_no,
#             (soi.qty - IFNULL(soi.delivered_qty, 0)) AS pending_qty
#         FROM `tabSales Order` so
#         INNER JOIN `tabSales Order Item` soi ON soi.parent = so.name
#         WHERE so.docstatus = 1
#             AND so.status NOT IN ('Closed', 'Completed', 'Cancelled')
#             AND (soi.qty - IFNULL(soi.delivered_qty, 0)) > 0
#             {condition}
#         ORDER BY so.transaction_date DESC
#     """

#     return frappe.db.sql(query, as_dict=True)
from collections import defaultdict
import frappe
from frappe.utils import cint, flt
from collections import defaultdict

# --- Mock-up of the required Helper Function ---
def _get_pick_list_reserved_qty(sales_order_name, item_code):
    """
    Calculates the total quantity for a specific SO Item that is linked to 
    a Pick List that is NOT yet Delivered (i.e., submitted, pending transfer, or draft).
    This value is the committed quantity to be excluded from further picking/procurement need.
    """
    
    # 1. Quantity on Submitted/In-progress Pick Lists (uses picked_qty for submitted, assuming the
    # document links ensure it's not fully delivered/invoiced)
    # Using parentlink_field for better accuracy, which should link to SO Name or SO Item Name. 
    # Since the input is SO Name, linking to Sales Order in Pick List is safest.
    total_committed_submitted = frappe.db.sql("""
        SELECT SUM(pli.picked_qty) FROM `tabPick List Item` pli 
        JOIN `tabPick List` pl ON pl.name = pli.parent
        WHERE pl.sales_order = %(so_name)s 
        AND pli.item_code = %(item_code)s 
        AND pl.docstatus = 1 AND pl.status NOT IN ('Completed', 'Cancelled')
    """, {"so_name": sales_order_name, "item_code": item_code})[0][0] or 0.0

    # 2. Quantity on Draft Pick Lists (uses qty)
    total_committed_draft = frappe.db.sql("""
        SELECT SUM(pli.qty) FROM `tabPick List Item` pli 
        JOIN `tabPick List` pl ON pl.name = pli.parent
        WHERE pl.sales_order = %(so_name)s 
        AND pli.item_code = %(item_code)s 
        AND pl.docstatus = 0
    """, {"so_name": sales_order_name, "item_code": item_code})[0][0] or 0.0

    return flt(total_committed_submitted) + flt(total_committed_draft)
# --- END Mock-up of Helper Function ---
import frappe
from frappe.utils import flt, cint
from collections import defaultdict
from erpnext.stock.stock_ledger import get_stock_balance

# Assuming these are existing/standard ERPNext-style helper functions
# These helper functions must be implemented elsewhere in your custom script (or they already exist).
# For the purpose of this solution, I'm providing placeholder logic in a note:
"""
# Assuming these helper functions are implemented elsewhere (e.g., at the top of the file):

def _get_pl_picked_qty_for_so_item(sales_order, item_code):
    # Sum of pli.picked_qty where pl.docstatus = 1 (Submitted) and pl.status NOT IN ('Completed', 'Cancelled')
    return frappe.db.sql('''
        SELECT SUM(pli.picked_qty) FROM `tabPick List Item` pli
        JOIN `tabPick List` pl ON pl.name = pli.parent
        WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 1 AND pl.status NOT IN ('Completed', 'Cancelled')
    ''', (sales_order, item_code))[0][0] or 0

def _get_pl_yet_to_pick_qty_for_so_item(sales_order, item_code):
    # Sum of pli.qty where pl.docstatus = 0 (Draft)
    return frappe.db.sql('''
        SELECT SUM(pli.qty) FROM `tabPick List Item` pli
        JOIN `tabPick List` pl ON pl.name = pli.parent
        WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 0
    ''', (sales_order, item_code))[0][0] or 0

# And using an *assumed* single function that is the sum of both if that is simpler.
# We'll use this placeholder to get the *total* commitment for that item.
# def _get_pick_list_total_committed_qty(sales_order, item_code): 
#     return _get_pl_picked_qty_for_so_item(sales_order, item_code) + _get_pl_yet_to_pick_qty_for_so_item(sales_order, item_code)
"""
# --- Place this code in your custom app's server-side script file ---

import frappe
from frappe import _
from frappe.utils import flt, cint
from collections import defaultdict

# @frappe.whitelist()
# def get_pending_so_with_material_stock(is_subcontracted=False):
#     """
#     Fetches pending Sales Order items, calculates their stock and procurement status,
#     and returns a consolidated summary and a detailed list.

#     This function now correctly identifies the GROSS procurement need and the NET
#     quantity to purchase by accounting for quantities already on open Purchase Orders.
#     """
#     is_subcontracted = cint(is_subcontracted)
#     item_code_field = "fg_item" if is_subcontracted else "item_code"
    
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
        
#         # 1. Find existing open Purchase Orders for this specific Sales Order Item.
#         existing_po_items = frappe.db.sql("""
#             SELECT poi.parent, poi.qty
#             FROM `tabPurchase Order Item` AS poi
#             JOIN `tabPurchase Order` AS po ON po.name = poi.parent
#             WHERE po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled', 'Completed')
#             AND poi.sales_order = %(sales_order)s AND poi.{field} = %(item_code)s
#         """.format(field=item_code_field), {'sales_order': so_item.sales_order, 'item_code': so_item.item_code}, as_dict=True)

#         ordered_on_pos_qty = sum(flt(item.qty) for item in existing_po_items)
#         existing_po_info_list = [f"{item.parent} (Qty: {flt(item.qty)})" for item in existing_po_items]
#         existing_pos_info = ", ".join(existing_po_info_list)

#         # 2. Calculate quantities committed via Pick Lists for this Sales Order item.
#         pl_picked_qty = flt(frappe.db.sql("""
#             SELECT SUM(pli.picked_qty) FROM `tabPick List Item` pli 
#             JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 1 
#             AND pl.status NOT IN ('Completed', 'Cancelled')
#         """, (so_item.sales_order, so_item.item_code))[0][0])
        
#         pl_yet_to_pick_qty = flt(frappe.db.sql("""
#             SELECT SUM(pli.qty) FROM `tabPick List Item` pli 
#             JOIN `tabPick List` pl ON pl.name = pli.parent
#             WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 0
#         """, (so_item.sales_order, so_item.item_code))[0][0])
        
#         total_pl_committed = pl_picked_qty + pl_yet_to_pick_qty

#         # 3. Calculate the GROSS uncommitted quantity.
#         qty_uncommitted = so_item.qty - so_item.delivered_qty - total_pl_committed

#         if qty_uncommitted > 0.001:
#             so_item['gross_pending_qty'] = max(0, flt(qty_uncommitted))
#             so_item['already_ordered_qty'] = ordered_on_pos_qty
#             so_item['existing_pos_info'] = existing_pos_info
            
#             # 4. Calculate the NET quantity to purchase.
#             qty_pending_purchase = qty_uncommitted - ordered_on_pos_qty
#             so_item['pending_qty'] = max(0, flt(qty_pending_purchase)) 
            
#             # Add detailed breakdown for the frontend UI.
#             so_item['pl_picked_qty'] = pl_picked_qty
#             so_item['pl_yet_to_pick_qty'] = pl_yet_to_pick_qty
#             so_item['fg_reserved_for_so_qty'] = total_pl_committed
            
#             final_pending_orders.append(so_item)

#     if not final_pending_orders:
#         return {}

#     # --- Build the summary and propagate overall item status ---
#     item_summary_dict = defaultdict(lambda: {"total_qty": 0, "order_count": 0, "boms": set(), "item_name": ""})
#     for so in final_pending_orders:
#         item_code = so.item_code
#         item_summary_dict[item_code]["total_qty"] += so.pending_qty
#         item_summary_dict[item_code]["order_count"] += 1
#         item_summary_dict[item_code]["item_name"] = so.item_name
#         if so.bom: item_summary_dict[item_code]["boms"].add(so.bom)
    
#     item_summary = []
#     for item_code, data in item_summary_dict.items():
#         fg_actual_res = frappe.db.sql("SELECT SUM(actual_qty) FROM `tabBin` WHERE item_code = %s", item_code)
#         fg_actual = flt(fg_actual_res[0][0])
        
#         total_reserved_res = frappe.db.sql("SELECT SUM(reserved_qty) FROM `tabStock Reservation Entry` WHERE item_code = %s AND docstatus = 1", item_code)
#         total_reserved = flt(total_reserved_res[0][0])
        
#         fg_available = fg_actual - total_reserved
        
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
#         materials = []
#         # NOTE: You may need to implement a helper function like _get_bom_stock_details
#         # if you need to show raw material availability in the summary view.
#         # For now, it's an empty list.

#         item_summary.append({
#             "item_code": item_code, 
#             "item_name": data["item_name"],
#             "fg_total_stock": flt(fg_actual), 
#             "fg_available_qty": flt(fg_available),
#             "fg_picked_submitted": flt(total_picked_submitted),
#             "fg_picked_draft": flt(total_picked_draft),
#             "total_pending_qty": data["total_qty"],
#             "order_count": data["order_count"],
#             "total_reserved_qty": flt(total_reserved),
#             "raw_materials": materials
#         })
        
#     # Final loop to propagate summary data to each individual SO item line
#     for so_item in final_pending_orders:
#         summary = next((i for i in item_summary if i['item_code'] == so_item.item_code), None)
#         if summary:
#             so_item['fg_total_stock'] = summary['fg_total_stock']
#             so_item['fg_total_reserved_qty'] = summary['total_reserved_qty']
#             so_item['fg_available_qty'] = summary['fg_available_qty'] 
#             so_item['fg_picked_submitted'] = summary['fg_picked_submitted']
#             so_item['fg_picked_draft'] = summary['fg_picked_draft']
    
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
#     Fetches pending Sales Order items, calculates stock and procurement status,
#     and correctly handles cases where the same FG item appears in multiple rows
#     (with and without BOM) within the same Sales Order.

#     Key improvement: picked/committed qty is aggregated per (SO + Item),
#     so all rows of the same item show consistent pending/shortfall qty.
#     """
#     is_subcontracted = cint(is_subcontracted)
#     item_code_field = "fg_item" if is_subcontracted else "item_code"

#     condition = "AND soi.bom_no IS NOT NULL AND soi.bom_no != ''" if is_subcontracted else "AND (soi.bom_no IS NULL OR soi.bom_no = '')"

#     # ── 1. Fetch all pending SO items ──
#     pending_orders_raw = frappe.db.sql(f"""
#         SELECT
#             soi.name            AS so_item_name,
#             soi.parent          AS sales_order,
#             so.customer         AS customer,
#             soi.item_code,
#             soi.item_name,
#             soi.qty,
#             soi.bom_no          AS bom,
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

#     # ── 2. Aggregate picked qty PER SALES ORDER + ITEM (not per row) ──
#     picked_qty_data = frappe.db.sql("""
#         SELECT
#             pli.sales_order,
#             pli.item_code,
#             SUM(CASE WHEN pl.docstatus = 1 AND pl.status NOT IN ('Completed', 'Cancelled') THEN pli.picked_qty ELSE 0 END) AS pl_picked_qty,
#             SUM(CASE WHEN pl.docstatus = 0 THEN pli.qty ELSE 0 END) AS pl_yet_to_pick_qty
#         FROM `tabPick List Item` pli
#         JOIN `tabPick List` pl ON pl.name = pli.parent
#         WHERE pli.sales_order IN (%s)
#           AND pli.item_code IN (%s)
#         GROUP BY pli.sales_order, pli.item_code
#     """, (
#         tuple({row['sales_order'] for row in pending_orders_raw}),
#         tuple({row['item_code'] for row in pending_orders_raw})
#     ), as_dict=True)

#     picked_lookup = {
#         (row['sales_order'], row['item_code']): row
#         for row in picked_qty_data
#     }

#     # ── 3. Aggregate existing PO qty PER SALES ORDER + ITEM ──
#     po_qty_data = frappe.db.sql("""
#         SELECT
#             poi.sales_order,
#             poi.{field} AS item_code,
#             SUM(poi.qty) AS ordered_qty,
#             GROUP_CONCAT(CONCAT(poi.parent, ' (Qty: ', poi.qty, ')') SEPARATOR ', ') AS po_info
#         FROM `tabPurchase Order Item` poi
#         JOIN `tabPurchase Order` po ON po.name = poi.parent
#         WHERE po.docstatus = 1
#           AND po.status NOT IN ('Closed', 'Cancelled', 'Completed')
#           AND poi.sales_order IN (%s)
#           AND poi.{field} IN (%s)
#         GROUP BY poi.sales_order, poi.{field}
#     """.format(field=item_code_field), (
#         tuple({row['sales_order'] for row in pending_orders_raw}),
#         tuple({row['item_code'] for row in pending_orders_raw})
#     ), as_dict=True)

#     po_lookup = {
#         (row['sales_order'], row['item_code']): row
#         for row in po_qty_data
#     }

#     # ── 4. Process rows — use aggregated values for all rows of same item ──
#     final_pending_orders = []
#     item_total_pending = defaultdict(float)  # for summary

#     for row in pending_orders_raw:
#         so = row['sales_order']
#         item = row['item_code']

#         # Get aggregated picked qty for this item in this SO
#         picked = picked_lookup.get((so, item), {'pl_picked_qty': 0, 'pl_yet_to_pick_qty': 0})
#         total_pl_committed = flt(picked['pl_picked_qty']) + flt(picked['pl_yet_to_pick_qty'])

#         # Get aggregated PO qty
#         po = po_lookup.get((so, item), {'ordered_qty': 0, 'po_info': ''})

#         # Calculate item-level pending (same for all rows of this item)
#         gross_pending = row['qty'] - row['delivered_qty'] - total_pl_committed
#         if gross_pending <= 0.001:
#             continue

#         net_pending_purchase = max(0, gross_pending - flt(po['ordered_qty']))

#         # Update row with aggregated values (same for all rows of same item)
#         row.update({
#             'gross_pending_qty': flt(gross_pending),
#             'already_ordered_qty': flt(po['ordered_qty']),
#             'existing_pos_info': po['po_info'],
#             'pending_qty': flt(net_pending_purchase),  # this will be same for all rows of the item
#             'pl_picked_qty': flt(picked['pl_picked_qty']),
#             'pl_yet_to_pick_qty': flt(picked['pl_yet_to_pick_qty']),
#             'total_pl_committed': total_pl_committed,
#             'fg_reserved_for_so_qty': total_pl_committed,
#             'fg_picked_submitted': flt(picked['pl_picked_qty']),
#             'fg_picked_draft': flt(picked['pl_yet_to_pick_qty'])
#         })

#         final_pending_orders.append(row)
#         item_total_pending[item] += net_pending_purchase

#     if not final_pending_orders:
#         return {"item_summary": [], "sales_orders": []}

#     # ── 5. Build item-level summary ──
#     item_summary_dict = defaultdict(lambda: {
#         "total_pending_qty": 0,
#         "order_count": 0,
#         "item_name": "",
#         "boms": set()
#     })

#     for row in final_pending_orders:
#         item = row['item_code']
#         item_summary_dict[item]["total_pending_qty"] += row['pending_qty']
#         item_summary_dict[item]["order_count"] += 1
#         item_summary_dict[item]["item_name"] = row['item_name']
#         if row['bom']:
#             item_summary_dict[item]["boms"].add(row['bom'])

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
#             "raw_materials": []  # populate if needed
#         })

#     # ── Return ──
#     return {
#         "item_summary": sorted(item_summary, key=lambda x: x['total_pending_qty'], reverse=True),
#         "sales_orders": final_pending_orders
#     }


import frappe
from frappe.utils import flt, cint
from collections import defaultdict

@frappe.whitelist()
def get_raw_materials_for_selected_so_items(selected_items, is_subcontracted=False):
    """
    Get aggregated raw materials required for the selected Sales Order items (Finished Goods).
    Returns a list of raw materials with required_qty, available_qty, etc.
    """
    is_subcontracted = cint(is_subcontracted)
    selected_items = frappe.parse_json(selected_items) if isinstance(selected_items, str) else selected_items
    
    if not selected_items:
        return {"materials": []}
    
    # Aggregate required raw materials from BOMs
    raw_materials_req = defaultdict(float)  # item_code -> required_qty
    raw_materials_details = {}  # item_code -> details dict
    
    for item in selected_items:
        fg_item_code = item.get('itemCode')
        qty = flt(item.get('pendingQty', 0))
        bom = item.get('bom')
        
        if not bom or qty <= 0:
            continue
        
        # Get BOM items for this BOM
        bom_items = frappe.db.sql("""
            SELECT bii.item_code, bii.item_name, bii.stock_uom, SUM(bii.stock_qty) as bom_qty
            FROM `tabBOM Item` bii
            WHERE bii.parent = %s AND bii.parenttype = 'BOM'
            GROUP BY bii.item_code, bii.item_name, bii.stock_uom
        """, (bom,), as_dict=True)
        
        # Scale by the pending qty for this FG
        for bim in bom_items:
            rm_code = bim.item_code
            required_for_this = flt(bim.bom_qty) * qty
            raw_materials_req[rm_code] += required_for_this
            
            if rm_code not in raw_materials_details:
                raw_materials_details[rm_code] = {
                    'item_name': bim.item_name,
                    'stock_uom': bim.stock_uom
                }
    
    # Now, for each unique raw material, calculate availability
    materials = []
    for rm_code, required_qty in raw_materials_req.items():
        if required_qty <= 0:
            continue
        
        details = raw_materials_details.get(rm_code, {})
        
        # 1. Actual Stock
        actual_qty_res = frappe.db.sql("SELECT SUM(actual_qty) FROM `tabBin` WHERE item_code = %s", (rm_code,))
        actual_qty = flt(actual_qty_res[0][0] if actual_qty_res else 0)
        
        # 2. Reserved (from Stock Reservation Entry)
        reserved_res = frappe.db.sql("SELECT SUM(reserved_qty) FROM `tabStock Reservation Entry` WHERE item_code = %s AND docstatus = 1", (rm_code,))
        reserved_qty = flt(reserved_res[0][0] if reserved_res else 0)
        
        # Available
        available_qty = actual_qty - reserved_qty
        
        materials.append({
            'item_code': rm_code,
            'item_name': details.get('item_name', ''),
            'required_qty': required_qty,
            'available_qty': available_qty,
            'actual_qty': actual_qty,
            'reserved_qty': reserved_qty,
            'stock_uom': details.get('stock_uom', ''),
            'shortage': max(0, required_qty - available_qty)
        })
    
    # Sort by shortage descending
    materials.sort(key=lambda x: x['shortage'], reverse=True)
    
    return {
        "materials": materials,
        "total_required_items": len([m for m in materials if m['required_qty'] > 0]),
        "shortage_items": len([m for m in materials if m['shortage'] > 0])
    }
    
def _get_bom_stock_details(bom, fg_qty):
    """
    Helper function to get raw materials with stock details for a single BOM and quantity.
    Used in the main get_pending_so_with_material_stock.
    """
    if not bom or fg_qty <= 0:
        return []
    
    # Similar logic as above, but for single BOM
    raw_materials_req = defaultdict(float)
    raw_materials_details = {}
    
    bom_items = frappe.db.sql("""
        SELECT bii.item_code, bii.item_name, bii.stock_uom, SUM(bii.stock_qty) as bom_qty
        FROM `tabBOM Item` bii
        WHERE bii.parent = %s AND bii.parenttype = 'BOM'
        GROUP BY bii.item_code, bii.item_name, bii.stock_uom
    """, (bom,), as_dict=True)
    
    for bim in bom_items:
        rm_code = bim.item_code
        required = flt(bim.bom_qty) * fg_qty
        raw_materials_req[rm_code] += required
        
        if rm_code not in raw_materials_details:
            raw_materials_details[rm_code] = {
                'item_name': bim.item_name,
                'stock_uom': bim.stock_uom
            }
    
    materials = []
    for rm_code, required_qty in raw_materials_req.items():
        details = raw_materials_details.get(rm_code, {})
        
        actual_qty_res = frappe.db.sql("SELECT SUM(actual_qty) FROM `tabBin` WHERE item_code = %s", (rm_code,))
        actual_qty = flt(actual_qty_res[0][0] if actual_qty_res else 0)
        
        reserved_res = frappe.db.sql("SELECT SUM(reserved_qty) FROM `tabStock Reservation Entry` WHERE item_code = %s AND docstatus = 1", (rm_code,))
        reserved_qty = flt(reserved_res[0][0] if reserved_res else 0)
        
        available_qty = actual_qty - reserved_qty
        
        materials.append({
            'item_code': rm_code,
            'item_name': details.get('item_name', ''),
            'required_qty': required_qty,
            'available_qty': available_qty,
            'actual_qty': actual_qty,
            'reserved_qty': reserved_qty,
            'stock_uom': details.get('stock_uom', '')
        })
    
    return materials
import frappe
import json
from frappe import _
from frappe.utils import flt, getdate

@frappe.whitelist()
def get_pending_so_with_raw_materials_summary():
    """
    MODIFIED V8.1 (CORRECTED & FINAL):
    - This is the full, unabbreviated version of the script.
    - All SQL queries are complete, resolving the TypeError from the traceback.
    - Contains all features: FG "In-Production" calculation, BOM-only SO item filtering,
      and advanced raw material availability logic.
    """
    pending_sos = []
    company = frappe.defaults.get_user_default("Company") or frappe.get_doc("Global Defaults").default_company

    # Step 1: Get pending Sales Order Items that have a BOM.
    so_items = frappe.db.sql("""
        SELECT
            si.parent as sales_order, si.item_code, si.item_name, si.qty,
            COALESCE(si.delivered_qty, 0) as delivered_qty,
            (si.qty - COALESCE(si.delivered_qty, 0)) as pending_qty,
            so.customer, si.bom_no as bom, si.uom
        FROM `tabSales Order Item` si JOIN `tabSales Order` so ON si.parent = so.name
        WHERE so.docstatus = 1 AND so.status NOT IN ('Closed', 'Cancelled', 'On Hold')
          AND (si.qty - COALESCE(si.delivered_qty, 0)) > 0.001
          AND si.bom_no IS NOT NULL AND si.bom_no != ''
        ORDER BY so.transaction_date DESC, so.name
    """, as_dict=1)

    if not so_items:
        return {"sales_orders": []}

    # Step 2: Collect all unique item codes and BOMs.
    all_bom_item_codes = set()
    all_finished_good_codes = {item['item_code'] for item in so_items}
    boms_to_fetch = {item['bom'] for item in so_items}

    all_bom_items = {}
    if boms_to_fetch:
        db_bom_items = frappe.get_all("BOM Item", filters={"parent": ("in", list(boms_to_fetch))}, fields=["parent", "item_code", "item_name", "stock_uom", "stock_qty"])
        for bom_item in db_bom_items:
            all_bom_items.setdefault(bom_item.parent, []).append(bom_item)
            all_bom_item_codes.add(bom_item.item_code)

    stock_info = {}
    unallocated_ordered_map = {}
    so_rm_ordered_map = {}
    existing_pos_map = {}
    in_production_fg_map = {}

    # Step 3: Get physical stock for ALL items (RMs and FGs).
    all_items_to_check = tuple(all_bom_item_codes.union(all_finished_good_codes))
    if all_items_to_check:
        bin_data = frappe.db.sql("""
            SELECT b.item_code, SUM(COALESCE(b.actual_qty, 0) - COALESCE(b.reserved_qty, 0)) as available_qty
            FROM `tabBin` b JOIN `tabWarehouse` w ON b.warehouse = w.name
            WHERE b.item_code IN %s AND w.company = %s GROUP BY b.item_code
        """, (all_items_to_check, company), as_dict=True)
        stock_info = {row['item_code']: max(0, row.get('available_qty', 0)) for row in bin_data}

    # Step 4: Calculate "In-Production" quantity for Finished Goods.
    if all_finished_good_codes:
        fg_codes = tuple(all_finished_good_codes)
        in_production_data = frappe.db.sql("""
            SELECT fg_item, SUM(fg_qty) as total_in_production FROM (
                SELECT DISTINCT rmb.source_finished_good as fg_item, rmb.order_for_fg as fg_qty,
                                rmb.parent, rmb.source_sales_order
                FROM `tabPurchase Order Raw Material Source` rmb
                JOIN `tabPurchase Order` po ON rmb.parent = po.name
                WHERE po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled')
                  AND rmb.source_finished_good IN %s
            ) as distinct_production_runs
            GROUP BY fg_item
        """, (fg_codes,), as_dict=1)
        in_production_fg_map = {row['fg_item']: row['total_in_production'] for row in in_production_data}

    # Step 5: Get all PO-related data for Raw Materials.
    if all_bom_item_codes:
        rm_item_codes = tuple(all_bom_item_codes)
        
        total_ordered_items = frappe.db.sql("""
            SELECT poi.item_code, SUM(poi.qty - COALESCE(poi.received_qty, 0)) AS total_ordered
            FROM `tabPurchase Order Item` poi JOIN `tabPurchase Order` po ON poi.parent = po.name
            WHERE poi.item_code IN %s AND po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled') AND po.company = %s
            GROUP BY poi.item_code
        """, (rm_item_codes, company), as_dict=True)
        total_ordered_map = {row['item_code']: flt(row.get('total_ordered', 0)) for row in total_ordered_items}

        linked_quantities = frappe.db.sql("""
            SELECT rmb.raw_material_item, SUM(rmb.order_for_rm) as total_linked_qty
            FROM `tabPurchase Order Raw Material Source` rmb JOIN `tabPurchase Order` po ON rmb.parent = po.name
            WHERE rmb.raw_material_item IN %s AND po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled') AND po.company = %s
            GROUP BY rmb.raw_material_item
        """, (rm_item_codes, company), as_dict=1)
        linked_map = {item['raw_material_item']: item['total_linked_qty'] for item in linked_quantities}

        for item_code, total_ordered in total_ordered_map.items():
            unallocated_ordered_map[item_code] = max(0, total_ordered - linked_map.get(item_code, 0))

        sales_order_names = tuple(so['sales_order'] for so in so_items)
        if sales_order_names:
            so_rm_links = frappe.db.sql("""
                SELECT rmb.source_sales_order, rmb.raw_material_item, SUM(rmb.order_for_rm) as ordered_qty
                FROM `tabPurchase Order Raw Material Source` rmb JOIN `tabPurchase Order` po ON rmb.parent = po.name
                WHERE rmb.source_sales_order IN %s AND po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled')
                GROUP BY rmb.source_sales_order, rmb.raw_material_item
            """, (sales_order_names,), as_dict=1)
            so_rm_ordered_map = {(link['source_sales_order'], link['raw_material_item']): link['ordered_qty'] for link in so_rm_links}

        pos_data = frappe.db.sql("""
            SELECT po.name, po.supplier, poi.item_code FROM `tabPurchase Order Item` poi
            JOIN `tabPurchase Order` po ON poi.parent = po.name
            WHERE poi.item_code IN %s AND po.docstatus = 1 AND po.status NOT IN ('Closed', 'Cancelled') AND po.company = %s
        """, (rm_item_codes, company), as_dict=True)
        for pos in pos_data:
            po_link_text = f"{pos['name']} ({pos['supplier'] or 'N/A'})"
            existing_pos_map.setdefault(pos['item_code'], []).append(po_link_text)

    # Step 6: Process each SO item and package the final data for the UI.
    for so_item in so_items:
        sales_order, item_code = so_item['sales_order'], so_item['item_code']
        
        picked_submitted_query = frappe.db.sql("""
            SELECT COALESCE(SUM(pli.picked_qty), 0) as total FROM `tabPick List Item` pli
            JOIN `tabPick List` pl ON pli.parent = pl.name
            WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 1
        """, (sales_order, item_code), as_dict=True)
        picked_submitted = picked_submitted_query[0].get('total', 0) if picked_submitted_query else 0

        picked_draft_query = frappe.db.sql("""
            SELECT COALESCE(SUM(pli.qty), 0) as total FROM `tabPick List Item` pli
            JOIN `tabPick List` pl ON pli.parent = pl.name
            WHERE pli.sales_order = %s AND pli.item_code = %s AND pl.docstatus = 0
        """, (sales_order, item_code), as_dict=True)
        picked_draft = picked_draft_query[0].get('total', 0) if picked_draft_query else 0
        
        qty_awaiting_pick = max(0, so_item['pending_qty'] - picked_submitted - picked_draft)
        
        if qty_awaiting_pick <= 0.001: 
            continue
        
        physical_stock = flt(stock_info.get(item_code, 0))
        in_production_qty = flt(in_production_fg_map.get(item_code, 0))

        so_item.update({
            'picked_submitted': picked_submitted,
            'picked_draft': picked_draft,
            'qty_awaiting_pick': qty_awaiting_pick,
            'available_fg_qty': physical_stock + in_production_qty
        })

        raw_materials = []
        for bom_item in all_bom_items.get(so_item['bom'], []):
            rm_code = bom_item['item_code']
            raw_materials.append({
                "item_code": rm_code,
                "item_name": bom_item['item_name'],
                "uom": bom_item['stock_uom'],
                "base_stock_qty": flt(bom_item['stock_qty']),
                "available_qty": flt(stock_info.get(rm_code, 0)),
                "unallocated_ordered_qty": flt(unallocated_ordered_map.get(rm_code, 0)),
                "ordered_for_this_so": flt(so_rm_ordered_map.get((sales_order, rm_code), 0)),
                "existing_pos": ', '.join(existing_pos_map.get(rm_code, []))
            })
        
        so_item["raw_materials"] = raw_materials
        pending_sos.append(so_item)
    
    return {"sales_orders": pending_sos}
@frappe.whitelist()
def calculate_raw_materials_from_selected_sos(selected_sos):
    """
    Calculate consolidated raw materials required from selected Sales Orders and their fulfill quantities.
    Returns a list of dicts with consolidated RM data: item_code, item_name, uom, required_qty, sales_orders, customers.
    NEW: Include material_requests aggregated from linked MRs for each RM across selected SOs.
    """
    selected_sos = json.loads(selected_sos)
    if not selected_sos:
        return []
    # Dictionary to consolidate raw materials: key=item_code, value=dict with sums and lists
    rm_consolidated = {}
   
    for so_data in selected_sos:
        sales_order = so_data.get('sales_order')
        item_code = so_data.get('item_code')
        bom = so_data.get('bom')
        qty_to_fulfill = flt(so_data.get('qty_to_fulfill', 0))
       
        if qty_to_fulfill <= 0 or not bom:
            continue
       
        # Get customer from SO
        customer = frappe.db.get_value("Sales Order", sales_order, "customer")
       
        # Get BOM items
        bom_items = frappe.get_all(
            "BOM Item",
            filters={"parent": bom},
            fields=["item_code", "item_name", "stock_uom", "stock_qty"],
            order_by="idx"
        )
       
        # Explode BOM for this qty
        for bom_item in bom_items:
            rm_item_code = bom_item.item_code
            required_for_this = flt(bom_item.stock_qty) * qty_to_fulfill
           
            if rm_item_code not in rm_consolidated:
                rm_consolidated[rm_item_code] = {
                    'item_code': rm_item_code,
                    'item_name': bom_item.item_name,
                    'uom': bom_item.stock_uom,
                    'required_qty': 0,
                    'sales_orders': [],
                    'customers': [],
                    'material_requests': []
                }
           
            cons = rm_consolidated[rm_item_code]
            cons['required_qty'] += required_for_this
           
            # Add SO if not already
            if sales_order not in cons['sales_orders']:
                cons['sales_orders'].append(sales_order)
           
            # Add customer if not already
            if customer and customer not in cons['customers']:
                cons['customers'].append(customer)
           
            # NEW: Aggregate MR refs for this RM from this SO
            material_requests = frappe.db.sql("""
                SELECT GROUP_CONCAT(DISTINCT mri.parent SEPARATOR ', ')
                FROM `tabMaterial Request Item` mri
                INNER JOIN `tabMaterial Request` mr ON mri.parent = mr.name
                WHERE mri.item_code = %s AND mri.reference_sales_order = %s AND mr.docstatus = 1 AND mr.status != 'Stopped'
            """, (rm_item_code, sales_order))
            mr_list = material_requests[0][0].split(', ') if material_requests and material_requests[0][0] else []
            for mr in mr_list:
                if mr and mr not in cons['material_requests']:
                    cons['material_requests'].append(mr)
   
    # Convert to list and format strings
    result = []
    for code, data in rm_consolidated.items():
        result.append({
            'item_code': data['item_code'],
            'item_name': data['item_name'],
            'uom': data['uom'],
            'required_qty': data['required_qty'],
            'sales_orders': ', '.join(data['sales_orders']),
            'customers': ', '.join(data['customers']),
            'material_requests': ', '.join(data['material_requests'])
        })
   
    # Sort by required_qty descending
    result.sort(key=lambda x: x['required_qty'], reverse=True)
   
    return result

@frappe.whitelist()
def get_stock_for_calculated_raw_materials(raw_materials):
    import json
    from frappe.utils import flt
    import frappe
   
    raw_materials_list = json.loads(raw_materials)
    if not raw_materials_list:
        return []
    # Get the current default company
    company = frappe.defaults.get_user_default("Company") or frappe.get_doc("Global Defaults").default_company
   
    # Pre-fetch ALL stock info for the items to minimize DB hits (more performant)
    item_codes = [rm.get('item_code') for rm in raw_materials_list if rm.get('item_code')]
    if not item_codes:
        return raw_materials_list
       
    stock_info = {}
   
    # 1. Fetch current total physical stock and committed/reserved quantities across all relevant bins/warehouses
    # FIX: Joined with tabWarehouse to correctly filter by company, as tabBin does not have a company field.
    # Available: actual_qty - reserved_qty (uncommitted warehouse stock only)
    bin_data = frappe.db.sql("""
        SELECT
            b.item_code,
            SUM(b.actual_qty) as actual_qty,
            SUM(b.reserved_qty) as reserved_qty,
            SUM(b.projected_qty) as projected_qty
        FROM `tabBin` b
        JOIN `tabWarehouse` w ON b.warehouse = w.name
        WHERE
            b.item_code IN %s
            AND w.company = %s
        GROUP BY b.item_code
    """, (item_codes, company), as_dict=True)
    for row in bin_data:
        # available_qty: the amount that is uncommitted in actual stock (actual_qty - reserved_qty).
        row['uncommitted_stock'] = row['actual_qty'] - row['reserved_qty']
        stock_info[row['item_code']] = row
    # 2. Fetch already ordered qty from open POs (to subtract from procurement need)
    already_ordered_map = {}
   
    # SQL query for sum of (qty - received_qty) in submitted POs that are NOT 'Closed' or 'Cancelled'
    ordered_items = frappe.db.sql("""
        SELECT poi.item_code, SUM(poi.qty - COALESCE(poi.received_qty, 0)) AS already_ordered
        FROM `tabPurchase Order Item` poi
        INNER JOIN `tabPurchase Order` po ON poi.parent = po.name
        WHERE poi.item_code IN %s
            AND po.docstatus = 1
            AND po.status NOT IN ('Closed', 'Cancelled')
            AND po.company = %s /* Filtering POs by the context company */
        GROUP BY poi.item_code
    """, (item_codes, company), as_dict=True)
    for row in ordered_items:
        already_ordered_map[row['item_code']] = flt(row['already_ordered'])
   
   
    # 3. Fetch existing PO names (similarly filtering by company)
    existing_pos_data = frappe.db.sql("""
        SELECT po.name, po.supplier, poi.item_code
        FROM `tabPurchase Order Item` poi
        INNER JOIN `tabPurchase Order` po ON poi.parent = po.name
        WHERE poi.item_code IN %s
            AND po.docstatus = 1
            AND po.status NOT IN ('Closed', 'Cancelled')
            AND po.company = %s /* Filtering POs by the context company */
        ORDER BY po.creation DESC
    """, (item_codes, company), as_dict=True)
   
    existing_pos_map = {}
    for pos in existing_pos_data:
        key = pos['item_code']
        # Concatenate PO name and supplier for client side display
        po_link_text = f"{pos['name']} ({pos['supplier'] or ''})"
        existing_pos_map.setdefault(key, []).append(po_link_text)
    # 4. Enrich raw materials list
    final_materials = []
    for rm in raw_materials_list:
        item_code = rm.get('item_code')
        info = stock_info.get(item_code, {'uncommitted_stock': 0})
       
        # New Stock values based on conservative (Actual - Reserved) method:
        rm['available_qty'] = flt(info.get('uncommitted_stock', 0))
        rm['already_ordered_qty'] = flt(already_ordered_map.get(item_code, 0))
        # FIX CALCULATION: max(0, Required - Uncommitted Stock - Already Ordered/Unreceived PO)
        required = flt(rm.get('required_qty', 0))
        rm['qty_to_purchase'] = max(0, required - rm['available_qty'] - rm['already_ordered_qty'])
        # Set existing PO string (not used in merged dialog, but retained)
        rm['existing_pos'] = ', '.join(existing_pos_map.get(item_code, []))
       
        final_materials.append(rm)
    # Sort by qty_to_purchase descending for prioritization
    final_materials.sort(key=lambda x: x.get('qty_to_purchase', 0), reverse=True)
   
    return final_materials

# NEW: Server method to create MR with SO references (call this in secondary action if needed, or extend create_material_request_for_shortage)
@frappe.whitelist()
def create_material_request_with_so_references(items_data, selected_sos):
    """
    Create MR for raw materials with reference_sales_order set in MR Items.
    items_data: list of RM needing MR
    selected_sos: list of selected SOs for reference linking.
    """
    # Logic to create MR: aggregate items, set reference_sales_order = ', '.join(selected SO names) for traceability.
    # Implementation similar to existing create_material_request_for_shortage, but add:
    # In MR Item: frappe.db.set_value("Material Request Item", child.name, "reference_sales_order", ', '.join([so['sales_order'] for so in selected_sos]))
    # Return MR name.
    pass  # Placeholder - extend as per existing MR creation logic

import frappe
import json
from frappe.utils import flt

@frappe.whitelist()
def get_unified_procurement_data():
    """
    Fetches:
    1. Pending Sales Orders (Master).
    2. Exploded BOM Items for those SOs (Detail).
    3. Current Stock Levels for those BOM Items (Stock).
    4. Existing Open PO logic.
    """
    company = frappe.defaults.get_user_default("Company") or frappe.get_doc("Global Defaults").default_company
    
    # 1. Get Pending Sales Orders
    pending_sos = frappe.db.sql("""
        SELECT 
            si.parent as sales_order, si.item_code, si.item_name, si.qty,
            COALESCE(si.delivered_qty, 0) as delivered_qty,
            so.customer, si.bom_no
        FROM `tabSales Order Item` si
        INNER JOIN `tabSales Order` so ON si.parent = so.name
        WHERE so.docstatus = 1 AND so.status NOT IN ('Closed', 'Cancelled')
            AND (si.qty - COALESCE(si.delivered_qty, 0)) > 0
        ORDER BY so.transaction_date DESC
    """, as_dict=1)

    # List of distinct FG items and SOs to process
    fg_list = []
    for row in pending_sos:
        # Picked Logic (Simplified for speed: Check Pick List Item)
        picked = frappe.db.sql("""
            SELECT COALESCE(SUM(picked_qty), 0) FROM `tabPick List Item` 
            WHERE sales_order=%s AND item_code=%s AND docstatus=1
        """, (row.sales_order, row.item_code))[0][0]
        
        balance_qty = max(0, flt(row.qty) - flt(row.delivered_qty) - flt(picked))
        
        if balance_qty > 0:
            # Find BOM
            if not row.bom_no:
                row.bom_no = frappe.db.get_value("BOM", {"item": row.item_code, "is_default": 1}, "name")

            if row.bom_no:
                row.balance_qty = balance_qty
                fg_list.append(row)

    if not fg_list:
        return {"sales_orders": [], "bom_map": {}, "stock_map": {}}

    # 2. Build BOM Map (Unique BOMs)
    unique_boms = set([x.bom_no for x in fg_list])
    bom_map = {} # Key: BOM Name, Value: List of Items
    all_rm_codes = set()

    for bom in unique_boms:
        items = frappe.get_all("BOM Item", filters={"parent": bom}, 
                               fields=["item_code", "item_name", "stock_uom", "stock_qty"])
        bom_map[bom] = items
        for i in items:
            all_rm_codes.add(i.item_code)

    # 3. Get Stock & Open POs for RMs
    stock_map = {}
    if all_rm_codes:
        # Real Available = Actual - Reserved (per Company ideally via Warehouse)
        bin_data = frappe.db.sql("""
            SELECT b.item_code, 
                   SUM(b.actual_qty) as total_actual, 
                   SUM(b.reserved_qty) as total_reserved 
            FROM `tabBin` b 
            JOIN `tabWarehouse` w ON b.warehouse = w.name
            WHERE b.item_code IN %s AND w.company = %s
            GROUP BY b.item_code
        """, (list(all_rm_codes), company), as_dict=1)

        # Open POs (Ordered but not Received)
        open_po_data = frappe.db.sql("""
            SELECT poi.item_code, SUM(poi.qty - COALESCE(poi.received_qty,0)) as on_order
            FROM `tabPurchase Order Item` poi
            JOIN `tabPurchase Order` po ON poi.parent = po.name
            WHERE poi.item_code IN %s AND po.docstatus=1 AND po.status NOT IN ('Closed','Cancelled')
            GROUP BY poi.item_code
        """, (list(all_rm_codes),), as_dict=1)

        # Initialize Map
        for c in all_rm_codes:
            stock_map[c] = {"actual": 0, "reserved": 0, "available": 0, "on_order": 0}
        
        for b in bin_data:
            stock_map[b.item_code]["actual"] = flt(b.total_actual)
            stock_map[b.item_code]["reserved"] = flt(b.total_reserved)
            stock_map[b.item_code]["available"] = flt(b.total_actual) - flt(b.total_reserved)
        
        for p in open_po_data:
             stock_map[p.item_code]["on_order"] = flt(p.on_order)

    return {
        "sales_orders": fg_list,
        "bom_map": bom_map, # { bom_id: [ {item_code, qty...} ] }
        "stock_map": stock_map # { item_code: { available: 10, on_order: 5 } }
    }


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
                # print("is_subcontracted",is_subcontracted)
                # print("item",item)
                # print("qty_to_add",qty_to_add)
                # print("max_allowable_qty",max_allowable_qty)
                # print("so_item_details",so_item_details)
                # print("ordered_on_pos",ordered_on_pos)
                # print("reserved_via_pick_list",reserved_via_pick_list)
                service_item_code = "Order Charges" # Placeholder for service item logic
                
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
# --- HELPER FUNCTIONS (No changes below) ---

# def get_stock_reservations_other(sales_order, item_code):
#     if not sales_order or not item_code: return []
#     return frappe.db.get_all("Stock Reservation Entry", filters={"voucher_no": sales_order, "item_code": item_code, "docstatus": 1}, fields=["name", "reserved_qty"])

# def _get_bom_stock_details(bom_name, required_fg_qty):
#     if not bom_name or not required_fg_qty: return []
#     bom_items = frappe.db.get_all("BOM Item", filters={"parent": bom_name}, fields=["item_code", "item_name", "qty", "stock_uom"])
#     results = []
#     for item in bom_items:
#         required_qty = item.qty * required_fg_qty
#         stock_data = frappe.db.sql("SELECT SUM(actual_qty), SUM(reserved_qty) FROM `tabBin` WHERE item_code = %s", (item.item_code), as_list=True)
#         actual_qty = (stock_data[0][0] or 0)
#         reserved_qty = (stock_data[0][1] or 0)
#         results.append({ "item_code": item.item_code, "item_name": item.item_name, "required_qty": required_qty, "actual_qty": actual_qty, "reserved_qty": reserved_qty, "available_qty": actual_qty - reserved_qty, "stock_uom": item.stock_uom })
#     return results


def _get_pick_list_reserved_qty(sales_order_name, item_code):
    """
    Calculates the quantity already covered by Pick Lists (Draft/Submitted & Undelivered)
    for a specific Sales Order Item.
    """
    if not sales_order_name or not item_code:
        return 0

    # 1. Sum up Draft quantity for this SO
    draft_qty = frappe.db.sql("""
        SELECT SUM(pli.qty) 
        FROM `tabPick List Item` pli 
        JOIN `tabPick List` pl ON pl.name = pli.parent
        WHERE pli.sales_order = %(so_name)s 
          AND pli.item_code = %(item_code)s 
          AND pl.docstatus = 0
    """, {"so_name": sales_order_name, "item_code": item_code})
    draft_qty = flt(draft_qty[0][0]) if draft_qty and draft_qty[0] else 0

    # 2. Sum up Submitted & Undelivered quantity (100% - per_delivered)
    submitted_undelivered_qty = frappe.db.sql("""
        SELECT SUM(
            pli.picked_qty * (100 - IFNULL(pl.per_delivered, 0)) / 100
        )
        FROM `tabPick List Item` pli 
        JOIN `tabPick List` pl ON pl.name = pli.parent
        WHERE pli.sales_order = %(so_name)s 
          AND pli.item_code = %(item_code)s 
          AND pl.docstatus = 1
          AND pl.status != 'Completed'
    """, {"so_name": sales_order_name, "item_code": item_code})
    submitted_undelivered_qty = flt(submitted_undelivered_qty[0][0]) if submitted_undelivered_qty and submitted_undelivered_qty[0] else 0

    return draft_qty + submitted_undelivered_qty



from frappe.utils import nowdate

@frappe.whitelist()
# @frappe.db.transaction
def create_material_request_for_shortage(purchase_order_name):
    """
    Creates a Material Request of type 'Purchase' for raw materials that have a stock shortfall
    for a given subcontracting Purchase Order.
    """
    po = frappe.get_doc("Purchase Order", purchase_order_name)

    # Get the list of all required materials and their availability
    all_materials = get_required_raw_materials_for_po(purchase_order_name)

    # Filter for only the materials with a shortage
    shortage_materials = [
        item for item in all_materials if flt(item.get("available_qty")) < flt(item.get("required_qty"))
    ]

    if not shortage_materials:
        frappe.msgprint(_("No material shortage found. Material Request not created."))
        return None

    # Create the Material Request document
    mr = frappe.new_doc("Material Request")
    mr.material_request_type = "Purchase"
    mr.company = po.company
    mr.schedule_date = nowdate() # Or set based on your lead times
    # Optional: Set a warehouse where the material is required
    mr.set_warehouse = frappe.get_cached_value('Company', po.company, 'default_inventory_wh')

    # Add items that are short to the Material Request
    for item in shortage_materials:
        required_qty = flt(item.get("required_qty"))
        available_qty = flt(item.get("available_qty"))
        shortage_qty = required_qty - available_qty

        if shortage_qty > 0:
            mr.append("items", {
                "item_code": item.get("item_code"),
                "qty": shortage_qty,
                "uom": item.get("uom"),
                "warehouse": mr.set_warehouse
                # Add a reference back to the original PO
                # You might need a custom field in 'Material Request Item' for this.
                # 'custom_purchase_order_ref': po.name 
            })

    if not mr.items:
        frappe.msgprint(_("Calculated shortage quantity is zero. Material Request not created."))
        return None

    try:
        mr.insert(ignore_permissions=True)
        mr.submit()
        po.add_comment("Comment", _("Created Material Request for shortage: {0}").format(mr.name))
        return { "mr_name": mr.name }
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Material Request Creation Failed")
        frappe.throw(_("Failed to create Material Request: {0}").format(e))


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


@frappe.whitelist()
def check_for_existing_subcontracting_order(purchase_order_name):
    """
    Checks if a non-cancelled Subcontracting Order already exists for the given Purchase Order.
    Returns True if an active SCO exists, False otherwise.
    """
    exists = frappe.db.exists(
        "Subcontracting Order",
        {
            "purchase_order": purchase_order_name,
            "docstatus": ["!=", 2]  # Checks for Submitted (1) or Draft (0)
        }
    )
    return bool(exists)





from erpnext.subcontracting.doctype.subcontracting_order.subcontracting_order import make_subcontracting_receipt
from erpnext.subcontracting.doctype.subcontracting_receipt.subcontracting_receipt import make_purchase_receipt as make_purchase_receipt_from_scr
from erpnext.stock.doctype.purchase_receipt.purchase_receipt import make_purchase_invoice



@frappe.whitelist()
def get_linked_subcontracting_docs(purchase_order_name):
    """
    Finds all subcontracting documents linked to a Purchase Order and returns
    a dictionary of lists, where each item in the list is a dictionary of details.
    This version ensures that each document appears only once.
    """
    docs = {"sco": [], "ste": [], "scr": [], "pr": [], "pi": []}

    # 1. Get unique Subcontracting Order (SCO) names first, then their details
    sco_names = frappe.db.get_all(
        "Subcontracting Order",
        filters={"purchase_order": purchase_order_name, "docstatus": 1},
        pluck="name",
        distinct=True
    )
    if sco_names:
        docs["sco"] = frappe.db.get_all(
            "Subcontracting Order",
            filters={"name": ["in", sco_names]},
            fields=["name", "transaction_date", "total", "status"],
        )

        # 2. Get unique Material Transfer (STE) names, then their details
        ste_names = frappe.db.get_all(
            "Stock Entry",
            filters={"subcontracting_order": ["in", sco_names], "docstatus": 1},
            pluck="name",
            distinct=True
        )
        if ste_names:
            docs["ste"] = frappe.db.get_all(
                "Stock Entry",
                filters={"name": ["in", ste_names]},
                fields=["name", "posting_date", "stock_entry_type"],
            )

        # 3. Get unique Subcontracting Receipt (SCR) names, then their details
        scr_names = frappe.db.get_all(
            "Subcontracting Receipt",
            filters={"subcontracting_order": ["in", sco_names], "docstatus": 1},
            pluck="name",
            distinct=True
        )
        if scr_names:
            docs["scr"] = frappe.db.get_all(
                "Subcontracting Receipt",
                filters={"name": ["in", scr_names]},
                fields=["name", "posting_date", "status"],
            )

    # 4. Get unique Purchase Receipt (PR) names, then their details
    pr_names = frappe.db.get_all(
        "Purchase Receipt Item", filters={"purchase_order": purchase_order_name},
        pluck="parent", distinct=True
    )
    if pr_names:
        pr_names = frappe.db.get_all(
            "Purchase Receipt", filters={"name": ["in", pr_names], "docstatus": 1},
            pluck="name", distinct=True
        )
        if pr_names:
            docs["pr"] = frappe.db.get_all(
                "Purchase Receipt",
                filters={"name": ["in", pr_names]},
                fields=["name", "posting_date", "rounded_total", "status"],
            )

    # 5. Get unique Purchase Invoice (PI) names, then their details
    pi_names = frappe.db.get_all(
        "Purchase Invoice Item", filters={"purchase_order": purchase_order_name},
        pluck="parent", distinct=True
    )
    if pi_names:
        pi_names = frappe.db.get_all(
            "Purchase Invoice", filters={"name": ["in", pi_names], "docstatus": 1},
            pluck="name", distinct=True
        )
        if pi_names:
            docs["pi"] = frappe.db.get_all(
                "Purchase Invoice",
                filters={"name": ["in", pi_names]},
                fields=["name", "posting_date", "rounded_total", "due_date", "status"],
            )

    return docs




@frappe.whitelist()
def get_pending_so_with_raw_materials(selected_so_items_json=None): # MODIFIED: Added selected_so_items_json argument
    """
    Fetches, aggregates, and validates raw materials required for pending sales order items.
    Now filters based on selected_so_items_json if provided.
    """
    
    # NEW: Handle filtering based on selected SO items if provided
    selected_so_items = []
    if selected_so_items_json:
        import json
        selected_so_items = json.loads(selected_so_items_json)
        # Create a map for quick lookup: { (so_name, item_code): {pending_qty, bom} }
        selected_map = { 
            (item["sales_order"], item["item_code"]): {
                "pending_qty": flt(item["pending_qty"]),
                "bom": item.get("bom")
            }
            for item in selected_so_items 
        }
        so_names = list(set(item["sales_order"] for item in selected_so_items))
    
    aggregated_materials = defaultdict(lambda: {
        "required_qty": 0,
        "sales_orders": set(),
        "customers": set(),
    })

    # Get submitted Sales Orders that are not yet completed
    so_filters = {"status": ["not in", ["Completed", "Closed", "Cancelled"]], "docstatus": 1}
    if selected_so_items_json:
        so_filters["name"] = ["in", so_names] # Filter by selected SOs

    pending_sales_orders = frappe.get_all("Sales Order",
        filters=so_filters,
        fields=["name", "customer"]
    )
    if not pending_sales_orders:
        return []

    so_customer_map = {so.name: so.customer for so in pending_sales_orders}
    
    # Get Sales Order Items that are not fully delivered
    so_item_filters = {
        "parent": ["in", list(so_customer_map.keys())],
        "qty": [">", 0]
    }

    sales_order_items = frappe.get_all("Sales Order Item",
        filters=so_item_filters,
        fields=["parent", "item_code", "item_name", "qty", "delivered_qty", "bom_no"]
    )
    
    # NEW: Filter sales_order_items to only include selected ones if selected_map exists
    if selected_so_items_json:
        sales_order_items = [
            item for item in sales_order_items 
            if (item.parent, item.item_code) in selected_map
        ]
        
    if not sales_order_items:
        return []

    # Pre-fetch default BOMs to reduce DB calls
    fg_item_codes = list(set(item.item_code for item in sales_order_items))
    default_bom_map = {
        item.name: item.default_bom 
        for item in frappe.get_all("Item", filters={"name": ["in", fg_item_codes]}, fields=["name", "default_bom"]) 
        if item.default_bom
    }
    
    # Collect all BOMs we need to check
    boms_to_check = list(set(
        item.bom_no or default_bom_map.get(item.item_code)
        for item in sales_order_items
        if item.bom_no or default_bom_map.get(item.item_code)
    ))
    
    # Pre-fetch all BOM materials in a single query for efficiency
    bom_item_map = get_bom_materials_map(boms_to_check)

    # Process each sales order item and aggregate its raw materials
    for item in sales_order_items:
        # Determine the quantity for calculation and the correct BOM
        if selected_so_items_json:
            # If selected, use the pending_qty from the client selection
            selected_item_info = selected_map.get((item.parent, item.item_code))
            pending_fg_qty = selected_item_info["pending_qty"]
            # Use the BOM from selection (if set) or fall back to item.bom_no / default_bom
            bom_name = selected_item_info["bom"] or item.bom_no or default_bom_map.get(item.item_code)
        else:
            # Original flow: calculate pending_qty from the item document
            pending_fg_qty = flt(item.qty) - flt(item.delivered_qty)
            bom_name = item.bom_no or default_bom_map.get(item.item_code)

        if not bom_name:
            continue
            
        if pending_fg_qty <= 0:
            continue

        for material in bom_item_map.get(bom_name, []):
            required_qty = flt(material.qty_per_unit) * pending_fg_qty
            if required_qty <= 0:
                continue

            agg_data = aggregated_materials[material.item_code]

            if "item_name" not in agg_data: # Set static data on first encounter
                agg_data["item_name"] = material.item_name
                agg_data["uom"] = material.uom
            
            agg_data["required_qty"] += required_qty
            agg_data["sales_orders"].add(item.parent)
            agg_data["customers"].add(so_customer_map.get(item.parent))
    
    if not aggregated_materials:
        return []

    # --- NEW: Check for quantities in open Purchase Orders ---
    all_raw_material_codes = list(aggregated_materials.keys())
    stock_levels = get_stock_levels(all_raw_material_codes)
    open_po_data = get_open_po_quantities(all_raw_material_codes)

    # Final formatting of the response list
    final_list = []
    for item_code, data in aggregated_materials.items():
        available_qty = stock_levels.get(item_code, 0.0)
        already_ordered = open_po_data.get(item_code, {}).get("total_ordered", 0.0)
        po_details = open_po_data.get(item_code, {}).get("po_details", [])

        # The core calculation: Required - Available - Already Ordered
        qty_to_purchase = max(0, flt(data["required_qty"]) - flt(available_qty) - flt(already_ordered))
        
        final_list.append({
            "item_code": item_code,
            "item_name": data["item_name"],
            "uom": data["uom"],
            "required_qty": round(data["required_qty"], 3),
            "available_qty": available_qty,
            # NEW fields to be sent to the client
            "already_ordered_qty": round(already_ordered, 3), 
            "existing_pos": ", ".join(po_details), 
            "qty_to_purchase": round(qty_to_purchase, 3),
            "sales_orders": ", ".join(sorted(list(data["sales_orders"]))),
            "customers": ", ".join(sorted(list(filter(None, data["customers"]))))
        })
    
    return sorted(final_list, key=lambda x: x['item_name'])

# --- HELPER FUNCTIONS ---

def get_bom_materials_map(bom_names):
    """Fetches all BOM items and returns them mapped by parent BOM name."""
    if not bom_names:
        return {}
    bom_items = frappe.get_all("BOM Item",
        filters={"parent": ["in", bom_names]},
        fields=["parent", "item_code", "item_name", "qty as qty_per_unit", "uom"]
    )
    bom_map = defaultdict(list)
    for item in bom_items:
        bom_map[item.parent].append(item)
    return bom_map

def get_stock_levels(item_codes):
    """Fetch total actual quantity for a list of items."""
    if not item_codes:
        return {}
    stock_data = frappe.get_all("Bin",
        filters={"item_code": ["in", item_codes]},
        fields=["item_code", "actual_qty"]
    )
    stock_dict = defaultdict(float)
    for entry in stock_data:
        stock_dict[entry.item_code] += flt(entry.actual_qty)
    return stock_dict

def get_open_po_quantities(item_codes):
    """
    For a list of item codes, finds the total pending quantity 
    in submitted, non-received Purchase Orders.
    """
    if not item_codes:
        return {}

    open_po_items = frappe.db.sql("""
        SELECT
            poi.item_code,
            poi.parent, -- PO Name
            (poi.qty - poi.received_qty) as pending_qty,
            po.supplier
        FROM
            `tabPurchase Order Item` as poi
        JOIN
            `tabPurchase Order` as po ON poi.parent = po.name
        WHERE
            poi.item_code IN %(item_codes)s
            AND po.docstatus = 1
            AND po.per_received < 100
    """, {"item_codes": item_codes}, as_dict=1)

    po_data = defaultdict(lambda: {"total_ordered": 0, "po_details": set()})
    for item in open_po_items:
        if item.pending_qty > 0.001:
            po_data[item.item_code]["total_ordered"] += item.pending_qty
            # Add both PO name and Supplier for better context
            po_data[item.item_code]["po_details"].add(f"{item.parent} ({item.supplier or 'N/A'})")
    
    for item_code in po_data:
        po_data[item_code]["po_details"] = sorted(list(po_data[item_code]["po_details"]))
        
    return po_data
















################# delivery note#####################




import frappe
from frappe import _

@frappe.whitelist()
def get_eligible_pick_lists_for_so(sales_order):
    """
    Retrieves all Pick Lists linked to a Sales Order that are submitted 
    and have an unfulfilled quantity, using only Pick List Item fields.
    """
    
    # 1. Fetch relevant Pick Lists (Header Data - only non-quantity fields)
    pick_lists = frappe.get_all(
        'Pick List',
        filters={'sales_order': sales_order, 'docstatus': ('in', [0, 1])}, # Draft or Submitted
        # IMPORTANT: Remove 'picked_qty' and 'delivered_qty' from the header query!
        fields=['name', 'docstatus'], 
        order_by='docstatus desc, name desc',
        as_list=0
    )

    eligible_pick_lists = []

    for pl_header in pick_lists:
        pl_name = pl_header.get('name')
        
        # 2. Fetch Pick List Items and all necessary quantities
        pl_items = frappe.get_all(
            'Pick List Item',
            filters={
                'parent': pl_name,
                # Filter only by status (docstatus on the Pick List) if not delivered 
                # Docstatus is handled by the parent loop for visibility.
                'qty': ['>', 'delivered_qty'] # Crucially, filter for QTY > delivered_qty (still pending)
            },
            fields=[
                'name', 'item_code', 'item_name', 'warehouse', 
                'qty as picked_qty',           # Qty column in PL Item holds the quantity to be picked/reserved
                'delivered_qty', 
                'uom', 
                'parent as pick_list_name', 
                'parenttype', 
                'docstatus as pl_item_docstatus', # This field doesn't exist but serves as a reminder to link if it did
                'sales_order_item'               # The SO child row name
            ],
            as_list=0
        )
        
        pl_header['items'] = []
        pl_header['total_picked_qty'] = 0.0 # Renamed for clarity vs. header fields
        pl_header['total_delivered_qty'] = 0.0
        pl_header['total_pending_qty'] = 0.0
        
        has_submitted_pending = False
        
        for pl_item in pl_items:
            pl_item_picked_qty = pl_item['picked_qty'] or 0.0
            pl_item_delivered_qty = pl_item['delivered_qty'] or 0.0
            
            pl_item['pending_qty'] = pl_item_picked_qty - pl_item_delivered_qty
            
            # NOTE: We can't query parent docstatus inside a child query easily. 
            # We rely on the parent docstatus fetched in step 1: pl_header['docstatus']

            # If it's a Submitted PL (docstatus = 1) and there's a quantity pending
            if pl_header['docstatus'] == 1 and pl_item['pending_qty'] > 0: 
                 pl_header['items'].append(pl_item)
                 pl_header['total_picked_qty'] += pl_item_picked_qty
                 pl_header['total_delivered_qty'] += pl_item_delivered_qty
                 pl_header['total_pending_qty'] += pl_item['pending_qty']
                 has_submitted_pending = True
            
            # For Draft PLs (docstatus = 0), include the item for transparency 
            # but mark pending QTY as effectively 0 on the client side display/checkbox
            elif pl_header['docstatus'] == 0:
                 # NOTE: Client will filter these items if checkbox logic relies on total_pending_qty
                 pl_item['pending_qty'] = pl_item['picked_qty'] # Set to 'picked' for disabled list total visual
                 pl_header['items'].append(pl_item)
            # Cancelled PLs are automatically filtered out by 'qty > delivered_qty' check or header docstatus != 2


        # 3. Only keep the PL header if it is submitted and has at least one pending item.
        if has_submitted_pending:
            # Transfer aggregated totals back to top level for client consumption
            pl_header['picked_qty'] = pl_header.pop('total_picked_qty')
            pl_header['delivered_qty'] = pl_header.pop('total_delivered_qty')
            pl_header['pending_qty'] = pl_header.pop('total_pending_qty')
            
            eligible_pick_lists.append(pl_header)
            
    # 4. Fetch necessary header data for the Delivery Note
    # Assuming 'default_shipping_address' covers 'customer_address' in this version
    customer_data = frappe.db.get_value(
        "Sales Order", 
        sales_order, 
        ["customer_name",  "company", "currency", "conversion_rate",  "party_account_currency", "default_billing_address", "default_shipping_address"],
        as_dict=True
    )

    return {"pick_lists": eligible_pick_lists, "customer_data": customer_data}





    
# @frappe.whitelist(allow_guest=True)
# def biomentric_login(employee_code=None,employee_name=None, log_datetime=None,log_date=None, log_time=None, downloaded_at=None, device_sn=None,device_name=None,device_no=None):
#     import json

#     # ---------------------------------
#     # 1. Read JSON body (POST body)
#     # ---------------------------------
#     try:
#         body_data = json.loads(frappe.request.data) if frappe.request.data else {}
#     except:
#         body_data = {}

#     # ---------------------------------
#     # 2. Read Query String parameters
#     # ---------------------------------
#     query_data = {
#         "employee_code": employee_code,
#         "log_datetime": log_datetime,
#         "log_time": log_time,
#         "downloaded_at": downloaded_at,
#         "device_sn": device_sn
#     }

#     # ---------------------------------
#     # 3. Merge both sources
#     # Body has higher priority
#     # ---------------------------------
#     final_data = {**query_data, **body_data}

#     # Clean empty keys
#     final_data = {k: v for k, v in final_data.items() if v not in [None, "", "null"]}

#     # ---------------------------------
#     # 4. Log everything for debugging
#     # ---------------------------------
#     frappe.log_error(
#         title="Biometric Login Received",
#         message=frappe.as_json(final_data)
#     )

#     # ---------------------------------
#     # 5. Return back clean response
#     # ---------------------------------
#     return {
#         "status": "success",
#         "message": "Biometric data received",
#         "data": final_data
#     }


@frappe.whitelist(allow_guest=True)
def biomentric_login(employee_code=None, employee_name=None, log_datetime=None,
                     log_date=None, log_time=None, downloaded_at=None,
                     device_sn=None, device_name=None, device_no=None):
    import json
    import frappe
    from frappe.utils import now_datetime

    # -------------------------------
    # 1. Parse JSON Body
    # -------------------------------
    try:
        body_data = json.loads(frappe.request.data) if frappe.request.data else {}
    except Exception as e:
        frappe.log_error("Biometric Error - Invalid JSON", frappe.get_traceback())
        body_data = {}

    # -------------------------------
    # 2. Query Params
    # -------------------------------
    query_data = {
        "employee_code": employee_code,
        "log_datetime": log_datetime,
        "log_time": log_time,
        "downloaded_at": downloaded_at,
        "device_sn": device_sn,
        "device_no": device_no,
        "device_name": device_name,
    }

    # Merge body + query (body wins)
    final_data = {**query_data, **body_data}
    final_data = {k: v for k, v in final_data.items() if v not in [None, "", "null"]}

    frappe.log_error("Biometric Login Received", frappe.as_json(final_data))

    # =====================================================
    # NEGATIVE CASE 1: employee_code missing
    # =====================================================
    if not final_data.get("employee_code"):
        frappe.log_error(
            "Biometric Error - Missing Employee Code",
            frappe.as_json(final_data)
        )
        return {"status": "failed", "message": "Employee code missing"}

    # =====================================================
    # 3. Find Employee by attendance_device_id
    # =====================================================
    emp, status = frappe.db.get_value(
        "Employee",
        {"attendance_device_id": final_data.get("employee_code")},
        ["name", "status"],
        as_dict=False,
    ) or (None, None)

    # NEGATIVE CASE 2: No employee found
    if not emp:
        frappe.log_error(
            "Biometric Error - Employee Not Found",
            f"Employee Code: {final_data.get('employee_code')}"
        )
        return {"status": "failed", "message": "Employee not found"}

    # NEGATIVE CASE 3: Employee not Active
    if status != "Active":
        frappe.log_error(
            "Biometric Error - Employee Not Active",
            f"Employee: {emp}, Status: {status}"
        )
        return {"status": "failed", "message": "Employee is not active"}

    # =====================================================
    # 4. Determine Log Datetime
    # =====================================================
    log_dt = final_data.get("log_datetime") or now_datetime()

    # =====================================================
    # 5. Get Last Checkin → Determine IN/OUT
    # =====================================================
    last_log_type = frappe.db.get_value(
        "Employee Checkin",
        {"employee": emp},
        "log_type",
        order_by="time DESC"
    )

    new_log_type = "OUT" if last_log_type == "IN" else "IN"

    # =====================================================
    # 6. Create Employee Checkin
    # =====================================================
    try:
        checkin = frappe.get_doc({
            "doctype": "Employee Checkin",
            "employee": emp,
            "log_type": new_log_type,
            "time": log_dt,
            "device_id": final_data.get("device_no")
        })
        checkin.insert(ignore_permissions=True)
        frappe.db.commit()

        return {
            "status": "success",
            "message": f"Check-in created ({new_log_type})",
            "employee": emp,
            "log_type": new_log_type,
            "time": log_dt
        }

    except Exception as e:
        frappe.log_error(
            "Biometric Checkin Error - Insert Failed",
            frappe.get_traceback()
        )
        return {"status": "error", "message": "Failed to create check-in"}




import frappe
from frappe.utils import add_days, flt, getdate

def sales_order_before_insert(doc, method):
    """
    This runs BEFORE the ERPNext validation. 
    It wipes the 'Quotation' dates and replaces them with 'Sales Order' dates.
    """
    if doc.payment_terms_template:
        # 1. Fetch the template details manually
        template_terms = frappe.get_all(
            "Payment Terms Template Detail", 
            filters={"parent": doc.payment_terms_template},
            fields=["payment_term", "description", "invoice_portion", "credit_days", "discount_type", "discount"]
        )

        if not template_terms:
            return

        # 2. COMPLETELY CLEAR the table copied from the Quotation
        doc.set("payment_schedule", [])

        # 3. Re-calculate everything based on the Sales Order Date (doc.transaction_date)
        total_amount = flt(doc.grand_total)
        
        for term in template_terms:
            # Calculate new due date relative to the Sales Order
            new_due_date = add_days(doc.transaction_date, term.credit_days)
            
            # Calculate payment amount for this row
            amt = total_amount * (flt(term.invoice_portion) / 100.0)
            
            # Append the fresh row
            doc.append("payment_schedule", {
                "payment_term": term.payment_term,
                "description": term.description,
                "invoice_portion": term.invoice_portion,
                "credit_days": term.credit_days,
                "due_date": new_due_date,
                "payment_amount": amt,
                "base_payment_amount": amt * flt(doc.conversion_rate or 1),
                "discount_type": term.discount_type,
                "discount": term.discount
            })

        # 4. Rounding adjustment to make sure total matches exactly
        fix_rounding(doc)

def fix_rounding(doc):
    if not doc.payment_schedule:
        return
    scheduled_total = sum(flt(d.payment_amount) for d in doc.payment_schedule)
    diff = flt(doc.grand_total) - scheduled_total
    if diff != 0:
        doc.payment_schedule[-1].payment_amount += diff
        doc.payment_schedule[-1].base_payment_amount = doc.payment_schedule[-1].payment_amount * flt(doc.conversion_rate or 1)

import frappe
from frappe import _
import json
from frappe.utils import flt

@frappe.whitelist()
def get_job_work_dashboard_data(sales_order_name, supplier=None):
    sales_order = frappe.get_doc("Sales Order", sales_order_name)
    warehouse = sales_order.set_warehouse or "Finished Goods - D" 
    
    # 1. CONSOLIDATE SO ITEMS (Group by Item Code)
    # This prevents the same item from appearing twice if it was added in two SO rows
    so_items_consolidated = {}
    for item in sales_order.items:
        ic = item.item_code
        if ic not in so_items_consolidated:
            so_items_consolidated[ic] = {
                "item_code": ic,
                "item_name": item.item_name,
                "ordered_qty": 0.0
            }
        so_items_consolidated[ic]["ordered_qty"] += flt(item.qty)

    item_codes = list(so_items_consolidated.keys())
    
    # 2. Get Live Stock (Bin)
    stock_dict = {}
    if item_codes:
        stock_map = frappe.get_all("Bin", 
            filters={"item_code": ["in", item_codes], "warehouse": warehouse}, 
            fields=["item_code", "actual_qty"])
        stock_dict = {d.item_code: flt(d.actual_qty) for d in stock_map}

    # 3. Get History from EWOs
    sql_history = """
        SELECT child.item_code, child.pending_qty, child.received_qty, parent.full_piece_jobber
        FROM `tabEmbroidery Work Order Item` child
        INNER JOIN `tabEmbroidery Work Order` parent ON parent.name = child.parent
        WHERE parent.saels_order_id = %s
            AND parent.work_type = 'Full Piece Job Work'
            AND parent.docstatus = 1
    """
    history_logs = frappe.db.sql(sql_history, (sales_order_name), as_dict=True)

    history_tracking = {}
    for log in history_logs:
        ic = log.item_code
        if ic not in history_tracking:
            history_tracking[ic] = {"total_sent": 0.0, "total_received": 0.0, "total_pending": 0.0, "locations": []}
        
        # Historical metrics
        history_tracking[ic]["total_sent"] += (flt(log.pending_qty) + flt(log.received_qty))
        history_tracking[ic]["total_received"] += flt(log.received_qty)
        
        qty_pending = flt(log.pending_qty)
        if qty_pending > 0:
            history_tracking[ic]["total_pending"] += qty_pending
            j_name = frappe.db.get_value("Supplier", log.full_piece_jobber, "supplier_name") or log.full_piece_jobber
            
            existing_loc = next((l for l in history_tracking[ic]["locations"] if l['id'] == log.full_piece_jobber), None)
            if existing_loc:
                existing_loc['qty'] += qty_pending
            else:
                history_tracking[ic]["locations"].append({"id": log.full_piece_jobber, "name": j_name, "qty": qty_pending})

    # 4. Final Data Assembly (Unique Rows)
    result_data = []
    for ic, row in so_items_consolidated.items():
        hist = history_tracking.get(ic, {"total_sent": 0.0, "total_received": 0.0, "total_pending": 0.0, "locations": []})
        ordered_qty = row["ordered_qty"]
        stock_avail = stock_dict.get(ic, 0.0)
        
        # Status Logic
        can_still_send = max(0, ordered_qty - hist["total_sent"])
        
        status = "Available"
        if hist["total_received"] >= ordered_qty:
            status = "Completed"
        elif can_still_send <= 0 and hist["total_pending"] > 0:
            status = "Process Active"
        elif stock_avail <= 0 and can_still_send > 0:
            status = "Out of Stock"

        result_data.append({
            "item_code": ic,
            "item_name": row["item_name"],
            "ordered_qty": ordered_qty,
            "stock_avail": stock_avail,
            "locations_display": "<br>".join([f"{l['name']} ({int(l['qty'])})" for l in hist["locations"]]), 
            "jobbers_search_text": ", ".join([l['name'] for l in hist["locations"]]),
            "max_sendable": min(can_still_send, stock_avail),
            "max_receivable": hist["total_pending"],
            "status": status
        })
        
    return result_data
import frappe
from frappe import _
import json
from frappe.utils import flt, now_datetime, format_datetime

@frappe.whitelist()
def process_job_work_action(sales_order_name, items_json, supplier=None, notes=None, attachment=None):
    items = json.loads(items_json)
    timestamp = format_datetime(now_datetime(), "dd-MM-yyyy HH:mm")
    formatted_new_note = f"[{timestamp}] {notes}" if notes else ""
    
    touched_work_orders = []

    # 1. SEND ACTION (Create NEW EWO)
    send_rows = [r for r in items if flt(r.get('send_qty')) > 0]
    if send_rows:
        if not supplier:
            frappe.throw(_("Destination Jobber is required when Sending stock."))
            
        doc = frappe.new_doc("Embroidery Work Order")
        doc.update({
            "saels_order_id": sales_order_name,
            "full_piece_jobber": supplier, 
            "work_type": "Full Piece Job Work",
            "full_piece_stage": "Sent to Full Piece Jobber",
            "notes": formatted_new_note,
            "items": []
        })

        for r in send_rows:
            # FIX: We use 'send_qty' for EVERYTHING in this row
            # so the EWO strictly reflects the amount you just entered
            qty_to_send = flt(r['send_qty'])
            doc.append("items", {
                "item_code": r['item_code'],
                "ordered_qty": qty_to_send, # Quantity entered in box
                "pending_qty": qty_to_send, # Same amount
                "received_qty": 0
            })

        doc.insert().submit()
        touched_work_orders.append(doc.name)

    # 2. RECEIVE ACTION (FIFO FIFO)
    recv_rows = [r for r in items if flt(r.get('receive_qty')) > 0]
    for r in recv_rows:
        qty_rem = flt(r.get('receive_qty'))
        p_data = frappe.db.sql("""
            SELECT child.name, child.parent, child.pending_qty FROM `tabEmbroidery Work Order Item` child
            INNER JOIN `tabEmbroidery Work Order` parent ON child.parent = parent.name
            WHERE parent.saels_order_id = %s AND child.item_code = %s AND child.pending_qty > 0 AND parent.docstatus = 1
            ORDER BY parent.creation ASC""", (sales_order_name, r['item_code']), as_dict=True)

        for p in p_data:
            if qty_rem <= 0: break
            take = min(qty_rem, flt(p.pending_qty))
            
            # Using db_set logic to avoid loading complex docs unnecessarily
            new_recv = flt(frappe.db.get_value("Embroidery Work Order Item", p.name, "received_qty")) + take
            new_pend = flt(p.pending_qty) - take
            
            frappe.db.set_value("Embroidery Work Order Item", p.name, {
                "received_qty": new_recv,
                "pending_qty": new_pend
            }, update_modified=False)

            # Update EWO Parent State
            if new_pend == 0:
                frappe.db.set_value("Embroidery Work Order", p.parent, "full_piece_stage", "Received")
            
            if p.parent not in touched_work_orders:
                touched_work_orders.append(p.parent)
                if notes:
                    orig = frappe.db.get_value("Embroidery Work Order", p.parent, "notes") or ""
                    new_n = (orig + "\n" + formatted_new_note) if orig else formatted_new_note
                    frappe.db.set_value("Embroidery Work Order", p.parent, "notes", new_n)
            
            qty_rem -= take

    # 3. ATTACHMENT
    if attachment and touched_work_orders:
        for ewo in touched_work_orders:
            if not frappe.db.exists("File", {"file_url": attachment, "attached_to_name": ewo}):
                frappe.get_doc({
                    "doctype": "File", "file_url": attachment, 
                    "attached_to_doctype": "Embroidery Work Order",
                    "attached_to_name": ewo, "is_private": 1
                }).insert(ignore_permissions=True)

    return True




def validate_non_zero_rate(doc, method):
    """
    Central validation hook to prevent 0 rate items.
    Attached to: Sales Order, Sales Invoice, Purchase Order, Purchase Invoice, etc.
    """
    # 1. Check if the document has an 'items' table
    if not hasattr(doc, "items"):
        return
 
    # 2. Iterate through the items
    for row in doc.items:
        # We check strictly if rate is 0 or negative. 
        # We use (row.rate or 0.0) to handle cases where rate might be None
        if (row.rate or 0.0) <= 0.0:

 
            # 3. Throw the blocker
            frappe.throw(
                msg=_(f"Row #{row.idx}: Rate cannot be zero for Item <b>{row.item_code}</b>."),
                title=_("Validation Error")
            )
import frappe

@frappe.whitelist()
def get_order_stock_analysis(sales_order_name):
    so = frappe.get_doc('Sales Order', sales_order_name)
    
    # ---------------------------------------------
    # 1. FETCH MR DATA
    # ---------------------------------------------
    mr_dict = {}
    mri_db_links = frappe.db.sql("""
        SELECT 
            child.parent as name, child.item_code, child.warehouse,
            child.qty, child.ordered_qty, parent.docstatus, parent.status
        FROM `tabMaterial Request Item` child
        INNER JOIN `tabMaterial Request` parent ON child.parent = parent.name
        WHERE child.sales_order = %s AND parent.docstatus < 2
    """, (so.name,), as_dict=True)
    
    for mr in mri_db_links:
        mr_key = (mr.item_code, mr.warehouse)
        if mr_key not in mr_dict:
            mr_dict[mr_key] = {'qty_pending_math': 0.0, 'docs': {}}
        pending_val = max(float(mr.qty) - float(mr.ordered_qty), 0)
        mr_dict[mr_key]['qty_pending_math'] += pending_val
        mr_dict[mr_key]['docs'][mr.name] = {'docstatus': mr.docstatus, 'status': mr.status}

    # ---------------------------------------------
    # 2. FINISHED GOODS AGGREGATION (Grouping by BOM)
    # ---------------------------------------------
    aggregated_finished = {}

    for item in so.items:
        # We group by Item, Warehouse, AND the specific BOM selected in the SO row
        key = (item.item_code, item.warehouse, item.bom_no or "")
        
        if key not in aggregated_finished:
            # Check Pick Lists
            picks = frappe.db.sql("""
                SELECT pl.docstatus, SUM(pli.qty) as qty
                FROM `tabPick List Item` pli
                INNER JOIN `tabPick List` pl ON pli.parent = pl.name
                WHERE pli.sales_order = %s AND pli.item_code = %s 
                  AND pli.warehouse = %s AND pl.docstatus < 2
                GROUP BY pl.docstatus
            """, (so.name, item.item_code, item.warehouse), as_dict=True)

            p_draft = sum(float(p.qty) for p in picks if p.docstatus == 0)
            p_sub = sum(float(p.qty) for p in picks if p.docstatus == 1)
            actual_qty = frappe.db.get_value('Bin', {'item_code': item.item_code, 'warehouse': item.warehouse}, 'actual_qty') or 0.0
            
            aggregated_finished[key] = {
                'item_code': item.item_code,
                'warehouse': item.warehouse,
                'bom_no': item.bom_no, # Taken directly from SO line
                'has_bom': True if item.bom_no else False, # Logical check based on SO line
                'qty_order': 0.0,
                'picked_draft': p_draft,
                'picked_submitted': p_sub,
                'available': actual_qty,
                'uom': item.uom,
                'row_count': 0 
            }
        
        aggregated_finished[key]['qty_order'] += item.qty
        aggregated_finished[key]['row_count'] += 1

    finished_items_list = []
    total_raw_demand = {}

    for key, val in aggregated_finished.items():
        mr_lookup_key = (val['item_code'], val['warehouse'])
        mr_metadata = mr_dict.get(mr_lookup_key, {'qty_pending_math': 0.0, 'docs': {}})
        
        bom_base_demand = max(val['qty_order'] - val['picked_draft'] - val['picked_submitted'], 0)
        fg_display_shortage = max(bom_base_demand - mr_metadata['qty_pending_math'], 0)
        mr_link_data = [{'name': n, 'docstatus': i['docstatus'], 'status': i['status']} for n, i in mr_metadata['docs'].items()]

        val.update({
            'mr_qty_display': mr_metadata['qty_pending_math'],
            'mr_links': mr_link_data,
            'shortage': fg_display_shortage,
            'is_combined': val['row_count'] > 1
        })
        finished_items_list.append(val)

        # EXPLOSION ONLY IF item.bom_no WAS IN SALES ORDER
        if bom_base_demand > 0 and val['bom_no']:
            bom_doc = frappe.get_doc('BOM', val['bom_no'])
            factor = float(bom_base_demand) / float(bom_doc.quantity)
            exploded = frappe.get_all('BOM Explosion Item', 
                filters={'parent': val['bom_no']}, 
                fields=['item_code', 'stock_qty', 'stock_uom', 'source_warehouse'])

            for exp in exploded:
                rm_wh = exp.source_warehouse or val['warehouse']
                rm_key = f"{exp.item_code}%%{rm_wh}"
                if rm_key not in total_raw_demand:
                    total_raw_demand[rm_key] = {'item_code': exp.item_code, 'qty_needed': 0, 'warehouse': rm_wh, 'uom': exp.stock_uom}
                total_raw_demand[rm_key]['qty_needed'] += (exp.stock_qty * factor)

    # 3. Final Raw Materials Compilation
    final_raw_materials = []
    for rm_key_str, data in total_raw_demand.items():
        rm_actual = frappe.db.get_value('Bin', {'item_code': data['item_code'], 'warehouse': data['warehouse']}, 'actual_qty') or 0.0
        mr_lookup_key = (data['item_code'], data['warehouse'])
        rm_mr_tracking = mr_dict.get(mr_lookup_key, {'qty_pending_math': 0.0, 'docs': {}})
        
        final_raw_materials.append({
            'item_code': data['item_code'], 'warehouse': data['warehouse'], 'uom': data['uom'],
            'available': rm_actual, 'mr_qty_display': rm_mr_tracking['qty_pending_math'],
            'mr_links': [{'name': n, 'docstatus': i['docstatus'], 'status': i['status']} for n, i in rm_mr_tracking['docs'].items()],
            'qty_needed': data['qty_needed'],
            'shortage': max(data['qty_needed'] - rm_actual - rm_mr_tracking['qty_pending_math'], 0)
        })

    return {'finished': finished_items_list, 'raw': final_raw_materials}
import frappe
from frappe.utils import flt

# @frappe.whitelist()
# def fetch_multi_order_requirements():
#     # 1. Fetch pending Sales Order items
#     so_items_raw = frappe.db.sql("""
#         SELECT 
#             so.name as so_id, so.customer, so.customer_name, 
#             so_item.item_code, so_item.warehouse, so_item.qty, 
#             so_item.bom_no, so_item.uom, so.delivery_date
#         FROM `tabSales Order` so
#         INNER JOIN `tabSales Order Item` so_item ON so_item.parent = so.name
#         WHERE so.docstatus = 1 
#           AND so.status NOT IN ('Completed', 'Closed', 'Cancelled')
#           AND so_item.qty > so_item.delivered_qty
#     """, as_dict=True)

#     # 2. Pre-fetch Open MR Supply (Any unfulfilled Material Request items in the system)
#     # This covers both Purchase and Manufacture MRs that haven't turned into POs or Work Orders yet
#     mr_supply_query = frappe.db.sql("""
#         SELECT child.item_code, child.warehouse, SUM(child.qty - child.ordered_qty) as open_qty
#         FROM `tabMaterial Request Item` child
#         INNER JOIN `tabMaterial Request` parent ON child.parent = parent.name
#         WHERE parent.docstatus < 2
#         GROUP BY child.item_code, child.warehouse
#     """, as_dict=True)
    
#     mr_supply_map = {(d.item_code, d.warehouse): flt(d.open_qty) for d in mr_supply_query}

#     aggregated_so_data = {}
#     rm_aggregation = {}

#     for row in so_items_raw:
#         key = (row.so_id, row.item_code, row.warehouse, row.bom_no or "")

#         if key not in aggregated_so_data:
#             actual_stock = frappe.db.get_value("Bin", {"item_code": row.item_code, "warehouse": row.warehouse}, "actual_qty") or 0.0
            
#             picked_qty = flt(frappe.db.sql("""
#                 SELECT SUM(pli.qty) FROM `tabPick List Item` pli
#                 INNER JOIN `tabPick List` pl ON pli.parent = pl.name
#                 WHERE pli.sales_order = %s AND pli.item_code = %s AND pli.warehouse = %s AND pl.docstatus < 2
#             """, (row.so_id, row.item_code, row.warehouse))[0][0])

#             # Individual SO level MR links
#             mr_rows = frappe.db.sql("""
#                 SELECT child.parent as name, parent.status, parent.docstatus, child.qty, child.ordered_qty
#                 FROM `tabMaterial Request Item` child
#                 INNER JOIN `tabMaterial Request` parent ON child.parent = parent.name
#                 WHERE child.sales_order = %s AND child.item_code = %s AND parent.docstatus < 2
#             """, (row.so_id, row.item_code), as_dict=True)

#             pending_on_mr = sum(max(flt(m.qty) - flt(m.ordered_qty), 0) for m in mr_rows)

#             aggregated_so_data[key] = {
#                 "so_id": row.so_id, "customer": row.customer, "customer_name": row.customer_name,
#                 "item_code": row.item_code, "warehouse": row.warehouse, "uom": row.uom,
#                 "order_qty": 0.0, "picked": picked_qty, "on_request_pending": pending_on_mr,
#                 "mr_links": [{"name": m.name, "status": m.status, "docstatus": m.docstatus} for m in mr_rows],
#                 "available": actual_stock, "line_count": 0, "bom_no": row.bom_no
#             }
        
#         aggregated_so_data[key]["order_qty"] += flt(row.qty)
#         aggregated_so_data[key]["line_count"] += 1

#     standard_results = []
#     for k, val in aggregated_so_data.items():
#         val["shortage"] = max(flt(val["order_qty"]) - flt(val["picked"]) - flt(val["on_request_pending"]), 0)

#         if not val["bom_no"]:
#             standard_results.append(val)
#         else:
#             if val["shortage"] > 0:
#                 bom_doc = frappe.get_doc("BOM", val["bom_no"])
#                 factor = val["shortage"] / flt(bom_doc.quantity)
#                 exploded = frappe.get_all("BOM Explosion Item", filters={"parent": val["bom_no"]}, fields=["item_code", "stock_qty", "stock_uom", "source_warehouse"])
#                 for exp in exploded:
#                     rm_wh = exp.source_warehouse or val['warehouse']
#                     rm_key = (exp.item_code, rm_wh)
#                     if rm_key not in rm_aggregation:
#                         rm_agg_stock = frappe.db.get_value("Bin", {"item_code": exp.item_code, "warehouse": rm_wh}, "actual_qty") or 0.0
#                         rm_aggregation[rm_key] = {
#                             "item_code": exp.item_code, "warehouse": rm_wh, "uom": exp.stock_uom, 
#                             "available": rm_agg_stock, "qty_needed": 0.0, "linked_orders": [],
#                             "open_supply": mr_supply_map.get(rm_key, 0.0) # OPEN MR QUANTITIES ALREADY RAISED
#                         }
                    
#                     rm_aggregation[rm_key]["qty_needed"] += (flt(exp.stock_qty) * factor)
#                     if val["so_id"] not in [o['name'] for o in rm_aggregation[rm_key]["linked_orders"]]:
#                         rm_aggregation[rm_key]["linked_orders"].append({"name": val['so_id'], "customer_name": val['customer_name']})

#     # Final Filter for RMs: Subtract Open MRs
#     final_raw_list = []
#     for rm in rm_aggregation.values():
#         # LOGIC: (Need - Existing Supply)
#         rm["final_shortage"] = max(rm["qty_needed"] - rm["open_supply"], 0)
#         # If the final shortage is 0 or less (supply covers need), we still show it so user can see it's fulfilled by an MR
#         final_raw_list.append(rm)

#     return {"standard": standard_results, "raw": final_raw_list}




import frappe
from frappe.utils import flt

@frappe.whitelist()
def fetch_multi_order_requirements():
    # 1. Fetch pending Sales Order items
    so_items_raw = frappe.db.sql("""
        SELECT 
            so.name as so_id, so.customer, so.customer_name, 
            so_item.item_code, so_item.warehouse, so_item.qty, 
            so_item.bom_no, so_item.uom, so.delivery_date
        FROM `tabSales Order` so
        INNER JOIN `tabSales Order Item` so_item ON so_item.parent = so.name
        WHERE so.docstatus = 1 
          AND so.status NOT IN ('Completed', 'Closed', 'Cancelled')
          AND so_item.qty > so_item.delivered_qty
    """, as_dict=True)

    # 2. FETCH OPEN MR SUPPLY (with Links)
    # We find all MRs that aren't fully ordered yet for EVERY component in the system
    mr_supply_data = frappe.db.sql("""
        SELECT 
            child.item_code, child.warehouse, child.parent as mr_id, 
            parent.status, parent.docstatus, (child.qty - child.ordered_qty) as open_qty
        FROM `tabMaterial Request Item` child
        INNER JOIN `tabMaterial Request` parent ON child.parent = parent.name
        WHERE parent.docstatus < 2 AND (child.qty - child.ordered_qty) > 0
    """, as_dict=True)

    # Group MR supply by Item and Warehouse
    mr_supply_map = {}
    for d in mr_supply_data:
        key = (d.item_code, d.warehouse)
        if key not in mr_supply_map:
            mr_supply_map[key] = {"total_qty": 0.0, "links": []}
        
        mr_supply_map[key]["total_qty"] += flt(d.open_qty)
        mr_supply_map[key]["links"].append({
            "name": d.mr_id,
            "status": d.status,
            "docstatus": d.docstatus
        })

    aggregated_so_data = {}
    rm_aggregation = {}

    for row in so_items_raw:
        key = (row.so_id, row.item_code, row.warehouse, row.bom_no or "")

        if key not in aggregated_so_data:
            picked_qty = flt(frappe.db.sql("""
                SELECT SUM(pli.qty) FROM `tabPick List Item` pli
                INNER JOIN `tabPick List` pl ON pli.parent = pl.name
                WHERE pli.sales_order = %s AND pli.item_code = %s AND pli.warehouse = %s AND pl.docstatus < 2
            """, (row.so_id, row.item_code, row.warehouse))[0][0])

            # Order-specific MR links for Standard Table
            mr_rows = frappe.db.sql("""
                SELECT child.parent as name, parent.status, parent.docstatus, child.qty, child.ordered_qty
                FROM `tabMaterial Request Item` child
                INNER JOIN `tabMaterial Request` parent ON child.parent = parent.name
                WHERE child.sales_order = %s AND child.item_code = %s AND parent.docstatus < 2
            """, (row.so_id, row.item_code), as_dict=True)

            pending_on_mr = sum(max(flt(m.qty) - flt(m.ordered_qty), 0) for m in mr_rows)

            aggregated_so_data[key] = {
                "so_id": row.so_id, "customer": row.customer, "customer_name": row.customer_name,
                "item_code": row.item_code, "warehouse": row.warehouse, "uom": row.uom,
                "order_qty": 0.0, "picked": picked_qty, "on_request_pending": pending_on_mr,
                "mr_links": [{"name": m.name, "status": m.status, "docstatus": m.docstatus} for m in mr_rows],
                "available": frappe.db.get_value("Bin", {"item_code": row.item_code, "warehouse": row.warehouse}, "actual_qty") or 0.0,
                "line_count": 0, "bom_no": row.bom_no
            }
        
        aggregated_so_data[key]["order_qty"] += flt(row.qty)
        aggregated_so_data[key]["line_count"] += 1

    standard_results = []
    for val in aggregated_so_data.values():
        val["shortage"] = max(flt(val["order_qty"]) - flt(val["picked"]) - flt(val["on_request_pending"]), 0)

        if not val["bom_no"]:
            standard_results.append(val)
        else:
            if val["shortage"] > 0:
                bom_doc = frappe.get_doc("BOM", val["bom_no"])
                factor = val["shortage"] / flt(bom_doc.quantity)
                exploded = frappe.get_all("BOM Explosion Item", filters={"parent": val["bom_no"]}, fields=["item_code", "stock_qty", "stock_uom", "source_warehouse"])
                for exp in exploded:
                    rm_wh = exp.source_warehouse or val['warehouse']
                    rm_key = (exp.item_code, rm_wh)
                    if rm_key not in rm_aggregation:
                        # Fetch consolidated supply from our map
                        supply_info = mr_supply_map.get(rm_key, {"total_qty": 0.0, "links": []})
                        
                        rm_aggregation[rm_key] = {
                            "item_code": exp.item_code, "warehouse": rm_wh, "uom": exp.stock_uom, 
                            "available": (frappe.db.get_value("Bin", {"item_code": exp.item_code, "warehouse": rm_wh}, "actual_qty") or 0.0), 
                            "qty_needed": 0.0, "linked_orders": [], 
                            "open_supply_qty": supply_info["total_qty"],
                            "mr_links": supply_info["links"] # THE REQUESTED FIELD
                        }
                    rm_aggregation[rm_key]["qty_needed"] += (flt(exp.stock_qty) * factor)
                    if val["so_id"] not in [o['name'] for o in rm_aggregation[rm_key]["linked_orders"]]:
                        rm_aggregation[rm_key]["linked_orders"].append({"name": val['so_id'], "customer_name": val['customer_name']})

    for rm in rm_aggregation.values():
        rm["final_shortage"] = max(rm["qty_needed"] - rm["open_supply_qty"], 0)

    return {"standard": standard_results, "raw": list(rm_aggregation.values())}



import frappe

@frappe.whitelist()
def get_so_mr_summary(sales_order):
    # Fetch all Material Requests linked to this SO through their items
    # We group by name to avoid duplicates if multiple items are in one MR
    mrs = frappe.db.sql("""
        SELECT 
            parent.name, 
            parent.transaction_date, 
            parent.material_request_type, 
            parent.status, 
            parent.docstatus
        FROM `tabMaterial Request` parent
        JOIN `tabMaterial Request Item` child ON child.parent = parent.name
        WHERE child.sales_order = %s AND parent.docstatus < 2
        GROUP BY parent.name
        ORDER BY parent.creation DESC
    """, (sales_order), as_dict=True)

    return mrs



import frappe
from frappe.utils import getdate, nowdate
import json

@frappe.whitelist()
def create_material_request_custom(items, company, sales_order_name, is_subcontracted=0):
    # If items come as a string from JS, parse them
    if isinstance(items, str):
        items = json.loads(items)
        
    today = nowdate()
    
    mr = frappe.new_doc("Material Request")
    mr.material_request_type = "Purchase"
    mr.transaction_date = today
    mr.company = company
    mr.custom_is_subcontracted = is_subcontracted # Matching your custom logic
    
    for it in items:
        # THE DATE FIX: 
        # Reqd by Date (schedule_date) cannot be before Transaction Date (today)
        target_date = it.get('schedule_date')
        if not target_date or getdate(target_date) < getdate(today):
            target_date = today

        mr.append("items", {
            "item_code": it.get('item_code'),
            "qty": it.get('qty'),
            "warehouse": it.get('warehouse'),
            "schedule_date": target_date, # Validated Date
            "uom": it.get('uom'),
            "bom_no": it.get('bom_no'),
            "sales_order": sales_order_name,
            "description": it.get('description', f"Requirement for {sales_order_name}")
        })
    
    mr.insert()
    # mr.submit() # Uncomment this if you want it automatically submitted
    
    return mr.name



import frappe
from frappe.utils import flt

# 1. Custom Link Field Dropdown Query
@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def item_with_active_bom_query(doctype, txt, searchfield, start, page_len, filters):
    # This SQL strictly returns items that have a Default, Active, and Submitted BOM
    search_condition = ""
    if txt:
        search_condition = "AND (item.name LIKE %(txt)s OR item.item_name LIKE %(txt)s)"

    query = f"""
        SELECT item.name, item.item_name, item.description
        FROM `tabItem` item
        WHERE item.disabled = 0
          AND item.is_stock_item = 1
          AND EXISTS (
              SELECT 1 FROM `tabBOM` bom 
              WHERE bom.item = item.name 
                AND bom.is_active = 1 
                AND bom.is_default = 1
                AND bom.docstatus = 1
          )
          {search_condition}
        ORDER BY item.name ASC
        LIMIT %(start)s, %(page_len)s
    """
    
    return frappe.db.sql(query, {
        'txt': '%' + txt + '%',
        'start': start,
        'page_len': page_len
    })

import frappe
from frappe.utils import flt, cint

@frappe.whitelist()
def get_custom_bom_data(item_code, qty):
    if not item_code:
        return {"status": "error", "message": "No item code selected."}

    # strictly an integer, minimum 1
    target_qty = cint(qty) if qty else 1 

    # 1. Get Default & Active BOM specifically mapped to this item
    bom_name = frappe.db.get_value("BOM", {
        "item": item_code,
        "is_active": 1,
        "docstatus": 1
    }, "name", order_by="is_default desc")

    if not bom_name:
        return {"status": "error", "message": "No active and default BOM found."}

    # 2. IMPORTANT: Lookup the linked "Subcontracting BOM" to get service conversions
    sub_bom = frappe.db.get_value("Subcontracting BOM", {
        "finished_good": item_code,
        "finished_good_bom": bom_name,
        "is_active": 1,
    }, ["name", "service_item", "finished_good_qty", "service_item_qty"], as_dict=True)

    if not sub_bom:
        return {"status": "error", "message": "No Active Subcontracting BOM found mapping this FG."}

    bom_doc = frappe.get_doc("BOM", bom_name)
    base_qty = flt(bom_doc.quantity) or 1.0

    items = []
    for rm in bom_doc.items:
        # Strict logic per unit
        req_per_unit = flt(rm.stock_qty) / base_qty
        
        items.append({
            "item_code": rm.item_code,
            "item_name": rm.item_name,
            "uom": rm.stock_uom,
            "req_per_unit": req_per_unit
            # Note: total_req will be calculated dynamically on Frontend instantly!
        })

    return {
        "status": "success",
        "bom_name": bom_name,
        "subcontracting_bom": sub_bom,  # Sending to JS
        "items": items
    }




# import frappe
# from frappe.utils import flt

# @frappe.whitelist()
# def sync_standard_and_pos_prices():
#     standard_price_list = "Standard Selling"
#     pos_price_list = "POS Price"

#     batch_size = 500
#     start = 0
#     total_processed = 0

#     while True:
#         items = frappe.get_all(
#             "Item",
#             fields=["name", "custom_standard_selling_price", "custom_tax_rate"],
#             limit_start=start,
#             limit_page_length=batch_size
#         )

#         if not items:
#             break

#         for item in items:
#             item_code = item.name
#             base_price = flt(item.custom_standard_selling_price)

#             # If price is 0 → set 10
#             if base_price == 0:
#                 base_price = 10
#                 frappe.db.set_value(
#                     "Item",
#                     item_code,
#                     "custom_standard_selling_price",
#                     10
#                 )

#             # Extract tax %
#             tax_rate = 0
#             tax_rate_str = item.custom_tax_rate or ""

#             if "%" in tax_rate_str:
#                 try:
#                     tax_rate = flt(tax_rate_str.split("%")[0].split()[-1])
#                 except:
#                     tax_rate = 0

#             tax_amount = base_price * tax_rate / 100
#             final_pos_rate = base_price - tax_amount  # your logic

#             # STANDARD SELLING
#             std_ip = frappe.db.get_value(
#                 "Item Price",
#                 {"item_code": item_code, "price_list": standard_price_list}
#             )

#             if std_ip:
#                 frappe.db.set_value("Item Price", std_ip, "price_list_rate", base_price)
#             else:
#                 frappe.get_doc({
#                     "doctype": "Item Price",
#                     "item_code": item_code,
#                     "price_list": standard_price_list,
#                     "price_list_rate": base_price
#                 }).insert(ignore_permissions=True)

#             # POS PRICE
#             pos_ip = frappe.db.get_value(
#                 "Item Price",
#                 {"item_code": item_code, "price_list": pos_price_list}
#             )

#             if pos_ip:
#                 frappe.db.set_value("Item Price", pos_ip, "price_list_rate", final_pos_rate)
#             else:
#                 frappe.get_doc({
#                     "doctype": "Item Price",
#                     "item_code": item_code,
#                     "price_list": pos_price_list,
#                     "price_list_rate": final_pos_rate
#                 }).insert(ignore_permissions=True)

#             total_processed += 1

#         frappe.db.commit()
#         start += batch_size

#     return f"Processed {total_processed} items successfully."



# import frappe
# from frappe.utils import flt

# # -----------------------------------------
# # Button Trigger Method
# # -----------------------------------------
# @frappe.whitelist()
# def start_item_price_sync():
#     frappe.enqueue(
#         "erp_dacsinc_custom.custom_script.sync_standard_and_pos_prices",
#         queue="long",
#         timeout=6000
#     )
#     return "Price sync started in background. You can continue working."


# # -----------------------------------------
# # Background Worker Function
# # -----------------------------------------
# @frappe.whitelist()
# def sync_standard_and_pos_prices():
#     standard_price_list = "Standard Selling"
#     pos_price_list = "POS Price"

#     batch_size = 500
#     start = 0
#     total_processed = 0

#     while True:
#         items = frappe.get_all(
#             "Item",
#             fields=["name", "custom_standard_selling_price", "custom_tax_rate"],
#             limit_start=start,
#             limit_page_length=batch_size
#         )

#         if not items:
#             break

#         for item in items:
#             item_code = item.name
#             base_price = flt(item.custom_standard_selling_price)

#             # If 0 → set 10
#             if base_price == 0:
#                 base_price = 10
#                 frappe.db.set_value(
#                     "Item",
#                     item_code,
#                     "custom_standard_selling_price",
#                     10
#                 )

#             # Tax extraction
#             tax_rate = 0
#             tax_rate_str = item.custom_tax_rate or ""

#             if "%" in tax_rate_str:
#                 try:
#                     tax_rate = flt(tax_rate_str.split("%")[0].split()[-1])
#                 except:
#                     tax_rate = 0

#             tax_amount = base_price * tax_rate / 100
#             final_pos_rate = base_price - tax_amount  # your logic

#             # STANDARD SELLING
#             upsert_price(item_code, standard_price_list, base_price)

#             # POS PRICE
#             upsert_price(item_code, pos_price_list, final_pos_rate)

#             total_processed += 1

#         frappe.db.commit()
#         start += batch_size

#     frappe.logger().info(f"Item Price Sync Completed. Total: {total_processed}")


# # -----------------------------------------
# # Helper Function (Cleaner Code)
# # -----------------------------------------
# def upsert_price(item_code, price_list, rate):
#     ip = frappe.db.get_value(
#         "Item Price",
#         {"item_code": item_code, "price_list": price_list}
#     )

#     if ip:
#         frappe.db.set_value("Item Price", ip, "price_list_rate", rate)
#     else:
#         frappe.get_doc({
#             "doctype": "Item Price",
#             "item_code": item_code,
#             "price_list": price_list,
#             "price_list_rate": rate
#         }).insert(ignore_permissions=True)


import frappe
from frappe.utils import flt


# =====================================================
# BUTTON TRIGGER METHOD (Starts Background Job)
# =====================================================
@frappe.whitelist()
def start_item_price_sync():
    frappe.enqueue(
        "erp_dacsinc_custom.custom_script.sync_standard_and_pos_prices",
        queue="long",
        timeout=6000
    )
    return "Item Price Sync started in background."


# =====================================================
# MAIN BACKGROUND FUNCTION
# =====================================================
def sync_standard_and_pos_prices():

    standard_price_list = "Standard Selling"
    pos_price_list = "POS Price"

    batch_size = 500
    start = 0
    total_processed = 0

    while True:
        items = frappe.get_all(
            "Item",
            filters={
                "has_variants": 0,  # Ignore template items
                "custom_standard_selling_price": ["in", [0, 10]]
            },
            fields=[
                "name",
                "custom_standard_selling_price",
                "custom_tax_rate"
            ],
            limit_start=start,
            limit_page_length=batch_size
        )

        if not items:
            break

        for item in items:
            item_code = item.name
            base_price = flt(item.custom_standard_selling_price)

            # -----------------------------------------
            # If price is 0 → set to 10
            # -----------------------------------------
            if base_price == 0:
                base_price = 10
                frappe.db.set_value(
                    "Item",
                    item_code,
                    "custom_standard_selling_price",
                    10
                )

            # -----------------------------------------
            # Extract tax %
            # -----------------------------------------
            tax_rate = 0
            tax_rate_str = item.custom_tax_rate or ""

            if "%" in tax_rate_str:
                try:
                    tax_rate = flt(
                        tax_rate_str.split("%")[0].split()[-1]
                    )
                except:
                    tax_rate = 0

            tax_amount = base_price * tax_rate / 100
            final_pos_rate = base_price - tax_amount   # your logic

            # -----------------------------------------
            # Update Standard Selling Price
            # -----------------------------------------
            upsert_price(item_code, standard_price_list, base_price)

            # -----------------------------------------
            # Update POS Price
            # -----------------------------------------
            upsert_price(item_code, pos_price_list, final_pos_rate)

            total_processed += 1

        frappe.db.commit()
        start += batch_size

    frappe.logger().info(
        f"Item Price Sync Completed. Total Processed: {total_processed}"
    )


# =====================================================
# HELPER FUNCTION (Create or Update Item Price)
# =====================================================
def upsert_price(item_code, price_list, rate):

    ip_name = frappe.db.get_value(
        "Item Price",
        {
            "item_code": item_code,
            "price_list": price_list
        }
    )

    if ip_name:
        frappe.db.set_value(
            "Item Price",
            ip_name,
            "price_list_rate",
            rate
        )
    else:
        frappe.get_doc({
            "doctype": "Item Price",
            "item_code": item_code,
            "price_list": price_list,
            "price_list_rate": rate
        }).insert(ignore_permissions=True)