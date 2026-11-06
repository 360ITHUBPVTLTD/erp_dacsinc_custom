# Merchandiser User: subcontract POs only

A Merchandiser User (not also Administrator / System Manager / Admin / Super Admin)
works only with **subcontracted** Purchase Orders (`is_subcontracted = 1`). Normal
purchase POs are the Purchase team's.

- **Seeing:** the Purchase Order list, forms and Order Flow › Purchase Flow
  (`get_purchase_flow`, when `is_scoped_to_own_customers("purchase")`) show only
  subcontracted POs of the orders they may see.
- **Creating / saving:** Purchase Order `validate` (`custom_script.
  guard_merchandiser_plain_po`) refuses a PO that isn't subcontracted: "As a
  Merchandiser you can create only Subcontract POs…".
- **Sales Order form:** for a non-subcontract item the buy button is replaced by the
  note "Purchase team to order" (`public/js/sales_order.js`,
  `so_is_scoped_merchandiser`). Subcontract PO creation is unchanged.
- **Stock Entry:** only jobber transfers (Send to Subcontractor) of their own orders
  (`get_stock_entry_merchandiser_conditions` / `has_stock_entry_merchandiser_permission`).
  The Stock Entry list has no **Add Stock Entry** button for them (`public/js/stock_entry_list.js`, same
  merchandiser test as `so_is_scoped_merchandiser`): they make transfers from the Subcontracting Order /
  Order Flow. Administrator / System Manager / Super Admin / Admin keep it.
  On the Stock Entry form the **Stock Entry Type** list is by role (`stock_entry_types.py`, display only;
  an entry already made with another type opens as before): `ROLE_TYPES` keeps a Merchandiser User to Send to
  Subcontractor, Material Transfer and Repack (jobber, Uniform tab). Anyone who also holds another role that may
  create / edit Stock Entries (Production Manager, Admin, Stock Manager, warehouse, POS…) gets every type — the
  broader role wins; several restricted roles add up. Administrator always gets every type.

Which orders are "theirs" is the Sales Order scoping in `docs/sales-order-sharing.md`:
their customers, customers with no merchandiser, orders they own or are Lead Owner of.

## No invoice money

A Merchandiser User cannot read Sales / Purchase Invoices or Payment Entries. They still see
**that** an order is invoiced — the invoice number, Billed / To Bill / % billed, the stage,
"Needs Invoice" — but never an invoice's amount, outstanding, due date or payment status
(Paid / Unpaid / Overdue / Partly Paid). The rule is keyed on Sales Invoice (Purchase Invoice)
read access, not on the role name, so any role without that access gets the same
(`invoice_money.py`):

- **Sales Order › Related Sales Invoices** (`custom_script.get_linked_sales_invoices`): number,
  customer, date and status only; a payment status reads "Submitted". No Total column.
- **Sales Order form:** Advance Paid and the Payment Terms section (template and schedule)
  are hidden (`sales_order.js` refresh). "% Amount Billed" stays.
- **Customer / Supplier form:** ERPNext's "Billing this year / Total Unpaid" dashboard is
  emptied (`hide_party_dashboard_money`, Customer / Supplier `onload` hook). The Account
  Summary box was already Accounts-only (`party_balance.can_see_balances`).
- **Order Flow notifications** (`order_flow_api.get_activity`): an invoice's payment status is
  sent as "Submitted", so the feed says "Sales Invoice … submitted" instead of
  "fully paid / part-paid / OVERDUE / payment due".

Left as they are: the Sales Order and Subcontract PO amounts (documents they can open), and
the finance reports, which already refuse them (no report access on Sales Invoice /
Purchase Invoice / GL Entry).
