# Overall discount that skips chosen items

On Quotation, Sales Order, Delivery Note, Sales Invoice and POS Invoice, the
**Additional Discount** (Discount % or Discount Amount) is not applied to an item ticked
**Item › Exclude from Overall Discount**. Typical items: Freight and Forwarding Charges,
Packing Charges. Such an item keeps its full amount and its full GST.

ERPNext's standard behaviour spreads the overall discount over every row in proportion
to its amount (`taxes_and_totals.apply_discount_amount`). This changes it so that:

- **Discount % is calculated on the other rows only.** "Apply Additional Discount On"
  decides the base:
  - *Net Total*: the net total less the excluded rows.
  - *Grand Total*: the grand total less the excluded rows and the percentage GST on them,
    at their own rates. For example, with goods of 3,500 at 5% and freight of 200 at 18%,
    10% on Grand Total gives 367.50, which is 10% of 3,675.
- **The discount amount is spread over the other rows only.** For an excluded row,
  `distributed_discount_amount` is 0 and `net_amount` is unchanged. The rounding
  difference always goes on a discounted row.
- Nothing changes when no row is ticked. Nothing changes for "Is Cash or Non Trade
  Discount" either, because that discount is not spread over rows.
- If every row is excluded, the server refuses the discount with "needs at least one
  item that is not excluded".

## How

- **Fields** (`overall_discount.create_fields`, run on `after_migrate`):
  - `custom_exclude_from_overall_discount` (Check) on **Item**, in the Sales Details
    section.
  - The same fieldname on **Quotation Item**, **Sales Order Item**, **Delivery Note
    Item**, **Sales Invoice Item** and **POS Invoice Item**, read-only and filled from
    the Item (`fetch_from`). Because the fieldname is the same, the tick travels with the
    row from Quotation to Sales Order to Delivery Note / Sales Invoice.
- **Server**: `overall_discount.patch()`, called from the app's `__init__.py`, wraps
  `calculate_taxes_and_totals.set_discount_amount` and `apply_discount_amount`. If the
  patch fails to load, discounts fall back to ERPNext's standard spread, freight included.
  The failure is written to `logs/erp_dacsinc_custom.log`, and `test_patch_is_active`
  fails.
- **Form**: `public/js/overall_discount.js` (in `app_include_js`) wraps the same two
  methods on `erpnext.taxes_and_totals.prototype`, so the form shows the same figures
  before saving. **The Python and the JS must stay in step.**

## Tests — run after every ERPNext update

`apply_discount_amount` is a copy of ERPNext's own body with the excluded rows skipped.
An ERPNext update can therefore change the code underneath it.

- `bench --site <site> execute erp_dacsinc_custom.test_overall_discount.run` covers the
  server side, on all five doctypes. It uses the figures of SINV-26-00053 and builds the
  documents in memory, without saving them. Do **not** use `bench run-tests`: that first
  runs every app's `before_tests`, and India Compliance's creates three "_Test ..."
  companies in the site.
- `node scripts/test_overall_discount_js.js` checks that the form script gives the same
  figures.

If either test fails after an update, compare `apply_discount_amount` /
`set_discount_amount` in `erpnext/controllers/taxes_and_totals.py` and `.js` with the
copies here.

## Notes

- The flag is read from the **row**. Ticking or unticking it on the Item affects new rows
  only. Existing draft rows keep the value they fetched.
- Item-level discounts (Discount % on the row) and Pricing Rules are unaffected. They
  already apply per row.
