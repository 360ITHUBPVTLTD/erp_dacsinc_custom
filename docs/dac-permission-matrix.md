# DAC permission matrix (Excel-driven roles/permissions)

Source of truth: `docs/DAC_Permission_Matrix.xlsx`, sheets `Matrix` (the doctype/role
grid), `Roles` (ERP Role <-> business-language "DAC Role" crosswalk), and `Employees`
(one row per person: DAC Role, ERP Role, name, ID, **User ID** (email), status, branch,
designation).

This reconciles that spreadsheet against everything already on this site — three
existing patches (`apply_role_permission_matrix.py`, `apply_stage_role_matrix.py`,
`create_order_flow_roles.py`), the `role_permission_matrix.py` data module, and **30
Role Profiles / dozens of roles already created by hand outside of any patch**
(`DAC Sales User`, `Accounts`, `Purchase executive`, `Front Desk`, etc.). The rule
throughout: reuse whatever role/profile is already live and actually in use (checked
against `Has Role` counts on the live DB, not guessed from spreadsheet text); only
create what genuinely doesn't exist.

## Where the logic lives

- `erp_dacsinc_custom/dac_permission_matrix.py` — the data: `DOCTYPE_ACCESS`,
  `REPORT_ACCESS`, `NEW_ROLES`, `NEW_ROLE_PROFILES`, `EMPLOYEE_ROLE_PROFILE_TARGETS`.
  Edit THIS file when the business updates the spreadsheet — see "Re-running this"
  below.
- `erp_dacsinc_custom/patches/apply_dac_permission_matrix.py` — the idempotent,
  additive-only runner (re-reads the data module on every `bench migrate`, same
  philosophy as the other three patches). Creates the 2 new roles (`Logistics`,
  `Online`) and 3 new Role Profiles (`Logistics`, `Online`, `POS Store Manager`),
  applies every Custom DocPerm grant, and adds roles to each Report's `roles` child
  table. Never removes an existing grant.
- `erp_dacsinc_custom/roles_and_permissions_api.py` —
  `get_dac_matrix_assignment_preview()` / `apply_dac_matrix_assignments()`: the
  admin-only API behind the "DAC Matrix" action described below. Reuses the existing
  `update_user_role_profiles()` -> `User Access Profile` -> `sync_user_access_profile()`
  path, so a role held for any other reason is never touched. **Additive at the
  profile level too**: it only ever ADDS the matrix's proposed Role Profile to a
  user's existing profile(s) — a user who already has, say, `Merchandiser` plus
  something else for a second responsibility keeps both; the matrix's profile is
  appended, never used to replace what's already there.
- `erp_dacsinc_custom/erp_dacsinc_custom/page/roles_and_permissions/` — the "DAC
  Matrix" menu item on the existing "Roles & Permissions" desk page. Shows
  current-vs-proposed Role Profile per employee, and requires an explicit
  `frappe.confirm()` naming every user and their new profile before calling the API.
  **Nothing about a real user's access ever changes from a `bench migrate` alone** —
  only this action, only after that confirmation.

## Column -> Role mapping

| Matrix column | Role | Role Profile assigned to employees |
|---|---|---|
| Sales Executive | `DAC CRM` | `DAC Sales User` |
| Sales Manager | `DAC CRM Head` | `DAC CRM HEAD` |
| Merchandiser | `Merchandiser User` | `Merchandiser` |
| Packing Executive / Junior Merchandiser | `Junior Merchandiser` | `Junior Merchandiser` |
| Admin (Anuj) | `Admin` | `Admin` |
| Inward Executive | `Inward Team` | `Inward Team` |
| Asst Store Manager / POS Executive | `POS User` | `POS User` |
| Operations Store Manager (POS Admin) | `POS Admin` | `POS Manager` |
| Store Manager / POS Manager | `POS Store Manager` (new) | `POS Manager` or `POS Store Manager`, per employee — see below |
| Production Manager | `Production Manager` | `Production Manager` |
| Production Assistant | `Production Assistant` | `Production Assistant` |
| Accounts \| Executive | `Accounts Executive` | `Accounts Executive` |
| Accounts \| Manager | `Accounts Manager` | `Accounts` |
| Finance | `Finance Executive` | `Accounts Executive` / `Finance Collection Executive`, per employee |
| Online | `Online` (new) | `Online` (new) |
| Purchase Manager | `Purchase Manager` | `Purchase Manager` |
| Purchase Assistant | `Purchase Executive` | `Purchase executive` |
| Logistics | `Logistics` (new) | `Logistics` (new) |
| HR Manager | `HR Manager` | `HR` |

"Store Manager / POS Manager" is the one split case: the sheet gives that column and
"Operations Store Manager (POS Admin)" nearly identical permission values throughout,
so its grants go entirely to the new `POS Store Manager` role rather than being
re-applied to `POS Admin` (already fully covered via the other column). Per-employee,
which of the two profiles a "Store Manager" actually gets depends on their own ERP Role
value in the Employees sheet ("POS Manager" -> broad tier, same as Operations Store
Manager; "POS Store Manager" -> the narrower tier).

## Vocabulary (sheet text -> Custom DocPerm field)

See the module docstring in `dac_permission_matrix.py` for the full table — the short
version: View/View Own/View All -> `read` (+`if_owner` for "Own"; "View Reporting Team"
collapses into plain `read`, see below), Select -> `select`, Create -> `create`,
Draft/Edit/Update -> `write`, Submit/Cancel/Amend/Delete/Print/Export -> the matching
field, Approve/Reject/POD Updation -> `write` (no dedicated flag), NA/blank -> nothing.

**Known simplification**: the sheet distinguishes "View Own", "View Reporting Team",
and "View All". Frappe has no built-in manager-hierarchy ("my reports' records only")
permission scope — only owner-restricted (`if_owner`) or full. "View Reporting Team"
rows are therefore treated as "View All" (full company-wide read) for now, same as
every other role on this site already behaves except `POS User`'s owner-restricted
rows and Merchandiser User's own-customer scoping (below). Building real
manager-hierarchy scoping would be a separate, standalone piece of work.

**Merchandiser User's existing restriction is untouched.** `custom_script.py` already
has `get_sales_order_permission_query_conditions` / `has_sales_order_permission` /
`get_customer_permission_query_conditions` / `has_customer_permission`, which scope a
Merchandiser to only their own customers' Sales Orders/Customers via
`Customer.custom_merchandiser_user`. This module only fills gaps that role was
otherwise missing (Supplier read, tax/payment templates, BOM view, etc.) — it never
touches those four functions.

## Re-running this when the business updates the spreadsheet

1. Re-export/read the updated `docs/DAC_Permission_Matrix.xlsx`.
2. Update `DOCTYPE_ACCESS` / `REPORT_ACCESS` / `EMPLOYEE_ROLE_PROFILE_TARGETS` in
   `dac_permission_matrix.py` to match — the module docstring documents the exact
   vocabulary and column mapping used, so a re-transcription stays consistent.
3. Run `bench migrate` (or directly `bench execute
   erp_dacsinc_custom.patches.apply_dac_permission_matrix.execute`) to apply any new
   Custom DocPerm grants / new roles / new Role Profiles. Additive only — safe to
   re-run any number of times.
4. Open the "Roles & Permissions" desk page and use the "DAC Matrix" action to
   reconcile any employees whose target profile changed — this step is manual and
   confirmed by design, never automatic, and only ever adds a profile, never removes
   one a person already has.
