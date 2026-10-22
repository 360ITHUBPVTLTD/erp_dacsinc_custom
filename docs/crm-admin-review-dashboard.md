# CRM Dashboard — Admin Review: Draft Pipeline, Visits & Follow-ups, unique counts

The Admin Review CRM dashboard is a **Custom HTML Block** stored in the database, not a
file in this repo. The **CRM Dashboard** workspace shows `CRM Dashboard Admin Review 2`,
the version described here. The older `CRM Dashboard Admin Review` is kept unchanged as
a fallback: to switch back, point the workspace's custom block (its Custom Blocks row
and the block entry in its `content`) back to it. The block's data comes from
whitelisted methods in `custom_lead.py`, shared by every copy of the block, so add new
fields and parameters to them and don't change what the existing ones return.

The workspace JSON exported in this repo (`workspace/crm_dashboard/crm_dashboard.json`,
dated Aug 2026) is older than the database and doesn't list either Admin Review block.
Saving the workspace in developer mode overwrites it with the current database state.

This page covers the reporting rules that the code can't explain by itself.

## Counting basis of the Lead section: view switch

The Lead section has a view switch (`#l_basis_filter`, sent as `basis`) with two options:

| View | Rows / columns | Example: DAC-LEAD-0710 (created 25-Oct-2025, Pipeline 25-Oct, Lost Pipeline 27-Jan-2026) |
|---|---|---|
| **Current status (date moved)**, the default (`status`) | Each lead **once**, in its **current category**, on the date it moved into that category, taken from `custom_lead_status_change_history` (`lead_action_date`; Enquiry / Draft leads by creation date). Leads Generated (Existing / New / Total) = leads **created** in the period. | 25-Oct row: Leads Generated 1, no category; 27-Jan row: Lost Pipeline 1 |
| **Leads created & status now** (`created`) | Leads created in the period, split by the category they are in **today**. | 25-Oct row: Leads Generated 1, Lost Pipeline 1 |

In both views a lead's column always matches the category on the lead record. Popups
show Created On, Moved On (the date it entered its current category) and Category Now.

- **Current status details:** the category columns are the original
  `get_tabular_dashboard_data` counting (current category, dated by its latest move into
  it). `basis="status"` adds a creation-date query, so each row gets `created_c` /
  `created_ex_c` for Leads Generated (merged by row label, with `lead_totals` the same).
  Popups use the default lead lists (`l_enq_only`, `l_draft_pipe`, `l_pipe`, `l_ord`,
  `l_lenq`, `l_lpipe`) and the creation-date lists (`l_created`, `lc_ex_all`,
  `lc_nw_all`). Verified: every listed lead's category equals its column, and no lead
  appears in two columns of a row.
- **"What happened" (`basis="history"`)** is still implemented, but the block no longer
  offers it. It confused users, because a lead appeared where it was at the time rather
  than in its category today.
- **History basis details (not offered in the block):** every step of a lead, with its exact time, comes
  from `_lead_history_events`: created; first quotation (Draft, which has no status
  row); and history rows → Enquiry (reopened) / Pipeline / Order / Lost Enquiry / Lost
  Pipeline. History rows older than the lead are ignored, because
  `create_duplicate_lead` copies the original's history.
  - **In each row, a lead is counted once in the category columns: the last status it
    reached in that period**, by time (`_history_scope_add`, `_history_stage_sets`; ties
    on the same timestamp go to the later step).
  - Leads Generated separately counts the leads created in the period.
  - Example: DAC-LEAD-0710 was created at 15:29, quoted at 15:40 and moved to Pipeline at
    15:42 on 25-Oct-2025, then lost on 27-Jan-2026. It counts on 25-Oct as Leads
    Generated 1 / Submitted 1 (not also as Enquiry), and on 27-Jan as Lost Pipeline.
  - So a row's category columns add up to the leads that moved in that period, and no
    lead is counted twice. The Total row applies the same rule over the whole range.
  - Popups use the same rule (`_history_lead_names`). Moved On is the date of the
    counted step. The **Category Now** column shows the lead's category today, so "it
    was in Pipeline that month, it's Lost Pipeline now" is visible in the list.
  - The New / Existing split (`existing_c`) and the "Existing n" badges (`ex_*`) work as
    in Created date.
