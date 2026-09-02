# Order Flow dashboard

`erp_dacsinc_custom/page/order_flow/order_flow.js` (client) +
`order_flow_api.py` (server) — one page to watch a Sales Order travel
through the business: SO → Material Request → Purchase Order → Receipt →
Subcontracting/Embroidery → Pick List → Delivery Note → Invoice.

## Tabs

- **SO Approvals** — orders awaiting a merchandiser or final approval
  decision. Sub-tabs: Merchandiser Queue (Track), **Merchandiser Unassigned
  Orders**, **Pending Final SO Approval** (renamed from the older
  "Unassigned Order(s)" / "Pending Final Approval" labels — the
  `workflow_state` *values* compared in code were left untouched, only the
  user-facing labels changed).
- **Sales Tracker** — all orders, their current stage and next action.
- **Pick Lists** — the Pick Lists themselves (see below).
- **Purchase Flow**, **Job Work**, **Stock Tracker**, **Pending DN/SI**,
  **Finance**, **Embroidery Transfers** — each a different lens on the same
  underlying documents.

## Pick Lists tab

`get_pick_list_flow` in `order_flow_api.py`, rendered by `picklist_html`.

The only tab whose row **is** the document rather than a Sales Order — the
point is working through the Pick Lists themselves. It exists because a
draft Pick List holds no stock and delivers nothing until it is submitted,
and until then the order behind it silently reads as unfulfilled everywhere
else in this dashboard; a forgotten draft is invisible from every other tab.

The shared scope selector means:

- **Open (default)** — `Draft`, `Open`, `Partly Delivered`: exactly the set
  someone still has to act on.
- **All** — adds `Completed` and `Cancelled`, for history and lookup.

A Pick List that is fully picked but not yet delivered has status
`Completed` (ERPNext marks that on *picking*, not delivery), so it does not
appear under Open — that queue is **Pending DN/SI**'s job, and duplicating it
here would just mean two tabs claiming the same work.

Each row's Action column shows the one thing it is waiting on: **Submit**
(a draft — submitting it from here calls the same
`update_and_submit_pick_list` the Sales Order widget uses, with no row edits,
so all of its validation applies identically), or the qty still awaiting a
DN/SI. A draft's Picked column reads "not yet" rather than `0`, because
`picked_qty` genuinely stays 0 until submit and a bare 0 reads like
something went wrong.

Visibility follows the same rule as every other tab —
`of_tab_picklist_roles` on **Admin Settings > Tab Visibility**, empty meaning
"everyone who can open the page".

## Sales Tracker row layout

All eight columns are always visible — **Sales Order & Customer**, **Dates**,
**Current Stage**, **Action Required**, **Document Flow**, **Delivery**,
**Billing**, **Last Activity** — in one row, exactly as before (a "move
Dates/Document Flow/Delivery/Billing into the row's expand toggle" redesign
was tried and reverted per explicit feedback: this information needs to
stay in the same row, not be one click away). Clicking the row's own caret
expands the Item Stock & Action Plan widget below it (`toggle_so_details`,
anchored directly on the main row, as it always was).

The **Sales Order & Customer** cell carries, under the customer, the
customer's own PO reference (`po_no`, with `po_date` beside it when set) —
the number the customer and the merchandiser actually use to talk about the
order, so looking one up no longer means opening the Sales Order to check.
It is **searchable by the same box**: `_get_tracker_rows` matches `so.po_no`
alongside the SO name and customer, and the tracker's search placeholder says
so. Showing a reference on the row without making it findable is the half
that leaves people scrolling, so the two always ship together.

The tracker's own primary Action Required button is visually emphasized
(`td > .of-action-btn` — bigger, bolder, a subtle shadow) so it reads as
the one thing to look at on the row, without competing with the smaller
secondary action below it (see next section).

### Action Required can show more than one thing

A real order is often in more than one state at once — e.g. one batch
already delivered and unbilled while the rest is still being picked or
sourced. `_compute_stage_info` (server) computes the single most-actionable
**primary** stage exactly as before via `_compute_primary_stage_info`, then
a thin wrapper additionally attaches a `secondary_action` whenever some
delivered qty isn't billed yet AND billing isn't already what the primary
stage is about (`stage_key not in ("need_to_bill", "completed")`) —
`_resolve_secondary_billing_action` reuses the exact same "where does the
invoice come from" resolution (draft invoice already exists → submitted DN
to invoice against → raise a fresh one) as the primary `need_to_bill` stage.

Client-side, `tracker_html` renders `st.secondary_action` as an additional
button under the primary one, tagged "Also Pending" (never paired with an
"or" — the two are independent, both-need-doing items, not alternative
routes to the same outcome). The Current Stage pill also gets a small
"+ Needs Invoice" note whenever `secondary_action` is set, so the stage
column itself hints at the extra state without having to read the action
button text to notice it.

### The whole-order picture, without opening the row

