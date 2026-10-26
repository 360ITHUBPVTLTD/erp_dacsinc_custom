"""Letter Head "DAC Letter Header" in the same bordered box as "DAC Letter Header quotation"
(docs/print-formats.md › Letter heads).

Only the styling changes: logo | company | GST / PAN / MSME cells with borders and the rule under it, as on
the Sales Invoice. Its own text (accounts@ e-mail, no mobile) stays. Runs once: a letter head already
in the box, or edited by hand since (not the old plain layout), is left alone. Dated comment on change.
"""

import frappe
from frappe.utils import nowdate

NAME = "DAC Letter Header"
OLD_MARK = '<div style="border-bottom:1.5px solid #000; padding:10px 15px;">'

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
                    Phone: 080-41206892 | Email: accounts@dacsinc.in | Web: www.dacsinc.in
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
	content = frappe.db.get_value("Letter Head", NAME, "content")
	if not content or OLD_MARK not in content:
		return
	frappe.db.set_value("Letter Head", NAME, "content", CONTENT)
	frappe.get_doc({"doctype": "Comment", "comment_type": "Comment", "reference_doctype": "Letter Head",
					"reference_name": NAME,
					"content": f"{nowdate()}: header put in the bordered box (logo | company | GST / PAN / MSME) like "
							   "\"DAC Letter Header quotation\"; its own text unchanged"}).insert(ignore_permissions=True)
