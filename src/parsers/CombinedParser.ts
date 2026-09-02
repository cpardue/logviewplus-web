import { parseTimestamp } from './timestamps'
import { rawDraft } from './rawDraft'
import type { DraftEntry, LogParser } from './types'
import { levelFromStatus } from './W3cParser'

/** Apache/Nginx common log format + combined (trailing referrer/user-agent). */
export const COMBINED_RE =
  /^(\S+) (\S+) (\S+) \[([^\]]+)\] "([A-Z]+) (\S+)(?: ([^"]*))?" (\d{3}) (\d+|-)(?: "([^"]*)" "([^"]*)")?/

/** Classic common/combined access-log parser (one request per line). */
export class CombinedParser implements LogParser {
  readonly kind = 'combined' as const

  parse(line: string, lineNo: number): DraftEntry[] {
    if (!line.trim()) return []
    const m = COMBINED_RE.exec(line)
    if (!m) return [rawDraft(line, lineNo)]
    const [, , , , dt, method, uri, proto, status] = m
    const ts = parseTimestamp(dt)
    const level = levelFromStatus(status)
    const message = `${method} ${uri}${proto ? ` ${proto}` : ''} ${status}`
    return [{ ts, level, message, raw: line, lineNo }]
  }
}