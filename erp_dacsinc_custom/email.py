import frappe
import smtplib
import requests
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication

def send_custom_email(to, subject, message, cc=None, attachment_url=None, attachment_name=None):
    """
    Send email using SMTP configuration from Admin Settings > Email Account.

    Args:
        to (str | list): Recipient email(s)
        subject (str): Email subject
        message (str): HTML message content
        cc (list, optional): CC email list
        attachment_url (str, optional): File or PDF URL to attach
        attachment_name (str, optional): Name of the attached file
    """
    try:
        # Convert single to list
        if isinstance(to, str):
            to = [to]
        if not cc:
            cc = []

        # Get email account from Admin Settings
        admin_settings = frappe.get_doc("Admin Settings")
        if not admin_settings.email_account:
            frappe.throw("⚠️ Email Account not set in Admin Settings.")

        email_account = frappe.get_doc("Email Account", admin_settings.email_account)
        smtp_username = email_account.email_id
        smtp_password = email_account.get_password("password")

        # Prepare message
        msg = MIMEMultipart()
        msg["From"] = smtp_username
        msg["To"] = ", ".join(to)
        if cc:
            msg["Cc"] = ", ".join(cc)
        msg["Subject"] = subject
        msg.attach(MIMEText(message, "html"))

        # Add attachment (optional)
        if attachment_url:
            pdf_response = requests.get(attachment_url)
            if pdf_response.status_code == 200:
                filename = attachment_name or attachment_url.split("/")[-1]
                attachment = MIMEApplication(pdf_response.content)
                attachment.add_header("Content-Disposition", "attachment", filename=filename)
                msg.attach(attachment)

        # Send email via Gmail SMTP (or you can adjust host)
        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(smtp_username, smtp_password)
        server.sendmail(smtp_username, to + cc, msg.as_string())
        server.quit()

        frappe.logger().info(f"✅ Email sent to {to} (CC: {cc})")

    except Exception as e:
        frappe.log_error(f"❌ Error sending email: {e}")
        frappe.throw(f"Failed to send email: {str(e)}")
