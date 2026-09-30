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
  - Phones (≤ 620px): payment modes are stacked one per row, so the amount and cash
    shortcuts fit.
  - The order summary's cards never shrink, so they don't overlap Edit / Delete Order.
    The summary scrolls as a whole.
  - "Additional Information" at checkout shows only when the POS Profile adds fields
    to it.
  - Tested headless at 1300×690, 1366×768, 1920×1080, 1024×768, 768×1024 and 390×844.

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
