# Operations Manager

A role for someone who does the merchandiser's work for **every** customer, with no accounts access.
Profile: **Operations Manager (Order Flow)** = Operations Manager + Employee + Employee Self Service
(`access_sync.PROFILE_NAME`). Live already had an unrelated old profile named "Operations Manager"
(many roles, accounts included, no users); it is a different record and is never touched.

## What it gets

| Area | Operations Manager | Merchandiser User (for comparison) |
|---|---|---|
| Sales Orders and what hangs off them (MR, PO, Pick List, DN, SCO, Stock Entry…) | every customer's | own customers / own orders only |
| Documents (access sheet) | same column as Merchandiser User, minus accounting documents | sheet column |
| Purchase Orders | Subcontract POs only (see and raise) | Subcontract POs only |
| Stock Entries | jobber transfers of any Sales Order + own; types Send to Subcontractor / Material Transfer / Repack | same, own orders |
| Order Flow tabs | SO Approvals (all 5 sub-tabs), Sales Tracker, Pick Lists, Job Work, Stock Tracker, Embroidery Transfers — view and act | same |
| Sales Tracker stages Ready for Delivery / Need to Bill | counts shown (no amounts) | same |
| SO approval | **merchandiser step only** (Approve / Reject at Pending Merchandiser Approval) | same |
| Final SO approval | **no** — stays with Sales Order Final Approver / System Manager / Super Admin and the users in Admin Settings › Sales Order Final Approval | no |
| Accounts | no Read on Sales / Purchase Invoice, Payment Entry, Journal Entry; no Finance or Pending DN/SI tab; no accounting / tax reports | — |

Why no own-customer limit: every "own customers only" rule is keyed on the role name *Merchandiser User*
(`is_scoped_merchandiser_for_doctype`, `is_scoped_to_own_customers`). Operations Manager is a different
role, so none of them apply. Don't give one user both roles — Merchandiser User's limit would then apply.

The Subcontract-PO and jobber-transfer limits (`ops_manager.is_limited`) drop when the user also holds a
role that may create / edit that document (Purchase Manager, Production Manager…): the narrow role never
wins over a broader one. Admins are never limited. Forms / lists learn it at boot (`frappe.boot.dacs_ops_limited`)
to hide the "Purchase Order" / "Add Stock Entry" buttons the server would refuse.

## How it is set up on a site — `patches/operations_manager_role.py`

Add-only, copied at run time from **that site's** Merchandiser User (live's access differs from local), and
nothing else is touched: no Admin Settings save, no sheet apply, no `access/agreed_access.json` /
`RULES_VERSION` change, no user's roles.

1. Role (desk, flagged "Access Sheet Role") and its profile, created only if missing. Nobody is assigned.
2. An "Operations Manager" column in the stored Document and Order Flow sheets (copy of Merchandiser User's,
   accounting rows / Finance / Pending DN/SI blank) — so a later sheet save keeps the access instead of wiping it.
3. Custom DocPerm rows copied (all flags, if_owner, permlevel); accounting documents keep Select only (link
   fields still load). Merchandiser User's tracked linked-document grants are tracked for the new role too.
4. Reports and pages Merchandiser User has, minus the Accounts-module and accounting / tax reports
   (`ACCOUNT_REPORTS`).
5. Admin Settings › Order Flow role lists (view and Can Act): a row added wherever Merchandiser User is
   (never Finance / Pending DN/SI).
6. Sales Order Workflow: Merchandiser User's Pending Merchandiser Approval rows copied (Approve, Reject,
   edit). `setup_sales_order_workflow` adds the same on a fresh site.

Running it again changes nothing. After it, the role is an ordinary access-sheet column: change it on
/roles-and-permissions like any other role.
