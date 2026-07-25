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

# @frappe.whitelist()
# def get_lead_dashboard_data():
#     data = frappe._dict()

#     # Top summary cards
#     data.leads_without_activity = get_leads_without_activity_count()
#     data.total_follow_ups_today_upcoming = get_today_upcoming_follow_ups_count()
#     data.total_overdue_activities = get_overdue_activities_count()
#     data.total_open_activities = get_open_activities_count()
#     data.bc_without_activity = get_bc_without_activity_data()
#     # Lead counts by category
#     data.lead_counts = get_lead_category_counts()

#     return data


import frappe
from frappe.utils import getdate, nowdate, add_days, flt

@frappe.whitelist()
def get_lead_dashboard_data(from_date=None, to_date=None, selected_user=None):
    # Determine Role & User
    user_roles = frappe.get_roles(frappe.session.user)
    is_crm_head = "DAC CRM Head" in user_roles
    
    target_user = None
    if is_crm_head:
        target_user = selected_user if selected_user else None 
    else:
        target_user = frappe.session.user

    filters = frappe._dict({"from_date": from_date, "to_date": to_date, "user": target_user})
    data = frappe._dict()

    # Metrics
    data.leads_without_activity = get_filtered_leads_without_activity(filters)
    data.total_follow_ups_today_upcoming = get_filtered_activities(filters, timeframe="upcoming")
    data.total_overdue_activities = get_filtered_activities(filters, timeframe="overdue")
    data.total_open_activities = get_filtered_activities(filters)
    data.bc_status_counts = get_bc_status_counts(filters)
    data.bc_without_activity = get_bc_without_activity_data(filters)
    data.lead_counts = get_filtered_lead_category_counts(filters)

    return data

def get_filtered_leads_without_activity(filters):
    db_f = {"custom_is_activity_created": 0, "custom_lead_category": ["in", ["Enquiry", "Pipeline"]]}
    if filters.user: db_f["lead_owner"] = filters.user
    if filters.from_date: db_f["creation"] = ["between", [filters.from_date, filters.to_date]]
    return frappe.db.count("Lead", db_f)

def get_filtered_activities(filters, timeframe=None):
    db_f = {"status": "Open"}
    if filters.user: db_f["assigned_to"] = filters.user
    today = nowdate()
    if timeframe == "upcoming":
        db_f["starts_on"] = ["between", [f"{today} 00:00:00", f"{add_days(today, 3)} 23:59:59"]]
    elif timeframe == "overdue":
        db_f["starts_on"] = ["<", today]
    return frappe.db.count("Event Activity", db_f)

def get_bc_status_counts(filters):
    counts = {}
    for s in ["Open", "Converted to Lead", "Existing Customer"]:
        db_f = {"status": s}
        if filters.user: db_f["assign_to"] = filters.user
        if filters.from_date: db_f["creation"] = ["between", [filters.from_date, filters.to_date]]
        counts[s] = frappe.db.count("Business Contacts", db_f)
    return counts

def get_filtered_lead_category_counts(filters):
    res = {}
    for cat in ['Enquiry', 'Pipeline', 'Order', 'Lost Enquiry', 'Lost Pipeline']:
        db_f = {"custom_lead_category": cat}
        if filters.user: db_f["lead_owner"] = filters.user
        if filters.from_date: db_f["creation"] = ["between", [filters.from_date, filters.to_date]]
        
        recs = frappe.db.get_all("Lead", filters=db_f, fields=["custom_expected_revenue", "custom_po_value"])
        rev_sum = sum([flt(r.custom_po_value if cat == "Order" else r.custom_expected_revenue) for r in recs])
        res[cat] = {"count": len(recs), "revenue": rev_sum}
    return res

@frappe.whitelist()
def get_crm_users():
    """Returns users having 'DAC CRM' or 'DAC CRM Head' roles with their Full Names."""
    return frappe.db.sql("""
        SELECT DISTINCT
            u.name as user,
            u.full_name as user_name
        FROM
            `tabUser` u
        INNER JOIN
            `tabHas Role` hr ON u.name = hr.parent
        WHERE
            hr.role IN ('DAC CRM', 'DAC CRM Head')
            AND u.enabled = 1
            AND u.name NOT IN ('Administrator', 'Guest')
        ORDER BY u.full_name ASC
    """, as_dict=True)
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
import frappe
import json

