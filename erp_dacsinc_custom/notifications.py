import frappe
from frappe import _
from frappe.utils import (
    validate_email_address,
    get_fullname,
    get_link_to_form,
    fmt_money,
    format_date,
    get_url,
    slug
)

from erp_dacsinc_custom.email import send_custom_email # Assuming this function is in a separate file

@frappe.whitelist()
def notify_on_new_so(doc, method):
    try:
        settings = frappe.get_single("Admin Settings")
        creator_name = get_fullname(doc.owner)

        # --- PART 1: SEND NOTIFICATION TO ADMIN/GROUP ---
        if settings.send_email and settings.to_mail_ids:
            valid_recipients = []
            raw_emails = settings.to_mail_ids.split(',')
            for email in raw_emails:
                cleaned_email = email.strip()
                if cleaned_email and validate_email_address(cleaned_email):
                    valid_recipients.append(cleaned_email)
            
            if valid_recipients:
                subject = _("New Sales Order Created: {0} by {1}").format(doc.name, creator_name)
                message = get_html_email_template_for_admins(doc, creator_name)
                send_custom_email(to=valid_recipients, subject=subject, message=message)

        # --- PART 2: SEND CONFIRMATION TO ORDER CREATOR ---
        if settings.notify_creator:
            owner_email = doc.owner
            if owner_email and validate_email_address(owner_email):
                owner_subject = _("Confirmation: Your Sales Order {0} has been created").format(doc.name)
                owner_message = get_html_email_template_for_owner(doc, creator_name)
                send_custom_email(to=[owner_email], subject=owner_subject, message=owner_message)
    except Exception as e:
        frappe.log_error(title="Sales Order Notification Failed", message=f"An error occurred for Sales Order {doc.name}: {e}")

def get_html_email_template_for_admins(doc, creator_name):
    relative_so_path = f"/app/{slug('Sales Order')}/{doc.name}"
    full_so_url = get_url(relative_so_path)
    relative_so_link = get_link_to_form("Sales Order", doc.name)
    return f"""
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: auto; background-color: #ffffff; border: 1px solid #ddd; border-radius: 5px; overflow: hidden;">
            <div style="background-color: #4A90E2; color: #ffffff; padding: 20px; text-align: center;">
                <h2 style="margin: 0; font-size: 24px;">New Sales Order Created</h2>
            </div>
            <div style="padding: 20px;">
                <p>Hello,</p>
                <p>A new Sales Order has been created as a draft and requires your attention. Please find the details below:</p>
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                    <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px; font-weight: bold; color: #555;">Sales Order:</td><td style="padding: 10px;">{relative_so_link}</td></tr>
                    <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px; font-weight: bold; color: #555;">Customer:</td><td style="padding: 10px;">{doc.customer_name}</td></tr>
                    <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px; font-weight: bold; color: #555;">Amount:</td><td style="padding: 10px;">{fmt_money(doc.grand_total, currency=doc.currency)}</td></tr>
                    <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px; font-weight: bold; color: #555;">Delivery Date:</td><td style="padding: 10px;">{format_date(doc.delivery_date)}</td></tr>
                    <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px; font-weight: bold; color: #555;">Created By:</td><td style="padding: 10px;">{creator_name} ({doc.owner})</td></tr>
                </table>
                <p style="text-align: center; margin-top: 30px;"><a href="{full_so_url}" style="background-color: #28a745; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Sales Order</a></p>
            </div>
            <div style="background-color: #f8f9fa; color: #888; padding: 15px; text-align: center; font-size: 12px; border-top: 1px solid #eee;">This is an automated notification. Please do not reply to this email.</div>
        </div>
    </div>
    """

