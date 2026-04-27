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
    open_count = frappe.db.count("Event Activity", {"reference_type":"Lead","reference_name": lead_id, "status": "Open"})
    closed_count = frappe.db.count("Event Activity", {"reference_type":"Lead","reference_name": lead_id, "status": "Completed"})
    total_count = frappe.db.count("Event Activity", {"reference_type":"Lead","reference_name": lead_id})  # Total activities regardless of status

    return {"open": open_count, "closed": closed_count, "total": total_count}

from frappe.share import add, get_users, remove

# Event after insertion for Event
def after_insert_event(doc, method):
    if doc.custom_allocated_to:
        # remove_existing_shares(doc)
        share_event_with_user(doc)

# Event before saving for Event
def before_save_event(doc, method):
    if not doc.is_new():
        if doc.custom_allocated_to:
            if doc.get("name"):
                # remove_existing_shares(doc)
                share_event_with_user(doc)

# Lead after insertion
def after_insert_lead(doc, method):
    doc.db_set("custom_lead_id", doc.name)
    # print("After Insert Lead Triggered")  # Debugging line to check if the function is called
    if doc.lead_owner:
        # print(f"Lead Owner: {doc.lead_owner}")  # Debugging line to check if lead_owner is set
        # remove_existing_shares(doc)
        share_event_with_user(doc)
    else:
        print("No lead_owner set.")  # Debugging line if lead_owner is not set

import frappe
def on_update_lead(doc, method=None):
    """
    Handle sharing in on_update to avoid 'Document Modified' errors.
    """
    # Use flags to prevent infinite loops if your sharing logic triggers more saves
    if doc.flags.in_sharing_logic:
        return

    doc.flags.in_sharing_logic = True

    # Get the previous owner from the last history row we just added in validate
    if doc.get('custom_lead_owner_change_history'):
        last_change = doc.custom_lead_owner_change_history[-1]
        
        # If the latest history entry was created just now (within the last few seconds)
        # This confirms an owner change actually happened
        old_owner = last_change.from_lead_owner
        new_owner = last_change.to_lead_owner

        if old_owner != new_owner:
            # Update Share Permissions for Lead
            if old_owner:
                frappe.share.add(doc.doctype, doc.name, old_owner, read=1, write=0, share=1)

            if new_owner:
                frappe.share.add(doc.doctype, doc.name, new_owner, read=1, write=1, share=1)

            # Update sharing for related Event Activities
            events = frappe.get_all("Event Activity", 
                filters={"reference_type": "Lead", "reference_name": doc.name}, 
                pluck="name"
            )
            for event in events:
                if new_owner:
                    frappe.share.add("Event Activity", event, new_owner, read=1, write=0, share=1)

    # Handle sharing for new owner if it's a new lead (Logic from your share_event_with_user)
    # Note: Only run if it hasn't been shared yet
    if doc.lead_owner:
        # Check if already shared to avoid redundant DB hits
        if not frappe.db.exists("DocShare", {"share_doctype": doc.doctype, "share_name": doc.name, "user": doc.lead_owner}):
            frappe.share.add(doc.doctype, doc.name, doc.lead_owner, read=1, write=1, share=1)



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
    # print('sssssssssssssss',doc)
    try:
        # Check for Event or Lead and share accordingly
        if doc.doctype == "Event" and doc.custom_allocated_to:
            add(doc.doctype, doc.name, doc.custom_allocated_to, write=1, share=1, everyone=0)
            # frappe.msgprint(f"Event shared with {doc.custom_allocated_to}")
        elif doc.doctype == "Lead" and doc.lead_owner:
            add(doc.doctype, doc.name, doc.lead_owner, write=1, share=1, notify=1,everyone=0)
        elif doc.doctype == "Event Activity" and not doc.assigned_to:
            add(doc.doctype, doc.name, doc.assigned_to, write=1, share=1, notify=1,everyone=0)
            # frappe.msgprint(f"Lead shared with {doc.lead_owner}")
    except Exception as e:
        frappe.log_error(f"Failed to share {doc.doctype} {doc.name} with {doc.custom_allocated_to if doc.doctype == 'Event' else doc.lead_owner}: {str(e)}")





@frappe.whitelist()
def get_lead_details(id):
    lead = frappe.get_doc("Lead", id)
    return {
        "lead_name": lead.lead_name,
        "email_id": lead.email_id,
        "mobile_no": lead.mobile_no,
        "company_name": lead.company_name,
        "custom_lead_category": getattr(lead, "custom_lead_category", None),
        "link": f"/app/lead/{lead.name}"
    }

@frappe.whitelist()
def get_customer_details(id):
    customer = frappe.get_doc("Customer", id)
    return {
        "name": customer.customer_name,
        "email_id": customer.email_id,
        "mobile_no": customer.mobile_no,
        "company_name": customer.customer_group,  # or company_name if you have it
        "link": f"/app/customer/{customer.name}"
    }


@frappe.whitelist()
def get_supplier_details(id):
    supplier = frappe.get_doc("Supplier", id)
    return {
        "name": supplier.supplier_name,
        "email_id": supplier.email_id,
        "mobile_no": supplier.mobile_no,
        "company_name": supplier.supplier_type,  # or company_name if you have it
        "link": f"/app/supplier/{supplier.name}"
    }

@frappe.whitelist()
def get_business_contacts_details(id):
    business_contacts = frappe.get_doc("Business Contacts", id)
    return {
        "name": business_contacts.contact_name,
        # "email_id": business_contacts.email_id,
        "contact_type": business_contacts.contact_type,
        "mobile_no": business_contacts.mobile_number,
        "company_name": business_contacts.organization_name,  # or company_name if you have it
        "link": f"/app/business-contacts/{business_contacts.name}"
    }

############################################ lead Dashboard ###########################################################################


# import frappe
# from frappe.utils import getdate, today, add_days

# @frappe.whitelist()
# def get_user_roles():
#     return {"roles": frappe.get_roles(frappe.session.user)}

# @frappe.whitelist()
# def get_lead_dashboard_data(user=None):
#     filters = {}
#     if user:
#         filters["assign_to"] = user

#     leads = frappe.get_all(
#         "Lead",
#         filters=filters,
#         fields=["name", "lead_name", "creation", "custom_lead_category", "assign_to"]
#     )

#     return {"leads": leads, "is_admin": "DAC CRM Head" in frappe.get_roles()}

