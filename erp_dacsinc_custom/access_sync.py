"""Turns the agreed access sheets (/roles-and-permissions) into real access.

The two sheets saved by ``access_worksheet.save_sheet`` are the source of truth:

- ``doc_access`` → Custom DocPerm rows for the sheet roles on the sheet's
  documents, plus the linked documents those need (see "Dependencies").
- ``tab_access`` → Admin Settings › Order Flow tab and sub-tab role lists.

Only the sheet roles are managed: the roles flagged ``custom_dacsinc_access_role``
(``sheet_roles()``). Rows for any other role (HR Manager, …) are never touched, and
no role is ever deleted.

Roles and profiles (dynamic):

- Flag a role and it becomes a sheet column; ``INITIAL_ROLES`` is only the first set.
- Each flagged role gets one Role Profile holding exactly that role + Employee +
  Employee Self Service, flagged ``custom_dacsinc_access_profile`` — created when
  the role is flagged (Role ``on_update`` hook). A user may hold several profiles.
- The Roles & Permissions desk page shows only flagged roles and profiles.

Dependencies, so a role that may create a document never hits "no permission":

- A role that may create/edit a document gets Read + Select on every document
  linked from it, including links in child tables. On a *sheet* document the sheet
  decides, so there it gets only Select (enough to search and pick) — plus Read
  where the form fetches values from it (e.g. Customer name on a Sales Order).
- A role that may create/edit a *master* (Customer, Item, Supplier, Lead,
  Warehouse…) also gets create/edit on that master's own setup masters (Brand,
  Item Group, UOM, Customer Group, Territory, Lead Source…).
- These grants only ever ADD to what a role already has. What was added is
  tracked (DefaultValue ``derived_applied``), so a grant that is no longer needed
  takes back only what it added — hand-made rules (e.g. Merchandiser User's) stay.

Switch — nothing is taken away from any user until an Admin switches it on:

- **Off** (a site's first state, e.g. live right after the one-time patch):
  - roles, flags and fields exist, and profiles are created only where missing
    (existing profiles keep their roles, so no user loses one);
  - the sheets are stored (from ``access/agreed_access.json`` if the site has none);
  - saving a sheet only records it;
  - no permissions / Admin Settings tabs are changed, and the POS store scope is off.
- **On** (``apply_permissions()`` — patch ``apply_access_sheet_permissions`` on
  migrate, or "Apply to the ERP" on the sheet page): both sheets are applied
  (document permissions, linked documents, reports, Order Flow tabs and sub-tabs),
  and from then on every save applies at once and the POS store scope works.
  **Users' roles and profiles are never touched by this.** Resetting the profiles
  to role + Employee + ESS is a separate, explicit Admin action
  (``reset_profiles()``, "Reset profiles…" on the sheet page).

``initial_setup`` runs once per site from a patch; a later migrate never re-runs
it, so what was changed on that site is never reset.
"""

import json
import os

import frappe
from collections import defaultdict
from frappe.permissions import setup_custom_perms

from erp_dacsinc_custom.access_worksheet import STATE_PARENT, load_sheet

INITIAL_ROLES = [
	"Accounts Executive", "Accounts Manager", "DAC CRM", "DAC CRM Head",
	"Finance Collection Executive", "Finance Executive", "Merchandiser User",
	"POS Admin", "POS Store Manager", "Production Assistant", "Production Manager",
	"Purchase Executive", "Purchase Manager", "Warehouse Incharge", "Warhouse Executive",
	"Packing Team", "Logistics",
]
# Role Profile name when it differs from the role name (an existing profile is
# reused; names match case-insensitively, e.g. "DAC CRM HEAD").
PROFILE_NAME = {"Merchandiser User": "Merchandiser", "Warhouse Executive": "Warehouse Executive"}
BASE_ROLES = ["Employee", "Employee Self Service"]
SHEET_ROLES = INITIAL_ROLES  # kept for callers; use sheet_roles() for the live list
ROLE_FLAG = "custom_dacsinc_access_role"
PROFILE_FLAG = "custom_dacsinc_access_profile"

# Sheet row → real doctype(s).
DOC_TARGETS = {"Contact & Address": ["Contact", "Address"]}

# Sheet letter → Custom DocPerm fields.
LETTER_FIELDS = {
	"V": ("read", "select", "print", "email", "report", "export"),
	"E": ("write", "create"),
	"S": ("submit",),
	"C": ("cancel", "amend"),
	"D": ("delete",),
}
PERM_FIELDS = ("read", "select", "print", "email", "report", "export", "write", "create",
			   "submit", "cancel", "amend", "delete", "import", "share")
DEP_READ = ("read", "select")
DEP_EDIT = ("read", "select", "write", "create")

# Dependencies never grant more than Read on these, and never touch the modules
# in DEP_SKIP_MODULES (framework / optional integrations).
DEP_READ_ONLY = {
	"Company", "Currency", "Price List", "Account", "Cost Center", "Country", "Letter Head",
	"Print Heading", "Print Format", "Terms and Conditions", "Workflow State", "Project",
	"Opportunity", "Prospect", "Sales Partner", "Campaign", "Batch", "Language",
}
DEP_SELECT_ONLY = {"User"}
DEP_SKIP_MODULES = {"Core", "Custom", "Desk", "Email", "Integrations", "Automation", "Website", "Social"}
DEP_SKIP = {"DocType"}
# Saving these creates those records automatically (e.g. a Customer's primary
# Contact / Address), so a role that may create the first may create the second —
# only its own (if_owner), whatever the sheet says about browsing them.
AUTO_CREATES = {"Customer": ("Contact", "Address"), "Supplier": ("Contact", "Address"), "Lead": ("Contact", "Address")}
AUTO_MARK = "auto_create"
READ_MARK = "general_read"  # Read on all records (not only own), from fetch / display needs
# Records a form loads to display (address / contact details) — Read for anyone who
# may create or edit a document linking them, whatever the sheet says about browsing.
DISPLAY_READ = ("Address", "Contact")

