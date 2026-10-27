# Print formats (Sales Invoice copies, orders, delivery notes, Credit / Debit Notes, receipts)

All of these are **app print formats** (`erp_dacsinc_custom/print_format/<name>/<name>.json`,
Standard = Yes): migrate loads a file whenever its `modified` is newer than the site's copy, so a
change reaches live with the code — change the file, bump its `modified`, never edit them only in
the desk.

| Format | For | What it prints |
|---|---|---|
| **Sales invoice Print Format 4** | Sales Invoice | the invoice layout (a builder format; its item table is a Custom HTML block that leaves out freight / packing / insurance lines — they print in the totals, `docs/charges.md`). Its file carries the site's version and its own `modified`, so migrate leaves the site copy as it is. |
| **Sales Invoice Multi Copy Master** | Sales Invoice | Format 4 once per copy with its label. A return hands over to Credit Note DAC. |
| **Credit Note DAC** / **Debit Note DAC** | Sales / Purchase Invoice returns | see `docs/returns.md` › Printing |
| **Purchase Invoice DAC** | Purchase Invoice (form › Print Purchase Invoice, with the copy choice; a return prints as Debit Note DAC) | the supplier's bill: supplier, their bill no. / date, due date, our PO and receipt numbers, items, GST summary, totals, remarks — the Debit Note's layout |
| **Payment Receipt DAC** | Payment Entry (default print format, `custom/payment_entry.json`) | Receipt Voucher / Payment Voucher / Contra Voucher ; notes "Part of Bulk Payment …" |
| **Bulk Payment Receipt** | Bulk Payment (default) | one Receipt / Payment Voucher for the whole amount: parties, invoices, set-off, Payment Entry per party — see `docs/bulk-payment.md` |
| **Sales Order Print Format 3** | Sales Order (default; form button with "DAC Letter Header") | Format 4's layout for an order |
| **Purchase Order Print Format** | Purchase Order (default; Print PO on a submitted PO, on a saved draft of a normal PO, and in Order Flow; no letter head) | its own company header (bordered box) + Format 4's layout |
| **Subcontracting Order Print Format 3** | Subcontracting Order (Print SCO / Order Flow, no letter head) | Goods Issue Note: issue and receivable tables |
| **Proforma Invoice Quotation** | Quotation (default) | proforma invoice |
| **Delivery Note Version 3** / **Delivery Note Without Amount Version 3** | Delivery Note › Custom Print › With / Without Amount (`public/js/delivery_note.js`, document's letter head) | Format 4's layout, with / without rates and totals |
| **Delivery Note Print Format with Amount** / **without Amount** | Delivery Note (default in the Print menu, no letter head) | the older challan layout with its own header |
| **Embroidery Work Order Print Format** / **… 2** | Embroidery Work Order (format 1 from the buttons, no letter head) | jobber work order |
| **POS Invoice A4** / **POS Invoice A5** / **POS Invoice Version 2** | POS Invoice (POS Profile › Print Format) | the POS template (Version 2) on A4 / A5 with blank rows to the page bottom, or the roll receipt — `docs/pos-store-scope.md` › Print formats |

The Delivery Note buttons came from a DB Client Script "Delivery Note" whose two buttons both opened the
without-amount format; `patches/dn_print_buttons_to_app.py` disables it (only while its live code is just
those buttons). Letter head "DAC Letter Header" is put in the same bordered box as "DAC Letter Header
quotation" by `patches/letter_head_border.py` (styling only; its own text stays).

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

## Uniform layout (all the formats above)

**Sizes:** heading strip 12pt title + 9pt No / Date (the copy chip on the right where there is one),
party / header details 8.5pt, items and totals 9pt, grand total 10pt, amount in words 8.5pt, bank line
8pt, terms 7.5pt, signature 8.5pt with a ~11 mm signing gap.

**Item columns:** Price List Rate and Discount (Credit / Debit Note: List Rate, Disc.) print only when the
document has a discount — a line with a discount amount, or a rate below its price list rate; otherwise the
table shows only Rate. A markup (rate above the list price) is not a discount. Each item table starts with
`dacs_disc` (Jinja) and, without a discount, carries class `dacs-nodisc`, which hides the `.dacs-d` header,
value and `<col>` cells — in the blank rows too (their cell count drops by the same number). All amounts are
right-aligned. POS Invoice Version 2 (and the A4 / A5 bills built from it) has always worked this way.

**Page margins:** wkhtmltopdf takes the page margins from a `.print-format { … }` rule
(`frappe/utils/pdf.py › get_print_format_styles`); the Print Format's Margin fields are used only by
WeasyPrint. With the page-number footer present and no bottom margin set, wkhtmltopdf drops the top
margin (content at the page edge), so formats that draw their header in the page body (Format 4, Credit
/ Debit Note, the challans, receipts, Embroidery 1) set **both** top and bottom (10 mm), with a
`@media print` rule keeping that margin off the page's own box. **Builder formats** whose letter head /
heading is the PDF page header (Sales Order 3, Purchase Order, Subcontracting Order 3, Proforma,
Delivery Note Version 3, Embroidery 2) must **not** carry that rule — it squeezes the page header out
(no letter head on the PDF). The letter head's own gaps are tightened in CSS (the Letter Head record is
shared). Terms written in the editor carry Quill's `height: 100%`, padding and scroll bars; every format
resets them (`.ql-editor`), or the terms box stretches to the page and shows scroll arrows.

