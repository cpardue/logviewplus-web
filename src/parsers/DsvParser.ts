import { normalizeLevel } from './levels'
import { parseTimestamp } from './timestamps'
import type { DraftEntry, LogParser, LogLevel } from './types'

/**
 * Delimited (DSV) log: every line splits into columns on a single delimiter.
 * The ts/level columns are resolved by autodetect; the message joins the
 * remaining columns. Quoted cells are NOT supported (lines with an odd field
 * layout still parse best-effort).
 */
export class DsvParser implements LogParser {
  readonly kind = 'dsv' as const

  constructor(
    private readonly delimiter: string,
    private readonly tsCol: number | null,
    private readonly levelCol: number | null,
  ) {}

  parse(line: string, lineNo: number): DraftEntry[] {
    if (!line.trim()) return []
    const cells = line.split(this.delimiter)

    let ts: number | null = null
    if (this.tsCol != null && this.tsCol < cells.length) ts = parseTimestamp(cells[this.tsCol])

    let level: LogLevel | null = null
    if (this.levelCol != null && this.levelCol < cells.length) level = normalizeLevel(cells[this.levelCol])

    const message = cells.filter((_, i) => i !== this.tsCol && i !== this.levelCol).join(' | ')
    return [{ ts, level, message, raw: line, lineNo }]
  }
}