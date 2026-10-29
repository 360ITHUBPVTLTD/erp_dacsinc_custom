# List filters and search

Filter boxes on the lists of the important doctypes, one "Search everything" box on the Customer / Supplier lists,
what a Customer / Supplier link field searches when one is picked on a document, and search by parts of words.

## Parts of words ("mo ra" finds "Mohan Madhan Raj")

Frappe matches what is typed as one piece. Here, wherever something is searched, the words (2+ letters each) are
matched as parts:

- **Every Link field, every doctype** (`search_words.py`, over `frappe.desk.search.search_link` / `search_widget`
  through `hooks.override_whitelisted_methods`): the words in order with anything between (`%mo%ra%`); with 2–3 words
  the other orders are tried when the first gives too few, so "ra mo" works too. Custom queries (ERPNext's
  customer / item queries) get the same `mo%ra`. One word: as before.
- **Every list's filter boxes** that match *contains* (ID, name, title, mobile, bill no…; `public/js/list_words.js`
  patches Frappe's filter area once): spaces become "anything between", in order.
- **Customer / supplier searches** (Search everything, the payment prompt, Group Outstanding —
  `bulk_payment._search_parties`): each word must match some field, any order — "far uni" finds the UNITED
  FOODBRANDS Faridabad branches, "el 3167" finds DAC-CID-3167. Group names: every word must be in the name.

Re-check `search_words.py` after a Frappe update that changes `search_widget`'s arguments.

## Filter boxes (the row under the list title)

`patches/list_filters.py` ticks *In Standard Filter* (Property Setters — ERPNext's own files are not changed) on:

| Doctype | Added |
|---|---|
| Customer | GSTIN, Mobile No, Merchant Exporter, Merchandiser User, Disabled |
| Supplier | GSTIN, Mobile No, Disabled |
| Item | Item Name, HSN code, Tax Rate (`custom_tax_rate`), Is Stock Item, Disabled |
| Sales Order | Status, Delivery Date, Customer Group |
| Quotation | Status, Lead Owner (`custom_lead_owner`) |
| Sales Invoice | Posting Date, Payment Due Date, Is Return, Customer Group |
| Delivery Note | Posting Date, LR No, Transporter |
| Purchase Order | Date, Required By |
| Purchase Invoice | Supplier Invoice No (`bill_no`), Posting Date |
| Payment Entry | Mode of Payment, Cheque / Reference No, Posting Date |

Text fields (mobile, LR no, bill no, cheque no) match *contains*; a GSTIN box (an Autocomplete field) matches the
whole GSTIN — for part of one use Search everything. Purchase Order has no Supplier Group field, so no such filter.
To add one: append it to `FILTERS` and run the patch again (it only adds what is missing).

## Search everything (Customer / Supplier lists)

`public/js/party_list_search.js` (wired by `customer_list.js` / `supplier_list.js`) puts one box first in the filter
row. What is typed is matched on ID, name, mobile, email, GSTIN, Customer / Supplier Group, any of their addresses
(lines, city, pincode, phone) and the phones on their contacts — `party_list_search.search`, the same search as the
payment prompt (`bulk_payment._search_parties`). The list is filtered to the matches (*ID in …*, at most 500) with
any other filter; nothing found shows an empty list; clearing the box removes the filter.

It is a plain input, not a page field: Frappe sends every page field to the list as a column filter.

## Picking a customer / supplier on a document

Search Fields (Property Setter, same patch): Customer — name, mobile, GSTIN, group, territory; Supplier — name, mobile,
GSTIN, group. So typing a mobile or GSTIN in a Customer / Supplier field finds them (mobile as stored on the party).
