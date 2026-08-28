# Sales Order → Raw Material → Purchase Order → Subcontracting flow

## The chain

A Sales Order line for a BOM item doesn't get delivered directly — it gets
produced through a subcontractor:

```
Sales Order Item (qty, bom_no)
  → BOM explosion → raw material need (Fabric, Buttons, …)
  → raw material sourced: already in stock, or via Material Request / plain
    Purchase Order, or already sent to a subcontractor on an earlier round
  → a subcontracted Purchase Order (service item + fg_item + BOM + qty)
  → "Create SC" → Subcontracting Order + a "Send to Subcontractor" Stock
    Entry (the RM physically leaves VV Puram for the jobber)
  → Subcontracting Receipt (the jobber returns the finished good; this is
    what actually consumes the supplied RM and credits FG stock)
  → Pick List → Delivery Note / Sales Invoice
```

Warehouses: `VV Puram - IND` is the main stock warehouse everything is
scoped to; `Jobers Warehouse - IND` is where supplied RM sits while a
subcontractor is working on it.

## A Purchase Order can't order more than its own Sales Order line needs

`custom_script.guard_po_item_not_over_so_need` (Purchase Order `validate`)
blocks saving a PO row linked to a Sales Order line (`sales_order_item` set)
when the TOTAL ordered against that line — this row plus every other
draft-or-submitted Purchase Order Item already referencing the same
`sales_order_item` — would exceed that line's own `qty`. Over-ordering at
entry time is exactly what forces every one of the downstream defenses
this app already carries: `create_putaway_picklist`'s own allocation cap,
the Item Stock & Action Plan widget's "shortfall vs already-on-order"
reconciliation. Blocking it here is simpler than reconciling it after the
fact in every place it could resurface.

