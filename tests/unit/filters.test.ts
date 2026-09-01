import { describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, applyFilters } from '../../src/lib/filters'
import type { LogEntry } from '../../src/parsers/types'

const E = (seq: number, level: LogEntry['level'], message: string): LogEntry => ({
  seq,
  ts: null,
  level,
  message,
  raw: message,
  lineNo: seq + 1,
})

const rows = [
  E(0, 'INFO', 'Loaded config from /etc/app/config.yml'),
  E(1, 'WARN', 'Deprecated option in config'),
  E(2, null, '#Fields: date time s-site'),
  E(3, 'ERROR', 'Cache down — see CONFIG.md for details'),
]

describe('applyFilters', () => {
  it('returns the same array when no filter is active', () => {
    expect(applyFilters(rows, EMPTY_FILTERS)).toBe(rows)
  })

  it('level filter keeps only selected levels (null-level entries excluded)', () => {
    const out = applyFilters(rows, { text: '', levels: ['WARN'] })
    expect(out.map(r => r.seq)).toEqual([1])
  })

  it('text filter is case-insensitive', () => {
    const out = applyFilters(rows, { ...EMPTY_FILTERS, text: 'CONFIG' })
    expect(out.map(r => r.seq)).toEqual([0, 1, 3])
  })

  it('combines text and level filters', () => {
    const out = applyFilters(rows, { text: 'config', levels: ['WARN'] })
    expect(out.map(r => r.seq)).toEqual([1])
  })

  it('empty level list means all levels (including null)', () => {
    const out = applyFilters(rows, { text: '', levels: [] })
    expect(out.map(r => r.seq)).toEqual([0, 1, 2, 3])
  })
})
