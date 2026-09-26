# Warehouse list → Add Stock (bulk, background)

System Manager only. Pick warehouses, a qty, and **All Items** or chosen items;
that qty of every item is received into every warehouse as submitted Material
Receipt Stock Entries. Code: `warehouse_add_stock.py`, `public/js/warehouse_list.js`.

## Built for a million+ items

ERPNext needs ~0.12 s per stock row, so 1,000,000 items is ~33 hours **per
warehouse** for one worker. A run is therefore:

- **Background, chunked** — each lane handles ~`CHUNK_ROWS` (3,000) rows per
  job, then enqueues its own next chunk (queue `long`). No job runs for hours.
- **Resumable without duplicates** — items are walked in name order from a
  saved cursor (keyset queries, never the whole list in memory). Every Stock
  Entry (≤ `ROWS_PER_ENTRY` = 200 rows) holds *complete* items, and the lane's
  cursor is saved in the same commit. A crash / worker restart loses only the
  uncommitted entry; Resume redoes it from the cursor — nothing twice, nothing
  missed. A failing entry is rolled back, logged (Error Log) and reported, and
  the run moves on.
- **Parallel** — the item range is split into lanes, one per worker listening
  to the `long` queue (max `MAX_LANES` = 4; runs under
  `MIN_ITEMS_PER_LANE` × lanes items stay single-lane). Throughput scales with
  workers: 4 long workers ≈ 4× faster. (This bench runs one `bench worker`.)
- **State in the database** — `DefaultValue` rows under parent
  `__dacsinc_add_stock` (`<run_id>` for the run, `<run_id>:<lane>` per lane,
  `user:<user>` → the user's current run). No migration needed.

## Using it

- Clicking **Add Stock** while a run is going opens its **live status**:
  progress, rows/entries added, lanes finished, time left, and **Stop** (stops
  after the Stock Entry in hand; everything so far stays) — plus **Resume** if a
  lane stopped moving for 15 min with no job queued (e.g. a server restart).
- One run per user at a time. Progress is pushed over realtime; the final
  summary also arrives as a **notification (bell)**, so the page can be closed.
- **Items with no valuation rate** (perpetual inventory is on, so ERPNext needs
  a value for every receipt; "no rate" = no stock history in that warehouse, no
  Valuation Rate / Standard Rate on the Item and no buying price — same lookup
  as ERPNext's `get_valuation_rate`). The dialog asks what to do with them:
  **Skip them** (reported in the summary), **Add at zero value** (row gets
  `allow_zero_valuation_rate`), or **Add at a rate I enter** (row gets that
  `basic_rate` with `set_basic_rate_manually`). Items that have a rate always
  keep their own. The summary says how many rows went in at zero / at the
  entered rate. (A live run of 18,258 items once added only 39 because 18,219
  had no rate and the only behaviour then was Skip.)
- Always skipped and reported: variant templates, batch/serial items,
  disabled / non-stock items.
- All entries of a run share the remark `Bulk Add Stock <run id>`; the summary
  links to that list (e.g. to cancel a run).

## Verified

900 test items × 2 warehouses in 3 lanes with small chunks, a simulated worker
death mid-lane, then Resume: every eligible (item, warehouse) received exactly
once, skipped items reported, counts matching the ledger; an All Items run over
the whole Item table walked every item once. Test harness lives outside the app
(rolled back; commits replaced by savepoints to mimic crashes).
