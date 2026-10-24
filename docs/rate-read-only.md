# Rate is read-only on Quotation, Sales Order, Sales Invoice, Purchase Order, Purchase Invoice

Users never type the item **Rate**. They change the **Price List Rate** and the
**discount** (Discount % / Discount Amount, or Margin), and ERPNext works out
the Rate from those (`transaction.js` → `price_list_rate` → `apply_pricing_rule_on_item`).
This keeps one way to set a price on every screen. With Rate also editable, a
row could show a Price List Rate and discount that don't add up to the Rate.

## How

- **Property Setters** (shipped in `erp_dacsinc_custom/custom/<doctype>_item.json`,
  synced on migrate) on Quotation Item, Sales Order Item, Sales Invoice Item, Purchase Order Item
  and Purchase Invoice Item:
  - `rate` → `read_only = 1`
  - `price_list_rate` → `read_only = 0`. ERPNext ships it read-only on the selling
    side and opens it only when Selling Settings › *Allow User to Edit Price List
    Rate in Transactions* is ticked. The Property Setter opens it whatever that
    setting says.
- `public/js/sales_invoice.js`: `rate` is **not** in `SI_LOCKED_FIELDS`. That list is
  toggled editable on rows not linked to an SO / DN, which would make Rate editable again.
  Linked rows still lock `price_list_rate`, the discounts, qty, etc.
- `public/js/purchase_invoice.js` (`setup`): ERPNext's own Purchase Invoice refresh
  re-opens Rate on rows without a Purchase Receipt when Buying Settings › *Maintain
  Same Rate* is on (`update_docfield_property("rate", "read_only", …)`). The grid's
  `update_docfield_property` is wrapped so `rate` / `read_only` always stays 1.

## What it does not cover

- It is a form rule only. Code still sets Rate: the mapping (SO → PO / DN / SI, PR → PI),
  Pricing Rules, this app's dialogs (`frappe.model.set_value`) and the API / mobile app.
  On DN / SI the server already forces a row linked to a Sales Order back to the order's
  rate (`custom_script.lock_item_rate_to_sales_order`, see `order-flow-dashboard.md`).
- The **Update Items** dialog on a submitted SO / PO (ERPNext's `update_child_qty_rate`)
  still has its own Rate column.
- Delivery Note, Purchase Receipt, POS Invoice and Supplier Quotation are unchanged.

## Drafts made before Rate was read-only

Typing the Rate made ERPNext show the difference from the Price List Rate as a line discount (Rate
below) or a margin (Rate above, e.g. Price List 10, Rate 375 → margin 365).
`patches/quotation_rate_as_price_list.py` corrected the draft Quotations on migrate: Price List Rate =
Rate, discount and margin 0, Rate and totals unchanged, a dated comment on each (list in bench
`docs/files/quotation_discount_fix.xlsx`). Lines at Rate 0, header (additional) discounts and
submitted Quotations were left as they are.
