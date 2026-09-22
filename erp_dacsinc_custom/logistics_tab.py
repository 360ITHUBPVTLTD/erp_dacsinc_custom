"""
The Order Flow dashboard's Logistics tab: submitted Sales Invoices still
missing proof-of-delivery paperwork — an LR (Lorry Receipt) Number and/or a
scanned Signed Copy of the invoice — with both editable straight from the
tab, and a manual Proof of Delivery confirmation alongside them.

Whether a Sales Invoice belongs on this tab is decided purely by LR Number
and Signed Copy: an invoice drops off the list the moment EITHER is filled
in, regardless of the Proof of Delivery checkbox. That checkbox is a
separate, independent confirmation — not a third way to clear the queue.
Letting it also clear the row would mean someone could tick it with no
actual paperwork attached and make the invoice disappear, defeating the one
thing this tab exists to track. See docs/order-flow-dashboard.md.
"""

import frappe

LR_NUMBER_FIELD = "custom_lr_number"
SIGNED_COPY_FIELD = "custom_signed_copy"
# Created directly via Customize Form before this tab existed (2026-02-24) —
# referenced here, not (re)created, and included in the fixture list below
# purely so it exports with the app like the two fields this module does own.
PROOF_OF_DELIVERY_FIELD = "custom_proof_of_delivery"


def create_logistics_fields():
    """Idempotent — safe to re-run, and wired to after_migrate so a deploy
    creates them. Inserting a Custom Field adds the column itself, so no
    separate schema step is needed beyond bench migrate."""
    fields = [
        {
            "dt": "Sales Invoice",
            "fieldname": LR_NUMBER_FIELD,
            "label": "LR Number",
            "fieldtype": "Data",
            "insert_after": PROOF_OF_DELIVERY_FIELD,
            "description": "Lorry Receipt / transport document number. Filling this removes the invoice from the Order Flow Logistics tab.",
            "allow_on_submit": 1,
            "translatable": 0,
        },
        {
            "dt": "Sales Invoice",
            "fieldname": SIGNED_COPY_FIELD,
            "label": "Signed Copy",
            "fieldtype": "Attach",
            "insert_after": LR_NUMBER_FIELD,
            "description": "Scanned signed copy of the invoice / delivery proof. Attaching this removes the invoice from the Order Flow Logistics tab.",
            "allow_on_submit": 1,
        },
    ]
    for field in fields:
        name = f"{field['dt']}-{field['fieldname']}"
        if frappe.db.exists("Custom Field", name):
            continue
        try:
            frappe.get_doc({"doctype": "Custom Field", **field}).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(title=f"Could not create {field['fieldname']} on {field['dt']}",
                              message=frappe.get_traceback())
    frappe.db.commit()
