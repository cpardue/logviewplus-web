# M5 — Polish

Goal: the final polish areas from PLAN.md §5 — encodings/culture, the 1 GB+
performance pass, accessibility, and a docs section. M1–M4 shipped all
functional surface; this milestone makes the app robust at the edges
(non-UTF-8 logs), fast at the top (1 GB+ files), usable with keyboard and
screen readers, and documented end to end.

## In scope (per PLAN.md §5 + NEXT-STEPS §0)

1. **Encodings** — BOM detection (UTF-8 / UTF-16 LE / BE), auto-detect
   heuristic (strict UTF-8 validation over a leading sample → UTF-16
   zero-pattern → Windows-1252 fallback for legacy ANSI logs), per-file
   resolved encoding surfaced in the toolbar, user override select (Auto +
   four explicit encodings, persisted) applied to files opened after the
   change. Live tail and directory-monitor paths decode with the same rules.
   *Culture* (locale-dependent date grammars / display): evaluated and
   deliberately OUT of scope — our parsers match fixed timestamp formats and
   all display uses deterministic formatting; revisit on real demand.
2. **Performance pass (1 GB+)** — per `tests/perf.md` remaining bottlenecks:
   decode + `split('\n')` still run on the MAIN thread (move into the parse
   worker, transferring ArrayBuffers instead of text strings), and rows are
   held as plain objects (~1 GB heap at 1.4M rows — columnar / typed-array
   storage is what actually lifts the ~500 MB practical ceiling).
3. **Accessibility** — ARIA roles/labels on toolbar, filter/rule/note/webhook
   bars and tabs; keyboard operability + visible focus states; status
   announcements (aria-live) for parse/notify progress; color-contrast pass;
   AG Grid accessibility config.
4. **Docs section** — full feature reference in the README (every bar/button/
   setting from M1–M5, encoding table, Chromium/FSA caveats, limitations) +
   an in-app Docs view so users of the hosted site get the same reference
   without repo access.

## Tasks / checkpoints

1. **Checkpoint A — Encodings** (`src/lib/encoding.ts` detection core;
   `fileSource.ts` + `tail.ts` decoder labels; `pipeline.ts` resolution +
   `onEncoding` callbacks; store setting + per-file state; FilterBar select +
   Toolbar badge; fixtures + generator script; unit + E2E).
2. **Checkpoint B — Perf pass** (worker-side decode via transferred
   ArrayBuffers; columnar storage evaluation; `tests/perf.md` 1 GB re-measure).
3. **Checkpoint C — Accessibility** (roles/labels, keyboard, focus, live
   status, contrast, AG Grid a11y config; E2E smoke).
4. **Checkpoint D — Docs + closeout** (README feature reference, in-app Docs
   view, NEXT-STEPS §0, history entries).

## Checkpoint status

- [x] A — encodings (2026-09-04)
- [x] B — 1 GB+ performance pass (2026-09-05, ceiling documented + recommendation)
- [ ] C — accessibility
- [ ] D — docs section + closeout

## Acceptance criteria (Definition of Done — per checkpoint)

- All gate commands green: lint / unit / build / e2e (incl. the new spec(s)
  for the checkpoint).
- Checkpoint A: a Windows-1252 log with high bytes (é/ï/€, byte 0x80)
  auto-detects and decodes to the correct characters (no U+FFFD replacement);
  a BOM-prefixed UTF-16LE log is detected, its BOM stripped, and decoded;
  valid multi-byte UTF-8 stays UTF-8 (no regression on existing fixtures); an
  explicit override select (persisted across reloads) forces the chosen
  decoder for files opened afterwards; the resolved encoding is visible per
  file in the toolbar; tail/monitor sessions honor the same rules. — MET
  2026-09-04.
