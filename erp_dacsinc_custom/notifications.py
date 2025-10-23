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