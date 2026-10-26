"""Purchase Invoice: goods are billed from their Purchase Receipt; only Service items on a direct bill.

Every line of a Purchase Invoice (not a return, not an opening entry) whose item is outside the item group
**Service** (and its sub-groups) must come from a Purchase Receipt (purchase_receipt / pr_detail): the
receipt brought the goods in (Dr Stock, Cr Stock Received But Not Billed) and the bill made from it clears
that (Purchase Flow › To Bill, docs/order-flow-dashboard.md). A goods line typed onto a bill, or billed
from the PO without a receipt, would skip the receipt — refused, naming the rows. Service items (freight /
packing / insurance charges, job work and other services) may be billed directly.
"""

import frappe
from frappe import _
from frappe.utils import cint, cstr

SERVICE_GROUP = "Service"


def service_groups():
	lft, rgt = frappe.db.get_value("Item Group", SERVICE_GROUP, ["lft", "rgt"]) or (None, None)
	if lft is None:
		return {SERVICE_GROUP}
	return set(frappe.get_all("Item Group", filters={"lft": [">=", lft], "rgt": ["<=", rgt]}, pluck="name"))


def guard_direct_goods(doc, method=None):
	if doc.doctype != "Purchase Invoice" or cint(doc.get("is_return")) or cstr(doc.get("is_opening")) == "Yes":
		return
	allowed = service_groups()
	bad = []
	for row in doc.get("items") or []:
		if not row.item_code or row.get("purchase_receipt") or row.get("pr_detail"):
			continue
		group = row.get("item_group") or frappe.get_cached_value("Item", row.item_code, "item_group")
		if group not in allowed:
			bad.append(_("Row {0}: {1} ({2})").format(row.idx, row.item_code, group))
	if bad:
		frappe.throw(_("These are goods, not services — goods are billed from their Purchase Receipt (Purchase Flow › To "
					   "Bill › Create Invoice), so the stock received is matched to the bill. Only items of the group {0} can be "
					   "on a direct bill.<br><br>{1}").format(frappe.bold(SERVICE_GROUP), "<br>".join(bad)),
					 title=_("Goods need a Purchase Receipt"))


@frappe.whitelist()
def get_service_groups():
	return sorted(service_groups())