- **Created date details:** `basis="created"` swaps `lead_action_date` for
  `DATE(l.creation)` in `get_tabular_dashboard_data` and the lead branch of
  `get_card_detail_records`. Leads Created = Enquiry + Pipeline + Order + Lost.
- The one-line explanation above the cards (`#l_basis_note`) changes with the switch. The Excel
  follows the switch, and its sheet is named after the mode.
- **Other blocks:** the original Admin Review block and the charts call without `basis`,
  so they keep the old "current category, dated by its latest move" counting.

## Pipeline = Draft + Submitted (Lead table)

- **Draft Pipeline lead:** an Enquiry lead with at least one **draft** quotation
  (`docstatus = 0`) and no submitted one. The quotation is linked by `party_name` or
  `custom_lead_id`. SQL: `LEAD_DRAFT_PIPE_COND_SQL`. Submitting the quotation is what
  moves the lead to category Pipeline (`custom_script.py`, Quotation on_submit).
- **One Pipeline card and one Pipeline column.** Pipeline shown = Submitted (category
  Pipeline) + Draft. The card adds a line "Draft *x* · Submitted *y*". The draft leads
  come out of Enquiry, so Enquiry shown = `enq_c - draft_pipe_c`, and each lead is
  counted once (`enqOnlyC` / `pipeAllC` in the block script). The category and trend
  charts use the same merge (`mergeDraftIntoPipeline`). The lead's stored category stays
  Enquiry until the quotation is submitted.
- **Backend:** `enq_c` / `pipe_c` keep their plain meaning, because other blocks (the
  original Admin Review) read them. `draft_pipe_c` / `draft_pipe_v` come from
  `get_tabular_dashboard_data` (on each row and on `lead_totals`), and `draft_pipeline`
  {total, value} from `get_crm_analytics_breakdowns`. Draft leads use Enquiry's date
  basis (`DATE(l.creation)`).
- **Pipeline popup:** `get_card_detail_records(card_type="l_pipe_all")` lists both kinds,
  each with `quotation_state` (Draft / Submitted). The popup shows a Quotation column
  and All / Draft / Submitted buttons. `l_draft_pipe` and `l_enq_only` (Enquiry without
  drafts) still exist.

## Lead popups: lost reason, Moved On

- The **Lost Enquiry** and **Lost Pipeline** lists show Lost Reason and Lost
  Description, taken by category: `custom_lost_enquiry_reason` / `_description` for
  Lost Enquiry, `custom_lost_pipeline_reason` / `_description` for Lost Pipeline
  (`lost_reason` / `lost_description` on the records).
- Every lead list shows **Created On** and **Moved On** (`moved_on`), the date the lead
  entered its current stage. This is the same `lead_action_date` that decides which
  table row the lead is counted in.
- The Lost Reason column wraps (max 220px) instead of stretching the table.
- **Where the reason comes from:** the Lead's lost fields, which the form's Lost workflow
  prompt (`workflow.js`, required) and `mark_lead_lost_backend` fill. If those are empty,
  the lost quotation's `order_lost_reason` / Lost Reasons is shown, marked "(from
  quotation)". If there is still nothing, the popup says **Not recorded**. As of Oct
  2026, 31 Lost Enquiry and 7 Lost Pipeline leads have no reason anywhere: they were marked
  lost by a path that skipped the prompt. The history table's `reason` field is never
  filled.

## One lead table + Lead Type filter (Lead section)

The Lead section has **one table**, collapsed by default (Show Breakup). The separate Lead Performance and
Team Comparison tables were merged into it. One line per period (Daily / Weekly /
Monthly), or per team member with **Breakup: By Team Member**:

**Month | Total Leads Generated (Existing, New, Total) | Enquiry | Pipeline with Value (Draft, Submitted) | Order (count & PO value) | Lost Enquiry | Lost Pipeline | Conversions (Contact → Lead, Lead → Order)**

