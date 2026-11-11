# Kits tab — make kits from separate items, break them back

Order Flow › **Kits** (`kit_api.py`, `kit_html` / `prompt_kit` in `page/order_flow/order_flow.js`).

## What it does

- **Make Kit** — pick the kit item (its stock goes **up**), how many kits (warehouse fixed: VV Puram -
  IND, read-only; `kit_api.KIT_WAREHOUSE` refuses any other) and, by hand, each part with its **qty in ONE kit** (e.g. Shirt 2, Pant 1, Shoe 1).
  Each part's stock goes **down** by qty-per-kit × kits.
- **Break Kit** — the reverse: kits go down, parts go up. The parts are filled from the last Make Kit
  of that kit item (`last_recipe`) and can be changed.
- Each is **one submitted Repack Stock Entry**, Stock Entry Type **Make Kit** / **Break Kit** (purpose
  Repack; both types are created on first use). The tab lists those entries: kit item, kits (+/−),
  parts per kit and the stock change, warehouse, who made it. Cancelled entries show as Cancelled.

## Stock shown, confirmation, history

- The dialog shows per part: total out / in, **stock now**, free now, **stock after**; and the kit
  item's stock now → after.
- Before anything is saved a **confirmation** (`of_kit_confirm`) lists what goes **OUT** and comes
  **IN**: qty, stock now → after, approximate value (as the entry will book it), the warehouse, who is
  doing it and when. Its button works only after "I have checked the items, quantities and stock above".
- **History**: every Make / Break / Cancel writes a dated comment — who, what, each item's stock
  before → after, notes / reason — on the Stock Entry **and** on the kit item (so it survives a delete).
  A cancel done from the Stock Entry form is recorded too (`on_cancel_comment`, Stock Entry on_cancel).

## Cancel and delete (from the tab)

- **Cancel** (row button, for users who may cancel a Stock Entry): reason required, same confirmation
  showing the reversal; ERPNext reverses the stock and refuses if it would go negative (kits already
  sold / broken). The row then shows "Cancelled by … · Reason …" (an Info comment `Kit cancel reason:`).
- **Delete**: only a cancelled entry (its stock was already reversed), for users who may delete a Stock
  Entry. Frappe keeps a copy in Deleted Documents; a "Deleted" line is added on the kit item.
- Live (11-11-2026): cancel — Admin, Super Admin, Stock Manager / User, Manufacturing Manager / User,
  Production Manager, Production Assistant; delete — the same without the two Production roles.

## Rules (server-side; the dialog shows the same before saving)

- Only **free** stock can go out — stock held for Sales Orders (Pick Lists, jobber, earmarks —
  `uniform_transfer_api._free_stock`) is not free. No override. The dialog shows "Free now" per line.
- Kit item and parts: enabled stock items, not templates, no serial / batch numbers (those are made
  as a Repack Stock Entry by hand). The kit item cannot also be a part; a part cannot be on two lines.
- Kits and every qty per kit must be more than 0; at least one part; warehouse VV Puram - IND only.

## Accounting

- Company: the warehouse's company. Valuation follows Stock Settings (FIFO on this site).
- **Make Kit**: ERPNext's Repack puts the parts' outgoing value on the kit (kit rate = parts' value ÷ kits).
- **Break Kit**: several different items come in, which ERPNext's Repack cannot rate by itself
  (`get_basic_rate_for_repacked_items` returns nothing for more than one item). After ERPNext has
  worked out the kits' real outgoing value, `_split_value` spreads it over the parts in proportion to
  each part's current valuation (by qty when none has one), rounded to the paisa with the last part
  taking the remainder, and sets each part's Amount too.
- So value in = value out on both: the stock ledger nets to 0, and as kit and parts are in the same
  warehouse (same Stock In Hand account) no GL entry is needed — nothing goes to Stock Adjustment.
  Stock carried at 0 stays at 0 (allowed explicitly on that row).

## Who

**Production Manager** only (agreed 11-11-2026), plus admins (Administrator, System Manager, Super
Admin, Admin). A merchandiser does not see it. Where it is set:

- **Admin Settings › Order Flow › Kits — Allowed Roles / Can Act** (`of_tab_kit_roles`,
  `of_tab_kit_act_roles`). The patch `kits_tab_roles` fills them once with Production Manager.
- **Access sheet** (/roles-and-permissions › Agreed tabs) has a **Kits** row; saving the sheet writes
  those two fields, like every other tab. A sheet saved before the row existed starts it with
  Production Manager ticked (A), and "Refill from document access" also gives Production Manager —
  not everyone who may make a Stock Entry (merchandisers make jobber transfers).
- While the fields are empty (before migrate) the tab uses `order_flow_permissions.DEFAULT_TAB_ROLES`
  (Production Manager), so it is never "unconfigured": an unconfigured tab would widen who may open the
  Order Flow page (`sync_order_flow_page_roles` → LEGACY_PAGE_ROLES). The old "Sync DAC matrix"
  rebuild (`sync_admin_settings_tab_roles`) skips this tab for the same reason.
- Cancel / delete buttons still follow the Stock Entry cancel / delete permission.
