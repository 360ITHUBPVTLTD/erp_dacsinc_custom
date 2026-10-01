"""Saved decisions for the two access worksheets on /roles-and-permissions.

- ``doc_access``: document × role → allowed boxes, a string of letters from
  ``VESCDO`` (V view, E create/edit, S submit, C cancel, D delete, O only own
  records). "" = no access.
- ``tab_access``: Order Flow tab / sub-tab × role → "" (hidden), "Y" (can
  see) or "A" (can see and act).

Each sheet is one JSON blob in a ``DefaultValue`` row under parent
``__dacsinc_access_ws``, so no migration is needed. Anyone signed in can read the
sheets (the page shows them). Only the Admin role can save. A save carries
the version it was edited from, and it is refused if someone saved in between.
Once the sheet is switched on, saving applies it at once (see ``access_sync``).
"""

import json
import re

import frappe
from frappe.utils import now

STATE_PARENT = "__dacsinc_access_ws"
SHEETS = {"doc_access": re.compile(r"^[VESCDO]*$"), "tab_access": re.compile(r"^(|Y|A)$")}
MAX_ROWS = 200
MAX_ROLES = 40
EDIT_ROLE = "Admin"  # the only role that may change the agreed sheets
# Resets (restore the marked worksheet, clear / refill the tab sheet, apply to the ERP,
# reset profiles): System Manager only, after a typed confirmation on the page.
RESET_ROLE = "System Manager"
# Who may open /roles-and-permissions at all (and read the saved sheets): Admin, System
# Manager, Administrator. Everyone else gets "not permitted"; guests go to the login page.
VIEW_ROLES = ("Admin", "System Manager")


def can_view(user=None):
	user = user or frappe.session.user
	return user == "Administrator" or bool(set(frappe.get_roles(user)) & set(VIEW_ROLES))
RESETS = {"restore": "Restored the marked worksheet", "clear": "Cleared every tab",
		  "refill": "Refilled from document access"}


def _row_name(sheet):
	return frappe.db.get_value("DefaultValue", {"parent": STATE_PARENT, "defkey": sheet}, "name")


def load_sheet(sheet):
	name = _row_name(sheet)
	if not name:
		return None
	try:
		return json.loads(frappe.db.get_value("DefaultValue", name, "defvalue") or "null")
	except ValueError:
		return None


def load_all():
	return {sheet: load_sheet(sheet) for sheet in SHEETS}


def _clean(sheet, roles, cells):
	pattern = SHEETS[sheet]
	if not isinstance(roles, list) or not 0 < len(roles) <= MAX_ROLES or not all(isinstance(r, str) for r in roles):
		frappe.throw("Invalid role list.")
	if not isinstance(cells, dict) or len(cells) > MAX_ROWS:
		frappe.throw("Invalid sheet data.")
	out = {}
	for row, values in cells.items():
		if not isinstance(row, str) or len(row) > 140 or not isinstance(values, list) or len(values) != len(roles):
			frappe.throw(f"Invalid row: {row!r}")
		for v in values:
			if not isinstance(v, str) or not pattern.match(v):
				frappe.throw(f"Invalid value {v!r} in row {row!r}")
		out[row] = values
	return out


@frappe.whitelist(methods=["POST"])
def save_sheet(sheet, roles, cells, base_version=0, reset=None):
	"""Save a sheet and apply it straight away (roles & permissions / Order Flow tabs).
	Saving and applying are one transaction: if applying fails, nothing is saved.
	reset: the save follows a reset on the page (RESETS) — System Manager only."""
	frappe.only_for(EDIT_ROLE)
	if reset:
		if reset not in RESETS:
			frappe.throw("Unknown reset.")
		frappe.only_for(RESET_ROLE)
	if sheet not in SHEETS:
		frappe.throw("Unknown sheet.")
	roles = frappe.parse_json(roles)
	cells = _clean(sheet, roles, frappe.parse_json(cells))

	name = _row_name(sheet)
	if name:
		frappe.db.sql("select name from tabDefaultValue where name=%s for update", name)
	current = load_sheet(sheet) or {}
	# Added documents stay on the sheet even if the page didn't send their rows
	# (removing one is access_reverse.remove_sheet_document, System Manager).
	for doc in (current.get("added") or {}) if sheet == "doc_access" else ():
		if doc not in cells and doc in (current.get("cells") or {}):
			old = dict(zip(current.get("roles") or [], current["cells"][doc]))
			cells[doc] = [old.get(r, "") for r in roles]
	if int(current.get("version") or 0) != int(base_version or 0):
		frappe.throw(
			f"{current.get('saved_by_name') or current.get('saved_by')} saved this sheet at "
			f"{current.get('saved_on')} after you opened it. Reload the page to see their changes, then edit again.",
			title="Sheet changed",
		)
	data = store_sheet(sheet, roles, cells, note=RESETS.get(reset))

	from erp_dacsinc_custom import access_sync
	# Applied only once the sheet is switched on; until then saving just records it.
	data["applied"] = access_sync.apply_sheet(sheet, data) if access_sync.is_active() else None
	access_sync.write_bundle()
	return data


def store_sheet(sheet, roles, cells, note=None, added=None):
	"""Write a new version of a sheet (no checks, no apply).
	added (Document access only): documents a System Manager added to the sheet,
	{doctype: {"group", "submittable"}} (access_reverse.add_sheet_document); kept from
	the current version when not given."""
	current = load_sheet(sheet) or {}
	data = {
		"version": int(current.get("version") or 0) + 1,
		"roles": roles,
		"cells": cells,
		"saved_by": frappe.session.user,
		"saved_by_name": frappe.utils.get_fullname(frappe.session.user),
		"saved_on": now(),
	}
	if sheet == "doc_access":
		added = current.get("added") if added is None else added
		if added:
			data["added"] = {d: v for d, v in added.items() if d in cells}
	if note:
		data["note"] = note
	value = json.dumps(data)
	name = _row_name(sheet)
	if name:
		frappe.db.set_value("DefaultValue", name, "defvalue", value, update_modified=False)
	else:
		frappe.get_doc({
			"doctype": "DefaultValue", "parent": STATE_PARENT, "parenttype": "__default",
			"parentfield": "system_defaults", "defkey": sheet, "defvalue": value,
		}).insert(ignore_permissions=True)
	return data


@frappe.whitelist()
def get_saved():
	"""Both saved sheets, for the page to pick up changes made elsewhere (another
	user's save, Role Permission Manager — see access_reverse). Signed-in users."""
	if not can_view():
		frappe.throw("Only Admin and System Manager can see the access sheets.", frappe.PermissionError)
	return load_all()


def cli_session(close=None):
	"""For scripts/make_worksheet_pdfs.sh only (bench execute, never over HTTP): a temporary
	Administrator session to fetch the page, which needs a login; close=<sid> ends it."""
	from frappe.sessions import Session, delete_session
	from werkzeug.test import EnvironBuilder
	from werkzeug.wrappers import Request

	if close:
		delete_session(close, reason="worksheet PDFs done")
		frappe.db.commit()
		return
	frappe.local.request = Request(EnvironBuilder(path="/").get_environ())
	frappe.local.request_ip = "127.0.0.1"
	s = Session(user="Administrator", resume=False, full_name="Administrator", user_type="System User")
	frappe.db.commit()
	print("SID", s.sid)
