const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$/
const CLF_RE = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})([+-]\d{4})?$/

function fracMs(frac: string): number {
  return frac === '' ? 0 : parseInt(frac.padEnd(3, '0').slice(0, 3), 10)
}

function offsetMinutes(tz: string): number {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz)
  if (!m) return 0
  const sign = m[1] === '-' ? -1 : 1
  return sign * (Number(m[2]) * 60 + Number(m[3]))
}

/**
 * Parse a captured timestamp token into epoch ms.
 * Supports ISO 8601 (Z / explicit offset / naive-as-local) and Apache CLF style.
 */
export function parseTimestamp(value: string): number | null {
  const v = value.trim()

  const iso = ISO_RE.exec(v)
  if (iso) {
    const [, Y, Mo, D, h, mi, s, frac = '', tz = ''] = iso
    const ms = fracMs(frac)
    if (tz === '') {
      // Naive: interpret in local time (M1 behavior; timezone settings come later).
      return new Date(Number(Y), Number(Mo) - 1, Number(D), Number(h), Number(mi), Number(s), ms).getTime()
    }
    const base = Date.UTC(
      Number(Y), Number(Mo) - 1, Number(D), Number(h), Number(mi), Number(s), ms,
    )
    if (tz === 'Z') return base
    // Offset like +0530: local wall time is UTC+offset → subtract.
    const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz)
    if (!m) return null
    const sign = m[1] === '-' ? -1 : 1
    return base - sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000
  }

  const clf = CLF_RE.exec(v)
  if (clf) {
    const [, D, Mon, Y, h, mi, s, off = '+0000'] = clf
    const mon = MONTHS[Mon]
    if (mon === undefined) return null
    const m = /^([+-])(\d{2})(\d{2})$/.exec(off)
    if (!m) return null
    const sign = m[1] === '-' ? -1 : 1
    const offMin = sign * (Number(m[2]) * 60 + Number(m[3]))
    return Date.UTC(Number(Y), mon, Number(D), Number(h), Number(mi), Number(s)) - offMin * 60_000
  }

  return null
}

export { offsetMinutes as _offsetMinutes }
