# Item Stock Ledger

`/app/item-stock-ledger?item=<item>` (`page/item_stock_ledger/`, data `item_ledger.get_item_ledger`). One item's stock
from its first movement, made for "where did this stock go" — e.g. a jobber says the store never sent material.
**Admin and Production Manager only**: the page's roles, and `item_ledger._check` (`frappe.only_for`), because the data
is read without document permissions.

## What it shows

Opened from the menu, or from an Item form's **Stock Ledger** button (`public/js/item.js`, shown to the same two
roles), which opens the page on that item.

Filters: Item (any words, any order — `item_query`), Warehouse, From, To (empty = from the first movement).

1. **Head** — stock now in all warehouses, in own stores, in the jobbers' warehouse, and with jobbers by their orders.
2. **Stock now** — per warehouse (Bin), with what is reserved for orders.
3. **With jobbers** — the item as a raw material of Subcontracting Orders, one row per order: jobber, SCO, PO, Sales
   Order(s), needed, sent, used, returned and **still with the jobber** (sent − used − returned, from the SCO's Supplied
   Items). All jobbers share one supplier warehouse ("Jobers Warehouse - IND"), so a warehouse balance can't say which
   jobber has what — these per-order counts do. Clicking an order shows only its movements below.
4. **Made by jobbers** — the item as the finished good of Subcontracting Orders: ordered, received, pending.
5. **Every movement** — each Stock Ledger Entry (cancelled ones left out), oldest first:
   - what it was (Sent to jobber, Used by jobber, Received from jobber, Returned by / to jobber, Purchased, Delivered,
     Sold, Customer return, Transfer, Opening stock, Stock count), the document and who submitted it;
   - jobber / supplier / customer, and **For**: SCO, PO, Sales Order(s), Pick List — from the document line where it
     has one (Purchase Receipt and Delivery Note lines, Subcontracting Receipt lines and supplied items), else from
     the document; a PO's Sales Orders come from its lines;
   - From → To with what each warehouse had left after it; a transfer (two entries of one Stock Entry line) is one row
     with the qty in **Moved**, not in In / Out;
   - **Total after** — the stock of all shown warehouses after the row, worked out from the rows (ERPNext writes a
     Stock Entry's outgoing entries before its incoming ones, so a running sum of the entries dipped mid-transfer).
   Chips filter by kind; the search box matches document, party, SCO, PO, SO, warehouse, user. With a From date the
   first row is the opening stock. At most 20,000 movements (then: choose a From date or a warehouse).

**Print** opens the page's tables on A4 landscape.
