import { describe, expect, it } from 'vitest'
import { MAX_RESULT_ROWS } from '../../src/lib/sql/result'
import { mapTableResult, normalizeCell, quoteIdent, sanitizeTableNames, stripQuotes } from '../../src/lib/sqlite/result'

describe('normalizeCell', () => {
  it('passes primitives through and maps null/undefined to null', () => {
    expect(normalizeCell(null)).toBeNull()
    expect(normalizeCell(undefined)).toBeNull()
    expect(normalizeCell('text')).toBe('text')
    expect(normalizeCell(42.5)).toBe(42.5)
    expect(normalizeCell(true)).toBe(true)
  })

  it('stringifies non-finite numbers and bigints (exact beyond double precision)', () => {
    expect(normalizeCell(NaN)).toBe('NaN')
    expect(normalizeCell(Infinity)).toBe('Infinity')
    expect(normalizeCell(9007199254740993n)).toBe('9007199254740993')
  })

  it('renders blobs as a byte marker and dates/objects in stable form', () => {
    expect(normalizeCell(new Uint8Array([1, 2, 3]))).toBe('<binary 3 bytes>')
    expect(normalizeCell(new Uint8Array([9]))).toBe('<binary 1 byte>')
    expect(normalizeCell(new Date('2026-09-03T12:00:00Z'))).toBe('2026-09-03T12:00:00.000Z')
    expect(normalizeCell({ a: 1 })).toBe('{"a":1}')
  })
})

describe('mapTableResult', () => {
  it('maps records to row-major cells in column order; missing keys are null', () => {
    const res = mapTableResult(
      ['id', 'name', 'active'],
      [
        { id: 1, name: 'alice', active: 1 },
        { id: 2, name: 'bob' }, // no `active` column in the record
      ],
      2,
    )
    expect(res.columns).toEqual(['id', 'name', 'active'])
    expect(res.rows).toEqual([
      [1, 'alice', 1],
      [2, 'bob', null],
    ])
    expect(res.totalRows).toBe(2)
    expect(res.truncated).toBe(false)
  })

  it('caps rows and flags truncation against the engine COUNT', () => {
    const records = Array.from({ length: 5 }, (_, i) => ({ n: i }))
    const res = mapTableResult(['n'], records, 5, 3)
    expect(res.rows).toEqual([
      [0],
      [1],
      [2],
    ])
    expect(res.totalRows).toBe(5)
    expect(res.truncated).toBe(true)
  })

  it('caps at the shared MAX_RESULT_ROWS in production shape', () => {
    const records = Array.from({ length: MAX_RESULT_ROWS + 1 }, (_, i) => ({ n: i }))
    const res = mapTableResult(['n'], records, MAX_RESULT_ROWS + 1)
    expect(res.rows.length).toBe(MAX_RESULT_ROWS)
    expect(res.totalRows).toBe(MAX_RESULT_ROWS + 1)
    expect(res.truncated).toBe(true)
    // and exactly at the cap there is no truncation
    const exact = mapTableResult(['n'], records.slice(0, MAX_RESULT_ROWS), MAX_RESULT_ROWS)
    expect(exact.truncated).toBe(false)
  })
})

describe('sanitizeTableNames', () => {
  it('drops internal sqlite_% tables, non-strings and empty names', () => {
    const res = sanitizeTableNames(['users', 'sqlite_sequence', 42, null, '', '   ', 'orders'])
    expect(res).toEqual(['orders', 'users'])
  })

  it('unquotes quoted names and dedupes case-insensitively (SQLite collation)', () => {
    const res = sanitizeTableNames(['"order"', 'ORDER', 'select'])
    // first occurrence wins for the display name; reserved words stay usable
    expect(res).toEqual(['order', 'select'])
  })

  it('sorts case-insensitively for a stable UI order', () => {
    expect(sanitizeTableNames(['Users', 'orders', 'Accounts'])).toEqual(['Accounts', 'orders', 'Users'])
  })

  it('returns [] when nothing qualifies', () => {
    expect(sanitizeTableNames([null, 'sqlite_master', 7])).toEqual([])
  })
})

describe('quoteIdent / stripQuotes', () => {
  it('double-quotes names and escapes embedded quotes', () => {
    expect(quoteIdent('users')).toBe('"users"')
    expect(quoteIdent('we"ird')).toBe('"we""ird"')
    expect(quoteIdent('order')).toBe('"order"')
  })

  it('rejects unusable names', () => {
    expect(quoteIdent('')).toBe('')
    expect(quoteIdent('   ')).toBe('')
    // @ts-expect-error — non-string input must be rejected, not crash
    expect(quoteIdent(null)).toBe('')
  })

  it('stripQuotes removes one pair of surrounding quotes only', () => {
    expect(stripQuotes('"users"')).toBe('users')
    expect(stripQuotes('users')).toBe('users')
    expect(stripQuotes('"')).toBe('"')
  })
})
