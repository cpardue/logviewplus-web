import { compilePattern } from './specifiers'
import { normalizeLevel } from './levels'
import {
  parseEpochSeconds,
  parseSyslogTimestamp,
  parseTimestamp,
  type TsOptions,
} from './timestamps'
import type { DraftEntry, LogEntry, LogParser } from './types'

export const DEFAULT_TEMPLATE = '%d %l: %m'

/** Candidate templates tried (in order) by {@link PatternParser.detectTemplate}. */
export const AUTO_TEMPLATES = ['%d %l: %m', '%d [%t] %l: %m', '%d %m', '%S %m']

export interface PatternParserOptions {
  template?: string
  /** Interpret zone-less timestamps as UTC instead of local time. */
  naiveAsUtc?: boolean
}

/**
 * How far a yearless syslog date may jump relative to the previous entry before
 * we assume it rolled into an adjacent year. 48 h forward covers DST/roll noise;
 * ~355 d backward covers Dec→Jan wrap.
 */
const SYSLOG_FORWARD_SLIP = 48 * 3_600_000
const SYSLOG_BACKWARD_SLIP = 355 * 86_400_000

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
  private readonly tsOpts: TsOptions

  // Syslog (`%S`) year-inference state: last confirmed full year and the most
  // recent resolved timestamp, used to place yearless dates sensibly.
  private syslogYear: number | null = null
  private lastTs: number | null = null

  constructor(opts: PatternParserOptions = {}) {
    this.template = opts.template ?? DEFAULT_TEMPLATE
    const compiled = compilePattern(this.template)
    this.regex = compiled.regex
    this.groups = compiled.groups
    this.tsOpts = opts.naiveAsUtc ? { naiveAsUtc: true } : {}
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

    const ts = this.resolveTs(first)
    // Advance the syslog year/sequence state from any resolved timestamp.
    if (ts != null) this.lastTs = ts

    return {
      ts,
      level: normalizeLevel(first['%l']),
      message: first['%m'] ?? '',
      raw: line,
      lineNo,
    }
  }

  /** Resolve a timestamp from whichever of `%d` / `%s` / `%S` is present. */
  private resolveTs(fields: Partial<Record<string, string>>): number | null {
    const d = fields['%d']
    if (d != null) {
      const ts = parseTimestamp(d, this.tsOpts)
      // A full-year date anchors the syslog year reference.
      const ym = /(\d{4})/.exec(d)
      if (ym && ts != null) this.syslogYear = Number(ym[1])
      return ts
    }

    const s = fields['%s']
    if (s != null) {
      const ts = parseEpochSeconds(s)
      if (ts != null) {
        const ym = new Date(ts)
        // Epoch is absolute; use its UTC year only as a weak reference.
        if (this.syslogYear == null) this.syslogYear = ym.getUTCFullYear()
      }
      return ts
    }

    const sys = fields['%S']
    if (sys != null) return this.resolveSyslog(sys)

    return null
  }

  /** Resolve a yearless syslog date using the running year reference. */
  private resolveSyslog(value: string): number | null {
    const base = this.syslogYear ?? new Date().getFullYear()
    let ts = parseSyslogTimestamp(value, base, this.tsOpts)
    if (ts == null) return null

    // Yearless dates wrap across year boundaries. If the naive resolution lands
    // far in the future relative to the previous entry, step back a year; if it
    // lands far in the past, step forward a year.
    if (this.lastTs != null) {
      const fwd = ts - this.lastTs
      if (fwd > SYSLOG_FORWARD_SLIP) {
        const prev = parseSyslogTimestamp(value, base - 1, this.tsOpts)
        if (prev != null && prev <= this.lastTs + SYSLOG_FORWARD_SLIP) {
          ts = prev
          this.syslogYear = base - 1
        }
      } else if (fwd < -SYSLOG_BACKWARD_SLIP) {
        const next = parseSyslogTimestamp(value, base + 1, this.tsOpts)
        if (next != null && next >= this.lastTs - SYSLOG_FORWARD_SLIP) {
          ts = next
          this.syslogYear = base + 1
        }
      }
    }
    return ts
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