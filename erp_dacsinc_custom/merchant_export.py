"""GST 0.1% for supplies to a merchant exporter (Notifications 40/2017 and 41/2017) — docs/item-taxes.md.

- The template "GST 0.1% - IND" (CGST 0.05 + SGST 0.05, IGST 0.1) is made from "GST 5% - IND" with every rate
  scaled down, so it posts to the same GST accounts (patches/merchant_export_gst.py).
- Every item on a GST rate lists it last in its Taxes table (custom_script.update_tax_child → item_rows): it is
  never picked by itself; a user picks it on the line, as with Exempted.
- A sales line may carry it only for a customer ticked "Merchant Exporter (0.1% GST)" (guard_merchant_export):
  0.1% charged to anyone else is GST under-paid.
- The document tick "Merchant Export - GST 0.1%" (Quotation / Sales Order / Delivery Note / Sales Invoice) puts
  every line on it, and unticking puts them back on their normal GST (apply_document_tick; the form does the same
  at once, public/js/merchant_export.js).
"""

import frappe
from frappe import _

TEMPLATE = "GST 0.1% - IND"
TITLE = "GST 0.1%"
SOURCE = "GST 5% - IND"
RATE = 0.1
CUSTOMER_FIELD = "custom_merchant_exporter"
DOC_FIELD = "custom_merchant_export"   # the tick on Quotation / Sales Order / Delivery Note / Sales Invoice
TICK_DOCTYPES = ("Quotation", "Sales Order", "Delivery Note", "Sales Invoice")
# items whose own rate is one of these get no 0.1% rows (no GST on them at all)
NO_GST = ("Exempted - IND", "Nil-Rated - IND", "Non-GST - IND")


def ensure_template():
	"""Make "GST 0.1% - IND" from "GST 5% - IND": the same accounts, each rate × 0.1/5 (signs kept)."""
	if frappe.db.exists("Item Tax Template", TEMPLATE):
		return TEMPLATE
	src = frappe.get_doc("Item Tax Template", SOURCE)
	factor = RATE / src.gst_rate
	doc = frappe.get_doc({
		"doctype": "Item Tax Template", "title": TITLE, "company": src.company,
		"gst_treatment": "Taxable", "gst_rate": RATE,
		"taxes": [{"tax_type": t.tax_type, "tax_rate": round(t.tax_rate * factor, 4)} for t in src.taxes],
	})
	doc.insert(ignore_permissions=True)
	return doc.name


def item_rows(doc):
	"""The two 0.1% rows (In-State, Out-State) for an item already holding its GST rows, appended last. On a slab
	item (rows with a price range) they carry the full range like its Exempted rows — a row without a range would
	be skipped while a ranged one fits — on any other item none."""
	if not frappe.db.exists("Item Tax Template", TEMPLATE):
		return []
	taxes = doc.get("taxes") or []
	if not any(t.item_tax_template and t.item_tax_template not in NO_GST for t in taxes):
		return []
	slab = any((t.get("maximum_net_rate") or 0) > 0 or (t.get("minimum_net_rate") or 0) > 0 for t in taxes)
	from erp_dacsinc_custom.custom_script import SLAB_UPPER_LIMIT
	return [{"tax_category": c, "item_tax_template": TEMPLATE, **({"maximum_net_rate": SLAB_UPPER_LIMIT} if slab else {})}
			for c in ("In-State", "Out-State")]


def guard_merchant_export(doc, method=None):
	"""validate of Quotation / Sales Order / Delivery Note / Sales Invoice / POS Invoice: lines at 0.1% only for a
	customer ticked Merchant Exporter."""
	rows = [r.idx for r in doc.get("items") or [] if r.get("item_tax_template") == TEMPLATE]
	if not rows:
		return
	customer = doc.get("customer")
	if doc.doctype == "Quotation":
		customer = doc.party_name if doc.get("quotation_to") == "Customer" else None
	if customer and frappe.db.get_value("Customer", customer, CUSTOMER_FIELD):
		return
	frappe.throw(
		_("Row(s) {0}: GST 0.1% is only for a merchant exporter. Tick <b>Merchant Exporter (0.1% GST)</b> on the "
		  "customer {1} (only when they buy to export), or set these lines back to their normal GST template.").format(
			", ".join(map(str, rows)), frappe.bold(customer or _("(not a customer yet)"))),
		title=_("GST 0.1% not allowed"))


