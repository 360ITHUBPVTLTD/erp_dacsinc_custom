# Stock held for Sales Orders (`stock_hold.py`)

Stock in **VV Puram - IND** (where every Pick List is made) that is held for a Sales
Order can't be taken by anything else.

## What holds stock

- **Pick Lists**, draft or submitted, not Completed / Cancelled, whose order is still
  open. A submitted row holds picked − delivered; a draft row holds its qty. This is
  the same rule as `order_flow_api._rm_stock_pools` and the Item Stock & Action Plan.
- **Goods at a Full Piece embroidery jobber** on an order-raised Embroidery Work
  Order. They never left the Bin.
- **Raw material bought for an order**, not yet used by its own subcontracting (the
  earmark in `_rm_stock_pools`).

**When holds add up to more than is on the shelf, the oldest wins** (`allocate`):

1. goods at the jobber first, since they've physically gone;
2. then Pick Lists by creation, draft or submitted alike;
3. then earmarks.

A document is stopped only by what other orders really get ahead of it, so two
orders claiming the same few units never lock each other.

## What is checked

Each check counts only stock leaving VV Puram, and only other orders' holds:

| Where | When |
|---|---|
| Delivery Note (its own orders' / Pick Lists' holds are its to take) | before submit |
| Sales Invoice with Update Stock | before submit |
| Stock Entry, every purpose (transfers to POS stores, issues, repack…) | before submit |
| Stock Reconciliation lowering the qty | before submit |
| Purchase Receipt / Purchase Invoice / Subcontracting Receipt **returns** | before submit |
| **Cancelling** any stock document that brought stock in (Purchase Receipt, Subcontracting Receipt, Stock Entry, Stock Reconciliation, returns…) — read from its Stock Ledger Entries | before cancel |
| Pick List submit (this Pick List's own hold excluded) | before submit |

Details:

- **Send to Subcontractor:** earmarks are left to its own borrowing rule
  (`custom_script.flag_subcontract_rm_borrowing`); pick and jobber holds still apply.
- **Purchase Receipt cancel:** the draft put-away Pick Lists it created are deleted by
  that same cancel, so they don't count.
- **Deleting** a submitted document requires cancelling it first, so the cancel check
  covers it.

The check speaks only when holds are the reason. When nothing is held and the shelf
is simply short, it stays out of the way, and ERPNext's own "insufficient stock"
message (or the subcontract raw-material rule) explains it.

The message names the item, how much would leave, how much is free, and which orders
and Pick Lists hold the rest. When the document's own order holds more than is on the
shelf, it also says "the picked stock has gone": the stock was removed after picking,
typically by a cancelled receipt.

## A Pick List only claims stock that is there

`fit_pick_list_to_free` runs on Pick List before_save, after ERPNext's own
allocation.

- A draft is cut down to what is really free for it: on the shelf, minus what older
  claims get (`allocate`).
- Rows with nothing left are dropped, with an orange message. A Pick List with
  nothing left isn't saved ("No free stock").
- It applies to every source: the automatic ones on Sales Order submit, Purchase
  Receipt put-away, Create Pick List, and hand edits.
- An amended Pick List (reverted to draft) keeps its original's place in the queue
  (`_seniority`, and the `amended_from` join in `holds_for`).
- A Pick List on hold for embroidery is left to `so_embroidery`.
- Goods sent to the jobber off a draft Pick List are counted once (the Pick List's
  `custom_embroidery_hold_qty` comes off the Embroidery Work Order's figure).

With this and the checks above, what Pick Lists hold never exceeds what is on the
shelf. A Delivery Note made from a Pick List therefore goes through.

## Correcting existing Pick Lists (`correct_pick_lists`, patch `correct_pick_lists_missing_stock`)

Runs once per site on migrate. Preview it with
`bench --site <site> execute erp_dacsinc_custom.stock_hold.correct_pick_lists --kwargs "{'dry_run': 1}"`.

It handles drafts first, then submitted Pick Lists, oldest first:

- **Draft:** cut to what it really gets, or deleted if that is nothing.
- **Submitted, not delivered:**
  - its draft Delivery Notes (which couldn't be submitted) are deleted;
  - it goes back to draft (cancel + amend) for what is on the shelf, or is
    cancelled if that is nothing.
- **Partly delivered, on a submitted DN, or on hold for embroidery:** left alone and
  reported.
- Every change is noted as a comment on the Sales Order.

After it, `report_missing` shows nothing.

## Override

Admin Settings › **Stock Hold** › "May use held stock" (`stock_hold_override_users`,
Multiselect User).

- Those users, Administrator and System Manager go past the check with an orange
  warning.
- The document gets a comment recording it.
- Everyone else is stopped.

## Stock missing on Pick Lists

`missing_by_pick_list()` runs the same allocation and reports how much of each open
Pick List's hold is not on the shelf.

- Order Flow › Pick Lists shows it as **Stock missing: N**, so it's fixed before a
  Delivery Note is tried.
- On any site, `bench --site <site> execute erp_dacsinc_custom.stock_hold.report_missing`
  prints the full list. It's read-only.

## Why not ERPNext's own stock reservation

Enabling Stock Reservation Entries would block most ledger postings natively. It
doesn't fit this flow, though:

- A Pick List can't be submitted once its order has reservations
  (`PickList.validate_sales_order`).
- Stock Reconciliation is refused for reserved items.
- POS Invoices ignore reservations.
- Cancelling or reverting a Pick List leaves orphan reservations.
- It knows nothing of draft Pick Lists, jobber stock or earmarks.

This guard uses the same numbers the dashboard shows instead.
