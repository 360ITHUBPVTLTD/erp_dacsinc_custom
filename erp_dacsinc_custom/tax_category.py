"""Tax Category follows the GST situation — In-State or Out-State — never a stale master value.

Why: every item's Taxes table has rows only for Tax Category In-State and Out-State (5% / 18% slab,
Exempted — docs/item-taxes.md). ERPNext picks a line's Item Tax Template only from rows of the
document's Tax Category; with a blank or wrong category the line gets no template (or the wrong
one) and is taxed at the header template's rate — an SEZ invoice for a 5% item went out at 18%
IGST (SINV-26-00035: customer with no Tax Category). The Tax Category comes from the Customer
(or address); India Compliance chooses the right GST template but never sets the category.

Two rules:
- Customer (validate) / Address (on_update): Out-State when the GST category is SEZ / Overseas or
  the billing address is in another state than the company; else In-State.
- Quotation / Sales Order / Delivery Note / Sales Invoice drafts (before_validate): the same
  decision from the document itself, with India Compliance's own test (is_inter_state_supply:
  SEZ, or place of supply ≠ company GSTIN state). Lines with no Item Tax Template, or one not valid
  for that category, get the item's first valid row (ERPNext's get_item_tax_template — price slab
  and Exempted rows respected); a GST template of the other category is swapped for the matching one.

Purchases the same way (Purchase Order / Receipt / Invoice drafts, Supplier, Address): the supplier's
state (its GSTIN on the document, else the Supplier's GSTIN, else its address) against the company's
GSTIN state — same state In-State (CGST + SGST), another state / SEZ / Overseas Out-State (IGST); the
Purchase Taxes and Charges Template of the other category is swapped for this one, keeping the amounts
typed on its non-GST rows. Without this an out-of-state supplier's bill kept "Input GST In-state" (the
default template; new Suppliers default to In-State) and India Compliance refused it: "Cannot charge
CGST/SGST for inter-state supplies".

Other categories (Reverse Charge, Registered Composition) are chosen on purpose and left alone; so
are returns made against an invoice (they copy it).
"""

import frappe
from frappe import _
from frappe.utils import cint, cstr

AUTO = ("", "In-State", "Out-State")
SALES = ("Quotation", "Sales Order", "Delivery Note", "Sales Invoice")
PURCHASE = ("Purchase Order", "Purchase Receipt", "Purchase Invoice")


def _company_state_code(company=None):
	company = company or frappe.defaults.get_global_default("company") or frappe.db.get_single_value("Global Defaults", "default_company")
	gstin = frappe.db.get_value("Company", company, "gstin") if company else None
	return cstr(gstin)[:2] or None


# ── Customer ──────────────────────────────────────────────────────────────────────────────────

def customer_tax_category(customer, gst_category=None, address=None):
	"""In-State / Out-State for a customer, or None when it can't be told (no address yet).
	State: the billing address's GSTIN, else the customer's GSTIN (a registered customer is billed
	in its GSTIN's state), else the address's state; an address outside India is Out-State."""
	c = frappe.db.get_value("Customer", customer, ["gst_category", "gstin"], as_dict=1) or frappe._dict()
	gst_category = gst_category or c.gst_category
	if gst_category in ("SEZ", "Overseas"):
		return "Out-State"
	if not address:
		address = frappe.db.get_value("Customer", customer, "customer_primary_address")
	if not address:
		rows = frappe.db.sql("""SELECT a.name FROM `tabAddress` a JOIN `tabDynamic Link` dl ON dl.parent = a.name
			WHERE dl.link_doctype = 'Customer' AND dl.link_name = %s AND dl.parenttype = 'Address' AND a.disabled = 0
			ORDER BY a.is_primary_address DESC, a.address_type = 'Billing' DESC, a.creation LIMIT 1""", customer)
		address = rows[0][0] if rows else None
	if not address:
		return None
	a = frappe.db.get_value("Address", address, ["gst_state_number", "gstin", "country"], as_dict=1) or {}
	if a.get("country") and a.country != "India":
		return "Out-State"
	state = cstr(a.get("gstin"))[:2] or cstr(c.gstin)[:2] or cstr(a.get("gst_state_number"))
	home = _company_state_code()
	if not state or not home:
		return None
	return "In-State" if state == home else "Out-State"


