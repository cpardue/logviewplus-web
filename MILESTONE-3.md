# M3 — SQL Reporting + Tail-Following + Perf Investigation

Goal: real SQL over parsed entries (DuckDB-WASM, in a worker, lazy-loaded), a
report view with presets and result grid, live tail-following of growing files
(File System Access API, Chromium-only, feature-detected), and closure of the
100 MB perf investigation item from `tests/perf.md`.

## In scope (per PLAN.md §5 + NEXT-STEPS §0)

1. **SQL report engine** — DuckDB-WASM (mvp single-threaded build; no COOP/COEP
   available on Pages). Entries land in an `entries` table via Apache Arrow IPC
   (fast path — chunked `INSERT ... VALUES` measured ~13 s/1M rows and is out).
   Free-form SELECT + preset queries. **sql.js fallback** only if the wasm path
   turns out to be unworkable (PLAN.md risk).
2. **Report UI** — "Report" tab; SQL editor + preset chips + result grid
   (AG Grid, dynamic columns) + status line (rows, timings, errors).
3. **Tail-following** — watch a file handle (Chromium File System Access API);
   poll size, stream new bytes into the same parse pipeline (partial-line state
   already survives across `feed()` calls in the engine). Non-Chromium: hidden
   with a notice.
4. **Perf investigation** — quiet-machine 100 MB re-measurement; profile the
   parse path if the ~2x M1 drift is real (suspects in `tests/perf.md`).

## Table schema (what SQL sees)

```sql
entries(
  seq     INTEGER,   -- positional order (stable row id)
  ts_ms   DOUBLE,    -- epoch ms, NULL when unresolvable
  ts_iso  TEXT,      -- ISO-8601 display string, NULL with ts_ms
  level   TEXT,      -- TRACE..FATAL or NULL (unmatched/derived-none)
  message TEXT,      -- parsed message
  raw     TEXT,      -- original line
  file    TEXT,      -- source file name, NULL for single-file sets w/o stamp
  line_no INTEGER    -- 1-based line number in the source file
)
```

Report runs over the **current scope** (active file, or merged "All") with the
raw parse result — not the filtered grid rows. Result display is capped at
50 000 rows (truncation flagged in the status line).

## Tasks

1. **Checkpoint A — SQL engine + Report view** (`src/lib/sql/*`, `reportStore`,
   `ReportBar`/`ReportGrid`, unit tests for the pure arrow/result/preset layer,
   E2E report spec). DuckDB lazy-loads on first Run (main JS + ~38 MB wasm
   ship as Vite `?url` assets; never in the main bundle).
2. **Checkpoint B — Tail-following** (`src/lib/tail.ts`, store wiring, unit
   tests for the size-diff/rotation logic, E2E with a stubbed picker) — DONE
   2026-09-03 (see as-built notes below).
3. **Checkpoint C — Perf investigation + closeout** (100 MB quiet-machine run,
   `tests/perf.md` M3 section, README refresh, NEXT-STEPS §0, history entries).

## Checkpoint status

- [x] A — DuckDB-WASM SQL engine + Report tab (2026-09-02)
- [x] B — tail-following (2026-09-03)
- [ ] C — perf investigation + closeout

## Acceptance criteria (Definition of Done)

- [x] All gate commands green: lint / unit / build / e2e (incl. new report spec)
- [x] SQL engine runs in a worker; first Run lazily loads wasm; main bundle
      unchanged (no duckdb in the initial payload)
- [x] Presets + free-form SQL verified by E2E against `mixed-levels.log`
      (known counts: 40 entries, WARN 7 / ERROR 5 / FATAL 2 / INFO 15 /
      DEBUG 7 / TRACE 3 / no-level 1)
- [x] Arrow ingest of the 40-entry fixture round-trips all columns incl. nulls
      (unit-tested pure layer; E2E asserts query results)
- [x] Tail-following appends new lines to a running file tab (Chromium);
      non-Chromium degrades gracefully (feature-detect, no crash)
- [ ] 100 MB perf: quiet-machine number + verdict in `tests/perf.md`
- [ ] README updated; NEXT-STEPS §0 truthful; history entries written

## As-built notes (deviations from plan)

- **DuckDB-WASM version pin:** `latest` npm tag (1.33.1-dev57.0) is a dev
  prerelease → pinned stable `@duckdb/duckdb-wasm@1.32.0`. Its Node build has a
  broken emscripten exception shim (`ReferenceError: _setThrew is not defined`
  on any query that errors; reproduced on 1.31 + 1.32) — irrelevant to the
  browser product path, but it means **no in-Node DuckDB integration tests**;
  vitest covers the pure arrow/result/preset layer only, and the worker engine
  is verified by Playwright E2E (headless Chromium runs the real wasm).
- **apache-arrow pin:** `apache-arrow@^17.0.0` (same major duckdb-wasm 1.32
  depends on, so Vite dedupes to one copy shared between app code and the
  bundled duckdb wrapper). arrow ≥19 removed the classic `arrow.table`/
  `arrow.type` API; tables are built with explicit `Schema` +
  `vectorFromArray(values, type)` — and plain `Utf8`/`Float64` types are
  **mandatory**: inferred string columns come out as `Dictionary<Utf8, Int32>`
  which duckdb's arrow ingest rejects.
