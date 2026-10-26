# Freight, packing and insurance — as item lines at the goods' GST rate

**Rule (GST):** freight, packing, insurance (incidental charges) billed **on the same invoice as the goods**
are part of the goods' value (CGST Act s.15(2)(c)) and take the **goods' rate** (composite supply, s.8):
5% garments → 5% on their freight. On a purchase, enter them **exactly as printed on the supplier's bill**,
so the taxable value and GST match the supplier's GSTR-1 / your GSTR-2B. A transporter's own bill (GTA)
is a separate Purchase Invoice at its own rate (5% RCM / 12%).

They are therefore **item lines**, not rows in the Taxes table — an "Actual" row in the tax template
carries no GST, so the books would not match the supplier's and the ITC would be short.

## The items (`patches/charge_items.py`, run on migrate)

| Item | SAC | Purchases post to | Sales post to |
|---|---|---|---|
| Freight Charges | 996511 | Transportation Expenses | Freight Charges Recovered (new, Direct Income) |
| Packing Charges | 998540 | Packing Charges | Freight Charges Recovered |
| Insurance Charges | 997136 | Insurance Charges | Freight Charges Recovered |

Non-stock, item group Service, bought and sold, **Exclude from Overall Discount** ticked (an overall
discount never reduces them — `docs/overall-discount.md`), and **Charge item** (`custom_charge_item`,
`custom/item.json`): `custom_script.update_tax_child` then lists **every** GST template (5%, 12%, 18%, 28%,
Exempted) for In-State and Out-State, so a line keeps whichever rate is chosen (ERPNext drops a line
template the item does not list — `docs/item-taxes.md`). The patch only sets up companies that keep the
expense ledgers (not ERPNext's _Test companies), fills only what is missing on a re-run, and puts a dated
comment on every record it creates or changes.

## "Add charges" (`public/js/charges.js`, all desks)

On drafts of Quotation, Sales Order, Delivery Note, Sales Invoice, Purchase Order, Purchase Receipt and
Purchase Invoice: a dialog with Freight / Packing / Insurance amounts (existing charge lines pre-filled)
and **GST rate on these charges**, defaulting to the rate of the goods on the document (the largest by
value; a note when the goods carry different rates). It adds or updates one line per charge — qty 1, the
amount as Price List Rate (Rate is read-only, `docs/rate-read-only.md`), the chosen Item Tax Template and
the SAC; an empty / 0 amount removes the line.

Lines flow like any other: SO → DN → SI and PO → PR → PI mapping, GST and HSN summary, e-invoice.

## Print (Sales Invoice — "Sales invoice Print Format 4", printed through Multi Copy Master)

Charge lines are **not in the item table** and not in **Total Qty**: the table is a Custom HTML copy of the
builder table (same columns / widths) that leaves out items marked Charge item. They print **below**, in
the totals: Gross Total (goods) → Line-wise / Overall Discount → **+ Freight Charges**, **+ Packing
Charges** … → Taxable Value → GST → TOTAL. Their SAC stays in the GST (HSN) summary with its tax.

Two older figures in that block were fixed at the same time: Gross Total and the discounts are now taken
from the goods lines' taxable values (the overall discount stored on the invoice includes tax when it is
applied on the Grand Total, and the line discount is per unit), and the GST lines print the tax **after**
the discount (`tax_amount_after_discount_amount`) — so the printed lines always add up to the TOTAL.
Other prints (Quotation, Sales Order, Delivery Note, Credit / Debit Note) still show the charges as item
rows.

## Posting (tested)

- Sales: goods ₹9,000 + freight ₹500 at 5%, 10% overall discount → discount ₹900 on goods only; freight
  Cr Freight Charges Recovered 500; GST 5% on both.
- Purchase: goods ₹100 at 5% + freight ₹200 at 18% → Dr Transportation Expenses 200, input GST 5 + 36.

The old "Actual" charge rows in the Input / Output GST templates (Insurance, Transportation, Packing,
Freight and Forwarding) are left as they were; use the charge items instead.
