"""Point of Sale › Email Receipt (docs/pos-store-scope.md).

The receipt goes out from the store's own email account (POS Profile › Receipt Email
Account) only, never the site's default account; without one, sending is refused and
the user is told to set it. The message box starts with POS Profile › Receipt Email
Message (staff may change it), and the customer gets a proper receipt email with the
invoice PDF (the profile's print format) attached. The addresses it was sent to are
kept on the invoice (POS Invoice › Receipt Emailed To).
"""

import frappe
from frappe import _
from frappe.utils import escape_html, flt, fmt_money, format_date, format_time

DEFAULT_PRINT_FORMAT = "POS Invoice Version 2"


def _profile(pos_profile):
	return frappe.db.get_value("POS Profile", pos_profile, ["name", "company", "company_address", "print_format",
		"letter_head", "custom_store_name", "custom_receipt_email_account", "custom_receipt_email_message"], as_dict=True)


def _store(prof, doc):
	"""The store as customers know it: the bill's Store Name (POS Invoice › Store Name,
	fetched from the POS Profile when the bill was made), else the profile's current
	Store Name, else the profile's name."""
	return ((doc.get("custom_store_name") or "").strip() or ((prof or {}).get("custom_store_name") or "").strip()
			or doc.pos_profile)


def fill_store_names(doc=None, method=None):
	"""POS Invoice › Store Name on bills that have none, from their POS Profile.
	after_migrate (all profiles) and POS Profile on_update (that profile). A bill that
	already has a name keeps it: it says where it was sold, even if the profile's
	Store Name changes later."""
	cond, args = "", {}
	if doc is not None:
		cond, args = "and p.name = %(profile)s", {"profile": doc.name}
	frappe.db.sql(f"""
		update `tabPOS Invoice` i join `tabPOS Profile` p on p.name = i.pos_profile
		set i.custom_store_name = p.custom_store_name
		where ifnull(i.custom_store_name, '') = '' and ifnull(p.custom_store_name, '') != '' {cond}
	""", args)


def _who(doc):
	"""The buyer's name: the walk-in name on the bill. Stores bill on one fixed customer
	(e.g. "JP Nagar"), so the customer name is never used for the greeting."""
	return (doc.get("custom_walkin_name") or "").strip()


def _fill(text, doc, store):
	"""{customer}, {invoice}, {amount}, {store} in the profile's message ({customer} is the
	walk-in name, else "Customer")."""
	who = _who(doc) or _("Customer")
	values = {"customer": who, "invoice": doc.name, "store": store,
			  "amount": fmt_money(doc.rounded_total or doc.grand_total, currency=doc.currency)}
	for key, value in values.items():
		text = text.replace("{" + key + "}", str(value or ""))
	return text


@frappe.whitelist()
def get_receipt_defaults(invoice):
	"""For the Email Receipt box: the profile's message (placeholders filled) and
	whether a sending account is set."""
	doc = frappe.get_doc("POS Invoice", invoice)
	doc.check_permission("read")
	prof = _profile(doc.pos_profile) or frappe._dict()
	last = (doc.get("custom_receipt_emailed_to") or "").split("\n")[0].split(" — ")[0].strip()
	return {
		"message": _fill(prof.custom_receipt_email_message or "", doc, _store(prof, doc)),
		"last_email": last,
		"account_set": bool(prof.custom_receipt_email_account),
		"pos_profile": doc.pos_profile,
	}