**Header details (Format 4):** only the detail rows with a value print (a pair keeps its filled half; an
empty row is left out), so the header box is as tall as what it holds.

## Blank rows instead of empty space

The item table is followed, inside a `.dacs-items-box`, by a `.dacs-fill-wrap`: a table of 60 empty
rows with the same columns, clipped. A **page box** — the page made a vertical (legacy `-webkit-box`)
box of the printable height, the items section stretching — gives the clipped rows exactly the space
left, so the item table runs down to the totals whatever the header, address, items or terms take.
No JavaScript runs in the PDF, so nothing is counted.

wkhtmltopdf's legacy box has two traps, which shape how it is used:
- `min-height` on the box is ignored on some documents (blank space left); a fixed `height` is honoured.
- On a document longer than one page the box spoils page breaking (gaps, overlapping blocks).

So on the builder formats and Format 4 the box (with a fixed height) is switched on **only when the
document surely fits on one page**: a Jinja estimate of the free space at the page bottom (mm) from the
content — item lines (long names count extra), address lines, HSN codes, tax lines, terms / notes length,
supplied items — with weights fitted to measured documents (each format's estimate never exceeds the
real free space of any measured document, and no 2-page document passes the threshold, +8 mm safety).
A longer document prints as plain flow (no blank rows); `.dacs-fill-wrap` is `display: none` unless the
box shows it. Credit / Debit Note and the two older challans use `min-height` boxes (they behave there); Purchase Invoice DAC
switches to a fixed height when its item lines (long names count extra) are at most 11, else plain flow.
Box heights (mm) are measured per format on a 1-page document: the largest that stays one page, less 1.

Measured 28-Oct-2026 on the recent documents of each format: every 1-page document stays one page, the
short ones end 1–11 mm above the page footer. Changing a font size, padding or a block's height means
re-measuring the box height and the estimate's weights (render the recent documents, `pdfinfo` for pages).

The form button used to come from a DB Client Script "sales invoice Form new" (no All 4 choice);
`patches/si_print_button_to_app.py` disables that script (only while its sole live code is that
button) and the button now lives in `public/js/sales_invoice.js`.

## Checking a site (`print_check.py`)

After a deploy: `bench --site <site> execute erp_dacsinc_custom.print_check.run` (read-only). It lists every
print format shipped in this app — OK when the site's copy is the app's version (its `modified` not older than
the file's), OLD / MISSING otherwise, with the markup it carries (blank rows, discount columns, margins) —
prints the latest documents of each format to count their pages, and reports the "DAC Letter Header" box, the
old Delivery Note Client Script and whether the two print patches ran (a patch run by hand, not by migrate,
shows NOT RUN). A format left OLD is loaded with `frappe.reload_doc('erp_dacsinc_custom', 'print_format',
'<folder>', force=1)`. Print formats that live only in the database (not in this app) are not checked or changed.

## Payment Receipt DAC

One Payment Entry, however many invoices it settles:

- **RECEIPT VOUCHER** (Receive, "Received with thanks from"), **PAYMENT VOUCHER** (Pay, "Paid to"),
  **CONTRA VOUCHER** (Internal Transfer, from / to account); chip RECEIVED / PAID / DRAFT / CANCELLED.
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

## Quotation PDF ("Quotation print format 7Apr")

DB-only print format (not shipped in the app) used by `custom_script.download_quotation_pdf`, with letter
head "DAC Letter Header quotation". All content is one Custom HTML block. Keep no empty HTML block after
it: an empty block still renders a row, and on the server — which has no Arial, so the PDF uses the
wider DejaVu Sans — a quotation that just fills page 1 then got a second page holding only the letter
head (`patches/quotation_print_format_blank_page.py` removed it). Check page breaks with DejaVu Sans,
not with a local Arial / Helvetica.

## Tax / charge rows only when not 0

Every DAC print format prints a tax or charge row (SGST, Freight and Forwarding, Packing Charges, …)
only when its amount is not 0: `{% for tax in doc.taxes if tax.tax_amount %}`, or an `if` on
`tax_amount` inside the loop. Keep this in new formats. ERPNext's own "Return POS Invoice" and
"Point of Sale" formats are left as shipped.
