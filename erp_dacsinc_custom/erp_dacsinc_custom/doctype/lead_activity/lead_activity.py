# Copyright (c) 2025, Pankaj and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class LeadActivity(Document):
	def before_save(self):
		if self.reference_type and self.reference_name:

			
			ref_type = self.reference_type
			ref_name = self.reference_name
			ref_doc = frappe.get_doc(ref_type, ref_name)

			# Logic for readable name
			if ref_type == "Lead":
				self.reference_doc_name = ref_doc.company_name or ref_doc.lead_name
			elif ref_type == "Customer":
				self.reference_doc_name = ref_doc.customer_name
			elif ref_type == "Supplier":
				self.reference_doc_name = ref_doc.supplier_name
			else:
				self.reference_doc_name = ref_name
		else:
			self.reference_type = None
			self.reference_name = None
			self.reference_doc_name = None
	def after_insert(self):
		"""
		If you want to sync with Event, make sure Event has these fields.
		Otherwise, update LeadActivity itself (not Event).
		"""
		if self.reference_type and self.reference_name:
			ref_type = self.reference_type
			ref_name = self.reference_name
			ref_doc = frappe.get_doc(ref_type, ref_name)

			if ref_type == "Lead":
				ref_doc_name = ref_doc.company_name or ref_doc.lead_name
			elif ref_type == "Customer":
				ref_doc_name = ref_doc.customer_name
			elif ref_type == "Supplier":
				ref_doc_name = ref_doc.supplier_name
			else:
				ref_doc_name = ref_name

			# ✅ Update Lead Activity itself instead of Event
			frappe.db.set_value(
				"Lead Activity",
				self.name,
				{
					"reference_doc_name": ref_doc_name
				}
			)

   

