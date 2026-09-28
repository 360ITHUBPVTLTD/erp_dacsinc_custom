# POS store scope (`pos_scope.py`)

Record-level scoping for the two POS roles, on top of their access-sheet rights
(the sheet decides *what* they may do; this decides *which records*). It works only
once the access sheet is switched on (`access_sync.is_active()`). Filling POS Store
works either way.

- **Store** = a POS Profile. A user's stores = the POS Profiles that list them under
  *Applicable for Users* (POS Profile User).
- **Scoped users**: holders of POS Admin and/or POS Store Manager with **no other
  access-sheet role**. A user who also has e.g. DAC CRM keeps the normal view.
  Admins (Administrator, System Manager, Admin, Super Admin) are never scoped.

| | POS Admin | POS Store Manager |
|---|---|---|
| POS Invoice / Opening / Closing Entry | all stores | their stores (`pos_profile`) |
| POS Profile | all | their stores |
| Customer | only POS customers (POS Store set) | their stores' customers + ones they created |

Wiring:

- `permission_query_conditions` filter the lists and `has_permission` guards opening a
  record by URL, for Customer, POS Invoice, POS Opening Entry, POS Closing Entry and
  POS Profile (hooks.py).
- The hooks return nothing for unscoped users, and Frappe's has_permission hooks
  can only deny, so they never grant anything.

## Customer › POS Store (`custom_pos_store`)

Exported in `custom/customer.json`. It is filled automatically:

- **New customer** created by a scoped POS user → that user's first store
  (Customer `before_insert`).
- **First POS Invoice** of a customer with no store → that invoice's store
  (POS Invoice `on_update`).
- **Back-fill** (`backfill()`, once, patch `setup_pos_store_scope`):
  - each store's default (walk-in) customer;
  - customers on existing POS Invoices;
  - customers created by scoped POS users.

  Admin-created customers are excluded: Administrator and Admin users are listed on
  some stores but are not POS staff. Without that rule, a first back-fill once gave
  2,538 imported customers to one store.

A customer's store can be changed by hand on the Customer form.
