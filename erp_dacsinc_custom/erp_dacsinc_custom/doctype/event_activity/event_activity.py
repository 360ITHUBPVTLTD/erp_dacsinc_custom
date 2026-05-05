# Copyright (c) 2025, Pankaj and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime
from frappe.share import add, remove
from bs4 import BeautifulSoup
from frappe.utils import now_datetime, getdate  # Added getdate import

class EventActivity(Document):
	def before_save(self):
		# Handle user sharing before save (only for existing docs)
		if not self.is_new():
			if self.assigned_to and self.name:
				# remove_existing_shares(self)
				share_event_with_user(self)

		# Set readable reference_doc_name
		if self.reference_type and self.reference_name:
			ref_type = self.reference_type
			ref_name = self.reference_name
			ref_doc = frappe.get_doc(ref_type, ref_name)

			if ref_type == "Lead":
				self.reference_doc_name = ref_doc.company_name or ref_doc.lead_name
				# self.address = ref_doc.custom_address
			elif self.reference_type in ["Customer", "Supplier"]:
				self.reference_doc_name = ref_doc.customer_name if self.reference_type=="Customer" else ref_doc.supplier_name
				raw_html = ref_doc.primary_address or ""
				# Strip <br> and other HTML tags
				self.address = BeautifulSoup(raw_html, "html.parser").get_text(separator=", ")
    
			else:
				self.reference_doc_name = ref_name
		else:
			self.reference_type = None
			self.reference_name = None
			self.reference_doc_name = None

	def after_insert(self):
		# Trigger business contact update
		self.update_business_contact_on_completion()
		# Handle user sharing after insert
		if self.assigned_to:
			# remove_existing_shares(self)
			share_event_with_user(self)

		# Recalculate next follow-up for Lead
		if self.reference_type == "Lead" and self.reference_name:
			self.update_lead_next_followup()

			activity_count = frappe.db.count(
				"Event Activity",
				filters={
					"reference_type": "Lead",
					"reference_name": self.reference_name
				}
			)

			if activity_count == 1:
				frappe.db.set_value(
					"Lead",
					self.reference_name,
					"custom_is_activity_created",								
					1,
				)

		# Recalculate next follow-up for PFS Form
		elif self.reference_type == "PFS Form" and self.reference_name:
			self.update_pfs_next_followup()

	def on_update(self):
		"""Recalculate whenever status changes"""
		if self.reference_type == "Lead" and self.reference_name:
			if self.status in ["Completed", "Cancelled"] and not self.ends_on:
				# Set ends_on if activity is closed
				frappe.db.set_value("Event Activity", self.name, "ends_on", now_datetime())

			self.update_lead_next_followup()
		if self.reference_type == "Business Contacts" and self.reference_name:
			if self.status in ["Completed", "Cancelled"] and not self.ends_on:
				# Set ends_on if activity is closed
				frappe.db.set_value("Event Activity", self.name, "ends_on", now_datetime())

			self.update_business_contact_next_followup()
			self.update_business_contact_on_completion()
		elif self.reference_type == "PFS Form" and self.reference_name:
			if self.status in ["Completed", "Cancelled"] and not self.ends_on:
				# Set ends_on if activity is closed
				frappe.db.set_value("Event Activity", self.name, "ends_on", now_datetime())

			self.update_pfs_next_followup()
		# Trigger business contact update
		
	def update_lead_next_followup(self):
		"""Find the earliest open Event Activity and set it as next follow-up date. Clear if none exist."""
		
		# Defensive check: ensure this is linked to a Lead
		if getattr(self, "reference_type", None) != "Lead" or not self.reference_name:
			return

		next_activity = frappe.db.sql("""
			SELECT starts_on 
			FROM `tabEvent Activity`
			WHERE reference_type = 'Lead'
			AND reference_name = %s
			AND status = 'Open'
			AND starts_on IS NOT NULL
			ORDER BY starts_on ASC
			LIMIT 1
		""", (self.reference_name,), as_dict=True)

		# If next_activity exists, use the date; otherwise, set to None
		# None effectively clears the field in the database
		next_date = next_activity[0].starts_on if next_activity else None

		frappe.db.set_value(
			"Lead",
			self.reference_name,
			"custom_next_followup_date",
			next_date
		)

	def update_business_contact_next_followup(self):
		"""Find the earliest open Event Activity and set it as next follow-up date. Clear if none exist."""
		
		# Defensive check: ensure this is linked to a Lead
		if getattr(self, "reference_type", None) != "Business Contacts" or not self.reference_name:
			return

		next_activity = frappe.db.sql("""
			SELECT starts_on 
			FROM `tabEvent Activity`
			WHERE reference_type = 'Business Contacts'
			AND reference_name = %s
			AND status = 'Open'
			AND starts_on IS NOT NULL
			ORDER BY starts_on ASC
			LIMIT 1
		""", (self.reference_name,), as_dict=True)

		# If next_activity exists, use the date; otherwise, set to None
		# None effectively clears the field in the database
		next_date = next_activity[0].starts_on if next_activity else None

		frappe.db.set_value(
			"Business Contacts",
			self.reference_name,
			"next_follow_up_date",
			next_date
		)

	def update_pfs_next_followup(self):
		"""Find the earliest open Event Activity for PFS Form and set it as next follow-up date. Clear if none exist."""
		
		# Defensive check: ensure this is linked to a PFS Form
		if getattr(self, "reference_type", None) != "PFS Form" or not self.reference_name:
			return

		next_activity = frappe.db.sql("""
			SELECT starts_on 
			FROM `tabEvent Activity`
			WHERE reference_type = 'PFS Form'
			AND reference_name = %s
			AND status = 'Open'
			AND starts_on IS NOT NULL
			ORDER BY starts_on ASC
			LIMIT 1
		""", (self.reference_name,), as_dict=True)

		# If next_activity exists, use the date; otherwise, set to None
		# None effectively clears the field in the database
		next_date = next_activity[0].starts_on if next_activity else None

		frappe.db.set_value(
			"PFS Form",
			self.reference_name,
			"next_followup_date",
			next_date
		)


	def update_business_contact_on_completion(self):
		# frappe.throw("update_business_contact_on_completion")
		"""
		Called from after_insert and on_update.
		"""
		# 1. Critical Debug: This will log to the Error Log if the function is even triggered
		# frappe.log_error(f"Doc Status: {doc.status}, Ref: {doc.reference_type}", "Update Debug")

		# 2. Logic Check: Most people use 'Business Contact' (Singular) 
		# check if your DocType is "Business Contacts" or "Business Contact"
		ref_type = str(self.reference_type).strip()
		status = str(self.status).strip()

		if ref_type == "Business Contacts" and status == "Completed":
			# frappe.throw("Inside update_business_contact_on_completion")
			try:
				completion_date = getdate(self.ends_on) if self.ends_on else getdate(now_datetime())
				
				frappe.db.set_value("Business Contacts", self.reference_name, {
					"last_completed_activity_type": self.category,
					"last_completion_notes": self.notes,
					"last_completed_date": completion_date
				}, update_modified=True)
				
				# Using msgprint to show success in UI
				frappe.msgprint(f"Business Contacts {self.reference_name} updated successfully.")

			except Exception:
				frappe.log_error(message=frappe.get_traceback(), title="Event Activity Logic Error")


