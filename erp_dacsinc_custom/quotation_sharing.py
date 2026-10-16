"""Quotations shared with a DAC CRM user can be submitted by them.

The marketing team creates a quotation and shares it with a DAC CRM user, who checks and submits
it. DAC CRM's own Quotation rights are "only if creator", so the share has to carry Submit —
and "Can Submit" is easy to forget when sharing. So a share of a Quotation with a DAC CRM user
always grants Read, Write and Submit (DocShare after_insert / on_update), whoever shares it.

Submitting also moves the quotation's Lead from Enquiry to Pipeline (custom_script.
quotation_on_submit); that save is flagged `system_update` so Lead's workflow check doesn't refuse
a user who can't read the Lead (custom_lead.validate_lead).
"""

import frappe
from frappe.utils import cint

SUBMIT_ON_SHARE_ROLES = ("DAC CRM",)


def grant_submit_on_quotation_share(doc, method=None):
    """DocShare hook: a Quotation shared (with read) to a DAC CRM user gets write + submit too."""
    if doc.share_doctype != "Quotation" or cint(doc.everyone) or not doc.user or not cint(doc.read):
        return
    if cint(doc.submit) and cint(doc.write):
        return
    if not set(frappe.get_roles(doc.user)) & set(SUBMIT_ON_SHARE_ROLES):
        return
    frappe.db.set_value("DocShare", doc.name, {"write": 1, "submit": 1}, update_modified=False)
    doc.write = doc.submit = 1


def backfill_existing_shares():
    """Patch: existing draft-quotation shares with DAC CRM users get write + submit."""
    users = set(frappe.get_all("Has Role", filters={"role": ["in", SUBMIT_ON_SHARE_ROLES], "parenttype": "User"},
                               pluck="parent"))
    if not users:
        return
    shares = frappe.db.sql("""
        SELECT ds.name FROM `tabDocShare` ds
        JOIN `tabQuotation` q ON q.name = ds.share_name
        WHERE ds.share_doctype = 'Quotation' AND IFNULL(ds.everyone, 0) = 0 AND ds.`read` = 1
          AND (IFNULL(ds.submit, 0) = 0 OR IFNULL(ds.`write`, 0) = 0)
          AND q.docstatus = 0 AND ds.user IN %(users)s""", {"users": tuple(users)}, pluck=True)
    for name in shares:
        frappe.db.set_value("DocShare", name, {"write": 1, "submit": 1}, update_modified=False)
    print(f"quotation shares given submit: {len(shares)}")
