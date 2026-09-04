import frappe

def execute():
    si = "SINV-26-00029"
    d = frappe.db.get_value("Sales Invoice", si, ["docstatus","status","update_stock","is_return"], as_dict=1)
    print(si, d)
    for r in frappe.db.sql("""
        SELECT item_code, qty, delivered_qty, so_detail, sales_order,
               dn_detail, delivery_note, warehouse
        FROM `tabSales Invoice Item` WHERE parent=%s ORDER BY idx""", si, as_dict=1):
        print("   ", dict(r))
    print("\nDNs against those SO lines:")
    for r in frappe.db.sql("""
        SELECT dni.parent, dn.docstatus, dni.item_code, dni.qty, dni.so_detail
        FROM `tabDelivery Note Item` dni JOIN `tabDelivery Note` dn ON dn.name=dni.parent
        WHERE dni.against_sales_order='SAL-ORD-2026-00122'""", as_dict=1):
        print("   ", dict(r))
    print("\nSO lines:")
    for r in frappe.db.sql("""SELECT name, item_code, qty, delivered_qty, billed_amt
                              FROM `tabSales Order Item` WHERE parent='SAL-ORD-2026-00122'""", as_dict=1):
        print("   ", dict(r))
