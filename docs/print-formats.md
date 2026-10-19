# Print formats (Sales Invoice copies, Credit / Debit Notes, Payment Receipt)

All of these are **app print formats** (`erp_dacsinc_custom/print_format/<name>/<name>.json`,
Standard = Yes): migrate loads a file whenever its `modified` is newer than the site's copy, so a
change reaches live with the code — change the file, bump its `modified`, never edit them only in
the desk.

| Format | For | What it prints |
|---|---|---|
| **Sales invoice Print Format 4** | Sales Invoice | the invoice layout (a builder format). Its file carries the site's version and its own `modified`, so migrate leaves the site copy as it is. |
| **Sales Invoice Multi Copy Master** | Sales Invoice | Format 4 once per copy with its label. A return hands over to Credit Note DAC. |
| **Credit Note DAC** / **Debit Note DAC** | Sales / Purchase Invoice returns | see `docs/returns.md` › Printing |
| **Payment Receipt DAC** | Payment Entry (default print format, `custom/payment_entry.json`) | Payment Receipt / Payment Voucher / Internal Transfer |

## Copies (Original / Duplicate / Triplicate / Quadruplicate)

URL parameters on `download_pdf`: a draft always prints **DRAFT COPY**; `print_all=1` → all four;
`copy_name=Duplicate` → that one; nothing → Original. The choice comes from
`public/js/print_prompt.js › dacs_print_copies` (Original … Quadruplicate, **All 4 copies**), used by
the Sales Invoice form's **Print Sales Invoice** button (Print Credit Note on a return), every Order
Flow › Finance row and the "print it now?" question after submit.

**Why the master rewrites Format 4's header:** Format 4 is a builder format, so Frappe wraps its
letter head and heading (with the copy chip) in `<div id="header-html">`. In a PDF, Frappe takes the
*first* `#header-html` as the page header for **every** page and deletes the others
(`frappe/utils/pdf.py › prepare_header_footer`) — so all four pages read "ORIGINAL". The master
renames that block to `class="dacs-copy-head"` so each copy keeps its own header in the page body.

The form button used to come from a DB Client Script "sales invoice Form new" (no All 4 choice);
`patches/si_print_button_to_app.py` disables that script (only while its sole live code is that
button) and the button now lives in `public/js/sales_invoice.js`.

## Payment Receipt DAC

One Payment Entry, however many invoices it settles:

- **PAYMENT RECEIPT** (Receive, "Received with thanks from"), **PAYMENT VOUCHER** (Pay, "Paid to"),
  **INTERNAL TRANSFER** (from / to account); chip RECEIVED / PAID / DRAFT / CANCELLED.
- Company letter head; party with GSTIN; mode of payment, cheque / ref. no. and date, our bank account.
- The invoices / bills settled: no., supplier bill no. (voucher), date, total, **amount set off**.
  (No "due before / balance": ERPNext stores a reference's outstanding as it was when the entry was
  last validated, which after submit is not the figure before the payment.)
- How the money and the deductions make up what was set off: on a receipt, TDS the customer
  deducted and bank charges **add** to the bank amount; on a voucher a negative deduction (TDS we
  deducted, write-off) adds and a positive one (bank charges) is extra paid; any **advance / on
  account** left unallocated.
- Amount in words, Remarks (only what the user typed — Custom Remarks; the Order Flow payment
  prompt ticks it), "Subject to realisation" for cheques, customer / receiver and authorised signatures.

Printed from the Payment Entry form (default format) and from the 🖨 in the "N payments" window of an
invoice on Order Flow › Finance.
