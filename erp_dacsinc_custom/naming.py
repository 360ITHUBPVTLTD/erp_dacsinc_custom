"""Document numbers: PREFIX/26-27/00001 — the short financial year, restarting every 1 April (docs/naming-series.md).

GST: an invoice / credit note / debit note / challan number is at most 16 characters, unique in the financial year.
The base number is 14 characters, so the amended copy ERPNext makes ("-1") is still 16. ERPNext's own .FY. gives
"2026-2027" (SI/2026-2027/00001 = 17), hence the short year .FYS. ("26-27").

The series is chosen here (before_insert, every listed doctype), never by the user: a return gets its own series
(CN / DBN / SR / PRR), a Payment Entry RCT / PAY / CTR by payment type, a POS bill the store's code, a subcontracted
Purchase Order SCO. Quotation keeps
SAL-QTN-.YYYY.- (user, 29-10-2026).

Invoices, credit / debit notes and Journal Entry notes continue the client's old numbers (user, 03-11-2026): a Sales
Invoice is 36868/26-27 (number first, then the year), its returns 312, a Purchase Invoice 1661, its returns 41, a Journal
Entry Credit Note 6 and Debit Note 32 — plain running numbers. `autoname` builds these names; each series keeps its own
counter, and a number another series of the same doctype already took is skipped.
"""

import frappe
from frappe.utils import getdate

# doctype: (normal series, return series or None)
SERIES = {
	"Sales Order": ("SO/.FYS./.#####", None),
	"Delivery Note": ("DC/.FYS./.#####", "SR/.FYS./.#####"),
	"Sales Invoice": ("SI/.FYS./.#####", "CN/.#####"),
	"Material Request": ("MR/.FYS./.#####", None),
	"Request for Quotation": ("RFQ/.FYS./.####", None),
	"Supplier Quotation": ("SQ/.FYS./.#####", None),
	"Purchase Order": ("PO/.FYS./.#####", None),
	"Subcontracting Order": ("JO/.FYS./.#####", None),
	"Purchase Receipt": ("GRN/.FYS./.####", "PRR/.FYS./.####"),
	"Subcontracting Receipt": ("JR/.FYS./.#####", None),
	"Purchase Invoice": ("PI/.#####", "DBN/.#####"),
	"Journal Entry": ("JV/.FYS./.#####", None),
	"Stock Entry": ("STE/.FYS./.####", None),
	"Stock Reconciliation": ("STR/.FYS./.####", None),
}
PAYMENT = {"Receive": "RCT/.FYS./.####", "Pay": "PAY/.FYS./.####", "Internal Transfer": "CTR/.FYS./.####"}
# a Purchase Order ticked Is Subcontracted (the jobber's PO) has its own series (user, 02-11-2026)
SUBCONTRACTED_PO = "SCO/.FYS./.#####"
# Journal Entry by voucher type: the client's credit / debit note numbers (user, 03-11-2026)
JOURNAL_NOTES = {"Credit Note": "JCN/.#####", "Debit Note": "JDN/.#####"}
# series whose document name is only the number (the prefix is just the counter's key) — or number/26-27
NUMBER_ONLY = {"CN/.#####", "PI/.#####", "DBN/.#####", *JOURNAL_NOTES.values()}
NUMBER_YEAR = {"SI/.FYS./.#####"}
# POS bills: the store's code by the POS warehouse; any other counter POS/…
POS_STORE = {"JP Nagar Store - IND": "JP", "Rajajinagar Store - IND": "RN", "Varthur Store - IND": "VA",
	"POS VV Puram - IND": "VV", "VV Puram - IND": "VV"}
POS_OTHER = "POS"


def pos_series(code):
	return f"{code}/.FYS./.#####"


def all_series(doctype):
	"""every series this module can give the doctype (for the naming_series options)"""
	if doctype == "Payment Entry":
		return list(PAYMENT.values())
	if doctype == "POS Invoice":
		return [pos_series(c) for c in dict.fromkeys([*POS_STORE.values(), POS_OTHER])]
	normal, ret = SERIES[doctype]
	if doctype == "Purchase Order":
		return [normal, SUBCONTRACTED_PO]
	if doctype == "Journal Entry":
		return [normal, *JOURNAL_NOTES.values()]
	return [normal] + ([ret] if ret else [])


def short_fiscal_year(doc, variable):
	"""naming_series_variables FYS: the document's financial year as 26-27"""
	from erpnext.accounts.utils import get_fiscal_year

	# "date": Embroidery Work Order (EM/.FYS./.#####, its own autoname)
	date = getdate((doc.get("posting_date") or doc.get("transaction_date") or doc.get("schedule_date") or doc.get("date")) if doc else None)
	start, end = get_fiscal_year(date=date, company=doc.get("company") if doc else None)[1:3]
	return f"{start.year % 100:02d}-{end.year % 100:02d}"


def set_series(doc, method=None):
	"""before_insert (doc_events "*"): the series for this document; an amended copy keeps its original's name + -1"""
	dt = doc.doctype
	if dt == "Payment Entry":
		series = PAYMENT.get(doc.payment_type)
	elif dt == "POS Invoice":
		wh = doc.get("set_warehouse") or (frappe.get_cached_value("POS Profile", doc.pos_profile, "warehouse") if doc.get("pos_profile") else "")
		series = pos_series(POS_STORE.get(wh or "", POS_OTHER))
	elif dt == "Purchase Order" and doc.get("is_subcontracted"):
		series = SUBCONTRACTED_PO
	elif dt == "Journal Entry" and doc.get("voucher_type") in JOURNAL_NOTES:
		series = JOURNAL_NOTES[doc.voucher_type]
	elif dt in SERIES:
		normal, ret = SERIES[dt]
		series = ret if ret and doc.get("is_return") else normal
	else:
		return
	if series:
		doc.naming_series = series


def _counter_key(doc, series):
	"""the tabSeries row of a series: its part before the number, e.g. SI/.FYS./.##### → SI/26-27/, CN/.##### → CN/"""
	from frappe.model.naming import parse_naming_series

	return parse_naming_series(series.rsplit(".", 1)[0].split("."), doc=doc)


def autoname(doc, method=None):
	"""doc_events autoname (Sales Invoice, Purchase Invoice, Journal Entry): 36868/26-27 or a plain number for the
	client's series. Frappe calls it only for a new name — an amended copy is <original>-1 before this runs."""
	from frappe.model.naming import getseries

	series = doc.get("naming_series")
	if series not in NUMBER_ONLY and series not in NUMBER_YEAR:
		return
	key = _counter_key(doc, series)
	while True:
		number = getseries(key, 1)
		name = f"{number}/{short_fiscal_year(doc, None)}" if series in NUMBER_YEAR else number
		# Credit Note 6, 7 … meets Debit Note 32 (and PI returns PI 1661): take the next free number
		if not frappe.db.exists(doc.doctype, name):
			doc.name = name
			return


def release_number(doc, method=None):
	"""on_trash: deleting the newest 36868/26-27 frees its number, as Frappe does for PREFIX/26-27/00001 names
	(its own revert reads a number after the prefix, which these names don't have). Plain numbers it reverts itself."""
	if doc.get("naming_series") not in NUMBER_YEAR or doc.get("amended_from"):
		return
	number = (doc.name or "").split("/")[0]
	if number.isdigit():
		frappe.db.sql("update `tabSeries` set current = current - 1 where name = %s and current = %s",
			(_counter_key(doc, doc.naming_series), int(number)))
