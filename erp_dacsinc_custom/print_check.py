"""Read-only check after a deploy: are the app's print formats loaded on this site, and do they print?
(docs/print-formats.md › Checking a site)

    bench --site <site> execute erp_dacsinc_custom.print_check.run

For every print format shipped in this app it reports whether the site's copy is the app's version (its
`modified` is not older than the file's), whether it carries the blank-row / discount-column markup, and how
many pages the latest documents print to. It also reports the letter head and Delivery Note button patches.
Nothing is changed. A format reported OLD can be loaded with:

    bench --site <site> execute frappe.reload_doc --args "['erp_dacsinc_custom', 'print_format', '<folder>']" --kwargs "{'force': 1}"
"""

import json
import os
import re

import frappe
from frappe.utils import get_datetime

# format, doctype, filters, print args (as the app's buttons send them)
SAMPLES = {
	"Sales Invoice Multi Copy Master": ("Sales Invoice", {"is_return": 0}, {}),
	"Sales Order Print Format 3": ("Sales Order", {}, {"letterhead": "DAC Letter Header"}),
	"Purchase Order Print Format": ("Purchase Order", {}, {"no_letterhead": 1}),
	"Subcontracting Order Print Format 3": ("Subcontracting Order", {}, {"no_letterhead": 1}),
	"Proforma Invoice Quotation": ("Quotation", {}, {}),
	"Delivery Note Version 3": ("Delivery Note", {"is_return": 0}, {}),
	"Delivery Note Without Amount Version 3": ("Delivery Note", {"is_return": 0}, {}),
	"Delivery Note Print Format with Amount": ("Delivery Note", {"is_return": 0}, {"no_letterhead": 1}),
	"Delivery Note Print Format without Amount": ("Delivery Note", {"is_return": 0}, {"no_letterhead": 1}),
	"Credit Note DAC": ("Sales Invoice", {"is_return": 1}, {}),
	"Debit Note DAC": ("Purchase Invoice", {"is_return": 1}, {}),
	"Purchase Invoice DAC": ("Purchase Invoice", {"is_return": 0}, {}),
	"Embroidery Work Order Print Format": ("Embroidery Work Order", {}, {"no_letterhead": 1}),
	"Embroidery Work Order Print Format 2": ("Embroidery Work Order", {}, {}),
	"POS Invoice A4": ("POS Invoice", {}, {}),
	"POS Invoice A5": ("POS Invoice", {}, {}),
	"POS Invoice Version 2": ("POS Invoice", {}, {}),
	"Payment Receipt DAC": ("Payment Entry", {}, {}),
}


def _pages(pdf):
	from io import BytesIO

	from pypdf import PdfReader
	return len(PdfReader(BytesIO(pdf)).pages)


def run(docs=3):
	frappe.set_user("Administrator")
	frappe.local.form_dict.copy_name = "Original"
	app = frappe.get_app_path("erp_dacsinc_custom", "erp_dacsinc_custom", "print_format")
	problems = []
	print("\nPRINT FORMATS (site copy vs app file)")
	for folder in sorted(os.listdir(app)):
		path = os.path.join(app, folder, folder + ".json")
		if not os.path.exists(path):
			continue
		f = json.load(open(path))
		name = f["name"]
		site = frappe.db.get_value("Print Format", name, ["modified", "html", "format_data", "css", "disabled"], as_dict=True)
		if not site:
			print(f"  MISSING  {name}  ({folder})"); problems.append(name); continue
		state = "OK " if get_datetime(site.modified) >= get_datetime(f["modified"]) else "OLD"
		if state == "OLD": problems.append(name)
		body = (site.html or "") + (site.format_data or "") + (site.css or "")
		if "templates/print/quotation_body.html" in body:  # shared body (Proforma / Quotation PDF)
			body += open(frappe.get_app_path("erp_dacsinc_custom", "templates", "print", "quotation_body.html")).read()
		marks = [m for m, k in (("blank rows", "dacs-fill-wrap"), ("discount cols", "dacs_disc"), ("margins", "page margins")) if k.lower() in body.lower()]
		print(f"  {state}  {name:<45} {'disabled ' if site.disabled else ''}{', '.join(marks)}")

	print("\nTEST PRINTS (latest documents: pages)")
	for pf, (dt, flt, args) in SAMPLES.items():
		if not frappe.db.exists("Print Format", pf):
			continue
		out = []
		for n in frappe.get_all(dt, filters=dict(flt, docstatus=("<", 2)), pluck="name", order_by="creation desc", limit=docs):
			try:
				items = len(frappe.get_doc(dt, n).get("items") or [])
				out.append(f"{n} ({items} items): {_pages(frappe.get_print(dt, n, pf, as_pdf=True, **args))}p")
			except Exception as e:
				out.append(f"{n}: ERROR {str(e)[:80]}"); problems.append(f"{pf} / {n}")
		print(f"  {pf:<45} " + (" | ".join(out) or "no documents"))

	print("\nFONT (the prints embed Liberation Sans from the app; DejaVu only for the ₹ sign)")
	n = frappe.get_all("Sales Invoice", filters={"docstatus": 1, "is_return": 0}, pluck="name", order_by="creation desc", limit=1)
	if n:
		from io import BytesIO
		from pypdf import PdfReader
		fonts = set()
		for page in PdfReader(BytesIO(frappe.get_print("Sales Invoice", n[0], "Sales Invoice Multi Copy Master", as_pdf=True))).pages:
			for f in ((page.get("/Resources") or {}).get("/Font") or {}).values():
				fonts.add(str(f.get_object().get("/BaseFont")).split("+")[-1])
		ok = any("Liberation" in f for f in fonts)
		print("  ", sorted(fonts), "OK" if ok else "— Liberation Sans NOT loaded: the site cannot fetch its own /assets URL (frappe.utils.get_url())")
		if not ok: problems.append("font")
	print("\nOTHER")
	lh = frappe.db.get_value("Letter Head", "DAC Letter Header", "content") or ""
	print("  Letter Head 'DAC Letter Header' bordered box:", "yes" if "border:1px solid #000" in lh else "NO")
	if frappe.db.exists("Client Script", "Delivery Note"):
		print("  Client Script 'Delivery Note' (old Custom Print buttons) enabled:", frappe.db.get_value("Client Script", "Delivery Note", "enabled"))
	for p in ("letter_head_border", "dn_print_buttons_to_app"):
		print(f"  patch {p}:", "ran" if frappe.db.exists("Patch Log", {"patch": ("like", f"%{p}%")}) else "NOT RUN")
	prof = frappe.get_all("POS Profile", fields=["name", "print_format"])
	print("  POS Profiles:", ", ".join(f"{p.name} → {p.print_format or '-'}" for p in prof))
	print("\nRESULT:", "all print formats are the app's version" if not problems else "check: " + "; ".join(problems))
