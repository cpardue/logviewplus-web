# M1 — Parse Pipeline MVP

Goal: open one or more local log files, stream-parse them in a Web Worker with a
pattern-based parser, and show results in a virtualized grid with text + level
filtering. Proves the core loop: **big file → fast interactive browsing**.

## In scope

- Scaffold repo (stack per `PLAN.md` §2) + CI/Pages workflow green
- Pattern parser with LVP-style specifier subset; level normalization
- Chunked streaming parse in worker (progress events, batched row delivery)
- AG Grid: virtualized columns Timestamp / Level / Message (+ raw on hover), level row color
- Filter bar: case-insensitive text contains + multi-select level
- Unit tests (parser, chunking, filters) + Playwright smoke test
- Fixture log set + deterministic large-file generator

## Out of scope (later milestones)

JSON/XML/DSV parsers, date resolution rules, SQL reports, dashboards, merge,
zip/clipboard, tail, persistence, export. (Placeholder stubs only where cheap.)

## Tasks

1. **Scaffold** — `npm create vite@latest . -- --template react-ts`; strict tsconfig;
   ESLint 9 + Prettier; git init; `.gitignore`; install deps: AG Grid Community,
   zustand, fflate, idb, vitest, @playwright/test.
2. **Config** — `vite.config.ts`: `base '/logviewplus-web/'`, worker support,
   vitest config; create `.github/workflows/deploy.yml` (lint → test → build →
   upload-pages-artifact → deploy-pages); enable Pages source = Actions on the repo.
3. **Parser core** (`src/parsers/`) — pure, worker-agnostic:
   - `types.ts`: `LogEntry { seq, ts: number|null, level: LogLevel|null, message: string, raw: string, lineNo }`
   - `specifiers.ts`: specifier → regex group mapping (initial set: `%m` message,
     `%l` level, `%t` thread, `%d`/`%S`/`%s` date/time variants per docs)
   - `PatternParser.ts`: user pattern (default auto-detected for common layouts)
     compiled to regex; `parseLine(line): LogEntry | null`; pure functions only
   - `levels.ts`: normalize level strings (DEBUG/INFO/WARN/ERROR/FATAL + numeric)
4. **Worker** (`src/workers/parser.worker.ts`) — receives `File` via
   `file.slice(start, end)` chunks (1 MB); handles chunk boundaries splitting a
   line; posts `{type:'progress', fraction}` and `{type:'rows', rows, transfer:[]}`
   batches (~5k entries) with transferable payloads; cancel support.
5. **UI** — dropzone + multi-file picker; toolbar (name, size, parsed/total lines,
   elapsed, progress bar); AG Grid with virtualization, level row color;
   filter bar (text contains + level multiselect) applied to parsed dataset
   without re-parse (in-worker or main-thread filter over entry index).
6. **Fixtures** (`tests/fixtures/logs/`) — small real-shaped samples:
   `gc.log`, `iis-u_ex.log` (W3C combined), `app.json` (JSON lines),
   `apache-access.log`, `mixed-levels.log`; + `scripts/gen-large.ts`
   deterministic generator for 10 MB / 100 MB files.
7. **Tests** — Vitest: specifier compilation, parseLine on fixtures, chunk
   boundary correctness (split mid-line), level normalization, filter logic.
   Playwright: open fixture via picker/drop → grid row count matches expected →
   level filter reduces count → text filter narrows further.
8. **Perf gate** — record real numbers in a `tests/perf.md` table:
   10 MB file: parse + first full paint < 3 s; 100 MB: completes without tab
   crash, grid scrolls > 60 fps at 5k visible-window rows.

## Acceptance criteria (Definition of Done)

- [x] `npm test` green (unit), `npm run test:e2e` green (Chromium headless)
- [x] CI green on push to `main`; site live at `https://cpardue.github.io/logviewplus-web/`
- [x] 10 MB and 100 MB generated fixtures meet perf gate; numbers recorded (`tests/perf.md`)
- [x] README updated: usage instructions + perf table + known limitations
- [x] History file entry written (milestone complete)

## Deviations from plan (as-built notes)

- Initial specifier set shipped: `%d`, `%l`, `%t`, `%m` (the `%S`/`%s` advanced
  date variants are M2). Level normalization covers text aliases
  (WARNING/SEVERE/FINEST/…); numeric level mapping deferred to M2.
- `parseLine` never returns null: unmatched lines are kept as raw entries
  (`ts`/`level` null) so no data is silently lost.
- Chunking + streaming UTF-8 decode run on the main thread
  (`src/lib/fileSource.ts`, 1 MiB slices); the worker owns a pure `ParseEngine`
  (`src/workers/parser-engine.ts`) that is directly unit-testable in Node.
  Batches ~5k rows; plain structured clone (transferables deferred).
- AG Grid receives row data **once per completed file** (not per streamed
  batch): per-batch full re-diffs were O(n²) and dominated the 100 MB case —
  see `tests/perf.md`.
- AG Grid v32 modular API: `GridCoreModule` + `CommunityFeaturesModule` +
  `ClientSideRowModelModule`; `gridApi.getModel()` is deprecated, so E2E
  asserts on app-exposed counts (`window.__appCounts`) plus a
  `getDisplayedRowCount()` paint sanity check.

## Next after M1

M2 per `PLAN.md` §5: parser breadth (JSON/XML/Log4Xml/DSV), date resolution,
merge, zip/clipboard ingest, saved filters, export.
