import frappe



def copy_custom_fields(doc, method):
    if doc.custom_tax_rate:
        update_tax_child(doc)





def item_after_insert(doc, method):
    doc.description = ''
    if doc.custom_tax_rate:
        update_tax_child(doc)

    # Create Item Price on new item creation
    if doc.custom_standard_selling_price:
        create_or_update_item_price(doc, "Selling", doc.custom_standard_selling_price)
    if doc.custom_standard_buying_price:
        create_or_update_item_price(doc, "Buying", doc.custom_standard_buying_price)

def item_on_update(doc, method):
    # Check if the standard prices have been changed
    doc_before_save = doc.get_doc_before_save()
    if doc_before_save:
        if doc.custom_standard_selling_price != doc_before_save.custom_standard_selling_price:
            create_or_update_item_price(doc, "Selling", doc.custom_standard_selling_price)
        if doc.custom_standard_buying_price != doc_before_save.custom_standard_buying_price:
            create_or_update_item_price(doc, "Buying", doc.custom_standard_buying_price)

def create_or_update_item_price(doc, price_type, rate):
    price_list_name = f"Standard {price_type}"

    # Check if an Item Price already exists for this item and price list
    item_price = frappe.db.get_value("Item Price", {"item_code": doc.name, "price_list": price_list_name}, "name")

    if item_price:
        # If it exists, update it
        ip = frappe.get_doc("Item Price", item_price)
        ip.price_list_rate = rate
        ip.save()
        # frappe.msgprint(f"Item Price for {price_list_name} updated to {rate}")
    else:
        # If it doesn't exist, create a new one
        ip = frappe.new_doc("Item Price")
        ip.item_code = doc.name
        ip.price_list = price_list_name
        ip.price_list_rate = rate
        ip.insert()
        # frappe.msgprint(f"Item Price for {price_list_name} created with rate {rate}")

def item_before_save(doc, method):
    if doc.custom_tax_rate:
        update_tax_child(doc)




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

def update_tax_child(doc):
    try:
        # Clear existing taxes
        doc.taxes = []

        # Fetch tax_rate
        tax_rate = doc.custom_tax_rate  # Assuming this stores your tax template

        if tax_rate and tax_rate != 'Non-GST - IND':
            # Add In-State entry
            doc.append('taxes', {
                "tax_category": "In-State",
                "item_tax_template": tax_rate
            })

            # Add Out-State entry
            doc.append('taxes', {
                "tax_category": "Out-State",
                "item_tax_template": tax_rate
            })

        # # Always add Non-GST entry
        # doc.append('taxes', {
        #     # "tax_category": "Non-GST",
        #     "item_tax_template": "Non-GST - IND"
        # })
        doc.save()
    except Exception as e:
        frappe.log_error(f"Error in updating taxes: {str(e)}")
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
@frappe.whitelist()
def get_item_details(item_code, sales_order=None):
    """
    Get available stock across all warehouses, last selling price,
    total ordered qty, delivered qty, pending qty, total stock, and total reserved qty.
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
        WHERE si_item.item_code = %s
        AND si.docstatus = 1
        ORDER BY si.posting_date DESC
        LIMIT 1
    """, (item_code,), as_dict=True)

    total_qty = 0
    delivered_qty = 0
    pending_qty = 0
    total_reserved = 0

    # If Sales Order provided, calculate delivery info
    if sales_order:
        so_item = frappe.db.sql("""
            SELECT qty, delivered_qty
            FROM `tabSales Order Item`
            WHERE parent = %s AND item_code = %s
        """, (sales_order, item_code), as_dict=True)

        if so_item:
            total_qty = so_item[0].qty or 0
            delivered_qty = so_item[0].delivered_qty or 0
            pending_qty = max(total_qty - delivered_qty, 0)

        # Calculate total reserved qty (exclude Cancelled)
        reserved = frappe.db.sql("""
            SELECT SUM(reserved_qty) AS total_reserved
            FROM `tabStock Reservation Entry`
            WHERE item_code=%s
            AND voucher_no=%s
            AND status != 'Cancelled'
        """, (item_code, sales_order), as_dict=True)
        total_reserved = reserved[0].total_reserved or 0

    for stock in stock_entries:
        warehouse_data.append({
            "warehouse": stock.warehouse,
            "available_qty": stock.available_qty
        })

    return {
        "warehouse_data": warehouse_data,
        "last_selling_price": last_price[0].last_selling_price if last_price else "N/A",
        "total_available_stock": total_available_stock,
        "total_qty": total_qty,
        "delivered_qty": delivered_qty,
        "pending_qty": pending_qty,
        "total_reserved": total_reserved  # ✅ added
    }


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


