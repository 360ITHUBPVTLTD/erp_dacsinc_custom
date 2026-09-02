import frappe
from frappe.utils import flt, nowdate


def _hdr(t):
    print("\n" + "=" * 74); print(t); print("=" * 74)


def execute():
    # Build a fresh DN (draft) and a fresh SI (draft) from real linked
    # documents, so both the DN and SI guards are tested while still in the
    # state (docstatus=0) where they're the operative protection — a
    # SUBMITTED document is separately blocked from any qty/rate edit by
    # core Frappe's own UpdateAfterSubmitError, before our custom guard even
    # gets a chance to matter.
    dn_name = frappe.db.get_value("Delivery Note", {"docstatus": 1}, "name", order_by="modified desc")
    print("source Delivery Note (submitted):", dn_name)

    from erpnext.stock.doctype.delivery_note.delivery_note import make_sales_invoice

    _hdr("A. DRAFT Sales Invoice mapped from that Delivery Note")
    si = make_sales_invoice(dn_name)
    si.flags.ignore_permissions = True
    si.insert(ignore_permissions=True)
    print("  created draft %s (docstatus=%s)" % (si.name, si.docstatus))
    row = si.items[0]
    print("  row: item=%-22s qty=%-7s rate=%-7s so_detail=%s dn_detail=%s delivery_note=%s"
          % (row.item_code, row.qty, row.rate, row.so_detail, row.dn_detail, row.delivery_note))

    before_qty, before_rate = flt(row.qty), flt(row.rate)

    _hdr("B. TAMPER qty AND rate on that DRAFT Sales Invoice's linked row, then .save()")
    si2 = frappe.get_doc("Sales Invoice", si.name)
    t = si2.items[0]
    t.qty = before_qty + 1
    t.rate = before_rate + 1
    si2.flags.ignore_permissions = True
    si2.save(ignore_permissions=True)
    si2.reload()
    after = si2.items[0]
    print("  attempted: qty %s -> %s   rate %s -> %s" % (before_qty, before_qty + 1, before_rate, before_rate + 1))
    print("  actual after save+reload: qty=%s rate=%s" % (after.qty, after.rate))
    print("  QTY REVERTED : %s" % (flt(after.qty) == before_qty))
    print("  RATE REVERTED: %s" % (flt(after.rate) == before_rate))

    _hdr("C. Same test on a DRAFT Sales Invoice mapped straight from the SALES ORDER (no DN)")
    so_name = frappe.db.get_value(
        "Sales Order Item", {"parenttype": "Sales Order"}, "parent",
        order_by="modified desc")
    from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice as so_make_si
    si_so = so_make_si(so_name)
    si_so.flags.ignore_permissions = True
    si_so.insert(ignore_permissions=True)
    row2 = si_so.items[0]
    print("  created draft %s from SO %s: item=%s qty=%s rate=%s so_detail=%s sales_order=%s"
          % (si_so.name, so_name, row2.item_code, row2.qty, row2.rate, row2.so_detail, row2.sales_order))
    bq, br = flt(row2.qty), flt(row2.rate)
    si_so2 = frappe.get_doc("Sales Invoice", si_so.name)
    si_so2.items[0].qty = bq + 1
    si_so2.items[0].rate = br + 1
    si_so2.flags.ignore_permissions = True
    si_so2.save(ignore_permissions=True)
    si_so2.reload()
    a2 = si_so2.items[0]
    print("  attempted: qty %s -> %s   rate %s -> %s" % (bq, bq + 1, br, br + 1))
    print("  actual: qty=%s rate=%s" % (a2.qty, a2.rate))
    print("  QTY REVERTED : %s" % (flt(a2.qty) == bq))
    print("  RATE REVERTED: %s" % (flt(a2.rate) == br))

    _hdr("D. Baseline: same tamper on a DRAFT Delivery Note (built fresh via Pick List)")
    try:
        _test_d()
    except Exception as e:
        import traceback
        print("  D FAILED:", repr(e))
        traceback.print_exc()


def _test_d():
    # Find a submitted Pick List not yet fully delivered, to build a fresh DN from.
    pl_name = frappe.db.sql("""
        SELECT pl.name FROM `tabPick List` pl
        JOIN `tabPick List Item` pli ON pli.parent = pl.name
        WHERE pl.docstatus = 1 AND (pli.picked_qty - IFNULL(pli.delivered_qty,0)) > 0
        LIMIT 1
    """, pluck=True)
    if pl_name:
        from erpnext.stock.doctype.pick_list.pick_list import create_delivery_note
        dn_new = create_delivery_note(pl_name[0])
        dn_new = frappe.get_doc(dn_new) if isinstance(dn_new, str) else dn_new
        dn_new.flags.ignore_permissions = True
        dn_new.insert(ignore_permissions=True)
        print("  created draft %s from Pick List %s" % (dn_new.name, pl_name[0]))
        rowd = dn_new.items[0]
        bqd, brd = flt(rowd.qty), flt(rowd.rate)
        print("  row: item=%s qty=%s rate=%s pick_list_item=%s so_detail=%s"
              % (rowd.item_code, rowd.qty, rowd.rate, rowd.pick_list_item, rowd.so_detail))
        dn2 = frappe.get_doc("Delivery Note", dn_new.name)
        dn2.items[0].qty = bqd + 1
        dn2.items[0].rate = brd + 1
        dn2.flags.ignore_permissions = True
        dn2.save(ignore_permissions=True)
        dn2.reload()
        ad = dn2.items[0]
        print("  attempted: qty %s -> %s   rate %s -> %s" % (bqd, bqd + 1, brd, brd + 1))
        print("  actual: qty=%s rate=%s" % (ad.qty, ad.rate))
        print("  QTY REVERTED : %s" % (flt(ad.qty) == bqd))
        print("  RATE REVERTED: %s" % (flt(ad.rate) == brd))
        frappe.delete_doc("Delivery Note", dn_new.name, force=1, ignore_permissions=True)
    else:
        print("  no submitted, not-yet-delivered Pick List available to build a fresh draft DN from")

    _hdr("CLEANUP")
    frappe.delete_doc("Sales Invoice", si.name, force=1, ignore_permissions=True)
    frappe.delete_doc("Sales Invoice", si_so.name, force=1, ignore_permissions=True)
    frappe.db.commit()
    print("scratch docs removed")
    print("DONE")
