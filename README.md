# LogViewPlus Web

Client-side web application that emulates the core log-analysis features of
LogViewPlus (Clearcove Ltd) and is deployed statically to GitHub Pages.

This is a **clean-room reimplementation** built from the public documentation at
logviewplus.com/docs. It is not affiliated with, endorsed by, or derived from
the source code of LogViewPlus, which is closed-source commercial software.
Intended for personal/internal use (GitHub Pages ToS prohibits commercial SaaS).

## Status

**Milestone 2 complete (2026-09-02):** on top of M1 — auto-detected
multi-format parsing (custom `%d %l: %m`-style patterns, IIS W3C, Apache
common/combined, JSON lines, Log4j XML, CSV/TSV), richer date rules
(naive-timestamp timezone mode, yearless syslog dates, epoch + ISO ordinal
dates), a merged "All" view with a File column, zip / clipboard ingest, saved
filters persisted in IndexedDB, and CSV/JSON export of the filtered rows.

- `PLAN.md` — repo scaffold, tech stack, deployment design, constraints, roadmap
- `MILESTONE-1.md` — M1 tasks + acceptance criteria (done)
- `MILESTONE-2.md` — M2 tasks + acceptance criteria (done)
- `tests/perf.md` — measured performance numbers (M1 + M2 re-check)

## Usage

Open the site, then drag & drop log files anywhere or use **Open files…**
(multiple files get tabs; `.zip` drops extract into one tab per member and
pasted text becomes a synthetic file). Formats are auto-detected per file. Per
file you get: name, size, live parse progress, entries/lines + elapsed time;
Time / Level / Message (+ File in merged view) columns with level row
coloring; a case-insensitive text filter and level chips that apply to the
parsed data without re-parsing; saved filter sets persisted in IndexedDB;
CSV/JSON export of the filtered rows; and a "Naive times: Local/UTC" setting
for zone-less timestamps. All parsing happens locally in your browser — files
are never uploaded.

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
`npm run git:push` (isomorphic-git; the dev machine has no system git binary).

## Performance (measured)

| Scenario | Gate | Measured |
| --- | --- | --- |
| 10 MB → parse + full grid ready | < 3 s (M2 gate < 5 s) | **0.74 s** warm / 2.6 s cold (M1); **1.34–1.55 s** (M2 re-check, 2026-09-02) |
| 100 MB → completes, no tab crash, scrolls | completes + scrolls | **5.4 s** (M1); **9.5–10.2 s** (M2 re-check — noisy machine, see `tests/perf.md`) |

Details and how to reproduce: `tests/perf.md`.

## Known limitations

- Naive timestamps (no timezone) follow the "Naive times" setting (default
  Local); changing it only affects files opened afterwards — already-opened
  files must be reopened.
- Saved filters are stored per browser profile in IndexedDB (client-side only;
  clearing site data clears them).
- Memory ≈ 1 GB heap at 100 MB / 1.4M rows — practical ceiling ~500 MB files
  before columnar/typed-array storage (M3 work).
- No tail-following yet; M3 also brings SQL reporting via DuckDB-WASM (per
  `PLAN.md`).
