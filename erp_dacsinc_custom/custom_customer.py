import frappe


# @frappe.whitelist()
# def customer_after_insert(doc, method):
#     """
#     Trigger: Customer > After Insert
#     1. Fetches Lead Owner from linked Lead.
#     2. Finds Sales Person linked to that User (via Employee).
#     3. Adds Sales Person to Customer Sales Team.
#     4. Shares Customer doc with that User.
#     """
    
#     # 1. Validate if Lead is linked
#     if not doc.lead_name:
#         return

#     # 2. Get Lead Owner (User ID / Email)
#     lead_owner = frappe.db.get_value("Lead", doc.lead_name, "lead_owner")
    
#     if not lead_owner:
#         return
#     if not doc.lead_name:
#         return

#     # --- NEW: Update the Lead document with this Customer's ID ---
#     # We use db.set_value for a quick update of the custom field
#     frappe.db.set_value("Lead", doc.lead_name, "custom_lead_customer", doc.name)
#     # 3. Find Sales Person based on User ID -> Employee -> Sales Person
#     # We join Sales Person and Employee tables to find the match
#     sales_person = frappe.db.sql("""
#         SELECT sp.name 
#         FROM `tabSales Person` sp
#         INNER JOIN `tabEmployee` emp ON sp.employee = emp.name
#         WHERE emp.user_id = %s AND sp.enabled = 1
#         LIMIT 1
#     """, (lead_owner,))

#     if not sales_person:
#         frappe.log_error(f"No Sales Person found for User {lead_owner}", "Customer Auto-Assign Error")
#         return

#     sales_person_name = sales_person[0][0]

#     # 4. Add to Sales Team Table
#     # Check if this sales person is already added to avoid duplicates
#     existing_persons = [row.sales_person for row in doc.get("sales_team", [])]
    
#     doc_needs_save = False

#     if sales_person_name not in existing_persons:
#         # Determine allocation (default to 100 if empty, or 0 if others exist to prevent validation error)
#         allocation = 100 if not existing_persons else 0
        
#         doc.append("sales_team", {
#             "sales_person": sales_person_name,
#             "allocated_percentage": allocation
#         })
#         doc_needs_save = True

#     # Save the document if we added a row
#     if doc_needs_save:
#         doc.save(ignore_permissions=True)

#     # 5. Share the Document with the Lead Owner
#     frappe.share.add(
#         doctype="Customer",
#         name=doc.name,
#         user=lead_owner,
#         read=1,
#         write=1,
#         share=1,
#         notify=1  # Set to 0 if you don't want to email the user
#     )

#     frappe.msgprint(f"Customer shared with {lead_owner} and assigned to Sales Person {sales_person_name}")



# @frappe.whitelist()
# def update_customer_sharing(doc, method):
#     # print('dddddddddddddddddddddddddddddddddddddddddddddddddddddd')
#     """
#     Trigger: Customer > on_update
#     Syncs document sharing based on the Sales Team child table.
#     1. Identifies Users linked to current Sales Persons.
#     2. Identifies Users linked to removed Sales Persons (via get_doc_before_save).
#     3. Shares with new users, Unshares with removed users.
#     """

#     # Helper function to extract User IDs from Sales Team rows
#     def get_users_from_team(sales_team_items):
#         if not sales_team_items:
#             return set()
        
#         # Collect Sales Person names from the child table
#         sp_names = [d.sales_person for d in sales_team_items if d.sales_person]
        
#         if not sp_names:
#             return set()

#         # Query Database: Sales Person -> Employee -> User ID
#         # We look for enabled Sales Persons linked to an Employee with a User ID
#         users = frappe.db.sql("""
#             SELECT emp.user_id
#             FROM `tabSales Person` sp
#             INNER JOIN `tabEmployee` emp ON sp.employee = emp.name
#             WHERE sp.name IN %s 
#             AND emp.user_id IS NOT NULL
#         """, (tuple(sp_names),), pluck=True)
        
#         return set(users)

#     # 1. Get the list of Users currently in the table (Post-Update)
#     current_users = get_users_from_team(doc.sales_team)

