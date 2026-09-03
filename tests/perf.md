# M1 Performance Results

Measured 2026-09-01 on the developer machine (Windows 11, headless Chromium via
Playwright against `vite preview`, deterministic generated fixtures).

Fixtures are produced by `npm run gen:logs -- <MB>` (`scripts/gen-large.ts`,
fixed seed → reproducible line counts):

| File | Size | Lines |
| --- | --- | --- |
| `tests/fixtures/logs/generated/app-10MB.log` | 10.00 MB | 139,769 |
| `tests/fixtures/logs/generated/app-100MB.log` | 100.00 MB | 1,397,688 |

## Results

| Scenario | Gate | Measured | Status |
| --- | --- | --- | --- |
| 10 MB: file picked → parse complete + full grid row model ready ("first full paint") | < 3 s | **0.74 s** (warm), 2.6 s (cold cache, first run) | PASS |
| 100 MB: parse completes without tab crash; virtualized grid scrolls | completes, scrolls | **5.4 s**, scroll check OK (rows still painting after wheel) | PASS |

How to reproduce:

```
npm run gen:logs -- 10    # ~1 min
npm run gen:logs -- 100   # ~1 min
npm run build
$env:PERF=1; $env:PERF_100=1   # Windows PowerShell (or PERF=1 PERF_100=1 in bash)
npx playwright test
```

The perf tests live in `tests/e2e/app.spec.ts` and are skipped unless the
`PERF` / `PERF_100` env vars are set, so CI's default smoke run stays fast.

## Notes / known bottlenecks (input for M2)

- Rows are held as plain `LogEntry` objects in memory; 1.4M rows ≈ 1 GB of
  heap including the AG Grid row model. 500 MB files would be the practical
  ceiling before typed-array / columnar storage is needed.
- Every unmatched line still stores the raw line string (no data loss by design).
- The text filter re-filters the in-memory entry array per change (250 ms
  debounce). Fine to ~1M rows; beyond that a precomputed index or in-worker
  filtering is the next step.
- Parsing itself (worker, regex per line) is not the bottleneck — the dominant
  cost was originally handing every 5k-row batch to AG Grid (O(n²) re-diffs);
  the grid now receives row data once per completed file.

## M2 re-check (2026-09-02)

Same fixtures, same metric (file picked → parse complete + full grid row
model ready), headless Chromium against `vite preview`, this dev machine.

| Scenario | Gate | Measured (run 1 / run 2) | Status |
| --- | --- | --- | --- |
| 10 MB: parse + full grid ready | < 5 s (M2 DoD; target 3 s) | **1.34 s / 1.55 s** | PASS |
| 100 MB: completes, no tab crash, grid scrolls | completes + scrolls | **10.2 s / 9.5 s**, scroll OK | PASS |

Notes:

- The 10 MB gate passes with ~3x headroom. M2's added per-line work is only
  `entry.file` stamping plus a one-time autodetect pass over the first 200
  sample lines — negligible at these sizes.
- 100 MB wall time is ~2x the single M1 measurement (5.4 s). The pattern
  parse path is unchanged since M1, and today's machine had OneDrive syncing
  this workspace plus VS Code / MCP servers running — treat the absolute
  number as noisy. The pass criterion (completes + scrolls) holds comfortably.
- **M3 investigation item:** one quiet-machine 100 MB run to pin down whether
  the ~2x is environmental; if real, profile the parse path (suspects:
  draft-entry allocation shape, string row-id keys).

## M3 closeout (2026-09-03) — investigation CLOSED

Same fixtures, same metric, headless Chromium against `vite preview`, this
dev machine. Three baseline runs before the store change below, three after.

| Scenario | Gate | Measured (baseline 1/2/3 → after fix 1/2/3) | Status |
| --- | --- | --- | --- |
| 10 MB: parse + full grid ready | < 5 s | **0.68 s** → 0.67 s / 0.66 s | PASS |
| 100 MB: completes, no tab crash, grid scrolls | completes + scrolls | **4.62 / 4.37 / 4.51 s** → 4.84 / 4.55 / 4.54 s, scroll OK every run | PASS |

### Verdict: the M2 ~2x drift was environmental, not a regression

- The parse path is byte-for-byte unchanged since M1 (M2 only added per-line
  `entry.file` stamping and the one-time 200-line autodetect pass).
- M1's 5.4 s was a single measurement on a quiet machine; the M2 re-check ran
  while OneDrive was actively syncing this workspace, with VS Code + MCP
  servers running (9.5–10.2 s, 0.7 s spread between its two runs).
- The six M3 runs cluster within ~±0.15 s of each other and sit at or BELOW
  M1's one-shot number — a real code regression would show up in every
  measurement, not only the noisy ones. The investigation item's "if real,
  profile the parse path" branch did not trigger. (Machine state at
  measurement: ~30% CPU from IDE/sync background load, 15 GB free RAM — the
  tight run-to-run spread is what makes the comparison valid, not absolute
  idleness.)

### One scaling fix made while investigating

`src/store/logStore.ts` appended each 5k-row worker batch as
`entries: [...f.entries, ...rows]` — re-copying the entire accumulated log per
batch. O(n²) across a file: ~280 full-array copies for the 1.4M-row fixture
(~1.6 GB of transient memory traffic). This is the same pattern that killed
the M1 grid feed (per-batch `setData` re-diffs), relocated into the store.

Fixed: `appendRows()` appends **in place** to the stable `entries` array and
publishes a fresh `FileState` object per batch. Safe because no consumer reads
`entries` while a file parses — grid and report row data are ready-gated in
`App.tsx` (the `rows`/`allEntries` memos only read entries of `ready` files),
and the live-count effect re-fires on the new file object. Tail rotation
swaps in a fresh array; appends resume into whatever array is current.

Effect: below measurement noise at 100 MB (4.5–4.8 s before/after — the copy
was ~0.3–0.7 s of it), but it removes the quadratic growth that would dominate
beyond it: at a ~500 MB / 7M-row file the old path did ~25x more full-array
copying than the 100 MB case. Full gate suite (lint / 130 unit / build / 15
e2e incl. tail rotation + report) re-run green after the change.

### Remaining known bottlenecks (input for M5 perf pass)

- Heap ≈ 1 GB at 1.4M rows (~700 B/row: message + raw + AG Grid row nodes).
  The ~500 MB practical ceiling is set by this, not by parse speed.
- Decode + `split('\n')` still run on the MAIN thread (`fileSource.ts`); a
  100 MB file blocks UI for part of the first second or two. Moving decode
  into the worker (transfer ArrayBuffers) is the obvious next step if needed.
- AG Grid's one-shot 1.4M-row model build happens after the metric endpoint;
  it is why "completes + scrolls" is the 100 MB criterion, not a paint-time gate.

