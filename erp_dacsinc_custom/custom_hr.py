import frappe
from datetime import datetime, timedelta, date
from frappe.utils import get_first_day, get_last_day, add_months, getdate, add_days, now_datetime


@frappe.whitelist()
def get_approved_leave_applications():

    curr_user_emp = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")

    all_emp = frappe.get_all("Employee",filters={"status":"Active","name":["not in",[curr_user_emp]]},fields=["name","employee_name","user_id"])
    emp_dict = {i.user_id: i.employee_name for i in all_emp}

    current_date = now_datetime().date()  # Get the current date in YYYY-MM-DD format
    leave_applications = frappe.get_all(
        'Leave Application',
        filters={
            'status': 'Approved',
            'docstatus': 1, # Filter to get only to_date greater than or equal to current date,
            'to_date': ['>=', current_date],
            'from_date': ['<=', current_date]
        },

        fields=["name",'employee_name', "leave_approver", 'from_date', 'to_date', 'total_leave_days','name']
    )
    print("LLLLLLLLLLllllllLLLlllllLLLllllLlllLLL",leave_applications)
    for app in leave_applications:
        if app.leave_approver and app.leave_approver in emp_dict:
            
            app["leave_approver_name"]=emp_dict[app.leave_approver]
    
    return leave_applications