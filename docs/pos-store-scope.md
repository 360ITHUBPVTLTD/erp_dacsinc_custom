# POS store scope (`pos_scope.py`)

Record-level scoping for the two POS roles, on top of their access-sheet rights
(the sheet decides *what* they may do; this decides *which records*). It works only
once the access sheet is switched on (`access_sync.is_active()`). Filling POS Store
works either way.

- **Store** = a POS Profile. A user's stores = the POS Profiles that list them under
  *Applicable for Users* (POS Profile User).
- **Scoped users**: holders of POS Admin and/or POS Store Manager, **per document
  type** (`get_scope(user, doctype)`): limited on a type unless another of their roles
  reads that type by itself. E.g. a POS Admin who also has DAC CRM sees every Customer
  (DAC CRM reads Customer), but only POS stores' Stock Entries (DAC CRM doesn't read
  those). Admins (Administrator, System Manager, Admin, Super Admin) are never scoped.

| | POS Admin | POS Store Manager |
|---|---|---|
| POS Invoice / Opening / Closing Entry | all stores | their stores (`pos_profile`) |
| POS Profile | all | their stores |
| Customer | POS customers (POS Store set) + ones they created | their stores' customers + ones they created |
| Stock Entry | touching any store's warehouse, or made by POS staff | touching their stores' warehouses, or their own |
| Material Request | flagged Created by POS User (`custom_is_pos_request`), or their own | touching their stores' warehouses, or their own |
| Item | brands the stores list | their stores' brands (none listed = all) |
| Sales Invoice | POS Sales Invoices only | their own (sheet: O) |

Wiring:

- `permission_query_conditions` filter the lists and `has_permission` guards opening a
  record by URL, for Customer, POS Invoice, POS Opening Entry, POS Closing Entry and
  POS Profile (hooks.py).
- The hooks return nothing for unscoped users, and Frappe's has_permission hooks
  can only deny, so they never grant anything.

**Sales Invoice.** POS Sales Invoices are:
- the POS Closing's consolidated invoices (`is_pos`, with the store in `pos_profile`).
  These are often submitted by an admin, so the owner alone can't identify them.
- any invoice created by POS staff.

POS Admin (sheet VES, no O) sees and opens only those, never the company's other
invoices (`sales_invoice_query` / `has_sales_invoice_permission`, listed after the
merchandiser SO-link hooks). POS Store Manager (sheet VESO) sees only their own. The
scope would also keep them to their stores' POS invoices if O were ever removed.

The Order Flow › Tracker › Material Requests query applies the same Material Request
condition (`order_flow_api`, from `material_request_query`). The POS roles have no
Order Flow tabs anyway; see `docs/access-worksheets.md`.

**Reports.** Query and Script reports read the whole company with their own SQL, so
they bypass these rules. The POS roles are therefore not given the ones on Material
Request, Sales Invoice or Customer, or "Requested Items To Be Transferred"
(`access_sync.POS_BLOCKED_REPORT_DOCTYPES` / `POS_BLOCKED_REPORTS`). Stock reports,
Stock Balance and POS Register stay.

A store's warehouse is its POS Profile's warehouse. "Touching" means the header or
any row: Stock Entry from/to and s/t warehouse; Material Request set/from warehouse
and the rows' warehouses.

## Stores' stock requests and transfers

- **Defaults** for a new document made from a POS login (POS Admin / POS Store
  Manager, admins excluded; `public/js/pos_stock.js`, `get_my_pos_defaults`), always
  as a Material Transfer:
  - **Material Request:** target `set_warehouse` = the user's store warehouse;
    source `set_from_warehouse` = Admin Settings › POS Stock Requests › Source
    Warehouse (`pos_stock_source_warehouse`, set to VV Puram - IND by patch
    `set_pos_stock_source_warehouse`).
  - **Stock Entry:** source `from_warehouse` = the user's store warehouse. The user
    picks the receiving store.
