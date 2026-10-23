# Fetch Pending to Bill (a Sales Invoice opened directly)

A new Sales Invoice opened straight from the desk (not from Order Flow › Pending DN/SI or a
Delivery Note) has a **Fetch Pending to Bill** button (`public/js/invoice_fetch.js`,
`invoice_fetch.py`). ERPNext's own "Get Items From" menu stays hidden (`si_remove_get_items_buttons`).

- Pick the **customer** (filled from the form). Laid out like the dashboard: a customer card (name,
  ID) with tiles — Delivery Notes · Lines to bill · ₹ to bill — then one card per Delivery Note (date,
  Sales Order and Customer PO chips, its lines and ₹ to bill, a tick for the whole DN) with the
  dashboard's blue-header table: item, delivered, billed, returned, **to bill** (green pill), rate,
  amount. A line with no rate shows a red **Rate 0** chip. With one Delivery Note it is ticked at once;
  "Select everything" ticks all; the footer and the button ("Get 3 lines") follow the selection. On a
  phone the tables scroll sideways.
- Only Delivery Notes the user may read (`frappe.get_list`, so the usual scoping applies), of the
  invoice's company, not Closed / Return Issued.
- **To bill** = delivered − billed on ordinary submitted invoices − returned on a Sales Return.
  Credit Notes are **not** netted off the billed qty (ERPNext's own map does): a credit note whose
  goods haven't come back would make the line billable again, so the goods could be invoiced
  twice. Once the Sales Return is made the line stays settled (`docs/returns.md`).
- A line already on a **draft** invoice is shown locked with that draft's link (the draft guard would
  refuse a second one).
- A hint counts the customer's picked orders not delivered yet: they need their Delivery Note first
  (one route only — Sales Order → Pick List → Delivery Note → Sales Invoice).
- **Get Items** builds the invoice with `custom_script.make_sales_invoice_from_dn_items` (ERPNext's
  DN → SI mapping for just those lines, the same as the Sales Order widget's per-line button) and
  opens it in place of the empty one, unsaved. Rates, row locks and caps are those of every other
  route. Ticked lines are billed in full (what is still to bill).
