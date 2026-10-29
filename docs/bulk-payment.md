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
- the **Payment Entry list** › **Receive / Pay** (`public/js/payment_entry_list.js`) — empty, as on Order Flow.

## What can be paid (open items)

The prompt lists everything due from the chosen parties, not only invoices: invoices / bills, opening invoices,
**opening balances and other Journal Entries** with something due (`party_open_items.open_items` — ERPNext's
Payment Ledger, the same as the Account Summary; kinds `PAYABLE_KINDS`), each labelled in words. "Who owes" sums
the same. A Journal Entry row is checked against the Payment Ledger (`BulkPayment._validate_je_row`: due for that
party, amount ≤ what is due) and its Payment Entry reference is built from ERPNext's Get Outstanding
(`_je_references`); a payment of only Journal Entry rows starts from an advance entry and gets them as references.
Bulk Payment Allocation's Invoice Type allows Journal Entry.

## The prompt

**Opened for one party** (the Customer / Supplier form, an invoice or due row): no search — a header with the party,
what they owe and the overdue amount (*Change* opens the search), then **1 How much did you receive?** and
**2 What does it pay? (oldest first)** — a short list (item, due, paying now, fully / part paid / not paid now) with
**Change which items or amounts** for the full table below. Opened from a due row, the amount starts at what is due
on it.