This is laid out like the client's sheet. Each value sits under its count in the same
cell, and the Excel has the same column order.

- **Leads Created** uses the created-date basis above. Existing = repeat leads for an
  existing customer (`LEAD_EXISTING_COND_SQL`, made with Duplicate Lead), and New =
  every other lead. `existing_c` comes on each row and on `lead_totals` of
  `get_tabular_dashboard_data`. The New / Existing cells open `lc_nw_all` / `lc_ex_all`.
- **Existing markers:** with Lead Type = All, each category count that includes
  existing-customer leads shows a small **"Existing n"** under it (click it to list just
  those, via `opts.override.lead_kind`). Per-category counts are `ex_enq_c` (includes
  drafts), `ex_draft_c`, `ex_pipe_c`, `ex_ord_c`, `ex_lenq_c` and `ex_lpipe_c` on each row
  and on `lead_totals`.
- **Lead popups** have a **New / Existing** column (`is_existing`). It's named that
  because "Lead Type" is already the HOT / WARM / COLD field.
- **Lead Type filter** (`#l_kind_filter`, sent as `lead_kind` = `new` / `existing`) narrows
  everything in the section: cards, table, Lead → Order conversions, popups
  (`get_card_detail_records` adds it to `scope_cond_lead`) and the Excel. Helper:
  `lead_kind_sql`.
- **Download Excel** (`export_lead_table_excel`, same arguments) gives one row per table
  line with counts and values in separate columns.
- `get_lead_monthly_performance` and `export_lead_performance_excel` are still in the
  code, but no block uses them now.

## Team Overview: removed

A per-salesperson Team Overview was built and then removed, because the lead table (By
Team Member) and the Team Activity table already show the same figures.
`get_team_overview` and `export_team_overview_excel` are still in `custom_lead.py`, but
no block uses them. Two helpers it introduced stay in use. `openDrilldownModal(...,
opts)` takes `opts.override` (args replacing the section filters) and
`opts.userDisp` / `opts.dateDisp`. `openActivityCategoryModal` takes `opts.exactUser`.

## Creating an existing-customer lead (Lead list)

The Lead list has a **+ Lead for Existing Customer** button (`public/js/lead_list.js`)
for anyone who can create Leads. You pick the Customer, and the dialog shows which
earlier lead will be copied (`get_existing_customer_lead_source`: the latest Order lead
with that `custom_lead_customer`, else the lead the Customer was made from). **Create
Lead** runs `create_existing_customer_lead`, which calls the same `create_duplicate_lead`
as the form's Duplicate Lead button. So the new lead starts as Enquiry, has Duplicated
Lead ticked and carries the Customer ID, and counts as **Existing**. If the customer
has no earlier lead, a new Lead form opens pre-filled (company, Customer ID, Duplicated
Lead, source "Existing Customer", mobile / email when the Customer has them), and the
user completes the mandatory fields.

**Access:** `_check_customer_lead_access` requires Lead create permission and read
access to the picked Customer. A DAC CRM user reads only the customers they own (Customer
DocPerm "if owner"), so a pasted Customer ID from someone else's book is refused ("not
assigned to you"), both in the preview and on create. `create_duplicate_lead` is no
longer `allow_guest`. It needs a signed-in user with Lead create permission who can open
the source lead.

## Roles and access

Hiding something in the page is not a control; every rule below is enforced on the server.

- **DAC CRM** (not Head): every lead and activity endpoint uses `effective_user`, so a
  user sees only their own leads (lead owner) and activities (assigned to), even if they
  ask for another user. "Breakup: By Team Member" is refused. All lead and activity
  popups are limited the same way.
- **Excel downloads** (`export_lead_table_excel`, `export_lead_performance_excel`,
  `export_team_overview_excel`) call `require_crm_head()`. The Download Excel button is
  hidden for non-heads.
- **New Lead for Existing Customer / Duplicate Lead:** see the section above.
- Verified on 2026-10-22 as a DAC CRM user (asm1) against each endpoint, inside a
  rolled-back transaction.

## Loading indicators

