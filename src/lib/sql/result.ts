import type { Table } from 'apache-arrow'

/** A cell in a report result grid. */
export type CellValue = string | number | boolean | null

export interface ReportResult {
  columns: string[]
  /** Row-major cells, capped at {@link MAX_RESULT_ROWS}. */
  rows: CellValue[][]
  /** True when the query produced more rows than were kept for display. */
  truncated: boolean
  /** Total rows reported by the engine before the cap. */
  totalRows: number
}

/** Hard cap on displayed result rows (AG Grid is virtualized, but IPC +
 *  JS-object materialization are not free at millions of rows). */
export const MAX_RESULT_ROWS = 50_000

function normalize(v: unknown): CellValue {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'bigint') return Number(v)
  if (v instanceof Date) return v.toISOString()
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/**
 * Flatten an Arrow result table (as returned by DuckDB-WASM `conn.query`) into
 * grid-friendly column names + row-major cells, capping the row count.
 * Iterates record batches so a huge result never materializes in one go.
 */
export function mapArrowTableToResult(table: Table): ReportResult {
  const columns = table.schema.fields.map((f) => f.name)
  const rows: CellValue[][] = []
  let totalRows = 0
  for (const batch of table.batches) {
    const records = batch.toArray() as Record<string, unknown>[]
    for (const rec of records) {
      totalRows++
      if (rows.length < MAX_RESULT_ROWS) rows.push(columns.map((c) => normalize(rec[c])))
    }
    if (rows.length >= MAX_RESULT_ROWS) break
  }
  return { columns, rows, truncated: totalRows > rows.length, totalRows }
}
