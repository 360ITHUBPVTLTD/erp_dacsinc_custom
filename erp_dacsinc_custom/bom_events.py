import frappe
from frappe.utils import flt

def after_submit(doc, method):
    """Triggered on BOM submission."""
    sync_subcontracting_bom(doc)

def on_update_after_submit(doc, method):
    """Triggered when BOM is updated after submission (e.g., toggling Is Default)."""
    sync_subcontracting_bom(doc)

def sync_subcontracting_bom(doc):
    try:
        # 1. Find the Subcontracting BOM linked to this specific BOM
        sc_bom_name = frappe.db.get_value("Subcontracting BOM", {"finished_good_bom": doc.name})
        
        # 2. If it does not exist, create it first
        if not sc_bom_name:
            sc_bom_name = create_subcontracting_bom(doc)
            if not sc_bom_name:
                return 

        # 3. Logic: If this BOM is the Default (is_default=1), make SC BOM Active
        if doc.is_default == 1:
            # Deactivate ALL other SC BOMs for this Item to avoid "Already Active" validation error
            frappe.db.sql("""
                UPDATE `tabSubcontracting BOM` 
                SET is_active = 0 
                WHERE finished_good = %s AND name != %s
            """, (doc.item, sc_bom_name))

            # Update and Activate this specific SC BOM
            frappe.db.set_value("Subcontracting BOM", sc_bom_name, {
                "is_active": 1,
                "service_item": doc.custom_service_item,  # Sync Service Item
                "service_item_qty": flt(doc.quantity),
                "finished_good_qty": flt(doc.quantity),
                "finished_good_uom": doc.uom
            })
            frappe.msgprint(f"Subcontracting BOM {sc_bom_name} updated to <b>Active</b> and Service Item updated.", indicator="green")
        
        else:
            # If this BOM is not default, set SC BOM to Inactive
            # But still sync the service item in case it changed
            frappe.db.set_value("Subcontracting BOM", sc_bom_name, {
                "is_active": 0,
                "service_item": doc.custom_service_item, # Sync Service Item even if inactive
                "service_item_qty": flt(doc.quantity),
                "finished_good_qty": flt(doc.quantity),
                "finished_good_uom": doc.uom,
                "conversion_factor":flt(doc.quantity)
            })

    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="SC BOM Sync Error")
        frappe.msgprint(f"Error Syncing Subcontracting BOM: {str(e)}")

def create_subcontracting_bom(doc):
    """Helper function to create a Subcontracting BOM record."""
    try:
        if not doc.custom_service_item:
            frappe.msgprint("<b>Creation Skipped:</b> 'Custom Service Item' is empty.", indicator="orange")
            return None

        # Fetch Stock UOM for the service item
        service_item_uom = frappe.db.get_value("Item", doc.custom_service_item, "stock_uom")
        if not service_item_uom:
            frappe.throw(f"Service Item {doc.custom_service_item} has no Stock UOM.")

        sc_bom = frappe.new_doc("Subcontracting BOM")
        sc_bom.finished_good = doc.item 
        sc_bom.finished_good_bom = doc.name
        sc_bom.finished_good_uom = doc.uom
        sc_bom.finished_good_qty = flt(doc.quantity)
        sc_bom.service_item = doc.custom_service_item # Mapping custom_service_item
        sc_bom.service_item_qty = flt(doc.quantity)
        sc_bom.service_item_uom = service_item_uom
        sc_bom.conversion_factor = flt(doc.quantity)
        
        # Set initial active status based on if this BOM is default
        sc_bom.is_active = 1 if doc.is_default else 0
        
        # Use flags to bypass the "Main BOM must be default" validation during creation
        sc_bom.flags.ignore_validate = True
        sc_bom.insert(ignore_permissions=True)
        
        frappe.msgprint(f"Subcontracting BOM {sc_bom.name} created.", indicator="green")
        return sc_bom.name

    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="SC BOM Creation Error")
        frappe.msgprint(f"Failed to create SC BOM: {str(e)}", indicator="red")
        return None

def on_cancel(doc, method):
    """
    Triggered when a BOM is cancelled.
    Deletes the linked Subcontracting BOM.
    """
    try:
        sc_bom_name = frappe.db.get_value("Subcontracting BOM", {"finished_good_bom": doc.name})
        
        if sc_bom_name:
            # Delete the linked Subcontracting BOM
            frappe.delete_doc("Subcontracting BOM", sc_bom_name, ignore_permissions=True)
            frappe.msgprint(f"Subcontracting BOM {sc_bom_name} has been deleted.", indicator="red")

    except frappe.LinkExistsError:
        # Fallback: if it's already used in a Subcontracting Order, we can't delete it.
        frappe.db.set_value("Subcontracting BOM", sc_bom_name, "is_active", 0)
        frappe.msgprint(f"Subcontracting BOM {sc_bom_name} is linked to other transactions. It has been <b>Deactivated</b> instead of deleted.", indicator="orange")
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Subcontracting BOM Deletion Failed")