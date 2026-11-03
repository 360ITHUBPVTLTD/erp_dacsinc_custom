# Document numbers (naming series)

Sales, purchase, stock and payment documents are numbered **PREFIX/26-27/00001**: the prefix, the short financial year,
a running number that starts again at 1 every 1 April (agreed with the user 29-10-2026).

| Document | Number | Return / variant |
|---|---|---|
| Sales Order | SO/26-27/00001 | |
| Delivery Note (challan) | DC/26-27/00001 | return: SR/26-27/00001 |
| Sales Invoice (HO bills and POS closings) | **36868/26-27** — number, then the year | return (Credit Note, HO and POS closing returns): **312** |
| POS Invoice | JP / RN / VA / VV /26-27/00001 by the store's warehouse; other counters POS/26-27/00001 | |
| Payment Entry | Receive RCT/26-27/0001 · Pay PAY/26-27/0001 · Internal Transfer CTR/26-27/0001 | |
| Material Request / RFQ / Supplier Quotation | MR/…/00001 · RFQ/…/0001 · SQ/…/00001 | |
| Purchase Order / Subcontracting Order | PO/…/00001 · JO/…/00001 | Purchase Order ticked Is Subcontracted (jobber PO): SCO/…/00001 |
| Purchase Receipt / Subcontracting Receipt | GRN/…/0001 · JR/…/00001 | Purchase Receipt return: PRR/…/0001 |
| Purchase Invoice | **1661** | return (Debit Note): **41** |
| Journal Entry / Stock Entry / Stock Reconciliation | JV/…/00001 · STE/…/0001 · STR/…/0001 | Journal Entry of Voucher Type Credit Note: **6** · Debit Note: **32** |
| Quotation | unchanged: SAL-QTN-.YYYY.- | |

## Invoices and notes: the client's own numbers

Sales / Purchase Invoices, their returns and Journal Entry Credit / Debit Notes continue the numbers of the client's old
software (user, 03-11-2026; the numbers above are where each started on live). Only the Sales Invoice carries the year
(36868/26-27, as the client prints it), so it starts again at 1 every April; the others are plain running numbers that
never restart (GST asks only that a number is not repeated in the year).

- Frappe can't give a name that starts with the number: with nothing before the `#`, every such series would share one
  counter (key ""). So these series (`naming.NUMBER_ONLY`, `NUMBER_YEAR`) keep a prefix as the **counter's key** only —
  `SI/.FYS./.#####` → counter `SI/26-27/`, `CN/.#####` → `CN/`, `PI/.#####` → `PI/`, `DBN/.#####` → `DBN/`,
  `JCN/.#####` / `JDN/.#####` (Journal Entry by voucher type) — and `naming.autoname` (doc_events autoname) writes the
  name without it. The naming_series field still shows which counter a document used.
- One doctype holds two of them (an invoice and its returns, a Credit Note and a Debit Note), so their numbers can meet
  (Credit Note 6, 7 … reaches Debit Note 32). A number already taken is **skipped**: the next free one is used.
- An amended copy is `<original>-1` (36868/26-27-1 is 13 characters). Deleting the newest document frees its number
  (Frappe does that for the plain numbers; `naming.release_number` for 36868/26-27).
- A counter is changed in Document Naming Settings › Update Series Number with the series above (prefix = counter).

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
  its warehouse (`set_warehouse`, else the POS Profile's), a Purchase Order `is_subcontracted` the SCO series.
- The naming_series options list the new series first and keep the old ones, so earlier documents stay valid:
  for doctypes whose options live in `custom/<doctype>.json` (Sales Order, Delivery Note, Sales Invoice, POS Invoice,
  Material Request, Purchase Order, Purchase Receipt, Purchase Invoice, Stock Entry) the JSON carries them — migrate
  re-applies those files after the patches, so a patch alone would be undone; the others get them from
  `patches/naming_series_fy.py`.
- The POS Invoice **Document Naming Rules** (JP / RN / VA / VV + counter, no year) are disabled by that patch: a
  Document Naming Rule wins over the naming series.
- A new doctype that needs a number: add it to `SERIES` in `naming.py`, and its options (JSON or the patch).
