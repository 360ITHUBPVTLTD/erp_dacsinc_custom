"""Blank space measured, not guessed (docs/print-formats.md › Blank rows).

A print format marks its blank-space block with `data-dacs-fill` (class `dacs-fill-wrap`: a clipped table of empty
rows). Every PDF goes through `pdfkit.from_string`; for such a page it is made twice:

1. with the blank space at 0 height and two invisible 1px markers per document: one where the blank space is, one at
   the end of that document (its `.page-break`, one per copy in a multi-copy print);
2. with each blank space as tall as the room the first PDF left under its document's last line, when that last line is
   on the page the blank space is on (else that one stays 0) — markers gone.

If the second PDF has more pages than the first (the room was over-read), or anything fails, the first layout is
printed without the blank space: it can never push anything to another page or squeeze it. HTML print previews are
not touched (the block stays hidden there).
"""

import io
import re

import frappe

MARK = "data-dacs-fill"
SPARE_MM = 3
PT_PER_MM = 72 / 25.4


def _mm(value, default):
	m = re.match(r"\s*([0-9.]+)\s*(mm|cm|in|pt|px)?\s*$", str(value or ""))
	if not m:
		return default
	n, unit = float(m.group(1)), (m.group(2) or "mm")
	return n * {"mm": 1, "cm": 10, "in": 25.4, "pt": 25.4 / 72, "px": 25.4 / 96}[unit]


def _markers(pdf_bytes):
	"""{marker: (page index, y in pt from the page bottom)} and the page count"""
	from pypdf import PdfReader

	reader = PdfReader(io.BytesIO(pdf_bytes))
	found = {}
	for p, page in enumerate(reader.pages):

		def visit(text, cm, tm, font_dict, font_size, p=p):
			for m in re.findall(r"DACS[FE]\d+Q", text or ""):
				# position = tm × cm (text matrix in user space, then the page's current matrix)
				y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
				found.setdefault(m, (p, y))

		page.extract_text(visitor_text=visit)
	return found, len(reader.pages)


def _two_pass(orig, html, options, kw):
	from bs4 import BeautifulSoup

	soup = BeautifulSoup(html, "html.parser")
	fills = soup.find_all(attrs={MARK: True})
	if not fills:
		return None
	sentinel = "display:block;height:0;overflow:visible;font-size:1px;line-height:1px;color:#fff;margin:0;padding:0;border:0;"
	for i, f in enumerate(fills):
		f["data-dacs-i"] = str(i)
		before = soup.new_tag("div", style=sentinel)
		before.string = f"DACSF{i}Q"
		f.insert_before(before)
		doc_root = f.find_parent(class_="page-break") or soup.body or soup
		end = soup.new_tag("div", style=sentinel)
		end.string = f"DACSE{i}Q"
		doc_root.append(end)

	def styled(heights):
		for i, f in enumerate(fills):
			f["style"] = (f"display:block !important;height:{heights.get(i, 0):.2f}mm !important;overflow:hidden !important;")
		return str(soup)

	first = orig(styled({}), options=options, **kw)
	found, pages = _markers(first)
	# how low the page's last line may go (mm above the paper edge): the format's own value on the marker
	# (data-dacs-fill="25": POS Invoice A5), else 15 — measured: an A4 page with no margin given takes 15mm, not
	# wkhtmltopdf's 10mm default — or the margin given, if larger; plus SPARE_MM
	margin = _mm((options or {}).get("margin-bottom"), 15)
	heights = {}
	for i in range(len(fills)):
		f, e = found.get(f"DACSF{i}Q"), found.get(f"DACSE{i}Q")
		if not f or not e or f[0] != e[0]:
			continue
		own = _mm(fills[i].get(MARK), 0)
		bottom_pt = max(margin, 15, own if own > 1 else 0) * PT_PER_MM
		room = (e[1] - bottom_pt) / PT_PER_MM - SPARE_MM
		if room > 2:
			heights[i] = room
	for s in soup.find_all(string=re.compile(r"^DACS[FE]\d+Q$")):
		s.parent.decompose()
	if not heights:
		return orig(styled({}), options=options, **kw)
	from pypdf import PdfReader

	# one retry 6mm shorter, then the layout without blank space
	for less in (0, 6):
		h = {i: v - less for i, v in heights.items() if v - less > 2}
		if not h:
			break
		out = orig(styled(h), options=options, **kw)
		if len(PdfReader(io.BytesIO(out)).pages) == pages:
			return out
	return orig(styled({}), options=options, **kw)


def patch():
	import pdfkit

	if getattr(pdfkit, "_dacs_fill", False):
		return
	orig = pdfkit.from_string

	def from_string(input, output_path=None, options=None, **kw):
		if isinstance(input, str) and MARK in input and not output_path:
			try:
				out = _two_pass(orig, input, options, kw)
				if out is not None:
					return out
			except Exception:
				frappe.logger("erp_dacsinc_custom").exception("pdf blank space: two-pass failed, plain print")
		return orig(input, output_path, options=options, **kw)

	pdfkit.from_string = from_string
	pdfkit._dacs_fill = True
