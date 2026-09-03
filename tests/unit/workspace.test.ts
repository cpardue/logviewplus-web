import { describe, expect, it } from 'vitest'
import type { Highlight } from '../../src/lib/highlights'
import {
  APP_VERSION,
  WORKSPACE_FORMAT,
  WORKSPACE_VERSION,
  WorkspaceError,
  buildWorkspace,
  mergeHighlights,
  parseWorkspace,
  workspaceToJson,
  type WorkspaceInput,
} from '../../src/lib/workspace'

const baseInput = (): WorkspaceInput => ({
  filters: { text: 'cache-host', levels: ['ERROR'] },
  tzMode: 'utc',
  savedFilters: [{ name: 'errors-only', filters: { text: 'cache-host', levels: [] }, savedAt: 111 }],
  rules: [{ id: 'r1', text: 'cache-host', levels: ['ERROR'], file: '', color: '#3fb950' }],
  highlights: [{ id: 'h1', file: 'mixed-levels.log', lineNo: 9, note: 'from spec' }],
  files: [{ name: 'mixed-levels.log', size: 1234, lines: 40, entries: 40, status: 'ready' }],
})

describe('buildWorkspace', () => {
  it('stamps format/version/appVersion and a savedAt (overridable)', () => {
    const a = buildWorkspace(baseInput(), 42)
    expect(a.format).toBe(WORKSPACE_FORMAT)
    expect(a.version).toBe(WORKSPACE_VERSION)
    expect(a.appVersion).toBe(APP_VERSION)
    expect(a.savedAt).toBe(42)
    const b = buildWorkspace(baseInput())
    expect(typeof b.savedAt).toBe('number')
  })

  it('deep-copies the input (later mutations do not leak into the archive)', () => {
    const input = baseInput()
    const a = buildWorkspace(input, 1)
    input.filters.levels.push('FATAL')
    input.rules[0].text = 'changed'
    input.highlights[0].note = 'changed'
    input.files[0].lines = 999
    expect(a.filters.levels).toEqual(['ERROR'])
    expect(a.rules[0].text).toBe('cache-host')
    expect(a.highlights[0].note).toBe('from spec')
    expect(a.files[0].lines).toBe(40)
  })
})

describe('workspaceToJson / parseWorkspace round-trip', () => {
  it('a built archive survives JSON serialization unchanged', () => {
    const a = buildWorkspace(baseInput(), 42)
    expect(JSON.parse(workspaceToJson(a))).toEqual(a)
  })

  it('parse rejects non-objects with a WorkspaceError', () => {
    for (const bad of [null, 'x', 42, true]) {
      expect(() => parseWorkspace(bad)).toThrow(WorkspaceError)
    }
  })

  it('parse rejects an unknown format and unsupported/missing versions', () => {
    expect(() => parseWorkspace({ format: 'nope' })).toThrow(/unknown format/)
    expect(() => parseWorkspace({ format: WORKSPACE_FORMAT, version: 2 })).toThrow(
      /Unsupported workspace version 2/,
    )
    expect(() => parseWorkspace({ format: WORKSPACE_FORMAT })).toThrow(/Unsupported workspace version/)
  })

  it('missing optional sections fall back to safe defaults', () => {
    const a = parseWorkspace({ format: WORKSPACE_FORMAT, version: 1 })
    expect(a.settings.tzMode).toBe('local')
    expect(a.filters).toEqual({ text: '', levels: [] })
    expect(a.savedFilters).toEqual([])
    expect(a.rules).toEqual([])
    expect(a.highlights).toEqual([])
    expect(a.files).toEqual([])
    expect(typeof a.savedAt).toBe('number')
  })

  it('sanitizes corrupt nested records without blocking the good ones', () => {
    const a = parseWorkspace({
      format: WORKSPACE_FORMAT,
      version: 1,
      savedAt: 7,
      settings: { tzMode: 'bogus' },
      filters: { text: 5, levels: ['ERROR', 'BOGUS', 3] },
      savedFilters: [
        { name: '', filters: { text: 'x', levels: [] } }, // dropped: empty name
        { name: 'ok', filters: { text: 'y', levels: ['FATAL'] } },
        'garbage',
      ],
      rules: [{ id: 'r1', text: 't', levels: ['ERROR'], file: '', color: '#3fb950' }, { noId: true }],
      highlights: [
        { id: 'h1', file: 'a.log', lineNo: 9, note: 'n' },
        { id: 'h2', file: 'a.log', lineNo: 0 }, // dropped: lineNo < 1
      ],
      files: [{ name: '', lines: 1 }, { name: 'b.log', size: -5, lines: 2.9, entries: 'x' }],
    })
    expect(a.settings.tzMode).toBe('local') // bogus mode → default
    expect(a.filters).toEqual({ text: '', levels: ['ERROR'] })
    expect(a.savedFilters).toHaveLength(1)
    expect(a.savedFilters[0]).toEqual({ name: 'ok', filters: { text: 'y', levels: ['FATAL'] }, savedAt: 7 })
    expect(a.rules).toHaveLength(1)
    expect(a.highlights).toHaveLength(1)
    expect(a.files).toEqual([{ name: 'b.log', size: 0, lines: 2, entries: 0, status: 'parsing' }])
  })
})

describe('mergeHighlights', () => {
  const local: Highlight[] = [
    { id: 'l1', file: 'a.log', lineNo: 3, note: 'local only' },
    { id: 'l2', file: 'a.log', lineNo: 9, note: 'stale note' },
  ]
  const incoming: Highlight[] = [
    { id: 'i1', file: 'a.log', lineNo: 9, note: 'archive wins' },
    { id: 'i2', file: 'a.log', lineNo: 40, note: 'new pin' },
  ]

  it('keeps local-only pins and appends new ones', () => {
    const merged = mergeHighlights(local, incoming)
    expect(merged.map(h => h.id)).toEqual(['l1', 'l2', 'i2'])
  })

  it('same (file, lineNo) identity keeps the local id but takes the archive note', () => {
    const merged = mergeHighlights(local, incoming)
    const at9 = merged.find(h => h.file === 'a.log' && h.lineNo === 9)
    expect(at9).toBeDefined()
    expect(at9!.id).toBe('l2')
    expect(at9!.note).toBe('archive wins')
  })

  it('does not mutate its inputs', () => {
    const before = JSON.stringify({ local, incoming })
    mergeHighlights(local, incoming)
    expect(JSON.stringify({ local, incoming })).toBe(before)
  })
})
