# NEXT-STEPS — logviewplus-web

> **Read this first in every new session.** Companion docs: `PLAN.md`,
> `MILESTONE-1.md`, `README.md`, `tests/perf.md`, and the history file at
> `../history/logviewplus-web.md` (one level up, outside the repo).
> Last updated: 2026-09-03 ~10:50 — **M4 in progress**: checkpoints A + B
> DONE (directory monitor; rules & row coloring — persisted user rules →
> grid row colors, first match wins; gates green incl. perf re-run); next: M4
> checkpoint C (highlights/bookmarks/notes), see `MILESTONE-4.md`.

## 0. Where we are (TL;DR)

- **M2 COMPLETE — 2026-09-02**: all six M2 areas implemented, gated and pushed —
  parser breadth (W3C / Apache common+combined / JSON lines / Log4j XML / DSV +
  pattern fallback with per-file autodetect), date rules (`%S`/`%s` specifiers,
  ISO ordinal dates, naive-timestamp Local/UTC mode), merged "All" view with File
  column, zip + clipboard ingest, saved filters (IndexedDB, `src/lib/filters-db.ts`),
  CSV/JSON export of filtered rows (`src/lib/export.ts` + ExportBar).
- **M2 gates green**: lint / 110 unit (15 files) / build / 9 e2e — incl. new
  specs for autodetect, merge, zip, paste, saved-filter persistence (test waits
  for the IDB put to commit before reloading), and CSV/JSON export downloads.
- **M2 perf re-check** (`tests/perf.md`): 10 MB = 1.34–1.55 s (< 5 s gate, ~3x
  headroom); 100 MB = 9.5–10.2 s, completes + scrolls (M1's single measurement
  was 5.4 s — noisy-machine caveat + M3 investigation item recorded there).
- **Remote state**: M2 landed as commits A (parser breadth) → B (dates) → C
  (merge/ingest) → D `215d31f` (M2.5+M2.6: saved filters + export; that push
  also dropped a stray `_test_out.txt` an earlier push had shipped) — plus this
  closeout docs commit on top. CI (Lint/Unit/Build + Pages deploy) runs on each
  push.
- **M3 checkpoint A COMPLETE — 2026-09-02**: DuckDB-WASM (stable pin `1.32.0`,
  MVP worker build, lazy-loaded on first Run) over an Arrow-backed `entries`
  table; Report tab with 4 presets + free-form SQL editor + AG Grid result
  (50k-row cap, truncation flagged); status line with load/query timings and
  errors. Verified by a new `tests/e2e/report.spec.ts` (preset counts against
  `mixed-levels.log`, custom SQL, error surfacing + engine recovery, per-minute
  grouping). Main bundle stays clean (no duckdb/arrow in initial payload;
  wasm ~39 MB ships as a separate asset fetched on first Run). Caveats in
  `MILESTONE-3.md` as-built notes: apache-arrow v17 Table-construction quirks
  (all-nullable schema required) and the duckdb-wasm#1966 broken exception
  shim that hides real SQL error text (mapper now detects it and explains).
- **M3 checkpoint B COMPLETE — 2026-09-03**: live tail-following of growing
  files. `src/lib/tail.ts` = DOM-free `TailFeed` (byte offset + ONE persistent
  streaming TextDecoder + poll classification text/none/rotate/removed; two
  documented size-polling blind spots) + FSA `HandleSource`/`isTailSupported`.
  `pipeline.startTail` keeps the parse worker OPEN (no `finish`) so lineNo/seq
  keep counting across polls; initial read 1 MiB-chunked, then 1 s poll loop.
  Rotation = epoch-bumped worker `reset` + `resetAck` (FIFO ⇒ clear stored rows
  only after ack — zero lost/dup entries), re-read from byte 0. File flips to
  `ready` after the initial read; appended rows flow through the normal grid
  path. Removed file keeps its rows, `tail` flag clears. UI: "Tail live…"
  button (Chromium only; other browsers get a hint, verified by E2E), ● dot on
  the tab + toolbar badge. Gates: lint / 130 unit (19 files) / build / 13 e2e
  (+2 perf skips) incl. new `tests/e2e/tail.spec.ts` (stubbed picker via
  addInitScript: append 10→15, rotation 5→3, non-Chromium degrade).
