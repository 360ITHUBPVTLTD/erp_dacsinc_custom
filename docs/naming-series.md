# Document numbers (naming series)

Sales, purchase, stock and payment documents are numbered **PREFIX/26-27/00001**: the prefix, the short financial year,
a running number that starts again at 1 every 1 April (agreed with the user 29-10-2026).

| Document | Number | Return / variant |
|---|---|---|
| Sales Order | SO/26-27/00001 | |
| Delivery Note (challan) | DC/26-27/00001 | return: SR/26-27/00001 |
| Sales Invoice | SI/26-27/00001 | return (Credit Note): CN/26-27/00001 |
| POS Invoice | JP / RN / VA / VV /26-27/00001 by the store's warehouse; other counters POS/26-27/00001 | |
| Payment Entry | Receive RCT/26-27/0001 · Pay PAY/26-27/0001 · Internal Transfer CTR/26-27/0001 | |
| Material Request / RFQ / Supplier Quotation | MR/…/00001 · RFQ/…/0001 · SQ/…/00001 | |
| Purchase Order / Subcontracting Order | PO/…/00001 · JO/…/00001 | |
| Purchase Receipt / Subcontracting Receipt | GRN/…/0001 · JR/…/00001 | Purchase Receipt return: PRR/…/0001 |
| Purchase Invoice | PI/26-27/00001 | return (Debit Note): DBN/26-27/0001 |
| Journal Entry / Stock Entry / Stock Reconciliation | JV/…/00001 · STE/…/0001 · STR/…/0001 | |
| Quotation | unchanged: SAL-QTN-.YYYY.- | |

## Why this shape

- **GST**: an invoice, credit / debit note or delivery challan number is at most **16 characters** (letters, digits,
  "-" and "/"), unique within the financial year. Every base number above is 14 characters, because ERPNext names an
  amended document `<original>-1`: SI/26-27/00001-1 is exactly 16.
- **Short year**: ERPNext's `.FY.` gives "2026-2027" (SI/2026-2027/00001 = 17 characters), so the app adds the variable
  `.FYS.` (`naming_series_variables` in hooks.py → `naming.short_fiscal_year`): the document's date → its Fiscal Year →
  "26-27". A new year is a new prefix, so its counter starts at 1 on its own.
- **Next year**: ERPNext's daily job `auto_create_fiscal_year` makes the next Fiscal Year 3 days before the current one
  ends (2026-2027 on live was made that way). Without a Fiscal Year for its date a document can't be numbered.

## How

- `naming.py` › `set_series` (doc_events `"*"` › before_insert) sets `naming_series` on every listed doctype — users
  never pick it: `is_return` chooses the return series, Payment Entry its payment type, POS Invoice the store from
  its warehouse (`set_warehouse`, else the POS Profile's).
- The naming_series options list the new series first and keep the old ones, so earlier documents stay valid:
  for doctypes whose options live in `custom/<doctype>.json` (Sales Order, Delivery Note, Sales Invoice, POS Invoice,
  Material Request, Purchase Order, Purchase Receipt, Purchase Invoice, Stock Entry) the JSON carries them — migrate
  re-applies those files after the patches, so a patch alone would be undone; the others get them from
  `patches/naming_series_fy.py`.
- The POS Invoice **Document Naming Rules** (JP / RN / VA / VV + counter, no year) are disabled by that patch: a
  Document Naming Rule wins over the naming series.
- A new doctype that needs a number: add it to `SERIES` in `naming.py`, and its options (JSON or the patch).
