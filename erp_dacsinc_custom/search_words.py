"""Search by parts of words, everywhere a Link field (or the list's link boxes) searches — docs/list-search.md.

Frappe matches what is typed as one piece: "mo ra" finds only text containing "mo ra". Here the pieces (2+ letters)
are matched in order with anything between ("%mo%ra%"), so "mo ra" finds "Mohan Madhan Raj"; with 2–3 pieces the
other orders are tried too when the first gives too few ("ra mo" also finds him). One piece behaves as before.

Wired by hooks.override_whitelisted_methods over frappe.desk.search.search_link / search_widget; the custom queries
those call (ERPNext's customer_query, item_query…) also get "mo%ra", which they put inside LIKE '%…%' as well.
"""

from itertools import permutations

import frappe
from frappe.desk import search as frappe_search

MIN_PIECE = 2


def pieces(txt):
	"""The words of `txt` with at least MIN_PIECE characters (all of them if none is that long)."""
	words = (txt or "").split()
	long = [w for w in words if len(w) >= MIN_PIECE]
	return long or words


def _patterns(txt):
	"""What to send to the LIKE for `txt`: [txt] for one piece, else "a%b%c" for each order (given order first)."""
	ws = pieces(txt)
	if len(ws) < 2:
		return [txt]
	orders = list(permutations(ws)) if len(ws) <= 3 else [tuple(ws)]
	return ["%".join(o) for o in orders]


def _merge(runs, page_length, key):
	seen, out = set(), []
	for rows in runs:
		for r in rows or []:
			k = key(r)
			if k not in seen:
				seen.add(k)
				out.append(r)
			if len(out) >= page_length:
				return out
	return out


@frappe.whitelist()
def search_widget(doctype, txt, query=None, searchfield=None, start=0, page_length=10, filters=None,
				  filter_fields=None, as_dict=False, reference_doctype=None, ignore_user_permissions=False):
	pats = _patterns((txt or "").strip())
	run = lambda t: frappe_search.search_widget(doctype, t, query=query, searchfield=searchfield, start=start,
		page_length=page_length, filters=filters, filter_fields=filter_fields, as_dict=as_dict,
		reference_doctype=reference_doctype, ignore_user_permissions=ignore_user_permissions)
	if len(pats) == 1:
		return run(pats[0])
	page_length = frappe.utils.cint(page_length) or 10
	runs = []
	for p in pats:
		runs.append(run(p))
		if sum(len(r or []) for r in runs) >= page_length:
			break
	key = (lambda r: r.get("name") if isinstance(r, dict) else (r[0] if r else None))
	return _merge(runs, page_length, key)


@frappe.whitelist()
def search_link(doctype, txt, query=None, filters=None, page_length=10, searchfield=None, reference_doctype=None,
				ignore_user_permissions=False):
	results = search_widget(doctype, (txt or "").strip(), query, searchfield=searchfield, page_length=page_length,
							filters=filters, reference_doctype=reference_doctype, ignore_user_permissions=ignore_user_permissions)
	return frappe_search.build_for_autosuggest(results, doctype=doctype)
