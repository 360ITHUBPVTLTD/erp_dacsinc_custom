import frappe



def copy_custom_fields(doc, method):
    if doc.custom_tax_rate:
        update_tax_child(doc)





def item_after_insert(doc, method):  
    doc.description = ''
    if doc.custom_tax_rate:
        update_tax_child(doc)

def item_before_save(doc, method):
    if doc.custom_tax_rate:
        update_tax_child(doc)


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

        # Always add Non-GST entry
        doc.append('taxes', {
            # "tax_category": "Non-GST",
            "item_tax_template": "Non-GST - IND"
        })
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
    """
    try:
        # Base SQL and args
        sql = """
            SELECT 
                creation AS date, 
                warehouse, 
                reserved_qty, 
                voucher_qty, 
                status, 
                item_code
            FROM `tabStock Reservation Entry`
            WHERE voucher_no = %s
        """
        args = [sales_order]

        # Add item_code filter if provided
        if item_code:
            sql += " AND item_code = %s"
            args.append(item_code)

        # Order by creation descending
        sql += " ORDER BY creation DESC"

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
