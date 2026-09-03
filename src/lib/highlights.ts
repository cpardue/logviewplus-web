import type { LogEntry } from '../parsers/types'

/** Accent color for pinned rows (readable on the dark theme). */
export const HIGHLIGHT_ACCENT = '#ffd75e'

/**
 * A pinned row with an optional note. Identity is the exact (file, lineNo)
 * pair — the engine stamps `entry.file` in every view, so a pin follows its
 * row across single-file tabs and the merged "All" view. Notes are NOT
 * pattern-based (that is what rules/filters are): they attach to one row.
 */
export interface Highlight {
  id: string
  /** Source file name (engine-stamped; '' when unknown). */
  file: string
  /** 1-based line number in the source file. */
  lineNo: number
  note: string
}

let highlightCounter = 0

/** A fresh pin with a session-unique id and an empty note. */
export function makeHighlight(file: string, lineNo: number): Highlight {
  return {
    id: `h${(++highlightCounter).toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    file,
    lineNo,
    note: '',
  }
}

/** The pin for this exact row (first in list order), or null when not pinned. */
export function highlightFor(highlights: readonly Highlight[], entry: LogEntry): Highlight | null {
  for (const h of highlights) {
    if (h.file === (entry.file ?? '') && h.lineNo === entry.lineNo) return h
  }
  return null
}

/** True when the row already carries a pin (used to offer Remove instead of Add). */
export function isPinned(highlights: readonly Highlight[], entry: LogEntry): boolean {
  return highlightFor(highlights, entry) !== null
}

/**
 * Tolerate corrupt or stale IDB records: keep only well-formed pins so a
 * hand-edited/corrupted database can never break the grid or the notes bar.
 */
export function sanitizeHighlights(input: unknown): Highlight[] {
  if (!Array.isArray(input)) return []
  const out: Highlight[] = []
  for (const item of input) {
    if (typeof item !== 'object' || item === null) continue
    const h = item as Record<string, unknown>
    if (typeof h.id !== 'string' || h.id === '') continue
    if (typeof h.file !== 'string') continue
    const lineNo = typeof h.lineNo === 'number' ? Math.trunc(h.lineNo) : Number.NaN
    if (!Number.isInteger(lineNo) || lineNo < 1) continue
    out.push({ id: h.id, file: h.file, lineNo, note: typeof h.note === 'string' ? h.note : '' })
  }
  return out
}