The Item Stock & Action Plan widget's own "To complete this order" checklist
(see `so-rm-po-subcontracting-flow.md`) aggregates three zones per line —
needs invoicing, ready to ship, still a shortfall — but that's only visible
once the row is expanded. `_get_tracker_rows` computes the same three
totals in bulk, for every row, straight from `Sales Order Item` fields
alone (`qty`/`delivered_qty`/`picked_qty`/`billed_amt`/`rate` — no live
stock/PO lookup, since this runs for every row on the page): `needs_invoice_qty`,
`ready_to_ship_qty`, `shortfall_qty`. The primary/secondary action buttons
already surface the first two; `tracker_html` additionally shows a plain
"{qty} Still Short" note under the Action Required buttons whenever
`shortfall_qty > 0` — the one zone neither action button represents — so
the full picture is visible in the tracker row itself, with no toggle.

### DN/SI action labels are route-aware everywhere

Once an order has committed to a fulfillment route (a submitted DN locks it
to "dn", a submitted Update-Stock SI locks it to "si" — see
`guard_so_fulfillment_route_lock`), naming the action "DN / SI" as if it
were still an open choice is misleading — the choice was already made.
`_compute_stage_info`'s own labels were already route-aware; the Sales
Order widget's per-item buttons (`so_dn_si_action_label`/
`so_dn_si_status_label` in `sales_order.js`) were not, and used to say
"Waiting for DN / SI" regardless. Both now read the same `so_route_lock`
signal, so every place this action appears — the tracker's own Action
Required column, the widget's per-item Next Action cell, and the
`so_prompt_dn_or_si` dialog's own title — say "Create Delivery Note" /
"Create Sales Invoice (Update Stock)" once locked, "Create DN / SI" only
while genuinely still open.

## A refresh preserves whichever row is expanded

`refresh()`'s `paint()` fully replaces the tracker panel's HTML — every row
collapsed back to its default (unexpanded) state. Before this, a manual
Refresh click, a realtime update, or a focus-regain refresh silently
collapsed whatever Item Stock & Action Plan widget was open, with nothing
about it visibly indicating a refresh had actually happened — it just
looked like the click (or the realtime update) had done nothing at all.

`refresh()` now records which Sales Order name(s) are currently expanded
(reading `.of-so-items-container`'s own `data-so`, scoped to the active
panel) before repainting, and re-expands each of them afterward via
`toggle_so_details` — which, per its own always-refetch behavior, pulls
fresh data rather than reusing anything stale. The widget the user was
looking at now visibly updates in place instead of disappearing.

## Real-time updates — no manual reload

Every document type that feeds this dashboard broadcasts a realtime event
whenever it changes, so any open dashboard reflects it immediately — not
just this session's own actions, and not only when a document happens to
open in a new tab or navigate away and back.

- **Server**: `order_flow_api.broadcast_order_flow_change(doc, method=None)`
  calls `frappe.publish_realtime("order_flow_changed", {...}, after_commit=True)`
  with no `room`/`user` — that broadcasts to every connected Desk user
  (`frappe.publish_realtime`'s own documented behavior when none of
  room/user/doctype+docname is given). `after_commit=True` so a change that
  gets rolled back later in the same request never fires a false signal.
  Wrapped in a bare `try/except` — a notification side-channel must never be
  able to break the document's own save/submit/cancel.
- Wired in `hooks.py`'s `doc_events` on `on_update` (covers insert, plain
  save, AND submit — Frappe's own `run_post_save_methods` fires `on_update`
  before `on_submit` for every submit) and `on_cancel` (a separate lifecycle
  `on_update` never fires for) on: Sales Order, Material Request, Purchase
  Order, Purchase Receipt, Pick List, Delivery Note, Sales Invoice, Purchase
  Invoice, Subcontracting Order, Subcontracting Receipt, Embroidery Work
  Order, and Uniform Embroidery Transfer (`on_update` only — not a
  submittable doctype, so there is no `on_cancel` to hook).
- **Client**: `order_flow.js`'s constructor listens with
  `frappe.realtime.on('order_flow_changed', ...)` and calls `this.refresh(true)`
  — debounced (1.2s), not throttled, since one user action can cascade into
  several of these documents changing in quick succession (e.g. creating a
  DN from a Pick List touches both) and those should coalesce into a single
  refresh rather than one per document.
