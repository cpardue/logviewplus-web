import { describe, expect, it } from 'vitest'
import { XmlLog4jParser } from '../../src/parsers/XmlLog4jParser'

describe('XmlLog4jParser.parse', () => {
  it('parses a complete single-feed log4j 1.x event', () => {
    const p = new XmlLog4jParser()
    const out = [
      ...p.parse('<log4j:event logger="a" thread="t" level="INFO" timestamp="1788220801000">', 3),
      ...p.parse('<log4j:message>hello world</log4j:message>', 4),
      ...p.parse('</log4j:event>', 5),
    ]
    expect(out).toHaveLength(1)
    expect(out[0].ts).toBe(1788220801000)
    expect(out[0].level).toBe('INFO')
    expect(out[0].message).toBe('hello world')
    expect(out[0].lineNo).toBe(5) // line where the event closes
  })

  it('emits nothing for lines inside an open event', () => {
    const p = new XmlLog4jParser()
    expect(p.parse('<?xml version="1.0" encoding="UTF-8" ?>', 1)).toHaveLength(0)
    expect(p.parse('<log4j:event logger="a" thread="t" level="WARN" timestamp="1788220810000">', 2)).toHaveLength(0)
    const out = p.parse('<log4j:message>still waiting</log4j:message>\n</log4j:event>', 3)
    expect(out).toHaveLength(1)
    expect(out[0].message).toBe('still waiting')
    expect(out[0].level).toBe('WARN')
  })

  it('handles multi-line messages by collapsing whitespace', () => {
    const p = new XmlLog4jParser()
    let out: ReturnType<XmlLog4jParser['parse']> = []
    for (const [line, no] of [
      ['<log4j:event logger="a" thread="t" level="DEBUG" timestamp="1788220805500">', 6],
      ['<log4j:message>Loading configuration', 7],
      ['read 42 keys from /etc/app/config.yml</log4j:message>', 8],
      ['</log4j:event>', 9],
    ] as const) out = out.concat(p.parse(line, no))
    expect(out).toHaveLength(1)
    expect(out[0].message).toBe('Loading configuration read 42 keys from /etc/app/config.yml')
  })

  it('decodes XML entities in the message', () => {
    const p = new XmlLog4jParser()
    let out: ReturnType<XmlLog4jParser['parse']> = []
    for (const [line, no] of [
      ['<log4j:event logger="a" thread="t" level="ERROR" timestamp="1788220815000">', 1],
      ['<log4j:message>refused: redis &amp; retry &lt;3</log4j:message>', 2],
      ['</log4j:event>', 3],
    ] as const) out = out.concat(p.parse(line, no))
    expect(out[0].message).toBe('refused: redis & retry <3')
  })

  it('parses a self-closing event with no message', () => {
    const p = new XmlLog4jParser()
    const out = p.parse('<log4j:event logger="a" thread="t" level="INFO" timestamp="1788220820000"/>', 1)
    expect(out).toHaveLength(1)
    expect(out[0].message).toBe('')
    expect(out[0].ts).toBe(1788220820000)
  })

  it('supports log4j 2 LogRecord elements', () => {
    const p = new XmlLog4jParser()
    let out: ReturnType<XmlLog4jParser['parse']> = []
    for (const [line, no] of [
      ['<LogRecord level="ERROR" thread="main" logger="x" timeMillis="1788220830000">', 1],
      ['<Message>boom</Message>', 2],
      ['</LogRecord>', 3],
    ] as const) out = out.concat(p.parse(line, no))
    expect(out).toHaveLength(1)
    expect(out[0].ts).toBe(1788220830000)
    expect(out[0].level).toBe('ERROR')
    expect(out[0].message).toBe('boom')
  })

  it('flushes an incomplete trailing event on finish()', () => {
    const p = new XmlLog4jParser()
    p.parse('<log4j:event logger="a" thread="t" level="INFO" timestamp="1788220840000">', 1)
    p.parse('<log4j:message>cutoff mid-event', 2)
    const tail = p.finish(3)
    expect(tail).not.toBeNull()
    expect(tail?.level).toBe('INFO')
    expect(tail?.ts).toBe(1788220840000)
    expect(tail?.message).toContain('cutoff mid-event')
  })

  it('emits verbatim content when no events ever appear (bounded buffer)', () => {
    const p = new XmlLog4jParser()
    const out = p.parse(`plain text line without any xml\n${'x'.repeat(250_000)}`, 1)
    expect(out).toHaveLength(1) // flushed as one raw chunk past the idle cap
    expect(out[0].message).toContain('plain text line')
  })

  it('parses the log4j.xml fixture end to end', async () => {
    const { readFileSync } = await import('node:fs')
    const content = readFileSync('tests/fixtures/logs/log4j.xml', 'utf8')
    const p = new XmlLog4jParser()
    const entries = content.split('\n').flatMap((l, i) => p.parse(l, i + 1))
    const tail = p.finish(content.split('\n').length)
    if (tail) entries.push(tail)
    expect(entries).toHaveLength(5)
    expect(entries.map(e => e.level)).toEqual(['INFO', 'DEBUG', 'WARN', 'ERROR', 'FATAL'])
    expect(entries.map(e => e.ts)).toEqual([
      1788220801000,
      1788220805500,
      1788220810000,
      1788220815000,
      1788220820000,
    ])
    expect(entries[1].message).toBe('Loading configuration read 42 keys from /etc/app/config.yml')
    expect(entries[3].message).toBe('Connection refused: redis:6379 & retry budget exhausted')
  })
})