While a section's data loads (Contacts, Leads, Lead Performance, Team Activity, Target
vs Actual), its box dims and shows a "Loading…" badge: `setLoading(anchor, on)`, cleared
in `frappe.call`'s `always`. It's counted, so two requests in one section don't clear it
early. Lead and activity popups use Frappe's freeze overlay while their list loads.

## Team Activity: one table

Team Activity has a main table, collapsed by default (Show Breakup), and under it the
always-visible **Visits & Follow-ups** section (see below). The table has one line per
period, or per team member with Breakup: By Team Member.

**Period | Created | Completed | Lead | Contact | Existing Customer | Visits | Follow-ups | Visit types / Follow-up types (each Lead / Contact / Existing)**

- **Created** = activities **created** in the period (`COALESCE(created_on, creation)`,
  any status). `created_c` / `created_u` come on each row and on `totals`, bucketed with the
  same label expressions using the created date, and rows that only have created
  activities are added. Popup: `get_activity_detail_records(date_basis="created")`; its
  last column shows Status (Open / Completed with date / Cancelled).
- **Completed** and every column after it count activities **completed** in the period.
- **Lead / Contact / Existing Customer** are one class per activity
  (`activity_class_sql`): Existing = a Contact at status Existing Customer, an
  existing-customer Lead (`LEAD_EXISTING_COND_SQL`, made with Duplicate Lead), or a
  Customer. Lead and Contact = the new ones. Lead + Contact + Existing = Completed,
  apart from activities with no reference (4 of 1410 all time). Data: `coverage.cls_*`
  and per category `lead_c` / `contact_c` / `existing_c` (plus `_u`). Popups:
  `ref_class=lead|contact|existing`. The Entity filter hides the Lead or Contact
  sub-columns; Existing always shows.
- **Visits / Follow-ups** are `coverage` `visit_*` / `fu_*` (Leads and Contacts, limited
  to the Entity filter). Activity types are grouped under Visit types / Follow-up types
  (`visit_categories`), and types with nothing in the period are left out.
- **The Count filter switches the whole table:** activities (`_c`) or unique
  Leads / Contacts (`_u`). Popups open in the matching view.

### Visits & Follow-ups section

This section always shows under the table (`renderVisitsFollowups`). It has two cards,
VISITS and FOLLOW-UPS, each reading "*N* visits done" with the split **Leads · Contacts
· Existing Customer**, and a **By Activity Type** table: Activity Type | Counts as
(Visit / Follow-up) | Activities Done | Lead | Contact | Existing Customer.

- The split uses the same classes as the table (`activity_class_sql`): `coverage`
  `visit_cls_*` / `fu_cls_*`, and per category `lead_*` / `contact_*` / `existing_*`.
  Totals are the three classes added up, so activities with no reference are left out.
- It follows the Count filter (activities or unique Leads / Contacts), the period and
  the Entity filter. Types with nothing in the period are hidden.
- Every number opens the activity audit with `kind` and `ref_class`. For a total,
  `ref_class="any"` means any of the three classes.
- **By Team Member:** with Breakup: By Team Member (head only), a table above By Activity
  Type shows one row per salesperson, plus a Team Total, with Visits and Follow-ups, each
  Total / Lead / Contact / Existing Customer. It uses the per-user rows' `coverage`, the
  rows add up to the Team Total, and clicks pass the member as `user` with `exactUser`.
  The Team Member filter narrows the whole section to one person.

- **Visit vs Follow-up is decided by activity type alone.** Visit types are listed in
  `ACTIVITY_VISIT_CATEGORIES`: Visit, Field Visit, the Offline … Meeting types, Initial
  Meeting, Follow up meetings and Meeting (Sample). Any other type is a follow-up
  (`ACTIVITY_FOLLOWUP_COND_SQL`). An activity with no type is neither, and appears in
  the matrix's Lead / Contact totals only. A check-in time (`actual_visit_at`) doesn't
  make an activity a visit, so a card's total equals the sum of its type rows in
  Activities mode.
- **A card's Leads / Contacts aren't the sum of the type rows.** A Contact both visited
  and given an Offline Initial Meeting counts once on the VISITS card. Card values
  come from the backend's own distinct counts (`visit_lead_u`, `visit_cont_u`,
  `fu_lead_u`, `fu_cont_u`), and the type table has no total row.