- This sits alongside the pre-existing window-focus listener and
  `on_page_show` (see "The embedded Item Stock & Action Plan row always
  re-fetches on expand" below) — those still matter for a browser tab that
  was asleep/backgrounded when the realtime event arrived and missed the
  socket message, or a session whose socket briefly dropped.

Every list-returning endpoint (`get_pending_approvals`, `get_sales_tracker`,
`get_billing_flow`, `get_accounts_flow`) attaches each row's customer via
`of_customer_display(customer_name, contact_person_name)` — the primary
contact's first name shown in small text in parentheses next to the
customer name, e.g. `360ithub (Apeksha ji)`. Bulk-fetched server-side by
`_get_primary_contact_names_map` (with the same Dynamic-Link fallback
`verify_customer_details` itself uses), not one lookup per row.

## Sales Tracker: Current Stage / Action Required

`_compute_stage_info(order)` in `order_flow_api.py` is the single source of
the "Current Stage" pill and "Action Required" button shown per row on the
Sales Tracker (and reused by `get_summary`'s stage tiles). It runs down a
fixed priority chain — completed → currently pickable/deliverable →
receipt in transit → embroidery → job work → PO raised → MR raised → not
yet started — and returns as soon as one condition matches, so only the
single most-actionable stage is ever shown, never a stale one.

**A partially-delivered order must never look identical to a fresh one.**
Two different bugs of that shape have hit this function, both from the same
root cause: something that was true in the past (a Pick List was submitted,
a PO was raised) getting treated as still true now, even after some of the
order already shipped.

- *Ready-for-delivery gate.* `Sales Order Item.picked_qty` is a cumulative
  counter — Frappe never decrements it once a Delivery Note ships those
  units. So `picked_qty + delivered_qty` double-counts the same physical
  units (e.g. `picked_qty=300, delivered_qty=300` for one batch of 300 read
  as "600 covered" out of a 500 qty order, i.e. "fully picked", when in
  fact nothing is currently sitting picked-and-undelivered). The fix:
  `undelivered_picked_qty = sum(max(0, min(qty, picked_qty) - delivered_qty))`
  across the order's items, and the `ready_to_deliver` stage (whether the
  "Ready for Delivery" or "Partially Ready for Delivery" variant) is only
  returned when that's actually positive. Otherwise the function falls
  through to whatever the real current blocker is — an open PO, an open
  MR, or a brand-new shortfall needing one raised — exactly the surface
  the Sales Order's own Item Stock & Action Plan widget already shows.
- *Fallback labeling.* If nothing further is currently tracked (no open
  PO/MR/receipt/pick list survives the chain above), the function used to
  always fall all the way through to "Newly Created" — correct for an
  order that hasn't started, but actively misleading for one that's
  already partially shipped and now needs a fresh MR/PO for the remainder.
  `is_partially_delivered` (`per_delivered > 0` and not completed) is
  computed once near the top of the function and used to: (a) return a
  dedicated `partially_delivered` / `partial_rm_shortage` stage instead of
  `newly_created` at the very end, and (b) append an "— Partial Delivery"
  suffix to the mid-chain stage labels (Stock Arrived, Receiving Stock,
  Embroidery, In Job Work, PO Raised, MR Raised) so those stages are never
  ambiguous about whether they're covering a fresh order or the remaining
  balance of one already in progress.

`stage_key` values are used for filtering (stage tiles, `stage_filter`) and
must stay stable; `stage_label` is free text rendered as-is and safe to
reword without touching any client-side logic.

## Verify Customer Details (the approval dialog)

`show_verification_dialog` in `order_flow.js`, and a **near-identical
duplicate** in `public/js/workflow.js` (triggered from the Sales Order
form's own workflow-action buttons via the `WorkflowOverride` class) — both
call the same server methods and must be kept in sync when either changes.

Backed by `verify_customer_details(sales_order)` in `order_flow_api.py`.

- **Billing/Shipping Address** are real `Address` Link fields (not flat
  Data fields), scoped to this Sales Order only — picking or creating an
  address here writes to `so.customer_address` /
  `so.shipping_address_name`, **never** to the Customer's own
  `customer_primary_address`. (Earlier behavior *did* write to the
  Customer master, so picking an address for one order silently changed
  the default for every other order against the same customer — this was
  deliberately narrowed.)
- Each address field has a **live preview** underneath it — a read-only
  "Small Text" field (matching how Sales Order's own form shows
  `address_display`, so it renders inside the same boxed
  `like-disabled-input` control), refreshed via
  `frappe.contacts.doctype.address.address.get_address_display` on
  `onchange`.
- **"Create a New Address"** from either field auto-fills and locks
  **Link Document Type / Link Name** to this Customer. There is no
  first-class Frappe hook for this from a plain `frappe.ui.Dialog` (the
  standard mechanism, `frappe.dynamic_link` + `cur_frm`, only works from an
  actual document Form) — instead, `of_enable_new_address_customer_prefill`
  /`wf_enable_new_address_customer_prefill` temporarily patch
  `frappe.ui.form.make_quick_entry` for exactly the lifetime of this one
  dialog (restored on `dialog.onhide`), intercepting only an `Address`
  quick-entry.
- The notice banner shows the customer as a clickable link to the Customer
  record, `CustomerName (ID)`, with the primary contact's name in `()` —
  same `of_customer_display` concept as the list tabs.
- "Bypass" was renamed to "Skip" everywhere in this dialog (field label,
  button label, placeholder text) per an explicit request that the word
  read badly to merchandisers; the internal fieldname `bypass_comment` was
  also renamed to `skip_comment`.
- There is **no "Approval Settings > Skip Delivery Note (Direct Billing)"
  checkbox**. Approval is a customer-verification step; how the order
  eventually ships or bills is not decided here. The `skip_delivery_note`
  field still exists on the Sales Order (hidden on the form by property
  setter) and everything downstream still honours it — the "Direct Bill"
  chip on the tracker row, and the Sales Invoice's own delivery-note check
  in `custom_script.py`. Both copies of the dialog also stop **sending**
  the argument, which matters: `save_and_approve_sales_order` /
  `approve_sales_order_with_comment` only write the field
  `if skip_delivery_note is not None`, so an order that already carries the
  flag keeps it through approval instead of being silently reset by a
  checkbox that is no longer on screen.

## Cross-order stock conflicts ("Picked (Others)")

When one order's available stock (or a raw material's) gets claimed by a
*different* order's Pick List, that's surfaced directly — `picked_for_others_qty`
/ `draft_qty_for_others` / `conflict_details` in `get_item_stock_details_bulk`,
rendered as the "Picked (Others)" column on the Item Stock & Action Plan
widget with a "View" button naming the specific conflicting order and
customer. This already works for any item, generically — it isn't specific
to subcontracted finished goods.

`public/js/pick_list.js` adds the other half of this: reducing a Pick List
row's **Picked Qty** below what it was allocated shows a toast naming
exactly how much is being left for other Sales Orders to claim from the
same warehouse — purely informational, never blocks the edit.

## The embedded Item Stock & Action Plan row always re-fetches on expand

Each Sales Tracker row can be expanded (`toggle_so_details`) to show that
order's own "Item Stock & Action Plan" widget (the same one the Sales Order
form itself renders — see `so-rm-po-subcontracting-flow.md`) inline, without
navigating away. `toggle_so_details` used to reuse whatever was already
sitting in that row's container once it had been loaded once, only
re-fetching the first time a row was expanded — so raising a Purchase
Order/Material Request/Pick List from one of the widget's own Next Action
buttons (which opens or navigates to a separate document, outside this
page's own refresh cycle entirely) left the row showing a stale snapshot
if the user simply collapsed and re-expanded it afterward, with no true
full-page reload in between. `toggle_so_details` now always calls
`load_so_details` on expand — dropping the Sales Order from
`frappe.model`'s client-side cache first (`remove_from_locals`) so
`frappe.model.with_doc` is forced into a real `getdoc` call, not whatever
was already cached from before. `generate_stock_overview_table` itself
already re-fetches its own stock/procurement data fresh on every call, so
this was the one missing piece.

Separately, `paint()` fully replaces each tab's panel HTML on every
`refresh()` — so any row expanded before a refresh (the window-focus
listener in the constructor, or `on_page_show` on returning to this page
from elsewhere) collapses and is torn down, and next gets rebuilt from
scratch on its next expand. Only the same-row collapse/re-expand case
above was ever actually stale.

## An explicit tab role never gets silently overridden by doctype access

`can_view_tab(tab, user)` in `order_flow_permissions.py` had a second gate
beyond the tab's own role list: `TAB_DOCTYPES` (e.g. `"billing": ["Sales
Invoice"]`), which required the user to also have doctype-level read access
to at least one of those doctypes — checked *before* the role list, so it
could return `False` even for a role explicitly named in
`of_tab_billing_roles`. Confirmed live: adding `Merchandiser User` to
`of_tab_billing_roles` still hid the tab, because that role has no Custom
DocPerm grant on Sales Invoice at all (correct, per the business's own
permission matrix — a Merchandiser doesn't touch Sales Invoice directly).
The admin had no way to know the field they'd just set wasn't actually
deciding anything.

Fixed: an explicit, non-empty role list is now authoritative on its own —
`TAB_DOCTYPES` only applies to the *unconfigured* fallback (a tab with no
role list configured falls back to "everyone who can read the underlying
doctype", not literally everyone, same as before). Naming a role in Admin
Settings is a deliberate decision and must not be second-guessed by a
separate, invisible permission check.

The same investigation found two more places with the identical root cause
— an automated "sync" silently overwriting a deliberate admin choice — both
reachable from the "Sync DAC Matrix" action on the Roles & Permissions page
(`sync_dac_matrix_and_users` in `roles_and_permissions_api.py`):
`order_flow_permissions.sync_admin_settings_tab_roles()` used to `.set(field,
[])` and fully rebuild each `of_tab_*_roles` list from doctype access alone
(so a role like Merchandiser User on `of_tab_billing_roles` would vanish
again the next time anyone clicked that button), and
`dac_permission_matrix.sync_workspace_roles()` did the same
`doc.set("roles", [...])` full replace on dashboard Workspaces. Both are now
additive merges, and the user-Role-Profile step of `sync_dac_matrix_and_users`
now calls `apply_dac_matrix_assignments()` (the same additive path the "DAC
Matrix" dialog itself uses) instead of its own separate
`update_user_role_profiles(user, [proposed])`, which was a hard replace that
could silently drop a second Role Profile someone else had added for another
responsibility.

## Merchandiser scoping now covers every tab that can show it

`is_scoped_to_own_customers(tab)` (order_flow_permissions.py) used to only be
called from Tracker. It's now called from Purchase, Job Work, Accounts, and
Billing too (Approval has its own separate, deliberately different
mechanism — see below), so a plain Merchandiser User (no other tab-granting
role) sees only the Purchase Orders/Material Requests/Receipts/Embroidery
Work Orders/Invoices tied to their own customers' Sales Orders, the same way
Tracker already scoped Sales Orders themselves.

**How the SQL scoping actually works, since most of these are aggregated,
not one-row-per-Sales-Order queries.** Purchase/Job Work/the Purchase-Invoice
half of Accounts are `GROUP BY <document>` queries joining an item table up
through Sales Order to Customer (a single PO can carry lines for several
Sales Orders/customers, rolled up via `GROUP_CONCAT`). Adding
`cust.custom_merchandiser_user = %(merch_scope)s` to the WHERE clause does
double duty on these: a document with **no** line belonging to one of the
merchandiser's customers disappears entirely (every joined row gets filtered
before `GROUP BY` can produce one), and a document that **does** have some
matching lines still shows, but its `GROUP_CONCAT`/`SUM` columns roll up only
the matching lines — the merchandiser sees their own portion of a
company-wide PO, not the whole thing. The Sales Invoice half of Accounts
needed no such nuance — a Sales Invoice belongs to exactly one Customer
(`si.customer`), so the same condition is an unambiguous per-row filter
there. Every query that reuses one of these condition lists for a separate
aggregate (`pending_mrs`, both `po_agg`s, `active_ewos`,
`_purchase_invoice_agg`) needed its own `LEFT JOIN tabCustomer cust` added
too — several of them didn't have one before, since nothing had ever
filtered on `cust` there.

**Billing's own scoping decision, not Tracker's.** `get_billing_flow` reuses
Tracker's `_get_tracker_rows` query wholesale, which used to hard-code
`is_scoped_to_own_customers("tracker")` regardless of which tab actually
called it — so a merchandiser's Billing-tab visibility was silently decided
by `of_tab_tracker_roles`, not `of_tab_billing_roles`. `_get_tracker_rows`
now takes a `tab` parameter (defaulting to `"tracker"`) and
`get_billing_flow` passes `tab="billing"`, so each tab's own role
configuration governs its own scoping — they can legitimately disagree (a
user with Merchandiser User + Accounts Executive might be broadly visible on
Billing but scoped on Tracker, if Accounts Executive is only configured on
`of_tab_billing_roles`).

**The "All" role defeated scoping wherever it appeared.** `is_scoped_to_own_
customers` narrows a merchandiser only if none of their OTHER roles are also
configured on that tab — but `sync_admin_settings_tab_roles()` (see above)
can pull the universal `All` role into a tab's list as a byproduct of "roles
with read access to the underlying doctype," not as a deliberate "open this
to literally everyone" choice. Since every user holds `All`, it always
satisfied that "other role" check, silently un-scoping every merchandiser on
any tab where it showed up — confirmed live on `of_tab_accounts_roles`.
`All` is now excluded from that check.

**Not scoped, and can't meaningfully be:** Stock Tracker (`get_stock_
tracker`) is a company-wide, per-Item availability report with no Sales
Order or Customer in its query at all — "my customers' items" isn't a
coherent question to ask of it. Embroidery Transfers
(`get_embroidery_transfers`, `uniform_transfer_api.py`) queries `Uniform
Embroidery Transfer` directly, a doctype with no `sales_order` or `customer`
field whatsoever — a warehouse-to-warehouse stock move, structurally
decoupled from any order. Approval (`get_pending_approvals`) keeps its own
existing, intentionally different rule (`is_merchandiser_user()`, not
`is_scoped_to_own_customers` — also matches customers with **no**
merchandiser assigned yet, not just the viewer's own, so a merchandiser can
still claim and approve a brand-new customer's first order) — left as-is,
not unified into the others.

## Sales Tracker hides what Pending DN/SI hides

`need_to_bill` and `ready_to_deliver` are the two stages Pending DN/SI (the
"billing" tab, gated by Admin Settings' `of_tab_billing_roles`) exists to
show. Sales Tracker's `get_summary` (stage tiles) and `get_sales_tracker`
(the row list) both compute the very same stages via the shared
`_compute_stage_info`/`_get_tracker_rows` — so without an explicit check, a
user excluded from `of_tab_billing_roles` but included in
`of_tab_tracker_roles` could see every "still needs a DN/SI" order and
count through Sales Tracker, making the billing tab's own restriction
pointless. Both endpoints now call `can_view_tab("billing")` and, when
`False`: `get_summary` returns `need_to_bill`/`ready_to_deliver` as `None`
(not `0` — the client tells "nothing pending" apart from "hidden from you"
and renders a lock icon on those two tiles instead of a count) and
`get_sales_tracker` drops those orders' rows entirely, from every scope and
`stage_filter`. Every other stage tile/row is unaffected.

## Pending DN/SI includes orders whose billing is a *secondary* action

An order can need billing without billing being its **primary** stage: part
of it shipped on a Delivery Note while the rest is still being picked or
sourced, so its primary stage is `partially_delivered` and the unbilled
delivered qty rides along as `secondary_action` instead (see
`_compute_stage_info`).

`get_billing_flow` used to filter on the primary `stage_key` alone, which
dropped exactly that order from this queue — confirmed live: an 81.8%
delivered, 0% billed order with a submitted Delivery Note sitting ready to
invoice appeared nowhere on the tab. The filter now also admits any row
carrying a `secondary_action`: if `_compute_stage_info` decided there is a
billing action to take, this tab is where it belongs, whichever slot that
action ended up in.

## "RM tier" means raw material, not "missing a link"

`is_rm_tier` in `_EVENT_SQL` marks a document raised for a BOM **raw
material** rather than for the item the Sales Order sells. It drives the
separate "RM:" pipeline indicator and is deliberately kept out of stage
computation.

A missing `sales_order_item` link alone does NOT make something raw
material. ERPNext's own Material Request → Purchase Order mapping carries
`sales_order` through but not `sales_order_item`, so a PO for the order's
own sold item arrives with that link empty — confirmed live: a PO for "Item
1 without BOM" (an item with no BOM at all, so it can have no raw-material
tier) was reported on the tracker as "RM: 1 PO", and its real progress went
missing from the normal document flow.

The test is therefore whether the line is for an item this Sales Order
itself sells (for a subcontracted PO, matched on `fg_item` too). Only a line
that is neither linked to an SO line nor for a sold item is raw material.

## Submitting a Pick List asks what was picked

Submitting sets each line's `picked_qty` and reserves that stock, so the Pick
Lists tab's old bare "Submit Pick List X?" confirm silently committed the full
allocated qty even when less was physically picked.

`prompt_submit_pick_list` now lists the lines — item, warehouse, allocated qty
— with an editable **Picking now** figure per line, defaulted to the allocated
qty and capped at it. Lines are fetched by `get_pick_list_rows`, which returns
each child row's own `pick_list_item` name, and submitted through the same
`custom_script.update_and_submit_pick_list` the Sales Order widget uses.

Quantities can only be **reduced**. The input's cap is a convenience, not the
guard: `update_and_submit_pick_list` refuses an increase server-side and names
the item and its ceiling, so the rule holds however the call is made. A
submit with every line at 0 is refused too — that is a cancel, not a pick.

### A short pick sets picked_qty — it must NOT shrink the allocation

`Pick List Item` holds both figures: `qty`/`stock_qty` is what was allocated,
`picked_qty` ("Picked Qty (in Stock UOM)") is what was physically picked.
Picking 80 of an 88 line must record **88 allocated, 80 picked**, leaving the
8 short visible on the document itself.

`update_and_submit_pick_list` briefly did the opposite — it overwrote `qty`
down to 80, which destroyed the fact that 88 was ever asked for and made the
app auto-raise a second Pick List for the "missing" 8. `qty_means` now
separates the two actions explicitly:

- `"picked"` (default, used by every submit path) — sets `picked_qty`, leaves
  the allocation alone. Converted by `conversion_factor`, since `picked_qty`
  is in stock UOM.
- `"allocated"` — replaces `qty`/`stock_qty`, for correcting a draft that was
  built for the wrong quantity in the first place.

`scan_mode` must stay off. ERPNext's `validate_picked_items` fills `picked_qty`
from `stock_qty` **only when it is still 0**, so an explicitly-set short pick
survives submit untouched — whereas `scan_mode = 1` makes it *throw* on any
pick short of `stock_qty`, which is the opposite of what a short pick needs.

Delivery is then measured against what was **picked**, not allocated (see
`_calculate_pick_list_delivery_status`): an 88/80 line can only ever deliver
80, so keeping 88 as the denominator capped it at 90.9% and left the Pick List
permanently "Partly Delivered" with 8 forever "awaiting DN/SI".

Verified end to end: 5 picked against an 8-allocated line submits with
`qty = 8, picked_qty = 5`, the Sales Order line's `picked_qty` moves by 5, a
Delivery Note maps exactly 5, and the Pick List reaches 100% / Completed.
Asking for more than was allocated is refused by item name.

## Some events are keyed by the Purchase Order, not by their own doctype

`_EVENT_SQL` selects the **Purchase Order** as `name` for the job-work and
embroidery events (`ewo.purchase_order`, and the PO behind the Subcontracting
Order) — deliberately, because the PO is what this business manages the job
from. The doc-flow chips already relabel those as Purchase Order, and so does
the "Track Embroidery" action.

Last Activity did not: it linked `last_event_doc` (a PO name) using
`last_event` (the milestone's display doctype), producing
`/app/embroidery-work-order/PUR-ORD-2026-00109` — a dead link to a doctype
that never had that name. The Job Work variant was worse:
`/app/job-work-(subcontract)/…` is not even a real route.

`_EVENT_LINK_DOCTYPE` now records, for exactly those events, the doctype the
name actually belongs to, and the row carries `last_event_doc_doctype` for the
client to route by. The milestone WORDING is unchanged — "Embroidery work
started" is still the right thing to say; only the link target moves. Any new
event whose `name` is not a document of its own doctype must be added there.

## An undefined CSS variable fails silently — and invisibly

`--of-pink` was referenced by `.of-stage-btn--emb.is-active` and
`.of-tile--emb` but never defined in the `.of-page` palette. An undefined
custom property with no fallback makes the whole declaration invalid at
computed-value time, so `background: var(--of-pink)` resolved to transparent
rather than to the blue it was overriding — while the base `.is-active` rule's
`color: #fff` still applied. The Embroidery chip therefore rendered as a
completely blank pill (white label on the white card) whenever it was the
selected filter; only its literal `#c91a7d` border showed. `--of-yellow` had
the same defect on an icon colour.

Both are defined now, and the palette is worth checking whenever a colour is
added: every `var(--of-*)` in `order_flow.css` **and** in `order_flow.js`'s
inline styles must resolve against the `.of-page` block, since nothing warns
when one doesn't.

## Printing an Embroidery Work Order

Both Job Work embroidery sub-tabs (Full Piece and Panel) carry a print button
in their Action cell, beside whatever the row's own action is — a work order
can be printed at any stage, so printing never replaces Receive / Close /
Track. Both tables share one row builder, so the button is added once.

`of_print_ewo` uses the **same** doctype, print format, letterhead and
language arguments as the Purchase Order form's own linked-documents table
(`render_linked_docs_html`), so a work order prints identically wherever it is
printed from. That is duplication of a kind — if the print format is ever
renamed, both call sites must change together.

The handler calls `stopPropagation`: these rows are click-to-expand, and
without it printing would also toggle the row open. (The row's own click guard
already excludes `button`, so this is belt and braces.)

## "RM Ready — Make SCO PO": a card that is not a stage

Most filter cards map to a `stage_key`, and a stage is **exclusive** — a row
has exactly one. "raw material has arrived, so a Subcontracting PO can be
raised now" is not exclusive: an order can be sitting at any stage while that
is true (verified: the one order this fired on was at `in_embroidery`). So it
is a per-row boolean, `rm_ready_for_sco`, listed in `OF_FLAG_STAGES` on the
client and `_FLAG_FILTERS` on the server; `get_sales_tracker` matches those
against the row flag instead of `stage_key`, which would always return
nothing.

`_rm_ready_for_sco` computes it for every order on the page at once:

- Candidate lines are BOM lines on open orders with qty still undelivered,
  minus finished-good qty **already on a Subcontracting PO** (that part needs
  no new PO, and its raw material may already be at the jobber).
- "In stock" means the same thing as everywhere else in this app: physically
  in `tabBin` at VV Puram now. A pending MR or PO does not count.

**Stock is allocated, not just compared.** `check_bom_raw_materials_in_stock`
documents that each call is an independent snapshot, so calling it once per
candidate would hand the same fabric to every order needing it and report "5
ready" off stock covering 2 — the same double-counting bug class this app has
hit repeatedly. Instead one working stock map is decremented as each candidate
claims it, so the count only ever promises stock that exists. Candidates are
taken earliest-delivery-first, then by name, so the result is stable between
loads rather than shuffling with row order.

The row also carries `rm_ready_fg_qty` / `rm_ready_items` and shows an inline
"RM Ready — Make SCO PO (qty)" note under its stage pill, so a filtered list
explains itself rather than looking arbitrary.

## The dashboard reuses the Sales Order widget's preview and picker

`sales_order.js` is already `frappe.require()`d on this page (that is how
`show_bulk_dn_si_modal` is reused), so create-from actions here use its
`so_show_mapped_doc_preview` and `so_pick_source_docs` rather than a second,
thinner implementation. The dashboard's own preview listed item/qty/warehouse
only; the shared one names the SOURCE document each line came from with its
date and status, the customer, and what the document is doing relative to
what was already raised.

`make_invoice_from_dn` carries a comma-joined list of Delivery Notes, so it
opens the picker (all ticked) when there is more than one — anything unticked
stays unbilled. Every other action here maps from a single source and needs
no such step. Both delegations are guarded by a `typeof` check so a load
failure degrades to the plain table instead of leaving the button dead.

## On Pending DN/SI, the billing action leads

Being *in* this queue isn't enough — the Action column has to offer the
action this queue is about. A partly-delivered order's primary action is
about the rest of the order (raise an MR, await stock) while its billing
need is the `secondary_action`, so rendering the primary action alone put
"Raise MR from SO" in the Action column while the invoice the tab exists for
had no button at all.

`billing_html` therefore leads with the billing action wherever one exists,
and shows the primary stage's action beneath it as "Also pending" — it is
real work, just not what this queue is for. The Stage cell keeps showing the
order's true stage ("Partially Delivered — Awaiting More Stock") plus a
"Needs Invoice" note, so the stage is never misrepresented to make the
action fit.

## A Pick List can be delivered by either route

`Pick List Item.delivered_qty` is only written by the **Delivery Note**
route. A **Sales Invoice with Update Stock** delivers the same Pick List
without touching its child rows at all — it updates the parent's
`per_delivered` / `delivery_status`, which
`_reconcile_pick_lists_for_sales_orders` keeps current for both routes.

So any "how much of this Pick List is still undelivered" figure must read
the parent, not just sum the rows. `get_pick_list_flow` takes whichever of
the two shows MORE delivery. Confirmed live: three Pick Lists on a
Completed, 100%-delivered, 100%-billed order (delivered through one Update
Stock invoice) each had `delivered_qty = 0` on every row and were reported
as "awaiting DN / SI" for their full picked qty.

## The items toggle shows ordered vs received, per item

`get_document_items` returns `ordered_qty` / `received_qty` / `pending_qty`
per line, so the row-level toggle answers "how much was ordered and how much
has actually come back" instead of just listing quantities.

What that means differs per doctype, so `_doc_item_progress` resolves it
rather than assuming one shared field name — and `progress_label` names what
the figure actually is, so the column never claims "Received" over something
else:

- **Purchase Order / Purchase Invoice** — `qty` vs `received_qty`. On a
  subcontracted PO the Finished Good row compares `fg_item_qty` against the
  same row's `received_qty`, so "sent X, get back Y" reads per line.
- **Material Request** — the only one with both natively: `qty` requested,
  `ordered_qty` turned into a PO (shown as its own **On PO** column), and
  `received_qty` arrived.
- **Purchase Receipt / Subcontracting Receipt** — the row *is* the arrival,
  so `qty` is the received figure and there is no Pending column at all
  rather than a made-up zero.
- **Sales Invoice** — `qty` vs `delivered_qty`, labelled "Delivered".

## Pending DN/SI's "All" scope also shows Completed orders

`get_billing_flow` lists orders in the Sales Tracker's own `ready_to_deliver`
and `need_to_bill` stages — deliberately never `completed`, since this tab's
whole point is "still pending". But choosing "All" in the shared `#of-scope`
selector already tells `_get_tracker_rows` to stop excluding Completed
orders at the SQL level; this tab's own stage_key filter silently threw
them right back out regardless, so "All" here never actually showed
everything the selector's own label promised. Now: `scope == "all"` widens
the allowed stage_keys to also include `completed`, so choosing "All" means
every order that ever passed through this queue, not just the ones still
in it. Verified live against real data: `scope="open"` correctly finds
none currently completed-and-matching; `scope="all"` correctly surfaces one.

## Delivery Note / Sales Invoice rows are locked to their Pick List

A Delivery Note Item's `pick_list_item` (or, for an Update Stock Sales
Invoice, `so_detail` — Sales Invoice Item has no `pick_list_item` field, but
in this company's flow the only way to reach an Update Stock invoice
against a Sales Order is `create_dn_or_si_from_pick_lists`, which always
sets `so_detail`) means a submitted Pick List already physically reserved
that exact item/qty/warehouse. Editing `qty`/`item_code`/`warehouse` on
that row afterward — before the DN/SI is itself submitted — desyncs it from
what's actually reserved without the Pick List, or anything computed from
it (picked_qty vs delivered_qty, every "ready to ship" vs "still short"
distinction this whole document describes), ever finding out.

- **Client** (`public/js/delivery_note.js` / `sales_invoice.js`): the same
  pattern already used to lock `rate`/`price_list_rate` to a linked Sales
  Order line — `grid.edit_cell` override, `on_row_refresh`, and
  `form_render`'s per-row `read_only` toggle — extended to also lock
  `qty`/`item_code`/`warehouse` when the row is Pick-List-linked.
- **Server** (`custom_script.guard_dn_items_locked_to_pick_list` /
  `guard_si_items_locked_to_pick_list`, on `validate`): backs the client
  lock with a real guarantee, the same reasoning as
  `lock_item_rate_to_sales_order` (a client-side read-only can be bypassed
  via the API). Compares each locked row against `doc.get_doc_before_save()`
  — the row's own state as of the last save — and reverts
  qty/item_code/warehouse if any changed, with an explanatory `msgprint`.
  Only applies to a row that already existed on a prior save; a freshly
  mapped row being saved for the first time has nothing to protect yet.

`amount` is locked client-side alongside `rate`/`price_list_rate` (i.e. on
`so_detail` — any row against a Sales Order, not only a Pick-List-linked
one) rather than alongside qty/item_code/warehouse: it's purely `qty *
rate`, so a plain SO-mapped row with no Pick List still needs `qty`
editable to choose how much to deliver, and `amount` recalculates from
that automatically — it just can't be typed into directly to silently
back-derive a different rate. No new server-side guard was needed for
it: ERPNext's own `calculate_taxes_and_totals` unconditionally recomputes
`item.amount = item.rate * item.qty` on every save regardless of what a
client sent, and the existing rate lock already guarantees `rate` itself
can't drift — so `amount` was already fully protected server-side once
`rate` was.
