"""
POS Profile "Brands" filter (custom_brands -> POS Brand child table).

Works like core's Item Groups table: when a POS Profile lists any brands,
the Point of Sale item selector only loads items whose Item.brand is one of
them; an empty table means no brand restriction. Combines with Item Groups
(an item must pass both).

Core get_items() builds its item query from two module-level helpers in
erpnext.selling.page.point_of_sale.point_of_sale:
  - get_item_group_condition(pos_profile) -> SQL appended to the item list
    query (so paging/LIMIT stays correct — filtering after the query would
    drop items past the page)
  - filter_result_items(result, pos_profile) -> trims barcode / serial /
    batch scan results
Both are wrapped below to also apply the brand rule. get_items itself is
routed here via override_whitelisted_methods in hooks.py purely so this
module is guaranteed to be imported (and the wrappers installed) before
core's get_items runs; it then delegates to core unchanged.
"""

import frappe

from erpnext.selling.page.point_of_sale import point_of_sale as core_pos

_core_get_item_group_condition = core_pos.get_item_group_condition
_core_filter_result_items = core_pos.filter_result_items


def get_pos_brands(pos_profile):
	if not pos_profile:
		return []
	doc = frappe.get_cached_doc("POS Profile", pos_profile)
	return list({d.brand for d in doc.get("custom_brands") or [] if d.brand})


def get_item_group_condition(pos_profile):
	cond = _core_get_item_group_condition(pos_profile)
	brands = get_pos_brands(pos_profile)
	if brands:
		cond += " and item.brand in ({})".format(", ".join(frappe.db.escape(b) for b in brands))
	return cond


def filter_result_items(result, pos_profile):
	_core_filter_result_items(result, pos_profile)
	brands = get_pos_brands(pos_profile)
	if brands and result and result.get("items"):
		result["items"] = [
			item
			for item in result["items"]
			if frappe.get_cached_value("Item", item.get("item_code"), "brand") in brands
		]


if not getattr(core_pos, "_dacsinc_brand_filter", False):
	core_pos.get_item_group_condition = get_item_group_condition
	core_pos.filter_result_items = filter_result_items
	core_pos._dacsinc_brand_filter = True


@frappe.whitelist()
def get_items(start, page_length, price_list, item_group, pos_profile, search_term=""):
	return core_pos.get_items(start, page_length, price_list, item_group, pos_profile, search_term)
