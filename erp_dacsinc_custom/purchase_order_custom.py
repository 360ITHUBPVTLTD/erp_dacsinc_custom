import frappe
from frappe.utils import flt, nowdate
from frappe import _
import json

@frappe.whitelist()
def get_pending_so_with_raw_materials_summary():
    """
    Fetches pending Sales Order items with raw material previews, including coverage from existing POs.
    """
    so_items = frappe.db.sql("""
        SELECT 
            si.parent as sales_order,
            si.item_code,
            si.item_name,
            si.qty,
            COALESCE(si.delivered_qty, 0) as delivered_qty,
            (si.qty - COALESCE(si.delivered_qty, 0)) as pending_qty,
            so.customer,
            si.bom_no as bom
        FROM `tabSales Order Item` si
        INNER JOIN `tabSales Order` so ON si.parent = so.name
        WHERE so.docstatus = 1 
            AND so.status != 'Closed'
            AND so.status != 'Cancelled'
            AND (si.qty - COALESCE(si.delivered_qty, 0)) > 0
        ORDER BY so.transaction_date DESC, so.name
    """, as_dict=1)
    
    # Prefetch data for better performance
    available_bins = frappe.db.sql("SELECT item_code, SUM(projected_qty) as projected_qty FROM `tabBin` GROUP BY 1", as_dict=1)
    available_map = {d.item_code: flt(d.projected_qty) for d in available_bins}

    pending_sos = []

    for so_item in so_items:
        
        # Pick List / Effective Pending Calculation
        picked_submitted = frappe.db.sql("SELECT COALESCE(SUM(pll.picked_qty), 0) FROM `tabPick List Item` pll INNER JOIN `tabPick List` pl ON pll.parent = pl.name WHERE pll.sales_order = %s AND pll.item_code = %s AND pl.docstatus = 1", (so_item.sales_order, so_item.item_code))[0][0]
        picked_draft = frappe.db.sql("SELECT COALESCE(SUM(pll.qty), 0) FROM `tabPick List Item` pll INNER JOIN `tabPick List` pl ON pll.parent = pl.name WHERE pll.sales_order = %s AND pll.item_code = %s AND pl.docstatus = 0", (so_item.sales_order, so_item.item_code))[0][0]
        
        # Total effective pending (still needed)
        effective_pending = max(0, so_item.pending_qty - flt(picked_submitted))
        
        if effective_pending <= 0:
            continue
        
        so_item['picked_submitted'] = flt(picked_submitted)
        so_item['picked_draft'] = flt(picked_draft)
        so_item['effective_pending'] = effective_pending
        
        if not so_item.bom:
            bom = frappe.db.get_value("BOM", {"item": so_item.item_code, "is_default": 1}, "name")
            if bom:
                so_item.bom = bom
        
        if not so_item.bom:
            continue

        # CRITICAL: Calculate FG Qty already linked to a PO for the UI visibility column
        fg_committed_in_po = get_fg_committed_to_po_by_breakdown(
            so_item.sales_order, so_item.item_code
        )
        
        # MAX Qty to Fulfill is the effective pending MINUS the amount already covered by breakdown commitment
        max_qty_to_fulfill = max(0, effective_pending - fg_committed_in_po)

        # 4. Get raw materials and link available_qty, already_ordered_qty
        raw_materials = []
        if so_item.bom: 
            bom_items = frappe.get_all(
                "BOM Item", filters={"parent": so_item.bom},
                fields=["item_code", "item_name", "stock_uom", "stock_qty"],
                order_by="idx asc"
            )
            
            for bom_item in bom_items:
                rm_item_code = bom_item.item_code
                base_stock_qty = flt(bom_item.stock_qty)
                
                # Required Qty is based on full effective_pending (before any PO/breakdown commitment checks)
                required_qty_for_pending = base_stock_qty * effective_pending 
                
                # Already ordered for THIS SPECIFIC BREAKDOWN
                already_ordered_qty = get_total_pending_ordered_rm(
                    rm_item_code, so_item.sales_order, so_item.item_code
                )

                available_qty = available_map.get(rm_item_code, 0)
                
                raw_materials.append({
                    "item_code": rm_item_code,
                    "item_name": bom_item.item_name,
                    "uom": bom_item.stock_uom,
                    "base_stock_qty": base_stock_qty,  
                    "required_qty": required_qty_for_pending,
                    "available_qty": available_qty,  
                    "already_ordered_qty": already_ordered_qty,
                    "fg_item_code": so_item.item_code,
                    "source_finished_good": so_item.item_code
                })
        
        pending_sos.append({
            "sales_order": so_item.sales_order,
            "item_code": so_item.item_code,
            "item_name": so_item.item_name,
            "qty": so_item.qty,
            "pending_qty": so_item.pending_qty,
            "effective_pending": effective_pending,
            "picked_submitted": so_item.picked_submitted,
            "picked_draft": so_item.picked_draft,
            "customer": so_item.customer,
            "bom": so_item.bom,
            "raw_materials": raw_materials,
            "fg_committed_in_po": fg_committed_in_po,     # New field
            "max_qty_to_fulfill": max_qty_to_fulfill      # New field (used to set client input default)
        })
    
    return {"sales_orders": pending_sos}

