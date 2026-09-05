// Deterministic encoding fixtures for M5-A (tests/unit/encoding.test.ts +
// tests/e2e/encoding.spec.ts). Re-run with: npm run gen:encodings
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'logs')
mkdirSync(OUT, { recursive: true })

/** Windows-1252 (ANSI): bytes map 1:1 from char codes < 256 via latin1. */
function w1252(lines) {
  return Buffer.from(lines.join('\r\n') + '\r\n', 'latin1')
}

/** UTF-16LE with BOM; CRLF line endings in 16-bit units. */
function utf16le(lines) {
  const bom = Buffer.from([0xff, 0xfe])
  const body = Buffer.concat(
    lines.map((l, i) =>
      Buffer.concat([Buffer.from(l, 'utf16le'), Buffer.from(i < lines.length - 1 ? '\r\n' : '', 'utf16le')]),
    ),
  )
  return Buffer.concat([bom, body])
}

/** Valid multi-byte UTF-8 (control case: auto-detect must stay utf-8). */
function utf8(lines) {
  return Buffer.from(lines.join('\n') + '\n', 'utf8')
}

// Legacy Windows service log. High bytes that are INVALID as UTF-8 sequences:
// é=0xE9, ï=0xEF, €=0x80 (0x80 only exists in 1252, not latin-1 — proves the
// label is really windows-1252 when decoded).
writeFileSync(
  join(OUT, 'win1252.log'),
  w1252([
    '2026-09-04 09:00:01 INFO: Service started by caf\u00E9 operator',
    '2026-09-04 09:00:02 DEBUG: Loaded settings from C:\\app\\conf',
    '2026-09-04 09:00:05 WARN: Invoice for M\u00FCller AG is \u00801,250.00 - overdue',
    '2026-09-04 09:00:08 INFO: Backup of donn\u00E9es completed',
    '2026-09-04 09:00:12 ERROR: Disk check failed on volume C:\\d\u00E9sign',
    '2026-09-04 09:00:15 INFO: User na\u00EFve.bird@exempel.se logged in',
    '2026-09-04 09:00:20 DEBUG: 42 sessions active on node-3',
    '2026-09-04 09:00:25 WARN: Retry 2/5 for upstream api',
    '2026-09-04 09:00:30 INFO: Heartbeat ok (1.2 ms)',
    '2026-09-04 09:00:35 ERROR: Unhandled exception in worker 7',
  ]),
)

// UTF-16LE with BOM — auto-detect via BOM; first line must NOT start with a
// zero-width no-break space (BOM stripped).
writeFileSync(
  join(OUT, 'utf16le.log'),
  utf16le([
    '2026-09-04 10:00:01 INFO: Unicode service online',
    '2026-09-04 10:00:02 DEBUG: Serving caf\u00E9 menu (12 items)',
    '2026-09-04 10:00:03 WARN: Disk C: free space below threshold',
  ]),
)

// Valid multi-byte UTF-8 (2-, 3- and 4-byte sequences) — stays utf-8.
writeFileSync(
  join(OUT, 'utf8-mb.log'),
  utf8([
    '2026-09-04 11:00:01 INFO: caf\u00E9 opening at noon',
    '2026-09-04 11:00:02 DEBUG: locale data loaded (caf\u00E9, na\u00EFve, \u00FCber)',
    '2026-09-04 11:00:03 WARN: \u65E5\u5FD7 rotation scheduled for 02:00',
  ]),
)

console.log('wrote win1252.log (10 lines), utf16le.log (3 lines), utf8-mb.log (3 lines)')
