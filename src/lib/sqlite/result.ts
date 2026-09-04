import { MAX_RESULT_ROWS, type CellValue } from '../sql/result'

/** One opened SQLite table, shaped for the grid (same cell contract as reports). */
export interface SqlTableData {
  columns: string[]
  /** Row-major cells, capped at {@link MAX_RESULT_ROWS}. */
  rows: CellValue[][]
  /** Total rows reported by the engine's COUNT(*) before the cap. */
  totalRows: number
  /** True when the table has more rows than were kept for display. */
  truncated: boolean
}

/**
 * Normalize one SQLite cell value (as returned by sql.js) into a grid cell.
 * BLOBs become a `<binary N bytes>` marker instead of dumping raw bytes into
 * the DOM; bigints are stringified so values beyond double precision survive.
 */
export function normalizeCell(v: unknown): CellValue {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v)
  if (typeof v === 'bigint') return String(v)
  if (v instanceof Uint8Array) return `<binary ${v.length} byte${v.length === 1 ? '' : 's'}>`
  if (v instanceof Date) return v.toISOString()
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/**
 * Map a table's rows (objects keyed by column name, as returned by sql.js
 * `Statement.getAsObject`) into row-major grid cells. `totalRows` comes from
 * the engine's COUNT(*) and may exceed `records.length` (the fetch is capped) —
 * the truncation flag is computed here so it stays unit-testable without a
 * database. The optional `cap` override exists for tests (the production cap
 * is the shared report limit, MAX_RESULT_ROWS).
 */
export function mapTableResult(
  columns: string[],
  records: Record<string, unknown>[],
  totalRows: number,
  cap: number = MAX_RESULT_ROWS,
): SqlTableData {
  const rows = records.slice(0, cap).map((rec) => columns.map((c) => normalizeCell(rec[c])))
  return { columns, rows, totalRows, truncated: totalRows > rows.length }
}

/** Strip one pair of surrounding double quotes from a table name. */
export function stripQuotes(name: string): string {
  return name.length >= 2 && name.startsWith('"') && name.endsWith('"') ? name.slice(1, -1) : name
}

/**
 * Filter `sqlite_master` names down to real user tables: non-strings and empty
 * names drop, internal `sqlite_%` rows drop (AUTOINCREMENT's
 * `sqlite_sequence` included), quoted names are unquoted, duplicates collapse
 * (case-insensitive — SQLite's default collation), and the result is sorted
 * case-insensitively for a stable UI order.
 */
export function sanitizeTableNames(names: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    if (typeof n !== 'string') continue
    const raw = n.trim()
    if (!raw || raw.startsWith('sqlite_')) continue
    const name = stripQuotes(raw)
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/**
 * Render a table name as a double-quoted SQL identifier. The names come from
 * the database's own `sqlite_master` (not user input), but quoting keeps
 * reserved words (`order`, `select`) and odd names working. Returns '' for
 * anything unusable.
 */
export function quoteIdent(name: string): string {
  if (typeof name !== 'string' || name.trim() === '') return ''
  return `"${name.replace(/"/g, '""')}"`
}
