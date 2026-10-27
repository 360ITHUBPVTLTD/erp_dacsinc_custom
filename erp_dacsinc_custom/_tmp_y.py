import frappe, copy, subprocess, glob, os
from io import BytesIO
from pypdf import PdfReader
from PIL import Image
S="/tmp/claude-1000/-home-mohan-bench-dacsinc/d6eefb52-808f-4b17-b239-a991bca159d1/scratchpad/"
ADDR6 = "Plot No. 131,131<br>Kavuri Hills,Dwaraka Icon,Madhapur<br>HYDERABAD<br>Telangana<br>500033<br>India<br>"
LONG = ("1528 SY NO - 165,The ALTRUIST WHITEFIELD OFF CHANNASANDRA MAIN ROAD,BESIDE GLOBAL SCHOOL,VIJAYNAGAR,Whitefeild<br>"
        "Whitefeild<br>Karnataka<br>560067<br>India<br>")
def bottom(fn):
    for x in glob.glob(S+"mm-*.pgm"): os.remove(x)
    subprocess.run(["pdftoppm","-r","72","-gray","-f","1","-l","1",fn,S+"mm"])
    im=Image.open(glob.glob(S+"mm-*.pgm")[0]); w,h=im.size; px=im.load()
    rows=[y for y in range(h-45) if any(px[x,y]<200 for x in range(0,w,2))]
    return round((h-45-rows[-1])*25.4/72)
def run():
    import os as _o
    app = frappe.get_app_path("erp_dacsinc_custom", "erp_dacsinc_custom", "print_format")
    for f in _o.listdir(app):
        p = _o.path.join(app, f, f + ".json")
        if _o.path.exists(p) and "2026-10-29 10:00:00" in open(p).read():
            frappe.reload_doc("erp_dacsinc_custom", "print_format", f, force=True)
    frappe.db.commit()
    frappe.db.commit = lambda *a, **k: None
    frappe.set_user("Administrator"); frappe.local.form_dict = frappe._dict({"copy_name": "Original"})
    cases = [("dn_bluspring", "Delivery Note", "DN-26-00029", "Delivery Note Without Amount Version 3", {"customer_name": "M/S. BLUSPRING ENTERPRISES LIMITED - AVON TELANGANA", "address_display": ADDR6, "shipping_address": ADDR6}, 3),
             ("dn_bluspring_amt", "Delivery Note", "DN-26-00029", "Delivery Note Version 3", {"customer_name": "M/S. BLUSPRING ENTERPRISES LIMITED - AVON TELANGANA", "address_display": ADDR6, "shipping_address": ADDR6}, 3),
             ("si_54", "Sales Invoice", "SINV-26-00038", "Sales Invoice Multi Copy Master", {"customer_name": "M/S. SCHOLAR ALLEY PRIVATE LIMITED - WHITEFIELD", "address_display": LONG, "shipping_address": LONG, "contact_mobile": "6366400415"}, 3),
             ("si_54_8items", "Sales Invoice", "SINV-26-00038", "Sales Invoice Multi Copy Master", {"customer_name": "M/S. SCHOLAR ALLEY PRIVATE LIMITED - WHITEFIELD", "address_display": LONG, "shipping_address": LONG, "contact_mobile": "6366400415"}, 8),
             ("so_long", "Sales Order", "SAL-ORD-2026-00220", "Sales Order Print Format 3", {"customer_name": "M/S. BLUSPRING ENTERPRISES LIMITED - AVON TELANGANA", "address_display": LONG, "shipping_address": LONG}, 4)]
    for tag, dt, n, pf, upd, items in cases:
        try:
            frappe.db.set_value(dt, n, upd, update_modified=False)
            d = frappe.get_doc(dt, n)
            for i in range(items - len(d.items)):
                r = copy.deepcopy(d.items[0]); r.name = None; r.idx = 50 + i; r.parent = n; r.db_insert()
            args = {"letterhead": "DAC Letter Header"} if dt == "Sales Order" else {}
            pdf = frappe.get_print(dt, n, pf, as_pdf=True, **args); fn = S + "e_" + tag + ".pdf"; open(fn, "wb").write(pdf)
            h = frappe.get_print(dt, n, pf, **args)
            print("E", tag, len(PdfReader(BytesIO(pdf)).pages), "page(s) | blank rows:", "dacs page height" in h and "dacs_free" in h and h.count("display: -webkit-box") > 0, "| bottom", bottom(fn), "mm")
        finally:
            frappe.db.rollback()
