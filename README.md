# LogViewPlus Web

Client-side web application that emulates the core log-analysis features of
LogViewPlus (Clearcove Ltd) and is deployed statically to GitHub Pages.

This is a **clean-room reimplementation** built from the public documentation at
logviewplus.com/docs. It is not affiliated with, endorsed by, or derived from
the source code of LogViewPlus, which is closed-source commercial software.
Intended for personal/internal use (GitHub Pages ToS prohibits commercial SaaS).

## Status

**Milestone 1 complete (2026-09-01):** open local log files, stream-parse them
in a Web Worker with an LVP-style pattern parser, and browse results in a
virtualized grid with text + level filtering.

- `PLAN.md` — repo scaffold, tech stack, deployment design, constraints, roadmap
- `MILESTONE-1.md` — M1 tasks + acceptance criteria (done)
- `tests/perf.md` — measured performance numbers

## Usage

Open the site, then drag & drop log files anywhere or use **Open files…**
(multiple files get tabs). Per file you get: name, size, live parse progress,
entries/lines + elapsed time; Time / Level / Message columns with level row
coloring; a case-insensitive text filter and level chips that apply to the
parsed data without re-parsing. All parsing happens locally in your browser —
files are never uploaded.

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
| 10 MB → parse + full grid ready | < 3 s | **0.74 s** warm / 2.6 s cold |
| 100 MB → completes, no tab crash, scrolls | completes + scrolls | **5.4 s**, scroll OK |

Details and how to reproduce: `tests/perf.md`.

## Known limitations (M1)

- Pattern parser only (`%d %l: %m` default, light autodetect over
  `%d [%t] %l: %m` / `%d %m`). The IIS W3C and JSON-lines fixtures ship now for
  the M2 parser types.
- Naive timestamps (no timezone) are interpreted as local time.
- Memory ≈ 1 GB heap at 100 MB / 1.4M rows — practical ceiling ~500 MB files
  before columnar/typed-array storage (M2 work).
- No persistence, export, merge, zip/clipboard ingest, or tail yet
  (M2/M3 per `PLAN.md`).
