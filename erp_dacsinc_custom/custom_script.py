import frappe



def copy_custom_fields(doc, method):
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
