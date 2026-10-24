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
