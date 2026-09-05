# LogViewPlus Web

Client-side web application that emulates the core log-analysis features of
LogViewPlus (Clearcove Ltd) and is deployed statically to GitHub Pages.

This is a **clean-room reimplementation** built from the public documentation at
logviewplus.com/docs. It is not affiliated with, endorsed by, or derived from
the source code of LogViewPlus, which is closed-source commercial software.
Intended for personal/internal use (GitHub Pages ToS prohibits commercial SaaS).

## Status

**Milestone 5 in progress — checkpoint A complete (2026-09-04):** file
encodings. Every opened file's encoding is resolved before parsing: BOMs are
detected and stripped (UTF-8 / UTF-16 LE / UTF-16 BE), then a leading 64 KiB
sample auto-detects (pure ASCII → UTF-8; strict-UTF-8 validation → UTF-8;
UTF-16 zero-parity pattern → UTF-16 LE/BE; anything else with high bytes →
Windows-1252 — the legacy ANSI case, e.g. `café`/`€` service logs). The
resolved encoding shows as a badge in the toolbar per file, and the FilterBar
gained an **Encoding** select (Auto / UTF-8 / UTF-16 LE / UTF-16 BE /
Windows-1252, persisted) that overrides detection for files opened after the
change; live tail and folder-monitor sessions honor the same rules. Remaining
M5 checkpoints: 1 GB+ performance pass, accessibility, docs section — see
`MILESTONE-5.md`.

**Milestone 4 complete (2026-09-04):** all six checkpoints done — **Watch
folder…**: a live directory monitor (File System Access API, Chromium-only,
feature-detected) that ingests and tail-follows new log files as they appear
in the picked folder; removed files keep their rows. **Rules & row coloring**:
user-defined text / level / file match rules color grid rows (first matching
rule wins, overrides the built-in level tints), persisted in IndexedDB across
reloads. **Highlights/bookmarks/notes**: right-click any grid row to pin it
with a note (accent bar + NotesBar entry with file:line, editable text and
jump-to-row); pins persist across reloads and follow their row into the merged
view. **Workspace archive**: Save/Load workspace… bundles saved filters,
rules, pinned notes, the active filter, the naive-timestamp mode and per-file
metadata into one JSON file that re-applies in the same or another
profile/machine (rules replaced, pins + saved filters merged — files
themselves are re-opened). **SQLite tab**: open a local `.sqlite`/`.db` file
(sql.js, lazily loaded on first open) and browse its tables — user tables only
(internal `sqlite_*` excluded), capped at 50k rows with truncation flagged,
BLOBs shown as byte markers; `.sqlite`/`.db` files dropped via the normal open
paths route here instead of the log parser. **Webhook notifications**: set a
URL in the Webhook bar and every LIVE-appended entry matching text / level /
file conditions is POSTed there as a small JSON batch (coalesced into ≤ 1 s
windows, ≤ 50 entries per POST; initial-load history never fires; "Send test"
fires a one-off probe; failures surface in the status line) — the web
replacement for the original's command-line provider. See `MILESTONE-4.md`
for as-built notes and limitations.