def get_total_pending_ordered_rm(rm_item_code, so_name, fg_item_code):
    """
    Calculates the total already ordered quantity for a specific RM tied to a SO/FG breakdown in open POs.
    """
    total_ordered = frappe.db.sql("""
        SELECT COALESCE(SUM(t1.required_rm_qty), 0)
        FROM `tabPurchase Order Raw Material Source` t1
        JOIN `tabPurchase Order` t2 ON t1.parent = t2.name
        JOIN `tabPurchase Order Item` t3 ON t3.parent = t2.name AND t3.item_code = t1.raw_material_item
        WHERE t2.docstatus = 1 AND t3.received_qty < t3.qty
        AND t1.raw_material_item = %s 
        AND t1.source_sales_order = %s 
        AND t1.source_finished_good = %s
    """, (rm_item_code, so_name, fg_item_code))[0][0]
    return flt(total_ordered)

def get_fg_committed_to_po_by_breakdown(so_name, fg_item_code):
    """
    Retrieves the total quantity of this FG Item that is already associated 
    with a Submitted and OPEN Purchase Order (via Raw Material Source breakdown).
    Only includes commitments where the corresponding RM PO item is still pending receipt.
    """
    # Updated query to join on PO Item and ensure it's pending (received_qty < qty)
    total_committed = frappe.db.sql("""
        SELECT COALESCE(SUM(t1.qty_of_fg_fulfilling), 0)
        FROM `tabPurchase Order Raw Material Source` t1
        JOIN `tabPurchase Order` t2 ON t1.parent = t2.name
        JOIN `tabPurchase Order Item` t3 ON t3.parent = t2.name AND t3.item_code = t1.raw_material_item AND t3.received_qty < t3.qty
        WHERE t2.docstatus = 1 
        AND t2.status NOT IN ('Closed', 'Cancelled', 'Completed') -- OPEN status
        AND t1.source_sales_order = %s 
        AND t1.source_finished_good = %s
    """, (so_name, fg_item_code))[0][0]
    
    return flt(total_committed)