# Modules whose non-submittable masters are "setup masters" a master's editors may edit too.
DEP_EDIT_MODULES = {"Setup", "Stock", "Selling", "Buying", "CRM", "Contacts", "Erp Dacsinc Custom", "GST India"}

# Companion standard roles. ERPNext's screens quietly rely on the supporting
# records its standard roles can read (Selling/Stock/Buying/Accounts/POS
# Settings, Price List, Bin, ledgers, print formats…). A sheet role that may view
# any document of a group gets the READ-ONLY part of that group's standard role:
# read/select/report on the doctypes it reads (never the sheet's own documents —
# the sheet decides those), plus the reports and pages it may open.
COMPANIONS = {
	"Sales User": ["Quotation", "Sales Order", "Delivery Note", "Customer", "Lead", "POS Invoice"],
	"Stock User": ["Stock Entry", "Stock Reconciliation", "Pick List", "Delivery Note", "Purchase Receipt",
				   "Material Request", "Item", "Warehouse", "Uniform Embroidery Transfer", "Embroidery Work Order"],
	"Purchase User": ["Material Request", "Purchase Order", "Purchase Receipt", "Purchase Invoice", "Supplier",
					  "Subcontracting Order", "Subcontracting Receipt"],
	"Accounts User": ["Sales Invoice", "Payment Entry", "Journal Entry"],
	"Manufacturing User": ["BOM", "Subcontracting BOM"],
	"POS User": ["POS Invoice", "POS Opening Entry", "POS Closing Entry", "POS Profile"],
}
COMPANION_FIELDS = ("read", "select", "report")
COMPANION_SKIP_MODULES = {"HR", "Payroll", "Core", "Custom", "Desk", "Website", "Integrations", "Automation",
						  "Email", "Printing", "Social", "Workflow"}
# Read by every sheet role: desk scripts look pages up (frappe.client.get_value("Page", …))
# and forms read the module settings.
EVERY_SHEET_ROLE_READS = ("Page", "Selling Settings", "Stock Settings", "Buying Settings", "Accounts Settings",
						  "POS Settings", "Global Defaults")


def _companions(direct):
	"""{sheet role: {standard roles}} from what the role may view."""
	out = {}
	for std, docs in COMPANIONS.items():
		for dt in docs:
			for role, (flags, _o) in direct.get(dt, {}).items():
				if "read" in flags:
					out.setdefault(role, set()).add(std)
	return out


def _std_role_doctypes(std):
	return {r[0] for r in frappe.db.sql("""select parent from tabDocPerm where role=%(r)s and permlevel=0 and `read`=1
		union select parent from `tabCustom DocPerm` where role=%(r)s and permlevel=0 and `read`=1""", {"r": std})}


# Order Flow dashboard: sheet tab label → key; sub-tab label → key.
TAB_KEYS = {
	"SO Approvals": "approval", "Sales Tracker": "tracker", "Pick Lists": "picklist",
	"Purchase Flow": "purchase", "Job Work": "jobwork", "Stock Tracker": "stock",
	"Pending DN/SI": "billing", "Finance": "accounts", "Embroidery Transfers": "uniform",
	"Logistics": "logistics",
}
SUBTAB_KEYS = {
	"SO Approvals": {"1. Pending Approval (my orders)": "merchandiser", "2. Merchandiser Unassigned Orders": "unassigned",
					 "3. Other Merchandisers' Orders": "other", "4. Pending Final SO Approval": "final",
					 "5. Rejected Orders": "rejected"},
	"Sales Tracker": {"Sales Orders": "so", "Material Requests": "mr", "Embroidery - FP": "fp", "Embroidery - Panel": "pn"},
	"Purchase Flow": {"POs": "po", "Receipts": "receipt", "To Bill": "bill"},
	"Job Work": {"Sub POs": "po", "Sub Receipts": "receipt", "Embroidery - FP": "fp", "Embroidery - Panel": "pn"},
	"Finance": {"Receivables": "receivables", "Supplier Payables": "supplier", "Jobber Payables": "jobber"},
}
# A tab nobody may see gets this role, so it counts as configured (admins see everything anyway).
NOBODY_ROLE = "Admin"

BUNDLE_PATH = os.path.join(os.path.dirname(__file__), "access", "agreed_access.json")


# ------------------------------------------------------------------ roles / profiles
def sheet_roles():
	"""The flagged roles, in sheet order: INITIAL_ROLES order first, then any
	other flagged role alphabetically. Before the flag exists: INITIAL_ROLES."""
	if not frappe.db.has_column("Role", ROLE_FLAG):
		return list(INITIAL_ROLES)
	flagged = set(frappe.get_all("Role", filters={ROLE_FLAG: 1, "disabled": 0}, pluck="name"))
	if not flagged:
		return list(INITIAL_ROLES)
	return [r for r in INITIAL_ROLES if r in flagged] + sorted(flagged - set(INITIAL_ROLES))


def sheet_profiles():
	if not frappe.db.has_column("Role Profile", PROFILE_FLAG):
		return []
	return sorted(frappe.get_all("Role Profile", filters={PROFILE_FLAG: 1}, pluck="name"))

def ensure_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({
		"Role": [{
			"fieldname": ROLE_FLAG, "fieldtype": "Check", "label": "Access Sheet Role", "insert_after": "desk_access",
			"description": "Managed by the agreed access sheet (/roles-and-permissions). Only these roles are used.",
		}],
		"Role Profile": [{
			"fieldname": PROFILE_FLAG, "fieldtype": "Check", "label": "Access Sheet Profile", "insert_after": "role_profile",
			"description": "Offered on the Roles & Permissions page. Holds one access sheet role plus Employee and Employee Self Service.",
		}],
	}, update=True)


def _profile_name(role):
	"""Existing profile for this role (by name, or by its Profile Name field — some
	profiles were renamed, e.g. "Accounts" still has Profile Name "Accounts Manager";
	such a profile is renamed back), else the name to create."""
	wanted = PROFILE_NAME.get(role, role)
	name = frappe.db.get_value("Role Profile", {"name": wanted}, "name")
	if name:
		return name
	renamed = frappe.db.get_value("Role Profile", {"role_profile": wanted}, "name")
	if renamed:
		# Give it back the role's name, so the page shows the same name as the role.
		frappe.rename_doc("Role Profile", renamed, wanted, force=True)
		return wanted
	return wanted


