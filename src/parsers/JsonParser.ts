import { normalizeLevel } from './levels'
import { parseTimestamp } from './timestamps'
import { rawDraft } from './rawDraft'
import type { DraftEntry, JsonKeys, LogParser, LogLevel } from './types'

/** RFC 5424 syslog severity → LogLevel (numeric level values in JSON). */
const SYSLOG_NUM: Record<number, LogLevel> = {
  0: 'FATAL',
  1: 'FATAL',
  2: 'FATAL',
  3: 'ERROR',
  4: 'WARN',
  5: 'INFO',
  6: 'INFO',
  7: 'DEBUG',
}

/** Resolve a timestamp field value: ISO string, epoch seconds or ms (number/string). */
export function resolveTs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? Math.round(v) : Math.round(v * 1000)
  if (typeof v === 'string') {
    const t = v.trim()
    if (/^\d{9,}(\.\d+)?$/.test(t)) {
      const n = Number(t)
      return n > 1e12 ? Math.round(n) : Math.round(n * 1000)
    }
    return parseTimestamp(t)
  }
  return null
}

/**
 * JSON-lines parser: one object per line. Keys are resolved up front by
 * autodetect (see detect.ts); invalid lines are kept as raw entries.
 */
export class JsonLinesParser implements LogParser {
  readonly kind = 'json' as const

  constructor(private readonly keys: JsonKeys) {}

  parse(line: string, lineNo: number): DraftEntry[] {
    const v = line.trim()
    if (!v) return []
    let obj: unknown
    try {
      obj = JSON.parse(v)
    } catch {
      return [rawDraft(line, lineNo)]
    }
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return [rawDraft(line, lineNo)]
    const rec = obj as Record<string, unknown>

    let ts: number | null = null
    if (this.keys.tsKey && this.keys.tsKey in rec) ts = resolveTs(rec[this.keys.tsKey])

    let level: LogLevel | null = null
    if (this.keys.levelKey && this.keys.levelKey in rec) {
      const lv = rec[this.keys.levelKey]
      if (typeof lv === 'string') level = normalizeLevel(lv)
      else if (typeof lv === 'number' && Number.isInteger(lv)) level = SYSLOG_NUM[lv] ?? null
    }

    let message = ''
    if (this.keys.msgKey && this.keys.msgKey in rec) {
      const m = rec[this.keys.msgKey]
      message = typeof m === 'string' ? m : m != null ? JSON.stringify(m) : ''
    }
    if (!message) message = v // whole JSON text — no data loss

    return [{ ts, level, message, raw: line, lineNo }]
  }
}