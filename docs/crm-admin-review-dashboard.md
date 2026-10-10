# CRM Dashboard — Admin Review: Draft Pipeline, Visits & Follow-ups, unique counts

The Admin Review CRM dashboard is a **Custom HTML Block** stored in the database
(`CRM Dashboard Admin Review`, with a working copy `CRM Dashboard Admin Review 2`), not a
file in this repo. Its data comes from whitelisted methods in `custom_lead.py`, and those
methods are shared by every copy of the block. Add new fields and parameters to them;
don't change what the existing ones return.

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

## Organizations Visited & Followed Up (Team Activity section)

This block sits under the activity matrix and counts **organizations**, not activities:
how many Leads and how many Contacts were visited, and how many were followed up. It
has four cards (Visited · Leads / Contacts, Followed Up · Leads / Contacts), each with
"from N visits / follow-ups" as context. Under them, **By Activity Type** lists every
activity type that had activity in the period, with its Leads / Contacts / Total
Organizations / activity count. A
breakup table (opened with Show Breakup) has Visited Lead / Contact, Followed Up Lead /
Contact and Total Organizations per period or team member. The filters and rows are the
same as the matrix. The matrix itself still counts activities and has no Total
Completed column on Admin Review 2.

- **One organization = one Lead record or one Business Contact record**
  (`reference_type::reference_name`). It isn't matched by company name, so a company
  that exists as both a Contact and a Lead counts twice. Activities with no reference,
  or logged on a Customer, count for no organization here. Periods with no Lead /
  Contact reached are left out of the breakup table.
- **Total Organizations = Leads + Contacts.** An organization reached in several ways
  (visited and followed up, or by several activity types) counts once in the total, but
  under each column. So the cards, and the rows of By Activity Type, don't add up to
  the total, and that table has no total row.
- **Visit vs Follow-up** (`ACTIVITY_VISIT_COND_SQL`). An activity is a visit if its
  category is a physical meeting (`ACTIVITY_VISIT_CATEGORIES`: Visit, Field Visit, the
  Offline … Meeting categories, Initial Meeting, Follow up meetings, Meeting (Sample)),
  **or** it has a check-in time (`actual_visit_at`). Every other activity is a follow-up.
  The condition is NULL-safe (`COALESCE(..., 0) = 1`), so `NOT <cond>` is its exact
  complement.
- **All activity types:** `all_categories` is the Event Activity category field's
  options, deduplicated case-insensitively (the field lists "Offline Follow up Meeting"
  twice, in different case), plus any type found only in the data. By Activity Type
  shows only the types that had activity in the period.
- **Backend:** `get_event_activity_breakup_data` returns `coverage` on each row and on
  `totals`: `uniq_total` / `uniq_lead` / `uniq_cont`, plus `<bucket>_u` (organizations)
  and `<bucket>_c` (activities) for `visit_lead`, `visit_cont`, `fu_lead`, `fu_cont`.
  Each category gets `ulead` / `ucont` / `utotal` / `unew` / `uexist`. A distinct count
  can't be added up across rows, so totals come from their own ungrouped query.
- **Not shown on the block:** the New vs Existing client split is still returned
  (`visit_new`, `visit_exist`, `fu_new`, `fu_exist` buckets, using
  `ACTIVITY_EXISTING_COND_SQL`: a Business Contact at status Existing Customer, or a
  Customer). `get_activity_detail_records` still accepts `client=new|existing`.

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