def is_active():
	"""Is the access sheet switched on (applied to the ERP) on this site?"""
	return _state_get("active") == "1"


def ensure_roles_and_profiles(reset=None):
	"""Create/flag the sheet roles and their profiles. Returns profiles whose roles changed."""
	for role in INITIAL_ROLES:
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)
		frappe.db.set_value("Role", role, ROLE_FLAG, 1, update_modified=False)
	return ensure_profiles(sheet_roles(), reset=reset)


def ensure_profiles(roles, reset=None):
	"""Each role's profile = role + Employee + Employee Self Service, flagged.

	By default an existing profile keeps its roles — only missing profiles are
	created — so no user ever loses a role. Only reset_profiles() (an Admin's
	explicit, confirmed choice) rewrites existing profiles. Returns profiles whose
	roles changed."""
	reset = bool(reset)
	changed = []
	for role in roles:
		name = _profile_name(role)
		wanted = [role] + BASE_ROLES
		if frappe.db.exists("Role Profile", name) and not reset:
			frappe.db.set_value("Role Profile", name, PROFILE_FLAG, 1, update_modified=False)
			continue
		if frappe.db.exists("Role Profile", name):
			doc = frappe.get_doc("Role Profile", name)
			if sorted(r.role for r in doc.roles) != sorted(wanted):
				# Rewrite the roles and update its users right here, in this
				# transaction. A normal save would lock the profile and queue that
				# update as a background job instead.
				frappe.db.delete("Has Role", {"parent": doc.name, "parenttype": "Role Profile"})
				for idx, r in enumerate(wanted, 1):
					frappe.get_doc({"doctype": "Has Role", "parent": doc.name, "parenttype": "Role Profile",
									"parentfield": "roles", "role": r, "idx": idx}).db_insert()
				doc = frappe.get_doc("Role Profile", doc.name)
				doc.update_all_users()
				doc.clear_cache()
				changed.append(doc.name)
		else:
			# Inserted directly (a new profile has no users to update), so no
			# lock / background job is involved.
			doc = frappe.get_doc({"doctype": "Role Profile", "role_profile": name,
								  "roles": [{"role": r} for r in wanted]})
			doc.name = name
			doc.set_parent_in_children()
			doc.db_insert()
			for d in doc.roles:
				d.db_insert()
			changed.append(doc.name)
		frappe.db.set_value("Role Profile", doc.name, PROFILE_FLAG, 1, update_modified=False)

	# Users on several profiles (User Access Profile) don't follow a profile edit by themselves.
	if changed and frappe.db.exists("DocType", "User Access Profile"):
		from erp_dacsinc_custom.erp_dacsinc_custom.doctype.user_access_profile.user_access_profile import (
			sync_user_access_profile,
		)
		for uap in set(frappe.get_all("User Access Profile Role Profile",
									  filters={"role_profile": ["in", changed]}, pluck="parent")):
			sync_user_access_profile(uap)
	return changed


def on_role_update(doc, method=None):
	"""Role on_update: a newly flagged role gets its profile straight away."""
	if doc.get(ROLE_FLAG) and not doc.disabled:
		ensure_profiles([doc.name])


# ------------------------------------------------------------------ helpers
def _role_columns(sheet):
	"""{role: index into the sheet's cells} for the sheet roles present in it."""
	roles = sheet.get("roles") or []
	return {r: roles.index(r) for r in sheet_roles() if r in roles}


def _flags(letters, submittable):
	out = set()
	for l in letters:
		if l in ("S", "C") and not submittable:
			continue
		out.update(LETTER_FIELDS.get(l, ()))
	return out


def _meta_links(doctype):
	"""(links on the doctype's own fields, links inside its child tables,
	targets the form fetches values from — fetch_from "<link field>.<field>")."""
	own, child, fetched = set(), set(), set()

	def scan(meta, into):
		link_target = {f.fieldname: f.options for f in meta.fields if f.fieldtype == "Link" and f.options}
		into.update(link_target.values())
		for f in meta.fields:
			src = (f.fetch_from or "").split(".")[0]
			if src in link_target:
				fetched.add(link_target[src])

	meta = frappe.get_meta(doctype)
	scan(meta, own)
	for f in meta.fields:
		if f.fieldtype in ("Table", "Table MultiSelect") and f.options:
			scan(frappe.get_meta(f.options), child)
	return own, child, fetched


def _dt_info():
	return {d.name: d for d in frappe.get_all(
		"DocType", fields=["name", "module", "issingle", "istable", "is_submittable", "is_virtual"])}


def _dep_level(target, info, parent_is_master, own_field):
	"""How much a create/edit right on the parent should grant on `target`."""
	if target in DEP_SELECT_ONLY:
		return ("select",)
	d = info.get(target)
	if not d or d.issingle or d.istable or d.is_virtual or target in DEP_SKIP or d.module in DEP_SKIP_MODULES:
		return None
	if (parent_is_master and own_field and not d.is_submittable and target not in DEP_READ_ONLY
			and d.module in DEP_EDIT_MODULES):
		return DEP_EDIT
	return DEP_READ


