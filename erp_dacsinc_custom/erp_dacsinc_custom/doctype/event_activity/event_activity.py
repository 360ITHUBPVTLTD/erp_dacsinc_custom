# Copyright (c) 2025, Pankaj and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime
from frappe.share import add, remove
from bs4 import BeautifulSoup
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
				self.address = ref_doc.custom_address
				self.reference_doc_mobile_no = ref_doc.mobile_no
			elif self.reference_type in ["Customer", "Supplier"]:
				self.reference_doc_name = ref_doc.customer_name if self.reference_type=="Customer" else ref_doc.supplier_name
				raw_html = ref_doc.primary_address or ""
				# Strip <br> and other HTML tags
				self.address = BeautifulSoup(raw_html, "html.parser").get_text(separator=", ")
				self.reference_doc_mobile_no = ref_doc.mobile_no
			else:
				self.reference_doc_name = ref_name
		else:
			self.reference_type = None
			self.reference_name = None
			self.reference_doc_name = None

	def after_insert(self):
		# Handle user sharing after insert
		if self.assigned_to:
			# remove_existing_shares(self)
			share_event_with_user(self)

			# ✅ Mark lead as "Activity Created" using direct DB update
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
	def on_update(self):
		"""Recalculate whenever status changes"""
		if self.reference_type == "Lead" and self.reference_name:
			if self.status in ["Completed", "Cancelled"] and not self.ends_on:
				# Set ends_on if activity is closed
				frappe.db.set_value("Event Activity", self.name, "ends_on", now_datetime())

			self.update_lead_next_followup()

	def update_lead_next_followup(self):
		"""Find the earliest open LeadActivity and set it as next follow-up date"""
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

		next_date = next_activity[0].starts_on if next_activity else None

		frappe.db.set_value(
			"Lead",
			self.reference_name,
			"custom_next_followup_date",
			next_date
		)


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

