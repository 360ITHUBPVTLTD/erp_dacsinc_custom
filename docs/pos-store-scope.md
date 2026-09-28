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
| Stock Entry / Material Request | touching any store's warehouse, or made by POS staff | touching their stores' warehouses, or their own |
| Item | brands the stores list | their stores' brands (none listed = all) |

Wiring:

- `permission_query_conditions` filter the lists and `has_permission` guards opening a
  record by URL, for Customer, POS Invoice, POS Opening Entry, POS Closing Entry and
  POS Profile (hooks.py).
- The hooks return nothing for unscoped users, and Frappe's has_permission hooks
  can only deny, so they never grant anything.

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
- **"Get Item From SO"** (the MR planner button, `public/js/material_request.js`) is
  hidden for POS Admin / POS Store Manager: stores request stock for the store, not
  against Sales Orders. Admins still see it.
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

A customer's store can be changed by hand on the Customer form.

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
