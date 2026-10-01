# No second draft for the same source (`draft_guard.py`)

Clicking "Create …" again on a source document whose lines are already in a **draft**
would make a second draft that competes for the same qty. `guard_duplicate_draft`
(`before_insert`) refuses the new document instead, and names the existing draft(s)
as links: "A draft X already exists for the same Y line(s): … Open that draft and
finish it (or delete it)". There is no "create anyway".

**Asked up front, too:** every "Create …" preview (Order Flow and the Sales Order
widget, `so_show_mapped_doc_preview`) first calls `find_existing_drafts` with the
mapped draft. When one exists, the user gets the same message in a "Draft already
exists" dialog, with **Open Draft** when it is a single draft, before any new form
opens.

| New document | Checked link on its rows | Source |
|---|---|---|
| Purchase Order | `material_request_item`, `sales_order_item` | Material Request, Sales Order |
| Subcontracting Order | `purchase_order_item` | Purchase Order |
| Purchase Receipt | `purchase_order_item` | Purchase Order |
| Purchase Invoice | `po_detail`, `pr_detail` | Purchase Order, Purchase Receipt |
| Subcontracting Receipt | `subcontracting_order_item` | Subcontracting Order |
| Material Request | `sales_order_item` | Sales Order |
| Delivery Note | `so_detail`, `pick_list_item` | Sales Order, Pick List |
| Sales Invoice | `so_detail`, `dn_detail` | Sales Order, Delivery Note |

- Matching is per source **line** (the child row name), so a draft for other lines
  of the same source doesn't block.
- Only drafts (docstatus 0) block. Submitted documents never do; their qty caps are
  ERPNext's.
- Only new documents are checked. Existing drafts, even old duplicates, can still be
  edited and submitted.
- Skipped during import, patches and migrate, and when `doc.flags.ignore_draft_guard`
  is set (for code that knowingly makes a split draft).
