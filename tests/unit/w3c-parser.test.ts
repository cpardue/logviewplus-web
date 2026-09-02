import { describe, expect, it } from 'vitest'
import { W3cParser, levelFromStatus } from '../../src/parsers/W3cParser'

const FIELDS = ['date', 'time', 's-site', 'c-ip', 'cs-method', 'cs-uri-stem', 'sc-status', 'sc-bytes']

describe('W3cParser.parse', () => {
  const p = new W3cParser(FIELDS)

  it('parses a data row into ts / derived level / request message', () => {
    const [e] = p.parse('2026-09-01 08:02:34 WBSITE1 192.0.2.10 GET /index.html 200 1234', 5)
    expect(e.ts).toBe(new Date(2026, 8, 1, 8, 2, 34).getTime()) // naive → local
    expect(e.level).toBeNull() // 2xx is neutral
    expect(e.message).toBe('192.0.2.10 GET /index.html 200')
    expect(e.raw).toBe('2026-09-01 08:02:34 WBSITE1 192.0.2.10 GET /index.html 200 1234')
    expect(e.lineNo).toBe(5)
  })

  it('derives level from sc-status (5xx ERROR, 4xx WARN)', () => {
    expect(levelFromStatus('500')).toBe('ERROR')
    expect(levelFromStatus('404')).toBe('WARN')
    expect(levelFromStatus('201')).toBeNull()
    expect(levelFromStatus('abc')).toBeNull()
    const [e] = p.parse('2026-09-01 08:02:37 WBSITE1 198.51.100.7 POST /api/orders 500 99', 8)
    expect(e.level).toBe('ERROR')
  })

  it('keeps # metadata header lines as raw entries', () => {
    const [e] = p.parse('#Software: Microsoft IIS 10.0', 1)
    expect(e.ts).toBeNull()
    expect(e.level).toBeNull()
    expect(e.message).toBe('#Software: Microsoft IIS 10.0')
  })

  it('re-joins overflow cells into the last column', () => {
    const p2 = new W3cParser(['date', 'time', 'cs-user-agent'])
    const [e] = p2.parse('2026-09-01 08:02:34 Mozilla/5.0 (X11; Linux)', 2)
    expect(e.message).toBe('Mozilla/5.0 (X11; Linux)') // minus date/time
  })

  it('keeps malformed rows as raw entries', () => {
    const [e] = p.parse('totally broken line', 9)
    expect(e.ts).toBeNull()
    expect(e.message).toBe('totally broken line')
  })

  it('parses the iis-u_ex fixture end to end', async () => {
    const { readFileSync } = await import('node:fs')
    const content = readFileSync('tests/fixtures/logs/iis-u_ex.log', 'utf8')
    const lines = content.split('\n').filter(l => l.trim() !== '')
    const entries = lines.flatMap((l, i) => p.parse(l, i + 1))
    expect(entries).toHaveLength(18) // 4 header + 14 data
    expect(entries.filter(e => e.level === 'ERROR')).toHaveLength(1) // the 500
    expect(entries.filter(e => e.level === 'WARN')).toHaveLength(3) // 404/403/401
    expect(entries.filter(e => e.ts != null)).toHaveLength(14)
  })
})