# ------------------------------------------------------------------ document access
def compute_doc_access(sheet):
	"""({doctype: {role: (flags, if_owner)}} from the sheet, {doctype: {role: flags}} dependencies)."""
	cols = _role_columns(sheet)
	cells = sheet.get("cells") or {}
	info = _dt_info()
	direct = {}
	for row, values in cells.items():
		for dt in DOC_TARGETS.get(row, [row]):
			if dt not in info:
				continue
			sub = bool(info[dt].is_submittable)
			direct[dt] = {r: (_flags(values[i], sub), int("O" in values[i])) for r, i in cols.items()}

	deps = {}
	for dt, by_role in direct.items():
		own, child, fetched = _meta_links(dt)
		is_master = not info[dt].is_submittable
		for role, (flags, _o) in by_role.items():
			if not flags & {"write", "create"}:
				continue
			for target, own_field in [(t, True) for t in own] + [(t, False) for t in child - own]:
				if target == dt:
					continue
				if target in direct:
					# A sheet document: the sheet decides. Only what picking needs —
					# plus Read where the form shows details from it: fetched fields,
					# and addresses / contacts (the form loads the company's and the
					# party's address and contact to display them).
					level = ("select", "read", READ_MARK) if target in fetched or target in DISPLAY_READ else ("select",)
				else:
					level = _dep_level(target, info, is_master, own_field)
				if level:
					deps.setdefault(target, {}).setdefault(role, set()).update(level)
			for target in AUTO_CREATES.get(dt, ()) if "create" in flags else ():
				deps.setdefault(target, {}).setdefault(role, set()).update(DEP_EDIT + (AUTO_MARK,))

	# Read-only companions (see COMPANIONS) — on non-sheet doctypes only.
	std_cache = {}
	for role, stds in _companions(direct).items():
		for std in stds:
			if std not in std_cache:
				std_cache[std] = _std_role_doctypes(std)
			for target in std_cache[std]:
				d = info.get(target)
				if (not d or target in direct or d.istable or d.is_virtual
						or d.module in COMPANION_SKIP_MODULES):
					continue
				deps.setdefault(target, {}).setdefault(role, set()).update(COMPANION_FIELDS)
	for role in _role_columns(sheet):
		for target in EVERY_SHEET_ROLE_READS:
			deps.setdefault(target, {}).setdefault(role, set()).update(("read",))
	return direct, deps


def _rows(doctype, role):
	return frappe.get_all("Custom DocPerm", filters={"parent": doctype, "role": role},
						  fields=["name", "permlevel", "if_owner", *PERM_FIELDS])


def _insert_row(doctype, role, flags, if_owner=0):
	frappe.get_doc({
		"doctype": "Custom DocPerm", "parent": doctype, "parenttype": "DocType", "parentfield": "permissions",
		"role": role, "permlevel": 0, "if_owner": if_owner, **{f: int(f in flags) for f in PERM_FIELDS},
	}).insert(ignore_permissions=True)


def apply_doc_access(sheet):
	"""Make the sheet roles' permissions match the sheet. Returns a summary dict.
	Its own permission writes are not read back into the sheet (access_reverse)."""
	frappe.flags.dacs_access_applying = True
	try:
		return _apply_doc_access(sheet)
	finally:
		frappe.flags.dacs_access_applying = False


def _apply_doc_access(sheet):
	direct, deps = compute_doc_access(sheet)
	touched, summary = set(), {"sheet_rows": 0, "rows_rewritten": 0, "dependency_grants": 0, "dependency_removed": 0,
							   "select_added_on_sheet_docs": [], "read_added_on_sheet_docs": []}
	roles = sorted({r for by_role in direct.values() for r in by_role} | {r for by_role in deps.values() for r in by_role})
	# Every sheet role's Custom DocPerm rows in one read (was one query per doctype × role).
	existing = defaultdict(list)
	for r in frappe.get_all("Custom DocPerm", filters={"role": ["in", roles or [""]]},
							fields=["name", "parent", "role", "permlevel", "if_owner", *PERM_FIELDS]):
		existing[(r.parent, r.role)].append(r)

	def shape(rows):
		return sorted((int(r.permlevel or 0), int(r.if_owner or 0), tuple(f for f in PERM_FIELDS if r.get(f))) for r in rows)

	# 1. Sheet documents: exactly what the sheet says, plus Read/Select a dependency needs.
	#    Only (document, role) pairs whose rows differ are rewritten.
	for dt, by_role in direct.items():
		custom_ready = bool(frappe.db.exists("Custom DocPerm", {"parent": dt}))
		for role, (flags, if_owner) in by_role.items():
			dep = deps.get(dt, {}).get(role, set())
			auto = AUTO_MARK in dep
			general_read = READ_MARK in dep
			need = dep & set(DEP_EDIT if auto else DEP_READ)
			if "read" in need - flags:
				summary["read_added_on_sheet_docs"].append(f"{role} · {dt}")
			elif need - flags:
				summary["select_added_on_sheet_docs"].append(f"{role} · {dt}")
			want = []
			if flags:
				want.append((flags | need, if_owner))
			elif need:
				# No sheet rights: only what linking needs — and, for records the role's
				# own saves create (a Customer's Contact), only the ones it created.
				want.append((need, 1 if auto else 0))
				if auto and not need <= {"select"}:
					# own-only row above for creating; this one for picking / displaying any
					want.append(({"select", "read"} if general_read else {"select"}, 0))
			if want:
				summary["sheet_rows"] += 1
			have = existing.get((dt, role), [])
			if custom_ready and shape(have) == sorted((0, int(o), tuple(f for f in PERM_FIELDS if f in fl)) for fl, o in want):
				continue
			if not custom_ready:
				setup_custom_perms(dt)
				custom_ready = True
				have = _rows(dt, role)  # the copied standard rows
			for r in have:
				frappe.delete_doc("Custom DocPerm", r.name, ignore_permissions=True, force=True)
			for fl, o in want:
				_insert_row(dt, role, fl, o)
			summary["rows_rewritten"] += 1
			touched.add(dt)

	# 2. Linked documents: only ever add; take back only what we added before.
	prev = _map_get("derived_applied")
	new_state = {}
	for dt in sorted(set(deps) | set(prev)):
		if dt in direct:
			continue
		want_by_role = deps.get(dt, {})
		for role in sorted(set(want_by_role) | set(prev.get(dt, {}))):
			want = want_by_role.get(role, set())
			added_before = set(prev.get(dt, {}).get(role, []))
			rows = [r for r in existing.get((dt, role), []) if r.permlevel == 0 and not r.if_owner]
			row = rows[0] if rows else None
			have = {f for f in PERM_FIELDS if row and row.get(f)}
			to_add = want - have
			to_remove = added_before - want
			ours = (added_before & want) | to_add          # still-needed rights we granted
			if to_add or to_remove:
				setup_custom_perms(dt)
				rows = [r for r in _rows(dt, role) if r.permlevel == 0 and not r.if_owner]
				row = rows[0] if rows else None
				if row:
					doc = frappe.get_doc("Custom DocPerm", row.name)
					for f in to_add:
						doc.set(f, 1)
					for f in to_remove:
						doc.set(f, 0)
					if any(doc.get(f) for f in PERM_FIELDS):
						doc.save(ignore_permissions=True)
					else:
						frappe.delete_doc("Custom DocPerm", doc.name, ignore_permissions=True, force=True)
				elif to_add:
					_insert_row(dt, role, to_add)
				summary["dependency_grants"] += len(to_add)
				summary["dependency_removed"] += len(to_remove)
				touched.add(dt)
			if ours:
				new_state.setdefault(dt, {})[role] = sorted(ours)
	_map_set("derived_applied", new_state)
	summary["linked_doctypes"] = len(new_state)

	summary["report_roles_added"], summary["report_roles_removed"] = apply_report_access(direct)
	summary["pages_changed"] = apply_page_access(direct)

	for dt in touched:
		frappe.clear_cache(doctype=dt)
	if touched or summary["report_roles_added"] or summary["report_roles_removed"] or summary["pages_changed"]:
		frappe.clear_cache()  # page / report access is cached per user
	return summary


