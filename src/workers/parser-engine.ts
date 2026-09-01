import { PatternParser } from '../parsers/PatternParser'
import type { LogEntry } from '../parsers/types'

export interface EngineStats {
  lines: number
  entries: number
  chunks: number
  bytesSeen: number
}

/**
 * Pure streaming parse engine (no DOM/worker APIs) — directly unit-testable.
 * Accumulates a possible partial trailing line across `feed()` calls so chunk
 * boundaries never split an entry. Emits batches of at most `batchLimit` rows;
 * any pending remainder is emitted at the end of a feed that produced no
 * full-batch flush, or on `finish()`.
 */
export class ParseEngine {
  private parser: PatternParser
  private partial = ''
  private seq = 0
  private batch: LogEntry[] = []
  private flushedDuringPush = false
  readonly stats: EngineStats = { lines: 0, entries: 0, chunks: 0, bytesSeen: 0 }

  constructor(
    template?: string,
    private readonly onBatch?: (rows: LogEntry[]) => void,
    private readonly batchLimit = 5000,
  ) {
    this.parser = new PatternParser({ template })
  }

  setTemplate(template: string): void {
    this.parser = new PatternParser({ template })
  }

  /** Feed one decoded text chunk (any size; '\n' separated). */
  feed(text: string): void {
    if (!text) return
    this.stats.chunks++
    this.stats.bytesSeen += text.length
    this.flushedDuringPush = false
    const combined = this.partial + text
    const lines = combined.split('\n')
    this.partial = lines.pop() ?? ''
    for (const line of lines) this.pushLine(line.replace(/\r$/, ''))
    if (!this.flushedDuringPush) this.flush()
  }

  /** Signal end-of-file: flush the trailing partial line and any pending batch. */
  finish(): void {
    if (this.partial !== '') {
      this.pushLine(this.partial.replace(/\r$/, ''))
      this.partial = ''
    }
    this.flush()
  }

  private pushLine(line: string): void {
    this.stats.lines++
    if (line === '') return
    const entry = this.parser.parseLine(line, this.seq++, this.stats.lines)
    this.stats.entries++
    this.batch.push(entry)
    if (this.batch.length >= this.batchLimit) {
      this.flush()
      this.flushedDuringPush = true
    }
  }

  private flush(): void {
    if (this.batch.length === 0) return
    const rows = this.batch
    this.batch = []
    this.onBatch?.(rows)
  }
}
