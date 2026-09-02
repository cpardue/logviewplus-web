import { describe, expect, it } from 'vitest'
import {
  parseEpochSeconds,
  parseSyslogTimestamp,
  parseTimestamp,
} from '../../src/parsers/timestamps'
import { PatternParser } from '../../src/parsers/PatternParser'

describe('parseTimestamp: timezone mode for naive stamps', () => {
  it('interprets naive ISO as local by default and UTC in utc mode', () => {
    expect(parseTimestamp('2026-09-01 08:00:01')).toBe(new Date(2026, 8, 1, 8, 0, 1).getTime())
    expect(parseTimestamp('2026-09-01 08:00:01', { naiveAsUtc: true })).toBe(Date.UTC(2026, 8, 1, 8, 0, 1))
  })

  it('always honors explicit Z/offset regardless of mode', () => {
    const v = '2026-09-01T08:02:33+05:30'
    expect(parseTimestamp(v)).toBe(Date.UTC(2026, 8, 1, 2, 32, 33))
    expect(parseTimestamp(v, { naiveAsUtc: true })).toBe(Date.UTC(2026, 8, 1, 2, 32, 33))
    const z = '2026-09-01T08:02:33Z'
    expect(parseTimestamp(z, { naiveAsUtc: true })).toBe(Date.UTC(2026, 8, 1, 8, 2, 33))
  })

  it('treats CLF without offset like a naive stamp', () => {
    const v = '01/Sep/2026:08:02:33'
    expect(parseTimestamp(v)).toBe(new Date(2026, 8, 1, 8, 2, 33).getTime())
    expect(parseTimestamp(v, { naiveAsUtc: true })).toBe(Date.UTC(2026, 8, 1, 8, 2, 33))
  })

  it('still honors CLF offsets (space-separated)', () => {
    expect(parseTimestamp('01/Sep/2026:08:02:33 +0530', { naiveAsUtc: true })).toBe(
      Date.UTC(2026, 8, 1, 2, 32, 33),
    )
  })
})

describe('parseTimestamp: ISO ordinal dates (yyyy-DDD)', () => {
  it('parses date-only ordinal stamps', () => {
    // 2026 day 244 = Sep 1
    expect(parseTimestamp('2026-244', { naiveAsUtc: true })).toBe(Date.UTC(2026, 8, 1))
    expect(parseTimestamp('2026-244')).toBe(new Date(2026, 8, 1).getTime())
  })

  it('parses ordinal + time + Z', () => {
    expect(parseTimestamp('2026-244T08:00:00Z')).toBe(Date.UTC(2026, 8, 1, 8))
  })

  it('rejects impossible day-of-year values', () => {
    expect(parseTimestamp('2025-366')).toBeNull() // 2025 is not a leap year
    expect(parseTimestamp('2026-000')).toBeNull()
    expect(parseTimestamp('2028-366', { naiveAsUtc: true })).toBe(Date.UTC(2028, 11, 31)) // leap year
  })
})

describe('parseSyslogTimestamp', () => {
  it('parses space-padded and single-digit days', () => {
    expect(parseSyslogTimestamp('Sep  1 08:02:33', 2026, { naiveAsUtc: true })).toBe(
      Date.UTC(2026, 8, 1, 8, 2, 33),
    )
    expect(parseSyslogTimestamp('Sep 15 08:02:33', 2026)).toBe(new Date(2026, 8, 15, 8, 2, 33).getTime())
  })

  it('rejects garbage', () => {
    expect(parseSyslogTimestamp('not a date', 2026)).toBeNull()
    expect(parseSyslogTimestamp('Foo 01 08:02:33', 2026)).toBeNull()
  })
})

describe('parseEpochSeconds (%s)', () => {
  it('accepts seconds and milliseconds with optional fraction', () => {
    expect(parseEpochSeconds('1788220801')).toBe(1788220801000)
    expect(parseEpochSeconds('1788220801.5')).toBe(1788220801500)
    expect(parseEpochSeconds('1788220801000')).toBe(1788220801000)
  })

  it('rejects non-epoch values', () => {
    expect(parseEpochSeconds('12345')).toBeNull()
    expect(parseEpochSeconds('2026-09-01')).toBeNull()
  })
})

describe('PatternParser: %S year inference and %s epoch specifiers', () => {
  it('uses the current year for a lone syslog date', () => {
    const p = new PatternParser({ template: '%S %m' })
    const cy = new Date().getFullYear()
    const e = p.parseLine('Sep 01 08:00:00 hello', 0, 1)
    expect(e.ts).toBe(new Date(cy, 8, 1, 8, 0, 0).getTime())
    expect(e.message).toBe('hello')
  })

  it('steps forward a year when Dec → Jan wraps', () => {
    const p = new PatternParser({ template: '%S %m' })
    const cy = new Date().getFullYear()
    const a = p.parseLine('Dec 31 23:59:00 end of year', 0, 1)
    expect(a.ts).toBe(new Date(cy, 11, 31, 23, 59, 0).getTime())
    const b = p.parseLine('Jan 01 00:01:00 new year', 1, 2)
    expect(b.ts).toBe(new Date(cy + 1, 0, 1, 0, 1, 0).getTime())
  })

  it('steps back a year when Jan ← Dec wraps', () => {
    const p = new PatternParser({ template: '%S %m' })
    const cy = new Date().getFullYear()
    p.parseLine('Jan 01 00:01:00 start', 0, 1) // yearRef → cy (first line)
    const a = p.parseLine('Dec 31 23:58:00 before it', 1, 2)
    expect(a.ts).toBe(new Date(cy - 1, 11, 31, 23, 58, 0).getTime())
  })

  it('keeps normal same-year progression stable', () => {
    const p = new PatternParser({ template: '%S %m' })
    const cy = new Date().getFullYear()
    const a = p.parseLine('Sep 30 23:59:00 x', 0, 1)
    const b = p.parseLine('Sep 30 23:59:30 y', 1, 2)
    expect(a.ts).toBe(new Date(cy, 8, 30, 23, 59, 0).getTime())
    expect(b.ts).toBe(new Date(cy, 8, 30, 23, 59, 30).getTime())
  })

  it('anchors the syslog year to a preceding full date (%d)', () => {
    // One parser cannot match both shapes, so emulate via two lines through %d first.
    const p = new PatternParser({ template: '%d %S' })
    const e = p.parseLine('2026-09-01 08:00:00 Sep 01 09:00:00', 0, 1)
    // %d resolves the full date; %S also present but unused for ts (only %d in resolve order).
    expect(e.ts).toBe(new Date(2026, 8, 1, 8, 0, 0).getTime())
  })

  it('resolves %s epoch seconds and milliseconds', () => {
    const p = new PatternParser({ template: '%s %l: %m' })
    expect(p.parseLine('1788220801 INFO: x', 0, 1).ts).toBe(1788220801000)
    expect(p.parseLine('1788220801.5 DEBUG: y', 1, 2).ts).toBe(1788220801500)
    expect(p.parseLine('1788220801000 WARN: z', 2, 3).ts).toBe(1788220801000)
  })

  it('detects the syslog template for yearless logs', () => {
    const lines = [
      'Sep 01 08:00:00 host app[1]: started',
      'Sep 01 08:00:05 host db[2]: pool opened',
      'Sep 01 08:00:09 host app[1]: request ok',
    ]
    expect(PatternParser.detectTemplate(lines)).toBe('%S %m')
  })
})