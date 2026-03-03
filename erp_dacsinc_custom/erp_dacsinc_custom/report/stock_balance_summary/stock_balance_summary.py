import frappe
from frappe import _

def execute(filters=None):
    if not filters: filters = frappe._dict({})

    user_roles = frappe.get_roles(frappe.session.user)
    is_pos_user = "POS User" in user_roles and "System Manager" not in user_roles
    
    user_warehouse = None
    if is_pos_user:
        pos_profile = frappe.db.get_value("POS Profile User", {"user": frappe.session.user}, "parent")
        if pos_profile:
            user_warehouse = frappe.db.get_value("POS Profile", pos_profile, "warehouse")
            filters["warehouse"] = user_warehouse
            filters["report_mode"] = "Retail (POS) View"

    columns = get_columns(filters.get("report_mode"), is_pos_user)
    data = get_data(filters, is_pos_user, user_warehouse)

    return columns, data

def get_columns(report_mode, is_pos_user):
    columns = [
        {"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 180},
        {"label": _("Item Group"), "fieldname": "item_group", "fieldtype": "Link", "options": "Item Group", "width": 120},
        {"label": _("Brand"), "fieldname": "brand", "fieldtype": "Link", "options": "Brand", "width": 100},
        {"label": _("Warehouse"), "fieldname": "warehouse", "fieldtype": "Link", "options": "Warehouse", "width": 140},
    ]

    if not is_pos_user:
        columns.append({"label": _("System Bal"), "fieldname": "system_qty", "fieldtype": "Float", "width": 110})

    columns.append({"label": _("Actual Stock"), "fieldname": "actual_qty", "fieldtype": "Float", "width": 110})

    if is_pos_user or report_mode == "Retail (POS) View":
        columns += [
            {"label": _("MR Raised (Draft)"), "fieldname": "mr_draft_display", "fieldtype": "Data", "width": 160},
            {"label": _("MR Approved (Sub)"), "fieldname": "mr_sub_display", "fieldtype": "Data", "width": 160},
            {"label": _("Transfer (Draft)"), "fieldname": "se_draft_display", "fieldtype": "Data", "width": 180},
        ]
    else:
        columns += [
            {"label": _("Reserved (SO)"), "fieldname": "reserved_qty", "fieldtype": "Float", "width": 110},
            {"label": _("Coming (PO)"), "fieldname": "ordered_qty", "fieldtype": "Float", "width": 110},
            {"label": _("Projected"), "fieldname": "final_projected", "fieldtype": "Float", "width": 110},
        ]
    
    return columns

def get_data(filters, is_pos_user, user_warehouse):
    params = {}
    conditions = ["item.disabled = 0"]

    # Filter Mappings
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

    # Warehouse Category Logic
    retail_ws = frappe.get_all("POS Profile", pluck="warehouse")
    retail_ws = [w for w in retail_ws if w]

    if is_pos_user and user_warehouse:
        conditions.append("bin.warehouse = %(user_wh)s")
        params["user_wh"] = user_warehouse
    elif filters.get("report_mode") == "Retail (POS) View" and retail_ws:
        conditions.append("bin.warehouse IN %(retail_ws)s")
        params["retail_ws"] = retail_ws
    elif filters.get("report_mode") == "Back-Office Only" and retail_ws:
        # SHOW MAIN WAREHOUSES ONLY
        conditions.append("bin.warehouse NOT IN %(retail_ws)s")
        params["retail_ws"] = retail_ws

    where_clause = " AND ".join(conditions)

    bin_data = frappe.db.sql(f"""
        SELECT bin.item_code, bin.warehouse, item.item_group, item.brand,
               bin.actual_qty as system_qty, bin.reserved_qty, bin.ordered_qty
        FROM `tabBin` bin 
        INNER JOIN `tabItem` item ON bin.item_code = item.name
        WHERE {where_clause} 
        AND (bin.actual_qty != 0 OR bin.reserved_qty != 0 OR bin.ordered_qty != 0)
        ORDER BY bin.warehouse, bin.item_code
    """, params, as_dict=1)

    unclosed_sales = get_unclosed_pos_qty()
    mr_data = get_mr_stats()
    se_data = get_se_draft_stats()

    for d in bin_data:
        key = (d.item_code, d.warehouse)
        unclosed = unclosed_sales.get(key, 0)
        d.actual_qty = d.system_qty - unclosed
        d.final_projected = (d.actual_qty + d.ordered_qty) - d.reserved_qty

        # Initialization
        d.mr_draft_display = ""
        d.mr_sub_display = ""
        d.se_draft_display = ""
        d.se_names = ""

        # Map Pipeline
        for status, fieldname in [(0, "mr_draft_display"), (1, "mr_sub_display")]:
            stat = mr_data.get(key, {}).get(status)
            if stat and stat["count"] > 0:
                d[fieldname] = f"{int(stat['count'])} Docs ({stat['qty']} Qty)"

        se_stat = se_data.get(key)
        if se_stat and se_stat["count"] > 0:
            d.se_draft_display = f"{int(se_stat['count'])} Drafts ({se_stat['qty']} Qty)"
            d.se_names = se_stat["names"]

    return bin_data

def get_mr_stats():
    res = frappe.db.sql("""
        SELECT i.item_code, m.set_warehouse as warehouse, m.docstatus, 
               COUNT(DISTINCT m.name) as count, SUM(i.qty) as qty
        FROM `tabMaterial Request` m JOIN `tabMaterial Request Item` i ON m.name = i.parent
        WHERE m.material_request_type = 'Material Transfer' AND m.docstatus < 2
        GROUP BY i.item_code, warehouse, m.docstatus
    """, as_dict=1)
    
    out = {}
    for r in res:
        key = (r.item_code, r.warehouse)
        if key not in out: out[key] = {}
        out[key][r.docstatus] = {"count": r.count, "qty": r.qty}
    return out

def get_se_draft_stats():
    res = frappe.db.sql("""
        SELECT i.item_code, i.t_warehouse as warehouse, 
               COUNT(DISTINCT s.name) as count, SUM(i.qty) as qty, 
               GROUP_CONCAT(DISTINCT s.name) as ids
        FROM `tabStock Entry` s JOIN `tabStock Entry Detail` i ON s.name = i.parent
        WHERE s.stock_entry_type = 'Material Transfer' AND s.docstatus = 0
        GROUP BY i.item_code, warehouse
    """, as_dict=1)
    return {(r.item_code, r.warehouse): {"count": r.count, "qty": r.qty, "names": r.ids} for r in res}

def get_unclosed_pos_qty():
    res = frappe.db.sql("""
        SELECT item.item_code, item.warehouse, SUM(item.qty) as qty
        FROM `tabPOS Invoice Item` item INNER JOIN `tabPOS Invoice` p ON item.parent = p.name
        WHERE p.docstatus = 1 AND (p.consolidated_invoice IS NULL OR p.consolidated_invoice = '')
        GROUP BY item.item_code, item.warehouse
    """, as_dict=1)
    return {(r.item_code, r.warehouse): r.qty for r in res}