"""Which Stock Entry Types the Stock Entry form's Stock Entry Type list offers — by role.

ROLE_TYPES names the roles kept to some types. A user is offered every type when they hold ANY
other role that may create or edit a Stock Entry (Admin, Production Manager, Stock Manager, …):
the narrowest role never wins over a broader one. Users holding only restricted roles get the
types of all their restricted roles together. Display only (public/js/stock_entry_type_filter.js):
no permission is changed and a document already saved with another type opens as before.
See docs/merchandiser-purchase.md › Stock Entry.
"""
import frappe

# role → the types it is kept to
ROLE_TYPES = {
	# jobber transfers of their orders; Uniform tab transfers
	"Merchandiser User": ["Send to Subcontractor", "Material Transfer", "Repack"],
}
# roles every login has; they decide nothing here
BASE_ROLES = {"All", "Guest", "Desk User", "Employee", "Employee Self Service"}


def _roles_that_make_stock_entries():
	rows = frappe.get_all("Custom DocPerm", filters={"parent": "Stock Entry", "permlevel": 0},
	                      or_filters={"create": 1, "write": 1}, pluck="role")
	if not rows:  # no customised permissions: the standard ones apply
		rows = frappe.get_all("DocPerm", filters={"parent": "Stock Entry", "permlevel": 0},
		                      or_filters={"create": 1, "write": 1}, pluck="role")
	return set(rows)


@frappe.whitelist()
def allowed_types(user=None):
	"""None = every type; else the list of Stock Entry Type names to offer."""
	user = user or frappe.session.user
	if user == "Administrator":
		return None
	roles = set(frappe.get_roles(user)) - BASE_ROLES
	restricted = roles & set(ROLE_TYPES)
	if not restricted:
		return None
	if (roles - restricted) & _roles_that_make_stock_entries():
		return None  # a broader Stock Entry role (Production Manager, Admin, …) gives every type
	return sorted({t for r in restricted for t in ROLE_TYPES[r]})
