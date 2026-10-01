"""Master data that must not leak: Customer, Supplier, Item Price.

A role with no View on one of these on the access sheet may still need to *pick* it
in a form (a Sales Order's customer, a Purchase Order's supplier), and Frappe then
needs Read on it to fetch the record's fields. The access sheet gives that Read as
a linked-document right. This module makes such a user **pick-only**:

- picking and fetching work (link search, validate_link / get_value);
- the list (list view, report view, counts, list API, REST listing) is empty;
- opening a record (form, frappe.client.get, REST read) is refused;
- link search returns at most SEARCH_CAP rows per call;
- global search drops records the user may not open.

Who is pick-only (per doctype): a non-admin whose roles include no sheet role with V
on that row and no other role reading the doctype. Only while the access sheet is
applied (access_sync.is_active). See docs/master-data-protection.md.
"""

import re
from urllib.parse import unquote

import frappe

from erp_dacsinc_custom.access_sync import SENSITIVE_MASTERS

SEARCH_CAP = 20
LIST_CMDS = {
	"frappe.desk.reportview.get", "frappe.desk.reportview.get_list", "frappe.desk.reportview.get_count",
	"frappe.desk.reportview.export_query", "frappe.desk.reportview.get_sidebar_stats",
	"frappe.desk.reportview.get_stats", "frappe.desk.listview.get_group_by_count",
	"frappe.client.get_list", "frappe.client.get_count",
}
OPEN_CMDS = {"frappe.desk.form.load.getdoc", "frappe.client.get", "frappe.desk.form.load.get_docinfo"}
SEARCH_CMDS = {"frappe.desk.search.search_link", "frappe.desk.search.search_widget"}
REST = re.compile(r"^/api/(?:resource|v2/document)/([^/]+)(/.+)?/?$")


def _cmd():
	"""The whitelisted method of this request. /api/method/<cmd> sets form_dict.cmd only
	after before_request, so the path is read too."""
	cmd = (getattr(frappe.local, "form_dict", None) or {}).get("cmd")
	if cmd:
		return cmd
	req = getattr(frappe.local, "request", None)
	path = getattr(req, "path", "") or ""
	for prefix in ("/api/method/", "/api/v1/method/", "/api/v2/method/"):
		if path.startswith(prefix):
			return path[len(prefix):].strip("/")
	return None


def _rest():
	"""(doctype, is_single_record) for a REST document request, else (None, None)."""
	req = getattr(frappe.local, "request", None)
	m = REST.match(req.path) if req is not None else None
	if not m:
		return None, None
	return unquote(m.group(1)), bool(m.group(2) and m.group(2).strip("/"))


def is_pick_only(doctype, user=None):
	if doctype not in SENSITIVE_MASTERS:
		return False
	user = user or frappe.session.user
	cache = getattr(frappe.local, "dacs_pick_only", None)
	if cache is None:
		cache = frappe.local.dacs_pick_only = {}
	key = (doctype, user)
	if key not in cache:
		cache[key] = _is_pick_only(doctype, user)
	return cache[key]


def _is_pick_only(doctype, user):
	from erp_dacsinc_custom import access_sync
	from erp_dacsinc_custom.access_worksheet import load_sheet
	from erp_dacsinc_custom.order_flow_permissions import is_admin

	if user in ("Administrator", "Guest") or is_admin(user) or not access_sync.is_active():
		return False
	sheet = load_sheet("doc_access") or {}
	values = (sheet.get("cells") or {}).get(doctype)
	if values is None:
		return False
	roles = set(frappe.get_roles(user))
	sheet_roles = set(access_sync.sheet_roles())
	viewers = {r for r, v in zip(sheet.get("roles") or [], values) if "V" in v}
	if roles & viewers:
		return False
	# Another (non-sheet) role reading the doctype isn't the sheet's to narrow.
	readers = set(frappe.get_all("Custom DocPerm", filters={"parent": doctype, "read": 1, "permlevel": 0},
								 pluck="role")) - sheet_roles
	return not (roles & readers)


def _query(doctype, user):
	listing = _cmd() in LIST_CMDS
	if not listing:
		dt, single = _rest()
		listing = dt == doctype and not single
	return "1=0" if listing and is_pick_only(doctype, user) else ""


def customer_query(user=None):
	return _query("Customer", user)


def supplier_query(user=None):
	return _query("Supplier", user)


def item_price_query(user=None):
	return _query("Item Price", user)


def has_permission(doc, ptype=None, user=None, debug=False):
	"""Pick-only users don't open the record (form, frappe.client.get, REST read)."""
	if ptype not in (None, "read") or not is_pick_only(doc.doctype, user):
		return None
	dt, single = _rest()
	if _cmd() in OPEN_CMDS or (dt == doc.doctype and single):
		return False
	return None


def before_request():
	"""Link search on a pick-only master: at most SEARCH_CAP rows per call."""
	fd = getattr(frappe.local, "form_dict", None)
	if fd is None or _cmd() not in SEARCH_CMDS:
		return
	dt = fd.get("doctype")
	if dt in SENSITIVE_MASTERS and is_pick_only(dt):
		try:
			fd.page_length = min(int(fd.get("page_length") or 10), SEARCH_CAP)
		except (TypeError, ValueError):
			fd.page_length = 10
		fd.start = 0 if int(fd.get("start") or 0) > 200 else fd.get("start")


@frappe.whitelist()
def global_search(text, start=0, limit=20, doctype=""):
	"""frappe.utils.global_search.search, without master records the user may not open."""
	from frappe.utils.global_search import search

	out = []
	for r in search(text, start=start, limit=limit, doctype=doctype):
		if r.doctype in SENSITIVE_MASTERS and (
				is_pick_only(r.doctype) or not frappe.has_permission(r.doctype, "read", doc=r.name)):
			continue
		out.append(r)
	return out