Opened from Order Flow (any party): one screen, three numbered parts:
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
**Print**, and a large **Print Voucher** (Bulk Payment Receipt for several parties, else Payment Receipt
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
   - With several parties every one must pay something (an advance only goes with one party). A chosen
     party with nothing open shows "· nothing due" on its chip (orange); Review stops with a message
     naming them and a **Remove** button.
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
needs the tick; then the result with links and **Print Voucher** (Bulk Payment Receipt for several
parties, Payment Receipt DAC for one).

## Group payment (branches, one cheque)

Branches of one firm are separate customers (or suppliers) but often pay with one cheque. Put them in one
**Customer Group / Supplier Group** (ERPNext's own field on the party form); `party_group.py`. A group's members are
the parties in it or in a group under it.

- **In the prompt**, part 1 lists *Pay a whole group* above the parties: the groups with at least two members owing
  something (`get_groups_due`, most due first). **Searching a group's name** lists that group (even with one member
  owing) and its members (`_search_parties` matches the group, `matching_groups`). **Add whole group** adds every member that
  owes; **Remove group** takes them out again. A group with more than 60 members (`MAX_PROMPT_MEMBERS`) is a
  catch-all like "Individual", not branches: never offered or matched. Opened for one party (Account Summary, an invoice form or
  row), the header says when that party's group has other members owing ("Part of group …: 2 more customers
  owe") with **Add whole group**, which adds them and sets the amount to their full due (lower it to the cheque).
- **Group Outstanding** page (`/app/group-outstanding`, `page/group_outstanding/`, finance roles): it opens on
  **every group with something open** (`get_groups_outstanding`: members owing, items, they owe, overdue, held, net;
  most owed first, catch-all groups greyed at the end, totals on top). Click a group (or pick Customer / Supplier and
  the group above) to open it, **All groups** goes back. A group shows the group's totals (they owe, overdue, held for them, net), then each
  member that has something open, with its dues (tick boxes; a member's header box ticks all of its items) and its
  credits in green (set off with Adjust on that party's Account Summary). The bar at the bottom shows the ticked
  total. **Receive ₹… / Pay ₹…** opens the prompt with those members and items in full, and **Receive payment for
  the group** (nothing ticked) opens it with every member that owes, where the amount spreads oldest first.
  **Print** gives the same list on paper (`get_group_outstanding`), under the company's default letter head (as the
  statement of account and the receipts).
- **By group | By customer (supplier)** in the top bar next to Customers | Suppliers (remembered per browser): by
  group as above (with the Group field), or every customer / supplier with something open
  (`get_parties_outstanding`: group, items, they owe, overdue, held, net; the Group field is hidden) — a click opens
  that party with its ledger, Back returns to the list. The search bar follows it (`search(scope=…)`): By group finds
  groups by name; By customer finds customers / suppliers by name, ID, mobile, GSTIN, email, group, address. Esc
  closes the results.
- **One search bar** on top of the page (`party_group.search`) finds groups (By group) or single customers /
  suppliers (By customer) by ID, name, mobile, GSTIN, group, email, address, contact phone. A party opens on its own
  with **the same Account Summary as its form** (`party_summary.js` → `dacs_party_summary`: Receive / Pay per item,
  Adjust, Refund, Returns, orders, History, Payments, Statement) and its **ledger** for the dates (`get_party_view`:
  opening, each voucher with debit / credit / running balance Dr / Cr, closing — `party_statement._statement_data`),
  with Statement PDF, General Ledger and its form; a payment / adjust / refund there refreshes the ledger. Its group
  links back to the group when the group is real. In a group, each member has **Summary & ledger** (opens it the
  same way; Back returns to the group) and, when it owes and something is held for it, **Adjust ₹…**
  (`dacs_party_adjust`, the summary's Adjust dialog).
- The page opens from **Outstanding** on the Customer / Supplier Group form (`public/js/party_group_form.js`)
  and from **Group: …** on a member's Account Summary. That button appears only when the group has 2–60 members
  (`party_balance._group`).
- One cheque for several members is a normal Bulk Payment: one Payment Entry per member, same cheque no.

## Rules (server, `doctype/bulk_payment/bulk_payment.py`)

- Rows: invoice submitted, not a return, same company and party — or a Journal Entry with something due for the
  party (Payment Ledger); 0 < amount ≤ outstanding; a document once; TDS + write-off ≤ the row's amount.
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
| Cancel the Bulk Payment | cancels all its still-submitted Payment Entries (`ignore_links`), invoices reopen; Status → Cancelled |
| Cancel one of its Payment Entries | **allowed** (`payment_entry_on_cancel`; the Bulk Payment's link back to it is ignored for that cancel): its rows are ticked **Cancelled**, its received / paid amount is added to **Cancelled Amount**, Status → **Partly Cancelled**, a dated comment on the Bulk Payment; its invoices reopen. When none of its entries is left submitted the Bulk Payment is cancelled too |
| Cancel an invoice it paid | refused (SI / PI `before_cancel`) — the message names the Payment Entry to cancel first (or the whole Bulk Payment) |
| Unreconcile Payment on its entry | refused |
| Amend a cancelled entry of it | a separate Payment Entry (`custom_bulk_payment` is not copied); the Bulk Payment keeps the row as Cancelled |
| Amend the Bulk Payment | a new draft without the old links / cancelled ticks; submit makes new entries |
| Delete submitted | refused (standard) |
| Delete cancelled | refused while any of its entries is submitted; else clears `custom_bulk_payment` on them, dated comment on each |
| Delete a cancelled entry of it | allowed (cancelled with the Bulk Payment or on its own); its rows lose the link, keep Cancelled |
| Delete the original while its amendment exists | refused (standard Frappe) |

**Cancel asks first** (`public/js/bulk_cancel.js`, data `cancel_preview`; replaces Frappe's "Cancel All Documents", which
on an entry offered to cancel the whole Bulk Payment without saying so): on a Payment Entry of a Bulk Payment — every
standing entry with what it settles, then what **Cancel only this payment** does (what it settled is due again; the
Bulk Payment becomes Partly Cancelled, its other entries stay — or, for the last one, it is cancelled too) and
**Cancel the whole Bulk Payment** (`cancel_bulk_payment`, needs cancel on Bulk Payment); on the Bulk Payment — every
entry cancelled with it and what it settles, **Cancel all**. The entry's form also says it is part of the Bulk Payment.

**Status** (Draft / Submitted / Partly Cancelled / Cancelled, list filter): set on submit / cancel and by the entry
cancel above; `patches/bulk_payment_status.py` set it on existing ones. The receipt of a Partly Cancelled one prints
"PART CANCELLED", the amount still standing, the cancelled rows struck through and out of the totals.

A one-party payment is an ordinary Payment Entry — cancelled / amended like any other.

## Printing

- **Bulk Payment Receipt** (default for Bulk Payment): Receipt Voucher / Payment Voucher — the amount in
  bank (what it settles, charges, TDS, write-off), parties with their invoices, set-off, TDS / write-off
  columns when any, the Payment Entry per party, amount in words, signatures.
- Each Payment Entry prints **Payment Receipt DAC**; one from a Bulk Payment says "Part of Bulk Payment …".

## Access

Bulk Payment permissions: System Manager, Accounts User, Admin. Give other finance roles Bulk Payment
in the access sheet (/roles-and-permissions) if they should pay several parties at once.

## Files

`public/js/bulk_payment.js` (prompt), `doctype/bulk_payment/` (json, py, js), `doctype/bulk_payment_allocation/`,
`print_format/bulk_payment_receipt/`, `party_open_items.py` (open items), `party_group.py` + `page/group_outstanding/` (group payment), `custom/payment_entry.json` (`custom_bulk_payment`), `hooks.py`
(Payment Entry before_cancel / on_trash, SI / PI before_cancel, Unreconcile Payment before_submit),
`page/order_flow/order_flow.js` (New › Receive / Pay, row buttons), `public/js/sales_invoice.js` /
`purchase_invoice.js` (form buttons), `dashboard_payment.py` (ledger helpers, refunds).
