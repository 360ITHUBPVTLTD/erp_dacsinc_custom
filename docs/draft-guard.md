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

**Returns are compared with returns only.** A Credit Note, Sales / Purchase Return or Debit Note
keeps the source links of what it reverses (so_detail, dn_detail, po_detail …). `existing_drafts`
matches drafts with the same `is_return` as the new document, so a draft Credit Note never blocks
the next invoice for that order line (nor the reverse), while a second draft return of the same
line is still refused. See `docs/returns.md`.

## Purchase Order lines from a Material Request (`purchase_order.guard_po_against_mr`)

Runs on every save and on submit of a Purchase Order (validate), so an old draft can't be kept or
submitted either:

1. **Not more than the MR line has open.** What submitted POs (other than this one) already ordered,
   plus this PO's lines, may not exceed the MR line's qty plus the over-receipt allowance (the same
   limit ERPNext checks at submit). A line **already fully ordered** by submitted POs, or on a stopped /
   cancelled MR, has **nothing** left — the allowance is for receiving a little more, not for ordering
   the line twice. The error names each row, its MR and the PO(s) that ordered it (links).
2. **Not on another draft.** A row added to an existing draft (Get Items From › Material Request) whose
   MR line is already on another draft PO is refused; a new PO is refused by `guard_duplicate_draft`.

The form shows the same lines up front (`check_po_against_mr` → red rows and a box above the items, with
the MR and ordering PO as links) and **Correct quantities** reduces each line to what it may keep, or
removes it. The items grid shows each line's **Material Request** (a link) in place of the Description
column (`po_show_mr_column`; a user's own grid column choice still wins).

**Fetch prompts agree with it.** The PO form's Material Request fetch (`get_mr_suggestions_for_po`) offers
an MR line only up to its qty less every draft and submitted PO row; a line on **another** draft PO is not
offered at all ("On draft PUR-ORD-…", checkbox disabled). "Create Purchase Order" from an MR maps only the
qty not yet ordered (ERPNext), and the Create preview names an existing draft first (above).

Typical case: a draft made while the MR was open, then another PO ordered and received the same MR — the
draft can no longer be saved until those lines are removed.

