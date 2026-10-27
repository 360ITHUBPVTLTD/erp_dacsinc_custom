import frappe
from frappe.utils.pdf import get_pdf
from io import BytesIO
from pypdf import PdfReader
S="/tmp/claude-1000/-home-mohan-bench-dacsinc/d6eefb52-808f-4b17-b239-a991bca159d1/scratchpad/"
def page(n_items, extra_head=0):
    cg = "<colgroup><col style='width:15%'><col style='width:45%'><col style='width:40%'></colgroup>"
    rows = "".join(f"<tr><td>{i+1}</td><td>Item {i+1}</td><td>10</td></tr>" for i in range(n_items))
    fill = "".join("<tr><td>&nbsp;</td><td></td><td></td></tr>" for i in range(60))
    head = "<div style='height:%dmm;border:1px solid #000'>HEADER</div>" % (40 + extra_head)
    return f"""<html><head><style>
.pg {{ display: table; width: 100%; height: 250mm; border-collapse: collapse; }}
.pg > .r {{ display: table-row; }} .pg > .r > .c {{ display: table-cell; vertical-align: top; }}
.pg > .grow {{ height: 100%; }}
.box {{ position: relative; height: 100%; min-height: 100%; }}
.fill {{ position: absolute; top: 0; bottom: 0; left: 0; right: 0; overflow: hidden; }}
table.it {{ width: 100%; border-collapse: collapse; table-layout: fixed; position: relative; background: #fff; }}
table.it td, table.it th {{ border: 1px solid #000; height: 6mm; padding: 0 4px; }}
table.fl td {{ border-left: 1px solid #000; border-right: 1px solid #000; border-bottom: 1px solid #ccc; height: 6mm; }}
</style></head><body><div class='print-format'>
<div class='pg'><div class='r'><div class='c'>{head}</div></div>
<div class='r grow'><div class='c'><div class='box'>
<div class='fill'><table class='it fl' style='background:transparent'>{cg}<tbody>{fill}</tbody></table></div>
<table class='it'>{cg}<thead><tr><th>Sr</th><th>Item</th><th>Qty</th></tr></thead><tbody>{rows}</tbody></table>
</div></div></div>
<div class='r'><div class='c'><div style='height:50mm;border:1px solid #000'>TOTALS + TERMS</div></div></div></div>
</div></body></html>"""
def run():
    for tag, n, xh in (("q4", 60, 0), ("q5", 22, 0)):
        pdf = get_pdf(page(n, xh)); open(S + tag + ".pdf", "wb").write(pdf)
        print("Q", tag, n, "items, header +", xh, "mm ->", len(PdfReader(BytesIO(pdf)).pages), "pages")
