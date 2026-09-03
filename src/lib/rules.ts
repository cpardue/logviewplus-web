import { LEVELS, type LogEntry, type LogLevel } from '../parsers/types'

/** Curated row-color palette (readable on the dark theme). */
export const RULE_COLORS = [
  '#f85149', // red
  '#3fb950', // green
  '#d29922', // amber
  '#58a6ff', // blue
  '#bc8cff', // purple
  '#39c5cf', // cyan
] as const

/**
 * A row-coloring rule: all non-empty conditions must hold (AND) for the row to
 * be colored. Condition semantics mirror {@link ../lib/filters.Filters}:
 * text/file are case-insensitive substrings, empty `levels` means every level
 * (including entries with no level).
 */
export interface Rule {
  id: string
  /** Case-insensitive substring match on message or raw line (empty = off). */
  text: string
  /** Levels to match. Empty = all (including null-level entries). */
  levels: LogLevel[]
  /** Case-insensitive substring match on the source file name (empty = any file). */
  file: string
  /** CSS color applied to matching rows (overrides built-in level coloring). */
  color: string
}

let ruleCounter = 0

/** A fresh rule with a session-unique id. */
export function makeRule(color?: string): Rule {
  return {
    id: `r${(++ruleCounter).toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    text: '',
    levels: [],
    file: '',
    color: color ?? RULE_COLORS[0],
  }
}

export function ruleMatches(rule: Rule, entry: LogEntry): boolean {
  if (rule.levels.length > 0 && (entry.level == null || !rule.levels.includes(entry.level))) {
    return false
  }
  if (rule.text !== '') {
    const t = rule.text.toLowerCase()
    if (!entry.message.toLowerCase().includes(t) && !entry.raw.toLowerCase().includes(t)) {
      return false
    }
  }
  if (rule.file !== '') {
    const f = rule.file.toLowerCase()
    if (!(entry.file ?? '').toLowerCase().includes(f)) return false
  }
  return true
}

/** First matching rule (list order = priority) wins; null when none match. */
export function resolveRowColor(rules: readonly Rule[], entry: LogEntry): string | null {
  for (const r of rules) if (ruleMatches(r, entry)) return r.color
  return null
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/**
 * Tolerate a corrupt or stale IDB record: keep only well-formed rules so a
 * hand-edited/corrupted database can never break the grid.
 */
export function sanitizeRules(input: unknown): Rule[] {
  if (!Array.isArray(input)) return []
  const out: Rule[] = []
  for (const item of input) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string' || r.id === '') continue
    const levels = Array.isArray(r.levels)
      ? (r.levels.filter((l): l is LogLevel => typeof l === 'string' && (LEVELS as readonly string[]).includes(l)) as LogLevel[])
      : []
    out.push({
      id: r.id,
      text: typeof r.text === 'string' ? r.text : '',
      levels,
      file: typeof r.file === 'string' ? r.file : '',
      color: typeof r.color === 'string' && HEX_COLOR.test(r.color) ? r.color : RULE_COLORS[0],
    })
  }
  return out
}