def get_html_email_template_for_owner(doc, creator_name):
    relative_so_path = f"/app/{slug('Sales Order')}/{doc.name}"
    full_so_url = get_url(relative_so_path)
    return f"""
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: auto; background-color: #ffffff; border: 1px solid #ddd; border-radius: 5px; overflow: hidden;">
            <div style="background-color: #17a2b8; color: #ffffff; padding: 20px; text-align: center;">
                <h2 style="margin: 0; font-size: 24px;">Sales Order Confirmation</h2>
            </div>
            <div style="padding: 20px;">
                <p>Hello {creator_name},</p>
                <p>This is a confirmation that you have successfully created the following Sales Order. It is now in the system as a draft.</p>
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                    <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px; font-weight: bold; color: #555;">Sales Order ID:</td><td style="padding: 10px;">{doc.name}</td></tr>
                    <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px; font-weight: bold; color: #555;">Customer:</td><td style="padding: 10px;">{doc.customer_name}</td></tr>
                    <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px; font-weight: bold; color: #555;">Amount:</td><td style="padding: 10px;">{fmt_money(doc.grand_total, currency=doc.currency)}</td></tr>
                </table>
                <p style="text-align: center; margin-top: 30px;"><a href="{full_so_url}" style="background-color: #007bff; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Review Your Sales Order</a></p>
            </div>
            <div style="background-color: #f8f9fa; color: #888; padding: 15px; text-align: center; font-size: 12px; border-top: 1px solid #eee;">This is an automated confirmation.</div>
        </div>
    </div>
    """














#####################  Lead daily report mail #########################################


import frappe
import json
import urllib.parse
from frappe.utils import today, format_datetime, get_url, format_date
from frappe.utils.xlsxutils import make_xlsx

@frappe.whitelist()
def generate_daily_report(send_mail=0):
    send_mail = bool(int(send_mail))
    settings = frappe.get_single("Admin Settings")
    
    report_date_iso = today() # YYYY-MM-DD for filters
    # Requested format: dd-mmm-yyyy (e.g. 09-Jan-2026)
    display_date = format_date(report_date_iso, "dd-MMM-yyyy")
    
    start_time = f"{report_date_iso} 00:00:00"
    end_time = f"{report_date_iso} 23:59:59"
    base_url = get_url()

    # 1. Lead Data
    leads_today = frappe.db.get_all("Lead", 
        filters={"creation": ["between", [start_time, end_time]]},
        fields=["name", "lead_name", "lead_owner", "status", "mobile_no", "email_id", "creation"]
    )
    
    lead_summary = {}
    for l in leads_today:
        owner = l.lead_owner or "Unassigned"
        lead_summary[owner] = lead_summary.get(owner, 0) + 1

    # 2. Event Data
    events_today = frappe.db.get_all("Event",
        filters={"creation": ["between", [start_time, end_time]]},
        fields=["subject", "owner", "status", "starts_on", "ends_on", "creation"]
    )

    # 3. Excel logic
    attachments = []
    if leads_today:
        l_data = [["ID", "Lead Name", "Owner", "Status", "Mobile", "Email", "Creation"]]
        for row in leads_today:
            l_data.append([row.name, row.lead_name, row.lead_owner, row.status, row.mobile_no, row.email_id, row.creation])
        attachments.append({"fname": f"Leads_{display_date}.xlsx", "fcontent": make_xlsx(l_data, "Leads").getvalue()})

    if events_today:
        e_data = [["Subject", "Assigned To", "Status", "Starts On (Due)", "Ends On (Completed)", "Created"]]
        for row in events_today:
            e_data.append([row.subject, row.owner, row.status, row.starts_on, row.ends_on, row.creation])
        attachments.append({"fname": f"Events_{display_date}.xlsx", "fcontent": make_xlsx(e_data, "Events").getvalue()})

    # 4. Links Generation
    date_param = urllib.parse.quote(json.dumps([report_date_iso, report_date_iso]))
    lead_link = f"{base_url}/app/query-report/Lead Report?custom_created_at_option=Custom&custom_created_at={date_param}"
    event_link = f"{base_url}/app/query-report/Lead Report?inverse_report=1&custom_created_at_option=Custom&custom_created_at={date_param}"

    html_content = get_html_template(display_date, lead_summary, events_today, lead_link, event_link)

    if send_mail:
        if not settings.send_mail_for_daily:
            return {"status": "error", "message": "Email sending is disabled."}
        recipients = [r.strip() for r in (settings.to_mail_id or "").split(",") if r.strip()]
        if not recipients: return {"status": "error", "message": "No recipients found."}

        frappe.sendmail(
            recipients=recipients,
            subject=f"Daily Report: {display_date}",
            content=html_content,
            attachments=attachments,
            now=True
        )
        return {"status": "success", "message": "Sent Successfully."}

    return {"status": "success", "html": html_content}

