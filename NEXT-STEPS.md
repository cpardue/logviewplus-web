# NEXT-STEPS — logviewplus-web

> **Read this first in every new session.** Companion docs: `PLAN.md`,
> `MILESTONE-1.md`, `README.md`, `tests/perf.md`, and the history file at
> `../history/logviewplus-web.md` (one level up, outside the repo).
> Last updated: 2026-09-02 ~10:45 — M1 COMPLETE (Pages live, acceptance done).

## 0. Where we are (TL;DR)

- **M1 (parse pipeline MVP) is implemented and verified locally**: parser core,
  streaming worker, AG Grid UI, filters, fixtures, 36 unit tests, E2E + perf gates.
  All gates green (lint / 36 unit / 3 E2E / build). Perf: 10 MB → 0.74 s warm
  (< 3 s target), 100 MB → 5.4 s, no tab crash, grid scrolls. Numbers in `tests/perf.md`.
- **M1 pushed**: code at commit `bb1ef8a` on remote `main` (verified: 51 files, no
  generated/node_modules/dist leaked, all fixtures present); docs closed by the
  follow-up "M1 complete" commit.
- **CI build gate passes on Actions** (Lint, Unit tests, Build steps green).
- **M1 COMPLETE — 2026-09-02**: user enabled Pages in the UI (Source: GitHub
  Actions; API cannot create the site — see §1/§2); dispatch run
  `33649988195` → build ✅ + deploy ✅; site live at
  `https://cpardue.github.io/logviewplus-web/` serving the exact M1 build
  (served asset hash `index-qasf4OWi.js` == local `npm run build` output); last
  `MILESTONE-1.md` acceptance box checked. Next up: **M2** (§6).

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
npm test                      # 36 unit tests, ~0.5 s
npm run build                 # tsc -b && vite build → dist/
npm run gen:logs -- 10        # deterministic fixtures (seeded; 10MB=139769 lines, 100MB=1397688)
npm run build                 # REQUIRED before e2e (playwright webServer serves dist via vite preview)
npm run test:e2e              # 2 tests: fixture parse/filter chain + (PERF-gated) 10 MB perf
$env:PERF='1'; $env:PERF_100='1'; npx playwright test   # all 3 incl. 100 MB gate (~20 s)
```

- Chromium is already installed (`npx playwright install chromium` if a fresh
  Playwright version demands re-download).
- Expected: unit 36/36; E2E counts 40 → (WARN) 7 → (+“config”) 1; perf 10 MB < 5 s
  gate, 100 MB completes + scroll check.
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

## 5. Repo map (where things live)

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

## 6. M2 scope (after Pages live; from PLAN.md §5, suggested order)

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
- `NEXT-STEPS.md` + `MILESTONE-1.md` — this update ships with the "M1 complete"
  push. Nothing else pending locally.



