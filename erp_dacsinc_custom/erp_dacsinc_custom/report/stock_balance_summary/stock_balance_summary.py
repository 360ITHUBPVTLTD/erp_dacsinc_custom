import frappe
from frappe import _

def execute(filters=None):
    if not filters: filters = frappe._dict({})

    # 1. Security Logic
    filters = restrict_to_pos_user_warehouse(filters)

    # 2. Get Dynamic Columns
    columns = get_columns(filters)

    # 3. Get Report Data
    data = get_data(filters)

    return columns, data

def restrict_to_pos_user_warehouse(filters):
    user = frappe.session.user
    roles = frappe.get_roles(user)
    if "POS User" in roles and "System Manager" not in roles:
        pos_profile = frappe.db.get_value("POS Profile User", {"user": user}, "parent")
        if pos_profile:
            wh = frappe.db.get_value("POS Profile", pos_profile, "warehouse")
            if wh:
                filters["warehouse"] = wh
                filters["report_mode"] = "Retail (POS) View"
    return filters

def get_columns(filters):
    columns = [
        {"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 200},
        {"label": _("Item Group"), "fieldname": "item_group", "fieldtype": "Link", "options": "Item Group", "width": 120},
        {"label": _("Brand"), "fieldname": "brand", "fieldtype": "Link", "options": "Brand", "width": 100},
        {"label": _("Warehouse"), "fieldname": "warehouse_name", "fieldtype": "Data", "width": 140},
    ]

    # Formulas are now visible to the user
    if filters.get("report_mode") == "Retail (POS) View":
        columns += [
            {"label": _("System Bal"), "fieldname": "system_qty", "fieldtype": "Float", "width": 90},
            {"label": _("Counter Sales"), "fieldname": "unclosed_pos_qty", "fieldtype": "Float", "width": 100},
            {"label": _("Actual Stock"), "fieldname": "actual_qty", "fieldtype": "Float", "width": 100},
        ]
    else:
        columns += [
            {"label": _("Actual Stock"), "fieldname": "actual_qty", "fieldtype": "Float", "width": 100},
        ]

    # THESE COLUMNS EXPLAIN THE PROJECTED BALANCE
    columns += [
        {"label": _("Coming (PO)"), "fieldname": "ordered_qty", "fieldtype": "Float", "width": 90},
        {"label": _("Reserved (SO)"), "fieldname": "reserved_qty", "fieldtype": "Float", "width": 90},
        {"label": _("Projected Bal"), "fieldname": "final_projected", "fieldtype": "Float", "width": 110},
    ]
    return columns

def get_data(filters):
    params = {}
    conditions = ["item.disabled = 0"]

    mapping = {
        "item_code": "bin.item_code",
        "warehouse": "bin.warehouse",
        "item_group": "item.item_group",
        "brand": "item.brand",
        "custom_product_category": "item.custom_product_category"
    }

    for key, path in mapping.items():
        if filters.get(key):
            conditions.append(f"{path} = %({key})s")
            params[key] = filters.get(key)

    retail_ws = frappe.get_all("POS Profile", pluck="warehouse")
    retail_ws = [w for w in retail_ws if w]

    if filters.get("report_mode") == "Retail (POS) View" and retail_ws:
        conditions.append("bin.warehouse IN %(retail_ws)s")
        params["retail_ws"] = retail_ws
    elif filters.get("report_mode") == "Back-Office Only" and retail_ws:
        conditions.append("bin.warehouse NOT IN %(retail_ws)s")
        params["retail_ws"] = retail_ws

    where_clause = " AND ".join(conditions)

    bin_data = frappe.db.sql(f"""
        SELECT 
            bin.item_code, item.item_name, item.item_group, item.brand,
            wh.warehouse_name, bin.warehouse,
            bin.actual_qty as system_qty, bin.reserved_qty, bin.ordered_qty
        FROM `tabBin` bin
        INNER JOIN `tabItem` item ON bin.item_code = item.name
        INNER JOIN `tabWarehouse` wh ON bin.warehouse = wh.name
        WHERE {where_clause} 
        AND (bin.actual_qty != 0 OR bin.reserved_qty != 0 OR bin.ordered_qty != 0)
        ORDER BY bin.warehouse, bin.item_code
    """, params, as_dict=1)

    unclosed_sales = get_unclosed_pos_qty()

    for d in bin_data:
        # 1. Clean NULLS
        for field in ["item_group", "brand", "warehouse_name"]:
            if d.get(field) is None: d[field] = ""
        
        # 2. Logic: Real Actual vs System Actual
        unclosed = unclosed_sales.get((d.item_code, d.warehouse), 0)
        d.unclosed_pos_qty = unclosed
        d.actual_qty = d.system_qty - unclosed

        # 3. Final Projected Calculation (THE FORMULA)
        # We add what's on its way and subtract what's already promised in SO
        d.final_projected = (d.actual_qty + d.ordered_qty) - d.reserved_qty

    return bin_data

def get_unclosed_pos_qty():
    res = frappe.db.sql("""
        SELECT item.item_code, item.warehouse, SUM(item.qty) as qty
        FROM `tabPOS Invoice Item` item
        INNER JOIN `tabPOS Invoice` p ON item.parent = p.name
        WHERE p.docstatus = 1 AND (p.consolidated_invoice IS NULL OR p.consolidated_invoice = '')
        GROUP BY item.item_code, item.warehouse
    """, as_dict=1)
    return {(r.item_code, r.warehouse): r.qty for r in res}