# Master data protection: Customer, Supplier, Item Price

Customer, Supplier and Item Price records (names, contacts, GST, prices) must not
leak out of the system. Five layers handle this, all applied with the access sheet
(`access_sync.is_active`).

## 1. Who views them: the sheet (`/roles-and-permissions`)

The sheet's Customer / Supplier / Item Price rows decide who views them, as for any
document. A role with no V on the row is pick-only (2). Today (doc sheet v35, the
cells as agreed), that is e.g. Merchandiser User and Logistics on Supplier.

## 2. Pick only (`master_guard.py`)

A role without View that edits a document linking the master (Sales Order → Customer,
Purchase Order → Supplier) still gets Read on it, a linked-document right
(`access_sync.compute_doc_access`), because Frappe needs Read to fetch the master's
fields into the form. Such a user is **pick-only**:

- Link search and fetch work, but search returns at most 20 rows per call
  (`before_request`).
- List view, report view, counts, `frappe.client.get_list` and REST listing return
  nothing (`permission_query_conditions` → `1=0` only for those listing commands).
- Opening the record (form `getdoc`, `frappe.client.get`, REST read) is refused
  (`has_permission`).
- Global search (`frappe.utils.global_search.search`, overridden) drops master
  records the user may not open. This applies to every user, so a scoped
  Merchandiser only finds their own customers.

Pick-only = not an admin, no role with V on that sheet row, and no other non-sheet
role reading the doctype.

## 3. No taking lists out (`access_sync._master_flags`, `strip_master_list_out`)

On these three masters the sheet's V gives **Read + Select only**. Print, Email,
Report and Export (V_LIST_OUT) stay with `EXPORT_ROLES` (Accounts Executive, Accounts
Manager). Non-sheet roles lose them too, except `MASTER_LIST_OUT_KEEP` (Administrator,
System Manager, Admin, Super Admin, Sales / Purchase Master Manager, Accounts User).
The non-sheet removal is one-way.

## 4. Reports (`MASTER_REPORTS`, `master_report_roles`)

Reports listing master records or prices run only for roles with Report on that
master: Item Prices, Item-wise Price List Rate, Item Price Stock, Customer-wise Item
Price, Address(es) And Contacts, Customer Credit Balance, Inactive Customers, IRS 1099,
Supplier Quotation Comparison, and every non-Report-Builder report whose ref_doctype is
one of the three.
- They are removed from the other sheet roles, and from the standard roles in
  `MASTER_REPORT_DROP_STD` (Sales / Stock / Purchase / Maintenance / Manufacturing /
  POS User, Item Manager), whatever the report's own role list says.
- Managers' and admins' standard roles keep them.

## 5. Merchandiser User: their customers (`custom_script.get_customer_permission_query_conditions` / `has_customer_permission`)

They see customers that are:
- assigned to them, or not assigned yet;
- created by them;
- customers of orders they raised or are Lead Owner of.

This is the same rule as their Sales Orders. Another merchandiser's customer is
refused.

## Left to user clean-up

Users who still hold old standard roles directly (Sales User, Executive, Marketing
Team, Production Team, Purchase Team, Stock User…) keep Read on Customer / Supplier
through those roles. That is 35 users for Customer and 24 for Supplier (as of
2026-10-01). Such users are not pick-only, but they can't print, export or run the
master reports. Moving them onto sheet roles only closes it.

## Live

The sheet travels in `access/agreed_access.json`. `RULES_VERSION` was bumped,
so the next migrate re-applies the sheet, the report rules and the non-sheet strip.
