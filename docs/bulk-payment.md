# Receive / Pay — one payment prompt (and Bulk Payment)

One prompt for **every** payment against invoices / bills, so users never choose between tools:

| Case | What it makes |
|---|---|
| one invoice (full or part) | one Payment Entry |
| several invoices of one customer / supplier | one Payment Entry, all of them as references |
| one amount for several customers / suppliers (one cheque, one transfer) | a **Bulk Payment** (BPAY-) that makes one Payment Entry per party |
| more than the invoices, one party | the extra stays on its Payment Entry as **advance** |
| no invoice at all (advance) | one Payment Entry, all advance |

Users don't want a Journal Entry for a shared cheque, and one Payment Entry can carry only one party
— hence one standard Payment Entry per party; the Bulk Payment keeps them (and one receipt) together.

## Where it opens

`public/js/bulk_payment.js › dacs_payment_dialog` (`dacs_pay_invoice` for one invoice):

- **Order Flow › Finance › New › Receive / Pay** — empty;
- an invoice / bill row's **Receive / Pay** on Finance, and the Sales / Purchase Invoice form's **Receive
  Payment / Make Payment** (ERPNext's Create › Payment is removed there) — starting with that party and
  that invoice at its outstanding;
- a draft **Bulk Payment** form › **Pick Invoices** — fills its table instead of submitting.

## The prompt

One screen, three numbered parts:
1. **Who paid you?** — the list of who owes, each with ID · mobile · city pincode · GSTIN (search matches id, name, mobile,
   email, GSTIN, any of their addresses — lines, city, pincode, phone — and contact phones; a search also lists matching
   parties with nothing due, for an advance — `bulk_payment._search_parties`); click to add; a *Selected* line (how many, total
   due, invoices, overdue).
2. **How much did you receive?** — a large amount box with **Full due ₹…** (sets it and spreads it);
   empty = add up from what is ticked in part 3; "How?" — the modes as big buttons (only those ticked
   *Show in Payment Entry*, with the account the money goes into); date; cheque / UTR no and date for a
   bank mode; *Bank charges, TDS, write-off* and *Remarks* folded.
3. **Which invoices is it for?** — the sum (Due on selected │ Amount = On n invoices + Advance / Still to
   allocate, Auto-allocate, Clear, the plain sentence) and the invoice cards.
**Review & submit** checks the parts (a customer, a mode, a date, the reference for a bank mode, the
allocation rules below) and opens a short **Check & submit** window — "You are receiving ₹…" into which
account, mode, date, deductions, each customer with its invoices and amounts, a tick box, **Submit
payment** / *Go back and change*. From a draft Bulk Payment form the button is **Fill the table**. After Submit, a
success screen: ✓, the amount, the parties, each Payment Entry (and the Bulk Payment) with its own
**Print**, and a large **Print Receipt** (Bulk Payment Receipt for several parties, else Payment Receipt
DAC; *Print Payment Advice* when paying). Look: one blue accent on white / slate, soft green / amber / red
only for status, white inputs with a focus ring, initials on the customer list. The
dialog's own required-field check is not used (the button checks the parts itself).
Invoice rows: invoice no. (with its total and due date under it), Due now, Paying now, TDS / W/off (when
ticked), Left after with the status under it, then ✕ / Full.

1. **The amount** — Total Amount (what the invoices are cleared by, including any bank charges / TDS /
   write-off), Mode of Payment (only modes ticked *Show in Payment Entry*, with the account it posts to),
   date, Cheque / Reference No + Date (shown and required only for a bank mode).
2. **Who** — a list of only the customers / suppliers with something unpaid (count, total due, oldest due
   / overdue) — the amount due with the invoice count under it — most due first; a search box (name or ID); click to add / remove (chips on top). A search
   that finds nobody with dues lists matching parties anyway — for an advance.
3. **Their unpaid invoices** — grouped by party (submitted, not a return, this company), oldest due
   first. It works as a calculator:
   - **No amount typed** → the amount *adds up* from what is ticked (Pay full / Pay all in full / typed
     rows); Auto-allocate asks for an amount first.
   - **Amount typed** → it is fixed: a row never takes more than the invoice owes *or* than is left of
     the amount (Pay full then makes it part paid, with a message; nothing left → "already allocated");
     lowering the amount takes the excess off the last ticked invoices; until the user types a row the
     amount is spread by itself (the invoice it was opened from first, then oldest due).
   - The line on top reads **Amount received = On n invoices + Advance** (one party; red **Still to
     allocate** with several parties, or with bank charges / TDS / write-off; red **Over by** can't
     happen through the buttons), plus *In bank after deductions* when there are any, and one sentence
     saying what will happen ("No invoice chosen: the whole ₹… is kept as advance").
   - Messages about the last change (amount ran out, already allocated, Auto-allocate needs an amount)
     show inside the prompt above the invoices, not as toasts. Editable boxes (Paying now, TDS,
     write-off) are white with a blue border and ₹ and their column header is dark blue with a pencil;
     everything else is plain text. Buttons: **Pay full** / **Pay all in full** (filled blue), **Remove**
     (red outline; on a part-paid row a ✕ next to Pay full), **Auto-allocate** / **Clear all** (outline).
   - Each party card: Paying now, of what is due, left after, **Fully paid / Part paid / Not paid now**,
     progress bar; each row: Due now, Paying now, **Left after**, status, **Pay full** / **Remove**.
4. **Bank charges, TDS, write-off** (folded, only if any) — bank charges for the whole amount (ledger
   follows the mode: card → Card Swipe Bank Charges); **Show TDS / write-off columns** adds them per
   invoice; their ledgers (TDS on Pay blank = each supplier's own TDS ledger).

**Review** lists each Payment Entry to be made (settled / in bank, invoices, TDS, advance, charges) and
needs the tick; then the result with links and **Print Receipt** (Bulk Payment Receipt for several
parties, Payment Receipt DAC for one).

## Rules (server, `doctype/bulk_payment/bulk_payment.py`)

- Rows: invoice submitted, not a return, same company and party; 0 < amount ≤ outstanding; an invoice
  once; TDS + write-off ≤ the row's amount.
- Total = sum of the rows, except one party may have more (advance) — but not together with bank
  charges, TDS or write-off. Bank amount must be > 0.
- Deduction ledgers: bank charges / write-off an expense ledger, TDS a TDS ledger
  (`dashboard_payment._deduction_account_ok`).
- Permissions: Payment Entry create + submit; several parties also need Bulk Payment create + submit.
  From Order Flow, the Finance tab and each party's sub-tab (receivables / supplier / jobber).

**Posting** (per party; bank charges on the first party's entry), as Create › Payment would:

```
Receive: Dr Bank (total − charges − TDS − write-off), Dr Bank Charges, Dr TDS Receivable, Dr Write Off; Cr Debtors total
Pay:     Dr Creditors total, Dr Bank Charges; Cr Bank (total − TDS − write-off + charges), Cr TDS ledger, Cr Write Off
```

Each entry: `get_payment_entry` of its first invoice, references rebuilt from ERPNext's own reference
row per invoice with the row's amount; an advance-only entry is built from the party account. A Bulk
Payment's entries carry `custom_bulk_payment` and a remark naming it; a one-party entry keeps the user's
remarks.

## Bulk Payment lifecycle

| Action | Result |
|---|---|
| Cancel the Bulk Payment | cancels all its Payment Entries (`ignore_links`), invoices reopen |
| Cancel one of its Payment Entries | refused while the Bulk Payment is submitted |
| Cancel an invoice it paid | refused (SI / PI `before_cancel`) — cancel the Bulk Payment first |
| Unreconcile Payment on its entry | refused |
| Amend | a new draft without the old links; submit makes new entries |
| Delete submitted | refused (standard) |
| Delete cancelled | refused while any of its entries is submitted; else clears `custom_bulk_payment` on them, dated comment on each |
| Delete a cancelled entry of it | allowed once the bulk is cancelled; clears the row's link |
| Delete the original while its amendment exists | refused (standard Frappe) |

A one-party payment is an ordinary Payment Entry — cancelled / amended like any other.

## Printing

- **Bulk Payment Receipt** (default for Bulk Payment): Payment Receipt / Payment Advice — the amount in
  bank (what it settles, charges, TDS, write-off), parties with their invoices, set-off, TDS / write-off
  columns when any, the Payment Entry per party, amount in words, signatures.
- Each Payment Entry prints **Payment Receipt DAC**; one from a Bulk Payment says "Part of Bulk Payment …".

## Access

Bulk Payment permissions: System Manager, Accounts User, Admin. Give other finance roles Bulk Payment
in the access sheet (/roles-and-permissions) if they should pay several parties at once.

## Files

`public/js/bulk_payment.js` (prompt), `doctype/bulk_payment/` (json, py, js), `doctype/bulk_payment_allocation/`,
`print_format/bulk_payment_receipt/`, `custom/payment_entry.json` (`custom_bulk_payment`), `hooks.py`
(Payment Entry before_cancel / on_trash, SI / PI before_cancel, Unreconcile Payment before_submit),
`page/order_flow/order_flow.js` (New › Receive / Pay, row buttons), `public/js/sales_invoice.js` /
`purchase_invoice.js` (form buttons), `dashboard_payment.py` (ledger helpers, refunds).