Deliberately scoped to rows that actually carry a `sales_order_item` link
— a row for the very same item added to the very same PO WITHOUT that
link (general stock, a different customer's need, anything not claiming
to serve this SO line) is entirely unrestricted, and correctly so: no
RM/coverage query anywhere in this app attributes qty to a Sales Order by
bare `item_code` match — all of them key off `sales_order`/
`sales_order_item` (see `get_item_stock_details_bulk`'s own PO/receipt
queries above, and `_EVENT_SQL`'s `is_rm_tier` in `order_flow_api.py`), so
an unlinked row was never going to be miscounted as fulfilling this SO's
need in the first place.

Verified live: a 600-qty SO-linked row against a 500-qty line is blocked;
an unlinked 600-qty row on the same PO for the same item is unaffected; a
500-qty SO-linked row (exactly the line's need) succeeds; a second,
separate SO-linked PO for even 1 more unit on top of that already-full
line is also blocked (checked against ALL existing draft/submitted POs for
that line, not just rows on the current document).

## A Purchase Receipt auto-creates a Pick List — capped to what the SO needs

`purchase_order.create_putaway_picklist` (hooked on Purchase Receipt
`on_submit`) auto-drafts a Pick List for whatever a PR just brought in
against a Sales Order — that PL's own qty must never exceed what the SO
line actually still needs, for two independent reasons discovered live:

- **A single receipt bringing in more than the SO needs** (a 600-qty PO
  with only a 500-qty SO line — over-ordered batch size, supplier MOQ,
  etc.) must allocate only the SO's genuine remaining balance to that
  Pick List; the rest stays in stock, unallocated, available for other
  orders. Tracked per this-hook-invocation via `allocated_so_far`.
- **Two SEPARATE receipts, each arriving before the other's Pick List is
  submitted** (300 landed via one PR, then another 300 via a second PR,
  both against the same 500-qty line, before either auto-created Pick
  List was submitted) — confirmed live to auto-create TWO Pick Lists
  totalling 600 for a line that only needed 500. `Sales Order Item.picked_qty`
  alone can't catch this: it only updates once a Pick List is actually
  *submitted* (`validate_picked_items`, on submit) — a still-draft Pick
  List from moments ago reads as "nothing reserved yet". Fixed by also
  querying `Pick List Item` directly for every draft-or-submitted row
  against this exact `sales_order_item`, and — since a draft row's own
  `picked_qty` is *also* still unset at this point, only its `qty` is —
  summing `CASE WHEN docstatus = 1 THEN picked_qty ELSE qty END` rather
  than `picked_qty` alone.

Both checks combine into one `already_covered` figure: whichever is
greater of `delivered_qty` and this now-accurate existing-reservation
total, capped at the line's own `qty`. Verified live: two separate 300-qty
receipts against a 500-qty line now correctly produce Pick Lists totalling
500, not 600.

## Item Stock & Action Plan (the Sales Order's own widget)

Server: `get_item_stock_details_bulk` in `custom_script.py`.
Client: `public/js/sales_order.js` (`get_rm_breakdown_html` and the FG row's
Status/Next Action cell around `so_rm_physically_in_stock`).

For each Sales Order line this computes `fg_shortfall` — how many more units
of the finished good still need producing, after netting out delivered
qty, physical FG stock, and picks. **`fg_shortfall` is the thing that drives
everything downstream** — the raw material section only asks "is RM ready
for whatever `fg_shortfall` still needs", never for the line's full
original qty. A line that's already fully covered by stock/picks needs no
raw material at all, no matter how little of it is on the shelf.

### RM Pipeline coverage formula

```
Coverage = Stock + Pending MR + Pending PO + Outstanding at Jobber
Shortfall = max(0, Needed − Coverage)      Needed = fg_shortfall × BOM qty-per-unit
```

Status per raw material (rounded to 2dp before comparing, to avoid a
float-noise "13.999 vs 14" reading as a shortage that isn't real):

- **Not Required** — `Needed <= 0` (the FG itself needs no new production
  right now).
- **Shortage** — `Coverage < Needed`.
- **Covered** — physical Stock alone already `>= Needed`.
- **Requested** — Coverage clears it, but physical Stock alone doesn't — a
  pending MR/PO, or RM already sent to a jobber, is what's closing the gap.
  This is a deliberately honest middle state: it must never read as
  "Covered" (implying the stock is physically here) when it isn't.

### A second, partial Subcontract PO was wrongly blocked as "RM Not in Stock"

`so_rm_physically_in_stock` gates the "Subcontract PO" button — physical
stock only, no credit for a pending MR/PO or Outstanding-at-Jobber, per
`check_bom_raw_materials_in_stock` server-side. It used to always compare
against the row's own `rm_needed_for_shortfall`, which reflects the FULL
current fg_shortfall regardless of anything already committed toward it.
Confirmed live: a 200-unit fg_shortfall had already committed 150 of it to
an earlier Subcontract PO/SCO (physical stock reduced accordingly, the
rest sitting "Outstanding at Jobber"), leaving 50 genuinely still needed.
Physical stock exactly covered raw material for that remaining 50 — but
the check still compared it against RM needed for the full original 200,
so it read as short and blocked the second, smaller Subcontract PO the
user was actually trying to raise.

`check_bom_raw_materials_in_stock` server-side already takes the real qty
being ordered as its own parameter and gets this right (`so_row.qty -
so_row.delivered_qty`, or whatever qty the caller passes) — the bug was
purely client-side, in the indication shown before the user could even
reach the server. `so_rm_physically_in_stock(d, qty)` now takes the same
specific qty `so_buy_btn` is about to raise a PO for, and — when given —
checks each raw material's available stock against `qty * rm_qty_per_fg`
for THAT amount, not the row's static full-shortfall figure. Called
without a `qty` (the fallback), it behaves exactly as before.

### "In Process at Jobber" — a coverage source, not just "Requested"

The per-row status collapsed three different coverage sources into one
word, "Requested", the moment coverage closed without a genuine shortfall
but physical stock alone didn't cover it — a pending MR, a pending PO, AND
raw material already **sent to the subcontractor** (`rm_transferred_to_sc_total`
> 0) all read identically as "Requested — nothing has moved yet". But
material already at the jobber means job work has *physically started* on
however much went — a materially further-along state than a paper
request nothing has happened to. Confirmed live on a real order (BOM-Item
2, 400/200 Meter each of two raw materials fully sent to the jobber): both
rows now read "In Process at Jobber" instead of "Requested", and the
header pill above the table says "Sent to Jobber — In Process" instead of
"Requested — Awaiting Arrival" (`rm_in_process_exists`, alongside the
existing `rm_shortfall_exists`/`rm_pending_arrival_exists` flags).

Handles a partial mix too: if only PART of a row's coverage came from
material already at the jobber and the rest is still just a pending MR/PO,
the row still says "In Process at Jobber" (the more-advanced state wins
the label) but gets an extra note — "+ {qty} still just requested" — so
the split is visible rather than one word standing in for both.

### The RM Pipeline's "Outstanding at Jobber" reference names the PO, not just the SCO

This whole flow is managed from the Purchase Order, not the Subcontracting
Order directly — the References column's "Outstanding at Jobber" entry
used to link only the SCO (`transfer_documents`), leaving no way back to
the actual document the user works from. The same query that resolves the
SCO already joins `sco.purchase_order` (needed for the `po_fg_totals`
denominator above), so it now also returns `transfer_po_documents`
(`GROUP_CONCAT(DISTINCT sco.purchase_order)`), rendered first/primary as
"PO {name}" with the SCO named alongside as "SC {name}" for the specific
reservation. Verified live against a real transfer: resolves to the
correct originating Purchase Order for a known Subcontracting Order.

### A non-SO "extra" row on the same PO must not dilute a real SO's own share

The proportional-share query above (`this_so.so_fg_qty / po_fg_totals.total_fg_qty`)
divides one subcontracted PO/SCO's outstanding-at-jobber RM among however
many Sales Orders share it — by design, a single PO can carry service-item
rows for SEVERAL real Sales Orders against the same finished good. But its
denominator (`po_fg_totals`) originally summed `fg_item_qty` across EVERY
row for that finished good on the PO, including a row added with NO Sales
Order reference at all (extra qty for general job-work demand, not tied to
any SO) — inflating the shared pool's total demand and correspondingly
*diluting* the real SO's own credit, even though that extra demand isn't
a competing Sales Order's claim on anything. Fixed by scoping
`po_fg_totals` to `sales_order IS NOT NULL AND sales_order != ''` — the
exact same condition the numerator's own `this_so` subquery already
applies — so an unlinked row is excluded from both sides of the ratio,
matching the query's own original intent ("divide it fairly among
whichever real Sales Orders share this PO/SCO"), not accidentally
including demand nothing here is actually asking to be divided by.

### The same "extra row" produces awkward decimal transfer quantities — and rounding it down broke receiving

`purchase_order.create_subcontracting_docs` prorates a single "Qty to
Supply" total (typed as a clean integer in "Raw Material Stock Check &
Planning") across however many Stock Entry rows a raw material has — one
per Subcontracting Order Supplied Item row, which is one per PO
service-item row that consumes it. Adding an "extra" row for the same
finished good on the same PO (the same scenario as directly above) means
that single raw material now has 2+ rows to prorate across, and the exact
proportional split (e.g. 50:5) rarely divides a round number evenly —
confirmed live: typing 50 produced Stock Entry rows of 45.450 and 4.550
(true shares 45.4545... and 4.5454...). The total was always exactly
right; only the per-row split was ugly.

The FIRST fix for this (round every row but the last to 2dp, last row
absorbs the remainder) turned out to be actively unsafe: it rounds some
rows *down* from their true share — 45.4545... down to 45.450 — but the
Subcontracting Receipt's own "Consumed Qty" for that row is computed later
from the BOM's own unrounded qty-per-FG ratio, landing at 45.455.
Confirmed live: receiving that SCO hard-blocked with "Consumed Qty 45.455
Meter must be less than or equal to Available Qty For Consumption 45.45
Meter" — the rounded-down transfer was 0.005 short of what the row would
actually need to consume.

Rounding UP (ceiling) instead of to-nearest fixes this correctly: a value
ceiling-rounded to 2dp is always >= its true share, and therefore >= any
reasonable rounding of that share ERPNext computes later — so a row can
never be transferred less than it will need to consume. Every row is now
`math.ceil(row.qty * 100) / 100`, no "last row absorbs the remainder"
step at all. The total transferred may land a few hundredths above what
was typed (verified: 50 → 45.46 + 4.55 = 50.01) — immaterial for a real
transfer. If ceiling-rounding every row for an item would need more than
what's physically in stock (a rare edge case — at most a few hundredths
per row), `create_subcontracting_docs` now throws a specific error naming
the item, how many rows it's split across, how much rounding-safe transfer
would need, and how much is actually available, rather than letting
ERPNext's own submit-time "Insufficient Stock" check fail later with a
much less specific message.

### Supplying less than Required Qty must be blocked, not silently accepted

"Raw Material Stock Check & Planning"'s "Supply Status" column used to only
check one direction: whether the typed "Qty to Supply" *exceeded* "Max You
Can Send" (physical stock, or the Over Transfer Allowance — whichever
binds). It never checked whether the typed qty fell *short* of Required
Qty. Confirmed live: Required 110 Meter / Available 100 Meter (and
Required 55 / Available 50 on a second raw material) let "Qty to Supply"
sit at 100/50 with a plain green checkmark and no warning at all — the
dialog treated "less than required, but that's all there is" as fully
fine. "Create SCO & Material Transfer" went through, and the shortfall only
surfaced later at Subcontracting Receipt as ERPNext's own "Consumed Qty
must be less than or equal to Available Qty" error — the exact same failure
mode as the ceiling-rounding case above, just reached from stock being
genuinely insufficient instead of a proration rounding error.

Both the client dialog and the server now also check the floor: a raw
material whose "Qty to Supply" is below its Required Qty gets the same red,
blocked treatment as exceeding the ceiling (red status icon, invalid input
border, a per-row "N short of Required — will fail at Subcontracting
Receipt" note, and the primary button disabled) — in the client's
`rebuild_table`/`update_row_ui`/`primary_action` in `purchase_order.js`.
Server-side, `create_subcontracting_docs` independently recomputes Required
Qty per raw material via `get_required_raw_materials_for_po` (never
trusting the client's own number) and throws, naming exactly which raw
material(s) are short and by how much, *before* `make_subcontracting_order`
runs — so the failure is specific and immediate rather than surfacing many
steps later as ERPNext's own generic Stock Entry submit error.

There is no "supply what you can" recovery inside this dialog: it only ever
transfers raw material for the finished-good qty already fixed on the PO
row, so the one real fix when stock is short is to reduce the subcontracted
qty for the finished good(s) consuming that raw material on the Purchase
Order itself (or bring in more stock) — never to let a partial transfer
through and rely on it "closing the gap" later.

### "Outstanding at Jobber" — the single most important lesson here

Raw material sent to a subcontractor stops showing up in Stock at VV Puram,
but it isn't lost — it's still committed to producing this exact order, so
it must keep counting as coverage. **The critical subtlety: that credit is
only valid until a Subcontracting Receipt actually consumes it.** Once
consumed, it has already turned into finished-good stock (which is what
drops `fg_shortfall` itself) — continuing to also credit it as RM coverage
for whatever *new* shortfall exists afterward is double-counting the same
material twice.

The correct source is **`Subcontracting Order Supplied Item`**'s own ledger
— `supplied_qty − consumed_qty − returned_qty` — never a raw sum of "Send to
Subcontractor" Stock Entry quantities ever made (that number never goes
down once something is consumed, and looks identical whether the material
is still at the jobber or long since turned into product). This exact bug
shipped once: crediting the full historical transfer as permanent coverage
made a genuinely out-of-stock raw material read as "Requested" with no
visible reason once the order needed a *second* round of production beyond
what the first Subcontracting Receipt already delivered.

The RM Pipeline table also shows, purely for context, how much of the
*same* raw material is currently outstanding at a jobber **for other Sales
Orders** — a batch purchase is a shared pool, and once part of it is
committed elsewhere (and not yet consumed there either), that's why Stock
reads lower than the full purchase would suggest.

### The FG row's Status pill and RM-block indicator

`rm_shortfall_exists` (from the RM Pipeline calc above) is what should gate
the FG row's own "RM Needed" pill / "⚠ RM Not in Stock" note — **not**
whether something happens to be "Incoming"
(`total_incoming_qty`/`total_incoming_po_count`/`total_incoming_ewo_count`).
Incoming can come from something entirely unrelated to the raw material
shortfall (an Embroidery Work Order, a different batch already in transit),
so a real RM shortfall must keep showing even while something else is en
route — and conversely, once RM is genuinely ready, the "Subcontract PO"
action must be offered even if something unrelated is still "Incoming".

`so_rm_physically_in_stock` (client-side) is a **different, stricter**
check used only to gate raising a brand-new Subcontract PO
(`so_buy_btn`/`make_subcontract_purchase_order`) — physical stock only, no
credit for a pending MR/PO or Outstanding-at-Jobber. This is a deliberate
business rule (mirrored server-side by
`check_bom_raw_materials_in_stock`): a Subcontract PO cannot be raised until
the raw material is actually on the shelf, not just "on the way".

### Next Action: when a row genuinely offers more than one action

`so_build_action_html` (near `so_cmd_btn`) is what every FG row's Next Action
cell is assembled through. Most cells only ever have one real action, and
render exactly as before. But some states legitimately offer two independent
next steps for the same shortfall — e.g. "Purchase Order" (buy the shortfall
directly) alongside "Material Request" (raise a request first, order later)
for a plain trade item with no incoming stock and no open MR yet. Stacking
two `.so-btn` elements with no distinction between them read as one primary
button plus an unlabelled, easy-to-miss afterthought, with nothing showing
that the second one is an equally real, independently clickable option.

When 2+ actual `<button class="so-btn">` entries land in the same cell,
`so_build_action_html` inserts a small "or" divider between adjacent buttons
and tags whichever one carries `so-btn--primary` with a "Recommended" label.
A cell with only one action (the common case) is untouched — the labels only
ever appear when there is a genuine alternative to distinguish it from.

"or"/"Recommended" only ever apply **within one contiguous run** of buttons
— a `so_shortfall(...)` span, a plain `''` entry, or any other non-button
part in between ends the run. This matters because not every 2-button cell
is a real either/or choice: a line can have a submitted Pick List that
covers only PART of what's required (e.g. 100 of 500 picked-and-submitted,
400 still short) — in that case the FG row shows **both** "Create DN / SI
(100)" (ship what's already reserved, right now) *and* the shortfall's own
"Purchase Order"/"Material Request" (source the other 400), and both need
doing, so they must never read as alternatives. This exact case used to be
dropped from the Next Action cell entirely: `picked_submitted_undeliv` not
covering the *whole* remaining required qty fell through past the "fully
picked → Ready for DN / SI" branch straight into the shortfall/procurement
branch, with nothing there aware that part of the line was already sitting
reserved and shippable. Both of the shortfall-side branches (still-picking
and out-of-stock) now check `picked_submitted_undeliv > 0` themselves at
the end and prepend the ship-now button (plus a `''` break, so the two
groups' buttons are never treated as adjacent).

Every DN/SI action button in this cell carries the qty it actually acts on
(`Create Delivery Note (400)`, `Create Sales Invoice (100)`) via
`so_dn_si_action_label(route_lock, qty)` — including the "fully picked,
ready to complete the line" branch, which used to omit it. Long labels with
a qty suffix wrap at word boundaries only (`.so-action .so-btn`, base rule
not just the narrow-viewport one) rather than overflowing the column —
the Next Action column itself was also widened (`min-width:200px`) to fit
these more often without wrapping at all.

### "To complete this order" — a whole-SO checklist

Each FG row's own Status/Next Action cell only ever tells you about THAT
line. `generate_stock_overview_table` also accumulates three order-wide
totals while it builds the rows — `needs_invoice_qty` (delivered-but-
unbilled, same formula as the per-row billing zone above), `ready_to_ship_qty`
(picked-and-submitted-but-undelivered), `shortfall_qty` (still needs
sourcing) — and renders them as a short chip checklist
(`#so-next-actions-banner`, above the route-lock notice) the moment the
table loads: "To complete this order: Invoice 100 delivered · Ship 400
ready · Source 200 shortfall". Nothing here re-derives the per-row logic;
it only reads the same numbers each row already computes.

### The Incoming cell spells out a partial receipt directly

The Incoming cell's own PO breakdown ("1 PO · 300 pending") and the
separate "300 Received" footnote (received qty is already counted in
Available Stock, so it's deliberately never folded into the pending
headline — see the comment above `total_rcvd_qty`) used to read as two
disconnected facts — a reader had to do `300 + 300 = 600` themselves to
realize a single PO was half-received. Whenever any of the pending POs
already has some qty received, an explicit "Partially Received (300 of
600)" line now sits directly under the PO count, using the same
`ordered_qty`/`received_qty` fields the Incoming Documents modal shows.

### The shortfall action accounts for what's already on order

Every branch that shows a shortfall used to offer a fresh "Purchase Order"
button for the FULL shortfall regardless of whether a PO already existed
for it — a bare "Shortfall: 200" (or a buy button for that same 200)
implying nothing had been done, even with a PO already raised covering
some or all of it. For a plain, non-BOM item specifically, Incoming *is*
the same PO the shortfall would otherwise ask for (the "unrelated
EWO/different batch" reasoning that justifies ignoring Incoming only holds
for the RM-blocked case, which passes `0` instead of the real incoming qty
for exactly that reason).

`so_shortfall(qty, incoming_qty)` now takes the order's own incoming qty
as a second argument and renders the coverage note itself — "200 Already
on Order — Covers It" (green) or "200 Already on Order — 100 More Needed"
(orange) — directly under the shortfall figure, in every one of its three
call sites (still-picking-with-partial-stock, draft-pick-list-pending, and
no-stock-at-all). Wherever a buy button follows it, the button is capped
to `uncovered_by_incoming = max(0, shortfall − total_incoming_qty)` — the
remaining gap only, never the full shortfall again — and disappears
entirely once an existing PO already covers all of it.

### Purchase Order rows show Ordered/Received, not just Pending

The "Incoming Documents" modal's PO rows (both this SO's own incoming POs
and the "other SO's POs" section) used to show only `pending_qty` — no way
to tell "600 ordered, 0 received, 600 pending" (nothing has arrived) from
"600 ordered, 590 received, 10 pending" (basically done) without opening
the PO itself. `get_item_stock_details_bulk`'s PO queries now also select
`ordered_qty`/`received_qty` alongside `pending_qty`, rendered as a
"{received} of {ordered} received" sub-line under the Pending figure.

