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

## Goods and money kept together (`return_goods.py`)

An invoice billed **from a Delivery Note / Purchase Receipt** cannot move stock: ERPNext hides
Update Stock on it and on its notes (`depends_on: every item has no dn_detail / pr_detail`;
"Stock cannot be updated against Delivery Note"), so its Credit / Debit Note never brings goods
back — only the Sales / Purchase Return does. (A direct bill made with Update Stock passes it to
its note, which then returns the goods itself.) Update Stock is therefore **not** made the default.

The two halves are matched line by line through the original DN / PR line both point to
(note `dn_detail` / `pr_detail`; return `dn_detail` / `purchase_receipt_item`; a note made from a
return's line is resolved to the original and counts as linked to that return). Per original line the
notes' qty and the returns' qty are **paired**: first the pairs that belong together — a return made
for a note (`custom_against_note` on the Delivery Note / Purchase Receipt) or the return a note names
(`custom_goods_return` on the invoice) — then what is left, oldest first. One note's return never
covers another note's shortfall. Rule (agreed 2026-10-23): **never blocks**.

**Two ways to bring the goods back** on a note billed from a DN / PR:
- **Tick "Update Stock (return the goods)"** (`custom_return_goods`, shown only on such a note, **on by
  default** — untick it when the goods have not come back yet; on a direct note it is hidden and does
  nothing, and `on_note_submit` stays silent when there is nothing to return; with
  *Return to / from Warehouse*, default **VV Puram - IND**; cleared = where they were delivered from / received into).
  ERPNext's own Update Stock can't be used there. On **Submit**, `on_note_submit` makes the Sales /
  Purchase Return from the original DN / PR for this note's lines and qty and submits it (as part of
  the note, permissions ignored like ERPNext's Update Stock) — original cost, the DN / PR knows, no
  double return. Its name goes into the note's *Sales / Purchase Return* field. **Cancelling** the note
  cancels that return first (`on_note_cancel`).
- **Leave it unticked** — the note shows *Stock not returned* with **Make Sales / Purchase Return**.

**Supplier returns only from the Purchase Invoice** (rule, 2026-10-26): a Purchase Return must be made
from its Debit Note — the Update Stock tick or Make Purchase Return, which mark it with the note
(`custom_against_note`). Any other Purchase Return is refused on save
(`return_goods.guard_purchase_return_from_note`), and the Purchase Receipt's Create menu no longer
offers Purchase Return, Landed Cost Voucher, Make Stock Entry or Retention Stock Entry
(`public/js/purchase_receipt.js`) — only Purchase Invoice. (So on the supplier side the goods half is
never made first; "Make Debit Note" on a Purchase Return only matters for returns made before.)

A direct note (no DN / PR behind it) keeps ERPNext's own Update Stock. On ordinary (non-return)
Sales / Purchase Invoices **Update Stock is read-only** (Property Setter `read_only_depends_on:
!is_return`) — set by the system (direct-bill / POS), never ticked by hand.

**Debit Note received qty** (`sync_debit_note_received_qty`, before validate): ERPNext maps a Debit
Note line's received qty as everything still returnable and doesn't change it when Qty is edited, so
a Debit Note for 12 of 120 recorded 120 as returned and refused every later Debit Note on that line.
Received qty now follows qty. (PINV-26-00007, made before this, still carries -120: a data fix.)

| On | Shows (one panel above the form: 💰 Money and 📦 Goods, each with its buttons) | Button while missing |
|---|---|---|
| Credit / Debit Note form | 📦 Goods: back in stock (with the return no.) / return in draft / **not returned** / returned by the note (Update Stock) / returned on Submit (ticked, draft) / no stock item / not linked | **Make Sales Return** / **Make Purchase Return** — from the original DN / PR, only the lines and qty still missing (`make_goods_return`) |
| Sales / Purchase Return form | 💰 Money: note made / draft / **not made** / goods never invoiced (no note needed) | **Make Credit Note** / **Make Debit Note** — from the **original invoice** (`make_note_from_goods`), so it is against that invoice. ERPNext's own Create › Credit / Debit Note on a return is removed: it makes a note not linked to the invoice (GSTR-1 needs the original invoice; the invoice's balance would not go down). |
| Order Flow › Finance › Returns / Notes | a Goods chip under Effect, the Sales / Purchase Return button; above the table a red strip listing submitted returns still waiting for their note | the button opens the note / return in a new tab, which makes the missing document straight away (a one-minute `dacs_make:<doctype>:<name>` key in localStorage) |

A second return for goods already returned is refused ("Stock returned — …").

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

- **Order Flow › Finance › Returns / Notes** (sub-tab, split into All / Credit Notes — customers /
  Debit Notes — suppliers; `order_flow_api._accounts_notes`,
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

- **List views** of Sales Invoice, Delivery Note, Purchase Invoice and Purchase Receipt have
  **All · Normal · Returns** buttons (`public/js/return_list_toggle.js`, wired by each
  `*_list.js`, extending ERPNext's own list settings): a standard list filter on Is Return (0 / 1 /
  none), so it combines with the other filters and shows in the Filters bar.

## Forms

- **Credit / Debit Note form** (`public/js/return_actions.js`): no "Receive Payment" / "Make
  Payment"; an intro saying what it did; **Refund to Customer** / **Receive Refund from Supplier**
  and **Adjust (Payment Reconciliation)** while it carries a credit; the goods status and
  **Make Sales / Purchase Return** (above). Sales / Purchase Return forms (`delivery_note.js`,
  `purchase_receipt.js`): the money status and **Make Credit / Debit Note**.
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
