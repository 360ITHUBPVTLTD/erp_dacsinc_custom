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
    if doc.tc_name and not doc.terms:
        doc.terms = frappe.db.get_value("Terms and Conditions", doc.tc_name, "terms")