### A script-added PO row's rate silently landed at 0 on any uom mismatch

`purchase_order.get_item_details_for_po` — the helper every script-added PO
row goes through (`build_rm_purchase_rows`, `build_subcontract_item_row`,
"Add Subcontract Item"), since a row added via `add_child`/`set_value`
never fires ERPNext's own `item_code` trigger — looks up the Buying Price
List's own `Item Price` via `get_item_price`, which only matches a row
whose OWN `uom` is blank or exactly equal to the `uom` being asked for. An
Item Price recorded against `stock_uom` (the ordinary case — nothing
forces a second variant per purchase UOM) silently returned nothing, and
therefore rate 0, for any row whose requested `uom` differed even slightly
from what happened to be recorded — reproduced live: `uom="Nos"` (matching
the Item Price) returned rate 500; `uom="Pcs"` (same item, same price list,
different uom) returned rate 0. Fixed by retrying the lookup against
`stock_uom` when the first attempt finds nothing, exactly mirroring core's
own `get_price_list_rate_for` fallback in `get_item_details.py`.

### The "Purchase Order"/"Material Request" buttons must override the mapped qty

`so_shortfall(qty)` shows this app's own coverage-aware shortfall (net of
delivered/picked/stock/RM-outstanding-at-jobber — see above), but clicking
"Purchase Order" or "Material Request" right next to it used to map the
**full original Sales Order line qty**, not that shortfall — e.g. a 500-qty
line already covered by a 100-unit Delivery Note, with a real shortfall of
400, opened a "Review Purchase Order" dialog pre-filled with 500.