def _customer(doc):
	if doc.doctype == "Quotation":
		return doc.party_name if doc.get("quotation_to") == "Customer" else None
	return doc.get("customer")


def _default_template(doc, row, item, tax_category=None):
	"""The template the line gets by itself (the item's first fitting row) — never GST 0.1%, which comes last."""
	from erpnext.stock.get_item_details import get_item_tax_template
	date = doc.get("posting_date") or doc.get("transaction_date")
	args = {"company": doc.company, "tax_category": tax_category or doc.get("tax_category"),
			"base_net_rate": row.get("base_net_rate") or row.get("base_rate") or row.get("rate"),
			"posting_date": date, "transaction_date": date}
	return get_item_tax_template(args, item, frappe._dict())


def apply_document_tick(doc, method=None):
	"""before_validate (after tax_category.set_document_tax_category). Ticked: every line whose item lists GST 0.1%
	gets it (new lines too); items without it (Exempted / Nil-Rated / Non-GST) keep theirs. Unticked after being
	ticked: the GST 0.1% lines go back to their normal template. A line set to 0.1% by hand on an unticked
	document is left alone."""
	if not doc.meta.has_field(DOC_FIELD) or frappe.utils.cint(doc.docstatus) != 0:
		return
	from erpnext.stock.get_item_details import get_item_tax_map
	ticked = frappe.utils.cint(doc.get(DOC_FIELD))
	before = doc.get_doc_before_save() if not doc.is_new() else None
	was_ticked = frappe.utils.cint(before.get(DOC_FIELD)) if before else 0
	if ticked:
		customer = _customer(doc)
		if not (customer and frappe.db.get_value("Customer", customer, CUSTOMER_FIELD)):
			frappe.throw(_("<b>Merchant Export - GST 0.1%</b> is only for a customer ticked <b>Merchant Exporter (0.1% GST)</b>. "
						   "Untick it here, or tick the customer {0} first (only when they buy to export).").format(
				frappe.bold(customer or _("(not a customer yet)"))), title=_("GST 0.1% not allowed"))
	elif not was_ticked:
		return
	for row in doc.get("items") or []:
		if not row.item_code:
			continue
		item = frappe.get_cached_doc("Item", row.item_code)
		if ticked:
			if any(t.item_tax_template == TEMPLATE for t in item.taxes):
				tpl = TEMPLATE
			else:
				continue
		elif row.item_tax_template == TEMPLATE:
			tpl = _default_template(doc, row, item)
		else:
			continue
		if tpl and tpl != row.item_tax_template:
			row.item_tax_template = tpl
			row.item_tax_rate = get_item_tax_map(doc.company, tpl, as_json=True)


@frappe.whitelist()
def get_default_templates(doc):
	"""For the form's untick: {row name: the line's normal template} for the lines now on GST 0.1% (the form's
	current values, saved or not)."""
	doc = frappe.get_doc(frappe.parse_json(doc))
	if doc.doctype not in TICK_DOCTYPES:
		return {}
	frappe.has_permission(doc.doctype, "write", throw=True)
	out = {}
	for row in doc.get("items") or []:
		if row.item_code and row.item_tax_template == TEMPLATE:
			out[row.name] = _default_template(doc, row, frappe.get_cached_doc("Item", row.item_code))
	return out


@frappe.whitelist()
def items_with_template(item_codes):
	"""The items (of these) that list GST 0.1% — the form puts only those lines on it."""
	codes = list(set(frappe.parse_json(item_codes) or []))
	if not codes:
		return []
	return frappe.get_all("Item Tax", filters={"parenttype": "Item", "parent": ["in", codes], "item_tax_template": TEMPLATE},
						  pluck="parent", distinct=True)