@frappe.whitelist()
def get_delivery_notes(sales_order, item_code=None):
    """
    Debug: Get delivered quantities for a Sales Order item.
    Prints debug info.
    """
    try:
        args = [sales_order]
        sql = """
            SELECT 
                dni.parent AS delivery_note,
                dn.posting_date,
                dni.qty AS delivered_qty,
                dni.item_code,
                dni.item_name,
                dni.warehouse
            FROM `tabDelivery Note Item` dni
            JOIN `tabDelivery Note` dn ON dni.parent = dn.name
            WHERE dn.docstatus=1 AND dni.against_sales_order=%s
        """

        if item_code:
            sql += " AND dni.item_code=%s"
            args.append(item_code)

        sql += " ORDER BY dn.posting_date DESC"

        # Debug prints
        print("SQL Query:", sql)
        print("Args:", args)

        deliveries = frappe.db.sql(sql, tuple(args), as_dict=True)

        # Debug: fetched data
        print("Fetched Deliveries:", deliveries)

    except Exception as e:
        print("Error fetching delivery notes:", e)
        deliveries = []

    return deliveries





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
    if doc.quotation_to == "Lead" and doc.party_name:
        lead = frappe.get_doc("Lead", doc.party_name)
        if lead.custom_lead_category == "Enquiry":
            lead.custom_lead_category = "Pipeline"
            lead.save(ignore_permissions=True)
        if hasattr(lead, "lead_owner"):
            doc.custom_lead_owner = lead.lead_owner
            frappe.db.set_value("Quotation", doc.name, "custom_lead_owner", lead.lead_owner)
        
def sales_order_on_submit(doc, method):
    """When Sales Order is submitted:
    - If created from a Quotation linked to a Lead → update Lead to 'Order' & custom_po_value
    """
    lead_name = None

    # ✅ CASE: Sales Order created from Quotation linked to a Lead
    if doc.items and doc.items[0].prevdoc_docname:
        quotation_name = doc.items[0].prevdoc_docname
        quotation_to, party_name = frappe.db.get_value(
            "Quotation", quotation_name, ["quotation_to", "party_name"]
        ) or (None, None)

        if quotation_to == "Lead" and party_name:
            lead_name = party_name

    # ✅ Only proceed if Lead found via Quotation
    if lead_name:
        lead = frappe.get_doc("Lead", lead_name)

        # Update lead category
        if lead.custom_lead_category == "Pipeline":
            lead.custom_lead_category = "Order"

        # Update custom_po_value with the latest SO amount for this lead (from any quotation-based SO)
        latest_so = frappe.db.sql("""
            SELECT so.grand_total
            FROM `tabSales Order Item` soi
            INNER JOIN `tabSales Order` so ON soi.parent = so.name
            INNER JOIN `tabQuotation` q ON soi.prevdoc_docname = q.name
            WHERE q.quotation_to = 'Lead'
              AND q.party_name = %s
              AND so.docstatus = 1
            ORDER BY so.creation DESC
            LIMIT 1
        """, (lead_name,), as_dict=True)

        if latest_so:
            lead.custom_po_value = latest_so[0].grand_total

        # ✅ Update Lead Owner into Sales Order
        if hasattr(lead, "lead_owner"):
            frappe.db.set_value("Sales Order", doc.name, "custom_lead_owner", lead.lead_owner)


        lead.save(ignore_permissions=True)