- **M3 checkpoint C COMPLETE — 2026-09-03 (M3 DONE)**: 100 MB perf
  investigation closed. Six re-measurements (3 pre / 3 post-fix, headless
  Chromium vs `vite preview`): 100 MB = **4.37–4.84 s** (±0.15 s spread; at or
  BELOW M1's one-shot 5.4 s), 10 MB = 0.66–0.68 s — vs M2's noisy 9.5–10.2 s /
  1.34–1.55 s. Verdict: **the ~2x M2 drift was environmental** (OneDrive sync
  + IDE/MCP load during that measurement; parse path unchanged since M1). The
  "if real, profile" branch did not trigger. On the way in: `logStore` batch
  append was O(n²) (`[...f.entries, ...rows]` per 5k rows — ~280 whole-array
  copies at 1.4M rows, ~1.6 GB transient traffic; same pattern that killed the
  M1 grid feed) → `appendRows()` in-place append + fresh `FileState` object
  (safe: grid/report rows are ready-gated, nothing reads `entries` mid-parse).
  Sub-neutral at 100 MB, removes quadratic growth for larger files. Docs:
  `tests/perf.md` §M3 closeout (verdict + remaining bottlenecks parked for M5),
  README (M3 status/usage/perf/limitations + pusher correction), MILESTONE-3
  (C checked + as-built). Gates after the fix: lint / 130 unit (19 files) /
  build / 15 e2e (13 + 2 perf runs green on this pass).
- **M4 checkpoint A COMPLETE — 2026-09-03**: directory monitor (FSA,
  Chromium). `src/lib/dirWatch.ts` = DOM-free core (`DirFeed`/pure
  `diffDirs`; diff key = name only — size changes are owned by each file's
  own `TailFeed`, `lastModified` excluded because it changes on every append)
  + `FsaDir` adapter (top-level files only). `startDirMonitor` in pipeline
  (initial scan + 1 s membership poll, accept-list filtered); store gained
  `dirName`/`startDirMonitor`/`stopDirMonitor` and a shared
  `beginTail(source, activateIfNone)` (manual Tail force-activates, monitor
  ingest activates only if no tab active) + `detachTail` (rows kept; a
  mid-parse file flips to `ready` with partial content). UI: "Watch folder…"
  / "Stop watching …" buttons; non-Chromium hint now covers both features.
  Same-name delete+recreate is a documented blind spot. New
  `tests/e2e/dir.spec.ts` (5 specs, stubbed `showDirectoryPicker`) +
  `tests/unit/dirWatch.test.ts` (+9). Gates: lint / 139 unit (20 files) /
  build / 18 e2e (+2 perf skips); perf re-run after the store refactor:
  10 MB 608 ms, 100 MB 4.36 s — no regression. Full notes + limitations in
  `MILESTONE-4.md`.
- **M4 checkpoint B COMPLETE — 2026-09-03**: rules & row coloring.
  `src/lib/rules.ts` = DOM-free rule evaluation (`Rule { text, levels, file,
  color }`; AND within a rule; case-insensitive substrings like Filters — text
  on message OR raw, file on the engine-stamped `entry.file`; empty levels =
  all incl. null) + `sanitizeRules` for corrupt IDB records. Working set
  auto-persisted to a new IndexedDB `rules` store (shared open moved to
  `src/lib/db.ts`, DB v1 → v2 with contains()-guarded upgrades so both fresh
  and v1 databases work) and restored at startup. UI: `RulesBar` under
  FilterBar (color swatch / text / level select / file / ↑↓ priority / delete;
  new rules cycle a six-color palette). Grid: rule colors OVERRIDE built-in
  level tints via `getRowStyle`; a `redrawRows()` effect on rule changes
  re-applies styles to the visible virtualized window only — rule edits stay
  cheap at 1.4M rows. New `tests/unit/rules.test.ts` (12 tests) +
  `tests/e2e/rules.spec.ts` (5 specs: level-tint override, first-match priority
  + reorder, file rule in merged view, reload persistence via a `__rulesSavedAt`
  commit marker, delete restores base tints). Gates: lint / 151 unit
  (21 files) / build / 23 e2e (+2 perf skips); perf re-run after the change:
  10 MB 629 ms, 100 MB 4.36 s — no regression (M4-A 608 ms / 4.36 s). Full
  notes + limitations in `MILESTONE-4.md`.
- Next up: **M4 checkpoint C — highlights/bookmarks/notes** (pin a row with a
  note; IndexedDB persistence), then D workspace archive save/share, E local
  `.sqlite` open (sql.js), F webhook notifications + closeout — per
  `MILESTONE-4.md`. Then M5 polish (encodings/culture, 1 GB+ perf pass:
  main-thread decode move + columnar storage per `tests/perf.md`, a11y, docs).

## 1. ~~Immediate task: enable Pages, verify live site~~ — DONE 2026-09-02

**Result:** user enabled Pages (step 1 below); `PUT /repos/.../pages` re-verified
as a dead end (404 with both `build_type: "workflow"` and legacy source-only).
Dispatched `deploy.yml` on `main` → run **33649988195**: `build` success,
`deploy` success. Site verified live — see the corrected step 5 (the old
`level-WARN` marker was a false check: it is a runtime-constructed testid and
never appears as a literal in the minified bundle; asset-hash match against the
local build used instead).

Steps actually taken (kept for reference):

1. Ask the user (or they may already have done it): repo
   **Settings → Pages → “Build and deployment” → Source: `GitHub Actions`** → Save.
2. Verify enabled: `GET /repos/cpardue/logviewplus-web` → `has_pages` must be `true`
   (script pattern in §3, or MCP `github__get_repo`).
3. Dispatch deploy: `POST /repos/cpardue/logviewplus-web/actions/workflows/deploy.yml/dispatches`
   body `{ "ref": "main" }`.
4. Poll `GET /repos/.../actions/runs?per_page=5` until the latest run is
   `completed`; then `GET /actions/runs/{id}/jobs` → **both `build` and `deploy`
   must be `success`**. If a step fails, read failed step names from `j.steps`.
5. Verify the site: fetch `https://cpardue.github.io/logviewplus-web/`, grab the
   `assets/*.js` path from index.html, fetch it, assert it contains `"Open files"`.
   Do NOT assert `"level-WARN"` — it is built at runtime (`data-testid={`level-${l}`}`
   in FilterBar.tsx) and never exists as a literal in the minified bundle.
   Strongest check: compare the served asset filename hash with local
   `npm run build` output (`dist/assets/index-*.js` is content-hashed; an exact
   match = identical build). Verified 2026-09-02: served `index-qasf4OWi.js`
   == local build. Allow up to ~3 min after deploy success for Pages CDN
   propagation.
6. Check off the last acceptance box in `MILESTONE-1.md`:
   “CI green on push to main; site live at …”.
7. Push doc updates: `npm run git:push:api "M1 complete: Pages live, acceptance done"`
   (carries this file + history entries; verify new remote tree via
   `GET /git/trees/{sha}?recursive=1` — no `generated/`, `node_modules`, `dist`).
8. Tell user M1 is done; M2 scope in §6.

## 2. Hard operational facts (read before any git/CI work)

- **No git/gh binary on this machine.** Push ONLY via
  `npm run git:push:api "message"` (`scripts/git-push-api.mjs`): REST API push
  (blob → tree → commit → ref update), produces ONE clean commit on top of the
  current REMOTE head, gitignore-aware staging walk, refuses to run if nothing
  changed. It diffs against remote state — **local `.git` state is irrelevant**.
- `npm run git:push` (wire protocol, `scripts/git-push.mjs`) currently FAILS:
  GitHub's smart-HTTP git endpoints return **401 “invalid credentials”** for this
  fine-grained PAT while the same token works perfectly on api.github.com
  (verified: `/user` 200, repo 200 with full admin). Don't chase it; use the API
  pusher. It's kept for environments where git-over-HTTPS auth works.
- Token resolution (both pushers): `GH_TOKEN` env var, else
  `~/.cline/data/settings/cline_mcp_settings.json` →
  `mcpServers.github.transport.env.GITHUB_PERSONAL_ACCESS_TOKEN` (fine-grained,
  repo admin). **Never print the full token.**
- Local `.git/refs/heads/main` is STALE (`0b253c9`; remote is `bb1ef8a`+).
  Harmless for the API pusher; the wire pusher's divergence guard correctly
  refuses. Don't try to “fix” it by force-pushing an orphan history.
- CI: `.github/workflows/deploy.yml` = checkout → setup-node 22 (npm cache) →
  `npm ci` → lint → test → build → configure-pages → upload-pages-artifact →
  deploy-pages. Pages enabled 2026-09-02; full pipeline green on run
  33649988195 (build + deploy success).

## 3. Gate commands (run from project root)

```
npm run lint
npm test                      # 139 unit tests (20 files), ~1 s
npm run build                 # tsc -b && vite build → dist/
npm run gen:logs -- 10        # deterministic fixtures (seeded; 10MB=139769 lines, 100MB=1397688)
npm run build                 # REQUIRED before e2e (playwright webServer serves dist via vite preview)
npm run test:e2e              # 18 tests: app/merge/zip/paste/saved-filters/export/report/tail/dir chains + (PERF-gated) perf
$env:PERF='1'; $env:PERF_100='1'; npx playwright test   # 20 incl. both perf gates (~14 s on a quiet pass)
```

- Chromium is already installed (`npx playwright install chromium` if a fresh
  Playwright version demands re-download).
- Expected: unit 139/139; E2E counts 40 → (WARN) 7 → (+“config”) 1; dir spec
  All-view total 15 (10+5 entries); perf 10 MB < 5 s gate, 100 MB completes +
  scroll check (~4.5 s measured on this machine, 2026-09-03).
- Quick API checks without a probe file: use MCP `github__get_repo` for repo
  status; for workflow runs there's no MCP tool — write a temp `_probe_*.mjs`
  (fetch with Bearer token, write results to `_probe_out.txt`, read it, DELETE
  both files after — probes must never be committed).

## 4. Gotchas log (cost real time; don't re-discover)

- **vite preview + IPv6**: `localhost` resolves to IPv6-only on this machine, so
  the `preview` script MUST keep `--host 127.0.0.1`, and Playwright's
  `webServer.url` must include the base path
  (`http://127.0.0.1:4173/logviewplus-web/`) — root `/` doesn't 200 under a
  `base:`, so the readiness probe times out otherwise.
- **AG Grid v32 API** (verified in node_modules d.ts, not guessed):
  - Register once at module top level:
    `ModuleRegistry.registerModules([GridCoreModule, CommunityFeaturesModule, ClientSideRowModelModule])`
    (core exports the first two; row model comes from its own package).
  - React wrapper export is **`AgGridReact`** (not AGGridReact).
  - `gridApi.getRowCount()` does NOT exist in v32; `getModel()` is deprecated.
    E2E therefore asserts on `window.__appCounts = { total, visible }` set by
    `App.tsx`, plus `getDisplayedRowCount() > 0` as a paint sanity check.
- **Never feed the grid row data per streamed batch** — full client-side re-diff
  each time is O(n²) (100 MB took >2 min, ~43% after 60 s). Rows go to the grid
  **once per completed file** (`rows` useMemo in `App.tsx`, gated on
  `status === 'ready'`). Toolbar keeps live counts during parsing.
- **`String.raw` for regex source in template literals**: a normal backtick
  string turns `\d` into `d` (silently broke the CLF date alternative until unit
  tests caught it). All date lines in `src/parsers/specifiers.ts` are `String.raw`.
- **`.gitignore`**: `*.log` is ignored repo-wide; test fixtures re-included via
  `!tests/fixtures/logs/*.log`; `tests/fixtures/logs/generated/` stays ignored.
  Never commit generated fixtures (~110 MB) — the API pusher's final remote tree
  check fails loudly if one slips through.
- **react-hooks/purity lint**: no impure calls in render (e.g.
  `performance.now()`). Toolbar computes elapsed only from `finishedAt` once
  `status === 'ready'`.
- **PowerShell + `node -e` with regex/quotes is miserable** (quoting mangling,
  garbled terminal capture). For anything non-trivial: write a temp `.mjs`
  script, run it, read the output file, delete the script.
- **isomorphic-git v1.41.9 API** (if the pushers ever need repair): NO `fs/`
  adapter directory — hand-roll the 10-command promise fs on `node:fs/promises`
  (`readFile` MUST forward `{encoding}`); `HttpClient = { request }` (an object,
  from `isomorphic-git/http/node`); `add({fs, dir, filepath: string[]})`; `push`
  takes **`url`** (not `remoteURL`); EVERY command needs explicit `dir`/`gitdir`
  (`resolveRef` without `dir` crashes with “.replace of undefined”);
  `isIgnored({fs, dir, gitdir, filepath})`; use `getRemoteInfo` (has `.refs`).
- **Playwright test timeout** is 300 s in `playwright.config.ts` (100 MB gate
  needs headroom; poll timeouts inside specs are separate).
- **API pusher used to keep remote-only files despite warning it would drop them** —
  four temp probe files got committed in `e53a831` (2026-09-02). Fixed:
  `scripts/git-push-api.mjs` now excludes remote-only paths from the new tree and
  commits on deletion-only changes too; `.gitignore` has `_probe_*.mjs` +
  `_probe_out.txt`. Still: never leave temp files in the workdir at push time.

## 5. Repo map (where things live) — M1 snapshot; M2 added the `src/parsers/*`
breadth (Json/W3c/Combined/Dsv/XmlLog4j + detect/factory), `src/lib/{ingest,filters-db,export}.ts`,
and `src/components/ExportBar.tsx`; M3 added `src/lib/sql/*` (DuckDB-WASM engine
over an Arrow `entries` table), `src/store/reportStore.ts`,
`src/components/{ReportBar,ReportGrid}.tsx`, `src/lib/tail.ts` (+ `startTail` in
pipeline + worker `reset`/epoch protocol), and `tests/e2e/{report,tail}.spec.ts`;
M4-A added `src/lib/dirWatch.ts` (+ `startDirMonitor` in pipeline, store
`dirName`/`startDirMonitor`/`stopDirMonitor`, `beginTail`/`detachTail` refactor)
and `tests/{unit/dirWatch.test.ts, e2e/dir.spec.ts}`

```
src/parsers/        pure parser core: types.ts, levels.ts, timestamps.ts,
                    specifiers.ts (compilePattern + SPECIFIERS), PatternParser.ts
                    (parseLine never null — unmatched → raw entry; detectTemplate)
src/workers/        parser-engine.ts (pure streaming engine — unit-tested directly;
                    partial-line state across feed(); flush semantics: remainder
                    emitted at end of a feed that had no limit-flush, or on finish)
                    parser.worker.ts (thin self.onmessage shell)
src/lib/            fileSource.ts (1 MiB slice + streaming TextDecoder),
                    pipeline.ts (worker orchestration + template autodetect from
                    first 200 sample lines), filters.ts (applyFilters/entryMatches),
                    format.ts (bytes/duration/count)
src/store/logStore.ts  zustand: files map (FileState incl. status/fraction/entries),
                    activeId, filters; sessions Map<id, ParseSession>
src/components/     LogGrid.tsx (AG Grid v32, exposes window.__gridApi),
                    Toolbar.tsx (stats + progress), FilterBar.tsx (debounced text +
                    level chips)
src/App.tsx         layout, dropzone+picker, rows useMemo (ready-gated!),
                    exposes window.__appCounts for E2E
scripts/            gen-large.ts (seeded generator; Node 24 native TS),
                    git-push.mjs (wire — currently 401), git-push-api.mjs (WORKING)
tests/unit/         36 tests: specifiers, pattern-parser, parser-engine (chunk
                    boundaries/batches/CRLF/trailing line), filesource (UTF-8 splits),
                    filters
tests/e2e/app.spec.ts  fixture chain (40→7→1) + PERF-gated 10/100 MB perf tests
tests/fixtures/logs/   mixed-levels.log (40 lines: 7 WARN, 5 ERROR, 2 FATAL, 1 raw),
                    gc.log, iis-u_ex.log (W3C — for M2), app.json (JSON lines — M2)
tests/perf.md       measured numbers + how to reproduce + known bottlenecks
.github/workflows/deploy.yml   see §2
```

## 6. ~~M2 scope (after Pages live; from PLAN.md §5, suggested order)~~ — DONE 2026-09-02

1. **Parser breadth**: W3C/combined (`iis-u_ex.log` fixture ships), JSON lines
   (`app.json` ships), Log4j XML, DSV — plus richer autodetect. `PatternParser`
   stays the user-pattern engine.
2. **Date resolution rules** (timezones, ordinal dates, the deferred `%S`/`%s`
   specifiers).
3. **Merge** multiple files into one dataset (`LogEntry.file` field already exists).
4. **Zip / clipboard ingest** (`fflate` already installed).
5. **Saved filters + persistence** (`idb` already installed; IndexedDB).
6. **Export** (CSV/JSON blob download).

Then M3: DuckDB-WASM SQL reporting/dashboards (sql.js fallback per PLAN.md).

Per milestone: new fixtures + unit tests + E2E updates + perf check + push via
`npm run git:push:api` + history entry. Follow the session protocol in §7.

## 7. Session protocol (per .clinerules)

- On session start: read `../history/logviewplus-web.md` (top entries) AND this file.
- After substantive work: prepend a history entry (fixed template: Files /
  Decisions / Next / Rollback; cap 25 entries).
- Before every push: `npm run lint && npm test && npm run build` (+ e2e whenever
  src/UI changed; remember the build step before `test:e2e`).
- Push: `npm run git:push:api "<message>"` → verify remote tree via API
  (no `generated/`, `node_modules`, `dist`; expected files present).
- Keep §0 and the “Last updated” line of this file truthful — it is the first
  thing the next session reads.

## 8. Uncommitted local diffs at time of writing

- `../history/logviewplus-web.md` — lives OUTSIDE the repo (workspace root, one
  level up), so it never ships in a push; it is the per-.clinerules history file.
- This update ships with the "M2 complete" closeout push. Nothing else pending
  locally (scratch `_*.txt` / probe files are deleted before every push).