@frappe.whitelist(methods=["POST"])
def send_receipt(invoice, recipients, message=None):
	doc = frappe.get_doc("POS Invoice", invoice)
	doc.check_permission("read")
	if doc.docstatus != 1:
		frappe.throw(_("Only a completed order can be emailed."))
	prof = _profile(doc.pos_profile)
	if not prof or not prof.custom_receipt_email_account:
		frappe.throw(_("No email account is set for store {0}. Ask an admin to choose one in POS Profile {0} › "
					   "Receipt Email Account, then send again.").format(frappe.bold(doc.pos_profile)),
					 title=_("Select the email account"))
	account = frappe.db.get_value("Email Account", prof.custom_receipt_email_account,
								  ["name", "email_id", "enable_outgoing"], as_dict=True)
	if not account or not account.enable_outgoing:
		frappe.throw(_("Email account {0} (POS Profile {1}) can't send mail: it is missing or its outgoing mail is off. "
					   "Choose a working account in POS Profile › Receipt Email Account.").format(
			frappe.bold(prof.custom_receipt_email_account), frappe.bold(doc.pos_profile)), title=_("Select the email account"))

	to = [e.strip() for e in (recipients or "").replace(";", ",").split(",") if e.strip()]
	for e in to:
		frappe.utils.validate_email_address(e, throw=True)
	if not to:
		frappe.throw(_("Enter the customer's email address."))

	print_format = prof.print_format or DEFAULT_PRINT_FORMAT
	# Always a PDF (Print Settings may send prints as HTML).
	pdf = {"fname": f"Receipt-{doc.name}.pdf", "fcontent": frappe.get_print(
		"POS Invoice", doc.name, print_format=print_format, doc=doc, as_pdf=True,
		letterhead=prof.letter_head or None, no_letterhead=0 if prof.letter_head else 1)}
	store_name = doc.get("custom_store_name") or prof.custom_store_name or prof.company or doc.company
	html = receipt_html(doc, prof, (message or "").strip())
	# The customer sees the store, not a bare address: "Dac's Inc – JP Nagar <…@…>".
	sender_name = "".join(ch for ch in _store(prof, doc) if ch not in ',;<>"\r\n').strip()
	queued = frappe.sendmail(
		recipients=to,
		sender=f"{sender_name} <{account.email_id}>" if sender_name else account.email_id,
		subject=_("Your receipt {0} from {1}").format(doc.name, store_name),
		message=html,
		attachments=[pdf],
		reference_doctype="POS Invoice",
		reference_name=doc.name,
	)
	# Sent in the background straight away (not on the user's click: SMTP can take
	# seconds or hang, which kept the Email Receipt box open), not left for the scheduler.
	if queued:
		frappe.enqueue("erp_dacsinc_custom.pos_receipt_email.send_queued", queue="short",
					   name=queued.name, enqueue_after_commit=True)
	# POS Invoice › Receipt Emailed To (allowed on submit): each send on its own line, latest first.
	line = f"{', '.join(to)} — {frappe.utils.format_datetime(frappe.utils.now_datetime(), 'dd-MM-yyyy HH:mm')}"
	doc.db_set("custom_receipt_emailed_to", "\n".join(filter(None, [line, doc.get("custom_receipt_emailed_to")])),
			   update_modified=False)
	doc.add_comment("Info", _("Receipt emailed to {0} from {1}").format(", ".join(to), account.email_id))
	return {"sent_to": to, "sender": account.email_id}


def send_queued(name):
	"""Background: send one queued receipt mail now (Email Queue keeps the status and
	any error; a failed one is retried by the scheduler as usual)."""
	from frappe.email.doctype.email_queue.email_queue import EmailQueue

	record = EmailQueue.find(name)
	if record and record.status == "Not Sent":
		record.send()


