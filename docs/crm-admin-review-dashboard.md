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

## Draft Pipeline (Lead table)

- **What it is:** an Enquiry lead with at least one **draft** quotation (`docstatus = 0`)
  and no submitted one. The quotation is linked by `party_name` or `custom_lead_id`.
  Submitting a quotation is what moves a lead to Pipeline (`custom_script.py`, Quotation
  on_submit), so these leads are one step away from Pipeline.
- **Display only.** The lead's stored category stays Enquiry. Admin Review 2 shows Draft
  Pipeline as its own stage, between Enquiry and Pipeline, and **takes these leads out of
  Enquiry**, so each lead is counted once. Enquiry shown = `enq_c - draft_pipe_c`
  (`enqOnlyC` / `enqOnlyV` in the block script). The same split applies to the cards,
  the table and the category / trend charts.
- The backend's `enq_c` still includes them, because other blocks that read it (the
  original Admin Review) don't know about Draft Pipeline. A block that shows Draft
  Pipeline must subtract it from Enquiry itself.
- It uses Enquiry's date basis (`DATE(l.creation)`), so a lead stays in the same period
  row as it would under Enquiry.
- SQL: `LEAD_DRAFT_PIPE_COND_SQL`. Fields: `draft_pipe_c` / `draft_pipe_v` (expected
  revenue) on each row and on `lead_totals` of `get_tabular_dashboard_data`, and
  `draft_pipeline` {total, value} from `get_crm_analytics_breakdowns`. Drilldowns:
  `get_card_detail_records` with `card_type="l_draft_pipe"` (Draft Pipeline) or
  `"l_enq_only"` (Enquiry without them).

## Visits & Follow-ups (Team Activity section)

This section sits under the activity matrix and is worded as plain sentences. It uses
the same filters as the matrix, **including the Count filter**, so every number in it
is in one unit:

| Count filter | Card headline | Card split | Type table columns |
|---|---|---|---|
| All Activities | "479 visits done" | Leads / Contacts = activities (`<bucket>_lead_c` / `_cont_c`) | Activities Done · Lead Activities · Contact Activities (`lead` / `cont`) |
| Unique Leads / Contacts | "295 different Leads / Contacts visited" | Leads / Contacts reached (`<bucket>_lead_u` / `_cont_u`) | Leads / Contacts · Unique Leads · Unique Contacts (`ulead` / `ucont`) |

- **Leads and Contacts only.** Every total here is Leads + Contacts, like the matrix's
  Lead / Contact columns. The few activities on a Customer or with no reference are
  left out, so the cards show 479 visits rather than the 482 in `visit_c`. Clicking a
  total opens `get_activity_detail_records` with `reference_type="Lead & Contact"`,
  which filters to those two types, so the list matches.
- **By Activity Type** lists each type with anything to show, tagged Visit or Follow-up
  (from `visit_categories`). Visits come first, busiest first.
- **Every number opens its list,** in the matching view: the plain activity list, or
  the list grouped one row per Lead / Contact.
- The block stylesheet forces `.dac-clickable-cell` to 14px blue with `!important`, so
  this section sets its own size and colour with inline `!important`.

The matrix has no Total Completed column on Admin Review 2.

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