- **Submitting a transfer:** a POS Store Manager may submit a Stock Entry only when
  every target warehouse is their store's. The receiving store confirms. POS Admin
  may submit any. Enforced by Stock Entry `before_submit`
  (`guard_pos_transfer_submit`).
- On Material Request, POS Admin / POS Store Manager don't get **"Get Item From SO"**
  (the MR planner button) or ERPNext's **Create** menu (Pick List, Material Transfer,
  Purchase Order, …). Stores request stock for the store; the warehouse does the
  rest. Admins still see both (`public/js/material_request.js`).
- **Material Request › "Stock at the selected warehouses"** (HTML field
  `custom_stock_panel`, exported in `custom/material_request.json`): per item row, the
  actual stock at its target and source warehouse, and "Available" or "Short by N"
  against the requested qty (`get_stock_for_rows`, from Bin).

## Items by the stores' brands

POS Profile › Brands (`custom_brands`) also decides which Items a POS login sees
anywhere: the Item list and every item picker, since ERPNext's `item_query` includes
permission query conditions (`item_query` / `has_item_permission`).

- **Store Manager:** their stores' brands. A store of theirs with no brands sells
  everything, so there's no limit. This matches the Point of Sale screen
  (`pos_brand_filter.py`).
- **POS Admin:** every brand the stores list. Stores without brands are ignored.
- The per-document-type rule applies: a POS user whose other role reads Items
  (e.g. DAC CRM) sees all Items.
- **Barcode scan in forms** (`erpnext.stock.utils.scan_barcode`, overridden by
  `pos_scope.scan_barcode`): a barcode, serial or batch of an item outside their brands
  finds nothing, the same as typing it in the item field.
- **Reports** (`pos_report_scope.py`). Query / script reports read the whole company
  with their own SQL. So every report a POS login runs (on screen, exported, or as a
  prepared report in the background) is cut. The hooks before_request and before_job
  wrap `frappe.desk.query_report.generate_report_result`, which both paths call.
  - Before it runs, the Warehouse filter is set to their store when they have one
    store, or replaced when it names a warehouse outside theirs. Reports that add stock
    up across warehouses (Stock Ageing) or show warehouses as columns then count only
    that store. If a report rejects that filter, it is retried as a list, then with the
    user's own filters.
  - After it runs, any row whose Item column (Link → Item) is another brand, or whose
    Warehouse column (Link → Warehouse) is outside their warehouses, is removed. Charts
    and summary cards go when rows were removed.
  - Warehouses: Store Manager, their stores' warehouses. POS Admin, every store's
    warehouse plus the supply warehouse (Admin Settings › POS Stock Requests).
  - **Which reports run at all** (`check_pos_report`, before running): for a POS login
    (`pos_scope.is_pos_staff`), stock and selling reports and POS Register only.
    - Finance, GST, HR, projects, manufacturing and CRM reports are refused ("not
      available for POS logins"), and so are stock valuation / accounting checks (COGS
      By Item Group, Stock and Account Value Comparison, …).
  - **POS Profile column:** for a POS Store Manager, the POS Profile filter is set to
    their store and other stores' rows are removed. POS Register shows only their store;
    POS Admin sees all stores.
  - Reports without Item / Warehouse columns are untouched; non-POS users never.
  - Checked as JP Nagar's store manager: Stock Balance, Stock Ledger, Stock Projected
    Qty, Stock Ageing, Warehouse-wise Item Balance Age and Value and Item Shortage
    show only JP Nagar brands and the JP Nagar store. Stock Ageing qty equals the store's
    stock on 400 / 400 items checked.

## Customer › POS Store (`custom_pos_store`)

Exported in `custom/customer.json`. It is filled automatically:

- **New customer** created by a scoped POS user → that user's first store
  (Customer `before_insert`).
- **First POS Invoice** of a customer with no store → that invoice's store
  (POS Invoice `on_update`).
