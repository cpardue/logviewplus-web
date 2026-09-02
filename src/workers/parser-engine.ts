import { createParser } from '../parsers/factory'
import type { LogEntry, LogParser, ParserSpec } from '../parsers/types'
import type { TsOptions } from '../parsers/timestamps'

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
 * full-batch flush, or on `finish()`. Stateful parsers (XML) also get an
 * EOF flush via their optional `finish()`.
 */
export class ParseEngine {
  private parser: LogParser
  private partial = ''
  private seq = 0
  private batch: LogEntry[] = []
  private flushedDuringPush = false
  readonly stats: EngineStats = { lines: 0, entries: 0, chunks: 0, bytesSeen: 0 }

  constructor(
    spec?: ParserSpec,
    private readonly onBatch?: (rows: LogEntry[]) => void,
    private readonly batchLimit = 5000,
    private readonly fileName?: string,
    private readonly tzMode?: 'local' | 'utc',
  ) {
    this.parser = createParser(spec, this.tsOpts())
  }

  setParser(spec: ParserSpec): void {
    this.parser = createParser(spec, this.tsOpts())
  }

  private tsOpts(): TsOptions {
    return this.tzMode === 'utc' ? { naiveAsUtc: true } : {}
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
    const tail = this.parser.finish?.(this.stats.lines)
    if (tail) this.emit(tail)
    this.flush()
  }

  private pushLine(line: string): void {
    this.stats.lines++
    if (line === '') return
    for (const d of this.parser.parse(line, this.stats.lines)) this.emit(d)
  }

  private emit(draft: Omit<LogEntry, 'seq'>): void {
    const entry: LogEntry = {
      seq: this.seq++,
      ts: draft.ts,
      level: draft.level,
      message: draft.message,
      raw: draft.raw,
      lineNo: draft.lineNo,
      ...(this.fileName ? { file: this.fileName } : {}),
    }
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
