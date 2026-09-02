import { describe, expect, it } from 'vitest'
import { JsonLinesParser, resolveTs } from '../../src/parsers/JsonParser'
import type { JsonKeys } from '../../src/parsers/types'

const KEYS: JsonKeys = { tsKey: 'ts', levelKey: 'level', msgKey: 'msg' }

describe('JsonLinesParser.parse', () => {
  const p = new JsonLinesParser(KEYS)

  it('parses an ISO string timestamp and text level', () => {
    const [e] = p.parse('{"ts":"2026-09-01T08:00:01.000Z","level":"WARN","msg":"hi"}', 1)
    expect(e.ts).toBe(Date.UTC(2026, 8, 1, 8, 0, 1))
    expect(e.level).toBe('WARN')
    expect(e.message).toBe('hi')
    expect(e.raw).toBe('{"ts":"2026-09-01T08:00:01.000Z","level":"WARN","msg":"hi"}')
    expect(e.lineNo).toBe(1)
  })

  it('accepts epoch seconds and milliseconds (number or string)', () => {
    expect(resolveTs(1788220801)).toBe(1788220801000)
    expect(resolveTs(1788220801000)).toBe(1788220801000)
    expect(resolveTs('1788220801')).toBe(1788220801000)
    expect(resolveTs('2026-09-01T08:00:01Z')).toBe(Date.UTC(2026, 8, 1, 8, 0, 1))
    expect(resolveTs('nonsense')).toBeNull()
    expect(resolveTs(null)).toBeNull()
  })

  it('maps numeric syslog severities', () => {
    const [e] = p.parse('{"ts":1788220801,"level":3,"msg":"x"}', 1)
    expect(e.level).toBe('ERROR')
    const [f] = p.parse('{"ts":1788220801,"level":7,"msg":"x"}', 2)
    expect(f.level).toBe('DEBUG')
  })

  it('keeps invalid JSON lines as raw entries (no data loss)', () => {
    const [e] = p.parse('{not json', 5)
    expect(e.ts).toBeNull()
    expect(e.level).toBeNull()
    expect(e.message).toBe('{not json')
  })

  it('falls back to the whole JSON text when msg key is missing', () => {
    const [e] = p.parse('{"ts":"2026-09-01T08:00:01Z","other":42}', 2)
    expect(e.message).toBe('{"ts":"2026-09-01T08:00:01Z","other":42}')
  })

  it('treats top-level arrays/scalars as raw', () => {
    const [e] = p.parse('[1,2,3]', 3)
    expect(e.message).toBe('[1,2,3]')
    expect(e.ts).toBeNull()
  })

  it('uses alias-resolved keys (null key = field absent)', () => {
    const p2 = new JsonLinesParser({ tsKey: '@timestamp', levelKey: null, msgKey: 'message' })
    const [e] = p2.parse('{"@timestamp":"2026-09-01T08:00:01Z","message":"m"}', 1)
    expect(e.ts).toBe(Date.UTC(2026, 8, 1, 8, 0, 1))
    expect(e.level).toBeNull()
    expect(e.message).toBe('m')
  })
})
