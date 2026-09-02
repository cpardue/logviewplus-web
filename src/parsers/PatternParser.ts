import { compilePattern } from './specifiers'
import { normalizeLevel } from './levels'
import { parseTimestamp } from './timestamps'
import type { DraftEntry, LogEntry, LogParser } from './types'

export const DEFAULT_TEMPLATE = '%d %l: %m'

/** Candidate templates tried (in order) by {@link PatternParser.detectTemplate}. */
export const AUTO_TEMPLATES = ['%d %l: %m', '%d [%t] %l: %m', '%d %m']

export interface PatternParserOptions {
  template?: string
}

/**
 * Pattern-based line parser using LVP-style specifiers.
 * Lines that do not match still produce an entry (message = raw line, ts/level null)
 * so no data is silently lost.
 */
export class PatternParser implements LogParser {
  readonly kind = 'pattern' as const
  readonly template: string
  private regex: RegExp
  private groups: string[]

  constructor(opts: PatternParserOptions = {}) {
    this.template = opts.template ?? DEFAULT_TEMPLATE
    const compiled = compilePattern(this.template)
    this.regex = compiled.regex
    this.groups = compiled.groups
  }

  /** LogParser entry point (engine assigns `seq`). */
  parse(line: string, lineNo: number): DraftEntry[] {
    return [this.draft(line, lineNo)]
  }

  parseLine(line: string, seq: number, lineNo: number): LogEntry {
    return { ...this.draft(line, lineNo), seq }
  }

  private draft(line: string, lineNo: number): DraftEntry {
    const m = this.regex.exec(line)
    if (!m) {
      return { ts: null, level: null, message: line, raw: line, lineNo }
    }
    const first: Partial<Record<string, string>> = {}
    for (let i = 0; i < this.groups.length; i++) {
      const key = this.groups[i]
      if (!(key in first)) first[key] = m[i + 1] ?? ''
    }
    const dateVal = first['%d']
    return {
      ts: dateVal != null ? parseTimestamp(dateVal) : null,
      level: normalizeLevel(first['%l']),
      message: first['%m'] ?? '',
      raw: line,
      lineNo,
    }
  }

  /** Pick the candidate template that yields structured fields for the most sample lines. */
  static detectTemplate(sampleLines: string[]): string {
    let best = DEFAULT_TEMPLATE
    let bestScore = -1
    for (const t of AUTO_TEMPLATES) {
      const parser = new PatternParser({ template: t })
      let total = 0
      let structured = 0
      for (const line of sampleLines) {
        if (!line.trim()) continue
        total++
        const e = parser.parseLine(line, 0, 0)
        if (e.ts != null || e.level != null) structured++
      }
      const score = total === 0 ? 0 : structured / total
      if (score > bestScore) {
        bestScore = score
        best = t
      }
    }
    return best
  }
}
