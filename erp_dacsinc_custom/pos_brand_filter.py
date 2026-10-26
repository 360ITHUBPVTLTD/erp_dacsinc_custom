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


_core_get_conditions = core_pos.get_conditions
SEARCH_FIELDS = ("item.name", "item.item_name", "item.description", "item.brand", "item.item_group")


def get_conditions(search_term):
	"""The item list's search (core: code / name / POS Search Fields, the whole text as one
	phrase). Here every typed word must match somewhere — code, name, description, brand, item
	group, any barcode, or a POS Search Field — so "boys 46" finds "BRIGADE BOYS SHIRT 46"."""
	codes = frappe.local.flags.get("dacs_pos_codes")
	if codes is not None:  # get_items: the ranked matches, chosen already (_ranked_codes)
		return "item.name in ({})".format(", ".join(frappe.db.escape(c) for c in codes) or "''")
	words = (search_term or "").split()
	if not words:
		return _core_get_conditions(search_term or "")
	parts = []
	for w in words:
		like = frappe.db.escape(f"%{w}%")
		parts.append("(" + " or ".join(f"{f} like {like}" for f in SEARCH_FIELDS)
					 + f" or exists (select 1 from `tabItem Barcode` ib where ib.parent = item.name and ib.barcode like {like})"
					 + core_pos.add_search_fields_condition(w) + ")")
	return "(" + " and ".join(parts) + ")"


if not getattr(core_pos, "_dacsinc_brand_filter", False):
	core_pos.get_item_group_condition = get_item_group_condition
	core_pos.filter_result_items = filter_result_items
	core_pos.get_conditions = get_conditions
	core_pos._dacsinc_brand_filter = True


SEARCH_LIMIT = 60  # each result costs ERPNext a price + stock lookup; 200 took ~3.5 s for "br"


def _ranked_codes(term, pos_profile, item_group, limit=SEARCH_LIMIT):
	"""The items matching every typed word (get_conditions), best first: code / name equal to
	the text, code starting with it, name starting with it, a word of the name starting with it,
	anywhere in code / name, then brand / group / description / barcode only — alphabetical
	within each. Same item filters as core get_items (sellable, the profile's groups / brands)."""
	from frappe.utils.nestedset import get_root_of

	t = term.strip().lower()
	if not frappe.db.exists("Item Group", item_group):
		item_group = get_root_of("Item Group")
	lft, rgt = frappe.db.get_value("Item Group", item_group, ["lft", "rgt"])
	e = frappe.db.escape
	return frappe.db.sql_list(f"""
		select item.name from `tabItem` item
		where item.disabled = 0 and item.has_variants = 0 and item.is_sales_item = 1 and item.is_fixed_asset = 0
			and item.item_group in (select name from `tabItem Group` where lft >= {int(lft)} and rgt <= {int(rgt)})
			and {get_conditions(term)} {core_pos.get_item_group_condition(pos_profile)}
		order by case
			when lower(item.name) = {e(t)} or lower(item.item_name) = {e(t)} then 0
			when item.name like {e(t + "%")} then 1
			when item.item_name like {e(t + "%")} then 2
			when item.item_name like {e("% " + t + "%")} then 3
			when item.name like {e("%" + t + "%")} or item.item_name like {e("%" + t + "%")} then 4
			else 5 end, item.item_name
		limit {int(limit)}""")


@frappe.whitelist()
def get_items(start, page_length, price_list, item_group, pos_profile, search_term=""):
	codes = _ranked_codes(search_term, pos_profile, item_group) if (search_term or "").strip() else []
	if codes:
		# core builds each row (price, stock, UOM) for exactly these items; then keep our order
		frappe.local.flags.dacs_pos_codes = codes
		try:
			result = core_pos.get_items(0, len(codes), price_list, item_group, pos_profile, "")
		finally:
			frappe.local.flags.dacs_pos_codes = None
		rank = {c: i for i, c in enumerate(codes)}
		if isinstance(result, dict) and result.get("items"):
			result["items"].sort(key=lambda it: rank.get(it.get("item_code"), len(rank)))
	else:
		# nothing matched by text: core still tries an exact barcode / serial / batch number
		result = core_pos.get_items(start, page_length, price_list, item_group, pos_profile, search_term)
	items = (result or {}).get("items") if isinstance(result, dict) else None

	# Nothing found for the typed text: also look for it inside barcodes (Item ›
	# Barcodes). Core only matches a barcode exactly, and code / name partially.
	if search_term and not items:
		codes = frappe.get_all("Item Barcode", filters={"barcode": ["like", f"%{search_term.strip()}%"],
														"parenttype": "Item"}, pluck="parent", limit=20)
		found, seen = [], set()
		for code in dict.fromkeys(codes):
			r = core_pos.get_items(0, 5, price_list, item_group, pos_profile, code) or {}
			for it in r.get("items") or []:
				if it.get("item_code") == code and code not in seen:
					seen.add(code)
					found.append(it)
		if found:
			result = {"items": found}
			items = found

	# Every item carries its barcodes, so the Point of Sale screen's own search (over
	# the items it has loaded) finds an item by any of its barcodes too.
	if items:
		by_item = {}
		for b in frappe.get_all("Item Barcode", filters={"parent": ["in", [i.get("item_code") for i in items]],
														 "parenttype": "Item"}, fields=["parent", "barcode"]):
			by_item.setdefault(b.parent, []).append(b.barcode)
		for it in items:
			codes = by_item.get(it.get("item_code"))
			if codes:
				it["barcodes"] = codes  # for searching only; "barcode" stays as core set it
	return result
