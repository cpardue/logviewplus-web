import type { LogEntry, LogLevel } from '../parsers/types'

export interface Filters {
  /** Case-insensitive substring match on message or raw line. Empty = off. */
  text: string
  /** Allowed levels. Empty = all (including null-level entries). */
  levels: LogLevel[]
}

export const EMPTY_FILTERS: Filters = { text: '', levels: [] }

export function entryMatches(entry: LogEntry, filters: Filters): boolean {
  if (filters.levels.length > 0) {
    if (entry.level == null || !filters.levels.includes(entry.level)) return false
  }
  if (filters.text) {
    const t = filters.text.toLowerCase()
    if (!entry.message.toLowerCase().includes(t) && !entry.raw.toLowerCase().includes(t)) {
      return false
    }
  }
  return true
}

export function applyFilters(entries: LogEntry[], filters: Filters): LogEntry[] {
  if (!filters.text && filters.levels.length === 0) return entries
  return entries.filter(e => entryMatches(e, filters))
}