The cause: `erpnext.selling.doctype.sales_order.sales_order.make_purchase_order`
/`make_material_request` (ERPNext core) track "how much of this line has
ever been put on a PO/MR" — a completely different axis from this app's own
shortfall, which also nets out stock, Pick Lists and Delivery Notes the
core mapper has no visibility into. A line nothing has been ordered for yet
always maps at its full original qty from the mapper's point of view, even
when most of it already shipped straight from stock.

Fixed by overriding the mapped row's `qty` (and `stock_qty`/`amount`) back
down to this app's own figure immediately after mapping, before the preview
dialog ever renders:
- `so_make_purchase_order(so_name, item_code, qty)` — now takes the
  shortfall `so_buy_btn` was already computing (previously silently
  dropped) and applies it directly, only when exactly one mapped row
  matches `item_code` (a split across warehouses/rates is ERPNext's own
  call, not something to guess at).
- `so_make_material_request(so_name)` maps the **whole** Sales Order (every
  pending line, not just one item), so there's no single `qty` to pass in —
  instead it re-derives each mapped row's own shortfall from
  `get_cached_stock_row` (the same per-item stock payload the widget itself
  renders from, via `cur_frm.custom_stock_data`) using the identical formula
  `required − delivered − picked (submitted, undelivered) − picked (draft)`.
