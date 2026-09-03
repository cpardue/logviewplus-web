import { describe, expect, it } from 'vitest'
import type { LogEntry } from '../../src/parsers/types'
import { makeRule, RULE_COLORS, resolveRowColor, ruleMatches, sanitizeRules, type Rule } from '../../src/lib/rules'

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

function rule(patch: Partial<Rule> = {}): Rule {
  return { id: 'r1', text: '', levels: [], file: '', color: '#f85149', ...patch }
}

describe('ruleMatches', () => {
  it('matches everything for a fully empty rule (except: nothing is set)', () => {
    expect(ruleMatches(rule(), entry())).toBe(true)
    expect(ruleMatches(rule(), entry({ level: null }))).toBe(true)
    expect(ruleMatches(rule(), entry({ file: undefined }))).toBe(true)
  })

  it('text is a case-insensitive substring on message OR raw', () => {
    const r = rule({ text: 'PLAIN' })
    expect(ruleMatches(r, entry())).toBe(true) // message hit
    expect(
      ruleMatches(r, entry({ message: 'other', raw: 'prefix plain suffix' })),
    ).toBe(true) // raw-only hit
    expect(ruleMatches(r, entry({ message: 'nope', raw: 'nothing here' }))).toBe(false)
  })

  it('levels: empty matches all including null-level entries; otherwise exact membership', () => {
    expect(ruleMatches(rule(), entry({ level: null }))).toBe(true)
    expect(ruleMatches(rule({ levels: ['ERROR'] }), entry({ level: 'ERROR' }))).toBe(true)
    expect(ruleMatches(rule({ levels: ['ERROR'] }), entry({ level: 'WARN' }))).toBe(false)
    expect(ruleMatches(rule({ levels: ['ERROR', 'WARN'] }), entry({ level: 'WARN' }))).toBe(true)
    expect(ruleMatches(rule({ levels: ['ERROR'] }), entry({ level: null }))).toBe(false)
  })

  it('file is a case-insensitive substring on the source file name', () => {
    const r = rule({ file: 'APP' })
    expect(ruleMatches(r, entry({ file: 'app.log' }))).toBe(true)
    expect(ruleMatches(r, entry({ file: 'web-app.log' }))).toBe(true) // substring
    expect(ruleMatches(r, entry({ file: 'other.log' }))).toBe(false)
    expect(ruleMatches(r, entry({ file: undefined }))).toBe(false) // no file → never matches
  })

  it('conditions combine with AND', () => {
    const r = rule({ text: 'plain', levels: ['INFO'], file: 'app' })
    expect(ruleMatches(r, entry())).toBe(true)
    expect(ruleMatches(r, entry({ level: 'WARN' }))).toBe(false)
    expect(ruleMatches(r, entry({ message: 'x', raw: 'x' }))).toBe(false) // neither field
    expect(ruleMatches(r, entry({ file: 'other.log' }))).toBe(false)
  })
})

describe('resolveRowColor', () => {
  it('returns the first matching rule color (list order = priority)', () => {
    const a = rule({ id: 'a', color: '#111111' })
    const b = rule({ id: 'b', text: 'plain', color: '#222222' })
    expect(resolveRowColor([a, b], entry())).toBe('#111111') // a matches first
    expect(resolveRowColor([b, a], entry())).toBe('#222222') // reordered → b wins
  })

  it('skips non-matching rules and returns the next match', () => {
    const never = rule({ id: 'n', levels: ['FATAL'] })
    const hit = rule({ id: 'h', text: 'plain', color: '#333333' })
    expect(resolveRowColor([never, hit], entry())).toBe('#333333')
  })

  it('returns null when nothing matches (including an empty rule list)', () => {
    expect(resolveRowColor([], entry())).toBe(null)
    expect(resolveRowColor([rule({ text: 'absent' })], entry())).toBe(null)
  })
})

describe('makeRule', () => {
  it('creates well-formed rules with unique ids and the default palette color', () => {
    const a = makeRule()
    const b = makeRule()
    expect(a.id).not.toBe(b.id)
    expect(a.text).toBe('')
    expect(a.levels).toEqual([])
    expect(a.file).toBe('')
    expect(a.color).toBe(RULE_COLORS[0])
    expect(makeRule('#58a6ff').color).toBe('#58a6ff')
  })
})

describe('sanitizeRules', () => {
  it('keeps well-formed rules and filters invalid level entries', () => {
    const out = sanitizeRules([
      { id: 'a', text: 'x', levels: ['WARN', 'not-a-level'], file: '', color: '#3fb950' },
    ])
    expect(out).toEqual([{ id: 'a', text: 'x', levels: ['WARN'], file: '', color: '#3fb950' }])
  })

  it('drops corrupt members and coerces missing/invalid fields', () => {
    const out = sanitizeRules([
      null,
      'junk',
      { id: '', text: 'no id' }, // missing/empty id → dropped
      { id: 'b', levels: 'WARN', color: 'red' }, // bad shapes coerced
    ])
    expect(out).toEqual([{ id: 'b', text: '', levels: [], file: '', color: RULE_COLORS[0] }])
  })

  it('returns [] for non-array input (corrupt/stale records)', () => {
    expect(sanitizeRules(undefined)).toEqual([])
    expect(sanitizeRules({ rules: [] })).toEqual([])
    expect(sanitizeRules('["x"]')).toEqual([])
  })
})
