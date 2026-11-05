"""Letter Head "DAC Letter Header Sales Invoice": the Sales Invoice's own header (docs/print-formats.md › Letter heads).

Same box as "DAC Letter Header quotation" (logo | company | GST / PAN / MSME), with the accounts contact:
Mob.No. 6364096611 and accounts@dacsinc.in. Sales Invoice Multi Copy Master prints it on every Sales Invoice
copy; the quotation letter head (the default, used by the other documents) is not touched. Created once, not
default; a letter head already there is left as it is. Dated comment on create.
"""

import frappe
from frappe.utils import nowdate

NAME = "DAC Letter Header Sales Invoice"

CONTENT = """<div style="margin-bottom:12px;">
<table style="width:100%; border-collapse:collapse; border:1px solid #000;">
    <tbody>
        <tr>
            <td style="width:125px; text-align:center; vertical-align:middle; border-right:1px solid #000; padding:6px;">
                <img src="/files/Dacs inc Logo.jpeg" style="max-width:115px; max-height:100px; width:auto; height:auto; object-fit:contain; display:block; margin:0 auto;">
            </td>
            <td style="vertical-align:middle; border-right:1px solid #000; padding:8px 12px;">
                <div style="font-size:18px; font-weight:bold; letter-spacing:0.5px;">
                    Dac's Inc
                </div>
                <div style="font-size:10px; line-height:1.4; margin-top:4px;">
                    Jaya Sai Towers No.40, 1st &amp; 2nd Floor, Sajjan Rao Road, Parvathipuram,<br>
                    V.V.Puram, Bengaluru  - 560004<br>
                    Phone: 080-41206892 | Mob.No.: 6364096611 | Email: accounts@dacsinc.in | Web: www.dacsinc.in
                </div>
            </td>
            <td style="vertical-align:middle; text-align:right; font-size:11px; line-height:1.6; padding:8px 12px; width:210px; white-space:nowrap;">
                <strong>G.S.T. :</strong> 29AAIFD5710C1ZQ<br>
                <strong>PAN :</strong> AAIFD5710C<br>
                <span style="font-size:8.5pt;">
                    <strong>MSME No :</strong> UDYAM-KR-03-00310188
                </span>
            </td>
        </tr>
    </tbody>
</table>
<div style="border-bottom:1.5px solid #000; margin-top:8px;"></div>
</div>"""


def execute():
	if frappe.db.exists("Letter Head", NAME):
		return
	frappe.get_doc({"doctype": "Letter Head", "letter_head_name": NAME, "source": "HTML", "content": CONTENT,
					"is_default": 0}).insert(ignore_permissions=True)
	frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Letter Head",
					"reference_name": NAME,
					"content": f"{nowdate()}: Sales Invoice letter head created (as \"DAC Letter Header quotation\", "
							   "with Mob.No. 6364096611 and accounts@dacsinc.in); printed by Sales Invoice Multi Copy Master"}
				   ).insert(ignore_permissions=True)
