"""Blank rows by a page TABLE (no estimate): the page is a table of at least the printable height whose rows are the
sections; the items row takes the spare height; the blank rows sit behind the items. Builder formats."""
import frappe, json, os, re
from io import BytesIO
from pypdf import PdfReader

APP = frappe.get_app_path("erp_dacsinc_custom", "erp_dacsinc_custom", "print_format")
MOD = "2026-10-29 12:00:00.000000"

# file, print format (for calibration), page selector(s), doc + args for calibration
BUILDER = [
	("sales_invoice_print_format_4", "Sales Invoice Multi Copy Master", ".print-copy-wrapper > .page-break, .print-format > .page-break", "Sales Invoice", "SINV-26-00020", {}),
	("sales_order_print_format_3", "Sales Order Print Format 3", ".print-format > .page-break", "Sales Order", "SAL-ORD-2026-00220", {"letterhead": "DAC Letter Header"}),
	("purchase_order_print_format", "Purchase Order Print Format", ".print-format > .page-break", "Purchase Order", "PUR-ORD-2026-00130", {"no_letterhead": 1}),
	("delivery_note_version_3", "Delivery Note Version 3", ".print-format > .page-break", "Delivery Note", "DN-26-00030", {}),
	("delivery_note_without_amount_version_3", "Delivery Note Without Amount Version 3", ".print-format > .page-break", "Delivery Note", "DN-26-00030", {}),
	("embroidery_work_order_print_format_2", "Embroidery Work Order Print Format 2", ".print-format > .page-break", "Embroidery Work Order", "EM-10-26-4064", {}),
]

FILL_CSS = """.dacs-items-box { position: relative; height: 100%; z-index: 0; }
.dacs-items-box > [data-fieldname="items"], .dacs-items-box > table { position: relative; z-index: 2; background: #fff; }
.dacs-fill-wrap { display: block !important; position: absolute; z-index: 1; top: 0; bottom: 0; left: 0; right: 0; height: auto; overflow: hidden; }"""


def table_css(sel_list, h):
	css = ["/* Page as a table (docs/print-formats.md › Blank rows): a table of at least the printable height whose rows are\n"
		   "   the sections; the items row takes the spare height, and the blank rows (empty rows with the item table's\n"
		   "   columns) sit behind the items in it. A table only grows: a longer document flows on to the next page and\n"
		   "   nothing is ever squeezed or overlapped; no estimate. */"]
	for sel in [s.strip() for s in sel_list.split(",")]:
		css.append(f"""{sel} {{ display: table; width: 100%; height: {h}mm; /* dacs page height */ border-collapse: collapse; }}
{sel} > div {{ display: table-row; }}
{sel} > .section-break:before, {sel} > .section-break:after {{ display: none; content: none; }}
{sel} > .dacs-copy-head {{ display: none; }}
{sel} > .section-break > .column-break {{ display: table-cell; float: none; width: 100%; padding-left: 0; padding-right: 0; vertical-align: top; }}
{sel} > .section-break[data-label="Items"] {{ height: 100%; }}
{sel} > .section-break[data-label="Items"] > .column-break > div:first-child {{ height: 100%; }}""")
	css.append(FILL_CSS)
	return "\n".join(css)


def strip_estimate(o):
	i = o.find("{#- page box only when")
	if i < 0:
		return o
	j = o.index("</style>{%- endif %}", i) + len("</style>{%- endif %}")
	return o[:i] + o[j:].lstrip("\n")


def load(f):
	return json.load(open(os.path.join(APP, f, f + ".json")))


def save(f, d):
	d["modified"] = MOD
	open(os.path.join(APP, f, f + ".json"), "w").write(json.dumps(d, indent=1, ensure_ascii=False, sort_keys=True) + "\n")
	frappe.reload_doc("erp_dacsinc_custom", "print_format", f, force=True)
	frappe.db.commit()


def convert(f, sel):
	d = load(f)
	fd = json.loads(d["format_data"])
	if f == "sales_invoice_print_format_4" and (fd[0].get("options") or "").strip():
		# the heading strip (TAX INVOICE, No / Date, copy label) opens the first section instead of the page header
		# block: same place on the page, but a row of the page table (Sales Invoice Multi Copy Master)
		first = next(i for i, b in enumerate(fd) if b.get("fieldtype") in ("HTML", "Custom HTML") and i > 0)
		fd[first]["options"] = fd[0]["options"].strip() + "\n" + fd[first]["options"]
		fd[0]["options"] = "{#- the heading strip is at the top of the first section (page table, docs/print-formats.md) -#}"
	k = next(i for i, b in enumerate(fd) if 'class="dacs-items-box"' in (b.get("options") or ""))
	fd[k]["options"] = strip_estimate(fd[k]["options"])
	# the totals (the block after the items, same section) get their own section: the blank rows then end at them
	if k + 1 < len(fd) and fd[k + 1].get("fieldtype") not in ("Section Break", "Column Break"):
		fd[k + 1:k + 1] = [{"fieldtype": "Section Break", "label": "Totals", "fieldname": "_section_break_totals"},
						   {"fieldtype": "Column Break"}]
	d["format_data"] = json.dumps(fd)
	css = d.get("css") or ""
	css = re.sub(r"/\* Page as a table.*?(?=\n/\*(?! Page as)|\Z)", "", css, flags=re.S).rstrip()
	d["css"] = css + "\n" + table_css(sel, 250)
	save(f, d)


def pages(pdf):
	return len(PdfReader(BytesIO(pdf)).pages)


def calibrate(f, pf, dt, name, args):
	d = load(f)
	orig = d["css"]
	lo, hi = 150.0, 290.0
	try:
		while hi - lo > 0.5:
			mid = round((lo + hi) / 2, 2)
			frappe.db.set_value("Print Format", d["name"], "css", re.sub(r"height: [\d.]+mm; /\* dacs page height \*/", f"height: {mid}mm; /* dacs page height */", orig), update_modified=False)
			frappe.clear_cache(doctype="Print Format")
			if pages(frappe.get_print(dt, name, pf, as_pdf=True, **args)) == 1: lo = mid
			else: hi = mid
	finally:
		frappe.db.set_value("Print Format", d["name"], "css", orig, update_modified=False)
		frappe.clear_cache(doctype="Print Format")
	d["css"] = re.sub(r"height: [\d.]+mm; /\* dacs page height \*/", f"height: {int(lo) - 8}mm; /* dacs page height */", orig)
	save(f, d)
	return lo


def run(only=None):
	frappe.set_user("Administrator")
	frappe.local.form_dict = frappe._dict({"copy_name": "Original"})
	for f, pf, sel, dt, name, args in BUILDER:
		if only and f != only: continue
		convert(f, sel)
		h = calibrate(f, pf, dt, name, args)
		print("TBL", f, "page height", h, "-> set", int(h) - 8, flush=True)
