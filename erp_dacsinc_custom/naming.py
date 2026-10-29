"""Document numbers: PREFIX/26-27/00001 — the short financial year, restarting every 1 April (docs/naming-series.md).

GST: an invoice / credit note / debit note / challan number is at most 16 characters, unique in the financial year.
The base number is 14 characters, so the amended copy ERPNext makes ("-1") is still 16. ERPNext's own .FY. gives
"2026-2027" (SI/2026-2027/00001 = 17), hence the short year .FYS. ("26-27").

The series is chosen here (before_insert, every listed doctype), never by the user: a return gets its own series
(CN / DBN / SR / PRR), a Payment Entry RCT / PAY / CTR by payment type, a POS bill the store's code. Quotation keeps
SAL-QTN-.YYYY.- (user, 29-10-2026).
"""

import frappe
from frappe.utils import getdate

# doctype: (normal series, return series or None)
SERIES = {
	"Sales Order": ("SO/.FYS./.#####", None),
	"Delivery Note": ("DC/.FYS./.#####", "SR/.FYS./.#####"),
	"Sales Invoice": ("SI/.FYS./.#####", "CN/.FYS./.#####"),
	"Material Request": ("MR/.FYS./.#####", None),
	"Request for Quotation": ("RFQ/.FYS./.####", None),
	"Supplier Quotation": ("SQ/.FYS./.#####", None),
	"Purchase Order": ("PO/.FYS./.#####", None),
	"Subcontracting Order": ("JO/.FYS./.#####", None),
	"Purchase Receipt": ("GRN/.FYS./.####", "PRR/.FYS./.####"),
	"Subcontracting Receipt": ("JR/.FYS./.#####", None),
	"Purchase Invoice": ("PI/.FYS./.#####", "DBN/.FYS./.####"),
	"Journal Entry": ("JV/.FYS./.#####", None),
	"Stock Entry": ("STE/.FYS./.####", None),
	"Stock Reconciliation": ("STR/.FYS./.####", None),
}
PAYMENT = {"Receive": "RCT/.FYS./.####", "Pay": "PAY/.FYS./.####", "Internal Transfer": "CTR/.FYS./.####"}
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
	return [normal] + ([ret] if ret else [])


def short_fiscal_year(doc, variable):
	"""naming_series_variables FYS: the document's financial year as 26-27"""
	from erpnext.accounts.utils import get_fiscal_year

	date = getdate((doc.get("posting_date") or doc.get("transaction_date") or doc.get("schedule_date")) if doc else None)
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
	elif dt in SERIES:
		normal, ret = SERIES[dt]
		series = ret if ret and doc.get("is_return") else normal
	else:
		return
	if series:
		doc.naming_series = series
