import { describe, expect, it } from 'vitest'
import type { LogEntry } from '../../src/parsers/types'
import { highlightFor, HIGHLIGHT_ACCENT, isPinned, makeHighlight, sanitizeHighlights, type Highlight } from '../../src/lib/highlights'

function entry(patch: Partial<LogEntry> = {}): LogEntry {
  return {
    seq: 0,
    ts: null,
    level: 'INFO',
    message: 'plain message',
    raw: '2026-09-01 08:00:00 INFO: plain message',
    lineNo: 1,
    file: 'app.log',
    ...patch,
  }
}

function pin(patch: Partial<Highlight> = {}): Highlight {
  return { id: 'h1', file: 'app.log', lineNo: 1, note: '', ...patch }
}

describe('makeHighlight', () => {
  it('creates pins with unique ids, the given location and an empty note', () => {
    const a = makeHighlight('a.log', 7)
    const b = makeHighlight('a.log', 7)
    expect(a.id).not.toBe(b.id)
    expect(a).toEqual({ id: a.id, file: 'a.log', lineNo: 7, note: '' })
    expect(makeHighlight('', 123).file).toBe('')
  })

  it('exposes the row accent color constant', () => {
    expect(HIGHLIGHT_ACCENT).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('highlightFor / isPinned', () => {
  it('matches on the exact (file, lineNo) pair only', () => {
    const h = pin()
    expect(highlightFor([h], entry())).toBe(h)
    expect(highlightFor([h], entry({ lineNo: 2 }))).toBe(null) // same file, other line
    expect(highlightFor([h], entry({ file: 'other.log' }))).toBe(null) // same line, other file
    expect(highlightFor([h], entry({ lineNo: 2, file: 'other.log' }))).toBe(null)
  })

  it('returns the first pin in list order when several match (they should not)', () => {
    const a = pin({ id: 'a', note: 'first' })
    const b = pin({ id: 'b', note: 'second' })
    expect(highlightFor([a, b], entry())?.id).toBe('a')
    expect(highlightFor([b, a], entry())?.id).toBe('b')
  })

  it('treats an unknown entry file as "" (matches a pin stored with "")', () => {
    const h = pin({ file: '', lineNo: 5 })
    expect(highlightFor([h], entry({ file: undefined, lineNo: 5 }))).toBe(h)
    expect(highlightFor([h], entry({ file: 'app.log', lineNo: 5 }))).toBe(null)
  })

  it('isPinned mirrors highlightFor and returns false for an empty list', () => {
    expect(isPinned([], entry())).toBe(false)
    expect(isPinned([pin()], entry())).toBe(true)
    expect(isPinned([pin({ lineNo: 9 })], entry({ lineNo: 9 }))).toBe(true)
  })
})

describe('sanitizeHighlights', () => {
  it('keeps well-formed pins and coerces a missing note to ""', () => {
    const out = sanitizeHighlights([{ id: 'a', file: 'x.log', lineNo: 3, note: 'keep me' }, { id: 'b', file: 'y.log', lineNo: 4 }])
    expect(out).toEqual([
      { id: 'a', file: 'x.log', lineNo: 3, note: 'keep me' },
      { id: 'b', file: 'y.log', lineNo: 4, note: '' },
    ])
  })

  it('truncates fractional line numbers to the integer line', () => {
    expect(sanitizeHighlights([{ id: 'a', file: 'x', lineNo: 7.9, note: 'n' }])).toEqual([
      { id: 'a', file: 'x', lineNo: 7, note: 'n' },
    ])
  })

  it('drops corrupt members (no id / no file / bad lineNo) so a damaged DB cannot break the UI', () => {
    const out = sanitizeHighlights([
      null,
      'junk',
      { id: '', file: 'x', lineNo: 1 }, // empty id → dropped
      { file: 'x', lineNo: 1 }, // missing id → dropped
      { id: 'a', lineNo: 1 }, // missing file → dropped
      { id: 'b', file: 'x' }, // missing lineNo → dropped
      { id: 'c', file: 'x', lineNo: 0 }, // line numbers are 1-based
      { id: 'd', file: 'x', lineNo: -3 },
      { id: 'e', file: 'x', lineNo: '2' }, // string is not a number
      { id: 'f', file: 5, lineNo: 1 }, // non-string file → dropped
    ])
    expect(out).toEqual([])
  })

  it('returns [] for non-array input (corrupt/stale records)', () => {
    expect(sanitizeHighlights(undefined)).toEqual([])
    expect(sanitizeHighlights({ highlights: [] })).toEqual([])
    expect(sanitizeHighlights('"no"')).toEqual([])
  })
})