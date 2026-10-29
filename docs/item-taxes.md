# Item taxes (GST slab + Exempted)

An item's **Taxes** table is never edited by hand. `custom_script.item_before_save` (Item ›
validate) rebuilds it from three fields on the item, every time one of them changes:

| Field | Meaning |
|---|---|
| GST rate (`custom_tax_rate`) | Item Tax Template below the slab, e.g. `GST 5% - IND` |
| Alternate GST (`custom_alternative_gst_`) | Template from the slab amount up, e.g. `GST 18% - IND` |
| Alternate amount (`custom_alternative_amount`) | Net rate where the alternate GST starts, e.g. 2501 |

## Rows it writes, in this order

With a slab (alternate GST and amount both set):

| Tax Category | Template | Min net rate | Max net rate |
|---|---|---|---|
| In-State, Out-State | GST rate | – | amount − 0.01 |
| In-State, Out-State | Alternate GST | amount | 9,999,999 |
| In-State, Out-State | Exempted - IND | – | 9,999,999 |
| In-State, Out-State | GST 0.1% - IND | – | 9,999,999 |

Without a slab: In-State and Out-State rows with the GST rate, then In-State and Out-State
`Exempted - IND` rows, then `GST 0.1% - IND` rows, none with a range.
Every row has **Valid From 2023-01-01** (`TAX_VALID_FROM`). `Non-GST - IND` items get no rows. An item whose GST rate
is itself `Exempted - IND` (e.g. Khadi, an exempt supply) gets just its In-State / Out-State rows — the
extra Exempted rows would repeat the template, which the Item form refuses.

## A line sold without GST

On the Quotation / Sales Order / Invoice the line still fills in the GST template by itself. For a line
that is sold without GST, change that line's **Item Tax Template** to **Exempted - IND** (0%). Other
lines keep their GST, so one document can mix taxed and Exempted lines. The Tax Category of the
document stays In-State / Out-State.

## GST 0.1% for a merchant exporter (`merchant_export.py`)

Goods sold to a **merchant exporter** (a buyer who exports them within 90 days, Notifications 40/2017 and
41/2017) carry GST **0.1%**: CGST 0.05% + SGST 0.05%, or IGST 0.1%.

- **Template `GST 0.1% - IND`**: made by `patches/merchant_export_gst.py` from `GST 5% - IND` — the same accounts
  (Output / Input / RCM / Refund), every rate × 0.02 with its sign — so it posts to the usual GST ledgers and
  India Compliance reports it as the 0.1% rate (GSTR-1, e-invoice).