@frappe.whitelist()
def get_so_coverage_breakdown(po_name=None):
    """
    Returns a list of SO coverage details from breakdown tables.
    If po_name is provided, filters to that PO; otherwise, aggregates across all open POs.
    Each entry includes: so, fg, total_covered, pending, coverage_pct, unique_pos.
    """
    if po_name:
        # For single PO dashboard
        breakdowns = frappe.get_all("Purchase Order Raw Material Source", 
                                   filters={"parent": po_name}, 
                                   fields=["*"])
    else:
        # For fetch dialog: Aggregate across all open POs
        po_names = frappe.db.get_all("Purchase Order", 
                                     filters={"docstatus": 1, "status": ("not in", ["Closed", "Cancelled"])}, 
                                     pluck="name")
        breakdowns = []
        for po in po_names:
            breakdowns.extend(frappe.get_all("Purchase Order Raw Material Source", 
                                             filters={"parent": po}, 
                                             fields=["*"]))
    
    coverage_map = {}
    for bd in breakdowns:
        so = bd.source_sales_order
        fg = bd.source_finished_good
        key = f"{so}::{fg}"
        if key not in coverage_map:
            # Fetch effective_pending from SO Item (approx: pending_qty - picked, ignoring drafts for coverage)
            so_item = frappe.db.get_value("Sales Order Item", 
                                          {"parent": so, "item_code": fg}, 
                                          ["parent", "item_code", "qty", "delivered_qty"], 
                                          as_dict=1)
            if so_item:
                pending = max(0, flt(so_item.qty) - flt(so_item.delivered_qty))
                # Subtract picked submitted for accuracy
                picked_submitted = frappe.db.sql("""
                    SELECT COALESCE(SUM(pll.picked_qty), 0) 
                    FROM `tabPick List Item` pll 
                    INNER JOIN `tabPick List` pl ON pll.parent = pl.name 
                    WHERE pll.sales_order = %s AND pll.item_code = %s AND pl.docstatus = 1
                """, (so, fg))[0][0]
                pending = max(0, pending - flt(picked_submitted))
            else:
                pending = 0
            
            coverage_map[key] = {
                "so": so, 
                "fg": fg, 
                "total_covered": 0, 
                "pending": pending, 
                "pos": []
            }
        coverage_map[key]["total_covered"] += flt(bd.qty_of_fg_fulfilling)
        coverage_map[key]["pos"].append(bd.parent)
    
    # Calculate % and dedupe POs
    coverage_list = []
    for key, data in coverage_map.items():
        data["coverage_pct"] = (data["total_covered"] / data["pending"] * 100) if data["pending"] > 0 else 100
        data["unique_pos"] = list(set(data["pos"]))
        coverage_list.append(data)
    
    return coverage_list

# Placeholder for other methods referenced in JS (implement as needed)
@frappe.whitelist()
def calculate_raw_materials_from_selected_sos(selected_sos):
    """
    Calculates aggregated raw materials from selected SO items.
    Returns list with required_qty, available_qty, already_ordered_qty, qty_to_purchase, breakdown, etc.
    """
    selected_sos = json.loads(selected_sos)
    # Implementation logic here (aggregate BOM items, subtract stock/ordered, generate breakdown JSON)
    # For brevity, return a sample structure; replace with actual computation
    materials = []  # e.g., [{'item_code': '...', 'required_qty': 10, 'breakdown': [...], ...}]
    return materials
import frappe
import json
from frappe.utils import flt

