import frappe


def execute():
    for dt, name in (("Sales Invoice", "SINV-26-00030"), ("Sales Invoice", "SINV-26-00031"),
                     ("Delivery Note", "DN-26-00032")):
        if frappe.db.exists(dt, name):
            frappe.delete_doc(dt, name, force=1, ignore_permissions=True)
            print("deleted", dt, name)
        else:
            print("not present (nothing to clean)", dt, name)
    frappe.db.commit()
    print("DONE")