**Milestone 3 complete (2026-09-03):** on top of M2 — a Report tab with real
SQL over the parsed entries (DuckDB-WASM in a worker, lazily loaded on first
Run; presets + free-form editor + result grid), live tail-following of growing
files (File System Access API, Chromium-only, feature-detected), and closure
of the M2 100 MB perf drift — re-measured as environmental (stable ~4.5 s now,
at or below M1's one-shot 5.4 s; details in `tests/perf.md`).

Milestone 2 (2026-09-02): auto-detected multi-format parsing (custom
`%d %l: %m`-style patterns, IIS W3C, Apache common/combined, JSON lines,
Log4j XML, CSV/TSV), richer date rules (naive-timestamp timezone mode,
yearless syslog dates, epoch + ISO ordinal dates), a merged "All" view with a
File column, zip / clipboard ingest, saved filters persisted in IndexedDB, and
CSV/JSON export of the filtered rows.

- `PLAN.md` — repo scaffold, tech stack, deployment design, constraints, roadmap
- `MILESTONE-1.md` — M1 tasks + acceptance criteria (done)
- `MILESTONE-2.md` — M2 tasks + acceptance criteria (done)
- `MILESTONE-3.md` — M3 tasks + acceptance criteria (done)
- `MILESTONE-4.md` — M4 power features: tasks, checkpoints A–F as-built, limitations
- `MILESTONE-5.md` — M5 polish: encodings (A, done), perf pass (B), a11y (C), docs (D)
- `tests/perf.md` — measured performance numbers (M1, M2 re-check, M3 closeout)

## Usage

Open the site, then drag & drop log files anywhere or use **Open files…**
(multiple files get tabs; `.zip` drops extract into one tab per member and
pasted text becomes a synthetic file). Formats are auto-detected per file. Per
file you get: name, size, live parse progress, entries/lines + elapsed time;
Time / Level / Message (+ File in merged view) columns with level row
coloring — plus **rules** that color rows by text / level / file name match
(each rule ANDs its conditions; the first matching rule wins and overrides the
level tints; rules persist across reloads); **pinned notes** — right-click a
row to pin it with an optional note (accent bar + NotesBar entry with file:line,
editable text and a jump-to-row button; pins persist across reloads and follow
the row into the merged view); a case-insensitive text filter and
level chips that apply to the parsed data without re-parsing; saved filter
sets persisted in IndexedDB; CSV/JSON export of the filtered rows; a **workspace archive** (Save/Load
workspace… — one JSON file carrying saved filters, rules, pinned notes, the
active filter, tz mode and per-file metadata, re-openable in any
profile/machine); an **Encoding** select (Auto / UTF-8 / UTF-16 LE /
UTF-16 BE / Windows-1252 — persisted, applies to files opened after the
change; Auto detects BOM + content sample and the resolved encoding shows as
a per-file badge in the toolbar); and a
"Naive times: Local/UTC" setting for zone-less timestamps. On top of that: a **Report** tab (SQL over the
parsed entries — presets + free-form editor, DuckDB-WASM loaded on first use)
and **Tail live…** (live tail-following of a growing file; Chromium only,
other browsers get a hint instead) and **Watch folder…** (a directory monitor
that ingests + tails new log files as they appear in the picked folder;
Chromium only) and a **SQLite** tab (open a local `.sqlite`/`.db` file and
browse its tables — sql.js is lazily loaded on first open, rows are capped at
50k with truncation flagged, BLOBs show as byte markers; `.sqlite`/`.db` files
dropped through the normal open paths route here instead of being parsed as
logs); and a **Webhook bar** (set a URL — while armed, every live-appended
entry matching the text / level / file conditions is POSTed to it as a small
JSON batch, coalesced into ≤ 1 s windows with ≤ 50 entries per POST; opening
a file never fires anything, only new growth does — plus "Send test" for a
one-off probe and a status line showing each send's outcome). All parsing
happens locally in your
browser — files are never uploaded (the only outgoing traffic is an explicit
webhook POST you configure to your own URL).

```
npm install
npm run dev          # local dev server
npm test             # vitest unit tests
npm run test:e2e     # playwright smoke (Chromium; served via vite preview)
npm run build        # production build to dist/
npm run gen:logs -- 10    # deterministic seeded 10 MB fixture
PERF=1 PERF_100=1 npm run test:e2e   # perf gates (run gen:logs first)
```

Deployment: push to `main` → GitHub Actions builds and deploys to GitHub Pages
(`https://cpardue.github.io/logviewplus-web/`). Pushes are made with
`npm run git:push:api "<message>"` (GitHub REST API blob→tree→commit→ref; the
dev machine has no system git binary, and the wire-protocol pusher in
`scripts/git-push.mjs` is kept for environments where git-over-HTTPS auth works).

## Performance (measured)

| Scenario | Gate | Measured |
| --- | --- | --- |
| 10 MB → parse + full grid ready | < 3 s (M2/M3 gate < 5 s) | **0.74 s** warm / 2.6 s cold (M1); 1.34–1.55 s (noisy M2 re-check); **0.66–0.68 s** (M3, 2026-09-03) |
| 100 MB → completes, no tab crash, scrolls | completes + scrolls | **5.4 s** (M1 one-shot); 9.5–10.2 s (noisy M2 re-check); **4.4–4.8 s** (M3, 2026-09-03 — drift closed as environmental) |

Details, verdict on the M2 drift, and how to reproduce: `tests/perf.md`.

## Known limitations

- Encoding auto-detection samples the first 64 KiB: a file whose leading 64
  KiB is valid UTF-8 but whose tail carries Windows-1252 bytes will be read as
  UTF-8 (replacement characters) — pick an explicit encoding for such files.
  The Encoding select affects files opened AFTER the change (reopen an already
  opened file to re-decode it), like the "Naive times" setting.
- Naive timestamps (no timezone) follow the "Naive times" setting (default
  Local); changing it only affects files opened afterwards — already-opened
  files must be reopened.
- Saved filters, row-coloring rules, and pinned notes are stored per browser
  profile in IndexedDB (client-side only; clearing site data clears them) —
  **Save/Load workspace…** bundles them (+ active filter, tz mode, per-file
  metadata) into a portable JSON archive for moving between profiles/machines.
- Memory ≈ 1 GB heap at 100 MB / 1.4M rows — practical ceiling ~500 MB files
  before columnar/typed-array storage (M5 perf pass; see `tests/perf.md` for
  the M3 bottleneck breakdown).
- Live tail-following and folder watching are Chromium-only (File System
  Access API); other browsers show a hint and everything else works. Same-size
  file rewrites between polls are undetectable (inherent to size polling, same
  class as `tail -f`); the folder monitor watches top-level files only and a
  same-name delete+recreate is not detected as new content (see
  `MILESTONE-4.md`).
- The SQL report engine lazy-loads ~39 MB of WASM on first Run and the SQLite
  browser lazy-loads sql.js (~40 kB glue + ~660 kB wasm) on first open — both
  kept out of the main bundle; subsequent opens use them from disk cache.
- The open SQLite database is session-scoped: it does not survive a reload
  (re-open the file) and it is not bundled into the workspace archive;
  browsing is read-only, tables only (no views), and multiple `.sqlite`/`.db`
  files dropped at once resolve last-wins (see `MILESTONE-4.md`).
- Webhook notifications fire only for LIVE appends (rows arriving after a file
  first loads) — opening or reloading a file never POSTs. There is no retry and
  the endpoint should tolerate bursts (sends serialize, 5 s timeout each,
  1000-entry backlog cap dropping the oldest matches first). The target must
  allow cross-origin `POST application/json` from the page origin (browser CORS,
  preflight included). The webhook config is per-profile (IndexedDB) and is not
  bundled into the workspace archive (see `MILESTONE-4.md`).
