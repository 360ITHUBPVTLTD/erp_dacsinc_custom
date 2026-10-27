import frappe, copy, subprocess, glob, os
from io import BytesIO
from pypdf import PdfReader
from PIL import Image
S="/tmp/claude-1000/-home-mohan-bench-dacsinc/d6eefb52-808f-4b17-b239-a991bca159d1/scratchpad/"
LONG = ("1528 SY NO - 165,The ALTRUIST WHITEFIELD OFF CHANNASANDRA MAIN ROAD,BESIDE GLOBAL SCHOOL,VIJAYNAGAR,Whitefeild<br>"
        "Whitefeild<br>Karnataka<br>560067<br>India<br>")
ADDR6 = "Plot No. 131,131<br>Kavuri Hills,Dwaraka Icon,Madhapur<br>HYDERABAD<br>Telangana<br>500033<br>India<br>"
def bottom(fn):
    for x in glob.glob(S+"mm-*.pgm"): os.remove(x)
    subprocess.run(["pdftoppm","-r","72","-gray","-f","1","-l","1",fn,S+"mm"])
    im=Image.open(glob.glob(S+"mm-*.pgm")[0]); w,h=im.size; px=im.load()
    rows=[y for y in range(h-45) if any(px[x,y]<200 for x in range(0,w,2))]
    return round((h-45-rows[-1])*25.4/72)
def render(tag, dt, n, pf, args, upd=None, items=0):
    frappe.db.commit = lambda *a, **k: None
    try:
        if upd: frappe.db.set_value(dt, n, upd, update_modified=False)
        d = frappe.get_doc(dt, n)
        for i in range(items - len(d.items)):
            r = copy.deepcopy(d.items[0]); r.name = None; r.idx = 50 + i; r.parent = n; r.db_insert()
        pdf = frappe.get_print(dt, n, pf, as_pdf=True, **args); fn = S + "e_" + tag + ".pdf"; open(fn, "wb").write(pdf)
        return f"{len(PdfReader(BytesIO(pdf)).pages)}p/{bottom(fn)}mm"
    finally:
        frappe.db.rollback()
def run(pf="Sales Invoice Multi Copy Master", dt="Sales Invoice", base="SINV-26-00038", args=None, namef="customer_name", addr=("address_display", "shipping_address"), flt=None):
    args = args or {}
    frappe.set_user("Administrator"); frappe.local.form_dict = frappe._dict({"copy_name": "Original"})
    flt = flt if flt is not None else ({"is_return": 0} if dt in ("Sales Invoice", "Delivery Note", "Purchase Invoice") else {})
    names = frappe.get_all(dt, filters=dict(flt, docstatus=("<", 2)), pluck="name", order_by="creation desc", limit=12)
    print("R recent:", " ".join(n[-5:] + ":" + render("r" + n[-2:], dt, n, pf, args) for n in names), flush=True)
    longaddr = {a: LONG for a in addr}; addr6 = {a: ADDR6 for a in addr}
    if namef: longaddr[namef] = "M/S. SCHOLAR ALLEY PRIVATE LIMITED - WHITEFIELD"; addr6[namef] = "M/S. BLUSPRING ENTERPRISES LIMITED - AVON TELANGANA"
    print("R long addresses 3 items:", render("long3", dt, base, pf, args, longaddr, 3))
    print("R long addresses 8 items:", render("long8", dt, base, pf, args, longaddr, 8))
    print("R bluspring-like 3 items:", render("blu3", dt, base, pf, args, addr6, 3))
    print("R 28 items:", render("i28", dt, base, pf, args, None, 28))
