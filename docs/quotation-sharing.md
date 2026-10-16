# Quotations shared with DAC CRM users

The marketing team creates a quotation and shares it with a DAC CRM user, who checks and submits
it. DAC CRM's Quotation permission is "only if creator", so without the share they cannot even
see someone else's quotation.

- **Share = can submit** (`quotation_sharing.grant_submit_on_quotation_share`, DocShare
  after_insert / on_update): sharing a Quotation (Read) with a user who has the **DAC CRM** role
  always grants Read, Write and **Submit**, whether or not "Can Submit" was ticked. Shares with
  other users stay exactly as given.
- **Existing shares** got the same on migrate (`patches/quotation_share_submit.py`: draft
  quotations already shared with DAC CRM users).
- **Lead update on submit**: submitting moves the quotation's Lead from Enquiry to Pipeline
  (`custom_script.quotation_on_submit`). Lead has a workflow, and Frappe's workflow check reads the
  Lead's saved copy with the submitter's rights — a DAC CRM user who can't read the marketing
  team's Lead was refused the whole submit. That save is flagged `system_update`, and
  `custom_lead.validate_lead` lets the saved copy through for that one save. The Lead's status
  history still records the real user (`changed_by`), and the user gets no access to the Lead.
- Sharing itself: the app already lets any sharer tick Read / Write / Submit
  (`__init__.patch_docshare`).
