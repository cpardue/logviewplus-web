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
