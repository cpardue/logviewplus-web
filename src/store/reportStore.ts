import { create } from 'zustand'
import type { LogEntry } from '../parsers/types'
import { REPORT_PRESETS, type ReportPreset } from '../lib/sql/presets'
import type { CellValue } from '../lib/sql/result'

export type ReportStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ReportState {
  /** SQL currently in the editor (persisted across sessions). */
  sql: string
  status: ReportStatus
  error: string | null
  columns: string[]
  rows: CellValue[][]
  rowCount: number
  truncated: boolean
  totalRows: number
  /** Milliseconds spent loading entries into DuckDB for the last run. */
  loadMs: number
  /** Milliseconds for the query itself (last run). */
  queryMs: number
  setSql(sql: string): void
  applyPreset(preset: ReportPreset): void
  /** Run the editor SQL over the given (unfiltered) entry set. */
  run(entries: LogEntry[]): Promise<void>
}

const SQL_KEY = 'lvp.reportSql'

function readSql(): string {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SQL_KEY) || REPORT_PRESETS[0].sql
  } catch {
    return REPORT_PRESETS[0].sql
  }
}

/** Monotonic run id: stale async results never clobber a newer run. */
let runId = 0

export const useReportStore = create<ReportState>((set, get) => ({
  sql: readSql(),
  status: 'idle',
  error: null,
  columns: [],
  rows: [],
  rowCount: 0,
  truncated: false,
  totalRows: 0,
  loadMs: 0,
  queryMs: 0,

  setSql(sql) {
    set({ sql })
    try {
      localStorage.setItem(SQL_KEY, sql)
    } catch {
      // persistence is best-effort
    }
  },

  applyPreset(preset) {
    get().setSql(preset.sql)
  },

  async run(entries) {
    const id = ++runId
    const sql = get().sql.trim()
    if (!sql) return
    set({ status: 'loading', error: null })
    try {
      // Lazy chunk: engine + DuckDB wrapper load only now, on first use.
      const { getSqlEngine } = await import('../lib/sql/engine')
      const engine = await getSqlEngine()
      if (id !== runId) return

      const t0 = performance.now()
      await engine.loadEntries(entries)
      if (id !== runId) return
      const loadMs = Math.round(performance.now() - t0)

      const q0 = performance.now()
      const result = await engine.query(sql)
      if (id !== runId) return
      const queryMs = Math.round(performance.now() - q0)

      set({
        status: 'ready',
        error: null,
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rows.length,
        truncated: result.truncated,
        totalRows: result.totalRows,
        loadMs,
        queryMs,
      })
    } catch (e) {
      if (id !== runId) return
      let msg = e instanceof Error ? e.message : String(e)
      try {
        // Re-import hits the module cache; kept here so the lazy chunk is never
        // pulled in by a static import.
        const { sqlErrorMessage } = await import('../lib/sql/engine')
        msg = sqlErrorMessage(e)
      } catch {
        // engine chunk itself failed to load — keep the raw message
      }
      set({ status: 'error', error: msg })
    }
  },
}))
