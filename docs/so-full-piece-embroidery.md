# Full Piece embroidery from Sales Order stock

Code: `erp_dacsinc_custom/so_embroidery.py`, the "Send to Embroidery" button
and `so_show_fp_embroidery_prompt` in `public/js/sales_order.js`, and the
Sales Tracker's Embroidery subtabs in `page/order_flow/order_flow.js`.

## What it is

A **Full Piece Embroidery Work Order (EWO)** normally hangs off a Purchase
Order. Goods made on a Subcontract PO, or bought on a direct PO, go out to a
Full Piece jobber from the PO's own Full Piece dashboard and come back.

Stock already on the shelf for a Sales Order needs the same trip, with no
Purchase Order in between. That stock is sent from the Item Stock & Action
Plan widget (Sales Order form, and the Sales Tracker's expanded row). The
**Send to Embroidery · N** button in the widget header appears when at
least one item can still be sent (or brought back to draft). It opens one
dialog: per item, the ordered qty, what has already gone out by either
route, the qty on this order's draft Pick Lists, and the qty that can be
sent now — each row with its own tick box. The dialog also takes the jobber, notes and
attachments. It creates one submitted EWO with:

- `saels_order_id` = the Sales Order (the fieldname is misspelt on the
  doctype; it is the only Sales Order link the EWO has),
- `purchase_order` empty — this is what marks an EWO as "sent from SO stock"
  everywhere in the code,
- `work_type` = Full Piece Job Work, `full_piece_stage` = Sent to Full Piece
  Jobber.

Receiving it back is the same `purchase_order.create_full_piece_receipt`
that a PO-linked Full Piece EWO uses. Use the **Receive from Jobber** button
on the Sales Tracker's or Job Work tab's Embroidery - FP subtab.

Only Full Piece is sent from a Sales Order. Panel work stays on the PO side.

## No stock moves — so the widget holds it back

As on the PO side, the EWO only **tracks** qty sent and received. No Stock
Entry is posted either way, so goods out at the jobber are still in `Bin`
and still in `total_available_stock`. Without a hold, they would read as
free to pick for this order or any other.

`so_embroidery.held_at_jobber_by_item` (qty still out on submitted,
Sales-Order-raised Full Piece EWOs, across every order) is treated as a
reservation:

- `get_item_stock_details_bulk` returns `embroidery_held_qty` (every
  order's) and `embroidery_this_so_qty` (this order's own). The held qty
  comes off `truly_available_fg`. This order's own share also comes off
  `pending_fg_for_so`: those goods are this line's and are coming back to
  it, the way a submitted pick is. Without that, a BOM line would report a
  raw-material shortfall for goods that are only out being embroidered.
- The widget does the same on the client. `embroidery_held` is added to
  `all_reservation`, and `at_embroidery` is added to
  `total_planned_pipeline`. The Available cell notes "N out at Embroidery",
  and Status notes "N at Embroidery". A line covered only by goods at the
  jobber reads **At Embroidery** with a **Track Embroidery** button.
- This order's own EWOs are listed in Incoming for visibility, but they are
  not added to `total_incoming_qty`. They already came off the line's need,
  and counting them again would cover the same shortfall twice.

EWOs are keyed by item, not by Sales Order line. When the same item sits
on two lines (with and without a BOM — the known duplicate-row case), only
the first pair in `item_bom_pairs` carries this order's share.

The PO form's "Fetch Raw Materials from SO" prompt takes the hold off free
finished stock the same way (so its "To Make" matches the widget). ERPNext's
own Pick List screen does not know about it.

## A Sales Order line goes to Full Piece once, by either route

A BOM line made on a Subcontract PO can be sent from that PO's Full Piece
dashboard. Its stock can also be sent from the Sales Order. Both routes
must draw on one allowance per `(sales_order, item_code)`, or the same
units get two EWOs and neither can be tracked.

`fp_sent_by_so_item(sales_orders)` is the one count both sides read:

- `so_direct`: qty on this order's Sales-Order-raised EWOs.
- `po_linked`: qty on EWOs raised from a PO whose lines for the item belong
  to this order. On a Subcontract PO the line's `item_code` is the service
  item, so the match is on `IFNULL(fg_item, item_code)`. One PO can cover
  the same item for several orders: PUR-ORD-2026-00136 carries Beige T
  Shirt for SO-00143/144/145 at 40/40/39. The EWO's qty is then split by
  line qty, so a 60-piece PO send counts 20.17 / 20.17 / 19.66. It is not
  charged in full to each order.

`so_fp_remaining` = ordered − max(delivered, so_direct + po_linked).
Embroidered goods come back and are then delivered, so delivered and sent
overlap rather than add.

- **Sales Order side**: `sendable` = min(remaining, **qty on this order's
  unheld DRAFT Pick Lists** for the item). That is the one rule — see
  "Only draft Pick List qty can be sent" below. `create_so_fp_embroidery`
  re-checks each qty against the same figures under a `FOR UPDATE` lock on
  the Sales Order row, so a stale dialog or a second tab cannot over-send.
- **PO side**: `cap_po_fp_balance` caps `get_full_piece_dashboard_data`'s
  `balance_avail` by what the item's Sales Orders still have left. A
  Subcontract PO lists the same FG once per Sales Order line, so the
  allowance is **one budget per item, spent down across those rows** (39,
  40, then 10 once 30 were sent from SO-00144). If each row were offered
  the whole remainder, the rows together could exceed it.
  `create_full_piece_send` calls `validate_po_fp_send` with the same cap.

## Only draft Pick List qty can be sent — and it holds that Pick List

The rule, in the order the user meets it:

1. **Only qty on a DRAFT Pick List of this order can go to embroidery.**
   Free stock nobody has picked cannot (pick it first); delivered qty never
   can (`so_fp_remaining` already excludes it).
2. **A submitted Pick List can be brought back to draft first** —
   `revert_pick_list_to_draft` (cancel + amend into a new draft; hold fields
   cleared) — offered in the dialog as **Revert to Draft** next to each
   submitted Pick List (`submitted_pick_lists` per row).
3. **Not once a Delivery Note exists for it.** Any DN, draft or submitted,
   made from that Pick List (`Delivery Note Item.against_pick_list`), or any
   delivered qty on it, locks it: the dialog shows "on Delivery Note … —
   cannot send" and the revert endpoint refuses.
4. **The user picks what to send.** Every row has a tick box, none ticked by
   default; only ticked rows (qty editable up to Can Send) are sent.
5. **While held, the draft Pick List can't be submitted, deleted, or cut
   below the held qty** (`guard_pick_list_submit` on before_submit,
   `guard_pick_list_hold_edit` on validate / on_trash).

A draft reserves nothing physically (Bin is unaffected until a Delivery
Note), so if its qty went to a jobber while the Pick List stayed an ordinary
draft, a Delivery Note could later ship stock that is away being embroidered.
Every send therefore claims from this order's own draft Pick Lists FIFO
(oldest first) and holds whichever Pick List(s) it draws from:

- `_consume_draft_pick_lists_for_embroidery(sales_order, item_code, qty)` —
  the draft `Pick List Item` rows for this order + item, oldest Pick List
  first, each contributing its own picked/allocated qty
  (`picked_qty or qty`) up to what's still needed. A Pick List already on
  hold (an earlier send still outstanding) is skipped — one hold must
  clear before another can be claimed against the same Pick List. Returns
  the claimed `{"pick_list", "qty"}` list and whatever it could not cover
  (always 0 for a send that passed the `sendable` cap).
- `create_so_fp_embroidery` runs this per item (after the `sendable` cap
  above, under the same Sales Order lock) and stores the claim list as
  JSON on the new EWO Item row's own `source_pick_lists` field — a native
  field on `Embroidery Work Order Item` (this app owns that doctype), not
  a Custom Field. Each claimed Pick List is then held via
  `_apply_pick_list_hold`: `custom_embroidery_hold_qty` (Float, Custom
  Field) accumulates the claimed qty, `custom_embroidery_ewo` (Link)
  records which EWO is holding it.
- **`Pick List.before_submit`** (`guard_pick_list_submit`, wired in
  `hooks.py`) throws while `custom_embroidery_hold_qty > 0`, naming the qty
  and linking the EWO — "sent to jobber, need to collect". This fires
  regardless of which path submits the Pick List: the core Submit button,
  `update_and_submit_pick_list`, or `get_pick_list_flow`'s own submit
  dialog — one hook, every path.
- **Receiving releases it**: `purchase_order.create_full_piece_receipt`
  calls `release_pick_list_holds(doc)` after saving. For each EWO Item row
  with a `source_pick_lists` claim, it recomputes — from the row's own
  (cumulative) `received_qty`, not the qty just received — how much of
  each claimed Pick List is now genuinely back, and sets that Pick List's
  hold to whatever of its claim is still outstanding (0 once its whole
  claim has been received, which also clears `custom_embroidery_ewo`).
  Recomputing from scratch each call makes this safe to run on every
  receipt, including a second partial one, with no separate "already
  released" bookkeeping needed. A no-op for a PO-linked EWO (no rows carry
  `source_pick_lists`).