- **On every item** with GST rows, two `GST 0.1% - IND` rows come **last** (after Exempted): listed, so a line can
  keep it, but never picked by itself — the first fitting row (the item's GST) stays the default. On a slab item
  they carry the full range like the Exempted rows (a row without a range is skipped while a ranged one fits —
  without the range they would never be valid there; on an item without a slab, a ranged row would become the
  default instead). Items on Exempted / Nil-Rated / Non-GST get none. The patch added them in bulk with a dated
  comment per item; `update_tax_child` adds them on every rebuild, and an item saved without them gets them.
- **Customer tick "Merchant Exporter (0.1% GST)"** (`custom_merchant_exporter`): a Quotation / Sales Order /
  Delivery Note / Sales Invoice / POS Invoice line on `GST 0.1% - IND` is refused unless the customer is ticked
  (`guard_merchant_export`, validate) — 0.1% charged to anyone else is GST under-paid. A Quotation to a Lead can't
  carry it.
- **Document tick "Merchant Export - GST 0.1%"** (`custom_merchant_export`, next to Tax Category on Quotation /
  Sales Order / Delivery Note / Sales Invoice; shown only for a ticked customer, `public/js/merchant_export.js`):
  ticking puts every line whose item lists the template on it at once; unticking puts them back on the line's
  normal template (`get_default_templates` — the first fitting row, so 5% / 18% by price). On save
  (`apply_document_tick`, before_validate after the Tax Category rule) a ticked document puts new lines on 0.1%
  too; a document unticked after being ticked has its 0.1% lines put back; on a document never ticked a line set to
  0.1% by hand is left alone. Exempted / Nil-Rated / Non-GST items keep theirs. The tick is copied when a Quotation
  becomes a Sales Order (same field name), and on to the Delivery Note / Invoice.
- **Use**: tick the customer once (after the accountant confirms they qualify); on the document tick **Merchant
  Export - GST 0.1%** (or set single lines' **Item Tax Template** to `GST 0.1% - IND`, as for Exempted). Tax
  Category stays In-State / Out-State. Purchases need no tick (the supplier decides the rate on their bill).

## Why it is built this way

- ERPNext only keeps a line's Item Tax Template if the item lists it for the document's Tax Category
  (`taxes_and_totals.validate_item_tax_template`). A template that is not listed is **silently
  replaced** by the item's first valid one — so without the Exempted rows, choosing Exempted on a line
  would turn back into GST 5%.
- ERPNext fills a new line with the **first** row that fits (`get_item_details._get_item_tax_template`),
  so the Exempted rows always come last; GST stays the automatic choice.
- Rows without a price range are used only when no ranged row fits the line. On a slab item the
  Exempted rows therefore carry the full range, and the upper GST rows carry 9,999,999 rather than 0
  (0 counts as "no range" — and the Item form rejects a minimum above the maximum, so an item built
  with 0 could not be saved again).
- A row with a price range but no Valid From is treated as valid from **today**
  (`getdate(None)`), so a Quotation / Order / Invoice dated before today found no template: the line
  and the Item Tax Template dropdown stayed empty. Every row therefore has Valid From 2023-01-01. All
  rows share that date, so ERPNext's sort by Valid From keeps them in order. A document dated before
  2023 gets no item template. `patches/item_tax_valid_from.py` dated the existing rows on migrate (one
  SQL update, a dated comment per item) and saved again the drafts left with empty lines; a draft that
  can't be saved (e.g. a disabled item on it) is printed for fixing by hand. Submitted documents are
  not changed.
- The Item form allows a template only once per Tax Category: one Exempted row each for In-State and
  Out-State.

## Tax Category: always In-State or Out-State (`tax_category.py`)

The rows above exist only for Tax Category **In-State** and **Out-State**, and ERPNext picks a line's
template only from rows of the document's Tax Category. A blank or wrong category leaves the line
without a template, and it is then taxed at the **header** template's rate — an SEZ invoice for a
5% item went out at 18% IGST (SINV-26-00035: the customer had no Tax Category). India Compliance
picks the right GST template but never sets the category; ERPNext copies it from the Customer.

- **Quotation / Sales Order / Delivery Note / Sales Invoice drafts** (`before_validate`): the Tax
  Category is set by India Compliance's own test — **Out-State** for SEZ / Overseas or a place of
  supply in another state than the company GSTIN, else **In-State**. Lines with no Item Tax Template,
  or one not valid for that category, get the item's first valid row (ERPNext's
  `get_item_tax_template`: price slab and Exempted kept — a line set to Exempted stays Exempted); a
  header GST template of the other category is swapped for the matching one. The new tax rows are then
  tagged igst / cgst / sgst again (India Compliance's `set_gst_tax_type`): its own before_validate runs
  before ours, and untagged rows leave every line's GST rate / amount at 0 — the printed HSN breakup showed
  "(0.0%) ₹ 0.00" while the total tax was right (SAL-ORD-2026-00218 after its address changed state). A
  document already saved that way is put right by saving it again; `bench --site <site> execute
  erp_dacsinc_custom.gst_tag_check.run` lists them (read-only). Older Quotations carry untagged rows too
  (203 on the local copy, June 2026). An alert says what changed. On the form ERPNext's own Tax Category change re-picks templates too, but only on lines
  that already have one — the save rule covers empty lines.
- **Customer** (validate) and **Address** (on_update → its customers): Out-State for SEZ / Overseas,
  an address outside India, or a billing state (address GSTIN, else customer GSTIN, else address
  state) other than the company's; else In-State. New customers default to In-State (Property
  Setter) and are corrected when their address is saved.
- Reverse Charge / Registered Composition categories are chosen on purpose and never changed;
  returns made against an invoice keep the invoice's category.
- `patches/customer_tax_category.py` corrected existing customers on migrate (dated comment on each;
  list in bench `docs/files/customer_tax_category_fix.xlsx`, with a second sheet of customers whose
  GSTIN state and address state disagree — data to check, not changed).

### Purchases (Purchase Order / Receipt / Invoice, Supplier)

The same rule on the buying side — before this an out-of-state supplier's document kept **Input GST
In-state** (the default template; new Suppliers default to In-State) and India Compliance refused the
bill: *"Cannot charge CGST/SGST for inter-state supplies"*.

- **Drafts** (`before_validate`): Tax Category from the **supplier's state** — the document's supplier
  GSTIN, else its supplier address, else the Supplier master — against the company GSTIN state: same
  state **In-State** (CGST + SGST), another state / SEZ / Overseas **Out-State** (IGST). The Purchase
  Taxes and Charges Template of the other category is swapped for this one (the default one first),
  keeping amounts typed on its non-GST rows (freight, packing…); line GST templates re-picked as on sales.
  A bill made from a receipt therefore comes out right even when the receipt / PO carried the wrong
  template (PR-26-00083, ADARSH SYNTHETICS, Rajasthan: bill → Out-State, IGST).
- **Supplier** (validate) and **Address** (on_update → its suppliers): Out-State for SEZ / Overseas, an
  address abroad, or a GSTIN / address state other than the company's; else In-State.
- `patches/supplier_tax_category.py` corrects existing suppliers on migrate (dated comment on each; on the
  local copy: IP Designs, Tone N Textile).
- Nothing in the app hard-codes a purchase template. Submitted receipts with the wrong template were not
  changed — GST on a receipt is not posted (it is posted by the bill), and no submitted bill was wrong.


## Imported GST text

Items imported with the GST as text (`0.18`, `18`, `GST 18% - IND%`) are not template names; a Taxes
table built from them would not save. `normalize_gst_template` turns them into the template name
(`GST 18% - IND`) first. An item saved before the Exempted rows or the Valid From existed gets them on its next save.

## Prices on save

Saving an item also writes its Standard Selling / Standard Buying / POS price fields into the
matching Item Price records (`sync_all_item_prices`), so a bulk re-save overwrites Item Prices that
were edited directly and differ from the item.
