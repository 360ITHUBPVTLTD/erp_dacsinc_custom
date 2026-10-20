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
`Exempted - IND` rows, none with a range. `Non-GST - IND` items get no rows. An item whose GST rate
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
- The Item form allows a template only once per Tax Category: one Exempted row each for In-State and
  Out-State.

## Imported GST text

Items imported with the GST as text (`0.18`, `18`, `GST 18% - IND%`) are not template names; a Taxes
table built from them would not save. `normalize_gst_template` turns them into the template name
(`GST 18% - IND`) first. An item saved before the Exempted rows existed gets them on its next save.

## Prices on save

Saving an item also writes its Standard Selling / Standard Buying / POS price fields into the
matching Item Price records (`sync_all_item_prices`), so a bulk re-save overwrites Item Prices that
were edited directly and differ from the item.
