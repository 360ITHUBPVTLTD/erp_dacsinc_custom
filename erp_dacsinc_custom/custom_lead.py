# import frappe
# from frappe.model.document import Document

# @frappe.whitelist()
# def create_quotation_from_lead(lead_name):
#     """
#     Create a Quotation from a Lead and return the Quotation name.
#     """
#     # Fetch the Lead document
#     lead = frappe.get_doc('Lead', lead_name)
    
#     if not lead:
#         frappe.throw(f"No Lead found with name {lead_name}")
    
#     # Create a new Quotation
#     quotation = frappe.get_doc({
#         'doctype': 'Quotation',
#         'customer': lead.company_name or '',  # Set customer or other relevant fields
#         'customer_name': lead.company_name or lead.first_name + ' ' + (lead.middle_name or '') + ' ' + (lead.last_name or ''),
#         'quotation_to': 'Customer',
#         'contact_person': lead.custom_contact_person_name,
#         'contact_email': lead.email_id,
#         'contact_mobile': lead.mobile_no,
#         'address': lead.custom_address,
#         'gstin': lead.custom_gstin,
#         # Add other fields as required
#     })

#     # Save the Quotation document
#     quotation.insert(ignore_permissions=True)

#     return quotation.name


import frappe
from frappe import _  # Import the _ function for translations

def get_mapped_doc(source_doctype, source_name, mapping, target_doc=None, set_missing_values=None, ignore_permissions=False):
    """
    Map fields from a source document to a target document.

    :param source_doctype: The doctype of the source document.
    :param source_name: The name of the source document.
    :param mapping: A dictionary defining field mappings.
    :param target_doc: An optional target document instance.
    :param set_missing_values: An optional function to set additional values.
    :param ignore_permissions: Whether to ignore permissions checks.
    :return: The mapped target document.
    """
    
    # Load the source document
    source_doc = frappe.get_doc(source_doctype, source_name)

    # If no target document is provided, create a new one
    if not target_doc:
        target_doc = frappe.new_doc(mapping[source_doctype]["doctype"])

    # Map fields from source to target
    field_map = mapping[source_doctype].get("field_map", {})
    field_no_map = mapping[source_doctype].get("field_no_map", [])
    
    for src_field, tgt_field in field_map.items():
        if hasattr(source_doc, src_field) and tgt_field not in field_no_map:
            setattr(target_doc, tgt_field, getattr(source_doc, src_field))

    # Set missing values if provided
    if set_missing_values:
        set_missing_values(source_doc, target_doc)

    # Save the document if ignore_permissions is not True
    if not ignore_permissions:
        target_doc.insert()

    return target_doc

# @frappe.whitelist()
# def make_customer(source_name, target_doc=None):
#     # Call _make_customer to get the mapped document
#     target_doc = _make_customer(source_name, target_doc)
    
#     # Return the target document for preview
#     return target_doc.as_dict()

# def _make_customer(source_name, target_doc=None, ignore_permissions=False):
#     def set_missing_values(source, target):
#         if source.company_name:
#             target.customer_type = "Company"
#             target.customer_name = source.company_name
#         else:
#             target.customer_type = "Individual"
#             target.customer_name = source.lead_name
        
#         target.customer_group = frappe.db.get_default("Customer Group")

#     # Load the source document
#     source_doc = frappe.get_doc("Lead", source_name)

#     # Create a new target document
#     target_doc = frappe.new_doc("Customer")

#     # Map fields from source to target
#     field_map = {
#         "name": "lead_name",
#         "company_name": "customer_name",
#         "contact_no": "phone_1",
#         "fax": "fax_1",
#         "mobile_no": "custom_customer_mobile_no",
#         "email_id": "custom_customer_mail_id",
#         "custom_gstin": "gstin",
#         "custom_address": "custom_address",
#     }
#     field_no_map = ["disabled"]
    
#     for src_field, tgt_field in field_map.items():
#         if hasattr(source_doc, src_field) and tgt_field not in field_no_map:
#             setattr(target_doc, tgt_field, getattr(source_doc, src_field))

#     # Set missing values if provided
#     if set_missing_values:
#         set_missing_values(source_doc, target_doc)

#     return target_doc

@frappe.whitelist()
def make_customer(source_name, target_doc=None):
    # Call _make_customer to get the mapped document
    target_doc = _make_customer(source_name, target_doc)
    
    # Return the target document for preview
    return target_doc.as_dict()

