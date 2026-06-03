


import frappe
from frappe.utils import nowdate, getdate, add_months, get_last_day

def allocate_monthly_leaves():
    """
    Allocates 1 CL and 1 SL to all active employees for the current month.
    Allocations expire on the last day of the month.
    """
    
    # 1. Define the period (Current Month)
    today = getdate()
    # today = getdate("2026-02-01") # For testing purposes, set a fixed date
    start_date = today.replace(day=1) # 1st of this month
    end_date_sl = get_last_day(start_date) # 30th/31st of this month

    end_date_cl = None

    if today.month >= 4:  # Apr-Dec
        end_date_cl = today.replace(year=today.year + 1, month=3, day=31)
    else:  # Jan-Mar
        end_date_cl = today.replace(month=3, day=31)
    
    # 2. Define Leaves to Allocate
    # Format: {'Leave Type Name': New_Allocation_Amount}
    leaves_to_allocate = {
        "Casual Leave": 1,
        "Sick Leave": 1
    }

    # 3. Get Active Employees
    # Filter: Active, date_of_joining <= today, and not relieved
    employees = frappe.get_all("Employee", 
        filters={
            "status": "Active",
            "date_of_joining": ["<=", end_date_sl]
        },
        fields=["name", "company", "date_of_joining"]
    )

    # frappe.log("Starting Monthly Leave Allocation for {} Employees".format(len(employees)))

    for emp in employees:
        for leave_type, amount in leaves_to_allocate.items():
            end_date = end_date_sl if leave_type == "Sick Leave" else end_date_cl
            # Check for Idempotency: 
            # Don't create if an allocation already exists for this emp, type, and period.
            exists = frappe.db.exists("Leave Allocation", {
                "employee": emp.name,
                "leave_type": leave_type,
                "from_date": start_date,
                "to_date": end_date,
                "docstatus": 1 # Submitted
            })

            if not exists:
                try:
                    # Create the Allocation Doc
                    allocation = frappe.get_doc({
                        "doctype": "Leave Allocation",
                        "employee": emp.name,
                        "employee_name": emp.employee_name,
                        "leave_type": leave_type,
                        "from_date": start_date,
                        "to_date": end_date, # This ensures it expires at month end
                        "new_leaves_allocated": amount,
                        "total_leaves_allocated": amount,
                        "description": f"Auto-allocated for {start_date.strftime('%B %Y')}",
                        "allocation_date": today
                    })
                    
                    # Validate and Submit
                    allocation.insert(ignore_permissions=True)
                    allocation.submit()
                    
                except Exception as e:
                    frappe.log_error(message=f"Failed to allocate {leave_type} for {emp.name}: {str(e)}", title="Monthly Leave Allocation Error")
        # break
    frappe.db.commit()

def cancel_expired_leave_ledger_entries():
    """
    Finds submitted Leave Ledger Entries that are expired and cancels them.
    Runs daily via scheduler.
    """
    # 1. Fetch names of entries that are Expired (is_expired=1) and Submitted (docstatus=1)
    expired_entries = frappe.get_all("Leave Ledger Entry", 
        filters={
            "is_expired": 1,
            "docstatus": 1
        },
        fields=["name"]
    )

    if not expired_entries:
        return

    count = 0
    for entry in expired_entries:
        try:
            # 2. Load the document and cancel it
            doc = frappe.get_doc("Leave Ledger Entry", entry.name)
            doc.cancel()
            
            # Commit every 10 records to prevent long-running transaction locks
            count += 1
            if count % 10 == 0:
                frappe.db.commit()
                
        except Exception as e:
            # Log errors for specific records to the Error Log
            frappe.log_error(
                message=frappe.get_traceback(),
                title=f"Failed to cancel expired Leave Ledger Entry: {entry.name}"
            )
            continue

    frappe.logger().info(f"Scheduler: Cancelled {count} expired Leave Ledger Entries.")