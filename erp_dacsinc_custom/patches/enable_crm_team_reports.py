"""
Turn ON the new "Also Send ... to Team Members" switches for this site.

These fields were added after team-member reports were already going out. A new
Check column starts empty on an existing Single doctype, so without this the
upgrade would silently stop those e-mails. Writing 1 explicitly keeps current
behaviour and makes "unchecked" mean a deliberate "off".
"""

import frappe


def execute():
    for field in (
        "send_daily_crm_report_to_team",
        "send_weekly_crm_report_to_team",
        "send_monthly_crm_report_to_team",
    ):
        current = frappe.db.get_single_value("Admin Settings", field)
        if current in (None, ""):
            frappe.db.set_single_value("Admin Settings", field, 1)
