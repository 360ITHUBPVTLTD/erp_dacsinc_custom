import frappe



def copy_custom_fields(doc, method):
    if doc.custom_tax_rate:
        update_tax_child(doc)





def item_after_insert(doc, method):
    doc.description = ''
    if doc.custom_tax_rate:
        update_tax_child(doc)

def item_before_save(doc, method):
    if doc.custom_tax_rate:
        update_tax_child(doc)


def update_tax_child(doc):
    try:
        # Clear existing taxes
        doc.taxes = []

        # Fetch tax_rate
        tax_rate = doc.custom_tax_rate  # Assuming this stores your tax template

        if tax_rate and tax_rate != 'Non-GST - AH':
            # Add In-State entry
            doc.append('taxes', {
                "tax_category": "In-State",
                "item_tax_template": tax_rate
            })

            # Add Out-State entry
            doc.append('taxes', {
                "tax_category": "Out-State",
                "item_tax_template": tax_rate
            })

        # Always add Non-GST entry
        doc.append('taxes', {
            # "tax_category": "Non-GST",
            "item_tax_template": "Non-GST - AH"
        })

    except Exception as e:
        frappe.log_error(f"Error in updating taxes: {str(e)}")
import frappe

@frappe.whitelist()
def get_customer_contacts(customer):
    """Return all contacts linked to a given customer with phone and email details"""
    return frappe.db.sql("""
        SELECT 
            c.name, 
            c.first_name,
            c.last_name,
            (SELECT phone FROM `tabContact Phone` WHERE parent=c.name AND is_primary_phone=1 LIMIT 1) AS phone,
            (SELECT email_id FROM `tabContact Email` WHERE parent=c.name AND is_primary=1 LIMIT 1) AS email
        FROM `tabContact` c
        INNER JOIN `tabDynamic Link` dl ON dl.parent = c.name
        WHERE dl.link_doctype = 'Customer' AND dl.link_name = %s
    """, (customer,), as_dict=1)

