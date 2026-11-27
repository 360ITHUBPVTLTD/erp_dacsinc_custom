# Quotation from a Lead of an existing customer

A Lead can belong to a customer we already have (Lead › `custom_lead_customer`, ticked
`custom_duplicated_lead` — a new enquiry from an existing client). "Create › Quotation" on such a Lead goes
through `custom_lead.make_quotation_custom` (override of `erpnext.crm.doctype.lead.lead.make_quotation`):

1. ERPNext's standard mapper builds the Quotation **to the Lead** and fills the Lead's contact and address.
2. The Quotation is switched to **Quotation To = Customer**, party = the Lead's customer.
3. The Lead's contact / billing / shipping address are kept **only if they are also linked to that
   customer**; otherwise the customer's default contact (with its email / mobile) and default address are used.

Step 3 is needed because ERPNext refuses to save a Quotation whose contact or address isn't linked to its
customer (`AccountsController.validate_party_address_and_contact`: "Contact Person does not belong to the
DAC-CID-…"). A new Lead for an existing customer usually gets its own new Contact (e.g. "ROHIT-4"), linked to
the Lead only — so carrying it over always failed.

## Keeping the Quotation linked to the Lead (behaves like a normal Lead quotation)

Even though such a Quotation ends up **to Customer**, `make_quotation_custom` still sets `custom_lead_id`
to the originating Lead. The whole Lead/Quotation wiring keys off `custom_lead_id`, not off
`quotation_to`, so without this the duplicate-lead quotation silently lost all of it:

- `custom_script.quotation_on_submit` moves the Lead Enquiry → Pipeline and syncs expected revenue /
  lead owner only when `custom_lead_id` is set.
- `custom_lead.get_quotations_for_lead` (the Lead's quotation HTML field and the "Create Quotation"
  existing-quotation dialog) filters on `custom_lead_id = lead`.

`custom_script.validate_quotation` normally clears `custom_lead_id` whenever Quotation To isn't Lead.
It now has an explicit **Quotation To = Customer with a `custom_lead_id`** branch: it keeps the link
(and syncs `custom_lead_owner` from the Lead) as long as that Lead's `custom_lead_customer` equals the
Quotation's customer — i.e. the duplicate-lead → customer case above. A plain Customer quotation (no
`custom_lead_id`) still gets it cleared. Without this branch the status never advanced and the
quotation never appeared under the duplicate Lead.

A duplicate lead (one carrying `custom_duplicate_lead_id`) also does **not** get the "Convert to
Business Contact" button (`public/js/lead.js`) — the lead it was copied from already owns that contact.

The browser form must not wipe it either. The **"Quotation Form new"** Client Script (a DB record,
not a file) once cleared `custom_lead_id` on the form whenever Quotation To ≠ Lead — which erased it
on every duplicate-lead quotation (they are "to Customer") before the save even reached the server.
That clearing was removed: the client only auto-fills `custom_lead_id` for a Lead quotation; it never
clears it, because `validate_quotation` on the server is the single source of truth. Keep it that way —
don't re-add client-side clearing of `custom_lead_id` on the Quotation form.

## Quotations + Sales Orders across the lead family

A Lead form shows two quotation blocks:

- `custom_quotation_html` — just this lead's quotations (`get_quotations_for_lead`).
- `custom_quotation_so_html` — the **whole family**: the main lead plus every duplicate of it.
  It opens with a **family roster** — "Duplicate Leads Created: N" and every lead tagged **Main** /
  **Duplicate** (with name, category, created date, clickable) — so the user sees how many duplicates
  exist whether the form is opened on the main lead or on a duplicate, and even for leads that have no
  quotation yet. Below the roster is a table of every family quotation with the Sales Order(s) raised
  from it. Backed by `custom_lead.get_family_quotations_with_so` (returns `family_details`,
  `duplicate_count`, and quotation `rows`) and rendered by `public/js/lead.js`
  (`family_quotation_so_html`). The field is created by the `lead_quotation_so_html_field` patch
  (idempotent `create_custom_fields`).

The family is `main = custom_duplicate_lead_id or this-lead`, then `[main] + leads whose
custom_duplicate_lead_id = main` — so it is the same set whether the form is opened on the main lead
or on any duplicate. A quotation's Sales Orders are the docstatus < 2 Sales Orders whose line
`prevdoc_docname` is that quotation (the same link `sync_lead_data` uses to drive the Lead → Order
transition and PO value).