def sales_order_on_cancel(doc, method):
    """When Sales Order is cancelled:
    - If it was created from a Quotation linked to a Lead → revert or update PO value
    """
    lead_name = None

    # ✅ CASE: Cancelled SO created from Quotation linked to a Lead
    if doc.items and doc.items[0].prevdoc_docname:
        quotation_name = doc.items[0].prevdoc_docname
        quotation_to, party_name = frappe.db.get_value(
            "Quotation", quotation_name, ["quotation_to", "party_name"]
        ) or (None, None)

        if quotation_to == "Lead" and party_name:
            lead_name = party_name

    # ✅ Only proceed if Lead found via Quotation
    if lead_name:
        lead = frappe.get_doc("Lead", lead_name)

        # Check if there are other active Sales Orders created from Quotations for this Lead
        active_so = frappe.db.sql("""
            SELECT so.name, so.grand_total
            FROM `tabSales Order Item` soi
            INNER JOIN `tabSales Order` so ON soi.parent = so.name
            INNER JOIN `tabQuotation` q ON soi.prevdoc_docname = q.name
            WHERE q.quotation_to = 'Lead'
              AND q.party_name = %s
              AND so.docstatus = 1
            ORDER BY so.creation DESC
            LIMIT 1
        """, (lead_name,), as_dict=True)

        if active_so:
            # ✅ Update latest active SO value
            lead.custom_po_value = active_so[0].grand_total
        else:
            # ✅ No active SO → revert Lead category & clear PO value
            lead.custom_lead_category = "Pipeline"
            lead.custom_po_value = 0

        lead.save(ignore_permissions=True)


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
from collections import defaultdict
import frappe
from frappe.utils import cint
from collections import defaultdict

