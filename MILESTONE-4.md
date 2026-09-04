# M4 — Power Features

Goal: the remaining power-user surface from PLAN.md §5. Tail-following already
landed in M3; this milestone adds directory monitoring (File System Access
API, Chromium), local `.sqlite` open (sql.js), highlights/bookmarks/notes,
rules & row coloring, workspace archive save/share, and webhook notifications
(replaces the original's command-line provider).

## In scope (per PLAN.md §5 + NEXT-STEPS §0)

1. **Directory monitor** — watch a folder; new accepted top-level log files
   are ingested and tailed automatically; removed files keep their rows and
   drop the live badge. (Chromium FSA; feature-detected.)
2. **Rules & row coloring** — user rules (text/level/file match → row color)
   applied in the grid.
3. **Highlights/bookmarks/notes** — pin a row with a note; persisted in
   IndexedDB.
4. **Workspace archive save/share** — bundle session state (saved filters,
   notes, metadata) into a downloadable archive that can be re-opened.
5. **Local `.sqlite` open (sql.js)** — open a `.sqlite` file as browsable
   table(s).
6. **Webhook notifications** — POST to a user URL when new matching entries
   arrive (replaces the original's command-line provider).

## Tasks / checkpoints

1. **Checkpoint A — Directory monitor** (`src/lib/dirWatch.ts`, `startDirMonitor`
   in `pipeline.ts`, store wiring, unit tests for the diff/feed core, E2E with
   a stubbed directory picker) — DONE 2026-09-03 (as-built notes below).
2. **Checkpoint B — Rules & row coloring** (`src/lib/rules.ts` pure evaluation
   layer + IndexedDB persistence, `RulesBar` UI, AG Grid `getRowStyle`
   integration) — DONE 2026-09-03 (as-built notes below).
3. Checkpoint C — highlights/bookmarks/notes — DONE 2026-09-03 (as-built notes below).
4. Checkpoint D — workspace archive save/share — DONE 2026-09-03 (as-built notes below).
5. Checkpoint E — local `.sqlite` open (sql.js) — DONE 2026-09-04 (as-built notes below).
6. Checkpoint F — webhook notifications + closeout (README refresh,
   NEXT-STEPS §0, history entries).

## Checkpoint status

- [x] A — directory monitor (2026-09-03)
- [x] B — rules & row coloring (2026-09-03)
- [x] C — highlights/bookmarks/notes (2026-09-03)
- [x] D — workspace archive save/share (2026-09-03)
- [x] E — local `.sqlite` open (sql.js) (2026-09-04)
- [ ] F — webhook notifications + closeout

## Acceptance criteria (Definition of Done — per checkpoint)

- All gate commands green: lint / unit / build / e2e (incl. the new spec(s) for
  the checkpoint).
- Checkpoint A: Watch folder… ingests and tails top-level log files; added/
  removed files tracked per poll; Stop watching keeps rows; non-Chromium
  degrades (buttons hidden, hint shown). — MET 2026-09-03.
- Checkpoint B: user rules (text / level / file substring match, AND within a
  rule) color grid rows; first matching rule wins and rules override the
  built-in level tints; reordering changes priority; the working set persists
  across reloads (IndexedDB); deleting restores built-in coloring. — MET
  2026-09-03.
- Checkpoint C: right-clicking a grid row pins it with an accent bar and a
  note entry (exact file:line identity, editable text); the pin follows its
  row across tabs and the merged "All" view; the jump button scrolls a pinned
  row into view; pins persist across reloads (IndexedDB); unpinning restores
  the plain coloring. — MET 2026-09-03.
- Checkpoint D: **Save workspace…** downloads one JSON archive bundling the
  session state — every saved filter set, the working rule set, all pinned
  notes (exact file:line identity + note text), the active filter, the
  naive-timestamp mode, and per-file metadata (name/size/lines/entries/
  status; log rows are never bundled); **Load workspace…** re-applies it in
  the same or another profile/machine — rules replaced, pins + saved filters
  merged (archive wins on collisions), active filter + tz mode applied;
  invalid input is rejected with an error and leaves state untouched. — MET
  2026-09-03.
- Checkpoint E: **Open SQLite…** (or a `.sqlite`/`.db` arriving via the normal
  open/drop paths) opens the file in sql.js and lists its user tables (internal
  `sqlite_*` rows excluded); picking a table shows its columns and rows in a
  virtualized grid under the shared 50k row cap with a truncation flag, total
  count + timing in the status line; BLOBs render as byte markers and NULLs
  stay empty; a non-SQLite file surfaces an error without killing the engine
  and a valid file afterwards recovers; `.sqlite`/`.db` files never reach the
  log parser. — MET 2026-09-04.
- Remaining criteria to be defined per checkpoint as work starts.

## As-built notes

### Checkpoint A (directory monitor)

- **Architecture mirrors tail:** DOM-free core (`src/lib/dirWatch.ts`:
  `DirEntry`, `DirSource.list/open`, pure `diffDirs`, snapshotting `DirFeed`)
  + FSA adapter `FsaDir` (enumerates top-level entries via `handle.values()`,
  skips subdirectories; `getFile()` is a lazy stat, not a byte read).
  `isDirSupported()` = presence of `window.showDirectoryPicker`.
- **Diff key = name only** (sizes tracked but not diffed): size changes on a
  still-present file are owned by that file's own `TailFeed` (byte-level
  growth/rotation per poll); `lastModified` deliberately excluded — it changes
  on every append, so including it would flag every normally-growing log as
  "changed" each poll. Consequence: same-name delete+recreate between two
  polls is NOT detected as a new file (documented blind spot; recover by
  deleting and re-adding the tab).
- **New files are tailed, not re-parsed:** `onNewFile` → store `beginTail`
  over the directory's `TailSource` — same open-ended parse worker as
  "Tail live…" (initial read + continued polling), so appended bytes flow
  incrementally and in-place rotation is already handled. The monitor's own
  1 s poll does membership only; per-file byte-level work stays with the file.
- **Activation:** `startTail` refactored into shared `beginTail(source,
  activateIfNone)` — manual "Tail live…" force-activates (it is meant to be
  watched); monitor-driven ingest activates only when no tab is active, so a
  folder full of logs does not yank the view per file.
- **Removal semantics:** file deleted from disk → directory diff and/or the
  file's own tail notice it → `detachTail()`: worker terminated, `tail` flag
  cleared, rows KEPT; a file still mid-initial-read flips to `ready` with its
  partial content (otherwise it would sit "parsing…" forever — the worker that
  would finish it is gone). **Stop watching** = same for all monitored files;
  every tab and row survives, only live-following ends.
- **Accept list:** default `.log .txt .out .json .csv .gc .yml .xml` (mirrors
  the file input's `accept`, minus `.zip`); case-insensitive suffix match;
  configurable via `DirMonitorOptions.accept`.
- **Monitor error** (listing fails, e.g. permission revoked): the monitor
  stops itself, the store resets `dirName` (button comes back) and
  already-parsed rows stay — no dedicated error banner yet (parked).
- **lib.dom gap:** TS's DOM lib omits the FSA async-iteration methods; small
  `values()` interface extension added in `src/vite-env.d.ts` alongside the
  `showDirectoryPicker` ambient declaration.
- **E2E** (`tests/e2e/dir.spec.ts`, 5 specs): stubbed `showDirectoryPicker`
  (addInitScript, in-memory file map; each `values()` call snapshots current
  names, `getFile()` returns a fresh `File`). Coverage: initial multi-file
  ingest + All-view total + first-file activation; a file added later appears
  on the next poll without stealing the view; a removed file keeps rows and
  loses its live badge; stop-watching after a live append keeps all rows;
  non-Chromium degrade (both buttons hidden, hint shown). `tail.spec.ts`
  degrade spec now shadows BOTH pickers (the hint requires both missing —
  real non-Chromium browsers have neither).
- **Gates:** lint clean; unit 139/139 (20 files, +9 in `dirWatch.test.ts`);
  build ok; e2e 18 passed (+2 perf skips), incl. the 5 new dir specs; perf
  gates re-run after the store refactor: 10 MB 608 ms / 100 MB 4.36 s — no
  regression (M3 cluster 4.37–4.84 s).

### Checkpoint B (rules & row coloring)

- **Pure evaluation layer** (`src/lib/rules.ts`, DOM-free): `Rule` =
  `{ id, text, levels, file, color }`. Conditions combine with AND within a
  rule; semantics mirror `Filters`: text/file are case-insensitive substrings
  (text on message OR raw, file on the engine-stamped `entry.file` — present in
  every view), empty `levels` = all levels including null-level entries.
  `resolveRowColor` returns the FIRST matching rule's color (list order =
  priority) or null. `sanitizeRules` coerces a corrupt/stale IDB record so a
  hand-damaged database can never break the grid.
- **Rule colors override built-in level tints:** `LogGrid.getRowStyle` resolves
  the rule color first and falls back to the existing `ROW_STYLES` level map
  when no rule matches (rows with no rule match are byte-for-byte as before).
- **Style refresh path:** AG Grid caches row styles per rendered row node, so
  a rule edit calls `api.redrawRows()` (a small `useEffect` on the rules
  array). That only re-renders the visible virtualized window, so rule edits
  stay cheap even at 100 MB / 1.4M rows (string matching runs per visible row,
  never over the whole model).
- **Persistence:** single working set stored as ONE record in a new `rules`
  object store (keyPath `id`, key `working`) in the app's IndexedDB database.
  Shared DB open moved to `src/lib/db.ts` (version 1 → 2; every store creation
  guarded by `objectStoreNames.contains` so it runs on both fresh databases and
  v1 upgrades — a lower-version open would throw). Every change auto-saves
  (fire-and-forget put); the store restores the set at startup, so rules can
  land after the first grid render — the redraw effect re-applies them. A
  `window.__rulesSavedAt` commit marker lets E2E wait out the IDB put before
  reloading (same race class as the M2 saved-filter fix).
- **UI** (`RulesBar.tsx`, one row under FilterBar): Add rule / per-rule color
  swatch, text, level select (Any + the six levels — single level per rule in
  the UI; the model keeps `levels: LogLevel[]`), file name, ↑/↓ priority
  reorder, delete. New rules cycle the six-color palette so defaults are
  distinguishable.
- **E2E** (`tests/e2e/rules.spec.ts`, 5 specs): text rule overrides the
  built-in ERROR tint (asserts the pre-rule base value first); level + text
  rules with priority reorder (first-match wins both orders); file rule in the
  merged view (all 40 rows of one source colored, none of the other's — for
  this fixture/viewport the whole 58-row dataset is rendered, so counts are
  asserted directly); persistence across reload; delete restores built-in
  coloring. Unit: 12 tests in `tests/unit/rules.test.ts`.
- **Gates:** lint clean; unit 151/151 (21 files, +12); build ok; e2e 23 passed
  (+2 perf skips) incl. the 5 new rules specs; perf re-check after the change:
  10 MB 629 ms / 100 MB 4.36 s — no regression (M4-A baseline 608 ms / 4.36 s).

### Checkpoint C (highlights/bookmarks/notes)

- **Identity = exact (file, lineNo) pair:** `src/lib/highlights.ts`
  (DOM-free): `Highlight { id, file, lineNo, note }`; `highlightFor` matches
  the engine-stamped `entry.file` + 1-based `lineNo`, so a pin follows its row
  across single-file tabs and the merged view and never leaks to a same-line
  row in another file. `sanitizeHighlights` drops corrupt/stale IDB records
  (same class as `sanitizeRules`).
- **Accent bar composes with colors:** `LogGrid.getRowStyle` adds
  `boxShadow: inset 3px 0 0 #ffd75e` on top of whatever rule/level background
  the row already has — pins are independent of rules and level tints (the
  e2e asserts the ERROR tint survives underneath). Same visible-window
  `redrawRows()` effect as rules, so pin edits stay cheap at 1.4M rows.
- **Right-click context menu:** the native contextmenu over `.ag-row` is
  suppressed (capture phase); the grid's `onCellContextMenu` (carries the
  RowNode → robust under virtualization, where only a window of rows is in
  the DOM) opens a fixed-position menu with "Add note…" / "Remove note"
  (`ctx-pin`/`ctx-unpin` testids); Escape or grid scrolling closes it.