@frappe.whitelist()
def get_stock_for_calculated_raw_materials(raw_materials):
    """
    Enriches the raw materials list with Stock Data and Existing Open PO Data.
    Uses ':::' separator to link POs to SOs for the frontend.
    """
    if isinstance(raw_materials, str):
        raw_materials = json.loads(raw_materials)

    for rm in raw_materials:
        item_code = rm.get("item_code")
        
        # 1. Extract which Sales Orders we are currently trying to fulfill for this item
        # The 'breakdown' list comes from the calculate_raw_materials_from_selected_sos function
        # We only want to check if *these* specific SOs already have POs raised for this RM.
        breakdown_list = rm.get("breakdown", [])
        relevant_sos = [b.get("source_sales_order") for b in breakdown_list if b.get("source_sales_order")]
        
        # -----------------------------
        # STEP 1: Get Warehouse Stock
        # -----------------------------
        # Defaulting to 'Stores' or first available. Modify warehouse filter as per your company settings.
        bin_data = frappe.db.sql("""
            SELECT SUM(actual_qty) as actual_qty, SUM(reserved_qty) as reserved_qty 
            FROM `tabBin` 
            WHERE item_code = %s
        """, (item_code,), as_dict=1)
        
        actual_qty = flt(bin_data[0].actual_qty) if bin_data else 0
        # You can adjust 'available' logic here (e.g., actual - reserved)
        # For purchasing, usually just Actual is displayed, or Actual - Reserved.
        rm["available_qty"] = actual_qty 
        rm["actual_qty"] = actual_qty 
        
        # -----------------------------
        # STEP 2: Check "Already Ordered" (Linked POs)
        # -----------------------------
        already_ordered_qty = 0.0
        existing_pos_formatted = []

        if relevant_sos:
            # Prepare SQL placeholder for the list of Sales Orders
            placeholders = ', '.join(['%s'] * len(relevant_sos))
            
            # Query logic:
            # 1. Find Open Purchase Orders (Submitted, Not Closed, Not Fully Received)
            # 2. Join your Custom Breakdown Table ('tabCustom RM Source Breakdown') 
            #    *Make sure the table name matches exactly what you defined in Doctype*
            # 3. Filter by the RM Item Code AND the Specific Source Sales Orders
            
            query = f"""
                SELECT 
                    parent.name as po_name,
                    child.source_sales_order as so_name,
                    child.required_rm_qty as ordered_qty
                FROM `tabCustom RM Source Breakdown` child
                JOIN `tabPurchase Order` parent ON parent.name = child.parent
                WHERE 
                    child.raw_material_item = %s
                    AND child.source_sales_order IN ({placeholders})
                    AND parent.docstatus = 1 
                    AND parent.status NOT IN ('Closed', 'Completed', 'Cancelled')
                    AND parent.per_received < 100
            """
            
            # Combine item_code and the list of SOs for the query params
            args = tuple([item_code] + relevant_sos)
            
            existing_po_data = frappe.db.sql(query, args, as_dict=True)

            seen_combinations = set()

            for row in existing_po_data:
                already_ordered_qty += flt(row.ordered_qty)
                
                # FORMATTING FOR FRONTEND: "PO-12345:::SAL-ORD-67890"
                combo_key = f"{row.po_name}:::{row.so_name}"
                
                if combo_key not in seen_combinations:
                    existing_pos_formatted.append(combo_key)
                    seen_combinations.add(combo_key)

        # Update the Item Dict
        rm["already_ordered_qty"] = already_ordered_qty
        # Join into a string. e.g. "PO-01:::SO-01, PO-02:::SO-02"
        rm["existing_pos"] = ", ".join(existing_pos_formatted)
        
        # Optional: Recalculate Qty to Purchase server-side as a default suggestion
        # This mirrors the JS logic: Required - Avail - Ordered
        net_req = flt(rm.get("required_qty")) - flt(rm["available_qty"]) - already_ordered_qty
        rm["qty_to_purchase"] = max(0, net_req)

    return raw_materials

# Additional methods for subcontracting (placeholders if not implemented)
@frappe.whitelist()
def get_linked_subcontracting_docs(purchase_order_name):
    # Implementation for linked docs dashboard
    pass

@frappe.whitelist()
def get_sco_status_for_po(purchase_order_name):
    # Implementation for SCO status
    pass

@frappe.whitelist()
def get_required_raw_materials_for_po(purchase_order_name):
    # Implementation for stock check
    pass

@frappe.whitelist()
def create_subcontracting_docs(purchase_order_name):
    # Implementation for creating SCO and STE
    pass

@frappe.whitelist()
def create_material_request_for_shortage(purchase_order_name):
    # Implementation for MR creation
    pass

@frappe.whitelist()
def get_pending_sco_items(sco_name):
    # Implementation for pending items
    pass

@frappe.whitelist()
def create_receipt_documents(sco_name, items_to_receive):
    # Implementation for receipts and invoice
    pass

@frappe.whitelist()
def validate_and_get_items_for_po(selected_items, is_subcontracted):
    # Implementation for validation and item prep
    pass

@frappe.whitelist()
def get_pending_so_with_material_stock(is_subcontracted):
    # Implementation for FG fetch
    pass