- Checkpoint B: worker owns decode + line splitting — main thread only reads
  `Blob` slices and **transfers** the ArrayBuffers (no string structured-clone);
  one leading 1 MiB chunk is still decoded on main solely for parser autodetect
  (same 200-line sample window as before). Same protocol serves parse, tail
  initial read, growth polls and post-rotation re-reads; tail keeps its
  always-streaming decode, parse flushes on the final chunk. Gates:
  lint / unit / build / e2e all green with NO change to any existing e2e spec
  (the M5-A encoding specs — auto-1252, UTF-16LE BOM strip, forced-UTF-8
  U+FFFD — must pass unmodified against the worker decode path). Perf:
  10 MB < 3 s target (< 5 s gate) and 100 MB completes + scrolls with no
  regression vs the M5-A baseline (460 ms / 3868 ms); a 1 GB generated fixture
  is parsed in-browser and the run (complete or crash point, with timings and
  heap) is recorded in `tests/perf.md`. Columnar/typed-array row storage is
  EVALUATED with measured per-row heap numbers (plain objects vs columnar at
  the 100 MB fixture's 1.4M-row scale) plus the AG Grid display-side analysis;
  a written verdict + recommendation lands in `tests/perf.md` and the as-built
  notes. Full row-storage rewrite, if warranted, is scoped as follow-up work,
  not part of B. — MET 2026-09-05 (see as-built note; the 1 GB stall point is
  recorded as the known ceiling with a written recommendation).
- Checkpoint C: _written when started._
- Checkpoint D: _written when started._

## As-built notes

- **Checkpoint A — encodings (DONE 2026-09-04).** `src/lib/encoding.ts` =
  pure byte core: `detectBom` (UTF-8/UTF-16LE/BE), `isStrictUtf8` (lead/
  continuation shapes, truncation, overlong encodings, U+10FFFF bound),
  `detectEncoding` (order: BOM → UTF-16 zero-parity heuristic → no-high-bytes
  → strict-UTF-8 → windows-1252 fallback) and `resolveFromSample` /
  `resolveFromBlob` (explicit choice wins the label; a BOM is skipped only
  when it matches the chosen label). Detection samples the first 64 KiB
  (`SAMPLE_BYTES`). Wiring: `fileSource.readTextChunks(blob, chunkSize,
  resolution)` starts at `bomLength` and decodes under the resolved
  `TextDecoder` label (streaming — UTF-16 units split across 1 MiB slices
  survive); `TailFeed` takes the same resolution (constructor + `reset()`
  keep the label; initial offset starts past the BOM); `pipeline.startParse`
  resolves via one leading Blob read, `startTail` via a leading source slice
  BEFORE the first pump, both reporting through an optional `onEncoding`
  callback. Store: persisted `encoding` setting (`lvp.encoding` localStorage,
  mirrors `tzMode`) applied to every open path (addFiles / beginTail →
  manual tail + directory monitor); `FileState.encoding` carries the resolved
  label, shown as a toolbar badge (`file-encoding` testid). FilterBar gained
  the Encoding select next to Naive times (`encoding-select`). Culture
  (locale date grammars/display): evaluated and OUT of scope — fixed timestamp
  formats + deterministic display; revisit on real demand.
  Decisions: sample-based (not whole-file) validation keeps the hot path flat
  for 1 GB files — full-file validation becomes cheap when M5-B moves decode
  into the worker; UTF-16 parity check runs BEFORE the pure-ASCII shortcut
  because BOM-less UTF-16 of ASCII text has no high bytes at all (caught by a
  unit test); mismatched BOM + explicit choice decodes the BOM bytes as
  garbage — documented user-misconfiguration behavior, not "fixed" silently.
  Limitations: 64 KiB sample (mixed-encoding tails misread → override);
  override affects files opened afterwards only (reopen to re-decode);
  Windows-1252 chosen as the single ANSI fallback (covers the common Western
  logs; other legacy codepages need an explicit choice).
  Tests: `tests/unit/encoding.test.ts` (31 tests — validator edge cases, BOM,
  detection order incl. BOM-less UTF-16 both endiannesses, override/BOM-skip
  matrix, decoder-label round-trips, readTextChunks chunk-boundary reassembly
  for UTF-8/UTF-16/1252 + BOM-only files, TailFeed label/reset) +
  `tests/e2e/encoding.spec.ts` (5 specs — auto 1252 incl. real `€` byte 0x80,
  BOM'd UTF-16LE strip, multi-byte UTF-8 no-regression, forced-UTF-8 override
  producing U+FFFD, reload persistence). Fixtures: deterministic
  `win1252.log` / `utf16le.log` / `utf8-mb.log` via `npm run gen:encodings`.
  Gates after A: lint clean; unit 235/235 (26 files, +31); build ok (main
  bundle unchanged in shape — detection core is a few kB); e2e 44 passed (39
  existing + 5 new, perf tests skipped per base-run convention) and the perf
  gates re-run after the change: 10 MB 460 ms / 100 MB 3868 ms — no regression
  (M4-F baseline 577/3924).
   gates re-run after the change: 10 MB 460 ms / 100 MB 3868 ms — no regression
   (M4-F baseline 577/3924).
- **Checkpoint B — perf pass (DONE 2026-09-05).** Decode + line splitting now
  live in the parse worker: `fileSource.readByteChunks` yields raw 1 MiB
  ArrayBuffers (BOM-offset start; empty-file EOF contract), the worker owns a
  persistent streaming `StreamDecoder` per file (created at `init` from the
  encoding label, reset with the engine on rotation) and chunk messages carry
  **transferred** buffers + a `stream` flag — parse flushes on the final
  chunk, tail always streams. `TailFeed` emits raw bytes; `startParse`/
  `startTail` decode one leading 1 MiB on main solely for parser autodetect
  (unchanged 200-line window). Same protocol serves parse, tail initial read,
  growth polls and post-rotation re-reads. `scripts/gen-large.ts` writes in
  chunks (a single 1 GB join hits V8's ~512 MB max string length); output
  verified byte-identical by SHA-256 against the pre-change 10 MB fixture.
  Perf: baseline captured pre-change (497 ms / 4269 ms); after, quiet runs
  513 ms / 3982 ms and 480 ms / 3861 ms — no regression (high-load runs
  881–922 / 8200–8563 ms are environmental noise, per M2/M3 pattern; all
  numbers in `tests/perf.md` M5-B section). 1 GB re-measure (13,976,799-line
  fixture): the worker parse is linear and no longer the bottleneck — the
  MAIN-thread store drain stalls at ~98% after ~14 min (~100 rows/s; renderer
  alive, in swap; grid phase never reached). A Node control probe shows the
  bare 13.98M-row append loop takes 3.6 s (with a ~5x tail-growth slowdown),
  so the ceiling is renderer memory exhaustion, not the drain mechanic.
  Columnar evaluation at the 1.4M-row scale: plain objects 328 B/row vs
  simple columnar 248 B/row (−24%, text floor 132 B/row) — a structural
  saving that does NOT lift the ceiling, because (a) the IPC drain stays
  object-by-object unless workers post transferred column buffers, and (b)
  AG Grid Community's eager ClientSideRowModel adds ~260 B/row of display
  heap (~3.5+ GB at 14M rows) no matter how entries are stored. Recommendation
  (M6 candidate, written in `tests/perf.md`): columnar typed-array storage +
  transferred buffers, a >1–2M-row display strategy (Enterprise
  ServerSideRowModel / capped display / DuckDB-as-engine), optional DuckDB as
  the record store for >1 GB files. The 1 GB probe spec is kept as a
  KNOWN-FAILING ceiling canary gated behind `PERF_1000`.
  Gates after B: lint clean; unit 238/238 (27 files, +streamDecoder); build
  ok; base e2e 44 passed / 3 skipped (perf specs env-gated); M5-A encoding
  specs unmodified and green; perf gates re-run as above.
