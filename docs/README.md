# erp_dacsinc_custom — documentation index

Reference docs for this app's custom flows, kept current as those flows
change (see the root `CLAUDE.md` for the update rule). These describe
**current behavior**, not a history of changes.

- **[order-flow-dashboard.md](./order-flow-dashboard.md)** — the Order Flow
  desk page: its tabs, the Verify Customer Details approval dialog, and how
  it shows when stock gets claimed by a different order.
- **[so-rm-po-subcontracting-flow.md](./so-rm-po-subcontracting-flow.md)** —
  the Sales Order → Raw Material → Purchase Order → Subcontracting →
  Receipt chain: the Item Stock & Action Plan widget, the raw-material
  "fetch" dialogs, and the coverage math underneath all of them.

## Where the code actually lives

| Concept | File(s) |
|---|---|
| Order Flow dashboard | `erp_dacsinc_custom/page/order_flow/order_flow.js`, `order_flow_api.py` |
| SO's own workflow-action dialog (a near-duplicate of the dashboard's approval dialog) | `public/js/workflow.js` |
| Item Stock & Action Plan widget (on the Sales Order form) | `public/js/sales_order.js`, `get_item_stock_details_bulk` in `custom_script.py` |
| Purchase Order subcontracting flows (fetch RM, Add Subcontract Item, Create SC) | `public/js/purchase_order.js`, `purchase_order.py` |
| Procurement Fulfillment Planner (Material Request side) | `public/js/material_request.js`, `fetch_multi_order_requirements` in `custom_script.py` |
| Pick List cross-order indication | `public/js/pick_list.js` |
