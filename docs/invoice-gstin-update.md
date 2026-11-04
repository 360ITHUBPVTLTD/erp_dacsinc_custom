# Customer GSTIN given after the Sales Invoice was submitted

`invoice_gstin.py` + `public/js/sales_invoice.js › dacs_gstin_update_button`.

A customer is billed as Unregistered (or with an old address) and gives their GSTIN afterwards. ERPNext doesn't let a
submitted invoice's party address / GSTIN change, and cancelling a correct bill just to add the GSTIN costs a cancelled
number and a new one.

## When it is allowed

**Update Customer GSTIN** button on a submitted Sales Invoice. Only **Accounts Manager** and **Admin** see it.

Allowed only when the update changes nothing but the GST details:

- the new GSTIN is of the invoice's **place of supply** (same state), so the tax stays CGST + SGST at the same rate;
- its GST Category is Registered Regular / Registered Composition, not SEZ or Overseas, whose tax is different;
- no e-Invoice (IRN) or e-Way Bill is made yet, because they carry the old details;
- it is not a credit note or a POS invoice;
- the month's GSTR-1 isn't filed (GST Return Log), and the accounts aren't frozen up to the invoice date;
- the address is one of the customer's own GST addresses.

Otherwise (another state → IGST, or e-Invoice already made, or GSTR-1 filed), the standard way stands: a credit note
plus a new invoice.

## What it does

1. The user picks the customer's GST address.
2. A Before / After confirmation shows the GSTIN, GST Category, address, place of supply and Grand Total (unchanged).
3. The update sets on the invoice: Customer Address, Address display, Billing Address GSTIN and GST Category.
4. It also sets e-Invoice / e-Way Bill status the way India Compliance would have at submit with these details:
   e-Invoice becomes **Pending** for a B2B invoice when e-Invoicing is on.
5. The change is recorded in the invoice's Version history and in a dated comment.

The taxes, totals, GL / payment ledger entries and items are untouched. In GSTR-1 the invoice moves from B2C to B2B.
After the update, **generate the e-Invoice** (the result alert says so).