- **Data load path:** `conn.insertArrowTable(table, { name: 'entries' })` after
  `DROP TABLE IF EXISTS entries` (async worker API). Entry arrays that are
  referentially unchanged since the last load skip the rebuild.
 - **arrow v17 Table-construction quirks** (all hit while getting empty +
   non-empty builds through): `new Table(schema, {...columns})` validates the
   schema against *vector inference*, and v17 infers **every** vector as
   nullable — a mixed-nullable schema throws "schemas must be equivalent"
   (even for empty input). `entriesSchema()` is therefore all-nullable (harmless
   to DuckDB; documented in the code). The varargs overload
   `new Table(schema, v1, v2, ...)` infinite-recurses (`unwrap`, table.ts) for
   non-empty input in the ESM build, and the CJS build's `(schema, columns)`
   path is broken in a different way ("schema.fields is not iterable") — only
   the ESM map form is reliable, which is exactly what Vite ships.
 - **duckdb-wasm#1966 also breaks the browser error path** (not just Node):
   any SQL that throws inside the wasm surfaces to JS as
   `ReferenceError: _setThrew is not defined`, hiding the real binder/parser
   message. Consequences: (a) `sqlErrorMessage` detects the shim artifact and
   shows a readable "known upstream bug" notice instead; (b) presets avoid
   numeric epoch casts — entries-per-minute slices the UTC `ts_iso` string
   (`substr/replace`) instead of `strftime(to_timestamp(...))`, which is both
   TZ-proof and immune to hidden binder errors.
 - **E2E ground truth** for `mixed-levels.log` (asserted in
   `tests/e2e/report.spec.ts`): 40 entries → level-counts = INFO 15, WARN 7,
   DEBUG 7, ERROR 5, TRACE 3, FATAL 2, `(none)` 1 (7 rows); per-minute (39
   timestamped) = 11/15/13 across 08:00/08:01/08:02. First Run in a fresh
   browser context downloads + compiles the wasm; on this machine the whole
   report spec passes in ~7 s, so generous 180 s poll timeouts are headroom,
   not expectations.

### Checkpoint B (tail-following) as-built

- **Pure core, DOM-free:** `src/lib/tail.ts` — `TailFeed` tracks a byte offset
  over an injected `TailSource` (`stat()`/`slice()`) and classifies every poll
  as `text` (growth), `none`, `rotate` (size < last observed size) or
  `removed` (handle no longer resolves). ONE persistent streaming `TextDecoder`
  spans all reads, so multi-byte UTF-8 characters split across poll boundaries
  decode correctly (unit-tested). Initial read chunks at 1 MiB (`next(1MiB)`),
  steady-state polls use `Infinity`.
- **Two documented blind spots** (inherent to size polling, same class as
  `tail -f`): same-size rewrites undetectable; grow-then-shrink *between two
  polls* ending larger than the last observed size slips through.
- **Worker reset + epoch guard:** rotation posts `{type:'reset'}` — the worker
  rebuilds its `ParseEngine` (fresh line/seq counters, same detected spec) and
  replies `{type:'resetAck'}`. All outbound messages now carry an `epoch`.
  Because worker→main delivery is FIFO, awaiting the ack before clearing stored
  rows guarantees zero lost/duplicated entries (pre-reset rows are all already
  delivered by then). The re-read of the rotated file starts at byte 0 in the
  same pump iteration.
- **Session stays open:** `startTail` never sends `finish`, so the engine's
  partial-line buffer carries the trailing incomplete line across polls and
  `lineNo`/`seq` keep counting. File flips to `ready` after the initial read
  (`onInitial`) — appended rows flow into the same grid path (batch-level
  re-filter is fine at tail cadence; the M1 O(n²) gotcha only bit during
  whole-file initial parses).
- **FSA adapter + degrade:** `HandleSource` calls `handle.getFile()` per poll
  (`NotFoundError` → stat −1 → `removed`: existing rows stay, `tail` flag
  clears via `onStopped`). `window.showOpenFilePicker` is absent from TS
  `lib.dom` → minimal ambient declaration in `src/vite-env.d.ts`. Non-Chromium:
  `isTailSupported()` false → Tail button not rendered, "Live tail needs
  Chrome or Edge" hint shown (verified by E2E via a defineProperty shadow).
- **E2E stubbed picker** (`tests/e2e/tail.spec.ts`): `addInitScript` installs a
  fake `showOpenFilePicker` (own property via `Object.defineProperty` — plain
  assignment could no-op if Chromium exposes it setter-less) backed by an
  in-memory byte buffer; each `getFile()` returns a fresh `File` snapshot, and
  the test grows/replaces the buffer between polls. Three specs: append
  (10→15 entries), rotation (5→3, would be 8 without reset), unsupported
  browser degrade. All pass in ~2–3 s with the default 1 s poll interval.
