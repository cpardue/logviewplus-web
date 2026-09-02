/** Date/time token union: ISO 8601 (T or space, optional fraction/Z/offset) | Apache CLF | short date+time. */
const DATE_PATTERN =
  String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?` +
  String.raw`|\d{2}/[A-Za-z]{3}/\d{4}:\d{2}:\d{2}:\d{2}(?: [+-]\d{4})?` +
  String.raw`|\d{1,2}[/-]\d{1,2}[/-]\d{2,4} \d{2}:\d{2}:\d{2}`

export interface SpecifierDef {
  key: string
  label: string
  /** Regex source; wrapped in one capture group at compile time. */
  pattern: string
}

/**
 * LVP-style conversion specifiers (initial subset).
 * `%m` must appear exactly once and is conventionally last (it consumes the rest of the line).
 */
export const SPECIFIERS: Record<string, SpecifierDef> = {
  '%d': { key: '%d', label: 'Date/Time', pattern: DATE_PATTERN },
  '%l': { key: '%l', label: 'Level', pattern: '[A-Za-z][A-Za-z]*' },
  '%t': { key: '%t', label: 'Thread', pattern: '[A-Za-z0-9_\\-\\.\\[\\]:]+' },
  '%m': { key: '%m', label: 'Message', pattern: '.*' },
}

export const SPECIFIER_TOKEN = /%[a-zA-Z]/g

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface CompiledPattern {
  regex: RegExp
  /** Specifier key for each capture group index (0-based). */
  groups: string[]
}

/** Compile a specifier template (e.g. `%d %l: %m`) into an anchored line regex. */
export function compilePattern(template: string): CompiledPattern {
  let source = ''
  const groups: string[] = []
  let last = 0
  for (const m of template.matchAll(SPECIFIER_TOKEN)) {
    const tok = m[0]
    const def = SPECIFIERS[tok]
    if (!def) throw new Error(`Unknown specifier: ${tok}`)
    if (m.index === undefined) continue
    source += escapeRegExp(template.slice(last, m.index))
    source += `((?:${def.pattern}))`
    groups.push(tok)
    last = m.index + tok.length
  }
  source += escapeRegExp(template.slice(last))
  if (groups.length === 0) throw new Error('Template contains no specifiers')
  return { regex: new RegExp(`^${source}$`), groups }
}