# @frappe.whitelist()
# def get_lead_activities(user=None):
#     filters = {}
#     if user:
#         filters["assigned_to"] = user

#     activities = frappe.get_all(
#         "Event Activity",
#         filters=filters,
#         fields=["name", "subject", "status", "starts_on", "due_date", "assigned_to", "reference_name"]
#     )

#     return {"activities": activities}



# file: your_app/your_app/doctype/lead_dashboard/lead_dashboard.py

# import frappe

# @frappe.whitelist()
# def get_lead_dashboard_data():
#     """
#     Returns:
#     {
#         "lead_counts": {
#             "Category A": 10,
#             "Category B": 5
#         },
#         "activity_counts": {
#             "Lead": {
#                 "Category A": 15,
#                 "Category B": 8
#             },
#             "Customer": {
#                 "Category A": 3,
#                 "Category B": 5
#             },
#             "Supplier": {
#                 "Category A": 2,
#                 "Category B": 1
#             }
#         }
#     }
#     """

#     # 1. Lead counts by custom_lead_category
#     lead_counts = frappe.db.sql("""
#         SELECT custom_lead_category, COUNT(name) as cnt
#         FROM `tabLead`
#         GROUP BY custom_lead_category
#     """, as_dict=True)

#     lead_counts_dict = {row.custom_lead_category or "Uncategorized": row.cnt for row in lead_counts}

#     # 2. Event Activity counts by reference_type and category
#     activity_counts = frappe.db.sql("""
#         SELECT la.reference_type, l.custom_lead_category, COUNT(la.name) as cnt
#         FROM `tabEvent Activity` la
#         LEFT JOIN `tabLead` l ON la.reference_name = l.name
#         WHERE la.reference_type IN ('Lead', 'Customer', 'Supplier')
#         GROUP BY la.reference_type, l.custom_lead_category
#     """, as_dict=True)

#     # Convert to nested dict: {reference_type: {category: count}}
#     activity_counts_dict = {}
#     for row in activity_counts:
#         reference_type = row.reference_type or "Unknown"
#         category = row.custom_lead_category or "Uncategorized"
#         if reference_type not in activity_counts_dict:
#             activity_counts_dict[reference_type] = {}
#         activity_counts_dict[reference_type][category] = row.cnt

#     return {
#         "lead_counts": lead_counts_dict,
#         "activity_counts": activity_counts_dict
#     }


import frappe
from frappe.utils import getdate, nowdate, add_days

@frappe.whitelist()
def get_lead_dashboard_data():
    data = frappe._dict()

    # Top summary cards
    data.leads_without_activity = get_leads_without_activity_count()
    data.total_follow_ups_today_upcoming = get_today_upcoming_follow_ups_count()
    data.total_overdue_activities = get_overdue_activities_count()
    data.total_open_activities = get_open_activities_count()
    data.bc_without_activity = get_bc_without_activity_data()
    # Lead counts by category
    data.lead_counts = get_lead_category_counts()

    return data

# -----------------------
# Utility: role-based filters
# -----------------------
def get_filters_for(doctype):
    """Return role-based filters for the given doctype."""
    if "DAC CRM Head" in frappe.get_roles(frappe.session.user):
        return {}  # no restrictions

    if doctype == "Lead":
        return {"lead_owner": frappe.session.user}

    if doctype == "Event Activity":
        return {"assigned_to": frappe.session.user}

    return {}


# def get_bc_without_activity_count():
#     """Returns count of Open Business Contacts with no linked Event Activity."""
#     is_crm_head = "DAC CRM Head" in frappe.get_roles()
#     user = frappe.session.user

#     # Logic: Status is 'Open' and Name does NOT exist in Event Activity's reference_name
#     query = """
#         SELECT count(name) 
#         FROM `tabBusiness Contacts` bc
#         WHERE bc.status = 'Open'
#     """
    
#     # Filter by owner if not CRM Head
#     if not is_crm_head:
#         # Assuming Business Contact has an 'owner' or 'lead_owner' field. 
#         # Using 'owner' (the creator) as standard. Change to specific field if different.
#         query += f" AND bc.assign_to = '{user}'"

#     query += """
#         AND bc.name NOT IN (
#             SELECT DISTINCT reference_name 
#             FROM `tabEvent Activity` 
#             WHERE reference_type = 'Business Contact'
#         )
#     """

#     count = frappe.db.sql(query)[0][0]
#     return count


@frappe.whitelist()
def get_bc_without_activity_data():
    """Returns count and names for BCs with no OPEN activities."""
    is_crm_head = "DAC CRM Head" in frappe.get_roles()
    user = frappe.session.user

    # Base Query: Business Contact must be Open
    conditions = ["bc.status = 'Open'"]
    
    # Filter by assignment if not CRM Head
    if not is_crm_head:
        conditions.append(f"bc.assign_to = '{user}'")

    # The Logic: Exclude BCs that HAVE an activity with status 'Open'
    # This leaves BCs that either have NO activities or ONLY 'Closed/Cancelled' activities
    conditions.append("""
        bc.name NOT IN (
            SELECT DISTINCT reference_name 
            FROM `tabEvent Activity` 
            WHERE reference_type = 'Business Contacts' 
            AND status = 'Open'
        )
    """)

    where_clause = " AND ".join(conditions)
    
    # Fetch names to use for filtering in the UI
    names = frappe.db.sql(f"SELECT name FROM `tabBusiness Contacts` bc WHERE {where_clause}", pluck=True)
    
    return {
        "count": len(names),
        "names": names
    }

# -----------------------
# Counts
# -----------------------
import frappe
import frappe

@frappe.whitelist()
def get_leads_without_activity_count():
    """Return count of Leads that do NOT have any associated Event Activity."""

    # Get the current session user
    user = frappe.session.user
    roles = frappe.get_roles(user)

    filters = {
        "custom_lead_category": ["in", ["Enquiry", "Pipeline"]]
    }

    # If user has DAC CRM role, restrict to leads they own
    if "DAC CRM" in roles:
        filters["lead_owner"] = user

    # Get all leads that are referenced in Event Activity
    leads_with_activity = frappe.db.get_all(
        "Event Activity",
        fields=["reference_name"],
        filters={"reference_type": "Lead"},
        pluck="reference_name"
    )

    # If there are leads with activity, exclude them
    if leads_with_activity:
        filters["name"] = ["not in", leads_with_activity]

    # Count leads with the applied filters
    count = frappe.db.count("Lead", filters=filters)

    return count




