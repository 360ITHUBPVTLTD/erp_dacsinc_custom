# Master data protection: Customer, Supplier, Item Price

Customer, Supplier and Item Price records (names, contacts, GST, prices) must not
leak out of the system. Five layers handle this, all applied with the access sheet
(`access_sync.is_active`).

## 1. Who views them: the sheet (`/roles-and-permissions`)

The sheet's Customer / Supplier / Item Price rows decide who views them, as for any
document. A role with no V on the row is pick-only (2). Today (doc sheet v35, the
cells as agreed), that is e.g. Merchandiser User and Logistics on Supplier.

## 2. Pick only (`master_guard.py`)

A role without View that edits a document linking the master (Sales Order → Customer,
Purchase Order → Supplier) still gets Read on it, a linked-document right
(`access_sync.compute_doc_access`), because Frappe needs Read to fetch the master's
fields into the form. Such a user is **pick-only**:

- Link search and fetch work, but search returns at most 20 rows per call
  (`before_request`).
- List view, report view, counts, `frappe.client.get_list` and REST listing return
  nothing (`permission_query_conditions` → `1=0` only for those listing commands).
- Opening the record (form `getdoc`, `frappe.client.get`, REST read) is refused
  (`has_permission`).
- Global search (`frappe.utils.global_search.search`, overridden) drops master
  records the user may not open. This applies to every user, so a scoped
  Merchandiser only finds their own customers.

Pick-only = not an admin, no role with V on that sheet row, and no other non-sheet
role reading the doctype.

## 3. No taking lists out (`access_sync._master_flags`, `strip_master_list_out`)

On these three masters the sheet's V gives **Read + Select only**. Print, Email,
Report and Export (V_LIST_OUT) stay with `EXPORT_ROLES` (Accounts Executive, Accounts
Manager). Non-sheet roles lose them too, except `MASTER_LIST_OUT_KEEP` (Administrator,
System Manager, Admin, Super Admin, Sales / Purchase Master Manager, Accounts User).
The non-sheet removal is one-way.

## 4. Reports (`MASTER_REPORTS`, `master_report_roles`)

Reports listing master records or prices run only for roles with Report on that
master: Item Prices, Item-wise Price List Rate, Item Price Stock, Customer-wise Item
Price, Address(es) And Contacts, Customer Credit Balance, Inactive Customers, IRS 1099,
Supplier Quotation Comparison, and every non-Report-Builder report whose ref_doctype is
one of the three.
- They are removed from the other sheet roles, and from the standard roles in
  `MASTER_REPORT_DROP_STD` (Sales / Stock / Purchase / Maintenance / Manufacturing /
  POS User, Item Manager), whatever the report's own role list says.
- Managers' and admins' standard roles keep them.

## 5. Merchandiser User: their customers (`custom_script.get_customer_permission_query_conditions` / `has_customer_permission`)

They see customers that are:
- assigned to them, or not assigned yet;
- created by them;
- customers of orders they raised or are Lead Owner of.

This is the same rule as their Sales Orders. Another merchandiser's customer is
refused.

## Left to user clean-up

Users who still hold old standard roles directly (Sales User, Executive, Marketing
Team, Production Team, Purchase Team, Stock User…) keep Read on Customer / Supplier
through those roles. That is 35 users for Customer and 24 for Supplier (as of
2026-10-01). Such users are not pick-only, but they can't print, export or run the
master reports. Moving them onto sheet roles only closes it.

## Live

The sheet travels in `access/agreed_access.json`. `RULES_VERSION` was bumped,
so the next migrate re-applies the sheet, the report rules and the non-sheet strip.

## Supplier / Customer defaults (`party_address.py`, patch `party_defaults_and_primary_address`)

- **Default Price List:** every Supplier has Standard Buying. New suppliers get it as the
  field's default (Property Setter, exported in `custom/supplier.json`).
- **Primary address:** a Customer / Supplier with an address but no primary address gets
  one. That is the address ticked Preferred Billing, else the oldest; enabled addresses
  only.
  - Done once for all parties (2026-10-02: 455 suppliers, 1 customer).
  - From then on, whenever an address linked to a party is saved (Address after_insert /
    on_update).
  - A primary address already set is never changed.
- Supplier › Address (`custom_add`, an unused hidden custom field) was removed. The patch
  deletes it on live too, because customization sync never deletes fields.

## Admin Settings (`admin_settings.has_permission`)

Admin Settings holds recipients, user lists and role lists. Many roles have Read on it
because screens and the mobile app read their settings as the signed-in user.
- **Roles with Read** (DAC CRM, Merchandiser User, …) may read it through the API
  (`/api/resource`, `frappe.client.get` / `get_single_value`): the mobile app needs this.
  Before 7 Oct 2026 every read needed Write, and the app failed for them.
- **Only roles with Write** (System Manager, Admin) open the desk form
  (`frappe.desk.form.load.getdoc`), print it (`/printview`, PDF download), or email /
  export / report / share it. Frappe prints whatever may be read, so print is blocked by
  request path.
- Server code reads it with `get_single_value` / `get_cached_doc`, which this doesn't touch.
- Never give Write just to make a screen or the app work: Write lets the role change the
  dashboard tabs, final approvers and recipients for everyone.