- **Back-fill** (`backfill()`, once, patch `setup_pos_store_scope`):
  - each store's default (walk-in) customer;
  - customers on existing POS Invoices;
  - customers created by scoped POS users.

  Admin-created customers are excluded: Administrator and Admin users are listed on
  some stores but are not POS staff. Without that rule, a first back-fill once gave
  2,538 imported customers to one store.

A customer's store can be changed by hand on the Customer form, but only by the roles
in Admin Settings › Customer (Admin to begin with), System Manager and Administrator.

- The same applies to Industry and Merchandiser User (`custom_customer.
  guard_protected_customer_fields`), and to the list's bulk Assign Merchandiser.
- For everyone else the three fields are read-only on an existing customer, and the
  server refuses a change.
- The automatic fills above write directly to the database and aren't affected.

## Point of Sale screen (`public/js/pos_page_extend.js`, `pos_walkin.py`)

Added through `page_js` on `point-of-sale`. ERPNext's files are untouched. The script
patches the Point of Sale classes once `point-of-sale.bundle.js` has loaded, before the
screen is built.

- **Walk-in customer** card under the customer, above the Item Cart:
  - Name and Mobile No, stored on the POS Invoice as `custom_walkin_name` /
    `custom_walkin_mobile` (exported in `custom/pos_invoice.json`). The mobile is kept
    as digits.
  - Stores bill on their fixed customer, and these say who bought, so a bill can be
    found for a return without creating a customer.
  - Read-only once the bill is submitted.
- **Order summary:** full item names, wrapping instead of being cut with "…".
- **Search:** Recent Orders (`get_past_order_list` override) matches invoice ID,
  customer, walk-in name and walk-in mobile, and shows "name · mobile" for walk-in bills.
  The POS Invoice list has both fields as standard filters, in the search fields and in
  global search. The mobile is also a list column.
- **Barcode search:** the item search also matches Item › Barcodes.
  - `pos_brand_filter.get_items` attaches each loaded item's barcodes as `barcodes`.
    It's used only for searching; the core `barcode` value, which goes onto the cart
    row, is left alone.
  - When nothing matches the typed text, the server also returns items whose barcode
    contains it. Core matches only an exact barcode.
  - On screen, an exact barcode (e.g. a scan) shows just that item, so auto-add still
    works; a partial barcode also finds the item.
- **Walk-in card** uses the same card style as the customer and cart cards (shadow,
  radius, spacing).
- **Loading indicator:** "Loading items…" with a spinner while the item list loads or
  searches (around `ItemSelector.get_items`). "No items found" when empty.
- **Layout** (CSS in `dacs_style()`). The aim is **at least 5 cart items** on every
  screen, with checkout totals and Complete Order reachable.
  - The screen fits the window: `--dacs-pos-h`, set on load and on resize. Inside the
    cart column, the item list takes the space left after the customer, walk-in and
    totals cards, and scrolls.
  - Laptops (height ≤ 820px): compact rows, no item descriptions, totals in two
    columns, a smaller number pad.
  - Tablets and phones (width ≤ 991px): one column; the page scrolls. The cart keeps
    room for 5+ rows. The doubled `.point-of-sale-app.point-of-sale-app` selector
    overrides ERPNext's `grid-column: span … !important`.
  - Item edit mode (a cart item clicked): ERPNext swaps the totals for its number pad
    through inline `display` styles. Our layout rules match only those states
    (`:not([style*="none"])` for the totals, `[style*="flex"]` for the pad) so they
    never override the swap. On laptops the pad is compact, and Grand Total and
    Checkout share one row under it. Item Details scrolls inside its card.
  - Payment modes are a wrapping grid at every size, never a sideways-scrolling row.
    - Every mode is visible, and its amount stays inside its card.
    - The selected mode takes a full row for its amount box and cash shortcuts.
    - On phones it becomes one mode per row.
  - The checkout number pad is a fixed keypad at the right (up to 340px wide, 44px
    keys, 36px on laptops).
  - Tablets (≤ 991px): item cards are smaller, 3–4 per row. Phones: "All Items" on
    its own row, search and item group below it; the page title is never cut.