def get_today_upcoming_follow_ups_count():
    """Counts Open Event Activities for today + next 3 days."""
    today = getdate(nowdate())
    end_date = add_days(today, 3)

    filters = get_filters_for("Event Activity")
    filters.update({
        "status": "Open",
        "starts_on": ["between", [f"{today} 00:00:00", f"{end_date} 23:59:59"]]
    })

    return frappe.db.count("Event Activity", filters=filters)


def get_overdue_activities_count():
    """Counts Open Event Activities that are overdue (starts_on < today)."""
    today = getdate(nowdate())

    filters = get_filters_for("Event Activity")
    filters.update({
        "status": "Open",
        "starts_on": ["<", f"{today} 00:00:00"]
    })

    return frappe.db.count("Event Activity", filters=filters)

def get_open_activities_count():
    """Counts Lead Activities with a status of 'Open'."""
    filters = get_filters_for("Event Activity")
    filters["status"] = "Open"

    return frappe.db.count("Event Activity", filters=filters)


# def get_lead_category_counts():
#     """Counts Leads grouped by their custom_lead_category and sums custom_expected_revenue."""
#     categories = [
#         'Enquiry', 'Pipeline', 'Order', 'Lost Enquiry', 'Lost Pipeline'
#     ]
#     counts = {}

#     for category in categories:
#         filters = get_filters_for("Lead")
#         filters["custom_lead_category"] = category

#         # Count the leads
#         lead_count = frappe.db.count("Lead", filters=filters)

#         # Sum the custom_expected_revenue
#         total_revenue = frappe.db.get_all(
#             "Lead",
#             filters=filters,
#             fields=["custom_expected_revenue"]
#         )
#         revenue_sum = sum([float(l.custom_expected_revenue or 0) for l in total_revenue])

#         counts[category] = {
#             "count": lead_count,
#             "revenue": revenue_sum
#         }

#     return counts

import frappe

@frappe.whitelist()
def get_lead_category_counts():
    """Counts Leads grouped by their custom_lead_category and sums revenue fields.
       For 'Order' category → sum custom_po_value
       For others → sum custom_expected_revenue
    """

    categories = ['Enquiry', 'Pipeline', 'Order', 'Lost Enquiry', 'Lost Pipeline']
    counts = {}

    for category in categories:
        filters = get_filters_for("Lead")
        filters["custom_lead_category"] = category

        # Count total leads in this category
        lead_count = frappe.db.count("Lead", filters=filters)

        # Choose revenue field dynamically
        revenue_field = "custom_po_value" if category == "Order" else "custom_expected_revenue"

        # Fetch and sum revenue
        total_revenue_records = frappe.db.get_all(
            "Lead",
            filters=filters,
            fields=[revenue_field]
        )

        revenue_sum = sum([float(l[revenue_field] or 0) for l in total_revenue_records])

        counts[category] = {
            "count": lead_count,
            "revenue": revenue_sum
        }

    return counts



@frappe.whitelist()
def get_followup_summary(session_user=None):
    user = session_user or frappe.session.user
    roles = frappe.get_roles(user)
    is_admin = "DAC CRM Head" in roles

    # Get today's start and end datetime
    today = frappe.utils.today()
    start = f"{today} 00:00:00"
    end = f"{today} 23:59:59"

    filters = {
        "starts_on": ["between", [start, end]],
        "status": "Open"
    }

    if not is_admin:
        filters["assigned_to"] = user

    activities = frappe.get_all(
        "Event Activity",
        filters=filters,
        fields=["category", "assigned_to"]
    )

    summary = {}
    all_categories = set()

    for a in activities:
        # Convert user id → full name
        u = frappe.utils.get_fullname(a.assigned_to) if a.assigned_to else "Unassigned"
        cat = a.category or "Uncategorized"
        all_categories.add(cat)

        if u not in summary:
            summary[u] = {}
        summary[u][cat] = summary[u].get(cat, 0) + 1

    return {
        "users": list(summary.keys()),          # full names now
        "categories": sorted(c for c in all_categories if c),
        "matrix": summary                       # keyed by full name
    }
import frappe
from frappe.utils import nowdate

@frappe.whitelist()
def get_followup_report(from_date=None, to_date=None):
    """
    Returns user-wise summary of Event Activity with Open/Closed counts,
    filterable by custom date range.
    """
    try:
        user = frappe.session.user
        roles = frappe.get_roles(user)
        is_admin = "DAC CRM Head" in roles

        # Default filters
        filters = {}
        if from_date and to_date:
            filters["created_on"] = ["between", [from_date, to_date]]

        # Non-admin users see only their assigned activities
        if not is_admin:
            filters["assigned_to"] = user

        activities = frappe.get_all(
            "Event Activity",
            filters=filters,
            fields=["category", "assigned_to", "status"]
        )

        summary = {}
        all_categories = set()

        for a in activities:
            u = a.assigned_to or "Unassigned"
            cat = a.category or "Uncategorized"
            all_categories.add(cat)

            if u not in summary:
                full_name = frappe.db.get_value("User", u, "full_name") if u != "Unassigned" else "Unassigned"
                summary[u] = {"name": full_name, "categories": {}}

            if cat not in summary[u]["categories"]:
                summary[u]["categories"][cat] = {"Open": 0, "Closed": 0}

            # ✅ Map Completed → Closed
            status = "Closed" if a.status == "Completed" else "Open"
            summary[u]["categories"][cat][status] += 1

        return {
            "users": [
                {"id": uid, "name": data["name"], "categories": data["categories"]}
                for uid, data in summary.items()
            ],
            "activity_categories": sorted(all_categories),
            "is_admin": is_admin
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "get_followup_report Error")
        frappe.throw(f"Error fetching followup report: {str(e)}")

# import frappe
# from frappe.utils import getdate
# @frappe.whitelist()
# def get_lead_category_report(from_date=None, to_date=None):
#     user = frappe.session.user
#     roles = frappe.get_roles(user)
#     is_admin = "DAC CRM Head" in roles

#     lead_filters = {}
#     if from_date and to_date:
#         lead_filters["custom_created_at"] = ["between", [from_date, to_date]]

#     if not is_admin:

#         lead_filters["lead_owner"] = user