def receipt_html(doc, prof, message):
	"""The email the customer reads: light and friendly, inline styles only (mail clients
	drop <style>), and 600px wide at most so it reads well on a phone."""
	cur = doc.currency
	money = lambda v: escape_html(fmt_money(flt(v), currency=cur))
	accent, ink, soft, line_c, tint = "#0f766e", "#1f2937", "#6b7280", "#e5e7eb", "#f0fdfa"
	company = prof.company or doc.company
	store = escape_html(company)
	store_label = _store(prof, doc)
	branch = escape_html(store_label)
	# Store Name often starts with the company ("Dac's Inc – JP Nagar"): under the company
	# name at the top only the rest ("JP Nagar") is shown, and the footer names it once.
	sub = store_label
	if company and store_label.lower().startswith(company.lower()):
		sub = store_label[len(company):].lstrip(" –-—·|,:") or store_label
	sub = escape_html(sub)
	who = _who(doc)
	greeting = _("Dear {0},").format(escape_html(who)) if who else _("Dear Customer,")
	logo = frappe.db.get_value("Company", company, "company_logo")
	brand = (f'<img src="{escape_html(frappe.utils.get_url(logo))}" alt="{store}" style="max-height:56px;max-width:220px;">'
			 if logo else f'<div style="font-size:24px;font-weight:700;color:{accent};letter-spacing:.5px;">{store}</div>')
	address = ""
	if prof.company_address:
		from frappe.contacts.doctype.address.address import get_address_display
		address = get_address_display(prof.company_address) or ""
	msg_html = escape_html(_fill(message, doc, _store(prof, doc))).replace("\n", "<br>") if message else \
		_("Thank you for shopping with us! Here is your receipt. The invoice is attached as a PDF.")
	total = money(doc.rounded_total or doc.grand_total)
	when = f"{format_date(doc.posting_date)}" + (f" · {format_time(doc.posting_time)[:5]}" if doc.posting_time else "")

	cell = f"padding:10px 0;border-bottom:1px solid {line_c};font-size:14px;"
	rows = "".join(f"""
		<tr>
		  <td style="{cell}color:{ink};">{escape_html(i.item_name or i.item_code)}</td>
		  <td style="{cell}color:{soft};text-align:center;white-space:nowrap;padding-left:8px;padding-right:8px;">{flt(i.qty):g} {escape_html(i.uom or '')}</td>
		  <td style="{cell}color:{ink};text-align:right;white-space:nowrap;">{money(i.amount)}</td>
		</tr>""" for i in doc.items)

	def line(label, value, strong=False):
		style = f"font-size:17px;font-weight:700;color:{ink};padding-top:10px;border-top:1px solid {line_c};" if strong else f"font-size:14px;color:{soft};"
		return f'<tr><td style="padding:4px 0;{style}">{label}</td><td style="padding:4px 0;text-align:right;{style}">{value}</td></tr>'
	totals = line(_("Net Total"), money(doc.net_total))
	for t in doc.taxes or []:
		if flt(t.tax_amount):
			totals += line(escape_html(t.description or t.account_head), money(t.tax_amount))
	if flt(doc.discount_amount):
		totals += line(_("Discount"), "− " + money(doc.discount_amount))
	totals += line(_("Total"), total, strong=True)
	label = f"font-size:11px;color:{soft};text-transform:uppercase;letter-spacing:.6px;"
	footer = (branch if company.lower() in store_label.lower() else f"{store} · {branch}") + (f"<br>{address}" if address else "")

	return f"""
<div style="background:#f6f7f9;padding:28px 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:{ink};">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid {line_c};border-top:5px solid {accent};">
  <tr><td style="padding:28px 32px 8px;text-align:center;">
    {brand}
    <div style="font-size:13px;color:{soft};margin-top:4px;">{sub}</div>
  </td></tr>
  <tr><td style="padding:14px 32px 0;text-align:center;">
    <div style="font-size:22px;font-weight:700;color:{ink};">{_("Thank you for your purchase!")}</div>
  </td></tr>
  <tr><td style="padding:18px 32px 0;">
    <div style="font-size:15px;color:{ink};">{greeting}</div>
    <div style="font-size:14px;color:#374151;line-height:1.65;margin-top:8px;">{msg_html}</div>
  </td></tr>
  <tr><td style="padding:20px 32px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{tint};border-radius:10px;border:1px solid #ccfbf1;">
      <tr>
        <td style="padding:14px 16px;"><div style="{label}">{_("Bill No")}</div><div style="font-size:15px;font-weight:700;margin-top:3px;">{escape_html(doc.name)}</div></td>
        <td style="padding:14px 16px;"><div style="{label}">{_("Date")}</div><div style="font-size:15px;font-weight:700;margin-top:3px;white-space:nowrap;">{escape_html(when)}</div></td>
        <td style="padding:14px 16px;text-align:right;"><div style="{label}">{_("Amount")}</div><div style="font-size:18px;font-weight:700;color:{accent};margin-top:2px;white-space:nowrap;">{total}</div></td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="padding:22px 32px 0;">
    <div style="{label}margin-bottom:6px;">{_("Your items")}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>
  </td></tr>
  <tr><td style="padding:12px 32px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{totals}</table>
  </td></tr>
  <tr><td style="padding:22px 32px 0;">
    <div style="background:#f9fafb;border-radius:10px;padding:14px 16px;font-size:13px;color:#374151;line-height:1.6;">
      &#128206; {_("Your invoice is attached as a PDF. Please keep it handy for any exchange.")}
    </div>
  </td></tr>
  <tr><td style="padding:24px 32px 28px;text-align:center;">
    <div style="font-size:15px;font-weight:700;color:{accent};">{_("We look forward to seeing you again!")}</div>
    <div style="font-size:13px;color:{soft};margin-top:4px;">{_("Team {0}").format(store)}</div>
  </td></tr>
  <tr><td style="background:#f9fafb;padding:16px 32px;text-align:center;font-size:12px;color:#9ca3af;line-height:1.6;border-top:1px solid {line_c};">
    {footer}
  </td></tr>
 </table>
</div>"""