- **Checkout totals:** ERPNext showed the amount still owed under "Change Amount"
  (paid ₹1 of ₹199 read "Change Amount ₹198"). The third box now reads:
  - **Balance to Pay** (orange) while underpaid;
  - **Change to Return** (green) when paid more;
  - **Change Amount ₹0** when exact.

  This is `Payment.update_totals_section`, patched in `pos_page_extend.js`.
  - The order summary's cards never shrink, so they don't overlap Edit / Delete Order.
    The summary scrolls as a whole.
  - "Additional Information" at checkout shows only when the POS Profile adds fields
    to it.
  - Tested headless at 1300×650, 1300×690, 1366×768, 1920×1080, 1024×768, 768×1024 and 390×844.

## Close the POS (`pos_closing.py`, `public/js/pos_closing_entry.js`)

"Close the POS" (`Controller.close_pos`, patched in `pos_page_extend.js`) calls
`pos_closing.make_closing_entry(pos_opening_entry)`.
- It builds the whole entry on the server in one call: the opening entry's period,
  profile, user and company; the session's POS Invoices (ERPNext's `get_pos_invoices`);
  grand / net total and qty; taxes per account and rate; and payments.
- Payments: opening amount, plus each bill's payments, minus change given back on the
  change account. The closing amount starts at the expected amount, and the cashier
  enters what was counted.
- The form opens already filled (about 0.5 s). Save takes about 1 s; ERPNext's
  before_save reads the bills once more.