#     # --- Fetch Leads ---
#     leads = frappe.get_all(
#         "Lead",
#         filters=lead_filters,
#         fields=[
#             "name", "lead_owner", "lead_name", "status", "custom_lead_category",
#             "custom_lead_type", "custom_direction_type", "company_name",
#             "industry", "custom_expected_revenue", "custom_expected_closure_date", "mobile_no","custom_po_value",
#         ]

#     )

#     summary = {}
#     all_categories, all_lead_types, all_direction_types, all_industries, all_products, all_closure_months = set(), set(), set(), set(), set(), set()

#     for l in leads:
#         u = l.lead_owner
#         cat = l.custom_lead_category or "Uncategorized"
#         lead_type = l.custom_lead_type or "Unknown"
#         direction = l.custom_direction_type or "Unknown"
#         industry = l.industry or "Unknown"

#         if lead_type == "WON":
#             revenue = float(l.custom_po_value or 0)
#         else:
#             revenue = float(l.custom_expected_revenue or 0)

#         # ✅ Revenue logic
#         if cat == "Order":
#             revenue = float(l.custom_po_value or 0)
#         else:
#             revenue = float(l.custom_expected_revenue or 0)
#         closure_month = getdate(l.custom_expected_closure_date).strftime("%b %Y") if l.custom_expected_closure_date else "No Closure Date"

#         all_categories.add(cat)
#         all_lead_types.add(lead_type)
#         all_direction_types.add(direction)
#         all_industries.add(industry)
#         all_closure_months.add(closure_month)

#         if u not in summary:
#             full_name = frappe.db.get_value("User", u, "full_name") or "Unknown"
#             summary[u] = {
#                 "name": full_name,
#                 "categories": {},
#                 "lead_types": {},
#                 "direction_types": {},
#                 "industries": {},
#                 "products": {},
#                 "closures": {},
#                 "quotations": {}
#             }

#         def add_to_bucket(bucket, key):
#             if key not in summary[u][bucket]:
#                 summary[u][bucket][key] = {"count": 0, "revenue": 0, "leads": []}
#             summary[u][bucket][key]["count"] += 1
#             summary[u][bucket][key]["revenue"] += revenue
#             summary[u][bucket][key]["leads"].append({
#                 "Lead ID": l.name,
#                 "Full Name": l.lead_name,
#                 "Organization Name": l.company_name or "",
#                 "Lead Category": l.custom_lead_category or "",
#                 "Expected Revenue": revenue,
#                 "Mobile No": l.mobile_no or "",
#                 "Expected Closure Month": closure_month
#             })

#         add_to_bucket("categories", cat)
#         add_to_bucket("lead_types", lead_type)
#         add_to_bucket("direction_types", direction)
#         add_to_bucket("industries", industry)
#         add_to_bucket("closures", closure_month)

#         # --- Products child table ---
#         product_rows = frappe.get_all(
#             "Product Category Multiselect",
#             filters={"parent": l.name},
#             fields=["product_category"]
#         )
#         for row in product_rows:
#             if row.product_category:
#                 all_products.add(row.product_category)
#                 add_to_bucket("products", row.product_category)

#     # --- Fetch Quotations ---
#     quotation_filters = {"docstatus": 1}
#     if from_date and to_date:
#         quotation_filters["transaction_date"] = ["between", [from_date, to_date]]

#     quotations = frappe.get_all(
#         "Quotation",
#         filters=quotation_filters,
#         fields=[
#             "name", "owner", "quotation_to", "party_name",
#             "grand_total", "transaction_date", "status","customer_name"
#         ],
#         order_by="transaction_date desc"
#     )

#     all_quotation_labels = set()

#     for q in quotations:
#         owner = q.owner or "Unknown"
#         label = q.quotation_to or "Unknown"
#         revenue = float(q.grand_total or 0)
#         all_quotation_labels.add(label)

#         if owner not in summary:
#             full_name = frappe.db.get_value("User", owner, "full_name") or "Unknown"
#             summary[owner] = {
#                 "name": full_name,
#                 "categories": {},
#                 "lead_types": {},
#                 "direction_types": {},
#                 "industries": {},
#                 "products": {},
#                 "closures": {},
#                 "quotations": {}
#             }

#         if label not in summary[owner]["quotations"]:
#             summary[owner]["quotations"][label] = {"count": 0, "revenue": 0, "quotations": []}

#         summary[owner]["quotations"][label]["count"] += 1
#         summary[owner]["quotations"][label]["revenue"] += revenue
#         summary[owner]["quotations"][label]["quotations"].append({
#             "Quotation ID": q.name,
#             "Party Name": q.party_name or "",
#             "Customer Name":q.customer_name or "",
#             "Quotation Type": q.quotation_to or "",
#             "Grand Total": revenue,
#             "Status": q.status or "",
#             "Transaction Date": q.transaction_date.strftime("%d-%b-%Y") if q.transaction_date else ""
#         })
#     # print(summary)
#     # --- Sorting ---
#     def sort_by_order(values, order):
#         return sorted(values, key=lambda x: order.index(x) if x in order else 99)

#     lead_category_order = ["Enquiry", "Pipeline", "Order", "Lost Enquiry", "Lost Pipeline"]
#     lead_type_order = ["HOT", "WARM", "COLD", "WON", "LOST"]
#     direction_order = ["Inbound", "Outbound"]

#     return {
#         "users": [
#             {
#                 "id": uid,
#                 "name": data["name"],
#                 "categories": data["categories"],
#                 "lead_types": data["lead_types"],
#                 "direction_types": data["direction_types"],
#                 "industries": data["industries"],
#                 "products": data["products"],
#                 "closures": data["closures"],
#                 "quotations": data["quotations"]
#             }
#             for uid, data in summary.items()
#         ],
#         "lead_categories": sort_by_order(all_categories, lead_category_order),
#         "lead_types": sort_by_order(all_lead_types, lead_type_order),
#         "direction_types": sort_by_order(all_direction_types, direction_order),
#         "industries": sorted(all_industries),
#         "products": sorted(all_products),
#         "month_year_closure": sorted(
#             all_closure_months,
#             key=lambda x: getdate("01-" + x.split(" ")[0] + "-" + x.split(" ")[1])
#             if x != "No Closure Date" else getdate()
#         ),
#         "quotation_labels": sorted(all_quotation_labels),
#         "is_admin": is_admin
#     }

