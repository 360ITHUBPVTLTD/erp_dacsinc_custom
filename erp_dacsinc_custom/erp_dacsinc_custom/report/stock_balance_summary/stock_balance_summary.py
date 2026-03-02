import frappe
from frappe import _

def execute(filters=None):
    if not filters: filters = frappe._dict({})

    # 1. Lock down warehouse for POS users automatically
    filters = restrict_to_pos_user_warehouse(filters)

    # 2. Get dynamic column list (Links are included here)
    columns = get_columns(filters)

    # 3. Fetch processed stock data
    data = get_data(filters)

    return columns, data

def restrict_to_pos_user_warehouse(filters):
    user = frappe.session.user
    roles = frappe.get_roles(user)
    
    # Even if they hack the UI, Python checks the database role
    if "POS User" in roles and "System Manager" not in roles:
        # Link current user to their allowed POS Warehouse
        pos_profile = frappe.db.get_value("POS Profile User", {"user": user}, "parent")
        if pos_profile:
            wh = frappe.db.get_value("POS Profile", pos_profile, "warehouse")
            filters["warehouse"] = wh
            filters["report_mode"] = "Retail (POS) View"
    return filters

def get_columns(filters):
    # 1. Base Master Data Columns (Always Shown)
    columns = [
        {"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 250},
        {"label": _("Item Group"), "fieldname": "item_group", "fieldtype": "Link", "options": "Item Group", "width": 120},
        {"label": _("Brand"), "fieldname": "brand", "fieldtype": "Link", "options": "Brand", "width": 100},
        {"label": _("Category"), "fieldname": "custom_product_category", "fieldtype": "Data", "width": 100},
        {"label": _("Standard Price"), "fieldname": "custom_standard_selling_price", "fieldtype": "Currency", "width": 110},
        {"label": _("Warehouse Name"), "fieldname": "warehouse_name", "fieldtype": "Data", "width": 120},
    ]

    # 2. Logic for Retail Mode
    if filters.get("report_mode") == "Retail (POS) View":
        columns += [
            {"label": _("System Balance"), "fieldname": "system_qty", "fieldtype": "Float", "width": 90},
            {"label": _("Counter Sales"), "fieldname": "unclosed_pos_qty", "fieldtype": "Float", "width": 90},
            {"label": _("Actual Qty"), "fieldname": "actual_qty", "fieldtype": "Float", "width": 90},
            # {"label": _("Coming (PO)"), "fieldname": "ordered_qty", "fieldtype": "Float", "width": 90},
            # reserved_qty is EXCLUDED here
            {"label": _("Projected Balance"), "fieldname": "final_projected", "fieldtype": "Float", "width": 120},
        ]
    # 3. Logic for All other Views (General / Back Office)
    else:
        columns += [
            {"label": _("Actual Qty"), "fieldname": "actual_qty", "fieldtype": "Float", "width": 90},
            {"label": _("Coming (PO)"), "fieldname": "ordered_qty", "fieldtype": "Float", "width": 90},
            {"label": _("Reserved (SO)"), "fieldname": "reserved_qty", "fieldtype": "Float", "width": 90},
            {"label": _("Projected Balance"), "fieldname": "final_projected", "fieldtype": "Float", "width": 120},
        ]
        
    return columns

def get_data(filters):
    params = {}
    conditions = ["item.disabled = 0"] # Only active items

    mapping = {
        "item_code": "bin.item_code",
        "warehouse": "bin.warehouse",
        "item_group": "item.item_group",
        "brand": "item.brand",
        "custom_product_category": "item.custom_product_category",
        "custom_item_type": "item.custom_item_type"
    }

    for key, sql_path in mapping.items():
        if filters.get(key):
            conditions.append(f"{sql_path} = %({key})s")
            params[key] = filters.get(key)

    # Calculate POS warehouses for the Inverse mode
    pos_warehouses = frappe.get_all("POS Profile", pluck="warehouse")
    pos_warehouses = [w for w in pos_warehouses if w]

    if filters.get("report_mode") == "Retail (POS) View" and pos_warehouses:
        conditions.append("bin.warehouse IN %(retail_ws)s")
        params["retail_ws"] = pos_warehouses
    elif filters.get("report_mode") == "Back-Office Only" and pos_warehouses:
        conditions.append("bin.warehouse NOT IN %(retail_ws)s")
        params["retail_ws"] = pos_warehouses

    where_clause = " AND ".join(conditions)

    # Core data fetching
    raw_data = frappe.db.sql(f"""
        SELECT 
            bin.item_code, item.item_name, item.item_group, item.brand,
            item.custom_product_category, item.custom_item_type,
            item.custom_standard_selling_price,
            wh.warehouse_name, bin.warehouse,
            bin.actual_qty as system_qty, bin.reserved_qty, bin.ordered_qty
        FROM `tabBin` bin
        INNER JOIN `tabItem` item ON bin.item_code = item.name
        INNER JOIN `tabWarehouse` wh ON bin.warehouse = wh.name
        WHERE {where_clause} 
        AND (bin.actual_qty != 0 OR bin.reserved_qty != 0 OR bin.ordered_qty != 0)
        ORDER BY bin.warehouse, bin.item_code
    """, params, as_dict=1)

    # POS Pending Sales Logic
    unclosed_sales_map = get_unclosed_pos_qty()

    # Strings to clean if None
    cleanup_fields = ["item_group", "brand", "custom_product_category", "custom_item_type", "warehouse_name"]

    for d in raw_data:
        # DATA CLEANUP (None to "")
        for field in cleanup_fields:
            if d.get(field) is None: d[field] = ""
        if d.get("custom_standard_selling_price") is None: d["custom_standard_selling_price"] = 0

        # Math Logic
        unclosed = unclosed_sales_map.get((d.item_code, d.warehouse), 0)
        d.unclosed_pos_qty = unclosed
        
        # Real stock is system stock MINUS items physically sold at the counter today
        d.actual_qty = d.system_qty - unclosed
        
        # Calculation for planning
        d.final_projected = (d.actual_qty + d.ordered_qty) - d.reserved_qty

    return raw_data

def get_unclosed_pos_qty():
    # Only pick invoices where closing entry consolidation hasn't happened
    data = frappe.db.sql("""
        SELECT item.item_code, item.warehouse, SUM(item.qty) as qty
        FROM `tabPOS Invoice Item` item
        INNER JOIN `tabPOS Invoice` p ON item.parent = p.name
        WHERE p.docstatus = 1 AND (p.consolidated_invoice IS NULL OR p.consolidated_invoice = '')
        GROUP BY item.item_code, item.warehouse
    """, as_dict=1)
    return {(r.item_code, r.warehouse): r.qty for r in data}