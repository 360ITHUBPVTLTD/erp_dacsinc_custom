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

## Rule: keep the docs current

**Whenever you change how any of these flows actually behaves** — a
coverage formula, a status calculation, a button's condition, a dialog's
fields, a new edge case fixed — **update the matching file in `docs/` in the
same piece of work**, not as a follow-up. These docs exist specifically so
the next person (human or Claude) doesn't have to re-derive the reasoning
from scratch or repeat a mistake that was already fixed once. Add a new file
under `docs/` rather than a long inline comment if a change introduces a
genuinely new concept (e.g. a new coverage source, a new dashboard tab).

Do not let `docs/` drift into a changelog — it describes how the system
works *now*, not a history of how it got here. When a doc's reasoning is
superseded, rewrite that section; don't append a correction on top of it.
