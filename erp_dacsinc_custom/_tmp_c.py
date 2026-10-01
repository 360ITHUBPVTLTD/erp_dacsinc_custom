import frappe
def run():
    from erp_dacsinc_custom import pos_scope
    for prof in frappe.get_all("POS Profile", filters={"disabled": 0}, pluck="name"):
        print(prof, "| brands:", frappe.get_all("POS Brand", filters={"parent": prof, "parenttype": "POS Profile"}, pluck="brand"))
    admin = frappe.db.sql("""select hr.parent from `tabHas Role` hr join tabUser u on u.name=hr.parent and u.enabled=1 where hr.role='POS Admin' and hr.parenttype='User'
        and not exists (select 1 from `tabHas Role` h where h.parent=u.name and h.role in ('System Manager','Admin','Super Admin','Administrator')) and u.name != 'Administrator'""", pluck=True)
    print("POS Admin users:", admin)
    jp_brands = set(frappe.get_all("POS Brand", filters={"parent": "JP Nagar"}, pluck="brand"))
    frappe.set_user("jpnagarpos@dacsinc.in")
    # POS screen item list
    from erp_dacsinc_custom.pos_brand_filter import get_items
    res = get_items(start=0, page_length=500, price_list=frappe.db.get_value("POS Profile", "JP Nagar", "selling_price_list"), item_group="All Item Groups", pos_profile="JP Nagar", search_term="")
    items = res.get("items") if isinstance(res, dict) else res
    out = [i for i in items if frappe.db.get_value("Item", i["item_code"], "brand") not in jp_brands]
    print("POS screen items:", len(items), "| outside JP brands:", len(out))
    # opening an item of another brand
    other = frappe.db.get_value("Item", {"brand": ["not in", list(jp_brands)], "disabled": 0}, "name")
    print("open other-brand item", other, "→", frappe.has_permission("Item", "read", doc=other))
    # barcode scan in a form (ERPNext scan_barcode)
    bc = frappe.db.get_value("Item Barcode", {"parent": other}, "barcode")
    if bc:
        from erpnext.stock.utils import scan_barcode
        print("scan other-brand barcode", bc, "→", scan_barcode(bc))
    # reports
    for rep in ("Stock Balance", "Stock Ledger", "Stock Projected Qty"):
        print("report", rep, "allowed:", frappe.has_permission("Report", doc=rep) if frappe.db.exists("Report", rep) else "n/a")
    frappe.set_user("Administrator")
