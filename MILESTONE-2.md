# M2 — Parser Breadth + Dates + Merge + Ingest + Persistence + Export

Goal: parse the other real-world log formats (W3C/combined, JSON lines, Log4j XML,
DSV), resolve dates properly (timezones, yearless syslog stamps, ordinal dates,
`%S`/`%s` specifiers), merge multiple files into one dataset, ingest from zip and
clipboard, persist saved filters, and export filtered entries.

## In scope (per PLAN.md §5, suggested order)

1. **Parser breadth** — W3C extended (`iis-u_ex.log` ships), classic
   common/combined (`apache-combined.log`), JSON lines (`app.json` ships),
   Log4j 1.x/2 XML (`log4j.xml`), DSV (TSV/CSV). Richer autodetect over the first
   sample chunk. `PatternParser` remains the user-pattern engine and fallback.
2. **Date resolution rules** — timezone mode for naive stamps (Local/UTC),
   yearless syslog dates (`%S`) with year inference, epoch seconds (`%s`),
   ISO ordinal dates (`yyyy-DDD`).
3. **Merge** — "All" view combining every ready file into one dataset
   (`LogEntry.file` populated; File column in the grid).
4. **Zip / clipboard ingest** — drop/pick `.zip` (fflate), paste text,
   `navigator.clipboard.readText()` button.
5. **Saved filters + persistence** — named filter sets in IndexedDB (idb).
6. **Export** — filtered rows to CSV or JSON (blob download).

## Tasks

1. **Parser core M2** (`src/parsers/`) — `LogParser` interface (line → 0..n draft
   entries, engine assigns `seq`; optional EOF `finish()`), `JsonLinesParser`,
   `W3cParser`, `CombinedParser`, `DsvParser`, `XmlLog4jParser` (stateful),
   `detectFormat()` replacing bare template autodetect; worker `init` carries a
   `ParserSpec`; engine stamps `entry.file`. **DONE 2026-09-02.**
2. **Date rules** — `parseTimestamp` gains naive-timezone mode + ordinal dates;
   `%S`/`%s` specifiers; year inference state for `%S`; UI timezone select. **DONE 2026-09-02.**
3. **Merge view** — "All" tab, aggregate toolbar, File column.
4. **Zip / clipboard** — fflate unzip to `File`s, text-paste dropzone path,
   clipboard button.
5. **Saved filters** — `src/lib/db.ts` (idb), save/apply/delete in FilterBar.
6. **Export** — CSV/JSON of the currently filtered rows.
7. **Tests/docs** — new fixtures, unit tests per parser + detect, E2E for
   autodetect + merge + zip + export, perf re-check (10/100 MB), README.

## New fixtures (ship in repo; small)

- `tests/fixtures/logs/apache-combined.log` — classic combined/common lines
  (12 lines; 4×4xx, 2×5xx).
- `tests/fixtures/logs/csv-log.csv` — comma DSV: timestamp, level, message
  (8 lines incl. header).
- `tests/fixtures/logs/log4j.xml` — log4j 1.x XML events (5 events; one
  multi-line message, one `&amp;` entity).

## Acceptance criteria (Definition of Done)

- [ ] All gate commands green: lint / unit / build / e2e (incl. new specs)
- [ ] Autodetect picks the right parser for every shipped fixture (unit-tested)
- [ ] `%S`/`%s` specifiers + ordinal dates + tz mode covered by unit tests
- [ ] Merge view shows all files with File column; E2E asserts combined counts
- [ ] Zip drop and clipboard paste ingest parse into the grid (E2E where possible)
- [ ] Saved filters survive a page reload (IndexedDB); E2E save/apply
- [ ] Export CSV/JSON of filtered rows downloads with correct row count (E2E)
- [ ] Perf re-check: 10 MB < 5 s gate still passes; numbers in `tests/perf.md`
- [ ] README updated; NEXT-STEPS §0 truthful; history entry written

## As-built notes (deviations from plan)

- **M2.1 (2026-09-02):** autodetect order is JSON → W3C → combined → log4j-XML
  → DSV → pattern-template fallback. W3C/combined derive level from the status
  code (5xx→ERROR, 4xx→WARN, else null); JSON maps numeric syslog severities
  0–7; DSV requires ≥95% delimiter consistency and picks ts/level columns at
  ≥50% parse rate; XML parser is stateful with a 200 KB idle-buffer guard and a
  best-effort EOF flush. `LogParser.parse(line, lineNo)` returns draft entries;
  the engine assigns `seq` and stamps `entry.file`.
- **M1 latent bug fixed in M2.1:** CLF timestamps with a space-separated offset
  (`01/Sep/2026:08:02:33 +0000`) had their offset silently dropped (the regex
  only accepted a bare offset); `DATE_PATTERN` and `CLF_RE` now capture the
  space + offset, so real offsets are honored. `specifiers.test.ts` updated to
  the corrected semantics.
- **M2.2 (2026-09-02):** new specifiers `%S` (syslog date, no year) and `%s`
  (epoch seconds/ms). `%S` year inference (PatternParser state): the last
  full-year `%d` anchors the reference year; a resolution landing >48 h in the
  future steps back one year, >355 d in the past steps forward one year — both
  direction covers Dec→Jan and Jan←Dec wraps. `parseTimestamp` gains ISO
  ordinal dates (`yyyy-DDD`, leap-year validated) and a `naiveAsUtc` option for
  zone-less values (ISO-naive, CLF-without-offset, ordinal time-of-day);
  explicit Z/offset always wins. The mode is a persisted UI setting
  ("Naive times: Local/UTC" in the filter bar, localStorage `lvp.tzMode`)
  applied at parse time to every parser via the worker `init` message — files
  must be reopened after changing it.