- Both go through `so_open_mapped_doc`'s new `opts.after_map(doc)` hook,
  run right after `frappe.model.sync` and before the preview table is built
  — so the preview a user reviews (and the Form it opens into) is already
  correct, not something they'd have to notice and manually fix.

### A line can need billing AND shipping AND sourcing, all at once

A Sales Order line delivered in more than one batch is billed in more than
one batch too. The original "fully delivered → offer Create Sales Invoice"
branch only ever owned billing once the WHOLE line had shipped
(`delivered >= required`) — every other branch (still has a shortfall,
fully picked and ready, still planning) decides what to do with the
*remaining* qty only, with zero awareness of whether whatever's *already*
gone out the door has been invoiced. A line 100-of-500 delivered (say, via
an earlier Delivery Note) showed nothing at all about that 100 needing an
invoice — it just silently waited for the other 400 to ship first, the same
"only checks for FULL completion of a state, drops the partial slice
already there" mistake as the ready-to-ship case above.

Fixed the same way: computed independently of whichever branch fired for
the remaining qty, and skipped only when the line is fully delivered (that
case owns itself, with its own more precise DN-linked check already).
`unbilled_delivered_qty = delivered − (billed_amt / rate)` — the delivered
qty's worth of money not yet actually invoiced. When positive, a
`Create Sales Invoice ({qty})` button (scoped to the actual linked DN via
`so_make_sales_invoice_from_dn` when one exists, submitted) is prepended
the same way the ready-to-ship button is — independent action, own `''`
break, never read as an alternative to shipping-the-rest or
sourcing-the-shortfall.

