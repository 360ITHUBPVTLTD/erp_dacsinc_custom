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

@frappe.whitelist()
def execute_scheduled_reports():
    """
    Called by Cron at 8:30 PM.
    """
    # 1. Update Overdue statuses so the reports show the latest numbers
    update_overdue_activities_status()
    
    # 2. Trigger the Mailing Logic (Dispatch Email to Team)
    generate_daily_report(send_mail=1)



@frappe.whitelist()
def generate_daily_report(send_mail=0):
    send_mail = bool(int(send_mail))
    settings = frappe.get_single("Admin Settings")
    base_url = get_url()
    
    # Get Company Name for the Subject
    company_name = frappe.defaults.get_global_default("common_company") or "Dac's Inc"
    
    report_date = today()
    display_date = format_date(report_date, "dd-MMM-yyyy")
    start_day = f"{report_date} 00:00:00"
    end_day = f"{report_date} 23:59:59"

    # --- 1. DATA GATHERING (Total Records) ---
    leads_today = frappe.db.get_all("Lead", 
        filters={"creation": ["between", [start_day, end_day]]},
        fields=["lead_owner", "name", "first_name", "company_name"]
    )

    # Activity Log Fetch (Including owner AND assigned_to)
    activities_all = frappe.get_all("Event Activity",
        or_filters=[
            ["creation", "between", [start_day, end_day]],
            ["ends_on", "between", [start_day, end_day]]
        ],
        fields=["name", "subject", "status", "starts_on", "category", "owner", "assigned_to", "creation", "notes"],
        order_by="creation desc"
    )

    # --- 2. USER NAME MAPPING (Emails to Names) ---
    involved_emails = set([l.lead_owner for l in leads_today if l.lead_owner] + 
                          [a.owner for a in activities_all] + 
                          [a.assigned_to for a in activities_all if a.assigned_to])
    
    name_map = {}
    for email in involved_emails:
        f_name = frappe.db.get_value("User", email, "full_name")
        name_map[email] = f_name or email

    # Lead summary using full names
    lead_summary_manager = {}
    for l in leads_today:
        f_name = name_map.get(l.lead_owner, "Unassigned")
        lead_summary_manager[f_name] = lead_summary_manager.get(f_name, 0) + 1

    # URLs for system redirection
    date_p = urllib.parse.quote(json.dumps([report_date, report_date]))
    lead_report_url = f"{base_url}/app/query-report/Lead Report?custom_created_at_option=Custom&custom_created_at={date_p}"
    act_report_url = f"{base_url}/app/query-report/Lead Report?inverse_report=1&custom_created_at_option=Custom&custom_created_at={date_p}"

    # Generate Manager View
    mgmt_html = get_clean_template(
        display_date, lead_summary_manager, activities_all, base_url, 
        lead_report_url, act_report_url, len(leads_today), 
        len([a for a in activities_all if str(a.creation) >= start_day]),
        len([a for a in activities_all if a.status == "Completed"]), 
        0, name_map, is_individual=False
    )

    if send_mail:
        # A. SEND TO MANAGEMENT
        if settings.to_mail_id:
            frappe.sendmail(
                recipients=[r.strip() for r in settings.to_mail_id.split(",") if r.strip()],
                subject=f"{company_name} | Daily Team Dashboard | {display_date}",
                content=mgmt_html,
                now=True
            )

        # B. SEND TO INDIVIDUAL USERS (BASED ON OWNER OR ASSIGNED TO)
        for email in involved_emails:
            if not email or "@" not in email: continue
            
            # Logic: Fetch work user is Lead Owner, Task Owner, OR Assigned User
            p_leads = [l for l in leads_today if l.lead_owner == email]
            p_acts = [a for a in activities_all if a.owner == email or a.assigned_to == email]
            
            p_full_name = name_map.get(email, email)
            p_lead_count = len(p_leads)
            p_cre_count = len([a for a in p_acts if str(a.creation) >= start_day])
            p_don_count = len([a for a in p_acts if a.status == "Completed"])
            
            # Pre-filtered links for the specific user
            u_lead_link = f"{lead_report_url}&lead_owner={email}"
            u_act_link = f"{act_report_url}&owner={email}"

            user_html = get_clean_template(
                display_date, {p_full_name: p_lead_count}, p_acts, base_url, 
                u_lead_link, u_act_link, p_lead_count, p_cre_count, p_don_count, 0, name_map, is_individual=True
            )

            frappe.sendmail(
                recipients=[email],
                subject=f"{company_name} - {p_full_name} - Daily Activity Log",
                content=user_html,
                now=True
            )

        return {"status": "success", "message": "Manager dashboard and user personal logs successfully delivered."}

    return {"status": "success", "html": mgmt_html}