#     # 2. Get the list of Users that were in the table before saving (Pre-Update)
#     previous_users = set()
#     old_doc = doc.get_doc_before_save()
    
#     if old_doc:
#         previous_users = get_users_from_team(old_doc.sales_team)

#     # 3. Calculate Differences
#     # Users in Current but not in Previous -> ADD SHARE
#     users_to_add = current_users - previous_users
    
#     # Users in Previous but not in Current -> REMOVE SHARE
#     users_to_remove = previous_users - current_users

#     # 4. Apply Sharing (Add)
#     for user in users_to_add:
#         frappe.share.add(
#             doctype="Customer",
#             name=doc.name,
#             user=user,
#             read=1,
#             write=1,
#             share=1,
#             notify=0 # Set to 1 if you want to send email
#         )

#     # 5. Apply Unsharing (Remove)
#     for user in users_to_remove:
#         # Check if the user still has access via some other role/rule? 
#         # frappe.share.remove will simply remove the specific share entry for this doc.
#         frappe.share.remove(
#             doctype="Customer",
#             name=doc.name,
#             user=user
#         )





def customer_before_insert(doc, method=None):
    """
    Logic that modifies the document BEFORE it hits the database.
    No doc.save() required here.
    """
    if not doc.lead_name:
        return

    # 1. Get Lead Owner
    lead_owner = frappe.db.get_value("Lead", doc.lead_name, "lead_owner")
    if not lead_owner:
        return

    # 2. Find Sales Person linked to the Lead Owner
    sales_person = frappe.db.sql("""
        SELECT sp.name 
        FROM `tabSales Person` sp
        INNER JOIN `tabEmployee` emp ON sp.employee = emp.name
        WHERE emp.user_id = %s AND sp.enabled = 1
        LIMIT 1
    """, (lead_owner,))

    if sales_person:
        sales_person_name = sales_person[0][0]
        
        # 3. Add to Sales Team child table (This is safe in before_insert)
        existing_persons = [row.sales_person for row in doc.get("sales_team", [])]
        if sales_person_name not in existing_persons:
            allocation = 100 if not existing_persons else 0
            doc.append("sales_team", {
                "sales_person": sales_person_name,
                "allocated_percentage": allocation
            })

def customer_after_insert(doc, method=None):
    """
    Logic for external updates and sharing AFTER the document is created.
    """
    if doc.lead_name:
        # 1. Update the Lead document with this Customer's ID
        frappe.db.set_value("Lead", doc.lead_name, "custom_lead_customer", doc.name, update_modified=False)

        # 2. Initial Sharing with Lead Owner
        lead_owner = frappe.db.get_value("Lead", doc.lead_name, "lead_owner")
        if lead_owner:
            frappe.share.add(
                doctype="Customer",
                name=doc.name,
                user=lead_owner,
                read=1, write=1, share=1, notify=1
            )

def update_customer_sharing(doc, method=None):
    """
    Syncs sharing based on Sales Team changes.
    Used in on_update.
    """
    # Use flags to prevent recursion if another app triggers a save
    if doc.flags.in_sharing_sync:
        return
    doc.flags.in_sharing_sync = True

    def get_users_from_team(sales_team_items):
        if not sales_team_items: return set()
        sp_names = [d.sales_person for d in sales_team_items if d.sales_person]
        if not sp_names: return set()

        users = frappe.db.sql("""
            SELECT emp.user_id
            FROM `tabSales Person` sp
            INNER JOIN `tabEmployee` emp ON sp.employee = emp.name
            WHERE sp.name IN %s AND emp.user_id IS NOT NULL
        """, (tuple(sp_names),), pluck=True)
        return set(users)

    current_users = get_users_from_team(doc.sales_team)
    
    # get_doc_before_save is useful here to find who was removed
    previous_users = set()
    old_doc = doc.get_doc_before_save()
    if old_doc:
        previous_users = get_users_from_team(old_doc.sales_team)

    users_to_add = current_users - previous_users
    users_to_remove = previous_users - current_users

    for user in users_to_add:
        frappe.share.add("Customer", doc.name, user, read=1, write=1, share=1)

    for user in users_to_remove:
        frappe.share.remove("Customer", doc.name, user)