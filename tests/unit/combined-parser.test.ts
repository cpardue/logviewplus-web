import { describe, expect, it } from 'vitest'
import { CombinedParser } from '../../src/parsers/CombinedParser'

const COMBINED =
  '192.0.2.10 - alice [01/Sep/2026:08:02:35 +0000] "GET /static/app.css HTTP/1.1" 200 5210 "http://example.com/" "Mozilla/5.0"'
const COMMON = '192.0.2.10 - alice [01/Sep/2026:08:02:35 +0000] "GET /static/app.css HTTP/1.1" 200 5210'

describe('CombinedParser.parse', () => {
  const p = new CombinedParser()

  it('parses combined format (referrer + user agent)', () => {
    const [e] = p.parse(COMBINED, 2)
    expect(e.ts).toBe(Date.UTC(2026, 8, 1, 8, 2, 35))
    expect(e.level).toBeNull() // 200
    expect(e.message).toBe('GET /static/app.css HTTP/1.1 200')
    expect(e.raw).toBe(COMBINED)
  })

  it('parses common format (no referrer/user agent)', () => {
    const [e] = p.parse(COMMON, 3)
    expect(e.ts).toBe(Date.UTC(2026, 8, 1, 8, 2, 35))
    expect(e.message).toBe('GET /static/app.css HTTP/1.1 200')
  })

  it('derives level from the status code', () => {
    const [e404] = p.parse(COMMON.replace('200 5210', '404 154'), 4)
    expect(e404.level).toBe('WARN')
    const [e503] = p.parse(COMMON.replace('200 5210', '503 42'), 5)
    expect(e503.level).toBe('ERROR')
  })

  it('handles a "-" byte count and no protocol token', () => {
    const line = '203.0.113.4 - - [01/Sep/2026:09:00:00 +0000] "HEAD /x" 200 -'
    const [e] = p.parse(line, 6)
    expect(e.ts).toBe(Date.UTC(2026, 8, 1, 9, 0, 0))
    expect(e.message).toBe('HEAD /x 200')
  })

  it('keeps non-matching lines as raw entries', () => {
    const [e] = p.parse('garbage line without shape', 7)
    expect(e.ts).toBeNull()
    expect(e.message).toBe('garbage line without shape')
  })

  it('parses the apache-combined fixture end to end', async () => {
    const { readFileSync } = await import('node:fs')
    const content = readFileSync('tests/fixtures/logs/apache-combined.log', 'utf8')
    const lines = content.split('\n').filter(l => l.trim() !== '')
    const entries = lines.flatMap((l, i) => p.parse(l, i + 1))
    expect(entries).toHaveLength(12)
    expect(entries.filter(e => e.level === 'ERROR')).toHaveLength(2) // 500, 503
    expect(entries.filter(e => e.level === 'WARN')).toHaveLength(4) // 404, 403, 401, 404
    expect(entries.every(e => e.ts != null)).toBe(true)
  })
})