# Desk pages → sheet documents: a role that may view any of them may open the page.
# (order-flow keeps its own Custom Role, see order_flow_permissions.)
PAGE_DOCS = {
	"point-of-sale": ["POS Invoice"],
	"stock-balance": ["Stock Entry", "Stock Reconciliation", "Purchase Receipt", "Pick List"],
	"warehouse-capacity-summary": ["Stock Entry", "Stock Reconciliation", "Purchase Receipt", "Pick List"],
	"bom-comparison-tool": ["BOM"],
	"sales-funnel": ["Lead", "Quotation"],
}


def _custom_role_roles(kind, name):
	cr = frappe.db.get_value("Custom Role", {kind: name}, "name")
	roles = set(frappe.get_all("Has Role", filters={"parent": cr, "parenttype": "Custom Role"}, pluck="role")) if cr else set()
	return cr, roles


def _set_custom_role(kind, name, roles):
	"""Write the Custom Role of a page/report — Frappe's own way to add roles to a
	standard page/report without editing it (edits to it are undone by migrate)."""
	cr, _have = _custom_role_roles(kind, name)
	roles = {r for r in roles if frappe.db.exists("Role", r)}  # a page may list a role this site lacks
	doc = frappe.get_doc("Custom Role", cr) if cr else frappe.get_doc({"doctype": "Custom Role", kind: name})
	doc.set("roles", [{"role": r} for r in sorted(roles)])
	doc.flags.ignore_permissions = True
	doc.save(ignore_permissions=True)


def _viewers(direct, doctypes):
	out = set()
	for dt in doctypes:
		out.update(r for r, (flags, _o) in direct.get(dt, {}).items() if "read" in flags)
	return out


def apply_report_access(direct):
	"""View includes reports: a role that may view a document may run the reports
	built on it (Report.ref_doctype). Through the report's Custom Role, which
	*replaces* its own role list, so the report's own roles are always kept in it.
	Additive and tracked; reports open to everyone are left alone."""
	# Undo the direct Has Role rows an earlier version added to reports (migrate can
	# reset those; the Custom Role is the durable way).
	old = json.loads(_state_get("reports_applied") or "{}")
	for rep_name, roles in old.items():
		frappe.db.delete("Has Role", {"parent": rep_name, "parenttype": "Report", "role": ["in", roles]})
		frappe.clear_document_cache("Report", rep_name)
	if old:
		_state_set("reports_applied", "{}")

	want = {}
	for dt in direct:
		roles = _viewers(direct, [dt])
		if roles:
			for rep_name in frappe.get_all("Report", filters={"ref_doctype": dt, "disabled": 0}, pluck="name"):
				want.setdefault(rep_name, set()).update(roles)
	# Reports the companion standard role may run (e.g. Stock Balance for Stock User).
	for role, stds in _companions(direct).items():
		for rep_name in _reports_for_roles(stds):
			want.setdefault(rep_name, set()).add(role)
	# POS roles see only POS records (pos_scope.py); these reports read the whole
	# company with their own SQL, so they're not given to them.
	# This wins over roles someone put on the report itself.
	blocked = _pos_blocked_reports()
	for rep_name in blocked & set(want):
		want[rep_name] -= set(POS_ROLES)
	prev = _map_get("report_custom_roles")
	added = removed = 0
	state = {}
	for rep_name in sorted(set(want) | set(prev) | blocked):
		own = set(frappe.get_all("Has Role", filters={"parent": rep_name, "parenttype": "Report"}, pluck="role"))
		cr, custom = _custom_role_roles("report", rep_name)
		mine = set(prev.get(rep_name, []))
		wanted = want.get(rep_name, set())
		if not own and not cr:
			continue  # no role list at all = open to everyone who may report on the document
		if rep_name not in want and rep_name not in prev and not (own | custom) & set(POS_ROLES):
			continue  # blocked report the POS roles never had: nothing to do
		base = (custom - mine) if cr else own
		final = base | wanted
		if rep_name in blocked:
			final -= set(POS_ROLES)
		ours = wanted - base
		if final != custom:
			_set_custom_role("report", rep_name, final)
			added += len(final - custom)
			removed += len(custom - final)
		if ours:
			state[rep_name] = sorted(ours)
	_map_set("report_custom_roles", state)
	return added, removed


POS_ROLES = ("POS Admin", "POS Store Manager")
POS_BLOCKED_REPORT_DOCTYPES = ("Material Request", "Material Request Item", "Sales Invoice", "Customer")
POS_BLOCKED_REPORTS = ("Requested Items To Be Transferred",)


def _pos_blocked_reports():
	return set(frappe.get_all("Report", filters={"ref_doctype": ["in", POS_BLOCKED_REPORT_DOCTYPES],
		"report_type": ["!=", "Report Builder"], "disabled": 0}, pluck="name")) | set(POS_BLOCKED_REPORTS)