@frappe.whitelist()
def get_lead_category_report(from_date=None, to_date=None):
    user = frappe.session.user
    roles = frappe.get_roles(user)
    is_admin = "DAC CRM Head" in roles or "Administrator" in roles

    lead_filters = {}
    if from_date and to_date:
        lead_filters["custom_created_at"] = ["between", [from_date, to_date]]

    if not is_admin:
        lead_filters["lead_owner"] = user

    # --- Fetch Leads ---
    leads = frappe.get_all(
        "Lead",
        filters=lead_filters,
        fields=[
            "name", "lead_owner", "lead_name", "status", "custom_lead_category",
            "custom_lead_type", "custom_direction_type", "company_name",
            "industry", "custom_expected_revenue", "custom_expected_closure_date", "mobile_no","custom_po_value",
        ]
    )

    summary = {}
    all_categories, all_lead_types, all_direction_types, all_industries, all_products, all_closure_months = set(), set(), set(), set(), set(), set()

    # Define Category Groupings for the buckets
    OPEN_CATS = ["Enquiry", "Pipeline"]
    ORDER_CATS = ["Order"]
    LOST_CATS = ["Lost Enquiry", "Lost Pipeline"]

    for l in leads:
        u = l.lead_owner
        cat = l.custom_lead_category or "Uncategorized"
        lead_type = l.custom_lead_type or "Unknown"
        direction = l.custom_direction_type or "Unknown"
        industry = l.industry or "Unknown"

        # Determine the group_key for the bucket update
        if cat in OPEN_CATS: 
            group_key = "open"
        elif cat in ORDER_CATS: 
            group_key = "order"
        elif cat in LOST_CATS: 
            group_key = "lost"
        else: 
            group_key = "other"

        if lead_type == "WON":
            revenue = float(l.custom_po_value or 0)
        else:
            revenue = float(l.custom_expected_revenue or 0)

        # ✅ Revenue logic
        if cat == "Order":
            revenue = float(l.custom_po_value or 0)
        else:
            revenue = float(l.custom_expected_revenue or 0)
            
        closure_month = getdate(l.custom_expected_closure_date).strftime("%b %Y") if l.custom_expected_closure_date else "No Closure Date"

        all_categories.add(cat)
        all_lead_types.add(lead_type)
        all_direction_types.add(direction)
        all_industries.add(industry)
        all_closure_months.add(closure_month)

        if u not in summary:
            full_name = frappe.db.get_value("User", u, "full_name") or "Unknown"
            summary[u] = {
                "name": full_name,
                "categories": {},
                "lead_types": {},
                "direction_types": {},
                "industries": {},
                "products": {},
                "closures": {},
                "quotations": {}
            }

        def add_to_bucket(bucket, key, group_key, revenue):
            if key not in summary[u][bucket]:
                summary[u][bucket][key] = {
                    "open_count": 0, "open_revenue": 0,
                    "order_count": 0, "order_revenue": 0,
                    "lost_count": 0, "lost_revenue": 0,
                    "count": 0, "revenue": 0,
                    "leads": []
                }
            
            # Update Grouped Metrics
            if group_key != "other":
                summary[u][bucket][key][f"{group_key}_count"] += 1
                summary[u][bucket][key][f"{group_key}_revenue"] += revenue
            
            # Update Total Metrics
            summary[u][bucket][key]["count"] += 1
            summary[u][bucket][key]["revenue"] += revenue
            
            summary[u][bucket][key]["leads"].append({
                "Lead ID": l.name,
                "Full Name": l.lead_name,
                "Organization Name": l.company_name or "",
                "Lead Category": l.custom_lead_category or "",
                "Expected Revenue": revenue,
                "Mobile No": l.mobile_no or "",
                "Expected Closure Month": closure_month
            })

        add_to_bucket("categories", cat, group_key, revenue)
        add_to_bucket("lead_types", lead_type, group_key, revenue)
        add_to_bucket("direction_types", direction, group_key, revenue)
        add_to_bucket("industries", industry, group_key, revenue)
        add_to_bucket("closures", closure_month, group_key, revenue)

        # --- Products child table ---
        product_rows = frappe.get_all(
            "Product Category Multiselect",
            filters={"parent": l.name},
            fields=["product_category"]
        )
        for row in product_rows:
            if row.product_category:
                all_products.add(row.product_category)
                add_to_bucket("products", row.product_category, group_key, revenue)

    # --- Fetch Quotations ---
    quotation_filters = {"docstatus": 1}
    if from_date and to_date:
        quotation_filters["transaction_date"] = ["between", [from_date, to_date]]

    quotations = frappe.get_all(
        "Quotation",
        filters=quotation_filters,
        fields=[
            "name", "owner", "quotation_to", "party_name",
            "grand_total", "transaction_date", "status","customer_name"
        ],
        order_by="transaction_date desc"
    )

    all_quotation_labels = set()

    for q in quotations:
        owner = q.owner or "Unknown"
        label = q.quotation_to or "Unknown"
        revenue = float(q.grand_total or 0)
        all_quotation_labels.add(label)

        if owner not in summary:
            full_name = frappe.db.get_value("User", owner, "full_name") or "Unknown"
            summary[owner] = {
                "name": full_name,
                "categories": {},
                "lead_types": {},
                "direction_types": {},
                "industries": {},
                "products": {},
                "closures": {},
                "quotations": {}
            }

        if label not in summary[owner]["quotations"]:
            summary[owner]["quotations"][label] = {"count": 0, "revenue": 0, "quotations": []}

        summary[owner]["quotations"][label]["count"] += 1
        summary[owner]["quotations"][label]["revenue"] += revenue
        summary[owner]["quotations"][label]["quotations"].append({
            "Quotation ID": q.name,
            "Party Name": q.party_name or "",
            "Customer Name":q.customer_name or "",
            "Quotation Type": q.quotation_to or "",
            "Grand Total": revenue,
            "Status": q.status or "",
            "Transaction Date": q.transaction_date.strftime("%d-%b-%Y") if q.transaction_date else ""
        })

    # --- Sorting ---
    def sort_by_order(values, order):
        return sorted(values, key=lambda x: order.index(x) if x in order else 99)

    lead_category_order = ["Enquiry", "Pipeline", "Order", "Lost Enquiry", "Lost Pipeline"]
    lead_type_order = ["HOT", "WARM", "COLD", "WON", "LOST"]
    direction_order = ["Inbound", "Outbound"]

    return {
        "users": [
            {
                "id": uid,
                "name": data["name"],
                "categories": data["categories"],
                "lead_types": data["lead_types"],
                "direction_types": data["direction_types"],
                "industries": data["industries"],
                "products": data["products"],
                "closures": data["closures"],
                "quotations": data["quotations"]
            }
            for uid, data in summary.items()
        ],
        "lead_categories": sort_by_order(all_categories, lead_category_order),
        "lead_types": sort_by_order(all_lead_types, lead_type_order),
        "direction_types": sort_by_order(all_direction_types, direction_order),
        "industries": sorted(all_industries),
        "products": sorted(all_products),
        "month_year_closure": sorted(
            all_closure_months,
            key=lambda x: getdate("01-" + x.split(" ")[0] + "-" + x.split(" ")[1])
            if x != "No Closure Date" else getdate()
        ),
        "quotation_labels": sorted(all_quotation_labels),
        "is_admin": is_admin
    }