def customer_validate(doc, method=None):
	if cstr(doc.tax_category) not in AUTO:
		return
	want = customer_tax_category(doc.name, doc.gst_category, doc.get("customer_primary_address")) if not doc.is_new() \
		else ("Out-State" if doc.gst_category in ("SEZ", "Overseas") else None)
	if want and want != doc.tax_category:
		doc.tax_category = want


def address_on_update(doc, method=None):
	"""An address saved: its customers' / suppliers' Tax Category follows it (their primary / billing address)."""
	for link in doc.get("links") or []:
		if link.link_doctype not in ("Customer", "Supplier") or not link.link_name:
			continue
		cur = frappe.db.get_value(link.link_doctype, link.link_name, "tax_category")
		if cstr(cur) not in AUTO:
			continue
		want = customer_tax_category(link.link_name) if link.link_doctype == "Customer" else supplier_tax_category(link.link_name)
		if want and want != cstr(cur):
			frappe.db.set_value(link.link_doctype, link.link_name, "tax_category", want, update_modified=False)


# ── Supplier ──────────────────────────────────────────────────────────────────────────────────

def supplier_tax_category(supplier, gst_category=None, gstin=None):
	"""In-State / Out-State for a supplier, or None when it can't be told. State: its GSTIN, else its
	primary / billing address (GSTIN, then state); Overseas / SEZ / an address abroad is Out-State."""
	s = frappe.db.get_value("Supplier", supplier, ["gst_category", "gstin", "supplier_primary_address"], as_dict=1) or frappe._dict()
	gst_category = gst_category or s.gst_category
	if gst_category in ("SEZ", "Overseas"):
		return "Out-State"
	state = cstr(gstin or s.gstin)[:2]
	if not state:
		address = s.supplier_primary_address
		if not address:
			rows = frappe.db.sql("""SELECT a.name FROM `tabAddress` a JOIN `tabDynamic Link` dl ON dl.parent = a.name
				WHERE dl.link_doctype = 'Supplier' AND dl.link_name = %s AND dl.parenttype = 'Address' AND a.disabled = 0
				ORDER BY a.is_primary_address DESC, a.address_type = 'Billing' DESC, a.creation LIMIT 1""", supplier)
			address = rows[0][0] if rows else None
		if address:
			a = frappe.db.get_value("Address", address, ["gst_state_number", "gstin", "country"], as_dict=1) or {}
			if a.get("country") and a.country != "India":
				return "Out-State"
			state = cstr(a.get("gstin"))[:2] or cstr(a.get("gst_state_number"))
	home = _company_state_code()
	if not state or not home:
		return None
	return "In-State" if state == home else "Out-State"


def supplier_validate(doc, method=None):
	if cstr(doc.tax_category) not in AUTO:
		return
	want = supplier_tax_category(doc.name, doc.gst_category, doc.get("gstin")) if not doc.is_new() \
		else ("Out-State" if doc.gst_category in ("SEZ", "Overseas") else (
			("In-State" if cstr(doc.get("gstin"))[:2] == _company_state_code() else "Out-State") if doc.get("gstin") else None))
	if want and want != doc.tax_category:
		doc.tax_category = want


# ── Sales documents ───────────────────────────────────────────────────────────────────────────

def _document_tax_category(doc):
	if doc.get("gst_category") in ("SEZ", "Overseas"):
		return "Out-State"
	if not doc.get("company_gstin"):
		return None
	pos = doc.get("place_of_supply")
	if not pos:
		try:
			from india_compliance.gst_india.utils import get_place_of_supply
			pos = get_place_of_supply(doc, doc.doctype)
		except Exception:
			pos = None
	if not pos:
		return None
	return "Out-State" if cstr(pos)[:2] != cstr(doc.company_gstin)[:2] else "In-State"


