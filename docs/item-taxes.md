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

Without a slab: In-State and Out-State rows with the GST rate, then In-State and Out-State
`Exempted - IND` rows, none with a range.
Every row has **Valid From 2023-01-01** (`TAX_VALID_FROM`). `Non-GST - IND` items get no rows. An item whose GST rate
is itself `Exempted - IND` (e.g. Khadi, an exempt supply) gets just its In-State / Out-State rows — the
extra Exempted rows would repeat the template, which the Item form refuses.

## A line sold without GST

On the Quotation / Sales Order / Invoice the line still fills in the GST template by itself. For a line
that is sold without GST, change that line's **Item Tax Template** to **Exempted - IND** (0%). Other
lines keep their GST, so one document can mix taxed and Exempted lines. The Tax Category of the
document stays In-State / Out-State.

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
  2023 gets no item template.
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
  header GST template of the other category is swapped for the matching one. An alert says what
  changed. On the form ERPNext's own Tax Category change re-picks templates too, but only on lines
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

## Imported GST text

Items imported with the GST as text (`0.18`, `18`, `GST 18% - IND%`) are not template names; a Taxes
table built from them would not save. `normalize_gst_template` turns them into the template name
(`GST 18% - IND`) first. An item saved before the Exempted rows or the Valid From existed gets them on its next save.

## Prices on save

Saving an item also writes its Standard Selling / Standard Buying / POS price fields into the
matching Item Price records (`sync_all_item_prices`), so a bulk re-save overwrites Item Prices that
were edited directly and differ from the item.