def get_clean_template(date, l_summary, activities, base_url, l_url, a_url, nl, nc, ncom, novr, name_map, is_individual=False):
    accent_blue = "#4361ee" 
    title = "My Daily CRM Performance" if is_individual else "CRM Performance Overview"

    summary_html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 25px; table-layout: fixed;">
        <tr>
            <td style="padding: 10px; width:33.3%;">
                <div style="border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; text-align: center; background: #fff;">
                    <span style="color: #6c757d; font-size: 11px; text-transform: uppercase;">Leads Added</span><br>
                    <span style="font-size: 22px; font-weight: bold; color: {accent_blue};">{nl}</span>
                </div>
            </td>
            <td style="padding: 10px; width:33.3%;">
                <div style="border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; text-align: center; background: #fff;">
                    <span style="color: #6c757d; font-size: 11px; text-transform: uppercase;">Tasks Created</span><br>
                    <span style="font-size: 22px; font-weight: bold; color: #343a40;">{nc}</span>
                </div>
            </td>
            <td style="padding: 10px; width:33.3%;">
                <div style="border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; text-align: center; background: #fff;">
                    <span style="color: #198754; font-size: 11px; text-transform: uppercase;">Done Today</span><br>
                    <span style="font-size: 22px; font-weight: bold; color: #198754;">{ncom}</span>
                </div>
            </td>
        </tr>
    </table>
    """

    l_rows = "".join([f'<tr><td style="padding: 12px; border-bottom: 1px solid #f1f3f5;">{name}</td><td style="padding: 12px; border-bottom: 1px solid #f1f3f5; text-align: right; color:#212529;"><b>{count} New</b></td></tr>' for name, count in l_summary.items()])

    act_rows = ""
    for a in activities:
        st_color = "#198754" if a.status == "Completed" else "#343a40"
        # Combine creator name and assigned user name for transparency
        owner_name = name_map.get(a.owner, a.owner)
        assigned_name = name_map.get(a.assigned_to, "No User") if a.assigned_to else owner_name
        
        act_rows += f"""
            <tr style="font-size: 13px;">
                <td style="padding: 12px; border-bottom: 1px solid #f1f3f5;"><a href="{base_url}/app/event-activity/{a.name}" style="color:{accent_blue}; text-decoration:none; font-weight:bold;">{a.subject}</a></td>
                <td style="padding: 12px; border-bottom: 1px solid #f1f3f5; color:{st_color}; font-weight:bold;">{a.status}</td>
                <td style="padding: 12px; border-bottom: 1px solid #f1f3f5; color:#6c757d;">{format_datetime(a.starts_on) if a.starts_on else "-"}</td>
                <td style="padding: 12px; border-bottom: 1px solid #f1f3f5;">{a.category or '-'}</td>
                <td style="padding: 12px; border-bottom: 1px solid #f1f3f5; color:#495057;">{assigned_name}</td>
                <td style="padding: 12px; border-bottom: 1px solid #f1f3f5; font-size: 11px; color: #9da5af;">{format_date(a.creation)}</td>
                <td style="padding: 12px; border-bottom: 1px solid #f1f3f5; font-size: 12px; font-style:italic; color:#adb5bd;">{a.note or "-"}</td>
            </tr>
        """

    def btn(url, text):
        return f"""<div style="text-align: right; margin-top: 15px; margin-bottom: 40px;"><a href="{url}" style="background-color: {accent_blue}; color: white; padding: 10px 18px; text-decoration: none; border-radius: 8px; font-size: 13px; font-weight: bold;">View Details Report &rarr;</a></div>"""

    return f"""
    <div style="background-color: #f8fafc; padding: 25px; font-family: 'Inter', -apple-system, sans-serif;">
        <div style="max-width: 950px; margin: auto; background: white; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.03);">
            <div style="background: {accent_blue}; padding: 35px 30px; color: #fff;">
                <h2 style="margin: 0; font-size: 24px; font-weight: 800;">{title}</h2>
                <p style="margin: 5px 0 0; opacity: 0.9;">Progress Summary | <b>{date}</b></p>
            </div>
            
            <div style="padding: 30px;">
                {summary_html}

                <h3 style="border-left: 5px solid {accent_blue}; padding-left: 12px; color: #212529; font-size: 18px; margin-bottom: 15px;">New Leads Created Today</h3>
                <table width="100%" style="border-collapse: collapse;">
                    {l_rows if l_rows else "<tr><td colspan='2' style='padding:20px; text-align:center; color:#94a3b8;'>No activity in leads recorded today.</td></tr>"}
                </table>
                {btn(l_url, "Open Lead Registry")}

                <h3 style="border-left: 5px solid #198754; padding-left: 12px; color: #212529; font-size: 18px; margin-top: 20px; margin-bottom: 15px;">Today's Activity Log</h3>
                <div style="overflow-x: auto;">
                    <table width="100%" style="border-collapse: collapse; min-width: 800px;">
                        <thead style="background: #f8f9fa; border-bottom: 2px solid #dee2e6; font-size: 10px; text-transform: uppercase; color: #6c757d;">
                            <tr><th style="padding:12px; text-align:left;">Topic</th><th style="padding:12px; text-align:left;">Status</th><th style="padding:12px; text-align:left;">Scheduled</th><th style="padding:12px; text-align:left;">Cat</th><th style="padding:12px; text-align:left;">Done By</th><th style="padding:12px; text-align:left;">Created</th><th style="padding:12px; text-align:left;">Note</th></tr>
                        </thead>
                        <tbody>{act_rows if act_rows else "<tr><td colspan='7' style='padding:30px; text-align:center; color:#94a3b8;'>No task updates recorded.</td></tr>"}</tbody>
                    </table>
                </div>
                {btn(a_url, "Explore Full Work Dashboard")}
            </div>
            
            <div style="background: #f9f9f9; padding: 25px; text-align: center; color: #ced4da; font-size: 11px;">
                Performance Intelligence System &bull; Private and Confidential Log
            </div>
        </div>
    </div>
    """