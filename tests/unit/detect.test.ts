import { describe, expect, it } from 'vitest'
import { detectFormat, resolveJsonKeys } from '../../src/parsers/detect'

describe('detectFormat', () => {
  it('detects JSON lines and resolves common key aliases', () => {
    const spec = detectFormat([
      '{"ts":"2026-09-01T08:00:01Z","level":"INFO","msg":"a"}',
      '{"ts":"2026-09-01T08:00:02Z","level":"WARN","msg":"b"}',
    ])
    expect(spec.kind).toBe('json')
    if (spec.kind === 'json') {
      expect(spec.keys.tsKey).toBe('ts')
      expect(spec.keys.levelKey).toBe('level')
      expect(spec.keys.msgKey).toBe('msg')
    }
  })

  it('prefers @timestamp over ts for JSON', () => {
    const keys = resolveJsonKeys([
      { '@timestamp': 'x', ts: 'y', message: 'm' },
    ])
    expect(keys.tsKey).toBe('@timestamp')
    expect(keys.msgKey).toBe('message')
  })

  it('detects W3C extended from the #Fields header', () => {
    const spec = detectFormat([
      '#Software: Microsoft IIS 10.0',
      '#Fields: date time s-site c-ip cs-method cs-uri-stem sc-status sc-bytes',
      '2026-09-01 08:02:34 WBSITE1 192.0.2.10 GET /index.html 200 1234',
      '2026-09-01 08:02:35 WBSITE1 192.0.2.10 GET /a.css 200 10',
    ])
    expect(spec.kind).toBe('w3c')
    if (spec.kind === 'w3c') expect(spec.fields[0]).toBe('date')
  })

  it('detects classic combined/common access logs', () => {
    const spec = detectFormat([
      '192.0.2.10 - - [01/Sep/2026:08:02:34 +0000] "GET /index.html HTTP/1.1" 200 1043 "-" "UA"',
      '192.0.2.10 - - [01/Sep/2026:08:02:35 +0000] "GET /a.css HTTP/1.1" 200 10',
      '198.51.100.7 - - [01/Sep/2026:08:02:36 +0000] "POST /x HTTP/1.1" 500 2 "-" "UA"',
    ])
    expect(spec.kind).toBe('combined')
  })

  it('detects log4j XML', () => {
    const spec = detectFormat([
      '<?xml version="1.0" encoding="UTF-8" ?>',
      '<log4j:event logger="a" thread="t" level="INFO" timestamp="1788220801000">',
      '<log4j:message>hi</log4j:message>',
      '</log4j:event>',
    ])
    expect(spec.kind).toBe('log4j-xml')
  })

  it('detects tab and comma DSV and resolves ts/level columns', () => {
    const tsv = detectFormat([
      '2026-09-01 08:00:01\tINFO\ta',
      '2026-09-01 08:00:02\tWARN\tb',
      '2026-09-01 08:00:03\tERROR\tc',
    ])
    expect(tsv.kind).toBe('dsv')
    if (tsv.kind === 'dsv') {
      expect(tsv.delimiter).toBe('\t')
      expect(tsv.tsCol).toBe(0)
      expect(tsv.levelCol).toBe(1)
    }
    const csv = detectFormat(['2026-09-01 08:00:01,INFO,a', '2026-09-01 08:00:02,WARN,b'])
    expect(csv.kind).toBe('dsv')
    if (csv.kind === 'dsv') expect(csv.delimiter).toBe(',')
  })

  it('falls back to pattern template autodetect for plain app logs', () => {
    const spec = detectFormat([
      '2026-09-01 08:00:01 INFO: a',
      '2026-09-01 08:00:02 WARN: b',
      '2026-09-01 08:00:03 ERROR: c',
    ])
    expect(spec.kind).toBe('pattern')
    if (spec.kind === 'pattern') expect(spec.template).toBe('%d %l: %m')
  })

  it('rejects DSV when the delimiter is inconsistent', () => {
    const spec = detectFormat([
      '2026-09-01 08:00:01,INFO,a',
      '2026-09-01 08:00:02 WARN no comma here at all',
      '2026-09-01 08:00:03,ERROR,c',
    ])
    expect(spec.kind).toBe('pattern')
  })

  it('detects the shipped fixtures correctly', async () => {
    const { readFileSync } = await import('node:fs')
    const sample = (p: string) => readFileSync(p, 'utf8').split('\n').slice(0, 200)
    expect(detectFormat(sample('tests/fixtures/logs/iis-u_ex.log')).kind).toBe('w3c')
    expect(detectFormat(sample('tests/fixtures/logs/app.json')).kind).toBe('json')
    expect(detectFormat(sample('tests/fixtures/logs/apache-combined.log')).kind).toBe('combined')
    expect(detectFormat(sample('tests/fixtures/logs/csv-log.csv')).kind).toBe('dsv')
    expect(detectFormat(sample('tests/fixtures/logs/log4j.xml')).kind).toBe('log4j-xml')
    expect(detectFormat(sample('tests/fixtures/logs/mixed-levels.log')).kind).toBe('pattern')
  })

  it('returns the default pattern spec for empty samples', () => {
    const spec = detectFormat([])
    expect(spec.kind).toBe('pattern')
    if (spec.kind === 'pattern') expect(spec.template).toBe('%d %l: %m')
  })
})