## Outstanding balance on the Customer / Supplier lists

**Account Summary on the Customer / Supplier form** — only for **Admin, System Manager, Accounts
Executive, Accounts Manager** (`party_balance.FINANCE_ROLES`; the server returns nothing to anyone else,
the section is hidden, and the list pill is not drawn). Custom HTML field `custom_account_summary` in
its own section at the top (`custom/customer.json` / `supplier.json`); `public/js/party_summary.js`;
data `party_balance.get_party_summary` and `party_statement.py`.

- **Headline**: the position in one big figure ("Customer owes us ₹…", "We owe the customer (advance / credit) ₹…",
  "All settled") with one sentence — to receive ₹… on "1 opening balance, 2 invoices", ₹… overdue, we hold ₹… for
  them, credit limit — and the buttons: Receive / Make Payment (the payment prompt, `docs/bulk-payment.md`),
  Statement, Ledger (General Ledger report), Refresh. When they owe something *and* we hold something the headline
  is the **net** ("Net to receive from the customer", sentence "₹… due − ₹… we hold for them = ₹…"), and three
  boxes under it say what each side is made of: They owe (per kind) − We hold for them (per kind) = Net to
  receive (or: We owe them — pay back or keep as advance), with a line that the credits aren't set off yet (the
  list shows full dues) until **Adjust**. The list then ends with a *Net to receive* row, and an invoice with a
  return of it still held says so under it ("Return … not set off yet — ₹… after Adjust").
  The figures come from the party's open items (`party_open_items.open_items`: ERPNext's Payment Ledger, as its
  Accounts Receivable / Payable report) — invoices, opening invoices, **opening balances and other Journal
  Entries**, credit / debit notes, advances by Payment or Journal Entry — so they add up to the ledger balance; if
  they ever don't, an orange line says by how much (`difference`).
- **Open items** (always shown): grouped *To receive* (dues, oldest first) and *Held for them* (credits), each group
  with its total; every line labelled in words (Opening balance, Invoice, Journal Entry, Advance payment, Credit
  note…), its status (n days late / due date / can be set off / to pay back), the open amount and one action —
  **Receive / Pay** on a due (the prompt starts with it), **Adjust** on a credit when something is due, **Refund**
  on a credit note with nothing to set it against.
- **Tabs** below, one open at a time (or none; the choice is remembered per user and browser): **Returns** (only
  when there are notes; opens by itself while one is open, with the open count) — the latest 20 credit / debit
  notes with amount, still open, the money status (*Settled* / *Open — set off against their dues* / *Open — to pay
  back*) and what settled it (Payment Ledger: "set against SINV-…", "refunded by ACC-PAY-…"), the goods status
  (`return_goods.note_goods`), Adjust / Refund (`party_balance._returns`); **Sales Orders / Purchase Orders**
  (`party_balance._order_status`: Draft / awaiting approval, Open orders, To deliver / To receive, To bill);
  **History** — chips Unpaid · All invoices · Paid · Credit notes · Sales Orders with a date range, each row
  opening to its chain and what settled it (`party_statement.get_party_documents`, first 100; Unpaid also lists
  opening balances and other Journal Entries due; loads when first opened); **Payments** (last 8, with receipt
  print). This year's billed / received and the payment terms are in the small line at the bottom.
- **Print Statement**: period (this financial year, last 12 / 3 / 1 months, or dates), with or
  without letter head → `party_statement.statement_pdf`: the default Letter Head (as the receipts),
  party with GSTIN and address, opening balance, every ledger voucher (type, document, details —
  return against, bill / PO no, payment mode / ref and the invoices it paid), debit, credit, running
  balance Dr / Cr, period totals, closing balance in figures and words, signature.

**Adjust** (on a credit in Open now, or a return): choose the credits (oldest used first) and how much goes on each invoice (spread
oldest due first by itself, editable; left after / fully / part paid shown). `party_balance.adjust_advances`
builds ERPNext's own **Payment Reconciliation** (unreconciled entries, allocation rows built as its
`allocate_entries` does, then `reconcile()`), so the posting is exactly that tool's: the Payment
Entry gets the invoice as a reference, the invoice's outstanding drops, credit notes are set off
with their standard Journal Entry. Needs write on Payment Reconciliation (Accounts User / Manager).

Each row of the Customer and Supplier list views shows what is outstanding with that party
(`party_balance.get_party_balances`, `public/js/party_balance_list.js`, wired by `customer_list.js` /
`supplier_list.js`): a short red pill **"₹ due · n Inv"** (customer) / **"₹ to pay · n Bills"** (supplier — the
count of unpaid submitted invoices / bills) with a red
**!** when any invoice / bill is past its due date, or a green **"₹ advance"** when the balance is the
other way; nothing at zero. It sits in the right-hand strip in place of the "last updated" time, so
the columns keep their width; the tooltip gives the exact amount, the number of unpaid invoices /
bills and how many are overdue. The figure is the ERPNext **Party Balance** — the party's ledger
balance (GL Entries, not cancelled, for the user's company): unpaid invoices net of credit / debit
notes, advances and adjustments. Shown only to users who may read the party **and** its invoices
(Sales Invoice for customers, Purchase Invoice for suppliers); one query per page of rows.
