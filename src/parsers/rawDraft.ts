import type { DraftEntry } from './types'

/** Entry that keeps the line verbatim (no structured fields) — no data loss. */
export function rawDraft(line: string, lineNo: number): DraftEntry {
  return { ts: null, level: null, message: line, raw: line, lineNo }
}