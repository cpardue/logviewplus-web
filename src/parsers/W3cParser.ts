import { parseTimestamp, type TsOptions } from './timestamps'
import { rawDraft } from './rawDraft'
import type { DraftEntry, LogParser, LogLevel } from './types'

/** Level derived from an HTTP status code: 5xx → ERROR, 4xx → WARN, else null. */
export function levelFromStatus(status: string): LogLevel | null {
  if (!/^\d{3}$/.test(status)) return null
  const c = Number(status)
  return c >= 500 ? 'ERROR' : c >= 400 ? 'WARN' : null
}

/**
 * W3C extended log (IIS `u_ex` style): a `#Fields:` header lists the columns;
 * data rows are space-separated with `date` and `time` as separate fields.
 * Header (`#…`) lines are kept as raw entries. Overflowing cells (fields that
 * contain spaces) are re-joined into the last column.
 */
export class W3cParser implements LogParser {
  readonly kind = 'w3c' as const
  private readonly idx: Record<string, number> = {}

  constructor(private readonly fields: string[], private readonly tsOpts: TsOptions = {}) {
    fields.forEach((f, i) => {
      this.idx[f] = i
    })
  }

  parse(line: string, lineNo: number): DraftEntry[] {
    if (!line.trim()) return []
    if (line.startsWith('#')) return [rawDraft(line, lineNo)]

    const parts = line.split(' ')
    const n = this.fields.length
    if (parts.length > n) {
      parts[n - 1] = parts.splice(n - 1).join(' ')
    } else if (parts.length < n - 1) {
      return [rawDraft(line, lineNo)]
    }
    const f = (name: string): string | null => {
      const i = this.idx[name]
      return i != null && i < parts.length ? parts[i] : null
    }

    const date = f('date')
    const time = f('time')
    const ts = date != null && time != null ? parseTimestamp(`${date} ${time}`, this.tsOpts) : null

    const level = levelFromStatus(f('sc-status') ?? '')

    const method = f('cs-method')
    const uri = f('cs-uri-stem')
    const status = f('sc-status')
    const ip = f('c-ip')
    let message: string
    if (method != null && uri != null) {
      message = [ip, `${method} ${uri}`, status].filter(Boolean).join(' ')
    } else {
      const skipped = new Set<number>([this.idx['date'], this.idx['time']].filter(i => i != null))
      message = parts.filter((_, i) => !skipped.has(i)).join(' ')
    }

    return [{ ts, level, message, raw: line, lineNo }]
  }
}