**Shown wherever a Pick List shows up** — one flag
(`embroidery_hold_qty` / `embroidery_ewo`), the same wording
("N sent to jobber, need to collect", linking the EWO) everywhere:

- The Sales Order widget's **Pick Lists (N)** modal
  (`show_so_picklists_modal`) — the qty input and Submit button are
  replaced by the hold note for a held row.
- Order Flow's **Pick Lists tab** (`get_pick_list_flow` /
  `picklist_html`): `next_action` reads `"held"` (ahead of `"submit"`), the
  Action column shows the hold note, and the Status column repeats it
  under the Draft pill.
- The **Send to Embroidery** dialog itself: columns Ordered · Already Sent ·
  On Draft Pick List · Can Send · Send Qty, a tick box per row, and the
  submitted Pick Lists of each item with Revert to Draft (or the DN that
  locks them). The widget's "Send to Embroidery" button appears when any
  line has draft Pick List qty, or a submitted Pick List with no DN.

Both custom fields are created (idempotently) by
`so_embroidery.create_embroidery_pick_list_fields`, wired to
`after_migrate` alongside this app's other one-shot field-creation
functions (see `logistics_tab.create_logistics_fields` for the same
pattern) — a fresh deploy creates them, they don't need to pre-exist.

## Every trip stays visible: sent → received history