def get_html_template(date, lead_summary, events, lead_link, event_link):
    summary_rows = ""
    for owner, count in lead_summary.items():
        summary_rows += f"<tr><td style='border:1px solid #ddd;padding:8px;'>{owner}</td><td style='border:1px solid #ddd;padding:8px;text-align:center;'><b>{count}</b></td></tr>"

    event_rows = ""
    for e in events:
        event_rows += f"""
            <tr>
                <td style='border:1px solid #ddd;padding:8px;'>{e.subject}</td>
                <td style='border:1px solid #ddd;padding:8px;'>{e.owner}</td>
                <td style='border:1px solid #ddd;padding:8px;'>{e.status}</td>
                <td style='border:1px solid #ddd;padding:8px;'>{format_datetime(e.starts_on)}</td>
                <td style='border:1px solid #ddd;padding:8px;'>{format_datetime(e.ends_on) if e.ends_on else '-'}</td>
            </tr>"""

    return f"""
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; padding: 10px; color: #444;">
        <div style="background-color: #0047AB; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin:0;">Daily Management Report</h2>
            <p style="margin:5px 0 0 0; opacity:0.9;">Report Date: {date}</p>
        </div>
        
        <div style="border: 1px solid #ddd; border-top: none; padding: 20px; background: #fff; border-radius: 0 0 8px 8px;">
            
            <div style="margin-bottom: 25px;">
                <h3 style="color: #0047AB; margin-top:0;">1. New Leads Summary</h3>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
                    <tr style="background: #f8f9fa;">
                        <th style="border:1px solid #ddd;padding:10px;text-align:left;">Lead Owner</th>
                        <th style="border:1px solid #ddd;padding:10px;width:120px;">Count</th>
                    </tr>
                    {summary_rows if summary_rows else "<tr><td colspan='2' style='padding:10px;text-align:center;'>No leads created today</td></tr>"}
                </table>
                <a href="{lead_link}" target="_blank" style="display:inline-block; padding: 10px 20px; background:#0047AB; color:#fff; text-decoration:none; border-radius:4px; font-weight:bold; font-size:13px;">View Detailed Lead Report</a>
            </div>

            <div style="margin-bottom: 25px; border-top: 1px solid #eee; pt:20px;">
                <h3 style="color: #0047AB; padding-top:15px;">2. Event Activity Log</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 15px;">
                    <tr style="background: #f8f9fa;">
                        <th style='border:1px solid #ddd;padding:8px;text-align:left;'>Subject</th>
                        <th style='border:1px solid #ddd;padding:8px;text-align:left;'>Assigned To</th>
                        <th style='border:1px solid #ddd;padding:8px;text-align:left;'>Status</th>
                        <th style='border:1px solid #ddd;padding:8px;text-align:left;'>Starts On (Due)</th>
                        <th style='border:1px solid #ddd;padding:8px;text-align:left;'>Ends On (Completed)</th>
                    </tr>
                    {event_rows if event_rows else "<tr><td colspan='5' style='padding:10px;text-align:center;'>No events recorded today</td></tr>"}
                </table>
                <a href="{event_link}" target="_blank" style="display:inline-block; padding: 10px 20px; background:#0047AB; color:#fff; text-decoration:none; border-radius:4px; font-weight:bold; font-size:13px;">View Full Activity Report</a>
            </div>

            <div style="background: #fdf6ec; border: 1px solid #faebcc; color: #8a6d3b; padding: 12px; border-radius: 4px; font-size: 12px;">
                <b>System Note:</b> Comprehensive Excel data files for both Leads and Events have been attached to this email.
            </div>
        </div>
    </div>
    """