def _reports_for_roles(roles):
	roles = list(roles)
	own = frappe.get_all("Has Role", filters={"parenttype": "Report", "role": ["in", roles]}, pluck="parent")
	cust = frappe.db.sql("""select c.report from `tabCustom Role` c join `tabHas Role` h on h.parent=c.name
		and h.parenttype='Custom Role' where ifnull(c.report,'')!='' and h.role in %(r)s""", {"r": roles})
	names = set(own) | {r[0] for r in cust}
	return set(frappe.get_all("Report", filters={"name": ["in", list(names)], "disabled": 0}, pluck="name")) if names else set()


def apply_page_access(direct):
	"""Desk pages (PAGE_DOCS): a role that may view a page's documents may open it.
	Through the page's Custom Role. Is_permitted() adds a Custom Role to the page's own
	roles, but the desk's list of pages a user can open (sidebar, search, workspace
	shortcuts) uses ONLY the Custom Role once one exists — so the page's own roles are
	always copied into it (and re-copied when the page is edited: on_page_update).
	Additive, tracked."""
	prev = json.loads(_state_get("page_custom_roles") or "{}")
	state, changed = {}, 0
	comp = _companions(direct)
	comp_pages = {}
	for role, stds in comp.items():
		for page in frappe.get_all("Has Role", filters={"parenttype": "Page", "role": ["in", list(stds)]}, pluck="parent"):
			comp_pages.setdefault(page, set()).add(role)
	comp_pages.pop("order-flow", None)  # has its own Custom Role (order_flow_permissions)
	for page in PAGE_DOCS:
		comp_pages.pop(page, None)  # these follow their own documents only (Point of Sale → POS Invoice)
	for page in sorted(set(PAGE_DOCS) | set(comp_pages) | set(prev)):
		if not frappe.db.exists("Page", page):
			continue
		wanted = _viewers(direct, PAGE_DOCS.get(page, [])) | comp_pages.get(page, set())
		own = set(frappe.get_all("Has Role", filters={"parent": page, "parenttype": "Page"}, pluck="role"))
		cr, custom = _custom_role_roles("page", page)
		mine = set(prev.get(page, []))
		final = own | (custom - mine) | wanted
		if final != custom and (wanted - own or cr):
			_set_custom_role("page", page, final)
			changed += 1
		ours = wanted - own - (custom - mine)
		if ours:
			state[page] = sorted(ours)
	_state_set("page_custom_roles", json.dumps(state))
	return changed


def on_page_update(doc, method=None):
	"""Page on_update: a page whose Custom Role we manage keeps its own roles in it."""
	_copy_own_roles("page", doc.name, "page_custom_roles", "Page")


def on_report_update(doc, method=None):
	"""Report on_update: same, for reports whose Custom Role we manage."""
	_copy_own_roles("report", doc.name, "report_custom_roles", "Report")


def _copy_own_roles(kind, name, state_key, parenttype):
	tracked = (json.loads(_state_get(state_key) or "{}") if kind == "page" else _map_get(state_key))
	cr, custom = _custom_role_roles(kind, name)
	if not cr or name not in tracked:
		return
	own = set(frappe.get_all("Has Role", filters={"parent": name, "parenttype": parenttype}, pluck="role"))
	if kind == "report" and name in _pos_blocked_reports():
		own -= set(POS_ROLES)
	if own - custom:
		_set_custom_role(kind, name, custom | own)
		frappe.clear_cache()


# ------------------------------------------------------------------ Order Flow tabs
def apply_tab_access(sheet):
	"""Set Admin Settings › Order Flow tab and sub-tab roles from the tab sheet (sheet
	roles only; other roles already on a tab are kept): ✓ or A → sees it
	(of_tab_<tab>_roles / of_sub_<tab>_<sub>_roles), A → may also act from it
	(…_act_roles, see order_flow_permissions.can_act_tab). Its own save is not read
	back into the sheet (access_reverse)."""
	frappe.flags.dacs_access_applying = True
	try:
		return _apply_tab_access(sheet)
	finally:
		frappe.flags.dacs_access_applying = False


def tab_fields():
	"""[(sheet row, view field, act field)] for every tab and sub-tab."""
	out = []
	for tab, key in TAB_KEYS.items():
		out.append((tab, f"of_tab_{key}_roles", f"of_tab_{key}_act_roles"))
		for label, sub in SUBTAB_KEYS.get(tab, {}).items():
			out.append((f"{tab} › {label}", f"of_sub_{key}_{sub}_roles", f"of_sub_{key}_{sub}_act_roles"))
	return out


def _apply_tab_access(sheet):
	cols = _role_columns(sheet)
	cells = sheet.get("cells") or {}
	managed = set(cols) | {NOBODY_ROLE}
	doc = frappe.get_doc("Admin Settings")
	meta = frappe.get_meta("Admin Settings")

	def listed(field):
		return [d.role for d in (doc.get(field) or []) if d.role]

	set_fields = 0
	for row, view_f, act_f in tab_fields():
		vals = cells.get(row) or [""] * 99
		if meta.has_field(view_f):
			# The sheet decides the sheet roles only. Any other role already listed on
			# the tab (e.g. Sales User, Accounts Team) stays, so no user loses a tab.
			keep = [r for r in listed(view_f) if r not in managed]
			chosen = [r for r, i in cols.items() if vals[i] in ("Y", "A")]
			doc.set(view_f, [{"role": r} for r in (chosen + keep or [NOBODY_ROLE])])
			set_fields += 1
		if meta.has_field(act_f):
			# Other roles: kept where listed. When actions were never configured, the
			# other roles that see the tab keep acting as they always could.
			before = listed(act_f)
			keep = [r for r in before if r not in managed] if before else keep_view_others(doc, view_f, managed)
			chosen = [r for r, i in cols.items() if vals[i] == "A"]
			doc.set(act_f, [{"role": r} for r in (chosen + keep or [NOBODY_ROLE])])
			set_fields += 1
	doc.flags.ignore_permissions = True
	doc.save(ignore_permissions=True)
	return {"fields": set_fields}


def keep_view_others(doc, view_f, managed):
	return [d.role for d in (doc.get(view_f) or []) if d.role and d.role not in managed]


