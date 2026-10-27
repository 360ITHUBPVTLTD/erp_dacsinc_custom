import frappe, copy
from frappe.utils.pdf import get_pdf
from io import BytesIO
from pypdf import PdfReader
S="/tmp/claude-1000/-home-mohan-bench-dacsinc/d6eefb52-808f-4b17-b239-a991bca159d1/scratchpad/"
LONG = ("1528 SY NO - 165,The ALTRUIST WHITEFIELD OFF CHANNASANDRA MAIN ROAD,BESIDE GLOBAL SCHOOL,VIJAYNAGAR,Whitefeild<br>"
        "Whitefeild<br>Karnataka<br>560067<br>India<br>")
def run():
    frappe.db.commit = lambda *a, **k: None
    frappe.set_user("Administrator"); frappe.local.form_dict = frappe._dict({"copy_name": "Original"})
    docs = {}
    try:
        frappe.db.set_value("Sales Invoice", "SINV-26-00038", {"customer_name": "M/S. SCHOLAR ALLEY PRIVATE LIMITED - WHITEFIELD", "address_display": LONG, "shipping_address": LONG, "contact_mobile": "6366400415"}, update_modified=False)
        docs["long3"] = frappe.get_print("Sales Invoice", "SINV-26-00038", "Sales Invoice Multi Copy Master")
    finally:
        frappe.db.rollback()
    docs["s37"] = frappe.get_print("Sales Invoice", "SINV-26-00037", "Sales Invoice Multi Copy Master")
    variants = {
      "plain": ".page-break { display: block !important; height: auto !important; } .page-break > div { display: block !important; } .page-break > .section-break > .column-break { display: block !important; } .dacs-fill-wrap { display: none !important; } .dacs-items-box { height: auto !important; } .page-break > .section-break[data-label='Items'] > .column-break > div:first-child { height: auto !important; }",
    }
    for dn, h in docs.items():
        for k, css in variants.items():
            pdf = get_pdf(h.replace("</body>", f"<style>{css}</style></body>")); open(S + dn + "_" + k + ".pdf", "wb").write(pdf)
            print("V", dn, k, len(PdfReader(BytesIO(pdf)).pages))
