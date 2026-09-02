import frappe
from frappe.utils import flt


def execute():
    if frappe.db.exists("Delivery Note", "DN-26-00032"):
        frappe.delete_doc("Delivery Note", "DN-26-00032", force=1, ignore_permissions=True)
        frappe.db.commit()
        print("removed leftover DN-26-00032 first")

    pl_name = frappe.db.sql("""
        SELECT pl.name FROM `tabPick List` pl
        JOIN `tabPick List Item` pli ON pli.parent = pl.name
        WHERE pl.docstatus = 1 AND (pli.picked_qty - IFNULL(pli.delivered_qty,0)) > 0
        LIMIT 1
    """, pluck=True)
    if not pl_name:
        print("no usable Pick List"); return
    print("using Pick List:", pl_name[0])

    from erpnext.stock.doctype.pick_list.pick_list import create_delivery_note
    dn_new = create_delivery_note(pl_name[0])
    dn_new = frappe.get_doc(dn_new) if isinstance(dn_new, str) else dn_new
    dn_new.flags.ignore_permissions = True
    dn_new.insert(ignore_permissions=True)
    print("created draft", dn_new.name)

    row = dn_new.items[0]
    bq, br = flt(row.qty), flt(row.rate)
    print("row before: item=%s qty=%s rate=%s pick_list_item=%s so_detail=%s"
          % (row.item_code, bq, br, row.pick_list_item, row.so_detail))

    dn2 = frappe.get_doc("Delivery Note", dn_new.name)
    dn2.items[0].qty = bq + 1
    dn2.items[0].rate = br + 1
    dn2.flags.ignore_permissions = True
    dn2.save(ignore_permissions=True)
    dn2.reload()
    a = dn2.items[0]
    print("attempted: qty %s -> %s   rate %s -> %s" % (bq, bq + 1, br, br + 1))
    print("actual:    qty=%s rate=%s" % (a.qty, a.rate))
    print("QTY REVERTED : %s" % (flt(a.qty) == bq))
    print("RATE REVERTED: %s" % (flt(a.rate) == br))

    frappe.delete_doc("Delivery Note", dn_new.name, force=1, ignore_permissions=True)
    frappe.db.commit()
    print("cleaned up", dn_new.name)
    print("DONE")
