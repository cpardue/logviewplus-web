import { describe, expect, it } from 'vitest'
import * as arrow from 'apache-arrow'
import { mapArrowTableToResult, MAX_RESULT_ROWS } from '../../src/lib/sql/result'

/** Build a result-shaped table with the same explicit-type approach queries use. */
function resultTable(cols: Record<string, unknown[]>) {
  const fields = Object.entries(cols).map(([name, values]) => {
    let type: arrow.DataType
    if (values.some(v => typeof v === 'bigint')) type = new arrow.Int64()
    else if (values.every(v => typeof v === 'number' || v == null)) type = new arrow.Float64()
    else type = new arrow.Utf8()
    return new arrow.Field(name, type, true)
  })
  const vectors = Object.fromEntries(
    Object.entries(cols).map(([name, values]) => {
      const t = fields.find(f => f.name === name)!.type
      return [name, arrow.vectorFromArray(values as never[], t as never)]
    }),
  )
  return new arrow.Table(new arrow.Schema(fields), vectors as never)
}

describe('mapArrowTableToResult', () => {
  it('flattens columns into row-major cells preserving order and nulls', () => {
    const r = mapArrowTableToResult(
      resultTable({ level: ['INFO', null, 'WARN'], n: [3, 5, 7], name: ['a, b', "o'x", 'c'] }),
    )
    expect(r.columns).toEqual(['level', 'n', 'name'])
    expect(r.rows).toEqual([
      ['INFO', 3, 'a, b'],
      [null, 5, "o'x"],
      ['WARN', 7, 'c'],
    ])
    expect(r.truncated).toBe(false)
    expect(r.totalRows).toBe(3)
  })

  it('converts bigint cells to numbers', () => {
    const r = mapArrowTableToResult(resultTable({ total: [123456789012345n, null] }))
    expect(r.rows).toEqual([[123456789012345], [null]])
  })

  it('caps displayed rows at MAX_RESULT_ROWS and flags truncation', () => {
    const n = MAX_RESULT_ROWS + 10
    const idx = Array.from({ length: n }, (_, i) => i)
    const r = mapArrowTableToResult(resultTable({ idx }))
    expect(r.rows).toHaveLength(MAX_RESULT_ROWS)
    expect(r.rows[MAX_RESULT_ROWS - 1]).toEqual([MAX_RESULT_ROWS - 1])
    expect(r.truncated).toBe(true)
    expect(r.totalRows).toBe(n)
  })

  it('maps an empty result to empty columns/rows without truncation', () => {
    const r = mapArrowTableToResult(resultTable({ x: [] as unknown[] }))
    expect(r.columns).toEqual(['x'])
    expect(r.rows).toEqual([])
    expect(r.truncated).toBe(false)
  })
})
