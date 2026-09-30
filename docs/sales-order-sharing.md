# Sales Order › Lead Owner sharing (`so_share.py`)

A Sales Order is shared with its **Lead Owner** (`custom_lead_owner`, a User):
DocShare **read + write**, not submit, not share. The lead owner can open and edit
the order whatever their role's own Sales Order rights are (e.g. "own records only").

- **When:** Sales Order `on_update` (runs on save and submit) and
  `on_update_after_submit`.
  - `custom_lead_owner` is read-only on the form. It's filled from the Lead, and on
    drafts `custom_script.sales_order_on_update` may set it with `db.set_value`.
  - So the share hook runs after that one and reads the value back from the
    database.
- **Lead owner changes:** the old lead owner's share is removed (unless they own the
  order), and the new one is shared.
- **Never reduced:** a share someone gave by hand with more rights (submit / share)
  keeps them.
- **Skipped:** Administrator, Guest and disabled users.
- **Merchandiser scoping** (`custom_script.get_sales_order_permission_query_conditions`,
  `has_sales_order_permission`, `_visible_sales_order_clause`, the SO-linked
  documents) also admits orders where the user is the lead owner. Otherwise the
  scoping hook would deny what the share allows.
- **Existing orders:** patch `share_so_with_lead_owner` shares every Sales Order that
  has a lead owner, once.

Quotations have their own older rule (`custom_script.after_insert_quotation` /
`on_update_quotation`: read + write + share; the old owner keeps read).