So a genuinely three-way-split line (say: 100 delivered and unbilled, 300
picked and ready to ship, 100 still a real shortfall) now shows all three
as distinct, clearly-quantified actions in the same Next Action cell,
instead of only ever surfacing whichever ONE the branching logic happened
to land on.

## The three raw-material "fetch" surfaces

All three answer some version of "does this Sales Order still need raw
material sourced", but for different purposes, and — because of the same
class of bug — all three had to independently learn the same lesson: **a
Purchase Order having been raised for a finished good is not proof nothing
more is needed; live stock is the only thing that actually is.**

| Surface | Function | Purpose |
|---|---|---|
| "Fetch Raw Materials from SO" | `get_pending_so_with_raw_materials_summary` (`purchase_order.py`) | Build a **plain** (non-subcontracted) PO to buy raw material directly |
| "Fetch Pending Sales Orders" / Subcontract Requirement Analysis | `get_pending_so_with_material_stock(is_subcontracted=1)` (`purchase_order.py`) | Build a **new subcontracted** PO for whatever finished-good qty still needs producing |
| Procurement Fulfillment Planner | `fetch_multi_order_requirements` (`custom_script.py`) | Consolidated Material Request across every pending order sharing a raw material |

Each computes its own "how much of this FG line is already resolved"
signal. The correct version of that signal is **whichever is bigger of:
physical FG stock, or this line's own already-picked total** — both of
which already reflect whatever a subcontract PO *actually* produced,
however that production happened. It is **not** "sum of `fg_item_qty` on
existing subcontracted PO rows for this SO" — that number stays the same
forever once a PO is fully subcontracted, even after some of the resulting
stock gets diverted elsewhere (sent for further processing, picked for a
different order, etc.), and silently zeroes out a genuine later shortfall.

