"""
The Order Flow dashboard's Logistics tab: submitted Sales Invoices still
missing delivery paperwork. Three things are recorded per invoice, from one
"Update" prompt on the tab (update_logistics_fields):

  Transporter  `transporter`  (India Compliance, Link Supplier)
  LR No        `lr_no`        (India Compliance "Transport Receipt No")
  Signed Copy  `custom_signed_copy` (this app, Attach)

All three are editable after submit (property setters, exported with the
app in custom/sales_invoice.json). An invoice leaves the default list once
it has an LR No or a Signed Copy. The old custom LR Number and Proof of
Delivery fields were removed (2026-09-25) — Transporter and LR No sit in
their place on the form. See docs/order-flow-dashboard.md ("Logistics tab").
"""

import frappe

LR_NO_FIELD = "lr_no"            # India Compliance field, not created here
TRANSPORTER_FIELD = "transporter"  # India Compliance field, not created here
SIGNED_COPY_FIELD = "custom_signed_copy"


def create_logistics_fields():
    """Idempotent — safe to re-run, and wired to after_migrate so a deploy
    creates them. Inserting a Custom Field adds the column itself, so no
    separate schema step is needed beyond bench migrate."""
    fields = [
        {
            "dt": "Sales Invoice",
            "fieldname": SIGNED_COPY_FIELD,
            "label": "Signed Copy",
            "fieldtype": "Attach",
            "insert_after": LR_NO_FIELD,
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
