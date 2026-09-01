import { describe, expect, it } from 'vitest'
import { ParseEngine } from '../../src/workers/parser-engine'
import type { LogEntry } from '../../src/parsers/types'

const TEXT = [
  '2026-09-01 08:00:01 INFO: first',
  '2026-09-01 08:00:02 WARN: second line is longer and spans the chunk boundary for real',
  '',
  '2026-09-01 08:00:03 ERROR: third',
].join('\n')

interface RunResult {
  rows: LogEntry[]
  batchSizes: number[]
  engine: ParseEngine
}

function run(feed: (e: ParseEngine) => void, template?: string): RunResult {
  const batches: LogEntry[][] = []
  const engine = new ParseEngine(template, rows => batches.push(rows))
  feed(engine)
  engine.finish()
  return { rows: batches.flat(), batchSizes: batches.map(b => b.length), engine }
}

function oneShot(): RunResult {
  return run(e => e.feed(TEXT))
}

describe('ParseEngine', () => {
  it('parses the full text in one feed', () => {
    const { rows, engine } = oneShot()
    expect(rows.map(r => r.message)).toEqual(['first', 'second line is longer and spans the chunk boundary for real', 'third'])
    expect(rows.map(r => r.level)).toEqual(['INFO', 'WARN', 'ERROR'])
    expect(rows.map(r => r.lineNo)).toEqual([1, 2, 4])
    expect(rows.map(r => r.seq)).toEqual([0, 1, 2])
    expect(engine.stats.lines).toBe(4) // blank line counted
    expect(engine.stats.entries).toBe(3)
  })

  it('handles a chunk boundary mid-line', () => {
    const { rows } = run(e => {
      const cut = TEXT.indexOf('spans')
      e.feed(TEXT.slice(0, cut))
      e.feed(TEXT.slice(cut))
    })
    expect(rows).toEqual(oneShot().rows)
  })

  it('handles a chunk boundary exactly on a newline', () => {
    const { rows } = run(e => {
      const cut = TEXT.indexOf('\n') + 1
      e.feed(TEXT.slice(0, cut)) // ends with '\n'
      e.feed(TEXT.slice(cut))
    })
    expect(rows).toEqual(oneShot().rows)
  })

  it('flushes a trailing partial line only on finish()', () => {
    const batches: LogEntry[][] = []
    const engine = new ParseEngine(undefined, rows => batches.push(rows))
    engine.feed('2026-09-01 08:00:01 INFO: a\n2026-09-01 08:00:02 INFO: b')
    expect(batches.flat().map(r => r.message)).toEqual(['a'])
    engine.finish()
    expect(batches.flat().map(r => r.message)).toEqual(['a', 'b'])
    expect(engine.stats.lines).toBe(2)
  })

  it('strips CR from CRLF line endings', () => {
    const { rows } = run(e => e.feed('2026-09-01 08:00:01 INFO: a\r\n2026-09-01 08:00:02 INFO: b\r\n'))
    expect(rows.map(r => r.raw)).toEqual([
      '2026-09-01 08:00:01 INFO: a',
      '2026-09-01 08:00:02 INFO: b',
    ])
  })

  it('emits batches of at most batchLimit rows, in order', () => {
    const lines = Array.from(
      { length: 12 },
      (_, i) => `2026-09-01 08:00:${String(i).padStart(2, '0')} INFO: line ${i}`,
    ).join('\n')
    const batches: LogEntry[][] = []
    const engine = new ParseEngine(undefined, rows => batches.push(rows), 5)
    engine.feed(lines)
    engine.finish()
    expect(batches.map(b => b.length)).toEqual([5, 5, 2])
    expect(batches.flat().map(r => r.seq)).toEqual([...Array(12).keys()])
  })

  it('supports template swap before feeding', () => {
    const { rows } = run(e => {
      e.setTemplate('%d %m')
      e.feed('2026-09-01T08:02:33.123456Z GC(41) Pause Young 245M->98M 1.2ms\n')
    })
    expect(rows[0].ts).toBe(Date.UTC(2026, 8, 1, 8, 2, 33, 123))
    expect(rows[0].message).toBe('GC(41) Pause Young 245M->98M 1.2ms')
  })

  it('parses the mixed-levels fixture end to end', async () => {
    const { readFileSync } = await import('node:fs')
    const content = readFileSync('tests/fixtures/logs/mixed-levels.log', 'utf8')
    const { rows, engine } = run(e => e.feed(content))
    expect(engine.stats.entries).toBe(40)
    expect(rows.filter(r => r.level === 'WARN').length).toBe(7)
    expect(rows.filter(r => r.level === 'ERROR').length).toBe(5)
    expect(rows.filter(r => r.level === 'FATAL').length).toBe(2)
    expect(rows.filter(r => r.level === null).length).toBe(1)
  })
})