- **NotesBar** (one row per pin under RulesBar): `file:line` location,
  editable note textarea (auto-focuses the freshly added pin's field), → jump
  button, ✕ delete; empty state hints "right-click a grid row to pin one".
- **Jump** (`src/lib/gridJump.ts`): best effort — finds the row by identity
  via `forEachNode`, `setHighlighted('center')` + `ensureIndexVisible`; no-op
  (returns false) when there is no grid or the row is not in the currently
  shown model (source file closed or filtered out).
- **Persistence:** new `highlights` object store (keyPath `id`) — shared DB
  open in `src/lib/db.ts` bumped v2 → v3, contains()-guarded so fresh and
  v1/v2 databases all upgrade cleanly. Store actions `pinRow` /
  `setHighlightNote` / `unpinRow` auto-save fire-and-forget; a
  `window.__highlightsSavedAt` commit marker lets E2E wait out the IDB put
  before reloading; pins restore at startup (they may land after the first
  grid render — the redraw effect re-applies them).
- **E2E** (`tests/e2e/highlights.spec.ts`, 5 specs): right-click pin →
  `file:line` entry + accent bar while non-pinned rows stay clean; a pinned
  row offers Remove note and removing restores the plain coloring (accent
  composes with, not replaces, the ERROR tint); persistence across reload; a
  pin follows its row into the merged view (exactly one accented row among
  58 — identity includes the file name); the jump button scrolls a deep row
  into the grid viewport. Unit: 10 tests in `tests/unit/highlights.test.ts`.
- **Gates:** lint clean; unit 161/161 (22 files, +10); build ok; e2e 30
  tests incl. both perf gates — 10 MB 501 ms / 100 MB 4184 ms — no regression
  (M4-B baseline 629 ms / 4.36 s).

### Checkpoint D (workspace archive save/share)

- **Format** (`src/lib/workspace.ts`, DOM-free): one pretty-printed JSON file
  (`logviewplus.workspace` v1, downloaded as `logviewplus-workspace.json`)
  carrying `savedAt`/`appVersion`, `settings.tzMode`, the active `filters`,
  every `savedFilters` set, the working `rules`, all `highlights` (pins), and
  per-file metadata `{name,size,lines,entries,status}`. Log rows are
  deliberately NOT bundled — files are re-opened by the user (no persistent
  FSA handles). `parseWorkspace` throws `WorkspaceError` (surfaced via
  `alert`) on a wrong format or unsupported version; corrupt nested records
  are dropped/sanitized (reusing `sanitizeRules`/`sanitizeHighlights` plus
  local filter/saved-filter/file-meta sanitizers) so one bad entry never
  blocks the rest of the workspace.
- **Load semantics** (`loadWorkspace` in `logStore.ts`; every write awaited,
  then a `window.__workspaceLoadedAt` commit marker for E2E): rules REPLACED
  — the archive is a snapshot of the workspace's whole state; pins MERGED by
  exact (file, lineNo) identity via pure `mergeHighlights` (local id kept,
  archive note wins; local-only and new pins both survive), persisted with a
  new `replaceHighlights` (single clear+put IDB transaction); saved filters
  merged by name (archive wins, local-only sets kept); active filter + tz
  mode applied.
- **FilterBar refresh**: the bar read its saved-filter list only at mount —
  gained a `savedFiltersVersion` store field bumped by archive loads so new
  sets appear without a reload (own save/delete still refresh locally).
- **UI**: "Save workspace…" / "Load workspace…" header buttons plus a hidden
  `workspace-input` accepting `.json`; saving with no session state just
  downloads an empty (valid) archive.
- **E2E** (`tests/e2e/workspace.spec.ts`, 4 specs): the download's JSON
  content (all sections, no log rows anywhere in the file); load into a
  profile whose IDB + localStorage were wiped (bars repopulate; the restored
  rule color AND pin accent both apply to the pinned row after re-opening the
  fixture; state survives a second reload); invalid file → alert, nothing
  applied (no commit marker); hand-crafted archive vs local state → rules
  replaced, pins merged with archive-note-wins, saved filters unioned, tz
  mode applied, all persisted. Unit: 10 tests in `tests/unit/workspace.test.ts`
  (round-trip, rejects, sanitization, merge).
- **Gates:** lint clean; unit 171/171 (23 files, +10); build ok; e2e 34 incl.
  both perf gates — 10 MB 475 ms / 100 MB 4066 ms — no regression
  (M4-C baseline 501 ms / 4184 ms).

### Checkpoint E (local `.sqlite` open)

- **Lazy engine, mirrors the DuckDB report chunk:** `src/lib/sqlite/engine.ts`
  is only reachable via a dynamic import from the sqlite store — sql.js's glue
  (~40 kB) + wasm (~660 kB, ~326 kB gzip) ship as separate assets fetched on
  first open, so nothing joins the main bundle. `getSqliteEngine()` singleton;
  a failed first init clears the cached promise so later opens retry.
  `open(bytes)` closes the previous DB; `readTable` runs COUNT(*) first and
  then `SELECT * … LIMIT min(total, cap)` via a prepared statement
  (`getColumnNames()` for column names — it exists at runtime in sql.js 1.14.2
  but is missing from @types/sql.js), so a multi-million-row table never
  materializes beyond the shared 50k cap.
- **DOM-free core** (`src/lib/sqlite/result.ts`, unit-tested): `normalizeCell`
  (primitives pass through; BLOB → `<binary N bytes>` marker instead of raw
  bytes in the DOM; bigints stringified so int64 stays exact beyond double
  precision; non-finite numbers stringified), `mapTableResult` (row-major
  cells + cap + truncation computed against the engine's COUNT, with a cap
  override for tests), `sanitizeTableNames` (drops internal `sqlite_%` rows —
  AUTOINCREMENT's `sqlite_sequence` included — unquotes quoted names,
  case-insensitive dedupe + sort per SQLite's default collation) and
  `quoteIdent` (double-quoted identifier, embedded quotes doubled).
- **Store** (`src/store/sqliteStore.ts`): `openFile`/`selectTable` with the
  report store's monotonic run-id guard; failures never reject — they land in
  an `error` status the bar renders. Re-opening a file re-selects the
  previously active table when it still exists (a live `activeTable` switch
  happens while loading, so E2E polls on status + table together). `openSeq`
  bumps on every completed open (success OR error).
- **UI** (`src/components/SqliteBar.tsx`, third view behind a header "SQLite"
  tab): "Open SQLite…" + hidden input (`.sqlite,.db`), one chip per table,
  status line (rows in N ms / truncation / file name), rows rendered by the
  existing `ReportGrid` (AG Grid virtualization). Exposes `window.__sqlite`
  for E2E like `__report` does.
- **Routing:** `.sqlite`/`.db` files arriving through ANY log-side path
  (Open files…, drag & drop) are split out in `logStore.addFiles` before zip
  expansion and opened via the sqlite store — they never touch the text
  parser. App auto-switches to the SQLite view when `openSeq` bumps so a
  routed open is visible. Multiple files at once: last one wins (documented).
- **Fixture + E2E:** `scripts/gen-sqlite-fixture.mjs` (`npm run gen:sqlite`)
  writes a byte-deterministic `tests/fixtures/sqlite/sample.sqlite` (users: 5
  rows w/ AUTOINCREMENT; orders: 8 rows w/ NULL notes + 1/4/6-byte BLOBs; an
  index) and re-opens it to assert its own shape before writing.
  `tests/e2e/sqlite.spec.ts` (3 specs): browse both tables with exact
  columns/rows, NULL → null cell and BLOB → byte markers, status line text; a
  text log offered as "database" → error + engine recovers on the next valid
  open; a `.db` through the main `file-input` routes to the SQLite tab (0
  parsed rows, no file tab). Unit: 13 tests in `tests/unit/sqlite.test.ts`.
- **Gates:** lint clean; unit 184/184 (24 files, +13); build ok; e2e 37 passed
  incl. both perf gates — 10 MB 483 ms / 100 MB 4011 ms — no regression
  (M4-D baseline 475 ms / 4066 ms).

## Known limitations (M4-A/B/C/D/E; deferred to later checkpoints / M5)

- Top-level files only — no recursive subdirectory watch (per-subdir sessions
  would be the natural extension).
- FSA handles are session-scoped: watch state does not survive a reload
  (persisted directory handles + `requestPermission` re-ask — deferred to
  M5; checkpoint D shipped the portable archive, not persistent handles).
- Duplicate file names (across folders and/or tabs) collide on tab testids
  and the merged File column — pre-existing, not monitor-specific.
- Same-name delete+recreate blind spot (see as-built notes).
- Rule UI exposes one level per rule (the model's `levels: LogLevel[]` already
  supports several; a multi-select would be the extension). Row-coloring rules
  persist per browser profile in IndexedDB like saved filters — moving them to
  another machine is now possible via Save/Load workspace (checkpoint D).
- Pins key on (file name, lineNo) — the same pre-existing duplicate-name
  collision as tabs: two tabs opened from same-named files share pin identity.
  A pin outlives its source file (the note entry stays until deleted; the jump
  button becomes a no-op). One accent color for all pins — no per-pin colors,
  and notes attach to whole rows, not text spans.
- SQLite browser state is session-scoped: the open database does not survive a
  reload (the file must be opened again) and it is not part of the workspace
  archive (same class as the FSA-handle item above). Browsing is read-only —
  no writes or free-form SQL against the opened file (the Report tab's SQL runs
  over parsed log entries, a different engine). Tables only — SQLite views are
  not listed. Multiple `.sqlite`/`.db` files dropped at once: the last one wins.
  sql.js runs single-threaded on the main thread, so opening very large
  databases or reading huge tables can briefly block the UI (the 50k-row cap
  bounds the read side); int64 values beyond 2^53 lose precision inside sql.js
  itself (documented upstream limitation — bigints are stringified exactly when
  they do arrive).
