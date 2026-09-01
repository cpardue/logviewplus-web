import { describe, expect, it } from 'vitest'
import { PatternParser } from '../../src/parsers/PatternParser'
import { normalizeLevel } from '../../src/parsers/levels'

describe('PatternParser.parseLine', () => {
  const p = new PatternParser() // default template '%d %l: %m'

  it('parses a naive ISO timestamp as local time', () => {
    const e = p.parseLine('2026-09-01 08:00:01 INFO: hello', 0, 1)
    expect(e.ts).toBe(new Date(2026, 8, 1, 8, 0, 1).getTime())
    expect(e.level).toBe('INFO')
    expect(e.message).toBe('hello')
    expect(e.raw).toBe('2026-09-01 08:00:01 INFO: hello')
    expect(e.lineNo).toBe(1)
  })

  it('parses UTC (Z) timestamps with sub-second precision', () => {
    const e = new PatternParser({ template: '%d %m' }).parseLine(
      '2026-09-01T08:02:33.123456Z GC(41) Pause Young 245M->98M 1.2ms',
      0,
      1,
    )
    expect(e.ts).toBe(Date.UTC(2026, 8, 1, 8, 2, 33, 123))
    expect(e.level).toBeNull()
    expect(e.message).toBe('GC(41) Pause Young 245M->98M 1.2ms')
  })

  it('parses explicit UTC offsets', () => {
    const e = new PatternParser({ template: '%d %m' }).parseLine(
      '2026-09-01T13:32:33+05:30 offset check',
      0,
      1,
    )
    expect(e.ts).toBe(Date.UTC(2026, 8, 1, 8, 2, 33))
  })

  it('parses Apache CLF timestamps with timezone', () => {
    const e = new PatternParser({ template: '%d %m' }).parseLine(
      '01/Sep/2026:08:02:33 +0000 GET /index.html 200',
      0,
      1,
    )
    expect(e.ts).toBe(Date.UTC(2026, 8, 1, 8, 2, 33))
  })

  it('normalizes level aliases and rejects unknown tokens', () => {
    expect(normalizeLevel('warning')).toBe('WARN')
    expect(normalizeLevel('SEVERE')).toBe('ERROR')
    expect(normalizeLevel('finest')).toBe('TRACE')
    expect(normalizeLevel('not-a-level')).toBeNull()
    expect(normalizeLevel(null)).toBeNull()
  })

  it('keeps unmatched lines as raw entries (no data loss)', () => {
    const e = p.parseLine('#Fields: date time s-site', 7, 8)
    expect(e.ts).toBeNull()
    expect(e.level).toBeNull()
    expect(e.message).toBe('#Fields: date time s-site')
    expect(e.raw).toBe(e.message)
    expect(e.seq).toBe(7)
  })

  it('keeps ts but drops unknown level tokens', () => {
    const e = p.parseLine('2026-09-01 08:00:01 WEIRDLEVEL: x', 0, 1)
    expect(e.ts).toBe(new Date(2026, 8, 1, 8, 0, 1).getTime())
    expect(e.level).toBeNull() // 'WEIRDLEVEL' is not a known level
    expect(e.message).toBe('x')
  })
})

describe('PatternParser.detectTemplate', () => {
  it('picks the level template for app logs', () => {
    const lines = [
      '2026-09-01 08:00:01 INFO: a',
      '2026-09-01 08:00:02 WARN: b',
      '2026-09-01 08:00:03 ERROR: c',
    ]
    expect(PatternParser.detectTemplate(lines)).toBe('%d %l: %m')
  })

  it('picks the message-only template for GC logs', () => {
    const lines = [
      '2026-09-01T08:02:33.123456Z GC(41) Pause Young 245M->98M 1.2ms',
      '2026-09-01T08:02:34.543210Z GC(42) Pause Full 300M->96M 142ms',
    ]
    expect(PatternParser.detectTemplate(lines)).toBe('%d %m')
  })

  it('falls back to the default template for empty samples', () => {
    expect(PatternParser.detectTemplate([])).toBe('%d %l: %m')
  })
})