def _make_customer(source_name, target_doc=None, ignore_permissions=False):
    def set_missing_values(source, target):
        if source.company_name:
            target.customer_type = "Company"
            target.customer_name = source.company_name
        else:
            target.customer_type = "Individual"
            target.customer_name = source.lead_name
        
        target.customer_group = frappe.db.get_default("Customer Group")

    # Load the source document
    source_doc = frappe.get_doc("Lead", source_name)

    # Check if a Customer with the same email ID or mobile number already exists
    existing_customer = frappe.get_all("Customer", filters={
        "custom_customer_mail_id": source_doc.email_id,
        "custom_customer_mobile_no": source_doc.mobile_no,
        
    }, fields=["name"])

    if existing_customer:
        # Raise an error if a customer with the same email ID or mobile number already exists
        frappe.throw(_("A customer with this email ID or mobile number already exists."))

    # Create a new target document
    target_doc = frappe.new_doc("Customer")

    # Map fields from source to target
    field_map = {
        "name": "lead_name",
        "company_name": "customer_name",
        "contact_no": "phone_1",
        "fax": "fax_1",
        "mobile_no": "custom_customer_mobile_no",
        "email_id": "custom_customer_mail_id",
        "custom_gstin": "gstin",
        "custom_address": "custom_address",
        "gender":"gender",
        "custom_reference_by_cid":"custom_reference_by_cid",
        "custom_address":"custom_address",
        "country":"custom_country",
        "custom_state_1":"custom_state",
        "custom_city_2":"custom_city",
        "custom_pin_code":"custom_pincode"
    }
    field_no_map = ["disabled"]
    
    for src_field, tgt_field in field_map.items():
        if hasattr(source_doc, src_field) and tgt_field not in field_no_map:
            setattr(target_doc, tgt_field, getattr(source_doc, src_field))

    # Set missing values if provided
    if set_missing_values:
        set_missing_values(source_doc, target_doc)

    return target_doc



@frappe.whitelist()
def make_quotation(source_name, target_doc=None, ignore_permissions=False):
    return _make_quotation(source_name, target_doc)

def _make_quotation(source_name, target_doc=None, ignore_permissions=False):
    def set_missing_values(source, target):
        target.quotation_to = "Lead"
        target.custom_customer_gstin = source.custom_gstin
        target.custom_customer_email_id = source.email_id
        target.custom_customer_mobile_no = source.mobile_no
        target.custom_address = source.custom_address

    # Get the source document
    source_doc = frappe.get_doc("Lead", source_name)

    # Create a new Quotation document
    target_doc = frappe.new_doc("Quotation")

    # Map fields from source to target
    field_map = {
        "name": "party_name",
        "contact_no": "contact_mobile",
        "email_id": "contact_email",
        "mobile_no": "contact_mobile",
    }
    field_no_map = ["disabled"]

    for src_field, tgt_field in field_map.items():
        if hasattr(source_doc, src_field) and tgt_field not in field_no_map:
            setattr(target_doc, tgt_field, getattr(source_doc, src_field))

    # Set additional values
    set_missing_values(source_doc, target_doc)

    # Return the target document as a dictionary for the client side
    return target_doc.as_dict()



import frappe
@frappe.whitelist()
def get_activities_for_lead(lead_name):
    """
    Fetches all To-dos and Events linked to a specific lead.
    Returns a dictionary with two keys: 'todos' and 'events'.
    Filters records based on the current user's permissions.
    """
    if not lead_name:
        return None

    user = frappe.session.user  # Get the current session user

    # Fetch all To-dos where the lead is the reference, considering user permissions
    todos = frappe.get_all(
        "ToDo",
        filters={
            "reference_type": "Lead",
            "reference_name": lead_name,
        },
        fields=["name", "description", "status", "date", "allocated_to"],
    )
    
    # Filter ToDos based on access permissions
    todos = [
        todo for todo in todos
        if frappe.has_permission("ToDo", "read", todo["name"])  # Check if user has 'read' permission on the ToDo
    ]

    # Fetch all Events where the lead is referenced, considering user permissions
    events = frappe.get_all(
        "Event",
        filters=[
            ["Event Participants", "reference_doctype", "=", "Lead"],
            ["Event Participants", "reference_docname", "=", lead_name]
        ],
        fields=["name", "subject", "starts_on", "status"]
    )
    
    # Filter Events based on access permissions
    events = [
        event for event in events
        if frappe.has_permission("Event", "read", event["name"])  # Check if user has 'read' permission on the Event
    ]

    return {
        "todos": todos,
        "events": events
    }
   