For the subcontracted "Fetch Pending Sales Orders" surface specifically,
a linked PO's own remaining **capacity** to still absorb a new shortfall is
`poi.qty − poi.subcontracted_quantity` (ERPNext's own running tracker for
how much of a PO row has already been turned into an SCO) — a PO fully
converted into an SCO has zero capacity left to credit, whether or not that
SCO's own production later gets diverted. A **fresh** PO not yet converted
into an SCO (`subcontracted_quantity == 0`) still has its full qty as open
capacity — and correctly makes an SO drop off this list once such a PO
exists for it, since there's nothing further to fetch until that PO's own
"Create SC" step happens.

### "Add Subcontract Item" (manual entry)

A small dialog (`show_add_subcontract_item_dialog` in `purchase_order.js`,
server-built by `build_subcontract_item_row`) for manually adding one
subcontracted row: Service Item → Finished Good → BOM → Qty, each a real
searchable Link field.

Core ERPNext's own `fg_item` trigger (`erpnext/buying/.../purchase_order.js`)
only auto-fills anything when a **Subcontracting BOM** record exists for
that finished good — and even then it silently picks one Subcontracting BOM
record for a finished good without ever asking, confirmed live: submitting
a second BOM version for an item that already had one auto-registers a
second Subcontracting BOM row, and core's lookup just returns the first one
it finds. So this app always checks the Finished Good's own Item BOMs
directly and asks when there's more than one, rather than trusting core to
have resolved that unambiguously. `fg_item_qty` and `qty` are kept 1:1 (this
company's own convention, confirmed against every real row on file —
Stitching Charges, Order Charges — never a non-1 conversion factor).

