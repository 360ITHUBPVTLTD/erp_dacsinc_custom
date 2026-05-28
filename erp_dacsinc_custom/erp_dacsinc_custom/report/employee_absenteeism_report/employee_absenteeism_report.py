# Copyright (c) 2026, Pankaj and contributors
# For license information, please see license.txt

import frappe
from frappe import _


def execute(filters=None):
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_columns():
	return [
		{
			"label": _("Employee"),
			"fieldname": "employee",
			"fieldtype": "Link",
			"options": "Employee",
			"width": 120
		},
		{
			"label": _("Employee Name"),
			"fieldname": "employee_name",
			"fieldtype": "Data",
			"width": 150
		},
		{
			"label": _("Department"),
			"fieldname": "department",
			"fieldtype": "Link",
			"options": "Department",
			"width": 130
		},
		{
			"label": _("Attendance Date"),
			"fieldname": "attendance_date",
			"fieldtype": "Date",
			"width": 120
		},
		{
			"label": _("Status"),
			"fieldname": "status",
			"fieldtype": "Data",
			"width": 100
		},
		{
			"label": _("Reason"),
			"fieldname": "reason",
			"fieldtype": "Data",
			"width": 200
		},
		{
			"label": _("Leave Type"),
			"fieldname": "leave_type",
			"fieldtype": "Link",
			"options": "Leave Type",
			"width": 130
		},
		{
			"label": _("Leave Application"),
			"fieldname": "leave_application",
			"fieldtype": "Link",
			"options": "Leave Application",
			"width": 150
		},
		{
			"label": _("Leave Status"),
			"fieldname": "leave_status",
			"fieldtype": "Data",
			"width": 110
		},
		{
			"label": _("Attendance Request"),
			"fieldname": "attendance_request",
			"fieldtype": "Link",
			"options": "Attendance Request",
			"width": 150
		},
		{
			"label": _("ARQ Status"),
			"fieldname": "arq_status",
			"fieldtype": "Data",
			"width": 110
		},
		{
			"label": _("Check-ins"),
			"fieldname": "check_ins",
			"fieldtype": "Data",
			"width": 220
		},
		{
			"label": _("Working Hours"),
			"fieldname": "working_hours",
			"fieldtype": "Float",
			"width": 110
		}
	]


def get_data(filters):
	conditions = ""
	if filters.get("employee"):
		conditions += " AND att.employee = %(employee)s"

	query = f"""
		SELECT
			att.employee,
			att.employee_name,
			att.attendance_date,
			att.status,
			att.working_hours,
			att.department
		FROM `tabAttendance` att
		WHERE att.attendance_date BETWEEN %(from_date)s AND %(to_date)s
			AND att.status IN ('Absent', 'Half Day')
			AND att.docstatus < 2
			{conditions}
		ORDER BY att.employee, att.attendance_date
	"""
	data = frappe.db.sql(query, filters, as_dict=True)

	for row in data:
		date_str = str(row.attendance_date)

		# 1. Fetch check-in logs for this date
		start_dt = f"{date_str} 00:00:00"
		end_dt = f"{date_str} 23:59:59"

		logs = frappe.get_all("Employee Checkin",
			filters={
				"employee": row.employee,
				"time": ["between", [start_dt, end_dt]],
				"skip_auto_attendance": 0,
				"system_generated": 0
			},
			fields=["time", "log_type"],
			order_by="time asc"
		)

		# Format check-ins representation
		if logs:
			punch_times = []
			for l in logs:
				time_str = l.time.strftime("%H:%M")
				punch_times.append(f"{time_str} ({l.log_type})")
			row.check_ins = ", ".join(punch_times)
		else:
			row.check_ins = ""

		# 2. Fetch Leave Applications covering this date
		leaves = frappe.get_all("Leave Application",
			filters={
				"employee": row.employee,
				"docstatus": ["<", 2],
				"from_date": ["<=", date_str],
				"to_date": [">=", date_str]
			},
			fields=["name", "status", "leave_type"]
		)

		# 3. Fetch Attendance Request covering this date
		arq = frappe.db.get_value("Attendance Request",
			{
				"employee": row.employee,
				"docstatus": ["<", 2],
				"from_date": date_str
			},
			["name", "docstatus", "custom_status"],
			as_dict=True
		)

		# 4. Determine Reason and Status values
		row.leave_application = None
		row.leave_type = None
		row.leave_status = None
		row.attendance_request = None
		row.arq_status = None

		if leaves:
			leave_app = leaves[0]
			row.leave_application = leave_app.name
			row.leave_type = leave_app.leave_type
			row.leave_status = leave_app.status
			row.reason = f"Leave Applied ({leave_app.status})"
		elif arq:
			row.attendance_request = arq.name
			arq_status = "Rejected" if arq.custom_status == "Rejected" else ("Submitted" if arq.docstatus == 1 else "Draft")
			row.arq_status = arq_status
			row.reason = f"Attendance Request ({arq_status})"
		else:
			if logs:
				row.reason = "Missed Check-in"
			else:
				row.reason = "Absent (No Check-in)"

	return data
