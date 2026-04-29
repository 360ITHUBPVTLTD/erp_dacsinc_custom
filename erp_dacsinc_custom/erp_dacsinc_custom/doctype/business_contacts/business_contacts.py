# Copyright (c) 2026, Pankaj and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class BusinessContacts(Document):
	def on_update(self):
		# 1. Management of Read/Write permissions
		if self.assign_to:
			# Grant Write access to the currently assigned user
			frappe.share.add("Business Contacts", self.name, self.assign_to, write=1, read=1, notify=1)
			
			# Ensure the Owner (creator) or anyone else only has READ access, not write
			# We fetch all current shares for this document
			shares = frappe.get_all("DocShare", filters={
				"share_doctype": "Business Contacts",
				"share_name": self.name
			}, fields=["user", "name"])

			for s in shares:
				# If the shared user is NOT the current assigned user, downgrade to Read Only
				if s.user != self.assign_to:
					frappe.db.set_value("DocShare", s.name, "write", 0)


# import frappe
# from frappe import _

# @frappe.whitelist()
# def make_lead_from_contact(source_name):
#     # Fetch the Business Contact document
#     doc = frappe.get_doc("Business Contacts", source_name)

#     if doc.status == "Converted":
#         frappe.throw(_("This Business Contact is already converted to Lead {0}").format(doc.lead_id))

#     # 1. Create the Lead Document
#     lead = frappe.get_doc({
#         "doctype": "Lead",
#         "first_name": doc.contact_name,
#         "mobile_no": doc.mobile_number,
#         "source": doc.source,
#         "custom_lead_description": doc.details,
#         "industry": doc.industry,
#         "job_title": doc.job_title,
#         "custom_address": doc.address,
#         "country": doc.country,
#         "custom_custom_state": doc.state,
#         "custom_custom_city": doc.city,
#         "custom_business_contacts": doc.name  # Link back to BC
#     })
    
#     # Optional: Inherit company if needed
#     # if doc.company:
#     #     lead.company = doc.company
        
#     lead.insert(ignore_permissions=True)

#     # 2. Update Business Contact status and Lead ID
#     doc.status = "Converted to Lead"
#     doc.lead_id = lead.name
#     doc.save(ignore_permissions=True)

#     return lead.name




@frappe.whitelist()
def make_lead_from_contact(source_name):
    # Fetch the Business Contact document
    doc = frappe.get_doc("Business Contacts", source_name)

    if doc.status == "Converted to Lead":
        frappe.throw(_("This Business Contact is already converted to Lead {0}").format(doc.lead_id))

    # 1. Create the Lead Document
    lead = frappe.get_doc({
        "doctype": "Lead",
        "first_name": doc.contact_name,
        "mobile_no": doc.mobile_number,
        "source": doc.source,
        "custom_lead_description": doc.details,
        "industry": doc.industry,
        "job_title": doc.job_title,
        "custom_address": doc.address,
        "country": doc.country,
        "email_id": doc.email_id,
        # IMPORTANT: Ensure these attribute names match your Business Contacts field names exactly
        "custom_custom_state": doc.state, 
        "custom_custom_city": doc.city,
        "custom_business_contacts": doc.name,
        "custom_sub_source": doc.sub_source,
        "company_name" : doc.organization_name,
        "custom_number_of_employee": doc.number_of_employee
    })
    
    lead.insert(ignore_permissions=True)

    # 2. Update Business Contact status
    doc.status = "Converted to Lead"
    doc.lead_id = lead.name
    doc.save(ignore_permissions=True)

    return lead.name