# # Separate PDF generation function
# import frappe
# from frappe.utils.pdf import get_pdf

# @frappe.whitelist()
# def generate_lead_report_pdf(from_date=None, to_date=None, quotation_from_date=None, quotation_to_date=None):
#     # Get the data using your existing function
#     report_data = get_lead_category_report(
#         from_date=from_date,
#         to_date=to_date,
#         quotation_from_date=quotation_from_date,
#         quotation_to_date=quotation_to_date
#     )
    
#     # Prepare HTML from the data (simple table example)
#     html = "<h2>Lead Report</h2><table border='1' cellspacing='0' cellpadding='4'>"
#     html += "<tr><th>User</th><th>Category</th><th>Count</th><th>Revenue</th></tr>"
#     for u in report_data["users"]:
#         for cat, val in u["categories"].items():
#             html += f"<tr><td>{u['name']}</td><td>{cat}</td><td>{val['count']}</td><td>{val['revenue']}</td></tr>"
#     html += "</table>"

#     # Generate PDF
#     pdf = get_pdf(html)
#     return pdf
# import frappe
# from frappe.utils import getdate

# @frappe.whitelist()
# def get_leads_by_user_and_label(user, label, fieldname):
#     filters = {"lead_owner": user}

#     lead_fields = [
#         "name", "lead_name", "status", "custom_lead_category",
#         "custom_expected_revenue", "custom_expected_closure_date"
#     ]

#     if fieldname == "categories":
#         filters["custom_lead_category"] = label
#     elif fieldname == "lead_types":
#         filters["custom_lead_type"] = label
#     elif fieldname == "industries":
#         filters["industry"] = label
#     elif fieldname == "direction_types":
#         filters["custom_direction_type"] = label
#     elif fieldname == "products":
#         # Fetch leads which have this product category in child table
#         product_links = frappe.get_all(
#             "Product Category Multiselect",
#             filters={"product_category": label},
#             fields=["parent"]
#         )
#         lead_names = [p["parent"] for p in product_links]
#         if lead_names:
#             filters = {"name": ["in", lead_names], "lead_owner": user}
#         else:
#             return []  # No leads found
#     else:
#         return []

#     leads = frappe.get_all(
#         "Lead",
#         filters=filters,
#         fields=lead_fields
#     )

#     for l in leads:
#         # Add products (child table)
#         l["products"] = frappe.get_all(
#             "Product Category Multiselect",
#             filters={"parent": l["name"]},
#             fields=["product_category"]
#         )

#         # Format expected closure month
#         closure_date = l.get("custom_expected_closure_date")
#         if closure_date:
#             # Convert string to date and format as "Mon YYYY"
#             l["closure_month"] = getdate(closure_date).strftime("%b %Y")
#         else:
#             l["closure_month"] = "No Closure Date"

#         # Fetch related Quotations for this lead (optional)
#         quotations = frappe.get_all(
#             "Quotation",
#             filters={"quotation_to": l.name, "docstatus": 1},
#             fields=["name", "grand_total", "transaction_date"]
#         )
#         l["quotations"] = quotations

#     return leads



@frappe.whitelist()
def get_quotations_for_lead(lead_name):
    if not frappe.has_permission('Quotation', 'read'):
        frappe.throw(_("You do not have permission to access Quotation records."), frappe.PermissionError)
    
    quotations = frappe.get_all(
        'Quotation',
        fields=['name', 'quotation_to', 'customer_name', 'transaction_date', 'grand_total','status'],
        filters={'custom_lead_id': lead_name}
    )
    
    quotation_data = []
    
    for quotation in quotations:
        items = frappe.get_all(
            'Quotation Item',
            fields=['item_code'],
            filters={'parent': quotation.name}
        )
        # print(items)
        # Append the data as a dictionary
        quotation_data.append({
            'quotation_id': quotation.name,
            'status': quotation.status,
            'customer_name': quotation.customer_name,
            'transaction_date': quotation.transaction_date,
            'grand_total': quotation.grand_total,
            'items': [item.item_code for item in items]
        })
    
    return quotation_data
from frappe.utils.pdf import get_pdf
from frappe.utils import now_datetime
import frappe

@frappe.whitelist()
def generate_combined_report_pdf(from_date=None, to_date=None):
    try:
        # Render HTML using existing functions
        followup_html = render_followup_html(from_date, to_date)
        lead_html = render_lead_html(from_date, to_date)

        # Full HTML
        full_html = f"""
        <html>
        <head>
            <style>
                body {{ font-family: 'Segoe UI', sans-serif; font-size: 11pt; }}
                .summary-header {{ font-size: 16pt; font-weight: 600; margin: 15px 0; color: #333; }}
                table {{ width: 100%; border-collapse: collapse; margin-bottom: 20px; }}
                th, td {{ border: 1px solid #ddd; padding: 8px; text-align: center; }}
                th {{ background: #1976d2; color: white; }}
                tbody tr:nth-child(even) {{ background: #f9f9f9; }}
                tbody tr:hover {{ background: #f1faff; }}
                tfoot td {{ font-weight: bold; background: #e0e0e0; }}
            </style>
        </head>
        <body>
            <h2>Event Activities Report</h2>
            {followup_html}
            <h2>Lead Report</h2>
            {lead_html}
        </body>
        </html>
        """

        pdf = get_pdf(full_html)

        # Save PDF
        filename = f"Lead_Followup_Report_{now_datetime().strftime('%Y%m%d_%H%M%S')}.pdf"
        file_path = frappe.get_site_path("public", "files", filename)
        with open(file_path, "wb") as f:
            f.write(pdf)

        # Return public URL
        return {"pdf_file": f"/files/{filename}"}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "generate_combined_report_pdf Error")
        frappe.throw(f"Error generating PDF: {str(e)}")


