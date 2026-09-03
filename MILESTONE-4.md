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
3. Checkpoint C — highlights/bookmarks/notes.
4. Checkpoint D — workspace archive save/share.
5. Checkpoint E — local `.sqlite` open (sql.js).
6. Checkpoint F — webhook notifications + closeout (README refresh,
   NEXT-STEPS §0, history entries).

## Checkpoint status

- [x] A — directory monitor (2026-09-03)
- [x] B — rules & row coloring (2026-09-03)
- [ ] C — highlights/bookmarks/notes
- [ ] D — workspace archive save/share
- [ ] E — local `.sqlite` open (sql.js)
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

## Known limitations (M4-A/B; deferred to later checkpoints / M5)

- Top-level files only — no recursive subdirectory watch (per-subdir sessions
  would be the natural extension).
- FSA handles are session-scoped: watch state does not survive a reload
  (persisted directory handles + `requestPermission` re-ask belong with the
  workspace/persistence work in checkpoint D / M5).
- Duplicate file names (across folders and/or tabs) collide on tab testids
  and the merged File column — pre-existing, not monitor-specific.
- Same-name delete+recreate blind spot (see as-built notes).
- Rule UI exposes one level per rule (the model's `levels: LogLevel[]` already
  supports several; a multi-select would be the extension). Row-coloring rules
  persist per browser profile in IndexedDB like saved filters — moving them to
  another machine is the workspace-archive job (checkpoint D).