def _purchase_tax_category(doc):
	"""The supplier's state against the company's: on the document (India Compliance's supplier_gstin /
	supplier address), else the Supplier master."""
	if doc.get("gst_category") in ("SEZ", "Overseas"):
		return "Out-State"
	home = cstr(doc.get("company_gstin"))[:2] or _company_state_code(doc.company)
	state = cstr(doc.get("supplier_gstin"))[:2]
	if not state and doc.get("supplier_address"):
		a = frappe.db.get_value("Address", doc.supplier_address, ["gst_state_number", "gstin", "country"], as_dict=1) or {}
		if a.get("country") and a.country != "India":
			return "Out-State"
		state = cstr(a.get("gstin"))[:2] or cstr(a.get("gst_state_number"))
	if not state:
		return supplier_tax_category(doc.supplier) if doc.get("supplier") else None
	if not home:
		return None
	return "In-State" if state == home else "Out-State"


def set_document_tax_category(doc, method=None):
	if doc.doctype not in SALES + PURCHASE or cint(doc.docstatus) != 0:
		return
	if cint(doc.get("is_return")) and doc.get("return_against"):
		return
	if cstr(doc.get("tax_category")) not in AUTO:
		return
	purchase = doc.doctype in PURCHASE
	want = _purchase_tax_category(doc) if purchase else _document_tax_category(doc)
	if not want:
		return
	changed = cstr(doc.tax_category) != want
	doc.tax_category = want

	from erpnext.stock.get_item_details import _get_item_tax_template, get_item_tax_map, get_item_tax_template
	date = doc.get("posting_date") or doc.get("transaction_date")
	fixed = []
	for row in doc.get("items") or []:
		if not row.item_code:
			continue
		item = frappe.get_cached_doc("Item", row.item_code)
		args = {"company": doc.company, "tax_category": want, "base_net_rate": row.base_net_rate or row.base_rate or row.rate,
				"posting_date": date, "transaction_date": date}
		valid = _get_item_tax_template(args, item.taxes, for_validate=True) if item.taxes else []
		if row.item_tax_template and (row.item_tax_template in valid or not item.taxes):
			continue
		tpl = get_item_tax_template(args, item, frappe._dict())
		if tpl and tpl != row.item_tax_template:
			row.item_tax_template = tpl
			row.item_tax_rate = get_item_tax_map(doc.company, tpl, as_json=True)
			fixed.append(row.idx)

	# the header GST template of the other category → the one for this category (the default one when
	# several exist); amounts typed on its non-GST rows (freight, packing…) are kept
	master = "Purchase Taxes and Charges Template" if purchase else "Sales Taxes and Charges Template"
	cur_cat = frappe.db.get_value(master, doc.taxes_and_charges, "tax_category") if doc.get("taxes_and_charges") else None
	swapped = None
	if cur_cat in ("In-State", "Out-State") and cur_cat != want:
		new = frappe.db.get_value(master, {"company": doc.company, "tax_category": want, "disabled": 0}, "name",
								  order_by="is_default desc, name asc")
		if new:
			from erpnext.controllers.accounts_controller import get_taxes_and_charges
			typed = {t.account_head: t for t in doc.get("taxes") or []
					 if t.charge_type == "Actual" and (t.tax_amount or t.get("base_tax_amount"))}
			doc.taxes_and_charges = new
			doc.set("taxes", [])
			for t in get_taxes_and_charges(master, new) or []:
				old = typed.pop(t.get("account_head"), None)
				if old:
					t["tax_amount"] = old.tax_amount
				doc.append("taxes", t)
			for old in typed.values():
				doc.append("taxes", {k: old.get(k) for k in ("charge_type", "account_head", "description", "tax_amount",
					"cost_center", "category", "add_deduct_tax", "included_in_print_rate") if old.get(k) is not None})
			swapped = new
			# India Compliance tags each GST row (igst / cgst / sgst) in its own before_validate, which ran before
			# this one; the rows above are new, and untagged rows give every item 0% in the GST breakup (HSN table)
			if "india_compliance" in frappe.get_installed_apps():
				from india_compliance.gst_india.overrides.transaction import set_gst_tax_type
				set_gst_tax_type(doc)

	if changed or fixed or swapped:
		frappe.msgprint(_("Tax Category set to {0} ({1}){2}{3}").format(
			want, _("supplier's state") if purchase else _("place of supply"),
			_(" — taxes template {0}").format(swapped) if swapped else "",
			_(" — GST template re-picked on line(s) {0}").format(", ".join(map(str, fixed))) if fixed else ""),
			indicator="blue", alert=True)