The Finished Good field is filtered the same way core's own grid-level
`fg_item` query is: `is_stock_item=1, is_sub_contracted_item=1,
default_bom != ""` — an item with no BOM at all just leads to an unusable
BOM field one step later.

### "Create SC" — Raw Material Stock Check & Planning

`show_stock_check_dialog` in `purchase_order.js`, submitting via
`create_subcontracting_docs` in `purchase_order.py`.

Two independent ceilings on how much RM can actually be sent to the
jobber, and the dialog's "Max You Can Send" column is whichever is
**lower**:

1. **Physical stock** (`Available Qty`).
2. **Stock Settings' Over Transfer Allowance** — `Required Qty × (1 +
   allowance% / 100)`. This is a real ERPNext-enforced ceiling on the
   Material Transfer submission itself, independent of physical stock —
   sending more than this % over the SCO's required qty gets rejected at
   submit time regardless of how much stock is on hand. The field is
   `Stock Settings.mr_qty_allowance` (labelled "Over Transfer Allowance" in
   the UI — the fieldname itself is a historical mismatch). Read via the
   whitelisted `get_over_transfer_allowance()` wrapper, **not** a direct
   client-side `frappe.db.get_single_value('Stock Settings', ...)` call —
   that enforces read permission on the Stock Settings doctype itself,
   which a Purchase/Manufacturing Manager (the actual users of this dialog)
   does not have.

`create_subcontracting_docs` also clamps the real Stock Entry transfer qty
to whatever's *actually* in Bin at submit time (not the 2dp-rounded display
figure) — MariaDB float noise on `Bin.actual_qty` (e.g. `13.999999999994`)
otherwise makes ERPNext's own stock-sufficiency check reject a request for
exactly the displayed "14".

## Rounding conventions

- **Purchase/production suggestions round UP** (`qty_round_up` /
  `qty_round_indicator` in `purchase_order.js`) — you cannot buy or produce
  a fractional unit, so a computed shortfall of `6.001` should suggest `7`,
  with a visible "rounded up from 6.001" indicator, never a bare `6.001`.
- **Stock/coverage comparisons round to 2dp at the source**, not just at
  display time — `Bin.actual_qty` and similar accumulate float residue
  across many stock-ledger transactions (e.g. `83.999999999999994` for a
  physical 84), and comparing that raw figure against a clean required
  qty produces a phantom fractional shortage. Round once, where the number
  is first read, so every downstream comparison agrees with what's
  displayed.
