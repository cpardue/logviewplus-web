import { describe, expect, it } from 'vitest'
import { SPECIFIERS, compilePattern } from '../../src/parsers/specifiers'

describe('compilePattern', () => {
  it('produces an anchored regex with ordered capture groups', () => {
    const { regex, groups } = compilePattern('%d %l: %m')
    expect(groups).toEqual(['%d', '%l', '%m'])
    const m = regex.exec('2026-09-01 08:00:01 INFO: hello world')
    expect(m?.[1]).toBe('2026-09-01 08:00:01')
    expect(m?.[2]).toBe('INFO')
    expect(m?.[3]).toBe('hello world')
  })

  it('escapes literal regex special characters (brackets, %)', () => {
    const { regex } = compilePattern('%d [%t] %l: %m')
    const m = regex.exec('2026-09-01 08:00:01 [main] WARN: disk usage at 87% on /var/log')
    expect(m).not.toBeNull()
    expect(m?.[2]).toBe('main')
    expect(m?.[3]).toBe('WARN')
    expect(m?.[4]).toBe('disk usage at 87% on /var/log')
  })

  it('message consumes the rest of the line, including colons', () => {
    const { regex } = compilePattern('%d %l: %m')
    const m = regex.exec('2026-09-01 08:00:01 ERROR: Timeout after 30000 ms (db-host:5432)')
    expect(m?.[3]).toBe('Timeout after 30000 ms (db-host:5432)')
  })

  it('supports ISO timestamps with fraction and Z', () => {
    const { regex } = compilePattern('%d %m')
    const m = regex.exec('2026-09-01T08:02:33.123456Z GC(41) Pause Young 245M->98M 1.2ms')
    expect(m?.[1]).toBe('2026-09-01T08:02:33.123456Z')
    expect(m?.[2]).toBe('GC(41) Pause Young 245M->98M 1.2ms')
  })

  it('supports Apache CLF-style timestamps', () => {
    const { regex } = compilePattern('%d %m')
    const m = regex.exec('01/Sep/2026:08:02:33 +0000 GET /index.html 200 1234')
    expect(m?.[1]).toBe('01/Sep/2026:08:02:33')
    expect(m?.[2]).toBe('+0000 GET /index.html 200 1234')
  })

  it('rejects lines that do not start with the template shape', () => {
    const { regex } = compilePattern('%d %l: %m')
    expect(regex.exec('#Fields: date time s-site')).toBeNull()
    expect(regex.exec('INFO: no timestamp here')).toBeNull()
  })

  it('throws on unknown specifier', () => {
    expect(() => compilePattern('%d %z %m')).toThrow(/Unknown specifier/)
  })

  it('throws on template without specifiers', () => {
    expect(() => compilePattern('plain text only')).toThrow(/no specifiers/i)
  })

  it('exposes the four initial specifiers', () => {
    expect(Object.keys(SPECIFIERS).sort()).toEqual(['%d', '%l', '%m', '%t'])
  })
})
