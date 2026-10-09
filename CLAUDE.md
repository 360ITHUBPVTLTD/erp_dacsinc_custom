# erp_dacsinc_custom — working notes for Claude Code

This app customizes ERPNext for Dac's Inc's merchandising / subcontracting
business. The two areas with the most custom logic — and the most subtle,
previously-buggy edge cases — are documented in `docs/`:

- `docs/order-flow-dashboard.md` — the Order Flow desk page (`erp_dacsinc_custom/page/order_flow/`):
  every tab, the Verify Customer Details approval dialog, and the
  cross-order stock-conflict indicators.
- `docs/so-rm-po-subcontracting-flow.md` — the Sales Order → Raw Material →
  Purchase Order → Subcontracting → Receipt chain: the Item Stock & Action
  Plan widget, the three raw-material "fetch" surfaces, and the coverage
  math that ties them together.
- `docs/access-worksheets.md` — the agreed access sheet (/roles-and-permissions):
  the source of truth for roles, Role Profiles, document permissions (with
  linked-document dependencies) and Order Flow tab / sub-tab visibility; saving
  it applies them. Role Permission Manager edits to sheet roles are read back
  into it (`access_reverse.py`); resets are System Manager only.
- `docs/pos-store-scope.md` — store-wise record scoping for POS Admin / POS
  Store Manager (Customer › POS Store).
- `docs/sales-order-sharing.md` — Sales Orders shared with their Lead Owner.
- `docs/master-data-protection.md` — Customer / Supplier / Item Price: who views,
  pick-only users (no list, no form), no export / print / report, master reports.
- `docs/draft-guard.md` — a new PO / SCO / PR / PI / SCR / MR / DN / SI is refused
  while a draft for the same source line exists.
- `docs/merchandiser-purchase.md` — Merchandiser User sees and creates only
  subcontracted POs; Stock Entries only for their orders' jobber transfers.
- `docs/stock-hold.md` — stock held for Sales Orders (Pick Lists, jobber, earmarks)
  can't be delivered, moved, reconciled or cancelled away by anything else.

- `www/project-guide.html` (`/project-guide`, signed-in staff) — the one-page project
  guide for newcomers: overview, business flow, roles & where access is controlled, BRD,
  FRD, task tracker (delivered / MOM / Phase 2 / decisions — the `TASKS`, `BRD`, `FRD`
  arrays in its script), developer guide, deploy, glossary. When a task is finished or a
  new one agreed, update its row there. Its PDF
  (`public/docs/project-guide.pdf`) is rebuilt by `scripts/make_worksheet_pdfs.sh`.

## Rule: keep the docs current

**Whenever you change how any of these flows actually behaves** — a
coverage formula, a status calculation, a button's condition, a dialog's
fields, a new edge case fixed — **update the matching file in `docs/` in the
same piece of work**, not as a follow-up — and, when a flow, a role or a business rule
changes, the matching tab of `www/project-guide.html` too (then rebuild its PDF and bump
its `?v=`). These docs exist specifically so
the next person (human or Claude) doesn't have to re-derive the reasoning
from scratch or repeat a mistake that was already fixed once. Add a new file
under `docs/` rather than a long inline comment if a change introduces a
genuinely new concept (e.g. a new coverage source, a new dashboard tab).

Do not let `docs/` drift into a changelog — it describes how the system
works *now*, not a history of how it got here. When a doc's reasoning is
superseded, rewrite that section; don't append a correction on top of it.
