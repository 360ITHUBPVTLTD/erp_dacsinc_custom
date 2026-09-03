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

## Price Check on the Purchase Order

`custom_price_check_html` shows, per item on the order: the buying **price
list** rate, what **this supplier** last paid, and what **other suppliers**
last paid — so the rate being entered can be judged against the alternatives
instead of taken on trust.

- **A Best Price column, not a verdict.** An earlier version judged each row
  in words ("Best available" / "cheaper elsewhere") and was removed as
  unclear. What replaced it is the number itself: the cheapest rate anyone has
  actually charged — this supplier included — with who charged it. On a tie
  this supplier wins, since there is nothing to gain by suggesting a switch at
  the same rate.
- **Suppliers are sorted cheapest first**, then truncated for display. The
  sort decides which survive the cut, so sorting by rate keeps the ones worth
  seeing rather than whichever was billed most recently; the remainder is
  summarised as "+N more supplier(s), all dearer". Each gets its own aligned
  line — laid out inline, several ran together on one wrapped line and nothing
  could be compared at a glance.
- **Reads the items ON THE FORM.** Passing the saved `purchase_order` made the
  server fetch its items from the database, so a row added since the last save
  was invisible and the table only caught up after saving. The client always
  sends the current item list.
- **Submitted Purchase Orders only.** A draft is somebody's proposal, not
  evidence of a price ever agreed; quoting one back as history would make a
  typo look like a precedent.
- **One row per supplier** — their most recent rate. A supplier-specific Item
  Price beats the generic one for the same list, matching what ERPNext itself
  applies.

**Only on a non-subcontracted PO.** A subcontracted PO's rows are the
service/raw lines of a job-work arrangement, priced by that arrangement rather
than by a market comparison, so a "who is cheaper" table there compares the
wrong thing.

**Role-gated, and default-DENY.** `can_see_po_price_check` reads
`Admin Settings > Price Check — Allowed Roles`. Unlike the Order Flow tabs,
where an empty role list means *everyone*, an empty list here means **nobody**:
what a supplier charges, and what rivals charge for the same item, is a
deliberate disclosure and must be switched on for named roles. Administrator
and `ADMIN_ROLES` always see it, so the feature cannot become
unadministrable. The gate is enforced in the endpoint, not just the form — it
returns `allowed: false` with no rows, so the data cannot be reached by
calling it directly.

Note when testing this: saving **Admin Settings commits** (its `on_update`
regenerates a derived Custom Role), so a `frappe.db.rollback()` will NOT undo
a role change made in a test.

## Neither a PO nor an MR may exceed the Sales Order line's own need

The cap applies to **both** documents, or it isn't a cap: blocking it only on
the Purchase Order side left it walkable by requesting the excess on a
Material Request and converting that to a PO, arriving with the over-order
already baked in. `guard_po_item_not_over_so_need` and
`guard_mr_item_not_over_so_need` enforce it on save; both are scoped strictly
to rows carrying a `sales_order_item` link.

`get_so_item_commitment` is the shared measure of what a line already has
against it:

    committed = every PO raised against the line
              + every MR against it not yet turned into a PO (qty - ordered_qty)

Counting an MR's full qty *and* the PO it became would count one requirement
twice. `ordered_qty` is what ERPNext moves as an MR is converted — **but only
when the PO is SUBMITTED**. A draft PO raised from an MR therefore leaves the
MR reading fully open while its own qty already counts, and the line reads
double (verified: a 10-unit line showed `committed: 20`). Draft PO rows are
netted off against the MR row they came from
(`Purchase Order Item.material_request_item`) to close that window; submitted
POs need no such treatment because `ordered_qty` has moved by then.

**Name the documents holding the qty.** A total alone reads as unexplained
when it blocks something — "ordering 8 takes the total to 18" looks wrong to
someone ordering 8 against a line of 10, until they learn a **draft** Purchase
Order for the full 10 already exists. `get_so_item_commitment` therefore
returns a `docs` list, and both the guards and the on-form note print it:

> **Item 1 without BOM** on Sales Order **SAL-ORD-2026-00121** needs 10, and
> 10 is already on:
> **PUR-ORD-2026-00110** (Draft, 10)

That points straight at what to do — usually "work on that draft instead of
starting another" — which no amount of restating the arithmetic would have
conveyed. Drafts are deliberately counted (two drafts would over-order the
moment both were submitted) and are labelled as drafts precisely because the
remedy for one differs: edit or delete it, rather than add a row.

Where nothing is left, the message says "remove this row — the line has
nothing left for a linked row" instead of "reduce this row to 0 or less",
which is not an instruction anyone can follow.

**The remedy is part of the message, spelled out as an action.** A row with no
Sales Order reference is completely unrestricted — nothing counts it as
serving the order, since all the coverage math keys off the link and never a
bare item_code match. All four surfaces (both server guards, the typing
warning and the on-form note) therefore say the same concrete thing:

> add the **same item again in a new row** and leave that row's Sales Order
> field blank — a row not tied to the order is unrestricted.

