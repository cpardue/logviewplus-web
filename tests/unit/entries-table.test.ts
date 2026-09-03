import { describe, expect, it } from 'vitest'
import * as arrow from 'apache-arrow'
import { buildEntriesTable, entriesSchema } from '../../src/lib/sql/entries-table'
import type { LogEntry } from '../../src/parsers/types'

function row(over: Partial<LogEntry> = {}): LogEntry {
  return { seq: 0, ts: Date.UTC(2026, 8, 1, 8, 0, 1), level: 'INFO', message: 'm', raw: 'r', lineNo: 1, ...over }
}

describe('entriesSchema', () => {
  it('uses plain (non-dictionary) types so DuckDB-WASM accepts the table', () => {
    const fields = entriesSchema().fields
    expect(fields.map(f => f.name)).toEqual(['seq', 'ts_ms', 'ts_iso', 'level', 'message', 'raw', 'file', 'line_no'])
    // arrow infers JS string arrays as Dictionary<Utf8, Int32> — duckdb rejects
    // that, so every text column must be a bare Utf8.
    for (const name of ['ts_iso', 'level', 'message', 'raw', 'file']) {
      const f = fields.find(x => x.name === name)!
      expect(f.type).toBeInstanceOf(arrow.Utf8)
      expect(f.type instanceof arrow.Dictionary).toBe(false)
    }
    expect(fields[0].type).toBeInstanceOf(arrow.Int32)
    expect(fields[1].type).toBeInstanceOf(arrow.Float64)
  })

  it('keeps every field nullable to stay equivalent to vector inference', () => {
    // arrow v17 infers all vectors as nullable and Table(schema, columns)
    // rejects any stricter schema (see entriesSchema docs).
    const byName = Object.fromEntries(entriesSchema().fields.map((f) => [f.name, f.nullable]))
    expect(byName).toEqual({
      seq: true,
      ts_ms: true,
      ts_iso: true,
      level: true,
      message: true,
      raw: true,
      file: true,
      line_no: true,
    })
  })
})

describe('buildEntriesTable', () => {
  it('round-trips every column through the table rows', () => {
    const t = buildEntriesTable([
      row({ seq: 0, ts: Date.UTC(2026, 8, 1, 8, 0, 1), level: 'WARN', message: "a 'quote' , comma", raw: 'raw0', lineNo: 3, file: 'a.log' }),
      row({ seq: 1, ts: null, level: null, message: 'b', raw: 'raw1', lineNo: 4 }),
    ])
    expect(t.numRows).toBe(2)
    // toArray() yields StructRow instances; spread to plain objects for equality.
    const rows = (t.toArray() as unknown[]).map((r) => ({ ...(r as Record<string, unknown>) }))
    expect(rows[0]).toEqual({
      seq: 0,
      ts_ms: Date.UTC(2026, 8, 1, 8, 0, 1),
      ts_iso: '2026-09-01T08:00:01.000Z',
      level: 'WARN',
      message: "a 'quote' , comma",
      raw: 'raw0',
      file: 'a.log',
      line_no: 3,
    })
    expect(rows[1]).toEqual({ seq: 1, ts_ms: null, ts_iso: null, level: null, message: 'b', raw: 'raw1', file: null, line_no: 4 })
  })

  it('handles an empty entry set', () => {
    expect(buildEntriesTable([]).numRows).toBe(0)
  })

  it('stamps ts_iso from epoch ms for every row that has a ts', () => {
    const t = buildEntriesTable([row({ seq: 0, ts: Date.UTC(2030, 0, 2, 3, 4, 5, 6) })])
    const r = (t.toArray() as Record<string, unknown>)[0]
    expect(r.ts_iso).toBe('2030-01-02T03:04:05.006Z')
  })
})
