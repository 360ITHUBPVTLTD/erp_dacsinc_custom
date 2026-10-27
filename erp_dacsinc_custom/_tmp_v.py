import frappe, re
from frappe.utils.pdf import get_pdf
from io import BytesIO
from pypdf import PdfReader
S="/tmp/claude-1000/-home-mohan-bench-dacsinc/d6eefb52-808f-4b17-b239-a991bca159d1/scratchpad/"
SEL = ".print-copy-wrapper > .page-break"
def run():
    frappe.set_user("Administrator"); frappe.local.form_dict = frappe._dict({"copy_name": "Original"})
    h = frappe.get_print("Sales Invoice", "SINV-26-00037", "Sales Invoice Multi Copy Master")
    open(S + "s37.html", "w").write(h)
    # what are the page-break's direct children?
    i = h.index('<div class="print-copy-wrapper">'); seg = h[i:i + 400]
    print("SEG", repr(seg[:400]))
    NC = ".page-break > .section-break:before, .page-break > .section-break:after { display: none !important; content: none !important; } "
    variants = {
      "h1": NC + ".page-break { table-layout: auto !important; } .page-break > div { height: auto !important; } .page-break > .section-break[data-label='Items'] { height: 100% !important; }",
      "h2": NC + ".page-break > div { height: auto !important; margin: 0 !important; } .page-break > .section-break[data-label='Items'] { height: 100% !important; }",
      "h3": NC + ".page-break > div { height: 0 !important; } .page-break > .section-break[data-label='Items'] { height: 100% !important; }",
    }
    for k, css in variants.items():
        hh = h.replace("</body>", f"<style>{css}</style></body>")
        pdf = get_pdf(hh); open(S + k + ".pdf", "wb").write(pdf)
        print("V", k, len(PdfReader(BytesIO(pdf)).pages))
