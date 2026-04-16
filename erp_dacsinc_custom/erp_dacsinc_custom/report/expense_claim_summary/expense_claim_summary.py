# Copyright (c) 2026, Pankaj and contributors
# For license information, please see license.txt

# import frappe


import frappe
from frappe import _

def execute(filters=None):
    columns = get_columns()
    data = get_data(filters)
    return columns, data

def get_columns():
    return [
        {"label": _("Claim ID"), "fieldname": "name", "fieldtype": "Link", "options": "Expense Claim", "width": 120},
        {"label": _("Employee"), "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 150},
        {"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 100},
        {"label": _("Total Claimed"), "fieldname": "total_claimed_amount", "fieldtype": "Currency", "width": 120},
        {"label": _("Total Approved"), "fieldname": "total_sanctioned_amount", "fieldtype": "Currency", "width": 120},
        {"label": _("Paid Amount"), "fieldname": "total_amount_reimbursed", "fieldtype": "Currency", "width": 120},
        {"label": _("Unpaid Approved Amount"), "fieldname": "unpaid_balance", "fieldtype": "Currency", "width": 140},
        {"label": _("Expense Details (Type: Amount)"), "fieldname": "expense_csv", "fieldtype": "Small Text", "width": 300},
        {"label": _("Approval Status"), "fieldname": "approval_status", "fieldtype": "Data", "width": 100},
    ]

def get_data(filters):
    # Fetch Parent data
    claims = frappe.db.get_list("Expense Claim", 
        fields=["name", "employee", "status", "total_claimed_amount", 
                "total_sanctioned_amount", "total_amount_reimbursed", "docstatus"],
        filters={"docstatus": ["<", 2]} # Exclude cancelled
    )

    # Fetch Child data for comma-separated formatting
    # This avoids doing a database query inside the loop for performance
    child_items = frappe.db.sql("""
        SELECT 
            parent, 
            CONCAT(expense_type, ': ', amount) as detail
        FROM `tabExpense Claim Detail`
    """, as_dict=True)

    # Group child items by parent name
    items_by_parent = {}
    for item in child_items:
        if item.parent not in items_by_parent:
            items_by_parent[item.parent] = []
        items_by_parent[item.parent].append(item.detail)

    result = []
    for doc in claims:
        # Status Logic
        unpaid = flt(doc.total_sanctioned_amount) - flt(doc.total_amount_reimbursed)
        
        row = {
            "name": doc.name,
            "employee": doc.employee,
            "status": doc.status,
            "total_claimed_amount": doc.total_claimed_amount,
            "total_sanctioned_amount": doc.total_sanctioned_amount,
            "total_amount_reimbursed": doc.total_amount_reimbursed,
            "unpaid_balance": unpaid if doc.status != "Rejected" else 0,
            "expense_csv": ", ".join(items_by_parent.get(doc.name, [])),
        }

        # Logic for "Approved Not Paid", "Partially Paid"
        if doc.status == "Rejected":
            row["approval_status"] = "Rejected"
        elif doc.status == "Paid":
            row["approval_status"] = "Fully Paid"
        elif doc.total_sanctioned_amount > 0:
            if doc.total_amount_reimbursed == 0:
                row["approval_status"] = "Approved (Unpaid)"
            elif doc.total_amount_reimbursed < doc.total_sanctioned_amount:
                row["approval_status"] = "Partially Paid"
            else:
                row["approval_status"] = "Approved"
        else:
            row["approval_status"] = "Pending Approval"

        result.append(row)

    return result

from frappe.utils import flt