def render_followup_html(from_date=None, to_date=None):
    data = get_followup_report(from_date, to_date)
    users = data.get("users", [])
    categories = data.get("activity_categories", [])

    if not users:
        return "<p>No Event Activities found.</p>"

    html = "<table><thead><tr><th>User</th>"
    for c in categories:
        html += f"<th>{c}</th>"
    html += "<th>Total</th></tr></thead><tbody>"

    for u in users:
        row = f"<tr><td>{u['name']}</td>"
        total = 0
        for c in categories:
            val = u["categories"].get(c, {"Open": 0, "Closed": 0})
            count = val.get("Open", 0) + val.get("Closed", 0)
            total += count
            row += f"<td>{count}</td>"
        row += f"<td>{total}</td></tr>"
        html += row

    html += "</tbody></table>"
    return html


def render_lead_html(from_date=None, to_date=None):
    data = get_lead_category_report(from_date, to_date)
    users = data.get("users", [])
    categories = data.get("lead_categories", [])

    if not users:
        return "<p>No Lead records found.</p>"

    html = "<table><thead><tr><th>User</th>"
    for c in categories:
        html += f"<th>{c}</th>"
    html += "<th>Total</th></tr></thead><tbody>"

    for u in users:
        row = f"<tr><td>{u['name']}</td>"
        total = 0
        for c in categories:
            val = u["categories"].get(c, {"count": 0})
            total += val.get("count", 0)
            row += f"<td>{val.get('count', 0)}</td>"
        row += f"<td>{total}</td></tr>"
        html += row

    html += "</tbody></table>"
    return html



import frappe
from frappe import _

@frappe.whitelist(allow_guest=True)
def create_duplicate_lead(lead_name):
    """
    Duplicates the lead, resets Workflow/Status to 'Enquiry', 
    and links the correct Customer.
    """
    if not lead_name:
        return

    # 1. Fetch the original Lead
    original_doc = frappe.get_doc("Lead", lead_name)
    
    # 2. Determine the Customer to set
    customer_id = original_doc.custom_lead_customer
    if not customer_id:
        customer_id = frappe.db.get_value("Customer", {"lead_name": lead_name}, "name")

    # 3. Create the copy (this copies 'Order' status too!)
    new_doc = frappe.copy_doc(original_doc)
    
    # --- FIX START ---
    
    # 4. Force Reset Status / Category to Initial State
    # Change "Enquiry" to whatever your Workflow's actual Start State is (e.g., "Pipeline", "Open")
    initial_state = "Enquiry" 
    
    new_doc.custom_lead_category = initial_state
    new_doc.custom_duplicated_lead = 1
    new_doc.custom_duplicate_lead_id = original_doc.name
    new_doc.custom_lead_type = 'HOT'
    new_doc.custom_po_value = ''
    # IMPORTANT: You must also reset the specific Workflow State field
    # Standard field is 'workflow_state', but checking meta is safer
    # workflow_state_field = frappe.get_meta("Lead").get_workflow_state_field()
    # if workflow_state_field:
    #     new_doc.set(workflow_state_field, initial_state)

    # --- FIX END ---

    # 5. Set the determined customer
    new_doc.custom_lead_customer = customer_id

    # 6. Insert the new document
    new_doc.insert(ignore_permissions=True)
    
    return new_doc.name

import frappe
from erpnext.crm.doctype.lead.lead import make_quotation as original_make_quotation

@frappe.whitelist()
def make_quotation_custom(source_name, target_doc=None):
    """
    Custom mapper to create a Quotation.
    1. Calls standard ERPNext mapper.
    2. Checks if 'custom_duplicated_lead' is checked AND 'custom_lead_customer' exists.
    3. If yes, changes Quotation To -> Customer.
    4. Sets custom_lead_id on Quotation.
    """
    
    # 1. Create the Quotation object using standard ERPNext logic
    doc = original_make_quotation(source_name, target_doc)

    # 2. Fetch Lead details (Added 'custom_duplicated_lead' to the fetch list)
    lead = frappe.db.get_value("Lead", source_name, ["custom_lead_customer", "custom_duplicated_lead"], as_dict=True)

    # 3. Logic to switch to Customer
    # Only proceed if customer exists AND the duplicate checkbox is checked (1)
    if lead and lead.custom_lead_customer and lead.custom_duplicated_lead:
        doc.quotation_to = "Customer"
        doc.party_name = lead.custom_lead_customer
        
        # Optional: Fetch and set the Customer Name for display purposes
        doc.customer_name = frappe.db.get_value("Customer", lead.custom_lead_customer, "customer_name")

    # 4. Set the Lead ID in the custom field on Quotation
    doc.custom_lead_id = source_name

    return doc
import frappe
from frappe.utils import flt, getdate, get_last_day
import datetime
import frappe
from frappe.utils import flt, getdate, get_last_day
import datetime

