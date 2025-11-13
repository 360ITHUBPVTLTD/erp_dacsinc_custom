import frappe
from frappe.utils import flt

def after_submit(doc, method):
    """
    Triggered when a BOM is submitted.
    Creates a corresponding 'Subcontracting BOM' (non-submittable doctype),
    bypassing its internal validation on creation to prevent errors.
    """
    try:
        if frappe.db.exists("Subcontracting BOM", {"finished_good_bom": doc.name}):
            return

        service_item_uom = frappe.db.get_value("Item", "Order Charges", "stock_uom")
        if not service_item_uom:
            frappe.throw("Service Item 'Order Charges' not found or does not have a default Stock UOM.")

        # Create a new 'Subcontracting BOM'
        sc_bom = frappe.new_doc("Subcontracting BOM")
        sc_bom.finished_good = doc.item
        sc_bom.finished_good_uom = doc.uom
        sc_bom.finished_good_qty = flt(doc.quantity)
        sc_bom.finished_good_bom = doc.name # Link to the source BOM
        sc_bom.conversion_factor = flt(doc.quantity)
        sc_bom.service_item = "Order Charges"
        sc_bom.service_item_qty = 1
        sc_bom.service_item_uom = service_item_uom
        sc_bom.is_active = doc.is_active

        # Set a flag to bypass validations that might fail in this automated context
        sc_bom.flags.ignore_validate = True
        
        # Insert the document as a Draft (since it's not submittable)
        sc_bom.insert(ignore_permissions=True) 

        frappe.msgprint(f"Subcontracting BOM <a href='/app/subcontracting-bom/{sc_bom.name}'>{sc_bom.name}</a> created.", title="Success", indicator="green")

    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Subcontracting BOM Creation Failed")
        frappe.msgprint(f"Error creating Subcontracting BOM: {e}", title="Error", indicator="red")


def on_update_after_submit(doc, method):
    """
    Triggered when a submitted BOM is updated.
    Updates the 'is_active' status of the linked Subcontracting BOM.
    """
    try:
        sc_bom_name = frappe.db.get_value("Subcontracting BOM", {"finished_good_bom": doc.name})
        
        if sc_bom_name:
            sc_bom = frappe.get_doc("Subcontracting BOM", sc_bom_name)
            sc_bom.is_active = doc.is_active
            sc_bom.save(ignore_permissions=True)
            frappe.msgprint(f"Subcontracting BOM {sc_bom.name} status updated to {'Active' if doc.is_active else 'Inactive'}.", indicator="green")

    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Subcontracting BOM Update Failed")


def on_cancel(doc, method):
    """
    Triggered when a BOM is cancelled.
    Deactivates (sets is_active=0) the linked Subcontracting BOM.
    """
    try:
        sc_bom_name = frappe.db.get_value("Subcontracting BOM", {"finished_good_bom": doc.name})
        
        if sc_bom_name:
            sc_bom = frappe.get_doc("Subcontracting BOM", sc_bom_name)
            # Set to inactive since the non-submittable doctype cannot be "cancelled"
            sc_bom.is_active = 0
            sc_bom.save(ignore_permissions=True)
            frappe.msgprint(f"Subcontracting BOM <a href='/app/subcontracting-bom/{sc_bom.name}'>{sc_bom.name}</a> has been deactivated.", title="Deactivated", indicator="orange")

    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Subcontracting BOM Deactivation Failed")