Earlier wording ("add it as a separate item row with no Sales Order
reference") described the outcome rather than the steps, and left the reader
to work out that the item may simply be repeated. Keep these four in step:
a remedy stated differently in different places reads as different rules.

`so_qty_cap.js` (shared by both forms via `doctype_js`) puts the limit on the
form and nothing more. It deliberately does **not** validate as the qty is
typed: an earlier version popped a dialog on every qty change, which fired
during ordinary editing — a qty passes through over-limit values on its way to
a valid one, and reducing an existing over-limit row triggers it too, so the
warning appeared when nothing was wrong yet. Showing the ceiling up front and
letting the save be the moment of truth is quieter and just as safe, because
the server guards refuse the save either way.

The note is refreshed on `refresh`, on **`validate`** (i.e. every save
attempt), and — debounced — as rows are added, removed or re-quantified. The
`validate` refresh is what makes the note dependable at the moment it matters:
when the server guard refuses a save, the figure sitting beside that error is
the current remaining allowance, not whatever it read when the form was
opened. A debounced *note* is fine to run while someone works; the removed
dialog was not.

The note is **one line**, carrying every figure that matters:

> Item 1 without BOM — order 10 · already 10 · this one 9 · **left 0**

That is: what the order asked for, what is already raised against it
elsewhere, what this document adds, and what remains. A bare "Item: 0" was
shorter but said nothing about how it reached 0. At most two items are named,
the rest counted; which documents hold the "already" figure is on the hover,
and the save-time error states it in full regardless.

**The note must count exactly what that form's own guard counts.** On a
Purchase Order that is other **Purchase Orders only** — because a PO raised
from a Material Request *converts* that request rather than adding to it.
Counting the open MR as well double-counted the qty being converted: an MR of
10 with 9 on this PO read "already 1 · this one 9 · **left 0**" when 1 can
plainly still be added, taking the PO to 10 and the MR to nil. On a Material
Request the guard counts POs plus other unordered MRs, and the note follows,
because a second request genuinely IS extra demand. Verified against the
draft PO drawn from a 10-unit MR: 9 on the form leaves **1**, 10 leaves 0.

`get_so_item_commitments` returns the line's allowance **excluding the
document being edited** — so it is not yet the answer. Whatever this form
already puts against the same line must come off it, or a form already holding
the full allowance still advertises it as available. Summing every row that
shares the line is also what makes the multi-row case right: two rows of 3 and
2 against a 5 allowance leave **0**, not 5 each (verified). On a subcontracted
Purchase Order the row figure is `fg_item_qty`, matching the server guard.

The note always names **where the allowance went**, because "0 allowed" on its
own reads as if the order wanted nothing — which is never the reason it is 0:

> **Item 1 without BOM**: **nothing left** *(order needs 10 · 10 already on
> other documents · 11 on this form)*

Both causes are stated, so the figure can be reconciled rather than
disbelieved.

Two mechanics to keep in mind when touching this:

- **`frm.set_intro` APPENDS.** Frappe's `layout.show_message()` appends a
  block on every call and only clears when passed an empty value, so the note
  must be cleared before it is set or each refresh/validate/row-change leaves
  another stacked copy on the form (it did — three at once).
- **Every exit path clears.** No linked rows, no commitment data, or a
  submitted document must all reset the note, or a banner from an earlier
  state persists after it stops being true.

Two earlier attempts explained the rule instead ("rows linked to a Sales Order
line are capped at what that line still needs…") and left the reader to work
out what it meant for them — the number they can actually enter is the thing
worth saying. `get_so_item_commitments` fetches every linked line's remaining
allowance in one call, excluding the document being edited, so the figure is
"what you may put on THIS document". A line with nothing left says "nothing
left" rather than "max 0", and the banner turns orange. The reasoning stays on
the hover, and the full arithmetic appears in the error itself when a cap is
actually hit. It deliberately does **not** auto-correct the typed number —
silently rewriting an entry hides the problem and loses the figure the user
meant to record elsewhere. The server guards remain the enforcement.

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

## Cancelling or deleting a Sales Order cleans up its Pick Lists

Cancelling a Sales Order does nothing to Pick Lists pointing at it, ERPNext
or otherwise. Left alone, a still-draft Pick List against a cancelled order
keeps showing in the widget's **Picked (Others)** column as a live stock
conflict — "this qty is held for Customer X, Sales Order Y" — for an order
that is cancelled and will never ship.

`sales_order_on_cancel` → `_cleanup_pick_lists_for_cancelled_so`, and
`sales_order_on_trash` → `_cancel_pick_lists_before_so_delete` (both in
`custom_script.py`) apply the same rule, by Pick List docstatus:

- **Draft** — deleted outright. It never picked or reserved anything real,
  so there's nothing to un-submit and nothing worth keeping as a record.
- **Submitted** — cancelled, not deleted: it did reserve stock, so it stays
  as an audit record while releasing what it held. (On the *delete* path
  this is also a hard requirement — ERPNext's own `Pick List.on_cancel()`
  reloads the Sales Order, so a Pick List left live against a deleted order
  can never be cancelled again.)

A Pick List can legitimately span **several** Sales Orders, so "this order
is cancelled" is never on its own a reason to destroy the whole document —
that would take the other, still-live orders' picking with it. Only a Pick
List belonging entirely to the cancelled order is deleted or cancelled
outright; a mixed one has just this order's rows dropped (draft), or is
left intact and logged (submitted, where rows can't be edited).

Independently of any cleanup, the widget's own conflict query filters out
`Cancelled` orders (and `docstatus = 2`) per row, so a cancelled order can
never be reported as a live conflict even from older data the cleanup
never ran against.

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

A shortfall is never just a number to report — it always has a specific next
step, and which one depends on what already exists: raw material missing (go
to the RM pipeline), a PO already on the way (track it, and only offer to buy
what that PO does *not* cover), an MR already raised (order against it rather
than raising a second request for the same shortfall), or nothing yet (buy it
/ request it). That decision lives in one place, `so_shortfall_actions`, and
every branch that reports a shortfall calls it.

It was extracted because the branches had diverged: the **draft Pick List**
branch pushed only the bare "Shortfall: N" note and no action at all, so a
line waiting on a Pick List submission that was *also* genuinely short
offered "Submit Pick List" as its only actionable button — the shortfall was
stated and then abandoned, with no way to raise the MR/PO for the balance.
Submitting the Pick List and sourcing the balance are independent jobs (the
line is short whether or not that draft gets submitted), so both now appear,
separated by a `''` break so they never read as an either/or. The helper's
`allow_primary` is false there, since "Submit Pick List" is already that
cell's primary action and a cell must never show two.

Every DN/SI action button in this cell carries the qty it actually acts on
(`Create Delivery Note (400)`, `Create Sales Invoice (100)`) via
`so_dn_si_action_label(route_lock, qty)` — including the "fully picked,
ready to complete the line" branch, which used to omit it. Long labels with
a qty suffix wrap at word boundaries only (`.so-action .so-btn`, base rule
not just the narrow-viewport one) rather than overflowing the column —
the Next Action column itself was also widened (`min-width:200px`) to fit
these more often without wrapping at all.

### The standard "Create" buttons are removed where this app owns the flow

Both forms strip ERPNext's own Create-menu entries for the documents this
app raises through its own validated surfaces — the stock/coverage checks,
qty caps and route locks all live in those surfaces, and core's plain
"Create > X" bypasses every one of them.

- **Sales Order** (`sales_order.js` refresh): `Delivery Note` and
  `Sales Invoice`, alongside the entries already removed there. The widget's
  own DN/SI actions (which respect the route lock and carry the right qty)
  are the supported path. `Material Request` is deliberately still listed
  as commented-out, not removed — it hasn't been asked for.
- **Purchase Order** (`purchase_order.js` refresh): `Purchase Receipt`, but
  **only when `is_subcontracted`** — a subcontracted PO is received through
  a Subcontracting Receipt ("Receive Finished Goods"), and a plain goods
  receipt against its service/FG rows bypasses the whole SCO and Stock
  Entry chain. On a normal PO the button is legitimate and stays.

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

## The item-fetch dialogs MERGE — they must never replace

A non-subcontracted Purchase Order has three "fetch and add items" dialogs
(pending Sales Orders, raw materials, Material Request suggestions). Each one
used to call `frm.clear_table("items")` before adding, so using a second
dialog discarded everything the first had added — which is the whole reason
someone opens two of them.

They now upsert through `po_upsert_item`: a row from the same source is
updated in place, anything else is appended.

**Row identity is the item PLUS what it is for** — `po_item_key` is
`item_code · sales_order_item · material_request_item · fg_item · warehouse`.
Matching on `item_code` alone would be actively wrong here, because this app
deliberately supports the same item on two rows: one linked to a Sales Order
line and one not, which is exactly how qty beyond the order's own need is
ordered (see the over-order cap). Verified: two SO lines of the same item, and
a linked plus an unlinked row of it, all stay separate, while re-running a
dialog updates its own row instead of duplicating it.

Two things that follow from no longer clearing:

- **Links must be on the payload before the upsert**, not set on the row
  afterwards — the MR dialog sets `material_request_item` et al., and applying
  them after the match would compare against a linkless key and append a
  duplicate on every re-fetch.
- **Blank rows have to be dropped explicitly** (`po_drop_blank_items`). A new
  form carries an empty placeholder row that `clear_table()` used to remove;
  left behind it is a row with no item that blocks the save.

The qty is **replaced** on a matching row, not added to: each dialog offers an
absolute "this is what is still outstanding" figure, so re-running one should
restate that row rather than double it.

`custom_rm_source_breakdown` is scoped the same way — re-fetching one raw
material replaces that item's own trace lines and leaves every other item's
alone, where clearing the whole table discarded the trace for rows a different
dialog had added.

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

### A draft Purchase Order is coverage — on all three surfaces, and it says so

A draft PO is already a commitment as far as this app's own enforcement is
concerned: `get_so_item_commitment` (`custom_script.py`) counts
`po.docstatus IN (0, 1)` when it decides whether a Sales Order line is
over-committed, and `guard_po_item_not_over_so_need` blocks the save on that
basis. Every fetch surface that ignored drafts therefore disagreed with the
guard that runs seconds later: the dialog offered a qty a draft PO already
held, and saving the PO it built was then rejected as over the line's own
need — an error about a document the dialog never mentioned.

So all three surfaces net off draft POs (`po.docstatus IN (0, 1)`), and — the
other half of the rule — **every one of them names the draft PO rather than
just showing a smaller number**. A deduction the reader can't trace is worse
than no deduction: the qty vanishes with no way to tell whether it is a firm
order or a PO somebody left unsubmitted, which is precisely the one worth
opening before buying more.

| Surface | Draft share | Where it is shown |
|---|---|---|
| Fetch Pending Sales Orders | `linked_po_draft_qty`, `other_po_draft_qty`, summary `draft_po_qty`/`draft_po_ids` | "Already on Draft PO" overview column, an "↳ of which Draft PO" line under Final, and a Draft/Submitted tag on every listed PO |
| Fetch Raw Materials from SO | `ordered_linked_draft_qty`, `incoming_general_draft_qty`, `fg_in_production_draft` | "incl. N on draft PO" under Incoming, a Draft PO badge on the per-RM status, Draft/Submitted tags in Existing Ref |
| Get Items from MR | `draft_ordered_qty`, `previous_po_history[].is_draft` | "↳ draft" line in the Stock Summary card, the PO pill's own Draft/Submitted state |

Two details that are easy to get wrong:

- **Submitted coverage is consumed before draft coverage.** The total is the
  same either way, but the order decides what gets *reported* as still only a
  draft. Draft-first would understate it, making a line look firmly covered
  when the only thing holding the qty is a PO nobody has submitted.
- **Every listed PO carries a state tag, not just the drafts.** Tagging only
  drafts leaves an untagged PO ambiguous — "submitted" and "the dialog didn't
  say" look identical.

Where a surface is opened from a saved draft PO, that PO's own rows are part
of the already-ordered total like any other draft's. "Get Items from MR"
passes the current `purchase_order` through so those rows are flagged
`is_current` and labelled **"THIS PO"** — otherwise the document the user is
looking at appears as an anonymous third party holding the qty. (The two
Sales Order fetch dialogs only appear on `frm.is_new()`, so an unsaved PO's
rows are not in the database and cannot count against themselves.)

#### The original case: "Get Items from MR"

`load_mr_suggestions` / `render_smart_po_dialog` in `purchase_order.js`,
served by `get_mr_suggestions_for_po` in `purchase_order.py`.

`Material Request Item.ordered_qty` only moves when a Purchase Order is
**submitted** — the same submit-only-counter trap as `picked_qty` and
`subcontracted_quantity` elsewhere in this app. A **draft** PO already
covering a Material Request line therefore leaves `ordered_qty` untouched,
so the line still reads as fully pending, is offered for ordering all over
again, and submitting both POs then trips ERPNext's own over-limit check
in `status_updater.py` — *"This document is over limit by Qty N for item
X. Are you making another Purchase Order against the same Material Request
Item?"* — a raw core error naming a Material Request Item the user never
sees from this dialog and can't act on.

So the true already-ordered figure is summed from the **live Purchase Order
rows themselves** (`material_request_item` matching, `docstatus < 2`, so
draft *and* submitted), which **replaces** `ordered_qty` rather than adding
to it — adding would double-count every submitted PO. Each row then carries
`already_ordered_qty`, a corrected `pending_qty`, and `fully_ordered`.

A fully-covered row is still returned and still listed, but purely for
reference: its checkbox is disabled, "select all" skips it (`:not(:disabled)`),
its qty input is replaced by an "Already Ordered" tag, and it is excluded
from the submit path. The dialog header counts the two groups separately
("N still to purchase" / "N already ordered (reference only)"). An orderable
row's qty is additionally capped to its own outstanding quantity, both by
the input's `max` and by a re-check at submit time that reports anything it
had to reduce — the over-limit error is prevented rather than explained
after the fact.

### The Inventory Status Overview must agree with the rows under it

The header strip of "Fetch Pending Sales Orders" (`item_summary`) and the row
list below it are read as one table, so any figure that appears in both has to
be the same number, computed once. Two ways it stopped being:

- **A second, shorter formula.** The overview derived its own need as
  `req − picked(submitted) − linked PO`, while each row's Final also nets off
  draft picks and any open Material Request. The header announced 26 still to
  buy above rows that between them offered 14. The row's own answer is the
  correct one — it is what the checkbox actually orders — so the server now
  stores that figure on the row (`to_buy`) and the overview totals *that*,
  and the dialog sums the rendered, rounded-up row values for display. There
  is no longer a second expression that can drift.

- **Counting picks that no longer hold anything.** The overview summed every
  Pick List Item ever raised for the item (`docstatus != 2`), so a Completed,
  fully-delivered pick kept contributing forever: 658 units read as "picked"
  beside a live need of 50, for stock that had left the warehouse months ago
  and was already absent from In Stock. Only picks still *holding* stock count
  — `picked_qty − delivered_qty`, with a Completed Pick List treated as fully
  delivered — the same rule the per-row figures already used. This summary was
  the last place still summing history.

The columns are also labelled for a reader who has not seen the code. "Draft"
and "Sub" gave no clue they were Pick List quantities at all; they are now
"Reserved on Draft Picks" and "Held for Orders (picked, not delivered)". The
strip states its own scope, because it genuinely mixes two: stock and pick
figures are company-wide for the item, while "Already on Draft PO" and "Still
to Buy" cover only the Sales Orders listed below.

### An expanded RM row must survive a re-render

`generate_stock_overview_table` re-runs on far more than an explicit refresh:
every action button that creates a document calls it back, and so do
`item_code` / `qty` / `warehouse` changes. Each render hides every
`tr.so-rm-row`, so an expanded Raw Material row collapsed the moment you used
a button inside that row — which read as "clicking a button minimises the
table". The same effect produced the "toggle needs two clicks" report: a
render landing just after a click wiped the toggle, so the next click looked
like the first one that worked.

Which rows are open is therefore tracked on the form (`frm._so_open_rows`,
maintained by the toggle handler itself) and restored after each render.
Deliberately not scraped from the DOM at render time — that loses the set
whenever two renders overlap, which is exactly when it matters. The
click-exclusion guard (`a, button, input, select, textarea, [onclick]`) is a
separate concern and still needed: it stops a control's click *also* toggling
the row under it.

### The RM table uses table-layout:fixed — content must be able to wrap

With fixed layout, anything that cannot wrap is visually cut off rather than
widening its column. Two things were losing characters: the Status pill
("Shortage") in a 7%-wide column, and the monospace calc line under Needed,
which carried an inline `white-space:nowrap` ("100.00 × 2.00/uni").

So: column widths total exactly 100% with Status given room (11%), cells
allow `word-break`/`overflow-wrap`, and only the parts that genuinely must
stay on one line (a value with its uom, the `/unit` suffix, a pill) opt out
individually. Never put `nowrap` on a whole cell in this table.

### Two bulk Material Request actions, split by how the item is obtained

The widget header carries both, and which one applies depends on whether the
line is **made** or **bought**. The labels name what is being requested, since
"Request RM" and "Request Items" side by side did not say which was which:

- **Raw Material MR · N** — for lines that are made: requests the raw
  materials of every BOM line still short (`so_collect_pending_rm`).
- **Finished Item MR · N** — for lines that are bought: no BOM, so there is no
  raw-material tier and the thing to request IS the item itself
  (`so_collect_pending_fg`).

**A coloured button's hover must restate its background, not just its
colour.** `.so-btn:hover` supplies a LIGHT background at the same specificity
as any `.so-btn--*:hover`, so a modifier that sets only `color: #fff` inherits
that light background and its label goes white-on-white — invisible exactly
when the pointer is on it. That is what happened to "Finished Item MR", and a
`brightness()` filter did not rescue it because the background it dimmed was
already the light one. The same audit turned up `.so-btn--success` (used by
"Create DN") with no definition at all.

Note the whole `.so-*` stylesheet is a JS template literal — **no backticks in
its comments**, or the literal terminates and the file will not parse.

**Keep every header button's `title` to a few words.** A native tooltip is
positioned at the pointer and is not stylable or constrained to the page, so
near the right edge — which is exactly where this right-aligned button row
lives — a long one runs off and is unreadable. No CSS fixes that; brevity
does. The detail belongs in the dialog the button opens. (Explanatory
tooltips on data cells mid-table are a different case and stay as they are.)

The header itself (`.so-card__actions`) also wraps at **every** width, not
only under 768px: with a search box plus Refresh, Pick Lists, Create Pick List
and both MR buttons, the last button was cut off at the card edge on a normal
desktop. Its bulk-action holder is a single flex *item*, so it wraps
internally too.

"Made" means **this line has a BOM** — the same test `so_buy_btn` uses to
choose between a Purchase Order and a Subcontract PO:
`(is_sub_contracted_item || is_bom_item) && bom_no`. The Item master's own
`is_sub_contracted_item` flag is **not** sufficient alone: it can be set on an
item bought outright on this line (confirmed live — "Item 1 without BOM"
carries the flag with no `bom_no`), and treating that as made skipped exactly
the rows the action exists for.

The bought-item qty is what still needs a **new** request: what is left to
plan, less stock genuinely free for this order, less everything already asked
for. That last part is easy to get wrong, because `total_incoming_qty` counts
**submitted POs/EWOs only** — a qty sitting on an open Material Request or a
draft Purchase Order is not in it. Netting only that figure off left the
button offering to request a line whose entire qty was already on an MR.

`total_paper_coverage_qty` carries the missing part: open (unordered) MR
balance plus draft PO qty. The two **overlap and must not be added** — a draft
PO raised from an MR leaves that MR's `ordered_qty` at 0, since ERPNext only
moves it on submit, so the same qty shows up as both. The draft PO's qty is
netted off against the MR row it came from, the same rule
`get_so_item_commitment` applies for the over-order cap. Verified: a line with
an open MR of 10 and a draft PO of 10 for that MR reports coverage of **10,
not 20**, and the button correctly disappears.

These requests set **`sales_order_item`**, not just `sales_order`: the line
link is what makes the request count as coverage for that line and brings it
inside `guard_mr_item_not_over_so_need`'s cap (verified: requesting the exact
need is allowed, 5 over is refused). It is set only when the widget row maps
to exactly one Sales Order line — a row groups every line sharing an item and
BOM, and attributing a grouped row to one of several lines would be a guess.

### One Material Request for every raw material still short

The per-row Material Request button covers one raw material. `Request RM · N`
in the widget header covers the whole order: `so_collect_pending_rm` walks
every BOM line and sums `rm_shortfall_total` **per raw material**, so an item
needed by two different finished goods becomes ONE request line for the
combined qty — which is also what stops it being requested twice by hand and
then over-ordered.

It uses `rm_shortfall_total` specifically, the same figure the row's own
Shortfall column and per-item button use; those must never disagree about the
qty.

The review dialog shows the full derivation rather than a bare number, so the
qty can be checked before a real document is created:

- **Needed by** — each finished good consuming it, with the qty still to
  produce, the per-unit BOM factor, and the product: `100 to produce × 2.00/unit
  = 200.00 Meter`.
- **How the qty is worked out** — Needed, less In stock / Pending MR /
  Pending PO / At jobber, giving Still short. The same subtraction the RM
  Pipeline row itself performs.

Stock and pending MR/PO are **item-level** figures and are deliberately NOT
summed across finished goods: adding them once per finished good that
consumes the same raw material would report several times the coverage that
actually exists. Only the shortfall is summed.

**Partial requests.** The Request column is an editable qty per line,
defaulted to the full shortfall and capped at it — asking for more than is
short is refused by name and figure rather than silently clamped, since it
would over-procure. A line set to 0 is left out. Whatever is not requested
simply stays short and can be requested later.

That round-trip is safe because coverage counts **submitted** Material
Requests only: verified live, a 50-of-200 request leaves the shortfall at 200
while it is a draft, and once submitted `rm_pending_mr_total` becomes 50 and
the shortfall becomes 150 — so re-running never asks for the same qty twice,
and never double-counts a draft. The dialog says this explicitly, because
"the number did not move" is otherwise the obvious wrong conclusion when the
new request is still sitting in draft.

The layout matters here: four columns including a calculation breakdown do not
fit a default dialog (the Request column and its input were cut off), so this
one is `size: 'extra-large'` with fixed column widths, and the breakdown is a
compact flex list rather than a nested `<table>` fighting the outer widths.

### A Pick List's delivered qty is its OWN, never the Sales Order line's

`Sales Order Item.delivered_qty` is the LINE's cumulative total across every
Pick List. Crediting it to each Pick List in turn (then capping at that Pick
List's size) marked them all fully delivered as soon as the line's running
total reached their size — confirmed live: shipping ONE 10-unit Pick List
took the order to 100 of 110 delivered, and a sibling 10-unit Pick List that
had shipped nothing was flipped to Completed / 100% alongside it, removing
its 10 from every "still to ship" figure on the widget.

`_calculate_pick_list_delivery_status` therefore attributes per Pick List:

- **Delivery Note route** — `Delivery Note Item.pick_list_item` names the
  exact row, so this is summed over *submitted* Delivery Notes only. Deriving
  it from live documents (rather than incrementing a counter) is what makes
  cancel work: a cancelled Delivery Note simply stops counting.
- **Sales Invoice (Update Stock) route** — Sales Invoice Item has no
  pick-list field at all, so that delivery is unattributable. The Sales Order
  total is consulted only for delivery that no Delivery Note accounts for,
  and a Pick List may absorb as much of that remainder as its own size allows.

`_resync_pick_list_row_delivered` recomputes each ROW's `delivered_qty` the
same way, so submit and cancel share one code path and repeated runs cannot
drift. Rows no Delivery Note has ever referenced are left alone — 0 is
correct there, and zeroing them would be inventing a fact.

### A derived DN/SI row is a record, not a negotiation

A Delivery Note or Sales Invoice item row that came from another document is a
RECORD of what that document committed. Editing its qty or rate desyncs it
from the Sales Order line it bills against and the Pick List that physically
reserved the stock — which is exactly what breaks the picked / delivered /
billed reconciliation the Order Flow dashboard reads.

So **qty, rate, price_list_rate, amount, item_code and warehouse are locked**
on any row carrying a link:

- Delivery Note Item — `so_detail`, `against_sales_order`, `pick_list_item`,
  `against_pick_list`, `dn_detail`.
- Sales Invoice Item — `so_detail`, `sales_order`, `dn_detail`,
  `delivery_note`. (It has no pick-list field at all; a stock-updating invoice
  gets its qty from the Pick List selection step that builds it.)

The quantity decision belongs **upstream**: at the Pick List, or in the
"select Pick List(s)" step. Previously qty was only locked when
`pick_list_item` was set, which left a Delivery Note mapped straight off a
Sales Order fully editable — the one route that bypasses the Pick List was
also the one route with no protection. Verified: tampering with qty and rate
on an SO-linked row with no Pick List link is now reverted on save.

Two things that must stay true:

- **The server is the guarantee, not the grey-out.** A client read-only is
  bypassable via the API or with scripts disabled, so
  `guard_dn_items_locked_to_pick_list` / `guard_si_items_locked_to_pick_list`
  revert these fields to their pre-save values, and `_DN_LINK_FIELDS` /
  `_SI_LINK_FIELDS` must be kept in step with the JS lists.
- **One condition, one field list, per file.** The four client surfaces
  (inline cell edit, row refresh, the form-level pass, the expanded-row
  render) all apply the same rule; when they were written out separately,
  `amount` ended up locked in some and editable in others.
- **The primary client mechanism is `read_only_depends_on`**, set once in
  `setup` as `eval: doc.<link> || …`. Frappe's own `GridRow` evaluates it per
  row (`DEPENDENCY_PROPERTIES` in `grid_row.js` maps it to `read_only`), so it
  does not depend on our handlers firing at the right moment — a row cannot
  come back editable because a refresh happened in an unanticipated order. The
  imperative `toggle_enable` passes and the `edit_cell` block remain as belt
  and braces.

These files are loaded via `doctype_js`, which carries no cache-busting
version, so a **hard refresh** is required after changing them — an apparently
"still editable" grid is usually a stale cached script, not a failed lock.
The server guard is the real test, and it holds regardless.

Only rows that existed on a PRIOR save are protected — a freshly mapped row
being saved for the first time IS the value being established.

### A Delivery Note ships ONE Pick List — pick one that still owes qty

`create_delivery_note` maps from a single Pick List, so the Pick List handed
to it must still have undelivered qty (`picked_qty - delivered_qty > 0`).
Selecting merely the first *submitted* one handed the mapper a fully
delivered Pick List as soon as an earlier batch had shipped: every row mapped
at qty 0 and ERPNext threw "Quantity for Item ... cannot be zero". Confirmed
live — an order with Pick Lists of 90 (fully delivered), 10 and 10 offered
"Create Delivery Note (20)" and failed outright, because the button's qty is
summed across ALL pick lists while the document is built from one.

Those two numbers are genuinely different whenever more than one Pick List
holds stock, so the source is chosen explicitly rather than guessed.

### One shared "select your source documents" step

`so_pick_source_docs` backs every create-from-source action on the widget, so
choosing Pick Lists for a Delivery Note and choosing Delivery Notes for a
Sales Invoice look and behave identically instead of each action inventing
its own. It lists the candidate documents with their own date, status and
(where it applies) pending qty, each linked, and hands back the selection.

Everywhere it appears it is **multi-select with everything ticked**: the
common case (ship/invoice all of it) is one click, and leaving something for
later is an explicit untick rather than a separate flow. A **Select all /
Clear** pair and a live "N of M selected · X pending" readout sit above the
list, because with several candidates each carrying a qty, the sum of the
ticked ones is the number that actually matters.

It renders as the same bordered, blue-headed `.doc-preview-table` every other
dialog here uses, with **native checkboxes**. A custom-styled card/checkbox
version was built and reverted: it displayed as unchecked while the counter
correctly read "5 of 5 selected", and a control whose appearance can disagree
with its own state is worse than the plain one.

Each row shows what the decision actually needs: the document id (linked),
its date and status, and its **item lines — item, qty, and for a Delivery
Note which Pick List each line came from**. No amount: choosing which
documents to build from is decided on contents, not money (the total stays on
the mapped-doc preview, where it summarises the document under review). A
"Pending" column appears only where the documents carry one (Pick Lists),
rather than an empty column under a header.

Reading those item lines requires `frappe.client.get_list` with `parent`,
**not** `frappe.db.get_list`: the latter routes to
`frappe.desk.reportview.get_list`, whose `DatabaseQuery.execute()` takes no
`parent` argument and raises `TypeError` on one — and `parent` is exactly
what a child-table read needs to resolve permissions against the parent
doctype.

- **Delivery Note ← Pick List(s)** — only Pick Lists with undelivered qty are
  offered, each showing its own pending figure. This goes through
  `create_dn_or_si_from_pick_lists`, NOT ERPNext's `create_delivery_note`:
  the latter maps a single Pick List, so it cannot produce the combined
  document (verified: two Pick Lists in, one Delivery Note of 20 out).
- **Sales Invoice ← Delivery Note(s)** — one invoice can legitimately cover
  several Delivery Notes. The row-level action works on Delivery Note *item*
  rows, so it offers the parent Delivery Notes and maps the selection back to
  their rows. Only Delivery Notes with qty **still to invoice** are offered,
  each showing that remaining figure.

  A fully-invoiced Delivery Note must never be included: ERPNext's own
  `make_sales_invoice` throws "All these items have already been
  Invoiced/Returned" as soon as the document it is mapping yields no items, so
  one billed document fails the WHOLE call and takes every genuinely unbilled
  one selected alongside it down with it (confirmed live, and it happened
  whichever order they were passed in). `_billable_delivery_notes` is the
  single filter both dashboard billing paths use — the primary `need_to_bill`
  stage and the secondary billing action — so they cannot drift apart.

  Partial billing is handled by qty, not all-or-nothing: `billed_amt` is an
  AMOUNT, so `get_item_stock_details_bulk` converts it back to a qty against
  the row's own `amount` to get `unbilled_qty`. When every Delivery Note is
  fully invoiced the action says so plainly instead of letting the mapper
  throw.

Anything left unticked is **deferred, not done**, and is always reported as
still outstanding — named, so it can be acted on: the bulk modal shows the
left-out Pick Lists in a warning block before the document is created, and
the row-level route raises an alert naming them after the redirect. Silently
dropping them was the failure mode this replaced.

The per-doctype date/total resolution (`so_fill_source_meta`) is shared with
the mapped-doc preview — a Pick List has no `grand_total` and no
`posting_date`, and asking for either fails the whole query.

### An open Material Request is coverage — the PO fetch must net it off

`get_pending_so_with_material_stock` (the PO form's "Procurement Requirement
Analysis") deducts picks and this order's own linked Purchase Orders from
what it offers to buy. It must also deduct qty already sitting on a
**submitted, not-yet-ordered Material Request** (`qty - ordered_qty`).

Without that it offered the full remainder for direct purchase even when an
MR for it was already open — confirmed live: an order 20 short, with 10 on a
PO and 10 open on a Material Request, still offered 10 to buy. Taking it
would have ordered that same 10 a second time and left the MR's 10 stranded
open forever. The correct move for MR-covered qty is **Get Items from MR**,
not another direct PO.

`mr_open_qty` / `mr_open_details` carry it through, the client subtracts it
in the same `to_buy` expression (server and client must agree, or a row's
checkbox and its Final disagree), and the row shows an "On MR" line naming
the requests so the number can be traced. Only submitted MRs count — a draft
one commits nothing. A row fully covered this way drops out of the dialog
entirely, like any other row with nothing left to do.

### These fetch dialogs list work to do, not a coverage report

Both planners — the MR form's "Get Item From SO"
(`fetch_multi_order_requirements`) and the PO form's analysis above — list
only lines that still need action. A line whose need is already met by
stock, picks, an open MR or a PO is dropped, not shown with a Net Need of 0.

That is deliberate: a zero row is noise in a queue whose whole purpose is
"what do I raise now". Where the outstanding qty actually went is answered by
the Sales Order's own Item Stock & Action Plan, which exists to show
coverage. The Current Analysis column still breaks down every row it does
show (Total Ordered, Delivered, Picked, In Stock, Pending MR, Pending PO,
= Still Needed), so a surviving row's number is always traceable.

### Job-work panels: one shared item-wise Sent/Received rendering

The Panel and Full Piece job-work dashboards all answer the same question —
how much of each item went to the jobber and how much has actually come back
— and each used to phrase it differently: one showed only the sent qty,
another only a balance, another only the received qty once complete. The
same situation read three different ways depending on which panel you opened,
and none of them showed sent *and* received together.

`ewo_items_progress_html` (`purchase_order.py`) is the single rendering they
all use now: per item, **Sent N · Received M · state**, where state is
Complete (nothing outstanding), `Bal K` (partially back) or Awaiting
(nothing back yet), colour-matched. It reads Embroidery Work Order Item's
own `ordered_qty` / `received_qty`.

### The PO's linked-documents table (render_linked_docs_html)

The tabbed table under a Purchase Order (Embroidery / Orders (SCO) / Stock
Entries / Receipts / Purchase Receipt / Invoices) is `table-layout: fixed`,
which makes three things load-bearing:

- **Never `overflow: hidden` + `text-overflow: ellipsis` on its `td`.** Under
  fixed layout that CLIPS the cell instead of wrapping it — Stage text like
  "Returned to Jobber (Closed)" and the Items list were cut off rather than
  wrapped, which is what "not showing fully" meant. Cells wrap
  (`overflow-wrap: break-word`) and the widths below give them room.
- **Fix every column EXCEPT Items**, and let Items absorb the remainder. Only
  ID and Items had widths before, so a five-column tab left the other three
  fighting over what was left; fixing Items as well left 13–38% unallocated
  depending on the tab, and an unlisted column (Due Date) fell back to `auto`.
- **`min-width` on the table**, with `overflow-x` on `.sc-content`, so a
  narrow viewport scrolls rather than crushing five columns.

The per-item qty ("Ord:20, Rec:20") sits beside the item name. It was
`justify-content: space-between`, which flung it to the far edge of a wide
Items cell and left a gap that read as broken layout.

### The mapped-document preview names its source documents

`so_show_mapped_doc_preview` (`sales_order.js`) previews any mapped document
before it's created. Its last column used to be Warehouse, which answers
nothing useful at that moment — "which Delivery Note am I invoicing?" is the
real question when a Sales Invoice is raised from one or more DNs, and a bare
item list can't answer it.

That column is now the **source document** each mapped line came from,
rendered as a link with the source's own date and status beneath it, plus a
Customer column whenever the rows carry a Sales Order that isn't already the
source. The mapped doc only carries the source *names*, so the rest is
fetched after the dialog is already open and filled into the cell it belongs
to — deliberately in the table itself rather than a summary block above it,
which just repeated what the column already said.

Two things this got wrong and must stay right:

- **Precedence.** A Purchase Order mapped from a Material Request carries
  BOTH `material_request` and `sales_order` on every row. The source is the
  MR, so `material_request` is checked first (then `delivery_note`,
  `purchase_receipt`, `sales_order`) — otherwise "Review Purchase Order —
  from Material Request" linked to the Sales Order and never named the MR.
- **Per-doctype fields.** Frappe's client-side `get_list` rejects the whole
  query with "Field not permitted in query" for a field the doctype doesn't
  have. A Material Request is dated `transaction_date`, not `posting_date`,
  and has no `grand_total`/`currency` at all — asking for those broke this
  dialog outright. The date field and whether a total exists are therefore
  resolved per doctype, not assumed.

A note under the table states what the document is doing relative to what
was already raised — for an MR source, that the request already exists and
this order covers the balance still to order against it — rather than
leaving that to be inferred from an item table and a document id.

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