`embroidery_history_for_pick_lists(pick_lists)` (so_embroidery.py) returns,
per Pick List, every SO-direct Full Piece trip that drew on it — EWO, date,
jobber, **sent**, **received**, **at jobber** — computed from the EWO Item
rows' `source_pick_lists` claims (received split across a row's source Pick
Lists oldest first, the same order `release_pick_list_holds` uses). It is
kept after the hold is released, so a Pick List always shows where its qty
went. Shown as one flag plus one line per trip:

- purple "Embroidery: sent 5 · back 3 · 2 at jobber" while anything is out,
  green "Embroidery: sent 5 · all back" once it has all returned;
- in the Sales Order's **Pick Lists** modal (status cell,
  `get_pick_lists_for_so.embroidery_history`), the Order Flow **Pick Lists
  tab** (`get_pick_list_flow`), the **Send to Embroidery** prompt row
  (`_so_fp_rows.embroidery_history`, all trips for that item on the order),
  and the **Pick List form** headline (`get_pick_list_embroidery_history`,
  public/js/pick_list.js — orange while out, green when all back).
- On the **Item Stock & Action Plan** row itself (`embroidery_history` per
  pair from `get_item_stock_details_bulk`, via `embroidery_history_by_item`):
  a clickable flag in Status — "Embroidery: N at jobber" or "N sent · all
  back". It opens `so_show_embroidery_history`: every trip (EWO, date,
  jobber, sent, received, at jobber) and, for a trip still out, its next
  action in place — a qty + **Receive** calling
  `purchase_order.create_full_piece_receipt` with the trip's `ewo_item`
  (which also releases the Pick List hold). Finished trips stay listed as
  ✓ Received, so the row never loses its history.
- In the row's **Available Stock → View**, **Incoming → View** and
  **Picked → View** dialogs, section "Embroidery — sent & received"
  (`so_embroidery_trips_section`): every trip, finished ones
  included (the "Pending for this Sales Order" table above it only lists
  what is still out), each with **Receive** (`so_receive_embroidery`, asks
  the qty) while anything is out and **Print**; **Print All** downloads every
  EWO of the item as one PDF (`so_print_ewo` → `download_multi_pdf`, print
  format "Embroidery Work Order Print Format"). The history dialog has the
  same Print / Print All.

## At the jobber: one big label; submitted by mistake: Revert to Draft

