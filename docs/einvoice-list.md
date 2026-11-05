# Sales Invoice list: e-Invoice / e-Way Bill

The Sales Invoice list shows, per invoice, whether the e-Invoice and e-Way Bill were made, and can be filtered on
them and on date ranges. Finance › Receivables on Order Flow shows the same (docs/order-flow-dashboard.md ›
e-Invoice / e-Way Bill on Receivables).

## Columns and filter boxes

`einvoice_list.create_fields` (after_migrate, idempotent; nothing on a site without India Compliance's fields):

- **Columns** (In List View, and appended to List View Settings when it lists fields — a column needs both):
  e-Invoice Status, e-Invoice Ack No, e-Invoice Ack Date, e-Way Bill No. (`ewaybill`).
- **Filter boxes** (In Standard Filter): e-Invoice Status, e-Waybill Status, e-Invoice Ack No.
- How many columns show depends on screen width unless List View Settings sets *total fields* (Frappe).

## Ack No / Ack Date on the invoice

India Compliance keeps the acknowledgement only in its **e-Invoice Log**. Two read-only Sales Invoice fields,
`custom_einvoice_ack_no` (Data) and `custom_einvoice_ack_date` (Datetime), after IRN, hold a copy:
`doc_events › e-Invoice Log › on_update` (`on_einvoice_log_update`) sets them on the referenced invoice
(`update_modified=False`). Generation through the API and "Mark as Generated" both save that log, so both
fill them. `backfill()` (run by `create_fields`) fills invoices whose e-Invoice was made earlier.

## Date ranges

A list's own Date box matches one day. `public/js/einvoice_list_filters.js` adds two from–to boxes under the
filter bar — **Invoice Date** (`posting_date`) and **e-Invoice Ack Date** — each sets a standard
`between` filter (it shows in Filters and can be removed there; the box clears with it). They are standalone
controls (`frappe.ui.form.make_control`), not page fields: the list turns every page field into a filter of
the same name. ERPNext's / India Compliance's list settings and the All · Normal · Returns buttons are kept
(each wraps the previous `onload` / `refresh`).