@frappe.whitelist()
def get_target_vs_actual(from_date, to_date):
    from_date_obj = getdate(from_date)
    to_date_obj = getdate(to_date)
    current_user = frappe.session.user
    
    # 1. Role-Based Filtering
    user_roles = frappe.get_roles(current_user)
    sp_filters = {"enabled": 1}
    if "DAC CRM Head" not in user_roles and "Administrator" not in user_roles:
        employees = frappe.get_all("Employee", filters={"user_id": current_user}, fields=["name"])
        employee_names = [e.name for e in employees]
        if not employee_names:
            return []
        sp_filters["employee"] = ["in", employee_names]

    sales_persons = frappe.get_all("Sales Person", fields=["name", "sales_person_name"], filters=sp_filters)
    if not sales_persons: return []

    data = []

    for sp in sales_persons:
        # Step: Determine the Fiscal Year and its true Start Date
        # We find the target detail that covers the current 'to_date'
        sp_targets = frappe.db.get_all("Target Detail", 
                                       filters={"parent": sp.name}, 
                                       fields=["fiscal_year", "target_amount", "distribution_id"])
        
        # If no target, skip
        if not sp_targets: continue

        # Identify the relevant Fiscal Year for the selected period
        active_fy = None
        for t in sp_targets:
            fy_doc = frappe.get_cached_doc("Fiscal Year", t.fiscal_year)
            if getdate(fy_doc.year_start_date) <= to_date_obj and getdate(fy_doc.year_end_date) >= from_date_obj:
                active_fy = fy_doc
                break
        
        if not active_fy: continue
        
        # This is the dynamic start date (e.g., April 1st or July 1st)
        fy_start_date = getdate(active_fy.year_start_date)

        # --- A. PREVIOUS DEFICIT CALCULATION (From FY Start to Month-1) ---
        prev_deficit = 0.0
        if from_date_obj > fy_start_date:
            hist_end = from_date_obj - datetime.timedelta(days=1)
            hist_months = get_months_in_range(fy_start_date, hist_end)
            
            running_bal = 0.0
            for m_name in hist_months:
                # Determine date for the specific month in the loop
                m_idx = list(calendar_months().values()).index(m_name) + 1
                # Check if month is in the next calendar year relative to FY start
                m_year = fy_start_date.year if m_idx >= fy_start_date.month else fy_start_date.year + 1
                
                m_start = datetime.date(m_year, m_idx, 1)
                m_t = get_specific_target(sp.name, [m_name], m_start, get_last_day(m_start))
                m_a = get_specific_actual(sp.name, m_start, get_last_day(m_start))
                
                running_bal += (m_a - m_t)
                if running_bal > 0: running_bal = 0.0 # Rule: Surplus doesn't carry
            prev_deficit = running_bal

        # --- B. CURRENT MONTH DATA ---
        curr_months = get_months_in_range(from_date_obj, to_date_obj)
        curr_target = get_specific_target(sp.name, curr_months, from_date_obj, to_date_obj)
        curr_actual = get_specific_actual(sp.name, from_date_obj, to_date_obj)
        curr_variance = curr_actual - curr_target
        curr_ach = (curr_actual / curr_target * 100) if curr_target > 0 else 0.0

        # --- C. OVERALL YTD DATA (FY START TO SELECTED MONTH) ---
        ytd_months_list = get_months_in_range(fy_start_date, to_date_obj)
        ytd_range_label = f"{fy_start_date.strftime('%b')} to {to_date_obj.strftime('%b')}"
        
        ytd_target = get_specific_target(sp.name, ytd_months_list, fy_start_date, to_date_obj)
        overall_variance = prev_deficit + curr_variance
        
        # Overall Achievement: Actual / (Target + Needed to cover deficit)
        total_burden = curr_target + abs(prev_deficit)
        overall_ach = (curr_actual / total_burden * 100) if total_burden > 0 else 0.0

        if curr_target > 0 or curr_actual > 0 or prev_deficit < 0:
            data.append({
                "sales_person": sp.sales_person_name,
                "target": curr_target,
                "actual": curr_actual,
                "curr_variance": curr_variance,
                "curr_achievement": curr_ach,
                "ytd_label": ytd_range_label,
                "ytd_target": ytd_target,
                "overall_variance": overall_variance,
                "overall_achievement": overall_ach
            })

    return data

def get_specific_target(sp_name, month_names, f_date, t_date):
    target_val = 0.0
    sp_targets = frappe.db.get_all("Target Detail", 
                                   filters={"parent": sp_name}, 
                                   fields=["fiscal_year", "target_amount", "distribution_id"])
    for t in sp_targets:
        fy_doc = frappe.get_cached_doc("Fiscal Year", t.fiscal_year)
        if getdate(fy_doc.year_start_date) <= t_date and getdate(fy_doc.year_end_date) >= f_date:
            if t.distribution_id:
                dist = frappe.get_cached_doc("Monthly Distribution", t.distribution_id)
                pct_sum = sum([flt(getattr(d, 'percentage_allocation', 0) or getattr(d, 'percentage', 0)) 
                              for d in dist.percentages if d.month in month_names])
                target_val += (flt(t.target_amount) * pct_sum) / 100.0
            else:
                target_val += (flt(t.target_amount) / 12.0) * len(month_names)
    return target_val

def get_specific_actual(sp_name, f_date, t_date):
    actual_query = """
        SELECT SUM(st.allocated_amount)
        FROM `tabSales Order` so
        INNER JOIN `tabSales Team` st ON st.parent = so.name
        WHERE so.docstatus = 1 AND st.sales_person = %s
        AND so.transaction_date BETWEEN %s AND %s
    """
    res = frappe.db.sql(actual_query, (sp_name, f_date, t_date))
    return flt(res[0][0]) if res else 0.0

def calendar_months():
    return {1: "January", 2: "February", 3: "March", 4: "April", 5: "May", 6: "June", 
            7: "July", 8: "August", 9: "September", 10: "October", 11: "November", 12: "December"}

def get_months_in_range(start_date, end_date):
    month_map = calendar_months()
    months = []
    current = start_date
    while current <= end_date:
        if month_map[current.month] not in months:
            months.append(month_map[current.month])
        if current.month == 12:
            current = datetime.date(current.year + 1, 1, 1)
        else:
            current = datetime.date(current.year, current.month + 1, 1)
    return months



def validate_lead(doc, method=None):

    # 1. Update Direction Type (Logic you asked for earlier)
    outbound_sources = ["Field Visit", "Cold Calling"]
    doc.custom_direction_type = "Outbound" if doc.source in outbound_sources else "Inbound"

    # 2. Track Changes (History Tracking)
    # We do this in validate because it's safe to append to child tables here
    if not doc.is_new():
        # Track Category Change
        old_status = frappe.db.get_value("Lead", doc.name, "custom_lead_category")
        if old_status and old_status != doc.custom_lead_category:
            doc.append('custom_lead_status_change_history', {
                'old_status': old_status,
                'new_status': doc.custom_lead_category,
                'changed_by': frappe.session.user,
                'updated_at': now_datetime(),
            })

        # Track Owner Change
        old_owner = frappe.db.get_value("Lead", doc.name, "lead_owner")
        if old_owner and old_owner != doc.lead_owner:
            doc.append('custom_lead_owner_change_history', {
                'from_lead_owner': old_owner,
                'to_lead_owner': doc.lead_owner,
                'changed_by': frappe.session.user,
                'change_on': now_datetime(),
            })