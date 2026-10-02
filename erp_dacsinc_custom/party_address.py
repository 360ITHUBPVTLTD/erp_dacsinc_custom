"""Customer / Supplier primary address, filled when missing (docs/master-data-protection.md).

A Customer or Supplier with an address but no primary address gets one: the address
ticked "Preferred Billing" (is_primary_address) if any, else the oldest — enabled
addresses only. Done for every party once (patch party_defaults_and_primary_address)
and from then on whenever an address linked to a party is saved (Address after_insert /
on_update). A primary address already set is never changed.
"""

import frappe

PRIMARY_FIELD = {"Customer": "customer_primary_address", "Supplier": "supplier_primary_address"}


def _pick(party_doctype, name):
	rows = frappe.db.sql("""
		select a.name from `tabDynamic Link` dl join tabAddress a on a.name = dl.parent
		where dl.parenttype = 'Address' and dl.link_doctype = %s and dl.link_name = %s and ifnull(a.disabled, 0) = 0
		order by a.is_primary_address desc, a.creation asc limit 1""", (party_doctype, name))
	return rows[0][0] if rows else None


def set_primary_address(party_doctype, name):
	"""Fill the party's primary address when empty; returns the address set (or None)."""
	field = PRIMARY_FIELD.get(party_doctype)
	if not field or frappe.db.get_value(party_doctype, name, field):
		return None
	address = _pick(party_doctype, name)
	if not address:
		return None
	from frappe.contacts.doctype.address.address import get_address_display
	frappe.db.set_value(party_doctype, name, {field: address, "primary_address": get_address_display(address)},
						update_modified=False)
	return address


def on_address_save(doc, method=None):
	"""Address after_insert / on_update: its Customers / Suppliers without a primary address get one."""
	if doc.get("disabled"):
		return
	for link in doc.get("links") or []:
		if link.link_doctype in PRIMARY_FIELD and link.link_name:
			set_primary_address(link.link_doctype, link.link_name)


def backfill():
	done = {}
	for party, field in PRIMARY_FIELD.items():
		names = frappe.db.sql(f"""select p.name from `tab{party}` p where ifnull(p.{field}, '') = '' and exists (
			select 1 from `tabDynamic Link` dl join tabAddress a on a.name = dl.parent
			where dl.parenttype = 'Address' and dl.link_doctype = %s and dl.link_name = p.name and ifnull(a.disabled, 0) = 0)""",
			party, pluck=True)
		done[party] = sum(1 for n in names if set_primary_address(party, n))
	return done