@frappe.whitelist()
def get_bc_without_activity_data(filters=None):
    """
    Returns Business Contacts with status 'Open' that have 
    ZERO entries in the Event Activity table (neglected contacts).
    """
    # 1. Parse Filters
    if isinstance(filters, str):
        filters = frappe._dict(json.loads(filters))
    elif not filters:
        filters = frappe._dict()

    # 2. Determine User Scope
    user_roles = frappe.get_roles(frappe.session.user)
    is_crm_head = "DAC CRM Head" in user_roles
    
    target_user = filters.get("user")
    if not target_user and not is_crm_head:
        target_user = frappe.session.user

    # 3. Build Query Conditions
    # We only look for Business Contacts currently in 'Open' status
    conditions = ["bc.status = 'Open'"]
    query_params = []

    # Filter by Assignment
    if target_user:
        conditions.append("bc.assign_to = %s")
        query_params.append(target_user)

    # Dashboard Date Filtering (usually based on when the BC was created)
    if filters.get("from_date") and filters.get("to_date"):
        conditions.append("bc.creation BETWEEN %s AND %s")
        query_params.extend([filters.from_date, filters.to_date])

    where_clause = " AND ".join(conditions)

    # 4. The Logic: NOT EXISTS
    # This finds BCs where there is NO record in tabEvent Activity 
    # regardless of that activity's status.
    sql_query = f"""
        SELECT bc.name 
        FROM `tabBusiness Contacts` bc 
        WHERE {where_clause}
        AND NOT EXISTS (
            SELECT 1 
            FROM `tabEvent Activity` ea 
            WHERE ea.reference_type = 'Business Contacts' 
            AND ea.reference_name = bc.name
        )
    """
    
    names = frappe.db.sql(sql_query, tuple(query_params), pluck=True)
    
    return {
        "count": len(names) or 0,
        "names": list(names) if names else []
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


@frappe.whitelist()
def update_expected_revenue_from_quotation(lead_name):
    """
    Update the Expected Revenue field of a Lead based on the most recent submitted quotation.
    Called from list view for existing leads that need revenue sync.
    """
    from frappe.utils import flt
    
    if not frappe.has_permission('Lead', 'write'):
        frappe.throw(_("You do not have permission to update Lead records."), frappe.PermissionError)
    
    quotations = frappe.get_all(
        'Quotation',
        fields=['name', 'grand_total', 'transaction_date'],
        filters={
            'custom_lead_id': lead_name,
            'docstatus': 1
        },
        order_by='transaction_date desc'
    )
    
    if quotations:
        latest_quotation = quotations[0]
        frappe.db.set_value("Lead", lead_name, "custom_expected_revenue", flt(latest_quotation.grand_total))
        return {"status": "success", "message": "Expected Revenue updated from Quotation " + latest_quotation.name}
    
    return {"status": "info", "message": "No submitted quotations found for this lead"}


@frappe.whitelist()
def update_all_leads_expected_revenue():
    """
    Bulk update all leads' expected revenue from their most recent quotations.
    Returns count of updated leads.
    """
    from frappe.utils import flt
    
    leads = frappe.get_all("Lead", filters={"custom_lead_category": ["in", ["Enquiry", "Pipeline"]]}, pluck="name")
    
    updated_count = 0
    for lead_name in leads:
        result = update_expected_revenue_from_quotation(lead_name)
        if result.get("status") == "success":
            updated_count += 1
    
    return updated_count


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

    return doc

import datetime

@frappe.whitelist()
def get_crm_dashboard_metadata():
    """Return users, fiscal years, industries, and current fiscal year for CRM Dashboard filters."""
    users = frappe.db.sql("""
        SELECT u.name, u.full_name
        FROM `tabUser` u
        JOIN `tabHas Role` hr ON hr.parent = u.name
        WHERE u.enabled = 1 AND u.user_type = 'System User'
          AND hr.role IN ('DAC CRM Head', 'DAC CRM')
        GROUP BY u.name
        ORDER BY u.full_name ASC
    """, as_dict=True)
    
    fiscal_years = frappe.get_all("Fiscal Year", filters={"disabled": 0}, fields=["name"], order_by="year_start_date desc")
    industries = frappe.get_all("Industry Type", fields=["name"], order_by="name asc")
    
    today_date = frappe.utils.today()
    current_fy = frappe.db.get_value("Fiscal Year", {"year_start_date": ["<=", today_date], "year_end_date": [">=", today_date], "disabled": 0}, "name")
    if not current_fy and fiscal_years:
        current_fy = fiscal_years[0].name

    all_users = frappe.db.get_all("User", fields=["name", "full_name"])
    user_map = {u.name: u.full_name for u in all_users if u.full_name}

    return {
        "users": users,
        "fiscal_years": fiscal_years,
        "industries": industries,
        "current_fiscal_year": current_fy,
        "user_map": user_map
    }

@frappe.whitelist()
def get_target_vs_actual(from_date=None, to_date=None, fiscal_year=None, month=None, user=None):
    if fiscal_year and frappe.db.exists("Fiscal Year", fiscal_year):
        fy_doc = frappe.db.get_value("Fiscal Year", fiscal_year, ["year_start_date", "year_end_date"], as_dict=1)
        if fy_doc:
            from_date = str(fy_doc.year_start_date)
            to_date = str(fy_doc.year_end_date)
            if month:
                try:
                    import calendar
                    m_idx = int(month)
                    fy_start = getdate(fy_doc.year_start_date)
                    m_year = fy_start.year if m_idx >= fy_start.month else fy_start.year + 1
                    from_date = f"{m_year}-{m_idx:02d}-01"
                    last_day = calendar.monthrange(m_year, m_idx)[1]
                    to_date = f"{m_year}-{m_idx:02d}-{last_day}"
                except Exception:
                    pass

    if not from_date or not to_date:
        fy_doc = frappe.db.get_value("Fiscal Year", "2025-2026", ["year_start_date", "year_end_date"], as_dict=1)
        if not fy_doc:
            fy_doc = frappe.db.get_value("Fiscal Year", {"disabled": 0}, ["year_start_date", "year_end_date"], order_by="year_start_date desc", as_dict=1)
        if fy_doc:
            from_date = str(fy_doc.year_start_date)
            to_date = str(fy_doc.year_end_date)
            if month:
                try:
                    import calendar
                    m_idx = int(month)
                    fy_start = getdate(fy_doc.year_start_date)
                    m_year = fy_start.year if m_idx >= fy_start.month else fy_start.year + 1
                    from_date = f"{m_year}-{m_idx:02d}-01"
                    last_day = calendar.monthrange(m_year, m_idx)[1]
                    to_date = f"{m_year}-{m_idx:02d}-{last_day}"
                except Exception:
                    pass
        else:
            from_date = "2025-04-01"
            to_date = "2026-03-31"

    from_date_obj = getdate(from_date)
    to_date_obj = getdate(to_date)
    current_user = frappe.session.user
    
    # 1. Role-Based Filtering
    user_roles = frappe.get_roles(current_user)
    sp_filters = {"enabled": 1, "is_group": 0}
    
    if user:
        employee_id = frappe.db.get_value("Employee", {"user_id": user}, "name")
        if employee_id:
            sp_filters["employee"] = employee_id
        else:
            return {"year_start_date": str(from_date), "year_end_date": str(to_date), "data": []}
    elif "DAC CRM Head" not in user_roles and "Administrator" not in user_roles:
        employees = frappe.get_all("Employee", filters={"user_id": current_user}, fields=["name"])
        employee_names = [e.name for e in employees]
        if not employee_names:
            return {"year_start_date": str(from_date), "year_end_date": str(to_date), "data": []}
        sp_filters["employee"] = ["in", employee_names]

    sales_persons = frappe.get_all("Sales Person", fields=["name", "sales_person_name"], filters=sp_filters)
    if not sales_persons: 
        return {"year_start_date": str(from_date), "year_end_date": str(to_date), "data": []}

    data = []

    if user and not month and len(sales_persons) == 1:
        sp = sales_persons[0]
        months_to_show = get_months_in_range(from_date_obj, to_date_obj)
        sp_targets = frappe.db.get_all("Target Detail", filters={"parent": sp.name}, fields=["fiscal_year", "target_amount", "distribution_id"])
        
        active_fy = None
        for t in sp_targets:
            fy_doc = frappe.get_cached_doc("Fiscal Year", t.fiscal_year)
            if getdate(fy_doc.year_start_date) <= to_date_obj and getdate(fy_doc.year_end_date) >= from_date_obj:
                active_fy = fy_doc
                break
                
        fy_start_date = getdate(active_fy.year_start_date) if active_fy else from_date_obj
        
        running_bal = 0.0
        if from_date_obj > fy_start_date:
            hist_end = from_date_obj - datetime.timedelta(days=1)
            hist_months = get_months_in_range(fy_start_date, hist_end)
            for m_name in hist_months:
                m_idx = list(calendar_months().values()).index(m_name) + 1
                m_year = fy_start_date.year if m_idx >= fy_start_date.month else fy_start_date.year + 1
                m_start = datetime.date(m_year, m_idx, 1)
                m_t = get_specific_target(sp.name, [m_name], m_start, get_last_day(m_start))
                m_a = get_specific_actual(sp.name, m_start, get_last_day(m_start))
                running_bal += (m_a - m_t)
                if running_bal > 0: running_bal = 0.0
                
        for m_name in months_to_show:
            m_idx = list(calendar_months().values()).index(m_name) + 1
            m_year = fy_start_date.year if m_idx >= fy_start_date.month else fy_start_date.year + 1
            m_start = datetime.date(m_year, m_idx, 1)
            m_end = get_last_day(m_start)
            
            if m_start < from_date_obj: m_start = from_date_obj
            if m_end > to_date_obj: m_end = to_date_obj
            
            curr_target = get_specific_target(sp.name, [m_name], m_start, m_end)
            curr_actual = get_specific_actual(sp.name, m_start, m_end)
            
            ytd_months_list = get_months_in_range(fy_start_date, m_end)
            ytd_range_label = f"{fy_start_date.strftime('%b')} to {m_end.strftime('%b')}"
            ytd_target = get_specific_target(sp.name, ytd_months_list, fy_start_date, m_end)
            
            prev_deficit = running_bal
            curr_variance = curr_actual - curr_target
            curr_ach = (curr_actual / curr_target * 100) if curr_target > 0 else 0.0
            overall_variance = prev_deficit + curr_variance
            total_burden = curr_target + abs(prev_deficit)
            overall_ach = (curr_actual / total_burden * 100) if total_burden > 0 else 0.0
            
            running_bal += curr_variance
            if running_bal > 0: running_bal = 0.0
            
            data.append({
                "sales_person": f"{m_name} {m_year}",
                "sales_person_name": f"{m_name} {m_year}",
                "full_name": f"{m_name} {m_year}",
                "target": curr_target,
                "target_amount": curr_target,
                "monthly_target": curr_target,
                "annual_target": ytd_target,
                "actual": curr_actual,
                "actual_closed": curr_actual,
                "actual_revenue": curr_actual,
                "curr_variance": curr_variance,
                "variance_amount": curr_variance,
                "curr_achievement": curr_ach,
                "achievement_percent": curr_ach,
                "ytd_label": ytd_range_label,
                "ytd_target": ytd_target,
                "overall_variance": overall_variance,
                "overall_achievement": overall_ach
            })
            
    else:
        for sp in sales_persons:
            curr_actual = get_specific_actual(sp.name, from_date_obj, to_date_obj)
            sp_targets = frappe.db.get_all("Target Detail", filters={"parent": sp.name}, fields=["fiscal_year", "target_amount", "distribution_id"])
            
            active_fy = None
            curr_target = 0.0
            ytd_target = 0.0
            prev_deficit = 0.0
            ytd_range_label = ""
    
            for t in sp_targets:
                fy_doc = frappe.get_cached_doc("Fiscal Year", t.fiscal_year)
                if getdate(fy_doc.year_start_date) <= to_date_obj and getdate(fy_doc.year_end_date) >= from_date_obj:
                    active_fy = fy_doc
                    break
            
            if active_fy:
                fy_start_date = getdate(active_fy.year_start_date)
    
                if from_date_obj > fy_start_date:
                    hist_end = from_date_obj - datetime.timedelta(days=1)
                    hist_months = get_months_in_range(fy_start_date, hist_end)
                    running_bal = 0.0
                    for m_name in hist_months:
                        m_idx = list(calendar_months().values()).index(m_name) + 1
                        m_year = fy_start_date.year if m_idx >= fy_start_date.month else fy_start_date.year + 1
                        m_start = datetime.date(m_year, m_idx, 1)
                        m_t = get_specific_target(sp.name, [m_name], m_start, get_last_day(m_start))
                        m_a = get_specific_actual(sp.name, m_start, get_last_day(m_start))
                        running_bal += (m_a - m_t)
                        if running_bal > 0: running_bal = 0.0
                    prev_deficit = running_bal
    
                curr_months = get_months_in_range(from_date_obj, to_date_obj)
                curr_target = get_specific_target(sp.name, curr_months, from_date_obj, to_date_obj)
                ytd_months_list = get_months_in_range(fy_start_date, to_date_obj)
                ytd_range_label = f"{fy_start_date.strftime('%b')} to {to_date_obj.strftime('%b')}"
                ytd_target = get_specific_target(sp.name, ytd_months_list, fy_start_date, to_date_obj)
    
            curr_variance = curr_actual - curr_target
            curr_ach = (curr_actual / curr_target * 100) if curr_target > 0 else 0.0
            overall_variance = prev_deficit + curr_variance
            total_burden = curr_target + abs(prev_deficit)
            overall_ach = (curr_actual / total_burden * 100) if total_burden > 0 else 0.0
    
            data.append({
                "sales_person": sp.sales_person_name,
                "sales_person_name": sp.sales_person_name,
                "full_name": sp.sales_person_name,
                "target": curr_target,
                "target_amount": curr_target,
                "monthly_target": curr_target,
                "annual_target": ytd_target,
                "actual": curr_actual,
                "actual_closed": curr_actual,
                "actual_revenue": curr_actual,
                "curr_variance": curr_variance,
                "variance_amount": curr_variance,
                "curr_achievement": curr_ach,
                "achievement_percent": curr_ach,
                "ytd_label": ytd_range_label,
                "ytd_target": ytd_target,
                "overall_variance": overall_variance,
                "overall_achievement": overall_ach
            })

    return {
        "year_start_date": str(from_date),
        "year_end_date": str(to_date),
        "data": data
    }


@frappe.whitelist()
def get_monthly_target_vs_actual(fiscal_year=None, user=None):
    if not fiscal_year:
        fiscal_year = "2025-2026"
        
    fy_doc = frappe.db.get_value("Fiscal Year", fiscal_year, ["year_start_date", "year_end_date"], as_dict=1)
    if not fy_doc:
        fy_doc = frappe.db.get_value("Fiscal Year", {"disabled": 0}, ["year_start_date", "year_end_date"], order_by="year_start_date desc", as_dict=1)
        
    if not fy_doc:
        return []
        
    from_date = fy_doc.year_start_date
    to_date = fy_doc.year_end_date
    
    current_user = frappe.session.user
    user_roles = frappe.get_roles(current_user)
    sp_filters = {"enabled": 1, "is_group": 0}
    
    if user:
        employee_id = frappe.db.get_value("Employee", {"user_id": user}, "name")
        if employee_id:
            sp_filters["employee"] = employee_id
        else:
            return []
    elif "DAC CRM Head" not in user_roles and "Administrator" not in user_roles:
        employees = frappe.get_all("Employee", filters={"user_id": current_user}, fields=["name"])
        employee_names = [e.name for e in employees]
        if not employee_names:
            return []
        sp_filters["employee"] = ["in", employee_names]
        
    sales_persons = frappe.get_all("Sales Person", fields=["name", "sales_person_name"], filters=sp_filters)
    if not sales_persons:
        return []
        
    from_date_obj = getdate(from_date)
    to_date_obj = getdate(to_date)
    months_to_show = get_months_in_range(from_date_obj, to_date_obj)
    
    data = []
    running_target = 0.0
    running_actual = 0.0
    
    for m_name in months_to_show:
        m_idx = list(calendar_months().values()).index(m_name) + 1
        m_year = from_date_obj.year if m_idx >= from_date_obj.month else from_date_obj.year + 1
        m_start = datetime.date(m_year, m_idx, 1)
        m_end = get_last_day(m_start)
        
        month_target = 0.0
        month_actual = 0.0
        
        for sp in sales_persons:
            month_target += get_specific_target(sp.name, [m_name], m_start, m_end)
            month_actual += get_specific_actual(sp.name, m_start, m_end)
            
        month_variance = month_actual - month_target
        month_ach = (month_actual / month_target * 100) if month_target > 0 else 0.0
        
        running_target += month_target
        running_actual += month_actual
        cum_variance = running_actual - running_target
        cum_ach = (running_actual / running_target * 100) if running_target > 0 else 0.0
        
        data.append({
            "month": f"{m_name} {m_year}",
            "target": month_target,
            "actual": month_actual,
            "variance": month_variance,
            "ach_pct": month_ach,
            "cum_target": running_target,
            "cum_actual": running_actual,
            "cum_variance": cum_variance,
            "cum_ach_pct": cum_ach
        })
        
    return data


@frappe.whitelist()
def get_target_vs_actual_data(fiscal_year=None, from_date=None, to_date=None):
    """Whitelisted alias for Target vs Actual analysis endpoint."""
    return get_target_vs_actual(from_date=from_date, to_date=to_date, fiscal_year=fiscal_year)


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








# import frappe
# from frappe.utils import flt

# @frappe.whitelist()
# def get_tabular_dashboard_data(from_date=None, to_date=None, user=None, industry=None):
#     lead_rows = []
    
#     # 1. Base Query Params
#     params = {}
#     filter_clause = " WHERE docstatus < 2 "
    
#     if user:
#         filter_clause += " AND lead_owner = %(user)s "
#         params["user"] = user
#     if industry:
#         # User defined label Industry Type, usually matches field name custom_industry_type
#         # Verify fieldname in Lead doctype. Replace 'custom_industry_type' if needed.
#         filter_clause += " AND industry = %(industry)s "
#         params["industry"] = industry
#     if from_date and to_date:
#         filter_clause += " AND creation BETWEEN %(sd)s AND %(ed)s "
#         params["sd"] = from_date
#         params["ed"] = to_date

#     # --- Lead Data Extraction ---
#     # Using specific Logic: Order -> PO Value | All others -> Expected Revenue
#     leads_sql = frappe.db.sql(f"""
#         SELECT 
#             MONTHNAME(creation) as m_name, YEAR(creation) as m_year, MONTH(creation) as m_num,
#             custom_lead_category as category,
#             COUNT(name) as count,
#             SUM(CASE 
#                 WHEN custom_lead_category = 'Order' THEN IFNULL(custom_po_value, 0) 
#                 ELSE IFNULL(custom_expected_revenue, 0) 
#             END) as value
#         FROM `tabLead` 
#         {filter_clause}
#         GROUP BY m_year, m_num, category
#         ORDER BY m_year ASC, m_num ASC
#     """, params, as_dict=1)

#     lead_map = {}
#     # Grand Totals accumulator
#     lt = {"enq_c":0,"enq_v":0,"pipe_c":0,"pipe_v":0,"ord_c":0,"ord_v":0,"lenq_c":0,"lenq_v":0,"lpipe_c":0,"lpipe_v":0}

#     for l in leads_sql:
#         m_key = f"{l.m_name} {l.m_year}"
#         if m_key not in lead_map:
#             lead_map[m_key] = {"month_label": m_key, "sort": f"{l.m_year}-{l.m_num:02}", "enq_cnt":0, "enq_val":0, "pipe_cnt":0, "pipe_val":0, "ord_cnt":0, "ord_val":0, "lenq_cnt":0, "lenq_val":0, "lpipe_cnt":0, "lpipe_val":0}
        
#         row = lead_map[m_key]
#         c, v = int(l.count), flt(l.value)
        
#         if l.category == 'Enquiry': row['enq_cnt'], row['enq_val'] = c, v; lt["enq_c"] += c; lt["enq_v"] += v
#         elif l.category == 'Pipeline': row['pipe_cnt'], row['pipe_val'] = c, v; lt["pipe_c"] += c; lt["pipe_v"] += v
#         elif l.category == 'Order': row['ord_cnt'], row['ord_val'] = c, v; lt["ord_c"] += c; lt["ord_v"] += v
#         elif l.category == 'Lost Enquiry': row['lenq_cnt'], row['lenq_val'] = c, v; lt["lenq_c"] += c; lt["lenq_v"] += v
#         elif l.category == 'Lost Pipeline': row['lpipe_cnt'], row['lpipe_val'] = c, v; lt["lpipe_c"] += c; lt["lpipe_v"] += v

#     lead_rows = sorted(lead_map.values(), key=lambda x: x['sort'])

#     # --- Contact Management Logic ---
#     bc_filters = " WHERE docstatus < 2 "
#     bc_params = {}
#     if user: bc_filters += " AND assign_to = %(u)s "; bc_params["u"] = user
#     if from_date and to_date: bc_filters += " AND creation BETWEEN %(s)s AND %(e)s "; bc_params["s"] = from_date; bc_params["e"] = to_date

#     contacts = frappe.db.sql(f"""
#         SELECT MONTHNAME(creation) as m_name, YEAR(creation) as m_year, status, count(name) as count
#         FROM `tabBusiness Contacts` {bc_filters}
#         GROUP BY m_year, m_name, status
#     """, bc_params, as_dict=1)

#     bc_map = {}
#     ct = {"o": 0, "c": 0, "e": 0} # Totals: Open, Converted, Existing
    
#     for c in contacts:
#         label = f"{c.m_name} {c.m_year}"
#         if label not in bc_map: bc_map[label] = {"label": label, "open": 0, "conv": 0, "existing": 0}
        
#         count = int(c.count)
#         if c.status == "Open": bc_map[label]["open"] = count; ct["o"] += count
#         elif c.status == "Converted to Lead": bc_map[label]["conv"] = count; ct["c"] += count
#         elif c.status == "Existing Customer": bc_map[label]["existing"] = count; ct["e"] += count

#     return {
#         "lead_data": lead_rows,
#         "lead_totals": lt,
#         "contact_data": list(bc_map.values()),
#         "contact_totals": ct
#     }

# import frappe
# from frappe.utils import flt, format_date

# @frappe.whitelist()
# def get_tabular_dashboard_data(from_date=None, to_date=None, user=None, industry=None):
#     # Parameters initialization
#     params = {"sd": from_date, "ed": to_date, "usr": user, "ind": industry}
    
#     # 1. Base Filter String logic
#     filters = " WHERE docstatus < 2 "
#     bc_filters = " WHERE docstatus < 2 "
    
#     if user:
#         filters += " AND lead_owner = %(usr)s "
#         bc_filters += " AND assign_to = %(usr)s "
#     if industry:
#         # Assuming field name is industry in both doctypes. Change if different.
#         filters += " AND industry = %(ind)s "
#         bc_filters += " AND industry = %(ind)s "
#     if from_date and to_date:
#         filters += " AND creation BETWEEN %(sd)s AND %(ed)s "
#         bc_filters += " AND creation BETWEEN %(sd)s AND %(ed)s "

#     # --- LEAD LOGIC ---
#     leads = frappe.db.sql(f"""
#         SELECT 
#             MONTHNAME(creation) as m_name, YEAR(creation) as m_year, MONTH(creation) as m_num,
#             custom_lead_category as cat, COUNT(name) as count,
#             SUM(CASE WHEN custom_lead_category = 'Order' THEN IFNULL(custom_po_value, 0) ELSE IFNULL(custom_expected_revenue, 0) END) as val
#         FROM `tabLead` {filters}
#         GROUP BY m_year, m_num, m_name, cat ORDER BY m_year ASC, m_num ASC
#     """, params, as_dict=1)

#     lead_map = {}
#     lt = {"enq_c":0,"enq_v":0,"pipe_c":0,"pipe_v":0,"ord_c":0,"ord_v":0,"lenq_c":0,"lenq_v":0,"lpipe_c":0,"lpipe_v":0}

#     for l in leads:
#         key = f"{l.m_name} {l.m_year}"
#         if key not in lead_map:
#             lead_map[key] = {"label": key, "sort": f"{l.m_year}-{l.m_num:02}", "enq_c":0,"enq_v":0,"pipe_c":0,"pipe_v":0,"ord_c":0,"ord_v":0,"lenq_c":0,"lenq_v":0,"lpipe_c":0,"lpipe_v":0}
        
#         row, c, v = lead_map[key], int(l.count), flt(l.val)
#         if l.cat == 'Enquiry': row['enq_c'], row['enq_v'] = c, v; lt['enq_c']+=c; lt['enq_v']+=v
#         elif l.cat == 'Pipeline': row['pipe_c'], row['pipe_v'] = c, v; lt['pipe_c']+=c; lt['pipe_v']+=v
#         elif l.cat == 'Order': row['ord_c'], row['ord_v'] = c, v; lt['ord_c']+=c; lt['ord_v']+=v
#         elif l.cat == 'Lost Enquiry': row['lenq_c'], row['lenq_v'] = c, v; lt['lenq_c']+=c; lt['lenq_v']+=v
#         elif l.cat == 'Lost Pipeline': row['lpipe_c'], row['lpipe_v'] = c, v; lt['lpipe_c']+=c; lt['lpipe_v']+=v

#     # --- CONTACT LOGIC ---
#     contacts = frappe.db.sql(f"""
#         SELECT MONTHNAME(creation) as m_name, YEAR(creation) as m_year, MONTH(creation) as m_num, status, COUNT(name) as count
#         FROM `tabBusiness Contacts` {bc_filters}
#         GROUP BY m_year, m_num, m_name, status ORDER BY m_year ASC, m_num ASC
#     """, params, as_dict=1)

#     bc_map = {}
#     ct = {"o": 0, "c": 0, "e": 0}
#     for b in contacts:
#         key = f"{b.m_name} {b.m_year}"
#         if key not in bc_map:
#             bc_map[key] = {"label": key, "o": 0, "c": 0, "e": 0, "sort": f"{b.m_year}-{b.m_num:02}"}
        
#         cnt = int(b.count)
#         if b.status == "Open": bc_map[key]["o"] = cnt; ct["o"] += cnt
#         elif b.status == "Converted to Lead": bc_map[key]["c"] = cnt; ct["c"] += cnt
#         elif b.status == "Existing Customer": bc_map[key]["e"] = cnt; ct["e"] += cnt

#     return {
#         "leads": sorted(lead_map.values(), key=lambda x: x['sort']),
#         "lead_totals": lt,
#         "contacts": sorted(bc_map.values(), key=lambda x: x['sort']),
#         "contact_totals": ct
#     }


import frappe
import datetime
from frappe.utils import flt, getdate, today, get_last_day

def parse_period_and_dates(period=None, fiscal_year=None, from_date=None, to_date=None, month=None):
    """Resolve period, fiscal_year, month, and custom dates to explicit from_date and to_date."""
    if from_date and to_date:
        return str(from_date), str(to_date)

    if period and str(period).startswith("fy:"):
        fiscal_year = str(period)[3:]
        period = None

    today_date = getdate(today())

    if month:
        try:
            m_str = str(month).strip()
            # Case 1: YYYY-MM or YYYY-M
            if '-' in m_str and len(m_str) >= 6:
                parts = m_str.split('-')
                yr = int(parts[0])
                m = int(parts[1])
                start_d = datetime.date(yr, m, 1)
                last_d = get_last_day(start_d)
                return start_d.strftime("%Y-%m-%d"), last_d.strftime("%Y-%m-%d")
            # Case 2: "Month Year" like "September 2025" or "Sep 2025"
            import re
            m_match = re.search(r'([A-Za-z]+)\s*(\d{4})', m_str)
            if m_match:
                m_name = m_match.group(1).lower()
                yr = int(m_match.group(2))
                months_map = {
                    'january':1, 'jan':1, 'february':2, 'feb':2, 'march':3, 'mar':3,
                    'april':4, 'apr':4, 'may':5, 'june':6, 'jun':6, 'july':7, 'jul':7,
                    'august':8, 'aug':8, 'september':9, 'sep':9, 'sept':9, 'october':10, 'oct':10,
                    'november':11, 'nov':11, 'december':12, 'dec':12
                }
                m = months_map.get(m_name, 1)
                start_d = datetime.date(yr, m, 1)
                last_d = get_last_day(start_d)
                return start_d.strftime("%Y-%m-%d"), last_d.strftime("%Y-%m-%d")
            # Case 3: integer month "9" or "09"
            if m_str.isdigit():
                m = int(m_str)
                fy_start_year = int(str(fiscal_year).split('-')[0]) if (fiscal_year and '-' in str(fiscal_year)) else today_date.year
                year = (fy_start_year + 1) if m in (1, 2, 3) else fy_start_year
                start_d = datetime.date(year, m, 1)
                last_d = get_last_day(start_d)
                return start_d.strftime("%Y-%m-%d"), last_d.strftime("%Y-%m-%d")
        except Exception:
            pass

    if not fiscal_year:
        if period == "this_year":
            fy_s = (today_date.year - 1) if today_date.month in (1, 2, 3) else today_date.year
            fiscal_year = f"{fy_s}-{fy_s + 1}"
        elif period == "last_year":
            fy_s = (today_date.year - 2) if today_date.month in (1, 2, 3) else (today_date.year - 1)
            fiscal_year = f"{fy_s}-{fy_s + 1}"

    if period:
        if period == "all":
            return None, None
        today_date = getdate(today())
        if period == "today":
            t_str = today_date.strftime("%Y-%m-%d")
            return t_str, t_str
        elif period == "this_week":
            start_w = today_date - datetime.timedelta(days=today_date.weekday())
            end_w = start_w + datetime.timedelta(days=6)
            return start_w.strftime("%Y-%m-%d"), end_w.strftime("%Y-%m-%d")
        elif period == "this_month":
            return today_date.replace(day=1).strftime("%Y-%m-%d"), get_last_day(today_date).strftime("%Y-%m-%d")
        elif period == "last_month":
            first_this = today_date.replace(day=1)
            last_prev = first_this - datetime.timedelta(days=1)
            return last_prev.replace(day=1).strftime("%Y-%m-%d"), last_prev.strftime("%Y-%m-%d")
        elif period == "this_quarter":
            m_curr = today_date.month
            q_start_month = 3 * ((m_curr - 1) // 3) + 1
            start_d = today_date.replace(month=q_start_month, day=1)
            q_end_month = q_start_month + 2
            last_d = get_last_day(today_date.replace(month=q_end_month, day=1))
            return start_d.strftime("%Y-%m-%d"), last_d.strftime("%Y-%m-%d")
        elif period == "last_quarter":
            m_curr = today_date.month
            q_start_month = 3 * ((m_curr - 1) // 3) + 1
            first_this_q = today_date.replace(month=q_start_month, day=1)
            last_prev_q = first_this_q - datetime.timedelta(days=1)
            prev_m_curr = last_prev_q.month
            prev_q_start_month = 3 * ((prev_m_curr - 1) // 3) + 1
            start_d = last_prev_q.replace(month=prev_q_start_month, day=1)
            return start_d.strftime("%Y-%m-%d"), last_prev_q.strftime("%Y-%m-%d")
        elif period == "this_year":
            fy_start_year = (today_date.year - 1) if today_date.month in (1, 2, 3) else today_date.year
            return f"{fy_start_year}-04-01", f"{fy_start_year + 1}-03-31"
        elif period == "last_year":
            fy_start_year = (today_date.year - 2) if today_date.month in (1, 2, 3) else (today_date.year - 1)
            return f"{fy_start_year}-04-01", f"{fy_start_year + 1}-03-31"

    if fiscal_year and frappe.db.exists("Fiscal Year", fiscal_year):
        fy_doc = frappe.db.get_value("Fiscal Year", fiscal_year, ["year_start_date", "year_end_date"], as_dict=1)
        if fy_doc:
            return str(fy_doc.year_start_date), str(fy_doc.year_end_date)

    return from_date, to_date

@frappe.whitelist()
def get_tabular_dashboard_data(from_date=None, to_date=None, user=None, industry=None, period_type="monthly", fiscal_year=None, period=None, month=None, **kwargs):
    from_date, to_date = parse_period_and_dates(period, fiscal_year, from_date, to_date, month=month or kwargs.get("month"))

    # Determine the User Filter based on permissions
    is_head = "DAC CRM Head" in frappe.get_roles()
    effective_user = user if (is_head and user) else (None if (is_head and not user) else frappe.session.user)

    params = {"sd": from_date, "ed": to_date, "usr": effective_user, "ind": industry}
    
    where_lead = " WHERE l.docstatus < 2 "
    where_cont = " WHERE docstatus < 2 "

    if effective_user:
        where_lead += " AND l.lead_owner = %(usr)s "
        where_cont += " AND assign_to = %(usr)s "
    if industry:
        where_lead += " AND l.industry = %(ind)s "
        where_cont += " AND industry = %(ind)s "

    lead_action_date = """
        CASE
            WHEN l.custom_lead_category = 'Enquiry' THEN DATE(l.creation)
            ELSE COALESCE(
                (SELECT DATE(MAX(sh.updated_at)) FROM `tabLead Status Change History` sh
                 WHERE sh.parent = l.name AND sh.new_status = l.custom_lead_category),
                DATE(l.creation)
            )
        END
    """

    contact_action_date = """
        CASE
            WHEN status = 'Open' THEN DATE(creation)
            ELSE DATE(modified)
        END
    """

    if from_date and to_date:
        where_lead_creation = f" AND ({lead_action_date}) BETWEEN %(sd)s AND %(ed)s "
        where_cont += f" AND ({contact_action_date}) BETWEEN %(sd)s AND %(ed)s "
    else:
        where_lead_creation = ""

    # Grouping expressions
    lead_date_expr = f"({lead_action_date})"
    contact_date_expr = f"({contact_action_date})"
    if period_type == "daily":
        p_label_hist = "DATE_FORMAT(sh.updated_at, '%%d-%%b-%%Y')"
        p_sort_hist = "DATE_FORMAT(sh.updated_at, '%%Y-%%m-%%d')"
        p_group_hist = "DATE_FORMAT(sh.updated_at, '%%Y-%%m-%%d')"

        p_label_lead = f"DATE_FORMAT({lead_date_expr}, '%%d-%%b-%%Y')"
        p_sort_lead = f"DATE_FORMAT({lead_date_expr}, '%%Y-%%m-%%d')"
        p_group_lead = f"DATE_FORMAT({lead_date_expr}, '%%Y-%%m-%%d')"

        p_label_cont = f"DATE_FORMAT({contact_date_expr}, '%%d-%%b-%%Y')"
        p_sort_cont = f"DATE_FORMAT({contact_date_expr}, '%%Y-%%m-%%d')"
        p_group_cont = f"DATE_FORMAT({contact_date_expr}, '%%Y-%%m-%%d')"
    elif period_type == "weekly":
        p_label_hist = "CONCAT('Week ', WEEK(sh.updated_at, 1), ' (', DATE_FORMAT(MIN(DATE_SUB(DATE(sh.updated_at), INTERVAL WEEKDAY(sh.updated_at) DAY)), '%%d-%%b-%%Y (%%a)'), ' to ', DATE_FORMAT(MIN(DATE_ADD(DATE_SUB(DATE(sh.updated_at), INTERVAL WEEKDAY(sh.updated_at) DAY), INTERVAL 6 DAY)), '%%d-%%b-%%Y (%%a)'), ')') "
        p_sort_hist = "CONCAT(YEAR(sh.updated_at), '-', LPAD(WEEK(sh.updated_at, 1), 2, '0'))"
        p_group_hist = "YEAR(sh.updated_at), WEEK(sh.updated_at, 1)"

        p_label_lead = f"CONCAT('Week ', WEEK({lead_date_expr}, 1), ' (', DATE_FORMAT(MIN(DATE_SUB(DATE({lead_date_expr}), INTERVAL WEEKDAY({lead_date_expr}) DAY)), '%%d-%%b-%%Y (%%a)'), ' to ', DATE_FORMAT(MIN(DATE_ADD(DATE_SUB(DATE({lead_date_expr}), INTERVAL WEEKDAY({lead_date_expr}) DAY), INTERVAL 6 DAY)), '%%d-%%b-%%Y (%%a)'), ')') "
        p_sort_lead = f"CONCAT(YEAR({lead_date_expr}), '-', LPAD(WEEK({lead_date_expr}, 1), 2, '0'))"
        p_group_lead = f"YEAR({lead_date_expr}), WEEK({lead_date_expr}, 1)"

        p_label_cont = f"CONCAT('Week ', WEEK({contact_date_expr}, 1), ' (', DATE_FORMAT(MIN(DATE_SUB(DATE({contact_date_expr}), INTERVAL WEEKDAY({contact_date_expr}) DAY)), '%%d-%%b-%%Y (%%a)'), ' to ', DATE_FORMAT(MIN(DATE_ADD(DATE_SUB(DATE({contact_date_expr}), INTERVAL WEEKDAY({contact_date_expr}) DAY), INTERVAL 6 DAY)), '%%d-%%b-%%Y (%%a)'), ')') "
        p_sort_cont = f"CONCAT(YEAR({contact_date_expr}), '-', LPAD(WEEK({contact_date_expr}, 1), 2, '0'))"
        p_group_cont = f"YEAR({contact_date_expr}), WEEK({contact_date_expr}, 1)"
    else: # monthly
        p_label_hist = "CONCAT(MONTHNAME(sh.updated_at), ' ', YEAR(sh.updated_at))"
        p_sort_hist = "CONCAT(CASE WHEN MONTH(sh.updated_at) >= 4 THEN YEAR(sh.updated_at) ELSE YEAR(sh.updated_at) - 1 END, '-', LPAD(CASE WHEN MONTH(sh.updated_at) >= 4 THEN MONTH(sh.updated_at) - 3 ELSE MONTH(sh.updated_at) + 9 END, 2, '0'))"
        p_group_hist = "YEAR(sh.updated_at), MONTH(sh.updated_at)"

        p_label_lead = f"CONCAT(MONTHNAME({lead_date_expr}), ' ', YEAR({lead_date_expr}))"
        p_sort_lead = f"CONCAT(CASE WHEN MONTH({lead_date_expr}) >= 4 THEN YEAR({lead_date_expr}) ELSE YEAR({lead_date_expr}) - 1 END, '-', LPAD(CASE WHEN MONTH({lead_date_expr}) >= 4 THEN MONTH({lead_date_expr}) - 3 ELSE MONTH({lead_date_expr}) + 9 END, 2, '0'))"
        p_group_lead = f"YEAR({lead_date_expr}), MONTH({lead_date_expr})"

        p_label_cont = f"CONCAT(MONTHNAME({contact_date_expr}), ' ', YEAR({contact_date_expr}))"
        p_sort_cont = f"CONCAT(CASE WHEN MONTH({contact_date_expr}) >= 4 THEN YEAR({contact_date_expr}) ELSE YEAR({contact_date_expr}) - 1 END, '-', LPAD(CASE WHEN MONTH({contact_date_expr}) >= 4 THEN MONTH({contact_date_expr}) - 3 ELSE MONTH({contact_date_expr}) + 9 END, 2, '0'))"
        p_group_cont = f"YEAR({contact_date_expr}), MONTH({contact_date_expr})"

    # 1. Lead Data grouped by period
    lead_creation_date_where = where_lead_creation

    lead_created_data = frappe.db.sql(f"""
        SELECT 
            {p_label_lead} as label,
            {p_sort_lead} as f_sort,
            DATE_FORMAT(({lead_action_date}), '%%Y-%%m') as ym_num,
            MONTH({lead_action_date}) as m_num,
            MIN(DATE({lead_action_date})) as row_from_date,
            MAX(DATE({lead_action_date})) as row_to_date,
            SUM(CASE WHEN l.custom_lead_category = 'Enquiry' THEN 1 ELSE 0 END) as enq_c,
            SUM(CASE WHEN l.custom_lead_category = 'Enquiry' THEN COALESCE(l.custom_expected_revenue, 0) ELSE 0 END) as enq_v,
            SUM(CASE WHEN l.custom_lead_category = 'Pipeline' THEN 1 ELSE 0 END) as pipe_c,
            SUM(CASE WHEN l.custom_lead_category = 'Pipeline' THEN COALESCE(l.custom_expected_revenue, 0) ELSE 0 END) as pipe_v,
            SUM(CASE WHEN l.custom_lead_category = 'Order' THEN 1 ELSE 0 END) as ord_c,
            SUM(CASE WHEN l.custom_lead_category = 'Order' THEN COALESCE(l.custom_po_value, l.custom_expected_revenue, 0) ELSE 0 END) as ord_v,
            SUM(CASE WHEN l.custom_lead_category = 'Lost Enquiry' THEN 1 ELSE 0 END) as lenq_c,
            SUM(CASE WHEN l.custom_lead_category = 'Lost Enquiry' THEN COALESCE(l.custom_expected_revenue, 0) ELSE 0 END) as lenq_v,
            SUM(CASE WHEN l.custom_lead_category = 'Lost Pipeline' THEN 1 ELSE 0 END) as lpipe_c,
            SUM(CASE WHEN l.custom_lead_category = 'Lost Pipeline' THEN COALESCE(l.custom_expected_revenue, 0) ELSE 0 END) as lpipe_v
        FROM `tabLead` l
        {where_lead} {lead_creation_date_where}
        GROUP BY {p_group_lead} ORDER BY f_sort ASC
    """, params, as_dict=1)

    # Populate Lead Data
    lead_period_map = {}
    for r in lead_created_data:
        key = r.label
        if key not in lead_period_map:
            lead_period_map[key] = {
                "label": key, "f_sort": str(r.f_sort), "m_num": str(r.ym_num or r.label or ''),
                "row_from_date": str(r.row_from_date) if r.row_from_date else '',
                "row_to_date": str(r.row_to_date) if r.row_to_date else '',
                "enq_c": 0, "enq_v": 0.0, "pipe_c": 0, "pipe_v": 0.0, "ord_c": 0, "ord_v": 0.0,
                "lenq_c": 0, "lenq_v": 0.0, "lpipe_c": 0, "lpipe_v": 0.0,
                "conv_bc_to_lead": 0, "conv_lead_to_order": 0, "convert_to": 0
            }
        p = lead_period_map[key]
        p["enq_c"] += int(r.enq_c or 0)
        p["enq_v"] += float(r.enq_v or 0.0)
        p["pipe_c"] += int(r.pipe_c or 0)
        p["pipe_v"] += float(r.pipe_v or 0.0)
        p["ord_c"] += int(r.ord_c or 0)
        p["ord_v"] += float(r.ord_v or 0.0)
        p["lenq_c"] += int(r.lenq_c or 0)
        p["lenq_v"] += float(r.lenq_v or 0.0)
        p["lpipe_c"] += int(r.lpipe_c or 0)
        p["lpipe_v"] += float(r.lpipe_v or 0.0)

    # Conversions for Lead Performance Table
    conv_params = {"sd": from_date, "ed": to_date, "usr": effective_user}
    bc_conv_filter = " WHERE docstatus < 2 AND status IN ('Converted to Lead', 'Existing Customer') "
    lead_conv_filter = " WHERE docstatus < 2 AND custom_lead_category = 'Order' "
    if effective_user:
        bc_conv_filter += " AND assign_to = %(usr)s "
        lead_conv_filter += " AND lead_owner = %(usr)s "
    if from_date and to_date:
        bc_conv_filter += f" AND ({contact_action_date}) BETWEEN %(sd)s AND %(ed)s "
        lead_conv_filter += f" AND ({lead_action_date}) BETWEEN %(sd)s AND %(ed)s "

    bc_conversions = frappe.db.sql(f"""
        SELECT {p_label_cont} as label, {p_sort_cont} as f_sort, DATE_FORMAT(({contact_action_date}), '%%Y-%%m') as ym_num, 
               MIN(DATE({contact_action_date})) as row_from_date, MAX(DATE({contact_action_date})) as row_to_date, COUNT(name) as cnt
        FROM `tabBusiness Contacts` {bc_conv_filter}
        GROUP BY {p_group_cont}
    """, conv_params, as_dict=1)

    lead_conversions = frappe.db.sql(f"""
        SELECT {p_label_lead} as label, {p_sort_lead} as f_sort, DATE_FORMAT(({lead_action_date}), '%%Y-%%m') as ym_num, 
               MIN(DATE({lead_action_date})) as row_from_date, MAX(DATE({lead_action_date})) as row_to_date, COUNT(name) as cnt
        FROM `tabLead` l
        {lead_conv_filter}
        GROUP BY {p_group_lead}
    """, conv_params, as_dict=1)

    for c in bc_conversions:
        key = c.label
        if key not in lead_period_map:
            lead_period_map[key] = {
                "label": key, "f_sort": str(c.f_sort), "m_num": str(c.ym_num or c.label or ''),
                "row_from_date": str(c.row_from_date) if c.row_from_date else '',
                "row_to_date": str(c.row_to_date) if c.row_to_date else '',
                "enq_c": 0, "enq_v": 0.0, "pipe_c": 0, "pipe_v": 0.0, "ord_c": 0, "ord_v": 0.0,
                "lenq_c": 0, "lenq_v": 0.0, "lpipe_c": 0, "lpipe_v": 0.0,
                "conv_bc_to_lead": 0, "conv_lead_to_order": 0, "convert_to": 0
            }
        lead_period_map[key]["conv_bc_to_lead"] += int(c.cnt or 0)
        lead_period_map[key]["convert_to"] += int(c.cnt or 0)

    for c in lead_conversions:
        key = c.label
        if key not in lead_period_map:
            lead_period_map[key] = {
                "label": key, "f_sort": str(c.f_sort), "m_num": str(c.ym_num or c.label or ''),
                "row_from_date": str(c.row_from_date) if c.row_from_date else '',
                "row_to_date": str(c.row_to_date) if c.row_to_date else '',
                "enq_c": 0, "enq_v": 0.0, "pipe_c": 0, "pipe_v": 0.0, "ord_c": 0, "ord_v": 0.0,
                "lenq_c": 0, "lenq_v": 0.0, "lpipe_c": 0, "lpipe_v": 0.0,
                "conv_bc_to_lead": 0, "conv_lead_to_order": 0, "convert_to": 0
            }
        lead_period_map[key]["conv_lead_to_order"] += int(c.cnt or 0)
        lead_period_map[key]["convert_to"] += int(c.cnt or 0)

    sorted_leads = sorted(lead_period_map.values(), key=lambda x: x["f_sort"])

    # 3. Contact Breakup Data
    contacts_data = frappe.db.sql(f"""
        SELECT 
            {p_label_cont} as label,
            {p_sort_cont} as f_sort,
            DATE_FORMAT(({contact_action_date}), '%%Y-%%m') as ym_num,
            MONTH({contact_action_date}) as m_num,
            MIN(DATE({contact_action_date})) as row_from_date,
            MAX(DATE({contact_action_date})) as row_to_date,
            SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) as o,
            SUM(CASE WHEN status = 'Converted to Lead' THEN 1 ELSE 0 END) as c,
            SUM(CASE WHEN status = 'Existing Customer' THEN 1 ELSE 0 END) as e
        FROM `tabBusiness Contacts`
        {where_cont}
        GROUP BY {p_group_cont} ORDER BY f_sort ASC
    """, params, as_dict=1)

    sorted_contacts = []
    for r in contacts_data:
        sorted_contacts.append({
            "label": r.label, "f_sort": str(r.f_sort), "m_num": str(r.ym_num or r.label or ''),
            "row_from_date": str(r.row_from_date) if r.row_from_date else '',
            "row_to_date": str(r.row_to_date) if r.row_to_date else '',
            "o": int(r.o or 0), "c": int(r.c or 0), "e": int(r.e or 0)
        })

    # Calculate Totals
    lt = {"enq_c": 0, "enq_v": 0.0, "pipe_c": 0, "pipe_v": 0.0, "ord_c": 0, "ord_v": 0.0, "lenq_c": 0, "lenq_v": 0.0, "lpipe_c": 0, "lpipe_v": 0.0, "conv_bc_to_lead": 0, "conv_lead_to_order": 0, "convert_to": 0}
    for l in sorted_leads:
        lt["enq_c"] += l["enq_c"]
        lt["enq_v"] += l["enq_v"]
        lt["pipe_c"] += l["pipe_c"]
        lt["pipe_v"] += l["pipe_v"]
        lt["ord_c"] += l["ord_c"]
        lt["ord_v"] += l["ord_v"]
        lt["lenq_c"] += l["lenq_c"]
        lt["lenq_v"] += l["lenq_v"]
        lt["lpipe_c"] += l["lpipe_c"]
        lt["lpipe_v"] += l["lpipe_v"]
        lt["conv_bc_to_lead"] += l["conv_bc_to_lead"]
        lt["conv_lead_to_order"] += l["conv_lead_to_order"]
        lt["convert_to"] += l["convert_to"]

    # Calculate active lead category totals directly from tabLead
    where_lead_creation = f" AND ({lead_action_date}) BETWEEN %(sd)s AND %(ed)s " if (from_date and to_date) else ""
    active_lead_counts = frappe.db.sql(f"""
        SELECT 
            SUM(CASE WHEN l.custom_lead_category = 'Enquiry' THEN 1 ELSE 0 END) as enq_c,
            SUM(CASE WHEN l.custom_lead_category = 'Enquiry' THEN COALESCE(l.custom_expected_revenue, 0) ELSE 0 END) as enq_v,
            SUM(CASE WHEN l.custom_lead_category = 'Pipeline' THEN 1 ELSE 0 END) as pipe_c,
            SUM(CASE WHEN l.custom_lead_category = 'Pipeline' THEN COALESCE(l.custom_expected_revenue, 0) ELSE 0 END) as pipe_v,
            SUM(CASE WHEN l.custom_lead_category = 'Order' THEN 1 ELSE 0 END) as ord_c,
            SUM(CASE WHEN l.custom_lead_category = 'Order' THEN COALESCE(l.custom_po_value, l.custom_expected_revenue, 0) ELSE 0 END) as ord_v,
            SUM(CASE WHEN l.custom_lead_category = 'Lost Enquiry' THEN 1 ELSE 0 END) as lenq_c,
            SUM(CASE WHEN l.custom_lead_category = 'Lost Enquiry' THEN COALESCE(l.custom_expected_revenue, 0) ELSE 0 END) as lenq_v,
            SUM(CASE WHEN l.custom_lead_category = 'Lost Pipeline' THEN 1 ELSE 0 END) as lpipe_c,
            SUM(CASE WHEN l.custom_lead_category = 'Lost Pipeline' THEN COALESCE(l.custom_expected_revenue, 0) ELSE 0 END) as lpipe_v
        FROM `tabLead` l
        {where_lead}{where_lead_creation}
    """, params, as_dict=1)

    if active_lead_counts:
        alc = active_lead_counts[0]
        lt["enq_c"] = int(alc.get("enq_c") or 0)
        lt["enq_v"] = float(alc.get("enq_v") or 0.0)
        lt["pipe_c"] = int(alc.get("pipe_c") or 0)
        lt["pipe_v"] = float(alc.get("pipe_v") or 0.0)
        lt["ord_c"] = int(alc.get("ord_c") or 0)
        lt["ord_v"] = float(alc.get("ord_v") or 0.0)
        lt["lenq_c"] = int(alc.get("lenq_c") or 0)
        lt["lenq_v"] = float(alc.get("lenq_v") or 0.0)
        lt["lpipe_c"] = int(alc.get("lpipe_c") or 0)
        lt["lpipe_v"] = float(alc.get("lpipe_v") or 0.0)

    ct = {"o": 0, "c": 0, "e": 0}
    for c in sorted_contacts:
        ct["o"] += c["o"]
        ct["c"] += c["c"]
        ct["e"] += c["e"]

    return {
        "leads": sorted_leads,
        "lead_totals": lt,
        "contacts": sorted_contacts,
        "contact_totals": ct
    }

@frappe.whitelist()
def get_event_activity_breakup_data(from_date=None, to_date=None, user=None, period_type="monthly", reference_type="All", activity_basis="completed", fiscal_year=None, period=None, month=None, **kwargs):
    from_date, to_date = parse_period_and_dates(period, fiscal_year, from_date, to_date, month=month or kwargs.get("month"))

    is_head = "DAC CRM Head" in frappe.get_roles()
    effective_user = user if (is_head and user) else (None if (is_head and not user) else frappe.session.user)

    params = {"sd": from_date, "ed": to_date, "usr": effective_user}
    
    # Fetch all distinct non-empty categories from tabEvent Activity
    cat_docs = frappe.db.sql("""
        SELECT DISTINCT category 
        FROM `tabEvent Activity` 
        WHERE docstatus < 2 AND category IS NOT NULL AND category != ''
        ORDER BY category ASC
    """, as_dict=1)
    categories = [c.category for c in cat_docs]

    # Filter String building
    base_filter = " WHERE docstatus < 2 "
    if effective_user:
        base_filter += " AND assigned_to = %(usr)s "
    if reference_type and reference_type != "All":
        base_filter += " AND reference_type = %(ref_type)s "
        params["ref_type"] = reference_type

    cp_filter = base_filter + " AND status = 'Completed' "
    if from_date and to_date:
        cp_filter += " AND DATE(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified)) BETWEEN %(sd)s AND %(ed)s "

    if period_type == "daily":
        cp_group = "DATE(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified))"
        cp_label = "DATE_FORMAT(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified), '%%d-%%b-%%Y')"
        cp_sort = "DATE(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified))"
    elif period_type == "weekly":
        cp_group = "YEAR(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified)), WEEK(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified), 1)"
        cp_label = "CONCAT('Week ', WEEK(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified), 1), ' (', DATE_FORMAT(MIN(DATE_SUB(DATE(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified)), INTERVAL WEEKDAY(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified)) DAY)), '%%d-%%b-%%Y (%%a)'), ' to ', DATE_FORMAT(MIN(DATE_ADD(DATE_SUB(DATE(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified)), INTERVAL WEEKDAY(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified)) DAY), INTERVAL 6 DAY)), '%%d-%%b-%%Y (%%a)'), ')')"
        cp_sort = "CONCAT(YEAR(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified)), '-', LPAD(WEEK(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified)), 2, '0'))"
    else:
        cp_group = "YEAR(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified)), MONTH(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified))"
        cp_label = "CONCAT(MONTHNAME(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified)), ' ', YEAR(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified)))"
        cp_sort = "CONCAT(YEAR(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified)), '-', LPAD(MONTH(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified)), 2, '0'))"

    cat_case_parts = []
    for idx, cat in enumerate(categories):
        params[f"cat_{idx}"] = cat
        cat_case_parts.append(f"SUM(CASE WHEN category = %(cat_{idx})s THEN 1 ELSE 0 END) as cat_{idx}_total")
        cat_case_parts.append(f"SUM(CASE WHEN category = %(cat_{idx})s AND reference_type = 'Lead' THEN 1 ELSE 0 END) as cat_{idx}_lead")
        cat_case_parts.append(f"SUM(CASE WHEN category = %(cat_{idx})s AND reference_type = 'Business Contacts' THEN 1 ELSE 0 END) as cat_{idx}_cont")

    cat_case_parts.append("SUM(CASE WHEN reference_type = 'Lead' THEN 1 ELSE 0 END) as lead_cnt")
    cat_case_parts.append("SUM(CASE WHEN reference_type = 'Business Contacts' THEN 1 ELSE 0 END) as contact_cnt")
    cat_case_parts.append("COUNT(name) as total_activities")
    cat_case_parts.append("MIN(DATE(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified))) as row_from_date")
    cat_case_parts.append("MAX(DATE(COALESCE(ends_on, actual_checked_out_at, actual_visit_at, modified))) as row_to_date")

    cat_case_sql = ",\n".join(cat_case_parts)

    cp_activities = frappe.db.sql(f"""
        SELECT {cp_label} as period_label, {cp_sort} as sort_key, {cat_case_sql}
        FROM `tabEvent Activity` {cp_filter}
        GROUP BY {cp_group} ORDER BY sort_key ASC
    """, params, as_dict=1)

    activities = []
    category_totals = {c: {"total": 0, "lead": 0, "cont": 0} for c in categories}
    overall_total = 0
    overall_lead = 0
    overall_cont = 0

    for row in cp_activities:
        act_row = {
            "period_label": row.period_label,
            "sort_key": str(row.sort_key),
            "row_from_date": str(row.row_from_date) if row.row_from_date else "",
            "row_to_date": str(row.row_to_date) if row.row_to_date else "",
            "lead_cnt": int(row.lead_cnt or 0),
            "contact_cnt": int(row.contact_cnt or 0),
            "total_completed": int(row.total_activities or 0),
            "categories": {}
        }
        overall_total += act_row["total_completed"]
        overall_lead += act_row["lead_cnt"]
        overall_cont += act_row["contact_cnt"]

        for idx, cat in enumerate(categories):
            tot = int(row.get(f"cat_{idx}_total") or 0)
            ld = int(row.get(f"cat_{idx}_lead") or 0)
            ct = int(row.get(f"cat_{idx}_cont") or 0)

            act_row["categories"][cat] = {
                "total": tot,
                "lead": ld,
                "cont": ct
            }
            category_totals[cat]["total"] += tot
            category_totals[cat]["lead"] += ld
            category_totals[cat]["cont"] += ct

        activities.append(act_row)

    # 5 Specific Event Activity Number Card calculations
    today_str = frappe.utils.today()
    user_cond_ea = " AND assigned_to = %(usr)s " if effective_user else ""
    user_cond_lead = " AND l.lead_owner = %(usr)s " if effective_user else ""
    user_cond_cont = " AND assign_to = %(usr)s " if effective_user else ""
    
    date_cond_ea = " AND DATE(COALESCE(ends_on, modified)) BETWEEN %(sd)s AND %(ed)s " if (from_date and to_date) else ""
    date_cond_lead = " AND DATE(l.creation) BETWEEN %(sd)s AND %(ed)s " if (from_date and to_date) else ""
    date_cond_cont = " AND DATE(creation) BETWEEN %(sd)s AND %(ed)s " if (from_date and to_date) else ""
    
    ref_cond_ea = ""
    if reference_type == "Lead":
        ref_cond_ea = " AND reference_type = 'Lead' "
    elif reference_type == "Business Contacts":
        ref_cond_ea = " AND reference_type = 'Business Contacts' "

    overdue_count = frappe.db.sql(f"""
        SELECT COUNT(name) FROM `tabEvent Activity`
        WHERE docstatus < 2 AND status = 'Open'
          AND (
            (ends_on IS NOT NULL AND DATE(ends_on) < '{today_str}')
            OR (ends_on IS NULL AND starts_on IS NOT NULL AND DATE(starts_on) < '{today_str}')
          ) {user_cond_ea}{ref_cond_ea}
    """, params)[0][0] or 0

    today_count = frappe.db.sql(f"""
        SELECT COUNT(name) FROM `tabEvent Activity`
        WHERE docstatus < 2 AND status = 'Open'
          AND (
            (ends_on IS NOT NULL AND DATE(ends_on) >= '{today_str}')
            OR (ends_on IS NULL AND starts_on IS NOT NULL AND DATE(starts_on) >= '{today_str}')
          ) {user_cond_ea}{date_cond_ea}{ref_cond_ea}
    """, params)[0][0] or 0

    open_total_count = frappe.db.sql(f"""
        SELECT COUNT(name) FROM `tabEvent Activity`
        WHERE docstatus < 2 AND status = 'Open' {user_cond_ea}{date_cond_ea}{ref_cond_ea}
    """, params)[0][0] or 0

    lead_noact_count = 0
    if reference_type in ("All", "Lead"):
        lead_noact_count = frappe.db.sql(f"""
            SELECT COUNT(l.name) FROM `tabLead` l
            WHERE l.docstatus < 2
            AND l.name NOT IN (SELECT DISTINCT reference_name FROM `tabEvent Activity` WHERE reference_type = 'Lead' AND docstatus < 2)
            {user_cond_lead} {date_cond_lead}
        """, params)[0][0] or 0

    cont_noact_count = 0
    if reference_type in ("All", "Business Contacts"):
        cont_noact_count = frappe.db.sql(f"""
            SELECT COUNT(name) FROM `tabBusiness Contacts`
            WHERE docstatus < 2
            AND name NOT IN (SELECT DISTINCT reference_name FROM `tabEvent Activity` WHERE reference_type = 'Business Contacts' AND docstatus < 2)
            {user_cond_cont} {date_cond_cont}
        """, params)[0][0] or 0

    return {
        "categories": categories,
        "activities": activities,
        "totals": {
            "category_totals": category_totals,
            "total_completed": overall_total,
            "cp_lead_cnt": overall_lead,
            "cp_contact_cnt": overall_cont,
            "overdue_count": overdue_count,
            "today_count": today_count,
            "open_total_count": open_total_count,
            "lead_noact_count": lead_noact_count,
            "cont_noact_count": cont_noact_count
        }
    }


@frappe.whitelist()
def get_card_detail_records(card_type, from_date=None, to_date=None, user=None, industry=None, fiscal_year=None, period=None, month=None, **kwargs):
    """Return list of records for a dashboard number-card drilldown modal with 100% exact count parity and rich details."""
    from_date, to_date = parse_period_and_dates(period, fiscal_year, from_date, to_date, month=month or kwargs.get("month"))

    is_head = "DAC CRM Head" in frappe.get_roles()
    effective_user = user if (is_head and user) else (None if (is_head and not user) else frappe.session.user)

    params = {"sd": from_date, "ed": to_date, "usr": effective_user, "ind": industry}
    contact_action_date = """
        CASE
            WHEN status = 'Open' THEN DATE(creation)
            ELSE DATE(modified)
        END
    """
    date_cond_cont = f" AND ({contact_action_date}) BETWEEN %(sd)s AND %(ed)s " if (from_date and to_date) else ""
    user_cond_lead = " AND l.lead_owner = %(usr)s " if effective_user else ""
    user_cond_cont = " AND assign_to = %(usr)s " if effective_user else ""
    ind_cond_lead  = " AND l.industry = %(ind)s " if industry else ""
    ind_cond_cont  = " AND industry = %(ind)s " if industry else ""

    records = []

    # ---- CONTACT cards ----
    if card_type in ("c_open", "c_conv", "c_exist", "conv_bc"):
        status_cond = " status = 'Open' " if card_type == "c_open" else (
            " status = 'Converted to Lead' " if card_type == "c_conv" else (
                " status = 'Existing Customer' " if card_type == "c_exist" else (
                    " status IN ('Converted to Lead', 'Existing Customer') "
                )
            )
        )
        records = frappe.db.sql(f"""
            SELECT name, contact_name, COALESCE(organization_name, contact_name) as company,
                   mobile_number as mobile_no, email_id, industry, status, assign_to as owner,
                   city, country, DATE_FORMAT(creation,'%%d-%%b-%%Y') as created_on,
                   DATEDIFF(NOW(), creation) as age_days,
                   DATE_FORMAT(next_follow_up_date,'%%d-%%b-%%Y') as next_followup,
                   last_completion_notes,
                   (SELECT COUNT(q.name) FROM `tabQuotation` q
                    WHERE q.docstatus < 2 AND (q.party_name = lead_id OR q.custom_lead_id = lead_id)) as quotation_count
            FROM `tabBusiness Contacts`
            WHERE docstatus < 2 AND {status_cond}
            {user_cond_cont}{ind_cond_cont}{date_cond_cont}
            ORDER BY creation DESC LIMIT 1000
        """, params, as_dict=1)
        for r in records:
            r["doctype"] = "Business Contacts"

    # ---- LEAD cards ----
    elif card_type in ("l_enq", "l_pipe", "l_ord", "l_lenq", "l_lpipe", "conv_lead"):
        cat_map = {
            "l_enq": "Enquiry",
            "l_pipe": "Pipeline",
            "l_ord": "Order",
            "l_lenq": "Lost Enquiry",
            "l_lpipe": "Lost Pipeline",
            "conv_lead": "Order"
        }
        cat = cat_map[card_type]
        params["cat"] = cat

        lead_action_date = """
            CASE
                WHEN l.custom_lead_category = 'Enquiry' THEN DATE(l.creation)
                ELSE COALESCE(
                    (SELECT DATE(MAX(sh.updated_at)) FROM `tabLead Status Change History` sh
                     WHERE sh.parent = l.name AND sh.new_status = l.custom_lead_category),
                    DATE(l.creation)
                )
            END
        """
        if from_date and to_date:
            lead_date_cond = f" AND ({lead_action_date}) BETWEEN %(sd)s AND %(ed)s "
        else:
            lead_date_cond = ""

        records = frappe.db.sql(f"""
            SELECT l.name, l.lead_name, l.company_name as company,
                   l.mobile_no, l.email_id, l.industry,
                   l.custom_lead_category as category, l.lead_owner as owner,
                   COALESCE(l.custom_po_value, l.custom_expected_revenue, 0) as po_value,
                   COALESCE(l.custom_expected_revenue, 0) as expected_revenue,
                   l.territory, l.city, l.state, l.country, l.source,
                   l.custom_lead_type, DATE_FORMAT(l.custom_expected_closure_date,'%%d-%%b-%%Y') as expected_close,
                   DATE_FORMAT(l.creation,'%%d-%%b-%%Y') as created_on,
                   DATEDIFF(NOW(), l.creation) as age_days,
                   DATE_FORMAT(l.custom_next_followup_date,'%%d-%%b-%%Y') as next_followup,
                   (SELECT notes FROM `tabEvent Activity`
                    WHERE reference_type = 'Lead' AND reference_name = l.name AND status = 'Completed' AND docstatus < 2
                    ORDER BY ends_on DESC LIMIT 1) as last_completed_notes,
                   (SELECT COUNT(q.name) FROM `tabQuotation` q
                    WHERE q.docstatus < 2 AND (q.party_name = l.name OR q.custom_lead_id = l.name)) as quotation_count,
                   l.custom_expected_closure_date as closure_date
            FROM `tabLead` l
            WHERE l.docstatus < 2
              AND l.custom_lead_category = %(cat)s
              {user_cond_lead}{ind_cond_lead}{lead_date_cond}
            ORDER BY l.creation DESC LIMIT 1000
        """, params, as_dict=1)
        for r in records:
            r["doctype"] = "Lead"

    # ---- ACTIVITY cards ----
    elif card_type in ("ea_overdue", "ea_today", "ea_lead_noact", "ea_cont_noact", "ea_open"):
        today_str = frappe.utils.today()
        date_cond_lead = " AND DATE(l.creation) BETWEEN %(sd)s AND %(ed)s " if (from_date and to_date) else ""
        date_cond_cont = " AND DATE(bc.creation) BETWEEN %(sd)s AND %(ed)s " if (from_date and to_date) else ""

        reference_type = kwargs.get("reference_type", "All")
        ref_cond_ea = ""
        if reference_type == "Lead":
            ref_cond_ea = " AND ea.reference_type = 'Lead' "
        elif reference_type == "Business Contacts":
            ref_cond_ea = " AND ea.reference_type = 'Business Contacts' "

        if card_type in ("ea_overdue", "ea_today", "ea_open"):
            if card_type == "ea_overdue":
                date_cond_ea = ""
                date_cond = f""" AND ea.status = 'Open' AND (
                    (ea.ends_on IS NOT NULL AND DATE(ea.ends_on) < '{today_str}')
                    OR (ea.ends_on IS NULL AND ea.starts_on IS NOT NULL AND DATE(ea.starts_on) < '{today_str}')
                ) """
            elif card_type == "ea_today":
                date_cond_ea = " AND DATE(COALESCE(ea.ends_on, ea.modified)) BETWEEN %(sd)s AND %(ed)s " if (from_date and to_date) else ""
                date_cond = f""" AND ea.status = 'Open' AND (
                    (ea.ends_on IS NOT NULL AND DATE(ea.ends_on) >= '{today_str}')
                    OR (ea.ends_on IS NULL AND ea.starts_on IS NOT NULL AND DATE(ea.starts_on) >= '{today_str}')
                ) """
            else:
                date_cond_ea = " AND DATE(COALESCE(ea.ends_on, ea.modified)) BETWEEN %(sd)s AND %(ed)s " if (from_date and to_date) else ""
                date_cond = " AND ea.status = 'Open' "

            user_cond_ea = " AND ea.assigned_to = %(usr)s " if effective_user else ""
            records = frappe.db.sql(f"""
                SELECT ea.name, ea.subject, ea.category, ea.reference_type, ea.reference_name,
                       ea.assigned_to as owner, ea.status, ea.description, ea.notes,
                       ea.starts_on,
                       DATE_FORMAT(ea.starts_on,'%%d-%%b-%%Y %%h:%%i %%p') as start_date,
                       DATE_FORMAT(ea.ends_on,'%%d-%%b-%%Y %%h:%%i %%p') as end_date,
                       CASE
                           WHEN ea.reference_type = 'Lead' THEN l.lead_name
                           WHEN ea.reference_type = 'Business Contacts' THEN COALESCE(bc.organization_name, bc.contact_name)
                           ELSE COALESCE(ea.reference_doc_name, ea.reference_name)
                       END as ref_display_name,
                       CASE
                           WHEN ea.reference_type = 'Lead' THEN l.company_name
                           WHEN ea.reference_type = 'Business Contacts' THEN bc.organization_name
                           ELSE ''
                       END as ref_extra,
                       CASE
                           WHEN ea.reference_type = 'Lead' THEN l.mobile_no
                           WHEN ea.reference_type = 'Business Contacts' THEN bc.mobile_number
                           ELSE ''
                       END as ref_mobile,
                       CASE
                           WHEN ea.reference_type = 'Lead' THEN l.email_id
                           WHEN ea.reference_type = 'Business Contacts' THEN bc.email_id
                           ELSE ''
                       END as ref_email
                FROM `tabEvent Activity` ea
                LEFT JOIN `tabLead` l ON l.name = ea.reference_name AND ea.reference_type = 'Lead'
                LEFT JOIN `tabBusiness Contacts` bc ON bc.name = ea.reference_name AND ea.reference_type = 'Business Contacts'
                WHERE ea.docstatus < 2 {user_cond_ea}{date_cond}{date_cond_ea}{ref_cond_ea}
                ORDER BY ea.ends_on ASC LIMIT 1000
            """, params, as_dict=1)
            for r in records:
                r["doctype"] = "Event Activity"

        elif card_type == "ea_lead_noact":
            if reference_type in ("All", "Lead"):
                records = frappe.db.sql(f"""
                    SELECT l.name, l.lead_name, l.company_name as company, l.mobile_no, l.email_id, l.industry,
                           l.custom_lead_category as category, l.lead_owner as owner,
                           COALESCE(l.custom_expected_revenue, 0) as expected_revenue,
                           l.source, l.custom_lead_type, DATE_FORMAT(l.custom_expected_closure_date,'%%d-%%b-%%Y') as expected_close,
                           DATE_FORMAT(l.creation,'%%d-%%b-%%Y') as created_on,
                           DATEDIFF(NOW(), l.creation) as age_days,
                           DATE_FORMAT(l.custom_next_followup_date,'%%d-%%b-%%Y') as next_followup,
                           (SELECT notes FROM `tabEvent Activity`
                            WHERE reference_type = 'Lead' AND reference_name = l.name AND status = 'Completed' AND docstatus < 2
                            ORDER BY ends_on DESC LIMIT 1) as last_completed_notes,
                           (SELECT COUNT(q.name) FROM `tabQuotation` q
                            WHERE q.docstatus < 2 AND (q.party_name = l.name OR q.custom_lead_id = l.name)) as quotation_count,
                           l.custom_expected_closure_date as closure_date
                    FROM `tabLead` l
                    WHERE l.docstatus < 2
                      AND l.name NOT IN (SELECT DISTINCT reference_name FROM `tabEvent Activity` WHERE reference_type = 'Lead' AND docstatus < 2)
                    {user_cond_lead}{date_cond_lead}
                    ORDER BY l.creation DESC LIMIT 1000
                """, params, as_dict=1)
                for r in records:
                    r["doctype"] = "Lead"
            else:
                records = []

        elif card_type == "ea_cont_noact":
            if reference_type in ("All", "Business Contacts"):
                records = frappe.db.sql(f"""
                    SELECT bc.name, bc.contact_name, COALESCE(bc.organization_name, bc.contact_name) as company,
                           bc.mobile_number as mobile_no, bc.email_id, bc.industry, bc.status, bc.assign_to as owner,
                           bc.city, bc.country, DATE_FORMAT(bc.creation,'%%d-%%b-%%Y') as created_on,
                           DATEDIFF(NOW(), bc.creation) as age_days,
                           DATE_FORMAT(bc.next_follow_up_date,'%%d-%%b-%%Y') as next_followup,
                           bc.last_completion_notes
                    FROM `tabBusiness Contacts` bc
                    WHERE bc.docstatus < 2
                      AND bc.name NOT IN (SELECT DISTINCT reference_name FROM `tabEvent Activity` WHERE reference_type = 'Business Contacts' AND docstatus < 2)
                    {user_cond_cont}{date_cond_cont}
                    ORDER BY bc.creation DESC LIMIT 1000
                """, params, as_dict=1)
                for r in records:
                    r["doctype"] = "Business Contacts"
            else:
                records = []

    return {"records": records, "card_type": card_type}


@frappe.whitelist()
def get_activity_detail_records(category=None, category_group=None, from_date=None, to_date=None, user=None, reference_type="All", fiscal_year=None, period=None, month=None, **kwargs):
    """Return Event Activity records for a specific category drilldown modal with exact date matching and rich details."""
    from_date, to_date = parse_period_and_dates(period, fiscal_year, from_date, to_date, month=month or kwargs.get("month"))

    is_head = "DAC CRM Head" in frappe.get_roles()
    effective_user = user if (is_head and user) else (None if (is_head and not user) else frappe.session.user)

    cat_name = category or category_group

    params = {"sd": from_date, "ed": to_date, "usr": effective_user}

    base_filter = " WHERE ea.docstatus < 2 AND ea.status = 'Completed' "
    if effective_user:
        base_filter += " AND ea.assigned_to = %(usr)s "
    if reference_type and reference_type != "All":
        params["ref_type"] = reference_type
        base_filter += " AND ea.reference_type = %(ref_type)s "

    if from_date and to_date:
        base_filter += " AND DATE(COALESCE(ea.ends_on, ea.actual_checked_out_at, ea.actual_visit_at, ea.modified)) BETWEEN %(sd)s AND %(ed)s "

    if cat_name and cat_name != "All":
        params["cat"] = cat_name
        base_filter += " AND ea.category = %(cat)s "

    records = frappe.db.sql(f"""
        SELECT ea.name, ea.subject, ea.category, ea.reference_type, ea.reference_name,
               ea.assigned_to as owner, ea.status, ea.description, ea.notes,
               ea.starts_on,
               DATE_FORMAT(ea.starts_on,'%%d-%%b-%%Y %%h:%%i %%p') as start_date,
               DATE_FORMAT(COALESCE(ea.ends_on, ea.modified),'%%d-%%b-%%Y %%h:%%i %%p') as end_date,
               CASE
                   WHEN ea.reference_type = 'Lead' THEN l.lead_name
                   WHEN ea.reference_type = 'Business Contacts' THEN COALESCE(bc.organization_name, bc.contact_name)
                   ELSE COALESCE(ea.reference_doc_name, ea.reference_name)
               END as ref_display_name,
               CASE
                   WHEN ea.reference_type = 'Lead' THEN l.company_name
                   WHEN ea.reference_type = 'Business Contacts' THEN bc.organization_name
                   ELSE ''
               END as ref_extra,
               CASE
                   WHEN ea.reference_type = 'Lead' THEN l.mobile_no
                   WHEN ea.reference_type = 'Business Contacts' THEN bc.mobile_number
                   ELSE ''
               END as ref_mobile,
               CASE
                   WHEN ea.reference_type = 'Lead' THEN l.email_id
                   WHEN ea.reference_type = 'Business Contacts' THEN bc.email_id
                   ELSE ''
               END as ref_email
        FROM `tabEvent Activity` ea
        LEFT JOIN `tabLead` l ON l.name = ea.reference_name AND ea.reference_type = 'Lead'
        LEFT JOIN `tabBusiness Contacts` bc ON bc.name = ea.reference_name AND ea.reference_type = 'Business Contacts'
        {base_filter}
        ORDER BY ea.ends_on DESC LIMIT 1000
    """, params, as_dict=1)

    for r in records:
        r["doctype"] = "Event Activity"

    return {"records": records, "category": cat_name}


@frappe.whitelist()
def export_crm_dashboard_excel(
    c_user=None, c_fiscal_year=None, c_industry=None, c_period_type="monthly", c_from_date=None, c_to_date=None, c_month=None, c_period=None,
    l_user=None, l_fiscal_year=None, l_industry=None, l_period_type="monthly", l_from_date=None, l_to_date=None, l_month=None, l_period=None,
    t_fiscal_year=None,
    ea_user=None, ea_fiscal_year=None, ea_period_type="monthly", ea_entity="All", ea_from_date=None, ea_to_date=None, ea_month=None, ea_period=None
):
    """Export Executive CRM Analytics with applied filters into a multi-tab Excel report."""
    if "DAC CRM Head" not in frappe.get_roles(frappe.session.user):
        frappe.throw(_("Permission Denied: Only users with 'DAC CRM Head' role can export dashboard data."))
    import base64
    from io import BytesIO
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    fiscal_year = c_fiscal_year or l_fiscal_year or t_fiscal_year or ea_fiscal_year
    if not fiscal_year:
        fy_doc = frappe.db.get_value("Fiscal Year", {"disabled": 0}, "name", order_by="year_start_date desc")
        fiscal_year = fy_doc if fy_doc else "2025-2026"

    wb = openpyxl.Workbook()
    
    # 1. Fonts and Styles
    title_font = Font(name="Arial", size=13, bold=True, color="FFFFFF")
    section_font = Font(name="Arial", size=11, bold=True, color="1E3A8A")
    header_font = Font(name="Arial", size=9, bold=True, color="FFFFFF")
    data_font = Font(name="Arial", size=9, color="1E293B")
    link_font = Font(name="Arial", size=9, color="0563C1", underline="single")
    total_font = Font(name="Arial", size=9, bold=True, color="1E293B")

    title_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid") # premium slate
    header_fill = PatternFill(start_color="3498DB", end_color="3498DB", fill_type="solid") # CRM theme blue
    total_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    section_hdr_fill = PatternFill(start_color="EFF6FF", end_color="EFF6FF", fill_type="solid")

    thin_border = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )

    def style_row(ws, row, start_col, end_col, font, fill=None, border=thin_border, alignment=None):
        for col in range(start_col, end_col + 1):
            cell = ws.cell(row=row, column=col)
            cell.font = font
            if fill:
                cell.fill = fill
            if border:
                cell.border = border
            if alignment:
                cell.alignment = alignment

    # Tab 1: Overall CRM Summary
    ws_sum = wb.active
    ws_sum.title = "Overall Summary"
    ws_sum.views.sheetView[0].showGridLines = True

    ws_sum.merge_cells('A1:L1')
    ws_sum['A1'] = f"CRM OVERALL EXEC SUMMARY — Generated on {frappe.utils.today()}"
    ws_sum['A1'].font = title_font
    ws_sum['A1'].fill = title_fill
    ws_sum['A1'].alignment = Alignment(horizontal='left', vertical='center', indent=1)
    ws_sum.row_dimensions[1].height = 35

    curr_row = 3

    # Section 1.1: Weekly Breakup of Leads
    ws_sum.cell(row=curr_row, column=1, value="1. Weekly Lead & Contact Breakup (Overall)").font = section_font
    curr_row += 1
    
    overall_tab_data = get_tabular_dashboard_data(fiscal_year=fiscal_year, period_type="weekly")
    headers_weekly = [
        "Period", "Open Contacts", "Converted to Lead", "Existing Customer", 
        "Enquiry (Count / Value)", "Pipeline (Count / Value)", "Order (Count / Value)", 
        "Lost Enquiry", "Lost Pipeline", "Contact->Lead", "Lead->Order", "Total Converted"
    ]
    for col_idx, h in enumerate(headers_weekly, 1):
        cell = ws_sum.cell(row=curr_row, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.border = thin_border
        cell.alignment = Alignment(horizontal='right' if col_idx > 1 else 'left', vertical='center', wrap_text=True)
    ws_sum.row_dimensions[curr_row].height = 25
    curr_row += 1

    for row in overall_tab_data.get("leads", []):
        lbl = row.get("label", "")
        # Find matching contact row
        c_row = next((cr for cr in overall_tab_data.get("contacts", []) if cr.get("label") == lbl), {})
        
        ws_sum.cell(row=curr_row, column=1, value=lbl).font = data_font
        ws_sum.cell(row=curr_row, column=2, value=c_row.get("o", 0)).font = data_font
        ws_sum.cell(row=curr_row, column=3, value=c_row.get("c", 0)).font = data_font
        ws_sum.cell(row=curr_row, column=4, value=c_row.get("e", 0)).font = data_font
        
        ws_sum.cell(row=curr_row, column=5, value=f"{row.get('enq_c',0)} (₹{row.get('enq_v',0):,})").font = data_font
        ws_sum.cell(row=curr_row, column=6, value=f"{row.get('pipe_c',0)} (₹{row.get('pipe_v',0):,})").font = data_font
        ws_sum.cell(row=curr_row, column=7, value=f"{row.get('ord_c',0)} (₹{row.get('ord_v',0):,})").font = data_font
        ws_sum.cell(row=curr_row, column=8, value=f"{row.get('lenq_c',0)} (₹{row.get('lenq_v',0):,})").font = data_font
        ws_sum.cell(row=curr_row, column=9, value=f"{row.get('lpipe_c',0)} (₹{row.get('lpipe_v',0):,})").font = data_font
        
        ws_sum.cell(row=curr_row, column=10, value=row.get("conv_bc_to_lead", 0)).font = data_font
        ws_sum.cell(row=curr_row, column=11, value=row.get("conv_lead_to_order", 0)).font = data_font
        ws_sum.cell(row=curr_row, column=12, value=row.get("convert_to", 0)).font = data_font
        
        style_row(ws_sum, curr_row, 1, 12, data_font)
        curr_row += 1

    curr_row += 2

    # Section 1.2: Target vs Actual (Sales Executives)
    ws_sum.cell(row=curr_row, column=1, value="2. Target vs Actual (Sales Executive Wise)").font = section_font
    curr_row += 1
    
    fy_dates = frappe.db.get_value("Fiscal Year", fiscal_year, ["year_start_date", "year_end_date"], as_dict=1)
    t_sd = str(fy_dates.year_start_date) if fy_dates else "2025-04-01"
    t_ed = str(fy_dates.year_end_date) if fy_dates else "2026-03-31"
    
    t_overall = get_target_vs_actual(from_date=t_sd, to_date=t_ed, fiscal_year=fiscal_year)
    headers_t = ["Sales Executive", "Monthly Target (₹)", "Annual Target (₹)", "YTD Order Revenue (₹)", "YTD Variance (₹)", "YTD Achievement %"]
    for col_idx, h in enumerate(headers_t, 1):
        cell = ws_sum.cell(row=curr_row, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.border = thin_border
        cell.alignment = Alignment(horizontal='right' if col_idx > 1 else 'left')
    curr_row += 1

    t_rows = t_overall.get("data", []) if isinstance(t_overall, dict) else (t_overall or [])
    for row in t_rows:
        ws_sum.cell(row=curr_row, column=1, value=row.get("full_name")).font = data_font
        ws_sum.cell(row=curr_row, column=2, value=row.get("monthly_target", 0)).font = data_font
        ws_sum.cell(row=curr_row, column=3, value=row.get("annual_target", 0)).font = data_font
        ws_sum.cell(row=curr_row, column=4, value=row.get("actual_revenue", 0)).font = data_font
        ws_sum.cell(row=curr_row, column=5, value=row.get("overall_variance", 0)).font = data_font
        ws_sum.cell(row=curr_row, column=6, value=f"{flt(row.get('overall_achievement', 0)):.1f}%").font = data_font
        
        style_row(ws_sum, curr_row, 1, 6, data_font)
        curr_row += 1

    curr_row += 2

    # Section 1.3: Team Activity & Productivity
    ws_sum.cell(row=curr_row, column=1, value="3. Activity & Productivity Overview (Overall completed)").font = section_font
    curr_row += 1

    ea_overall = get_event_activity_breakup_data(
        period_type="weekly", reference_type="All", activity_basis="completed", fiscal_year=fiscal_year
    )
    categories = ea_overall.get("categories", [])
    if not categories:
        categories = ["Call", "Meeting", "Site Visit", "Email", "WhatsApp"]

    # Category header Row 1
    ws_sum.cell(row=curr_row, column=1, value="Period").alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    ws_sum.merge_cells(start_row=curr_row, start_column=1, end_row=curr_row+1, end_column=1)
    
    col_idx = 2
    for cat in categories:
        ws_sum.cell(row=curr_row, column=col_idx, value=cat).alignment = Alignment(horizontal='center', vertical='center')
        ws_sum.merge_cells(start_row=curr_row, start_column=col_idx, end_row=curr_row, end_column=col_idx+1)
        
        ws_sum.cell(row=curr_row+1, column=col_idx, value="Lead").alignment = Alignment(horizontal='center', vertical='center')
        ws_sum.cell(row=curr_row+1, column=col_idx+1, value="Cont").alignment = Alignment(horizontal='center', vertical='center')
        col_idx += 2
        
    ws_sum.cell(row=curr_row, column=col_idx, value="Total Lead").alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    ws_sum.merge_cells(start_row=curr_row, start_column=col_idx, end_row=curr_row+1, end_column=col_idx)
    col_idx += 1
    
    ws_sum.cell(row=curr_row, column=col_idx, value="Total Cont").alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    ws_sum.merge_cells(start_row=curr_row, start_column=col_idx, end_row=curr_row+1, end_column=col_idx)
    col_idx += 1
    
    ws_sum.cell(row=curr_row, column=col_idx, value="Grand Total").alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    ws_sum.merge_cells(start_row=curr_row, start_column=col_idx, end_row=curr_row+1, end_column=col_idx)

    style_row(ws_sum, curr_row, 1, col_idx, header_font, header_fill)
    style_row(ws_sum, curr_row+1, 1, col_idx, header_font, header_fill)
    curr_row += 2

    for row in ea_overall.get("activities", []):
        ws_sum.cell(row=curr_row, column=1, value=row.get("period_label")).font = data_font
        c_col = 2
        row_cats = row.get("categories", {})
        for cat in categories:
            c_dict = row_cats.get(cat, {})
            ws_sum.cell(row=curr_row, column=c_col, value=c_dict.get("lead", 0)).font = data_font
            c_col += 1
            ws_sum.cell(row=curr_row, column=c_col, value=c_dict.get("cont", 0)).font = data_font
            c_col += 1
        ws_sum.cell(row=curr_row, column=c_col, value=row.get("lead_cnt", 0)).font = data_font
        c_col += 1
        ws_sum.cell(row=curr_row, column=c_col, value=row.get("contact_cnt", 0)).font = data_font
        c_col += 1
        ws_sum.cell(row=curr_row, column=c_col, value=row.get("total_completed", 0)).font = data_font
        
        style_row(ws_sum, curr_row, 1, c_col, data_font)
        curr_row += 1

    curr_row += 2

    # Section 1.4: Summary of all quotations created in last 7 days
    ws_sum.cell(row=curr_row, column=1, value="4. Quotations Created in Last 7 Days (Marketing Team)").font = section_font
    curr_row += 1
    
    headers_quotes = [
        "S.No", "Quotation ID", "Created Date", "Sales Executive", "Party / Customer Name",
        "Lead Org Name", "Lead Source", "Lead Status", "Grand Total (₹)", "Quotation Status"
    ]
    for col_idx, h in enumerate(headers_quotes, 1):
        cell = ws_sum.cell(row=curr_row, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.border = thin_border
        cell.alignment = Alignment(horizontal='right' if col_idx == 9 else 'left')
    curr_row += 1

    all_quotes = frappe.db.sql("""
        SELECT q.name, DATE_FORMAT(q.creation, '%%d-%%b-%%Y') as created_on, q.owner, q.customer_name, q.grand_total, q.status,
               l.company_name as org_name, l.source as lead_source, l.status as lead_status,
               u.full_name as owner_name
        FROM `tabQuotation` q
        LEFT JOIN `tabLead` l ON l.name = q.party_name AND q.quotation_to = 'Lead'
        LEFT JOIN `tabUser` u ON u.name = q.owner
        WHERE q.docstatus < 2 AND q.creation >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        ORDER BY q.creation DESC
    """, as_dict=True)

    for idx, q in enumerate(all_quotes, 1):
        ws_sum.cell(row=curr_row, column=1, value=idx).font = data_font
        
        cell_qid = ws_sum.cell(row=curr_row, column=2, value=q.get("name"))
        cell_qid.font = link_font
        cell_qid.hyperlink = f"{frappe.utils.get_url()}/app/quotation/{q.get('name')}"
        
        ws_sum.cell(row=curr_row, column=3, value=q.get("created_on")).font = data_font
        ws_sum.cell(row=curr_row, column=4, value=q.get("owner_name") or q.get("owner")).font = data_font
        ws_sum.cell(row=curr_row, column=5, value=q.get("customer_name")).font = data_font
        ws_sum.cell(row=curr_row, column=6, value=q.get("org_name") or "-").font = data_font
        ws_sum.cell(row=curr_row, column=7, value=q.get("lead_source") or "-").font = data_font
        ws_sum.cell(row=curr_row, column=8, value=q.get("lead_status") or "-").font = data_font
        ws_sum.cell(row=curr_row, column=9, value=q.get("grand_total", 0)).font = data_font
        ws_sum.cell(row=curr_row, column=10, value=q.get("status")).font = data_font
        
        style_row(ws_sum, curr_row, 1, 10, data_font)
        curr_row += 1

    # Auto adjust summary sheet widths
    for col in ws_sum.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws_sum.column_dimensions[col_letter].width = max(max_len + 3, 13)

    # 2. INDIVIDUAL SALES EXECUTIVE SHEETS
    sales_persons = frappe.get_all("Sales Person", fields=["name", "sales_person_name", "employee"], filters={"enabled": 1, "is_group": 0})
    for sp in sales_persons:
        usr_id = None
        if sp.employee:
            usr_id = frappe.db.get_value("Employee", sp.employee, "user_id")
            
        if not usr_id:
            continue

        ws_ind = wb.create_sheet(title=sp.sales_person_name[:30]) # limit length
        ws_ind.views.sheetView[0].showGridLines = True
        
        ws_ind.merge_cells('A1:L1')
        ws_ind['A1'] = f"CRM ANALYTICS: {sp.sales_person_name.upper()} — Generated on {frappe.utils.today()}"
        ws_ind['A1'].font = title_font
        ws_ind['A1'].fill = title_fill
        ws_ind['A1'].alignment = Alignment(horizontal='left', vertical='center', indent=1)
        ws_ind.row_dimensions[1].height = 35
        
        i_row = 3
        
        # Section 2.1: Target vs Actual
        ws_ind.cell(row=i_row, column=1, value="1. Target vs Actual Performance (YTD)").font = section_font
        i_row += 1
        
        t_ind = get_target_vs_actual(from_date=t_sd, to_date=t_ed, fiscal_year=fiscal_year, user=usr_id)
        t_rows_ind = t_ind.get("data", []) if isinstance(t_ind, dict) else (t_ind or [])
        
        headers_t_ind = ["Sales Person", "Monthly Target (₹)", "Annual Target (₹)", "YTD Order Revenue (₹)", "YTD Variance (₹)", "YTD Achievement %"]
        for col_idx, h in enumerate(headers_t_ind, 1):
            cell = ws_ind.cell(row=i_row, column=col_idx, value=h)
            cell.font = header_font
            cell.fill = PatternFill(start_color="34495E", end_color="34495E", fill_type="solid")
            cell.border = thin_border
            cell.alignment = Alignment(horizontal='right' if col_idx > 1 else 'left')
        i_row += 1
        
        for row in t_rows_ind:
            ws_ind.cell(row=i_row, column=1, value=row.get("full_name")).font = data_font
            ws_ind.cell(row=i_row, column=2, value=row.get("monthly_target", 0)).font = data_font
            ws_ind.cell(row=i_row, column=3, value=row.get("annual_target", 0)).font = data_font
            ws_ind.cell(row=i_row, column=4, value=row.get("actual_revenue", 0)).font = data_font
            ws_ind.cell(row=i_row, column=5, value=row.get("overall_variance", 0)).font = data_font
            ws_ind.cell(row=i_row, column=6, value=f"{flt(row.get('overall_achievement', 0)):.1f}%").font = data_font
            
            style_row(ws_ind, i_row, 1, 6, data_font)
            i_row += 1
            
        i_row += 2
        
        # Section 2.2: Weekly Breakup of Leads
        ws_ind.cell(row=i_row, column=1, value="2. Weekly Lead & Contact Breakup").font = section_font
        i_row += 1
        
        ind_tab_data = get_tabular_dashboard_data(fiscal_year=fiscal_year, period_type="weekly", user=usr_id)
        for col_idx, h in enumerate(headers_weekly, 1):
            cell = ws_ind.cell(row=i_row, column=col_idx, value=h)
            cell.font = header_font
            cell.fill = header_fill
            cell.border = thin_border
            cell.alignment = Alignment(horizontal='right' if col_idx > 1 else 'left', vertical='center', wrap_text=True)
        ws_ind.row_dimensions[i_row].height = 25
        i_row += 1

        for row in ind_tab_data.get("leads", []):
            lbl = row.get("label", "")
            c_row = next((cr for cr in ind_tab_data.get("contacts", []) if cr.get("label") == lbl), {})
            
            ws_ind.cell(row=i_row, column=1, value=lbl).font = data_font
            ws_ind.cell(row=i_row, column=2, value=c_row.get("o", 0)).font = data_font
            ws_ind.cell(row=i_row, column=3, value=c_row.get("c", 0)).font = data_font
            ws_ind.cell(row=i_row, column=4, value=c_row.get("e", 0)).font = data_font
            
            ws_ind.cell(row=i_row, column=5, value=f"{row.get('enq_c',0)} (₹{row.get('enq_v',0):,})").font = data_font
            ws_ind.cell(row=i_row, column=6, value=f"{row.get('pipe_c',0)} (₹{row.get('pipe_v',0):,})").font = data_font
            ws_ind.cell(row=i_row, column=7, value=f"{row.get('ord_c',0)} (₹{row.get('ord_v',0):,})").font = data_font
            ws_ind.cell(row=i_row, column=8, value=f"{row.get('lenq_c',0)} (₹{row.get('lenq_v',0):,})").font = data_font
            ws_ind.cell(row=i_row, column=9, value=f"{row.get('lpipe_c',0)} (₹{row.get('lpipe_v',0):,})").font = data_font
            
            ws_ind.cell(row=i_row, column=10, value=row.get("conv_bc_to_lead", 0)).font = data_font
            ws_ind.cell(row=i_row, column=11, value=row.get("conv_lead_to_order", 0)).font = data_font
            ws_ind.cell(row=i_row, column=12, value=row.get("convert_to", 0)).font = data_font
            
            style_row(ws_ind, i_row, 1, 12, data_font)
            i_row += 1
            
        i_row += 2
        
        # Section 2.3: Activity & Productivity
        ws_ind.cell(row=i_row, column=1, value="3. Activity & Productivity Performance (Completed)").font = section_font
        i_row += 1
        
        ea_ind = get_event_activity_breakup_data(
            period_type="weekly", reference_type="All", activity_basis="completed", fiscal_year=fiscal_year, user=usr_id
        )
        
        # Category header
        ws_ind.cell(row=i_row, column=1, value="Period").alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        ws_ind.merge_cells(start_row=i_row, start_column=1, end_row=i_row+1, end_column=1)
        
        col_idx = 2
        for cat in categories:
            ws_ind.cell(row=i_row, column=col_idx, value=cat).alignment = Alignment(horizontal='center', vertical='center')
            ws_ind.merge_cells(start_row=i_row, start_column=col_idx, end_row=i_row, end_column=col_idx+1)
            
            ws_ind.cell(row=i_row+1, column=col_idx, value="Lead").alignment = Alignment(horizontal='center', vertical='center')
            ws_ind.cell(row=i_row+1, column=col_idx+1, value="Cont").alignment = Alignment(horizontal='center', vertical='center')
            col_idx += 2
            
        ws_ind.cell(row=i_row, column=col_idx, value="Total Lead").alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        ws_ind.merge_cells(start_row=i_row, start_column=col_idx, end_row=i_row+1, end_column=col_idx)
        col_idx += 1
        
        ws_ind.cell(row=i_row, column=col_idx, value="Total Cont").alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        ws_ind.merge_cells(start_row=i_row, start_column=col_idx, end_row=i_row+1, end_column=col_idx)
        col_idx += 1
        
        ws_ind.cell(row=i_row, column=col_idx, value="Grand Total").alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        ws_ind.merge_cells(start_row=i_row, start_column=col_idx, end_row=i_row+1, end_column=col_idx)

        style_row(ws_ind, i_row, 1, col_idx, header_font, header_fill)
        style_row(ws_ind, i_row+1, 1, col_idx, header_font, header_fill)
        i_row += 2

        for row in ea_ind.get("activities", []):
            ws_ind.cell(row=i_row, column=1, value=row.get("period_label")).font = data_font
            c_col = 2
            row_cats = row.get("categories", {})
            for cat in categories:
                c_dict = row_cats.get(cat, {})
                ws_ind.cell(row=i_row, column=c_col, value=c_dict.get("lead", 0)).font = data_font
                c_col += 1
                ws_ind.cell(row=i_row, column=c_col, value=c_dict.get("cont", 0)).font = data_font
                c_col += 1
            ws_ind.cell(row=i_row, column=c_col, value=row.get("lead_cnt", 0)).font = data_font
            c_col += 1
            ws_ind.cell(row=i_row, column=c_col, value=row.get("contact_cnt", 0)).font = data_font
            c_col += 1
            ws_ind.cell(row=i_row, column=c_col, value=row.get("total_completed", 0)).font = data_font
            
            style_row(ws_ind, i_row, 1, c_col, data_font)
            i_row += 1

        i_row += 2
        
        # Section 2.4: Quotations Created (Last 7 Days)
        ws_ind.cell(row=i_row, column=1, value="4. Quotations Created (Last 7 Days)").font = section_font
        i_row += 1
        
        headers_q_ind = ["S.No", "Quotation ID", "Date", "Customer Name", "Lead Org Name", "Lead Source", "Lead Status", "Grand Total (₹)", "Status"]
        for col_idx, h in enumerate(headers_q_ind, 1):
            cell = ws_ind.cell(row=i_row, column=col_idx, value=h)
            cell.font = header_font
            cell.fill = PatternFill(start_color="16A085", end_color="16A085", fill_type="solid")
            cell.border = thin_border
            cell.alignment = Alignment(horizontal='right' if col_idx == 8 else 'left')
        i_row += 1
        
        q_ind_rows = frappe.db.sql("""
            SELECT q.name, DATE_FORMAT(q.creation, '%%d-%%b-%%Y') as created_on, q.customer_name, q.grand_total, q.status,
                   l.company_name as org_name, l.source as lead_source, l.status as lead_status
            FROM `tabQuotation` q
            LEFT JOIN `tabLead` l ON l.name = q.party_name AND q.quotation_to = 'Lead'
            WHERE q.docstatus < 2 AND q.owner = %(usr)s AND q.creation >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY q.creation DESC
        """, {"usr": usr_id}, as_dict=True)
        
        for idx, q in enumerate(q_ind_rows, 1):
            ws_ind.cell(row=i_row, column=1, value=idx).font = data_font
            
            cell_qid = ws_ind.cell(row=i_row, column=2, value=q.get("name"))
            cell_qid.font = link_font
            cell_qid.hyperlink = f"{frappe.utils.get_url()}/app/quotation/{q.get('name')}"
            
            ws_ind.cell(row=i_row, column=3, value=q.get("created_on")).font = data_font
            ws_ind.cell(row=i_row, column=4, value=q.get("customer_name")).font = data_font
            ws_ind.cell(row=i_row, column=5, value=q.get("org_name") or "-").font = data_font
            ws_ind.cell(row=i_row, column=6, value=q.get("lead_source") or "-").font = data_font
            ws_ind.cell(row=i_row, column=7, value=q.get("lead_status") or "-").font = data_font
            ws_ind.cell(row=i_row, column=8, value=q.get("grand_total", 0)).font = data_font
            ws_ind.cell(row=i_row, column=9, value=q.get("status")).font = data_font
            
            style_row(ws_ind, i_row, 1, 9, data_font)
            i_row += 1
            
        i_row += 2

        # Section 2.5: Leads Created (Last 7 Days)
        ws_ind.cell(row=i_row, column=1, value="5. Leads Created (Last 7 Days)").font = section_font
        i_row += 1
        
        headers_l_ind = ["S.No", "Lead ID", "Lead Name", "Organization Name", "Lead Source", "Lead Status", "Expected Revenue (₹)", "Created Date"]
        for col_idx, h in enumerate(headers_l_ind, 1):
            cell = ws_ind.cell(row=i_row, column=col_idx, value=h)
            cell.font = header_font
            cell.fill = PatternFill(start_color="D35400", end_color="D35400", fill_type="solid")
            cell.border = thin_border
            cell.alignment = Alignment(horizontal='right' if col_idx == 7 else 'left')
        i_row += 1
        
        l_ind_rows = frappe.db.sql("""
            SELECT l.name, l.lead_name, l.company_name as org_name, l.source as lead_source, l.status as lead_status,
                   COALESCE(l.custom_po_value, l.custom_expected_revenue, 0) as expected_revenue,
                   DATE_FORMAT(l.creation, '%%d-%%b-%%Y') as created_on
            FROM `tabLead` l
            WHERE l.docstatus < 2 AND l.lead_owner = %(usr)s AND l.creation >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY l.creation DESC
        """, {"usr": usr_id}, as_dict=True)
        
        for idx, l in enumerate(l_ind_rows, 1):
            ws_ind.cell(row=i_row, column=1, value=idx).font = data_font
            
            cell_lid = ws_ind.cell(row=i_row, column=2, value=l.get("name"))
            cell_lid.font = link_font
            cell_lid.hyperlink = f"{frappe.utils.get_url()}/app/lead/{l.get('name')}"
            
            ws_ind.cell(row=i_row, column=3, value=l.get("lead_name")).font = data_font
            ws_ind.cell(row=i_row, column=4, value=l.get("org_name") or "-").font = data_font
            ws_ind.cell(row=i_row, column=5, value=l.get("lead_source") or "-").font = data_font
            ws_ind.cell(row=i_row, column=6, value=l.get("lead_status") or "-").font = data_font
            ws_ind.cell(row=i_row, column=7, value=l.get("expected_revenue", 0)).font = data_font
            ws_ind.cell(row=i_row, column=8, value=l.get("created_on")).font = data_font
            
            style_row(ws_ind, i_row, 1, 8, data_font)
            i_row += 1
            
        i_row += 2
        
        # Section 2.6: Contacts Created (Last 7 Days)
        ws_ind.cell(row=i_row, column=1, value="6. Contacts Created (Last 7 Days)").font = section_font
        i_row += 1
        
        headers_bc_ind = ["S.No", "Contact ID", "Contact Name", "Organization Name", "Mobile No", "Email ID", "Status", "Created Date"]
        for col_idx, h in enumerate(headers_bc_ind, 1):
            cell = ws_ind.cell(row=i_row, column=col_idx, value=h)
            cell.font = header_font
            cell.fill = PatternFill(start_color="27AE60", end_color="27AE60", fill_type="solid")
            cell.border = thin_border
        i_row += 1
        
        bc_ind_rows = frappe.db.sql("""
            SELECT bc.name, bc.contact_name, bc.organization_name as org_name, bc.mobile_number, bc.email_id, bc.status,
                   DATE_FORMAT(bc.creation, '%%d-%%b-%%Y') as created_on
            FROM `tabBusiness Contacts` bc
            WHERE bc.docstatus < 2 AND bc.assign_to = %(usr)s AND bc.creation >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY bc.creation DESC
        """, {"usr": usr_id}, as_dict=True)
        
        for idx, bc in enumerate(bc_ind_rows, 1):
            ws_ind.cell(row=i_row, column=1, value=idx).font = data_font
            
            cell_bcid = ws_ind.cell(row=i_row, column=2, value=bc.get("name"))
            cell_bcid.font = link_font
            cell_bcid.hyperlink = f"{frappe.utils.get_url()}/app/business-contacts/{bc.get('name')}"
            
            ws_ind.cell(row=i_row, column=3, value=bc.get("contact_name")).font = data_font
            ws_ind.cell(row=i_row, column=4, value=bc.get("org_name") or "-").font = data_font
            ws_ind.cell(row=i_row, column=5, value=bc.get("mobile_number") or "-").font = data_font
            ws_ind.cell(row=i_row, column=6, value=bc.get("email_id") or "-").font = data_font
            ws_ind.cell(row=i_row, column=7, value=bc.get("status")).font = data_font
            ws_ind.cell(row=i_row, column=8, value=bc.get("created_on")).font = data_font
            
            style_row(ws_ind, i_row, 1, 8, data_font)
            i_row += 1
            
        i_row += 2
        
        # Section 2.7: Completed Activities in Last 7 Days
        ws_ind.cell(row=i_row, column=1, value="7. Completed Activities & Visits (Last 7 Days)").font = section_font
        i_row += 1
        
        headers_act_ind = ["S.No", "Activity ID", "Subject", "Reference Type", "Reference Name", "Org Name", "Category", "Completion Time", "Status"]
        for col_idx, h in enumerate(headers_act_ind, 1):
            cell = ws_ind.cell(row=i_row, column=col_idx, value=h)
            cell.font = header_font
            cell.fill = PatternFill(start_color="8E44AD", end_color="8E44AD", fill_type="solid")
            cell.border = thin_border
        i_row += 1
        
        act_ind_rows = frappe.db.sql("""
            SELECT ea.name, ea.subject, ea.reference_type, ea.reference_name, ea.category, ea.status,
                   DATE_FORMAT(ea.ends_on, '%%d-%%b-%%Y %%h:%%i %%p') as completed_on,
                   CASE
                       WHEN ea.reference_type = 'Lead' THEN l.company_name
                       WHEN ea.reference_type = 'Business Contacts' THEN bc.organization_name
                       ELSE ''
                   END as org_name
            FROM `tabEvent Activity` ea
            LEFT JOIN `tabLead` l ON l.name = ea.reference_name AND ea.reference_type = 'Lead'
            LEFT JOIN `tabBusiness Contacts` bc ON bc.name = ea.reference_name AND ea.reference_type = 'Business Contacts'
            WHERE ea.docstatus < 2 AND ea.assigned_to = %(usr)s AND ea.status = 'Completed' AND ea.ends_on >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY ea.ends_on DESC
        """, {"usr": usr_id}, as_dict=True)
        
        for idx, act in enumerate(act_ind_rows, 1):
            ws_ind.cell(row=i_row, column=1, value=idx).font = data_font
            
            cell_actid = ws_ind.cell(row=i_row, column=2, value=act.get("name"))
            cell_actid.font = link_font
            cell_actid.hyperlink = f"{frappe.utils.get_url()}/app/event-activity/{act.get('name')}"
            
            ws_ind.cell(row=i_row, column=3, value=act.get("subject")).font = data_font
            ws_ind.cell(row=i_row, column=4, value=act.get("reference_type")).font = data_font
            ws_ind.cell(row=i_row, column=5, value=act.get("reference_name")).font = data_font
            ws_ind.cell(row=i_row, column=6, value=act.get("org_name") or "-").font = data_font
            ws_ind.cell(row=i_row, column=7, value=act.get("category")).font = data_font
            ws_ind.cell(row=i_row, column=8, value=act.get("completed_on")).font = data_font
            ws_ind.cell(row=i_row, column=9, value=act.get("status")).font = data_font
            
            style_row(ws_ind, i_row, 1, 9, data_font)
            i_row += 1
            
        # Auto adjust column widths for this individual sheet
        for col in ws_ind.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = get_column_letter(col[0].column)
            ws_ind.column_dimensions[col_letter].width = max(max_len + 3, 13)

    output = BytesIO()
    wb.save(output)
    output.seek(0)

    file_base64 = base64.b64encode(output.getvalue()).decode('utf-8')
    fname = f"Executive_CRM_Report_{frappe.utils.today()}.xlsx"

    return {
        "filename": fname,
        "filecontent": file_base64
    }







import frappe
from frappe import _

@frappe.whitelist()
def check_linked_quotation(lead_name):
    has_quotation = frappe.db.exists(
        "Quotation", 
        {
            "quotation_to": "Lead", 
            "party_name": lead_name, 
            "docstatus": ["<", 2] 
        }
    )
    return {"has_quotation": bool(has_quotation)}


@frappe.whitelist()
def convert_lead_to_business_contact(lead_name):
    
    if not frappe.db.exists("Lead", lead_name):
        frappe.throw(_("Lead {0} not found").format(lead_name))
        
    lead_doc = frappe.get_doc("Lead", lead_name)
    
    # Strictly Check for quotation at DB level 
    has_quotation = frappe.db.exists(
        "Quotation", 
        {
            "quotation_to": "Lead", 
            "party_name": lead_name, 
            "docstatus": ["<", 2] 
        }
    )

    # 1. Base Field Mappings
    bc = frappe.new_doc("Business Contacts")
    bc.contact_name = lead_doc.lead_name or lead_doc.first_name
    bc.organization_name = lead_doc.company_name
    bc.mobile_number = lead_doc.mobile_no or lead_doc.phone
    bc.source = lead_doc.source
    bc.assign_to = lead_doc.lead_owner
    
    if has_quotation:
        bc.status = "Converted to Lead"
        bc.lead_id = lead_doc.name
    else:
        bc.status = "Open"
        bc.lead_id = None          

    bc.insert(ignore_permissions=True)
    
    # 2. Scenarios 
    if not has_quotation:
        # NO QUOTATION = TRANSFER ALL ACTIVITIES TO CONTACT & DELETE LEAD
        table_mappings = {
            "Communication": "reference_doctype",
            "Comment": "reference_doctype",
            "ToDo": "reference_type",
            "Event Activity": "reference_type" 
        }
        
        for dt, ref_col in table_mappings.items():
            if frappe.db.exists("DocType", dt):
                try:
                    frappe.db.sql(f"""
                        UPDATE `tab{dt}` 
                        SET `{ref_col}`='Business Contacts', reference_name=%s
                        WHERE `{ref_col}`='Lead' AND reference_name=%s
                    """, (bc.name, lead_doc.name))
                except Exception:
                    continue
                    
        frappe.db.commit()
        
        frappe.delete_doc("Lead", lead_doc.name, force=True, ignore_permissions=True)
        return {"action": "deleted", "business_contact_name": bc.name}

    else:
        # WITH QUOTATION = ACTIVITIES REMAIN IN THE LEAD AND LEAD STAYS ALIVE. WE JUST LINK IT!
        frappe.db.set_value("Lead", lead_doc.name, "custom_business_contacts", bc.name)
        frappe.db.commit()
        return {"action": "linked", "business_contact_name": bc.name}

@frappe.whitelist()
def mark_lead_lost_backend(lead_name, category, lost_reason, lost_reason_description, current_activity_id=None, completion_note=None):
    # 1. Complete the current activity if passed
    if current_activity_id:
        frappe.db.set_value("Event Activity", current_activity_id, {
            "status": "Completed",
            "notes": completion_note or "Lead marked as Lost",
            "ends_on": frappe.utils.now_datetime()
        })
    
    # 2. Cancel all other Open activities for this Lead
    frappe.db.sql("""
        UPDATE `tabEvent Activity`
        SET status = 'Cancelled', notes = 'Lead marked as Lost'
        WHERE reference_type = 'Lead' AND reference_name = %s AND status = 'Open'
    """, lead_name)
    
    # 3. Update the Lead status/category and details
    lead = frappe.get_doc("Lead", lead_name)
    lead.custom_lead_type = "LOST"
    
    if category == "Enquiry":
        lead.custom_lost_enquiry_reason = lost_reason
        lead.custom_lost_enquiry_description = lost_reason_description
        action = "Lost Enquiry"
    else:
        lead.custom_lost_pipeline_reason = lost_reason
        lead.custom_lost_pipeline_description = lost_reason_description
        action = "Lost Pipeline"
        
    # Apply workflow action
    from frappe.model.workflow import apply_workflow
    apply_workflow(lead, action)
    
    return {"status": "success"}

def sync_crm_dashboard_html_block():
    """Syncs crm_dashboard.html into Custom HTML Block.

    Frappe's create_shadow_element (dom.js) wraps the script column content inside
    a backtick template literal:
        script.textContent = `...(function(){ let root_element=...; ${js} })();`;

    Any backtick inside our JS (from ES6 template literals) breaks Frappe's outer
    template literal causing: "Failed to execute 'appendChild' on 'Node': Unexpected token"

    Fix: escape all backticks in js_only with backslash before storing.
    """
    import os
    import re
    app_path = frappe.get_app_path("erp_dacsinc_custom")
    html_file = os.path.normpath(os.path.join(app_path, "..", "crm_dashboard_block", "crm_dashboard.html"))

    if not os.path.exists(html_file):
        return "Error: crm_dashboard.html not found"

    with open(html_file, "r", encoding="utf-8") as f:
        full_content = f.read()

    # Split HTML, CSS, and JS: extract style and script content
    style_match = re.search(r'<style[^>]*>([\s\S]*?)</style>', full_content, re.IGNORECASE)
    if style_match:
        css_only = style_match.group(1).strip()
    else:
        css_only = ""

    script_match = re.search(r'<script[^>]*>([\s\S]*?)</script>', full_content, re.IGNORECASE)
    if script_match:
        js_only = script_match.group(1).strip()
    else:
        js_only = ""

    html_only = full_content
    if style_match:
        html_only = html_only.replace(style_match.group(0), "")
    if script_match:
        html_only = html_only.replace(script_match.group(0), "")
    html_only = html_only.strip()

    updated = []
    for b_name in ["CRM Dashboard", "New CRM Dashboard"]:
        if frappe.db.exists("Custom HTML Block", b_name):
            frappe.db.set_value("Custom HTML Block", b_name, "html", html_only)
            frappe.db.set_value("Custom HTML Block", b_name, "style", css_only)
            frappe.db.set_value("Custom HTML Block", b_name, "script", js_only)
            frappe.clear_cache(doctype="Custom HTML Block")
            updated.append(b_name)

    frappe.db.commit()
    return f"Successfully synced (html: {len(html_only)} bytes, style: {len(css_only)} bytes, script: {len(js_only)} bytes, raw backticks preserved) for: {', '.join(updated)}"