- While a draft Pick List holds qty out at a jobber it shows a purple
  **AT JOBBER — N sent for embroidery · Cannot submit until received back**
  block (`_so_embroidery_hold_html` in the SO Pick Lists modal,
  `of_embroidery_hold_html` in the tracker's Pick Lists tab). On the Pick List
  form (`public/js/pick_list.js`, `get_pick_list_state`) the title indicator
  reads "At Jobber", a large headline says the same, and the Submit button is
  removed; once everything is back the headline turns green ("Embroidery done
  — … You can submit this Pick List") and keeps the trip lines.
- **Revert to Draft** for a submitted Pick List is on the Pick List form, the
  SO Pick Lists modal, the Item Stock & Action Plan's **Picked (This SO) →
  View** popup and the tracker's Pick Lists tab (plus the Send to Embroidery
  prompt). The new draft keeps each row's `qty` but starts with
  `picked_qty` / `delivered_qty` = 0 (a draft has picked nothing yet). `pick_list_revert_state` marks a row `revertable` only
  when it is submitted, not Completed/Cancelled, nothing delivered and no
  Delivery Note (draft or submitted) made from it; otherwise the row shows
  "On DN-… — can't revert". The server (`revert_pick_list_to_draft`) refuses
  the same cases.
- Finished embroidery stays visible on the Item Stock & Action Plan row: the
  Available Stock cell adds "✓ N embroidered · back (EWO…)" (clickable to
  the history) and the Status flag wraps instead of being cut off.

## Links must point at documents that exist

An Embroidery Work Order links to its Purchase Order and Subcontracting
Order. If either is removed underneath it, the EWO can never be saved again
(Frappe link validation — so its goods can't be received back) and every
screen that follows the link breaks (the Job Work tab asked
`get_sco_status_for_po` for the missing PO on every render → a stream of
404s; the PO link opened "Purchase Order not found"). Now:

- **Prevented**: `guard_linked_embroidery` (Purchase Order and
  Subcontracting Order `before_cancel` + `on_trash`) refuses while an EWO
  (draft or submitted) still points at the document — cancel the EWO first.
- **Shown honestly**: `_ewo_lists` returns `po_exists`; a row whose PO is
  gone shows the number struck through with "PO deleted" (no link), and the
  page never asks for its SCO status. `get_sco_status_for_po` returns
  `{"missing": true}` instead of a 404 for a PO that doesn't exist.

## Attached images travel with the work order

Files attached to an Embroidery Work Order (design images, dispatch photos —
e.g. from the Send to Embroidery dialog's Attachments table) show as small
thumbnails wherever that EWO appears: the Embroidery - FP / Panel lists
(Sales Tracker and Job Work, via `_ewo_lists` → `attachments`), every
embroidery-history view (the SO row's history dialog, the "Embroidery — sent
& received" section of the Available Stock / Incoming / Picked popups, the
Pick List history in the SO Pick Lists modal, the Pick Lists tab and the Pick
List form — via `_with_attachments` on each trip), and the Purchase Order's
Full Piece dashboard (its own `images`). `so_embroidery.ewo_attachments`
reads them in one query per list. Up to 4 thumbnails, "+N" for more; a click
opens the image full size (`so_view_attachment` / `of_view_attachment`);
non-image files show as a paper-clip link. Private files open for anyone who
can read the EWO (Frappe's own file permission).

## The Embroidery Work Order form is internal — never linked

The EWO doctype is the team's own working document, not something to expose
to the client, so no screen links to its form. Its number is shown as plain
text everywhere (Order Flow EWO lists, embroidery history, the SO widget's
popups via `link_id_name`, the Pick List form, the PO's Full Piece dashboard
and linked-documents table). Where a button used to open the EWO it now opens
**`so_show_so_embroidery(sales_order)`** — every embroidery trip of the
order, all items, with Receive / Print / images: the tracker's "Track
Embroidery" stage action (`open_doc` with an EWO target) and the Document
Flow "Job" count when it holds EWOs; the SO row's "Track Embroidery" opens
the item's history. A PO-linked embroidery still opens its Purchase Order.
The thumbnails' "+N" opens a gallery (`so_ewo_gallery` / `of_ewo_gallery`).
Printing the EWO PDF is unchanged (a download, not the form).

## Where they show up

- **Sales Tracker → Embroidery - FP / Embroidery - Panel** (subtabs next to
  Material Requests): the same lists as the Job Work tab. Both come from
  `order_flow_api._ewo_lists`, with merchandiser scoping keyed to the
  tracker tab. A plain Merchandiser User sees only work orders for their
  own customers' orders or orders they raised. On the tracker such a user
  gets the open-document link, not the Receive/Send/Close actions, the same
  view-only rule as the rest of the tab.
- `_ewo_lists` resolves an EWO's Sales Order as
  `COALESCE(saels_order_id, poi.sales_order)`. That keeps the open-order,
  disabled-order and merchandiser conditions working for EWOs sent from SO
  stock. The Purchase Order column shows a **From SO stock** chip for them.
- **Tracker row**: `_EVENT_SQL` reaches an EWO's order through its PO, so it
  never sees a Sales-Order-raised EWO. `_get_tracker_rows` therefore adds
  them directly: they count in the Document Flow's Job column (linking to
  the EWO itself), and one still out at the jobber puts the order in the
  **Embroidery** stage, if nothing earlier in the stage order applies. They
  do not appear in the activity stream.
- **Permissions**: the button and `create_so_fp_embroidery` need create
  permission on Embroidery Work Order. The EWO is then inserted and
  submitted with `ignore_permissions`, as `create_full_piece_send` does on
  the PO side.
