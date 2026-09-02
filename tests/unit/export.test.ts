import { describe, expect, it } from 'vitest'
import { entriesToCsv, entriesToJson } from '../../src/lib/export'
import type { LogEntry } from '../../src/parsers/types'

function row(over: Partial<LogEntry> = {}): LogEntry {
  return { seq: 0, ts: Date.UTC(2026, 8, 1, 8, 0, 1), level: 'INFO', message: 'm', raw: 'r', lineNo: 1, ...over }
}

describe('entriesToCsv', () => {
  it('writes a header row plus one CSV line per entry', () => {
    const out = entriesToCsv([row()])
    const lines = out.split('\n')
    expect(lines[0]).toBe('ts_iso,ts_ms,level,message,raw,file,line_no')
    expect(lines[1]).toBe(`${new Date(Date.UTC(2026, 8, 1, 8, 0, 1)).toISOString()},${Date.UTC(2026, 8, 1, 8, 0, 1)},INFO,m,r,,1`)
    expect(lines).toHaveLength(2)
  })

  it('escapes quotes, commas and newlines', () => {
    const out = entriesToCsv([row({ message: 'a, "b"\nc' })])
    expect(out).toContain(`"a, ""b""` + '\n' + `c"`)
  })

  it('leaves null ts/level/file cells empty', () => {
    const out = entriesToCsv([row({ ts: null, level: null })])
    expect(out.split('\n')[1].startsWith(',,')).toBe(true)
  })
})

describe('entriesToJson', () => {
  it('emits pretty JSON without the positional seq field', () => {
    const parsed = JSON.parse(entriesToJson([row({ file: 'a.log' })]))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toEqual({
      ts: Date.UTC(2026, 8, 1, 8, 0, 1),
      level: 'INFO',
      message: 'm',
      raw: 'r',
      file: 'a.log',
      lineNo: 1,
    })
    expect(parsed[0]).not.toHaveProperty('seq')
  })

  it('nulls out a missing file', () => {
    const parsed = JSON.parse(entriesToJson([row()]))
    expect(parsed[0].file).toBeNull()
  })
})