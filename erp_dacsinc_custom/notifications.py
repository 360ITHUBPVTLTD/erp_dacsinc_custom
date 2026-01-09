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
from frappe.utils import today, format_datetime, get_url, format_date, get_datetime

@frappe.whitelist()
def generate_daily_report(send_mail=0):
    send_mail = bool(int(send_mail))
    settings = frappe.get_single("Admin Settings")
    
    report_date_iso = today()
    display_date = format_date(report_date_iso, "dd-MMM-yyyy")
    
    start_day = f"{report_date_iso} 00:00:00"
    end_day = f"{report_date_iso} 23:59:59"
    base_url = get_url()

    # 1. Total Lead Created Today (by Lead Owner)
    leads_today = frappe.db.get_all("Lead", 
        filters={"creation": ["between", [start_day, end_day]]},
        fields=["lead_owner", "name"]
    )
    total_lead_created_today = len(leads_today)
    lead_summary = {}
    for l in leads_today:
        owner = l.lead_owner or "Unassigned"
        lead_summary[owner] = lead_summary.get(owner, 0) + 1

    # 2. Activity Data
    # Load (Record) Created Today
    activity_created_today = frappe.db.count("Event Activity", {"creation": ["between", [start_day, end_day]]})
    
    # Activity Completed Today (based on ends_on date)
    completed_today = frappe.db.count("Event Activity", {"ends_on": ["between", [start_day, end_day]]})
    
    # Overdue Active (Status Open/Active and Starts_on < Today)
    overdue_active = frappe.db.count("Event Activity", {
        "status": ["not in", ["Closed", "Completed", "Cancelled"]],
        "starts_on": ["<", start_day]
    })

    # Detailed Activity Log for the table (Created Today)
    detailed_events = frappe.db.get_all("Event Activity",
        filters={"creation": ["between", [start_day, end_day]]},
        fields=["subject", "owner", "status", "starts_on", "ends_on"]
    )

    # 3. Dynamic Links for Buttons (Encoded)
    date_param = urllib.parse.quote(json.dumps([report_date_iso, report_date_iso]))
    lead_report_link = f"{base_url}/app/query-report/Lead Report?custom_created_at_option=Custom&custom_created_at={date_param}"
    activity_report_link = f"{base_url}/app/query-report/Lead Report?inverse_report=1&custom_created_at_option=Custom&custom_created_at={date_param}"

    html_content = get_modern_dashboard(
        display_date, lead_summary, detailed_events, 
        lead_report_link, activity_report_link,
        total_lead_created_today, activity_created_today, completed_today, overdue_active
    )

    if send_mail:
        if not settings.to_mail_id:
            return {"status": "error", "message": "Recipients missing in Admin Settings."}
        
        recipients = [r.strip() for r in settings.to_mail_id.split(",") if r.strip()]
        frappe.sendmail(
            recipients=recipients,
            subject=f"Management Daily Summary: {display_date}",
            content=html_content,
            now=True
        )
        return {"status": "success", "message": "Email sent to management."}

    return {"status": "success", "html": html_content}

def get_modern_dashboard(date, lead_summary, events, lead_url, act_url, t_lead, a_create, a_comp, a_overdue):
    # Overall metrics UI cards
    metrics_html = f"""
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 25px;">
        <div style="background: #ffffff; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center;">
            <div style="font-size: 11px; color: #777; text-transform: uppercase;">Total Leads Created Today</div>
            <div style="font-size: 24px; font-weight: bold; color: #0047AB;">{t_lead}</div>
        </div>
        <div style="background: #ffffff; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center;">
            <div style="font-size: 11px; color: #777; text-transform: uppercase;">Activity Created Today</div>
            <div style="font-size: 24px; font-weight: bold; color: #15803d;">{a_create}</div>
        </div>
        <div style="background: #ffffff; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center;">
            <div style="font-size: 11px; color: #777; text-transform: uppercase;">Completed Today</div>
            <div style="font-size: 24px; font-weight: bold; color: #6366f1;">{a_comp}</div>
        </div>
        <div style="background: #ffffff; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center;">
            <div style="font-size: 11px; color: #777; text-transform: uppercase;">Overdue Active</div>
            <div style="font-size: 24px; font-weight: bold; color: #ef4444;">{a_overdue}</div>
        </div>
    </div>
    """

    # Table rows
    lead_rows = "".join([f"<tr><td style='border:1px solid #ddd;padding:8px;'>{o}</td><td style='border:1px solid #ddd;padding:8px;text-align:center;'><b>{c}</b></td></tr>" for o, c in lead_summary.items()])
    event_rows = "".join([f"<tr><td style='border:1px solid #ddd;padding:8px;'>{e.subject}</td><td style='border:1px solid #ddd;padding:8px;'>{e.owner}</td><td style='border:1px solid #ddd;padding:8px;'>{e.status}</td><td style='border:1px solid #ddd;padding:8px;'>{format_datetime(e.starts_on)}</td><td style='border:1px solid #ddd;padding:8px;'>{format_datetime(e.ends_on) if e.ends_on else '-'}</td></tr>" for e in events])

    return f"""
    <div style="background-color: #f3f4f6; padding: 25px; font-family: -apple-system, sans-serif;">
        <div style="max-width: 900px; margin: auto; background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: #0047AB; color: white; padding: 25px;">
                <h1 style="margin: 0; font-size: 22px; color:white;">Executive Performance Dashboard</h1>
                <p style="margin: 4px 0 0 0; opacity: 0.8; font-size: 13px;">Review Date: {date}</p>
            </div>
            
            <div style="padding: 25px;">
                {metrics_html}

                <h3 style="color: #333; margin-top: 25px;">New Leads Created (Today)</h3>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
                    <tr style="background: #f9fafb;"><th style="border:1px solid #ddd;padding:10px;text-align:left;">Lead Owner</th><th style="border:1px solid #ddd;padding:10px;width:150px;">Created Today</th></tr>
                    {lead_rows if lead_rows else "<tr><td colspan='2' style='padding:10px;text-align:center;'>No leads generated today.</td></tr>"}
                </table>
                <div style="text-align: right; margin-bottom: 30px;">
                    <a href="{lead_url}" target="_blank" style="display:inline-block; background: #0047AB; color: white; padding: 8px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 13px;">View Full Lead Details →</a>
                </div>

                <h3 style="color: #333;">Activity Log Details</h3>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 13px;">
                    <tr style="background: #f9fafb;">
                        <th style="border:1px solid #ddd;padding:8px;">Subject</th><th style="border:1px solid #ddd;padding:8px;">Assigned To</th><th style="border:1px solid #ddd;padding:8px;">Status</th><th style="border:1px solid #ddd;padding:8px;">Starts On</th><th style="border:1px solid #ddd;padding:8px;">Ends On</th>
                    </tr>
                    {event_rows if event_rows else "<tr><td colspan='5' style='padding:20px;text-align:center;'>No events records for today.</td></tr>"}
                </table>
                <div style="text-align: right;">
                    <a href="{act_url}" target="_blank" style="display:inline-block; background: #0047AB; color: white; padding: 8px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 13px;">Full Activity Report →</a>
                </div>
            </div>
            
            <div style="padding: 20px; text-align: center; border-top: 1px solid #f0f0f0; color: #888; font-size: 11px;">
                Automated System Message | Powered by ERP Intelligence
            </div>
        </div>
    </div>
    """