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

Which orders are "theirs" is the Sales Order scoping in `docs/sales-order-sharing.md`:
their customers, customers with no merchandiser, orders they own or are Lead Owner of.
