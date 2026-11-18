"""Order Flow › SO Approvals › Final Approve: the order's lines with their prices, editable before approving
(user, 18-11-2026). docs/order-flow-dashboard.md › "Final Approve: items and prices".

Only the Price List Rate of a line can change here (user, 18-11-2026: the rule stays — Rate is read-only, the price
is changed through the Price List Rate; docs/rate-read-only.md). The line keeps its own discount and margin. The
Rate is left to ERPNext: a changed line's Rate is cleared, and ERPNext's own calculation on save
(taxes_and_totals.calculate_item_values) sets it from the Price List Rate, the discount % and any margin, then the
taxes and totals. A line discounted by an amount (no %) keeps that amount: Rate = Price List Rate − discount amount,
as the form does. Nothing else on the order or in the approval changes.
"""

import frappe
from frappe import _
from frappe.utils import flt

from erp_dacsinc_custom.order_flow_permissions import get_sales_order_final_approvers, is_admin

STATES = ("Pending Merchandiser Approval", "Pending Final Approval")


def _check(doc):
	user = frappe.session.user
	if not (is_admin(user) or user in get_sales_order_final_approvers()):
		frappe.throw(_("Only an admin or a Sales Order final approver can change prices here."), frappe.PermissionError)
	if doc.docstatus != 0 or doc.get("workflow_state") not in STATES:
		frappe.throw(_("{0} is not waiting for approval: open it to make changes.").format(doc.name))
	doc.check_permission("write")


def _disc(row):
	"""The line's discount as a percentage (a line discounted by an amount shows its percentage)."""
	if flt(row.discount_percentage):
		return flt(row.discount_percentage)
	if flt(row.discount_amount) and flt(row.price_list_rate):
		return flt(flt(row.discount_amount) * 100 / flt(row.price_list_rate), 6)
	return 0.0


def _view(doc):
	return {
		"name": doc.name, "modified": str(doc.modified), "currency": doc.currency,
		"customer": doc.customer_name or doc.customer, "workflow_state": doc.workflow_state,
		"net_total": doc.net_total, "total_taxes_and_charges": doc.total_taxes_and_charges,
		"grand_total": doc.grand_total, "rounded_total": doc.rounded_total,
		"rows": [{
			"name": r.name, "idx": r.idx, "item_code": r.item_code, "item_name": r.item_name, "qty": r.qty, "uom": r.uom,
			"price_list_rate": flt(r.price_list_rate), "discount_percentage": _disc(r), "rate": flt(r.rate),
			"amount": flt(r.amount), "margin": bool(r.margin_type and flt(r.margin_rate_or_amount)),
		} for r in doc.items],
	}


def _set_tax_templates(doc, rows):
	"""What the form does when a price changes (erpnext transaction.js, the rate trigger): the line's GST template
	for its new net rate (an item's 5% / 18% slab, docs/item-taxes.md), from ERPNext's own get_item_tax_template —
	so the save finds every template right, as after an edit on the form (no "Item Tax template updated" alert),
	and the taxes are worked out with it."""
	from erpnext.controllers.taxes_and_totals import calculate_taxes_and_totals
	from erpnext.stock.get_item_details import get_item_tax_map, get_item_tax_template

	class _Rates(calculate_taxes_and_totals):
		"""The form's own on-screen calculation: Rate, bill discount and net rate, without the save's template check
		(which would switch the template itself and show "Item Tax template updated")."""

		def validate_item_tax_template(self):
			pass

	_Rates(doc)  # the new Rate / net rate of the changed lines (and the bill discount over them)
	for r in rows:
		if not (r.item_code and r.rate):
			continue
		tmpl = get_item_tax_template({
			"item_code": r.item_code, "company": doc.company, "base_net_rate": r.base_net_rate,
			"tax_category": doc.get("tax_category"), "item_tax_template": r.item_tax_template,
			"transaction_date": doc.get("transaction_date"),
		})
		if tmpl and tmpl != r.item_tax_template:
			r.item_tax_template = tmpl
			r.item_tax_rate = get_item_tax_map(doc.company, tmpl, as_json=True)


@frappe.whitelist()
def get_price_lines(sales_order):
	doc = frappe.get_doc("Sales Order", sales_order)
	_check(doc)
	return _view(doc)


@frappe.whitelist()
def save_price_lines(sales_order, rows, modified):
	"""rows: [{name, price_list_rate}] — only lines whose Price List Rate changed are touched.
	Refused if the order changed since the prompt opened (modified)."""
	doc = frappe.get_doc("Sales Order", sales_order)
	_check(doc)
	if str(doc.modified) != str(modified):
		frappe.throw(_("{0} was changed by someone else after you opened it. Close this and open Final Approve again.").format(doc.name))
	by_name = {r.name: r for r in doc.items}
	changed, touched = 0, []
	for x in frappe.parse_json(rows) or []:
		r = by_name.get(x.get("name"))
		if not r:
			frappe.throw(_("A line is no longer on {0}. Open Final Approve again.").format(doc.name))
		plr = flt(x.get("price_list_rate"))
		if plr < 0:
			frappe.throw(_("Row {0}: the Price List Rate cannot be negative.").format(r.idx))
		if abs(plr - flt(r.price_list_rate)) < 0.005:
			continue
		r.price_list_rate = plr
		if flt(r.discount_amount) and not flt(r.discount_percentage) and not (r.margin_type and flt(r.margin_rate_or_amount)):
			r.rate = flt(plr - flt(r.discount_amount), r.precision("rate"))  # the amount discount stays
		else:
			r.rate = 0  # ERPNext sets it again on save from the Price List Rate, the discount % and any margin
		changed += 1
		touched.append(r)
	if changed:
		_set_tax_templates(doc, touched)
		doc.save()
		frappe.get_doc({"doctype": "Comment", "comment_type": "Info", "reference_doctype": "Sales Order", "reference_name": doc.name,
		                "content": _("Prices changed on {0} line(s) at Final Approve by {1}.").format(
		                    changed, frappe.utils.get_fullname(frappe.session.user))}).insert(ignore_permissions=True)
	return {"changed": changed, **_view(doc)}