- **One organization = one Lead record or one Business Contact record**
  (`reference_type::reference_name`), not matched by company name. Activities logged on
  a Customer, or with no reference, reach no Lead / Contact.
- **Types listed:** `all_categories` is the Event Activity category field's options,
  deduplicated case-insensitively (the field lists "Offline Follow up Meeting" twice, in
  different case), plus any type found only in the data. The backend also returns
  `visit_categories`, which the block uses for the Visit / Follow-up tags.
- **Backend:** `get_event_activity_breakup_data` returns `coverage` on each row and on
  `totals`. It holds `uniq_total` / `uniq_lead` / `uniq_cont`, plus `<bucket>_u`
  (organizations) and `<bucket>_c` (activities) for `visit`, `fu`, `visit_lead`,
  `visit_cont`, `fu_lead`, `fu_cont`, `visit_new`, `visit_exist`, `fu_new` and
  `fu_exist`. Each category gets `ulead` / `ucont` / `utotal` / `unew` / `uexist`.
  Distinct counts can't be added up across rows, so totals come from their own
  ungrouped query. The New vs Existing values (`ACTIVITY_EXISTING_COND_SQL`, and
  `client=new|existing` on `get_activity_detail_records`) aren't shown on the block.

## Count filter (Team Activity)

The Team Activity filter row has **Count: All Activities / Unique Leads / Contacts**
(`#ea_count_mode`).

- **Unique mode** keeps the matrix but counts each Lead / Contact once per cell. Lead /
  Contact columns use `coverage.uniq_lead` / `uniq_cont`, type cells use `ulead` /
  `ucont`, and the headers read Unique Leads / Unique Contacts. The Visits & Follow-ups
  section switches with it; the number cards above it (Overdue, Today + Upcoming, …)
  don't.
- **Totals in unique mode aren't the sum of the rows.** One Contact visited on two days
  counts on both days but once in the Total. The Total row reads the ungrouped totals.
- **Popups follow the mode.** Clicking a matrix number opens the activity audit in the
  grouped "Unique Leads / Contacts" view in unique mode, and as the plain list
  otherwise. An explicit `opts.unique` (used by the Visits & Follow-ups numbers) always
  wins.

## Activity number cards and the period filter

- **Today + Upcoming** and **Open Activity (Total)** date an open activity by when it's
  due: `COALESCE(ends_on, starts_on, modified)`, where `starts_on` is the Next Follow-up
  date. Open activities never have `ends_on`, so the old fallback to `modified` dated
  them by their last edit, and Today + Upcoming showed 0 for any period. The same
  condition is used in `get_event_activity_breakup_data` and in the `ea_today` /
  `ea_open` drilldowns of `get_card_detail_records`, so card and list counts match.
- **Overdue Activity** deliberately ignores the period: it always shows every open
  activity past its due date.

## Period filters (This Month, This Week, …)

The block turns a period into dates in the browser (`parsePeriodArg`). It must build
them from local date parts: `toISOString()` is UTC, which in IST turns local midnight
into the previous day and starts every period one day early. That bug is fixed in
Admin Review 2 and still present in the original Admin Review. Drilldowns opened from
a Total send only the period name and let the server work out the dates, so with the
bug, a total and its list disagreed.

## Activity audit modal

- `get_activity_detail_records` accepts `kind` (`visit` | `followup`) and `client`
  (`new` | `existing`), using the same rules as above. It returns `created_date` from
  `COALESCE(created_on, creation)`. `creation` was rewritten for about 400 activities
  by the May 2026 data import, and `created_on` holds the real creation time.
- The modal toggles between **All Activities** and **Unique Leads / Contacts**, which
  groups the same records into one row per Lead / Contact with its activity count and
  categories. Clicking a row's count shows just that reference's activities. The
  organization numbers open the modal in the grouped view; everything else opens the
  plain list.
- In Team Member mode, clicking a row passes that member as `user`, so the modal lists
  their activities only.