def share_event_with_user(doc):
	"""Share Event Activity with assigned user"""
	try:
		if doc.doctype == "Event Activity" and doc.assigned_to:
			add(
				doc.doctype,
				doc.name,
				doc.assigned_to,
				write=1,
				share=1,
				everyone=0
			)
	except Exception as e:
		frappe.log_error(
			f"Failed to share {doc.doctype} {doc.name} with {doc.assigned_to}: {str(e)}"
		)


def remove_existing_shares(doc):
	"""Remove existing shares for this doc before re-sharing"""
	try:
		frappe.db.sql(
			"""
			DELETE FROM `tabDocShare`
			WHERE share_doctype = %s AND share_name = %s
			""",
			(doc.doctype, doc.name),
		)
	except Exception as e:
		frappe.log_error(
			f"Failed to remove existing shares for {doc.doctype} {doc.name}: {str(e)}"
		)





import frappe

@frappe.whitelist()
def get_lead_details(id):
    """Fetches details for a Lead"""
    doc = frappe.get_all("Lead", 
        filters={"name": id}, 
        fields=["name", "lead_name", "email_id", "mobile_no", "company_name", "custom_lead_category"]
    )
    return doc[0] if doc else None

@frappe.whitelist()
def get_customer_details(id):
    """Fetches details for a Customer"""
    doc = frappe.get_all("Customer", 
        filters={"name": id}, 
        fields=["name", "customer_name as lead_name", "email_id", "mobile_no", "customer_group as custom_lead_category"]
    )
    return doc[0] if doc else None

@frappe.whitelist()
def get_supplier_details(id):
    """Fetches details for a Supplier"""
    doc = frappe.get_all("Supplier", 
        filters={"name": id}, 
        fields=["name", "supplier_name as lead_name", "email_id", "mobile_no", "supplier_group as custom_lead_category"]
    )
    return doc[0] if doc else None

@frappe.whitelist()
def get_business_contact_details(id):
    """Fetches details for Business Contacts (Custom DocType)"""
    doc = frappe.get_all("Business Contacts", 
        filters={"name": id}, 
        fields=[
            "name", 
            "contact_name as lead_name", 
            "email_id", 
            "mobile_number as mobile_no", 
            "organization_name as company_name", 
            "industry as custom_lead_category",
            "status"
        ]
    )
    return doc[0] if doc else None