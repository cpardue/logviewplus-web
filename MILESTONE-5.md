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
- [ ] B — 1 GB+ performance pass
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
- Checkpoint B: _written when started._
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