# ------------------------------------------------------------------ state / bundle
def _state_get(key):
	return frappe.db.get_value("DefaultValue", {"parent": STATE_PARENT, "defkey": key}, "defvalue")


def _state_set(key, value):
	name = frappe.db.get_value("DefaultValue", {"parent": STATE_PARENT, "defkey": key}, "name")
	if name:
		frappe.db.set_value("DefaultValue", name, "defvalue", value, update_modified=False)
	else:
		frappe.get_doc({"doctype": "DefaultValue", "parent": STATE_PARENT, "parenttype": "__default",
						"parentfield": "system_defaults", "defkey": key, "defvalue": value}).insert(ignore_permissions=True)


def _map_get(key):
	"""Tracking maps are stored one DefaultValue row per entry ("<key>:<entry>"),
	since one row holds at most 64 KB. An older single-row value is read too."""
	out = json.loads(_state_get(key) or "{}")
	for r in frappe.get_all("DefaultValue", filters={"parent": STATE_PARENT, "defkey": ["like", f"{key}:%"]},
							fields=["defkey", "defvalue"]):
		out[r.defkey[len(key) + 1:]] = json.loads(r.defvalue or "null")
	return {k: v for k, v in out.items() if v}


def _map_set(key, data):
	frappe.db.delete("DefaultValue", {"parent": STATE_PARENT, "defkey": ["like", f"{key}:%"]})
	frappe.db.delete("DefaultValue", {"parent": STATE_PARENT, "defkey": key})
	for entry, value in data.items():
		frappe.get_doc({"doctype": "DefaultValue", "parent": STATE_PARENT, "parenttype": "__default",
						"parentfield": "system_defaults", "defkey": f"{key}:{entry}"[:140],
						"defvalue": json.dumps(value)}).db_insert()


# Bump when the rules in this file change (dependencies, companions, pages…), so each
# site re-applies its sheets once on the next migrate (sync_from_bundle).
RULES_VERSION = "2026-09-29.2"


def bundle_fingerprint(data):
	"""Identity of the sheets' content (roles + cells), independent of who / when."""
	import hashlib

	core = {s: {"roles": (v or {}).get("roles"), "cells": (v or {}).get("cells")} for s, v in data.items()
			if s in ("doc_access", "tab_access")}
	for s, v in data.items():
		if s in core and (v or {}).get("added"):
			core[s]["added"] = v["added"]  # only when present: older fingerprints stay the same
	return hashlib.sha1(json.dumps(core, sort_keys=True).encode()).hexdigest()


def write_bundle():
	"""Copy the saved sheets into the app (developer mode only), so the next deploy
	ships them. The fingerprint lets each site import a pushed sheet exactly once
	(sync_from_bundle); this site already has it."""
	if not frappe.conf.developer_mode:
		return False
	data = {s: load_sheet(s) for s in ("doc_access", "tab_access")}
	data["fingerprint"] = bundle_fingerprint(data)
	os.makedirs(os.path.dirname(BUNDLE_PATH), exist_ok=True)
	with open(BUNDLE_PATH, "w") as f:
		json.dump(data, f, indent=1, sort_keys=True)
		f.write("\n")
	_state_set("bundle_applied", f"{data['fingerprint']}:{RULES_VERSION}")
	return True


def sync_from_bundle():
	"""after_migrate: when the code carries sheets this site hasn't taken yet (they were
	changed and saved locally, then pushed), store them as a new version; and whenever
	the sheets or the rules (RULES_VERSION) changed, apply them once where the sheet is
	switched on. Runs every migrate but acts once per pushed change, so changes made on
	the site itself stay until a newer sheet is pushed."""
	if not frappe.db.has_column("Role", ROLE_FLAG):
		return  # setup patch hasn't run yet on this site
	bundle = read_bundle()
	if not bundle.get("doc_access"):
		return
	fp = f"{bundle.get('fingerprint') or bundle_fingerprint(bundle)}:{RULES_VERSION}"
	if _state_get("bundle_applied") == fp:
		return
	from erp_dacsinc_custom.access_worksheet import store_sheet

	changed = []
	for name in ("doc_access", "tab_access"):
		b = bundle.get(name)
		if not b:
			continue
		cur = load_sheet(name) or {}
		if (cur.get("roles") != b.get("roles") or cur.get("cells") != b.get("cells")
				or (cur.get("added") or {}) != (b.get("added") or {})):
			store_sheet(name, b["roles"], b["cells"], note="from the app code",
						added=(b.get("added") or {}) if name == "doc_access" else None)
			changed.append(name)
	if is_active():
		# A new sheet, or new rules in the code: (re-)apply both sheets once.
		for name in ("doc_access", "tab_access"):
			sheet = load_sheet(name)
			if sheet:
				apply_sheet(name, sheet)
	_state_set("bundle_applied", fp)
	frappe.db.commit()
	return changed


def read_bundle():
	if not os.path.exists(BUNDLE_PATH):
		return {}
	with open(BUNDLE_PATH) as f:
		return json.load(f) or {}


def apply_sheet(sheet_name, sheet):
	if sheet_name == "doc_access":
		return apply_doc_access(sheet)
	if sheet_name == "tab_access":
		return apply_tab_access(sheet)


def initial_setup():
	"""One-time setup for a site (run from a patch).

	Always safe: creates fields, roles, flags and missing profiles, and stores the
	sheets. It applies them only on a site where the sheet is already switched on."""
	from erp_dacsinc_custom.access_worksheet import store_sheet

	ensure_custom_fields()
	ensure_roles_and_profiles()
	bundle = read_bundle()
	result = {"active": is_active()}
	for name in ("doc_access", "tab_access"):
		sheet = load_sheet(name)
		if not sheet and bundle.get(name):
			sheet = store_sheet(name, bundle[name]["roles"], bundle[name]["cells"],
								note="from the agreed sheet shipped with the app")
		if sheet and is_active():
			result[name] = apply_sheet(name, sheet)
	return result


