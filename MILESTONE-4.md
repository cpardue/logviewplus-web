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
2. Checkpoint B — rules & row coloring (suggested next).
3. Checkpoint C — highlights/bookmarks/notes.
4. Checkpoint D — workspace archive save/share.
5. Checkpoint E — local `.sqlite` open (sql.js).
6. Checkpoint F — webhook notifications + closeout (README refresh,
   NEXT-STEPS §0, history entries).

## Checkpoint status

- [x] A — directory monitor (2026-09-03)
- [ ] B — rules & row coloring
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

## Known limitations (M4-A; deferred to later checkpoints / M5)

- Top-level files only — no recursive subdirectory watch (per-subdir sessions
  would be the natural extension).
- FSA handles are session-scoped: watch state does not survive a reload
  (persisted directory handles + `requestPermission` re-ask belong with the
  workspace/persistence work in checkpoint D / M5).
- Duplicate file names (across folders and/or tabs) collide on tab testids
  and the merged File column — pre-existing, not monitor-specific.
- Same-name delete+recreate blind spot (see as-built notes).
