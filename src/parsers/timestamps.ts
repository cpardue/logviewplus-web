const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$/
// CLF: the offset is usually space-separated ("01/Sep/2026:08:02:33 +0000"); bare is tolerated.
const CLF_RE = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})(?: ([+-]\d{4}))?$/
// ISO 8601 ordinal date: year + day-of-year (001–366), optional time/zone.
const ORDINAL_RE = /^(\d{4})-(\d{3})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?)?$/
// Syslog date: "Sep  1 08:02:33" (day space-padded to two, no year).
const SYSLOG_RE = /^([A-Za-z]{3}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2})$/

/** Options for interpreting timestamps that carry no explicit timezone. */
export interface TsOptions {
  /** Interpret zone-less (naive) timestamps as UTC instead of local time. */
  naiveAsUtc?: boolean
}

function fracMs(frac: string): number {
  return frac === '' ? 0 : parseInt(frac.padEnd(3, '0').slice(0, 3), 10)
}

function offsetMinutes(tz: string): number {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz)
  if (!m) return 0
  const sign = m[1] === '-' ? -1 : 1
  return sign * (Number(m[2]) * 60 + Number(m[3]))
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/**
 * Parse a captured timestamp token into epoch ms.
 * Supports ISO 8601 (T or space, optional fraction/Z/offset), ISO ordinal
 * dates (`2026-244`), and Apache CLF style (offset space- or bare-separated).
 * Zone-less values follow `opts.naiveAsUtc` (default: local time).
 */
export function parseTimestamp(value: string, opts: TsOptions = {}): number | null {
  const v = value.trim()

  const iso = ISO_RE.exec(v)
  if (iso) {
    const [, Y, Mo, D, h, mi, s, frac = '', tz = ''] = iso
    const ms = fracMs(frac)
    const y = Number(Y), mo = Number(Mo) - 1, d = Number(D)
    const hh = Number(h), mm = Number(mi), ss = Number(s)
    if (tz === '') {
      // Naive: local time unless the timezone mode says UTC.
      return opts.naiveAsUtc ? Date.UTC(y, mo, d, hh, mm, ss, ms) : new Date(y, mo, d, hh, mm, ss, ms).getTime()
    }
    const base = Date.UTC(y, mo, d, hh, mm, ss, ms)
    if (tz === 'Z') return base
    // Offset like +0530: local wall time is UTC+offset → subtract.
    return base - offsetMinutes(tz) * 60_000
  }

  const ord = ORDINAL_RE.exec(v)
  if (ord) {
    const [, Y, doyStr, h = '0', mi = '0', s = '0', frac = '', tz = ''] = ord
    const y = Number(Y)
    const doy = Number(doyStr)
    if (doy < 1 || doy > (isLeap(y) ? 366 : 365)) return null
    const ms = fracMs(frac)
    const hh = Number(h), mm = Number(mi), ss = Number(s)
    if (tz === '') {
      // Ordinal date is absolute; only the time of day is "naive".
      return opts.naiveAsUtc
        ? Date.UTC(y, 0, doy, hh, mm, ss, ms)
        : new Date(y, 0, doy, hh, mm, ss, ms).getTime()
    }
    const base = Date.UTC(y, 0, doy, hh, mm, ss, ms)
    if (tz === 'Z') return base
    return base - offsetMinutes(tz) * 60_000
  }

  const clf = CLF_RE.exec(v)
  if (clf) {
    const [, D, Mon, Y, h, mi, s, off] = clf
    const mon = MONTHS[Mon]
    if (mon === undefined) return null
    const y = Number(Y), d = Number(D), hh = Number(h), mm = Number(mi), ss = Number(s)
    if (off == null) {
      // CLF without offset: treat like any naive stamp.
      return opts.naiveAsUtc ? Date.UTC(y, mon, d, hh, mm, ss) : new Date(y, mon, d, hh, mm, ss).getTime()
    }
    const m = /^([+-])(\d{2})(\d{2})$/.exec(off)
    if (!m) return null
    const sign = m[1] === '-' ? -1 : 1
    const offMin = sign * (Number(m[2]) * 60 + Number(m[3]))
    return Date.UTC(y, mon, d, hh, mm, ss) - offMin * 60_000
  }

  return null
}

/**
 * Resolve a yearless syslog date ("Sep  1 08:02:33") against an assumed year.
 * The caller owns the year-inference state (see PatternParser).
 */
export function parseSyslogTimestamp(value: string, year: number, opts: TsOptions = {}): number | null {
  const m = SYSLOG_RE.exec(value.trim())
  if (!m) return null
  const [, Mon, D, h, mi, s] = m
  const mon = MONTHS[Mon]
  if (mon === undefined) return null
  const day = Number(D)
  if (day < 1 || day > 31) return null
  return opts.naiveAsUtc
    ? Date.UTC(year, mon, day, Number(h), Number(mi), Number(s))
    : new Date(year, mon, day, Number(h), Number(mi), Number(s)).getTime()
}

/** Epoch seconds (or ms) token → epoch ms; null when not a plausible epoch value. */
export function parseEpochSeconds(value: string): number | null {
  const m = /^\d{9,16}(?:\.\d{1,9})?$/.exec(value.trim())
  if (!m) return null
  const n = Number(m[0])
  return n > 1e12 ? Math.round(n) : Math.round(n * 1000)
}

export { offsetMinutes as _offsetMinutes }