import frappe

@frappe.whitelist()
def get_tasks_for_lead(lead_name):
    return frappe.get_all(
        "Task",
        filters={
            "custom_lead_id": lead_name,
        },
        fields=["name", "subject", "status", "exp_end_date"],
        order_by="modified desc"
    )


@frappe.whitelist()
def get_lead_activity_status(lead_id):
    open_count = frappe.db.count("Lead Activity", {"reference_type":"Lead","reference_name": lead_id, "status": "Open"})
    closed_count = frappe.db.count("Lead Activity", {"reference_type":"Lead","reference_name": lead_id, "status": "Completed"})
    total_count = frappe.db.count("Lead Activity", {"reference_type":"Lead","reference_name": lead_id})  # Total activities regardless of status

    return {"open": open_count, "closed": closed_count, "total": total_count}

from frappe.share import add, get_users, remove

# Event after insertion for Event
def after_insert_event(doc, method):
    if doc.custom_allocated_to:
        remove_existing_shares(doc)
        share_event_with_user(doc)

# Event before saving for Event
def before_save_event(doc, method):
    if not doc.is_new():
        if doc.custom_allocated_to:
            if doc.get("name"):
                remove_existing_shares(doc)
                share_event_with_user(doc)

# Lead after insertion
def after_insert_lead(doc, method):
    print("After Insert Lead Triggered")  # Debugging line to check if the function is called
    if doc.lead_owner:
        print(f"Lead Owner: {doc.lead_owner}")  # Debugging line to check if lead_owner is set
        remove_existing_shares(doc)
        share_event_with_user(doc)
    else:
        print("No lead_owner set.")  # Debugging line if lead_owner is not set

# Lead before saving
def before_save_lead(doc, method):
    old_status = doc.get_db_value('custom_lead_category')
    new_status = doc.custom_lead_category
    if old_status != new_status:
        doc.append('custom_lead_status_change_history', {
            'old_status': old_status,
            'new_status': new_status,
            'changed_by': frappe.session.user,
            'updated_at': frappe.utils.now_datetime(),
        })
    if not doc.is_new():
        if doc.lead_owner:
            if doc.get("name"):
                remove_existing_shares(doc)
                share_event_with_user(doc)

# Function to remove existing shares
def remove_existing_shares(doc):
    try:
        # Get all users who have access to this document
        shares = get_users(doc.doctype, doc.name)
        
        # Remove share for each user except the new one
        for share in shares:
            # Check to ensure that the current user is not the one we want to share with
            if (doc.doctype == "Event" and share.user != doc.custom_allocated_to) or \
               (doc.doctype == "Lead" and share.user != doc.lead_owner):
                remove(doc.doctype, doc.name, share.user)
        
        # frappe.msgprint(f"Removed all shares except the new user for {doc.doctype} {doc.name}")
    except Exception as e:
        frappe.log_error(f"Failed to remove shares for {doc.doctype} {doc.name}: {str(e)}")

# Function to share event or lead with the appropriate user
def share_event_with_user(doc):
    try:
        # Check for Event or Lead and share accordingly
        if doc.doctype == "Event" and doc.custom_allocated_to:
            add(doc.doctype, doc.name, doc.custom_allocated_to, write=1, share=1, everyone=0)
            # frappe.msgprint(f"Event shared with {doc.custom_allocated_to}")
        elif doc.doctype == "Lead" and doc.lead_owner:
            add(doc.doctype, doc.name, doc.lead_owner, write=1, share=1, everyone=0)
            # frappe.msgprint(f"Lead shared with {doc.lead_owner}")
    except Exception as e:
        frappe.log_error(f"Failed to share {doc.doctype} {doc.name} with {doc.custom_allocated_to if doc.doctype == 'Event' else doc.lead_owner}: {str(e)}")





@frappe.whitelist()
def get_lead_details(lead_id):
    lead = frappe.get_doc("Lead", lead_id)
    return {
        "lead_name": lead.lead_name,
        "email_id": lead.email_id,
        "mobile_no": lead.mobile_no,
        "company_name": lead.company_name,
        "custom_lead_category": getattr(lead, "custom_lead_category", None),
        "link": f"/app/lead/{lead.name}"
    }
