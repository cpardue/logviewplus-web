import { create } from 'zustand'
import type { CellValue } from '../lib/sql/result'

export type SqliteStatus = 'idle' | 'loading' | 'ready' | 'error'

interface SqliteState {
  status: SqliteStatus
  error: string | null
  /** Name of the file most recently opened (successful or not). */
  fileName: string | null
  /** User tables of the open database, sorted. */
  tables: string[]
  activeTable: string | null
  columns: string[]
  rows: CellValue[][]
  totalRows: number
  truncated: boolean
  /** Milliseconds spent opening + listing tables (last open). */
  loadMs: number
  /** Milliseconds for the last table read. */
  queryMs: number
  /**
   * Bumped on every completed open (success OR error) so the app can switch
   * to the SQLite view when a file is routed in from the log side.
   */
  openSeq: number
  /** Open a .sqlite/.db file; never rejects — failures land in `error`. */
  openFile(file: File): Promise<void>
  /** Read one table of the open database into the grid. */
  selectTable(name: string): Promise<void>
}

/** Monotonic run id: stale async results never clobber a newer run. */
let runId = 0

const IDLE_DATA = {
  fileName: null,
  tables: [] as string[],
  activeTable: null,
  columns: [] as string[],
  rows: [] as CellValue[][],
  totalRows: 0,
  truncated: false,
}

function errorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m || 'Could not read the file.'
}

export const useSqliteStore = create<SqliteState>((set, get) => ({
  status: 'idle',
  error: null,
  ...IDLE_DATA,
  loadMs: 0,
  queryMs: 0,
  openSeq: 0,

  async openFile(file) {
    const id = ++runId
    set({ status: 'loading', error: null, fileName: file.name })
    try {
      // Lazy chunk: sql.js + wasm load only now, on first use.
      const { getSqliteEngine } = await import('../lib/sqlite/engine')
      const engine = await getSqliteEngine()
      if (id !== runId) return

      const t0 = performance.now()
      const bytes = new Uint8Array(await file.arrayBuffer())
      await engine.open(bytes)
      if (id !== runId) return
      const loadMs = Math.round(performance.now() - t0)

      const tables = await engine.listTables()
      if (id !== runId) return
      // Re-select the previously active table when it still exists, so a
      // re-open lands where the user was looking.
      const prev = get().activeTable
      const active = prev != null && tables.includes(prev) ? prev : null
      set(s => ({
        status: 'ready',
        error: null,
        fileName: file.name,
        tables,
        activeTable: active,
        loadMs,
        openSeq: s.openSeq + 1,
      }))
      if (active) await get().selectTable(active)
    } catch (e) {
      if (id !== runId) return
      set(s => ({
        status: 'error',
        error: errorMessage(e),
        ...IDLE_DATA,
        fileName: file.name,
        loadMs: 0,
        openSeq: s.openSeq + 1,
      }))
    }
  },

  async selectTable(name) {
    const id = ++runId
    set({ status: 'loading', error: null, activeTable: name })
    try {
      const { getSqliteEngine } = await import('../lib/sqlite/engine')
      const engine = await getSqliteEngine()
      if (id !== runId) return

      const t0 = performance.now()
      const data = await engine.readTable(name)
      if (id !== runId) return
      const queryMs = Math.round(performance.now() - t0)

      set({
        status: 'ready',
        error: null,
        activeTable: name,
        columns: data.columns,
        rows: data.rows,
        totalRows: data.totalRows,
        truncated: data.truncated,
        queryMs,
      })
    } catch (e) {
      if (id !== runId) return
      set({
        status: 'error',
        error: errorMessage(e),
        columns: [],
        rows: [],
        totalRows: 0,
        truncated: false,
      })
    }
  },
}))
