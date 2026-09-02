import { describe, expect, it } from 'vitest'
import { DsvParser } from '../../src/parsers/DsvParser'

describe('DsvParser.parse', () => {
  const p = new DsvParser(',', 0, 1)

  it('parses ts/level columns and joins the rest into the message', () => {
    const [e] = p.parse('2026-09-01 08:00:05,INFO,Processed 1000 records', 3)
    expect(e.ts).toBe(new Date(2026, 8, 1, 8, 0, 5).getTime()) // naive → local
    expect(e.level).toBe('INFO')
    expect(e.message).toBe('Processed 1000 records')
    expect(e.raw).toBe('2026-09-01 08:00:05,INFO,Processed 1000 records')
  })

  it('leaves null ts/level when the columns do not parse', () => {
    const [e] = p.parse('timestamp,level,message', 1) // header row
    expect(e.ts).toBeNull()
    expect(e.level).toBeNull()
    expect(e.message).toBe('message') // only the non-ts/level cells remain
  })

  it('works with tabs and no level column', () => {
    const pt = new DsvParser('\t', 0, null)
    const [e] = pt.parse('2026-09-01T08:00:05Z\tERROR\tdisk full', 4)
    expect(e.ts).toBe(Date.UTC(2026, 8, 1, 8, 0, 5))
    expect(e.level).toBeNull() // levelCol null — column is just message text
    expect(e.message).toBe('ERROR | disk full')
  })

  it('parses the csv-log fixture end to end', async () => {
    const { readFileSync } = await import('node:fs')
    const content = readFileSync('tests/fixtures/logs/csv-log.csv', 'utf8')
    const lines = content.split('\n').filter(l => l.trim() !== '')
    const entries = lines.flatMap((l, i) => p.parse(l, i + 1))
    expect(entries).toHaveLength(8) // header + 7 data
    expect(entries.filter(e => e.level === 'ERROR')).toHaveLength(1)
    expect(entries.filter(e => e.level === 'FATAL')).toHaveLength(1)
    expect(entries.filter(e => e.level === 'WARN')).toHaveLength(2)
    expect(entries.filter(e => e.ts != null)).toHaveLength(7) // header row has none
  })
})