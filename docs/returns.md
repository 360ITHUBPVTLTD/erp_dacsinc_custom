# Returns — Credit Notes, Debit Notes, Sales / Purchase Returns

A return reverses a document it was made from and keeps that document's links (Sales Order line,
Delivery Note line, PO line…). ERPNext marks it `is_return = 1`. Everywhere in this app a return is
treated as what it is — never as a delivery, invoice or receipt, never as progress on an order.

| Return | Made from | What it does |
|---|---|---|
| **Sales Return** (DN, is_return) | Delivery Note › Create › Sales Return | goods come back into stock (Dr Stock In Hand, Cr Cost of Goods Sold) |
| **Credit Note** (SI, is_return) | Sales Invoice › Create › Return / Credit Note, or new SI with Is Return (direct, e.g. a service item) | the customer owes less (Dr Sales, Dr Output GST, Cr Debtors) |
| **Purchase Return** (PR, is_return) | Purchase Receipt › Create › Purchase Return | goods go back out (Dr Stock Received But Not Billed, Cr Stock In Hand) |
| **Debit Note** (PI, is_return) | Purchase Invoice › Create › Return / Debit Note, or new PI with Is Return (direct) | we owe the supplier less (Dr Creditors, Cr stock/expense, Cr Input GST) |
| Subcontract Return (SCR, is_return) | Subcontracting Receipt › return | goods back to the jobber |

Goods and money are separate documents: a customer return needs the Sales Return (stock) **and**
the Credit Note (money); a supplier return the Purchase Return **and** the Debit Note.

## Settlement (ERPNext v15)

A return made against an invoice reduces **that invoice's** outstanding (its own outstanding stays
0) unless it is larger than what the invoice still owed, or "Update Outstanding for Self" is ticked —
then it carries its **own negative outstanding**:

- Credit Note with a negative outstanding = a **credit the customer has with us**. If the customer
  still has unpaid invoices → **Adjust** (Payment Reconciliation) — the usual case; otherwise
  **Refund** (Payment Entry, type Pay to the customer: Dr Debtors, Cr Bank).
- Debit Note with a negative outstanding = **the supplier owes us** → Adjust against their unpaid
  bills, or **Receive Refund** (Payment Entry, type Receive from the supplier: Dr Bank, Cr Creditors).

## Where it shows

- **Order Flow › Finance › Returns / Notes** (sub-tab; `order_flow_api._accounts_notes`,
  `_describe_notes`): every Credit and Debit Note with type chip, party, the invoice it is against
  (its status and what is still due on it) or "Direct", the items returned (qty × rate = amount; ▸
  opens all), date, amount, **effect** (Draft / Customer credit ₹ / Supplier owes us ₹ / Reduced
  INV / Settled) and **what next** with its button: Submit (draft), **Adjust** (opens Payment
  Reconciliation with the party filled in — primary when the party still has unpaid invoices),
  **Refund** / **Receive refund** (`payment_prompt.of_refund_prompt` →
  `dashboard_payment.record_refund`; part refunds allowed, never more than due). Filters: Type,
  Status (credit / refund pending, draft, settled), Customer / Supplier; "Open orders" = drafts and
  pending credits. Card: notes to act on, customer credit, supplier owes us.
- **Finance invoice lists** (Receivables / Supplier / Jobber Payables) no longer include returns; an
  invoice with a note against it shows a chip "↩ <note> ₹" under its status. "Open" = something
  still to collect / pay.
- **Finance › New** bar (`of_fin_new_bar`, opens in a new tab, only what the user may create):
  Receive / Pay Payment Entry (choose the party, then Get Outstanding Invoices to settle several
  invoices at once), Internal Transfer, Journal Entry, Credit Note (direct), Debit Note (direct),
  Payment Reconciliation, Bank Reconciliation.
- **Sales Tracker / Pending DN/SI**: returns are not counted in the DN / Inv / Recv chips, are never
  a stage or an action (no "Submit Invoice" for a draft credit note, no "Make invoice" from a Sales
  Return DN), and show as their own "↩ Credit Note / Sales Return …" chips in Document Flow
  (`_EVENT_SQL.is_return`, `row["returns"]`). Activity reads "Credit Note issued to customer",
  "Goods returned by customer (Sales Return)", "Goods returned to supplier (Purchase Return)",
  "Debit Note issued to supplier".
- **Logistics**: Credit Notes are not in the LR / signed-copy backlog.
- **Purchase Flow / Job Work › Receipts**: a return row shows "↩ Return" with the qty returned; a
  submitted return counts as done (not "open").

## Forms

- **Credit / Debit Note form** (`public/js/return_actions.js`): no "Receive Payment" / "Make
  Payment"; an intro saying what it did; **Refund to Customer** / **Receive Refund from Supplier**
  and **Adjust (Payment Reconciliation)** while it carries a credit.
- **Returned qty is editable** on a Credit Note and a Sales Return DN although the lines are linked
  (`si_field_locked` / `dn_field_locked`; server: `custom_script._revert_pick_list_locked_fields`
  skips qty on returns); typing 2 becomes -2. Item, rate, warehouse stay as the original. ERPNext
  refuses more than was invoiced / delivered.
- **Remarks** on Sales and Purchase Invoices is editable after submit (Property Setter in
  `custom/*.json`) — it prints as the return's reason.
- **Draft guard** compares returns with returns only — a draft Credit Note never blocks the next
  invoice for that order line, nor the reverse (`draft_guard.existing_drafts`).
- The Sales Order one-route lock does not apply to returns (a Credit Note on a Direct Bill order
  carries Update Stock). A submitted Sales Return can take its Pick List back from "Completed".

## Printing

- **Credit Note DAC** (Sales Invoice) and **Debit Note DAC** (Purchase Invoice) — app print formats
  in the layout of "Sales invoice Print Format 4": the company Letter Head on every copy (these are
  full-HTML formats, so the template places `{{ letter_head }}` itself — Frappe adds it only to
  builder formats like Format 4), CREDIT NOTE / DEBIT NOTE heading, number, date,
  the original invoice / supplier bill no. and date, party with GSTIN and place of supply, items
  returned with ₹ amounts, the HSN-wise tax table (`gst_breakup_table`, built at print time),
  totals and amount in words (all positive), the effect line, **Reason / Remarks**, no
  invoice Terms & Conditions, signatory; copies as the multi-copy master (draft → DRAFT COPY,
  `?print_all=1` → four, `?copy_name=` → one).
- A return opens with them in the Print view (`dacs_load_return_actions`), and the form's "Print
  Credit Note" button (Sales Invoice Multi Copy Master) hands a return to Credit Note DAC. All the
  formats and the copy rules: `docs/print-formats.md`.
- **Print with a copy choice** (`public/js/print_prompt.js › dacs_print_copies`): Original /
  Duplicate / Triplicate / Quadruplicate / All 4 (a draft prints DRAFT COPY at once). Sales
  Invoices go through Sales Invoice Multi Copy Master (a return comes out as the Credit Note); a
  Purchase Invoice return through Debit Note DAC; an ordinary Purchase Invoice through its default
  format. Used by the 🖨 button on every Order Flow › Finance row (Receivables, Supplier / Jobber
  Payables, Returns / Notes) and by the "print it now?" question after submit.