def activation_preview():
	"""What switching on would change for users: {user: [roles they would lose]}."""
	losing = {}
	for role in sheet_roles():
		name = _profile_name_readonly(role)
		if not name:
			continue
		extra = set(frappe.get_all("Has Role", filters={"parent": name, "parenttype": "Role Profile"}, pluck="role")) \
			- {role, *BASE_ROLES}
		if not extra:
			continue
		users = set(frappe.get_all("User", filters={"role_profile_name": name}, pluck="name"))
		users |= set(frappe.get_all("User Access Profile Role Profile", filters={"role_profile": name}, pluck="parent")) \
			if frappe.db.exists("DocType", "User Access Profile") else set()
		for u in users:
			losing.setdefault(u, set()).update(extra)
	return {u: sorted(r) for u, r in sorted(losing.items())}


def _profile_name_readonly(role):
	wanted = PROFILE_NAME.get(role, role)
	return (frappe.db.get_value("Role Profile", {"name": wanted}, "name")
			or frappe.db.get_value("Role Profile", {"role_profile": wanted}, "name"))


# Order Flow tab / sub-tab → sheet documents it shows (same map as the sheet
# page's "Refill from document access"). A sub-tab not listed uses its tab's.
TAB_DOCS = {
	"SO Approvals": ["Sales Order"], "Sales Tracker": ["Sales Order"],
	"Sales Tracker › Sales Orders": ["Sales Order"], "Sales Tracker › Material Requests": ["Material Request"],
	"Sales Tracker › Embroidery - FP": ["Embroidery Work Order"], "Sales Tracker › Embroidery - Panel": ["Embroidery Work Order"],
	"Pick Lists": ["Pick List"],
	"Purchase Flow": ["Purchase Order"], "Purchase Flow › POs": ["Purchase Order"],
	"Purchase Flow › Receipts": ["Purchase Receipt"], "Purchase Flow › To Bill": ["Purchase Invoice"],
	"Job Work": ["Subcontracting Order"], "Job Work › Sub POs": ["Subcontracting Order"],
	"Job Work › Sub Receipts": ["Subcontracting Receipt"],
	"Job Work › Embroidery - FP": ["Embroidery Work Order"], "Job Work › Embroidery - Panel": ["Embroidery Work Order"],
	"Stock Tracker": ["Stock Entry"], "Pending DN/SI": ["Delivery Note", "Sales Invoice"],
	"Finance": ["Payment Entry"], "Finance › Receivables": ["Sales Invoice", "Payment Entry"],
	"Finance › Supplier Payables": ["Purchase Invoice", "Payment Entry"],
	"Finance › Jobber Payables": ["Purchase Invoice", "Payment Entry"],
	"Embroidery Transfers": ["Uniform Embroidery Transfer"], "Logistics": ["Delivery Note", "Sales Invoice"],
}


# POS roles work from the POS screen and the MR / Stock Entry lists; the Order Flow
# dashboard is built on Sales Orders, which they can't read (every endpoint checks it).
NO_ORDER_FLOW_ROLES = ("POS Admin", "POS Store Manager")


def derive_tab_cells(doc_sheet):
	"""The Order Flow tab sheet worked out from the Document access sheet: a role
	sees a tab if it may view its documents (Y), and acts (A) if it may create or
	submit them — SO Approvals only by submitting. A main tab shows when any of its
	sub-tabs does."""
	roles = doc_sheet.get("roles") or []
	cells = doc_sheet.get("cells") or {}
	out = {}
	for tab in TAB_KEYS:
		keys = [(tab, tab, None)] + [(f"{tab} › {sub}", tab, sub) for sub in SUBTAB_KEYS.get(tab, {})]
		for key, _t, _s in keys:
			docs = TAB_DOCS.get(key) or TAB_DOCS.get(tab) or []
			act = ("S",) if tab == "SO Approvals" else ("E", "S")
			row = []
			for i in range(len(roles)):
				if roles[i] in NO_ORDER_FLOW_ROLES:
					row.append("")
					continue
				vals = [(cells.get(d) or [""] * len(roles))[i] for d in docs]
				row.append("A" if any(l in v for v in vals for l in act) else "Y" if any("V" in v for v in vals) else "")
			out[key] = row
		for sub in SUBTAB_KEYS.get(tab, {}):
			for i, v in enumerate(out[f"{tab} › {sub}"]):
				if v and not out[tab][i]:
					out[tab][i] = "Y"
	return out


def apply_permissions(derive_tabs=False):
	"""Switch on: apply both sheets. Never touches users' roles or profiles.

	derive_tabs: first work the tab sheet out again from the Document access sheet
	(stored as a new version) — used when the stored tab sheet was never hand-made."""
	from erp_dacsinc_custom.access_worksheet import store_sheet

	result = {}
	doc = load_sheet("doc_access")
	if doc:
		result["doc_access"] = apply_doc_access(doc)
		if derive_tabs:
			cells = derive_tab_cells(doc)
			tab = load_sheet("tab_access")
			if not tab or tab.get("cells") != cells or tab.get("roles") != doc.get("roles"):
				store_sheet("tab_access", doc["roles"], cells, note="worked out from document access")
	tab = load_sheet("tab_access")
	if tab:
		result["tab_access"] = apply_tab_access(tab)
	_state_set("active", "1")
	return result


@frappe.whitelist(methods=["POST"])
def activate():
	""""Apply to the ERP" (System Manager only): apply both sheets; users' roles stay as they are."""
	from erp_dacsinc_custom.access_worksheet import RESET_ROLE

	frappe.only_for(RESET_ROLE)
	return apply_permissions()


@frappe.whitelist(methods=["POST"])
def reset_profiles():
	"""Reset each sheet role's profile to role + Employee + ESS (System Manager only,
	explicit). Users on those profiles lose the other roles the profile used to carry."""
	from erp_dacsinc_custom.access_worksheet import RESET_ROLE

	frappe.only_for(RESET_ROLE)
	return {"profiles_reset": ensure_roles_and_profiles(reset=True)}


@frappe.whitelist()
def get_activation_preview():
	from erp_dacsinc_custom.access_worksheet import RESET_ROLE

	frappe.only_for(RESET_ROLE)
	return {"active": is_active(), "users": activation_preview()}