Before: ERPNext opened an empty entry and loaded it in the browser. Two loads could run
at once (ERPNext's own opening-entry trigger, plus a fill-in), and each cleared the
tables first, so the entry came out empty or half-filled after a long wait. Without
any load, Save failed with "payment_reconciliation is not iterable".

`pos_closing_entry.js` makes sure the tables exist. A new entry that still opens empty
with its opening entry set (made some other way) is filled once from the same server
call after 1.5 s, and only when nothing else has filled it. It never fires the
opening-entry trigger again.

Submitting it as the store user also needs India Compliance's GST Return Log create
right; see `docs/access-worksheets.md` (SUBMIT_WRITES).

## Email Receipt (`pos_receipt_email.py`)

POS Profile › **Receipt Email** (exported in `custom/pos_profile.json`):
- **Store Name** (`custom_store_name`): how the store is named to customers (e.g.
  "Dac's Inc – JP Nagar Showroom"). Used for `{store}`, under the company name at
  the top of the email, in the footer and in the subject ("Your receipt … from
  …"). Empty = the POS Profile name.
- **POS Invoice › Store Name** (`custom_store_name`, read-only, a list filter,
  exported in `custom/pos_invoice.json`): fetched from POS Profile › Store Name when
  the bill is saved.
  - Bills without one are filled from their profile on every migrate
    (`fill_store_names`, after_migrate) and when the POS Profile is saved
    (on_update, that store only).
  - A bill that already has a name keeps it, so it says where it was sold even if
    the profile is renamed later.
  - The receipt email uses the bill's Store Name first.
- **Receipt Email Account** (`custom_receipt_email_account`): receipts from this
  store are sent from this account only.
- **Receipt Email Message** (`custom_receipt_email_message`): the default text in
  the Email Receipt box. `{customer}` (the bill's walk-in name, else "Customer"),
  `{invoice}`, `{amount}` and `{store}` are filled in.

On the order summary's **Email Receipt** (`PastOrderSummary` patched in
`pos_page_extend.js`):
- The message starts with the profile's text; staff may change it. The email
  address starts with the customer's, else the last one this receipt went to.
- With no account set, the box shows a warning, and **Send is refused** with "No
  email account is set for store …". A disabled account, or one with outgoing mail
  off, is refused too. The site's default account is never used.
- The customer gets the receipt email (`receipt_html`, inline styles, light design,
  600px wide at most):
  - a white card with a teal top line, the company logo (Company › Company Logo)
    or name, and the store under it (without repeating the company when Store Name
    starts with it);
  - "Thank you for your purchase!";
  - "Dear {walk-in name}," (or "Dear Customer," when the bill has none; the
    store's fixed billing customer is never used);
  - the message;
  - Bill No / Date / Amount;
  - the items with qty and amount, net total, taxes, discount and total;
  - a note that the PDF is attached, and a sign-off ("Team …");
  - the store (and its address) in the footer.
- The invoice PDF in the profile's print format (default POS Invoice Version 2) is
  attached. It is made with `get_print(as_pdf=True)`, as Print Settings may send
  prints as HTML.
- The click only queues the mail. A background job (`send_queued`, queue "short")
  sends it straight away from the account's address; Email Queue keeps the status
  and any error. The box closes as soon as the receipt is accepted, and Send is
  disabled while it waits, so one click sends once. Sending inside the click took
  seconds over SMTP, and a hang left the box open.
- **POS Invoice › Receipt Emailed To** (`custom_receipt_emailed_to`, allowed on
  submit, read-only, exported in `custom/pos_invoice.json`) gets
  "address — dd-mm-yyyy hh:mm", one line per send, latest first. A comment on the
  invoice says who it went to and from which account.

## POS paperwork: MR mail, transfer approval, closing report (`pos_notify.py`)

**Created by POS User** (read-only check, exported in `custom/material_request.json` /
`custom/stock_entry.json`, also a list filter): Material Request
`custom_is_pos_request`, Stock Entry `custom_is_pos_transfer`.
- It's set on insert when a POS Admin or POS Store Manager creates the document
  (admins excluded).
- Patch `backfill_pos_user_flags` ticks the ones POS users made earlier.
- Rules build on this flag; every other Material Request / Stock Entry is left
  exactly as it is.

Recipients are set in **Admin Settings › POS Emails** (comma-separated, invalid
addresses skipped; empty = no mail). A mail also needs a default outgoing Email
Account on the site.

- **Material Request:** the store creates and submits it; no approval step. On
  submit, one that is Created by POS User **and** whose creator is a **POS Store
  Manager** (checked at send time) is mailed to *POS Material Request — Send To*:
  store, source, type, required-by, raised-by, and the items with requested qty and
  the current stock at source and store. A POS Admin's MR is flagged but not mailed.
- **Stock Entry** (Created by POS User) and **Approved By** (`custom_approved_by`):
  - A POS transfer whose **rows** move stock to or from the supply warehouse
    (Admin Settings › Source Warehouse, VV Puram - IND) needs warehouse approval.
    Only Warehouse Incharge / Warehouse Executive / POS Admin (or an admin) may submit
    it, and the submitter is recorded in Approved By (`guard_pos_approval`,
    `before_submit`).
  - Rows are checked, not the header: ERPNext fills the header target from Stock
    Settings even for store → store.
  - The form shows "Waiting for warehouse approval". Approvers get an **Approve**
    button (= submit); for others Submit is hidden (`public/js/pos_stock.js`).
  - Store-to-store transfers keep the receiving-store rule.
  - No Frappe Workflow is used, so subcontracting / embroidery / other Stock Entries
    are unaffected.
- **POS Closing Entry** submitted → a report to *POS Closing Report — Send To*:
  - Summary tiles: sales, returns, net collected, invoices, qty, discounts.
  - Store, cashier, opening and closing entry, net / taxes / discounts.
  - Payments per mode: opening, sales, expected, closing, difference.
  - Taxes, top 15 items, and the invoice list (first 60, with walk-in name / mobile).
  - Attached Excel: **Summary / Invoices / Items / Payments**. It's built in memory
    (openpyxl) and attached as content, so **no File record is created**; the only
    copy is inside the Email Queue message, which Frappe's outbox clean-up removes.
- Mails are sent from a background job after the submit commits (`queue="short"`).
