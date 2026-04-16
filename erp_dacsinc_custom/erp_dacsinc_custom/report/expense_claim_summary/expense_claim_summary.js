// Copyright (c) 2026, Pankaj and contributors
// For license information, please see license.txt

frappe.query_reports["Expense Claim Summary"] = {
	"filters": [
		{
			"fieldname": "employee",
			"label": __("Employee"),
			"fieldtype": "Link",
			"options": "Employee"
		},
		{
			"fieldname": "status",
			"label": __("Status"),
			"fieldtype": "Select",
			"options": ["", "Approved", "Rejected", "Paid", "Partially Paid", "Unpaid"]
		}
	]
};