import { normalizeLevel } from './levels'
import { parseTimestamp, type TsOptions } from './timestamps'
import { rawDraft } from './rawDraft'
import type { DraftEntry, LogParser } from './types'

const ATTR_RE = /([a-zA-Z_][\w.-]*)="([^"]*)"/g
const MSG_RE = /<log4j:message[^>]*>([\s\S]*?)<\/log4j:message>/
const L2_MSG_RE = /<Message[^>]*>([\s\S]*?)<\/Message>/
/** Guard against unbounded buffering if autodetect mislabels a non-XML file. */
const MAX_IDLE = 200_000

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Stateful Log4j XML parser. Supports log4j 1.x `<log4j:event>` (timestamp attr
 * = epoch ms; `<log4j:message>` body) and log4j 2 `<LogRecord>` (timeMillis /
 * instant attrs; `<Message>` body). Events may span multiple lines; a line that
 * contains no complete event emits nothing. Incomplete events at EOF get a
 * best-effort entry so nothing is lost.
 */
export class XmlLog4jParser implements LogParser {
  readonly kind = 'log4j-xml' as const
  private buf = ''

  constructor(private readonly tsOpts: TsOptions = {}) {}

  parse(line: string, lineNo: number): DraftEntry[] {
    this.buf += line + '\n'
    const out: DraftEntry[] = []
    for (;;) {
      if (this.buf.length > MAX_IDLE) {
        // Too much non-event content accumulated: emit verbatim and reset.
        out.push(rawDraft(this.buf.replace(/\s+$/, ''), lineNo))
        this.buf = ''
        return out
      }
      const i1 = this.buf.indexOf('<log4j:event')
      const i2 = this.buf.indexOf('<LogRecord')
      let start = -1
      let variant: 'l1' | 'l2' | null = null
      if (i1 !== -1 && (i2 === -1 || i1 < i2)) {
        start = i1
        variant = 'l1'
      } else if (i2 !== -1) {
        start = i2
        variant = 'l2'
      }
      if (start === -1) break
      if (!variant) break // unreachable; keeps TS narrowing honest
      if (start > 0) {
        // XML prolog/DTD/whitespace before the event — scaffolding, not data.
        this.buf = this.buf.slice(start)
        continue
      }
      const gt = this.buf.indexOf('>')
      if (gt === -1) break // opening tag not complete yet
      const openTag = this.buf.slice(0, gt + 1)
      let body: string
      let rest: string
      if (openTag.endsWith('/>')) {
        body = ''
        rest = this.buf.slice(gt + 1)
      } else {
        const endTag = variant === 'l1' ? '</log4j:event>' : '</LogRecord>'
        const end = this.buf.indexOf(endTag, gt)
        if (end === -1) break // event still open across chunks
        body = this.buf.slice(gt + 1, end)
        rest = this.buf.slice(end + endTag.length)
      }
      out.push(this.toEntry(openTag, body, lineNo, variant))
      this.buf = rest
    }
    return out
  }

  finish(lineNo: number): DraftEntry | null {
    let t = this.buf.trim()
    if (!t) return null
    this.buf = ''
    const m = /^<log4j:event\b[^>]*|<LogRecord\b[^>]*/.exec(t)
    if (m) {
      const variant = m[0].startsWith('<log4j') ? 'l1' : 'l2'
      // Best effort: close an unterminated message element so the body parses.
      const msgTag = variant === 'l1' ? '<log4j:message' : '<Message'
      const msgClose = variant === 'l1' ? '</log4j:message>' : '</Message>'
      if (t.includes(msgTag) && !t.includes(msgClose)) t += msgClose
      return this.toEntry(`${m[0]}>`, t, lineNo, variant)
    }
    return rawDraft(t, lineNo)
  }

  private toEntry(openTag: string, body: string, lineNo: number, variant: 'l1' | 'l2'): DraftEntry {
    const attrs: Record<string, string> = {}
    for (const m of openTag.matchAll(ATTR_RE)) attrs[m[1]] = m[2]

    let ts: number | null = null
    if (variant === 'l1') {
      // log4j 1.x: timestamp attr is epoch milliseconds.
      if (attrs.timestamp != null) {
        const n = Number(attrs.timestamp)
        if (Number.isFinite(n)) ts = Math.round(n)
      } else if (attrs.Date != null) {
        ts = parseTimestamp(attrs.Date, this.tsOpts)
      }
    } else {
      // log4j 2: timeMillis attr, else instant/time ISO string.
      if (attrs.timeMillis != null) {
        const n = Number(attrs.timeMillis)
        if (Number.isFinite(n)) ts = Math.round(n)
      }
      if (ts == null && (attrs.instant != null || attrs.time != null)) {
        ts = parseTimestamp(attrs.instant ?? attrs.time ?? '', this.tsOpts)
      }
    }

    const level = normalizeLevel(attrs.level)
    const msgM = (variant === 'l1' ? MSG_RE : L2_MSG_RE).exec(body)
    const message = msgM ? unescapeXml(msgM[1].replace(/\s+/g, ' ').trim()) : ''
    const closeTag = variant === 'l1' ? '</log4j:event>' : '</LogRecord>'
    const raw = openTag.endsWith('/>') ? openTag : `${openTag}${body}${closeTag}`
    return { ts, level, message, raw, lineNo }
  }
}