# This is the main function called by the UI.
@frappe.whitelist()
def get_pending_so_with_material_stock(is_subcontracted=False):
    is_subcontracted = cint(is_subcontracted)
    item_code_field = "fg_item" if is_subcontracted else "item_code"
    
    # Define the condition to filter for subcontracted vs. regular items
    condition = "AND soi.bom_no IS NOT NULL AND soi.bom_no != ''" if is_subcontracted else "AND (soi.bom_no IS NULL OR soi.bom_no = '')"

    # Fetch all potentially pending Sales Order Items
    pending_orders_raw = frappe.db.sql(f"""
        SELECT
            soi.name AS so_item_name, soi.parent AS sales_order, so.customer AS customer,
            soi.item_code, soi.item_name, soi.qty, soi.bom_no AS bom,
            soi.delivered_qty
        FROM `tabSales Order Item` AS soi JOIN `tabSales Order` AS so ON so.name = soi.parent
        WHERE so.docstatus = 1 AND so.status NOT IN ('Closed', 'On Hold', 'Completed')
        AND soi.qty > soi.delivered_qty {condition}
        ORDER BY so.transaction_date ASC, soi.item_code ASC
    """, as_dict=True)

    if not pending_orders_raw:
        return {}

    final_pending_orders = []
    for so_item in pending_orders_raw:
        # 1. Calculate the quantity already ordered on other submitted Purchase Orders.
        ordered_on_pos_raw = frappe.db.sql("""
            SELECT SUM(poi.qty) FROM `tabPurchase Order Item` AS poi
            JOIN `tabPurchase Order` AS po ON po.name = poi.parent
            WHERE po.docstatus = 1 AND poi.sales_order = %(sales_order)s AND poi.{field} = %(item_code)s
        """.format(field=item_code_field), {'sales_order': so_item.sales_order, 'item_code': so_item.item_code})
        ordered_on_pos = (ordered_on_pos_raw[0][0] or 0) if ordered_on_pos_raw else 0

        # 2. NEW: Calculate the finished good quantity reserved from stock specifically for this Sales Order.
        reserved_for_so_raw = frappe.db.sql("""
            SELECT SUM(reserved_qty) FROM `tabStock Reservation Entry`
            WHERE voucher_no = %(sales_order)s AND item_code = %(item_code)s AND docstatus = 1
        """, {'sales_order': so_item.sales_order, 'item_code': so_item.item_code})
        reserved_for_so = (reserved_for_so_raw[0][0] or 0) if reserved_for_so_raw and reserved_for_so_raw[0] else 0

        # 3. FINAL PENDING CALCULATION: Total Qty - Delivered - Already Ordered - Reserved from Stock
        qty_pending_purchase = so_item.qty - so_item.delivered_qty - ordered_on_pos - reserved_for_so
        
        # Only add the item to the list if there is a quantity that truly needs to be purchased.
        if qty_pending_purchase > 0.001:
            so_item['pending_qty'] = qty_pending_purchase
            
            # --- Fetching stock levels for display (logic is unchanged) ---
            fg_stock_data = frappe.db.sql("SELECT SUM(actual_qty) FROM `tabBin` WHERE item_code = %s", (so_item.item_code), as_list=True)
            fg_actual = (fg_stock_data[0][0] or 0) if fg_stock_data and fg_stock_data[0] else 0
            
            total_reserved_for_item_raw = frappe.db.sql("""
                SELECT SUM(reserved_qty) FROM `tabStock Reservation Entry` WHERE item_code = %s AND docstatus = 1
            """, (so_item.item_code))
            total_reserved_for_item = (total_reserved_for_item_raw[0][0] or 0) if total_reserved_for_item_raw and total_reserved_for_item_raw[0] else 0
            
            so_item['fg_total_reserved_qty'] = total_reserved_for_item
            so_item['fg_available_qty'] = fg_actual - total_reserved_for_item
            so_item['fg_reserved_for_so_qty'] = reserved_for_so # Display the specific reservation amount

            # Raw material calculation is now based on the true pending purchase quantity.
            so_item['raw_materials'] = _get_bom_stock_details(so_item.bom, qty_pending_purchase)
            final_pending_orders.append(so_item)

    if not final_pending_orders:
        return {}

    # --- Building the summary (This part is correct and uses the newly calculated pending_qty) ---
    item_summary_dict = defaultdict(lambda: {"total_qty": 0, "order_count": 0, "boms": set(), "item_name": ""})
    for so in final_pending_orders:
        item_code = so.item_code
        item_summary_dict[item_code]["total_qty"] += so.pending_qty
        item_summary_dict[item_code]["order_count"] += 1
        item_summary_dict[item_code]["item_name"] = so.item_name
        if so.bom: item_summary_dict[item_code]["boms"].add(so.bom)
    
    item_summary = []
    for item_code, data in item_summary_dict.items():
        bom = next(iter(data["boms"]), None)
        materials = _get_bom_stock_details(bom, data["total_qty"]) if bom else []
        total_reserved_raw = frappe.db.sql("""
            SELECT SUM(reserved_qty) FROM `tabStock Reservation Entry` WHERE item_code = %s AND docstatus = 1
        """, (item_code))
        total_reserved = (total_reserved_raw[0][0] or 0) if total_reserved_raw and total_reserved_raw[0] else 0
        
        item_summary.append({
            "item_code": item_code, "item_name": data["item_name"],
            "total_pending_qty": data["total_qty"], "order_count": data["order_count"],
            "total_reserved_qty": total_reserved, "raw_materials": materials
        })
        
    return {
        "item_summary": sorted(item_summary, key=lambda x: x['total_pending_qty'], reverse=True),
        "sales_orders": final_pending_orders
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
        # print("Validating itcccccccccccccccccccccem:", item)
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

        # 2. NEW: Calculate quantity reserved from stock for this SO.
        reserved_for_so_raw = frappe.db.sql("""
            SELECT SUM(reserved_qty) FROM `tabStock Reservation Entry`
            WHERE voucher_no = %(sales_order)s AND item_code = %(item_code)s AND docstatus = 1
        """, {'sales_order': item.get('salesOrder'), 'item_code': item.get('itemCode')})
        reserved_for_so = (reserved_for_so_raw[0][0] or 0) if reserved_for_so_raw and reserved_for_so_raw[0] else 0
        
        # 3. The true maximum allowable quantity for a new PO.
        max_allowable_qty = so_item_details.qty - so_item_details.delivered_qty - ordered_on_pos - reserved_for_so
        
        # The Core Validation.
        if qty_to_add > (max_allowable_qty + 0.001):
            rejected_items.append({
                "sales_order": item.get('salesOrder'),
                "item_name": item.get('itemName'),
                "reason": f"Cannot add {qty_to_add} units. Only {max_allowable_qty:.2f} are pending procurement."
            })
        elif max_allowable_qty <= 0:
             rejected_items.append({
                "sales_order": item.get('salesOrder'),
                "item_name": item.get('itemName'),
                "reason": "This item's requirement is fully met by other POs or reserved stock."
            })
        else:
            # Item is valid, add it to the list.
            if is_subcontracted:
                service_item_code = "Order Charges" # Or get from settings
                details = get_item_details_for_po(service_item_code)
                if details:
                    details['description'] = f"{details.get('description', '')}\n\nManufacturing of: {item.get('itemName')} ({item.get('itemCode')})\nRef SO: {item.get('salesOrder')}"
                    details['fg_item'] = item.get('itemCode')
                    details['fg_item_qty'] = item.get('pendingQty')
                    details['sales_order'] = item.get('salesOrder')
                    details['qty'] = item.get('pendingQty')
                    details['item_code'] = service_item_code
                    valid_items.append(details)
            else:
                details = get_item_details_for_po(item.get('itemCode'))
                if details:
                    details['item_code'] = item.get('itemCode')
                    details['qty'] = item.get('pendingQty')
                    details['sales_order'] = item.get('salesOrder')
                    valid_items.append(details)

    return {
        "valid_items": valid_items,
        "rejected_items": rejected_items
    }

# --- HELPER FUNCTIONS (No changes below) ---

def get_item_details_for_po(item_code):
    if not item_code: return {}
    details = frappe.db.get_value("Item", item_code, ["purchase_uom", "stock_uom", "description", "item_name"], as_dict=True)
    if not details: return {}
    uom = details.purchase_uom or details.stock_uom
    factor = frappe.db.get_value("UOM Conversion Detail", {"parent": item_code, "uom": uom}, "conversion_factor") or 1.0
    return {"uom": uom, "stock_uom": details.stock_uom, "description": details.description, "item_name": details.item_name, "conversion_factor": factor}

# def get_stock_reservations_other(sales_order, item_code):
#     if not sales_order or not item_code: return []
#     return frappe.db.get_all("Stock Reservation Entry", filters={"voucher_no": sales_order, "item_code": item_code, "docstatus": 1}, fields=["name", "reserved_qty"])

def _get_bom_stock_details(bom_name, required_fg_qty):
    if not bom_name or not required_fg_qty: return []
    bom_items = frappe.db.get_all("BOM Item", filters={"parent": bom_name}, fields=["item_code", "item_name", "qty", "stock_uom"])
    results = []
    for item in bom_items:
        required_qty = item.qty * required_fg_qty
        stock_data = frappe.db.sql("SELECT SUM(actual_qty), SUM(reserved_qty) FROM `tabBin` WHERE item_code = %s", (item.item_code), as_list=True)
        actual_qty = (stock_data[0][0] or 0)
        reserved_qty = (stock_data[0][1] or 0)
        results.append({ "item_code": item.item_code, "item_name": item.item_name, "required_qty": required_qty, "actual_qty": actual_qty, "reserved_qty": reserved_qty, "available_qty": actual_qty - reserved_qty, "stock_uom": item.stock_uom })
    return results





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
        stock_data = frappe.db.sql("""
            SELECT SUM(actual_qty), SUM(reserved_qty)
            FROM `tabBin` WHERE item_code = %s
        """, (rm_code), as_list=True)
        
        actual_qty = flt(stock_data[0][0])
        reserved_qty = flt(stock_data[0][1])
        available_qty = actual_qty - reserved_qty
        
        results.append({
            "item_code": rm_code,
            "item_name": item_details.item_name,
            "uom": item_details.stock_uom,
            "required_qty": req_qty,
            "available_qty": available_qty
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
def get_sco_status_for_po(purchase_order_name):
    """
    Checks the status of the Subcontracting Order linked to a Purchase Order.
    Returns the SCO name and whether there are items pending receipt.
    """
    sco_info = frappe.db.get_value(
        "Subcontracting Order",
        {"purchase_order": purchase_order_name, "docstatus": 1},
        ["name", "per_received"],
        as_dict=True
    )

    if not sco_info:
        return {"sco_exists": False, "items_pending": False}

    return {
        "sco_exists": True,
        "sco_name": sco_info.name,
        "items_pending": flt(sco_info.per_received) < 100
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
    pi = make_purchase_invoice(pr.name)
    pi.insert(ignore_permissions=True)
    # Note: Depending on your company's process, you may want to leave the PI in Draft.
    # To save as draft, comment out the line below.
    pi.submit()
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
        po.add_comment("Comment", _("Created Purchase Invoice: {0}").format(pi.name))

    # Return the names of ALL documents created
    return {"scr_name": scr.name, "pr_name": pr.name, "pi_name": pi.name}



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


