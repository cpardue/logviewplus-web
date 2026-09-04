import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { Database, Statement } from 'sql.js'
import { MAX_RESULT_ROWS } from '../sql/result'
import { mapTableResult, quoteIdent, sanitizeTableNames, type SqlTableData } from './result'

// This module (and its `sql.js` import) is only ever reached through a dynamic
// import from the sqlite store, so nothing here — and the ~1.2 MB wasm
// referenced by the URL above — joins the main bundle. The wasm itself is
// fetched by the Emscripten glue only at first init.

// @types/sql.js is incomplete: Statement.getColumnNames() exists at runtime
// (verified against sql.js 1.14.2) but is not declared there.
type ColumnStatement = Statement & { getColumnNames(): string[] }

export interface SqliteEngine {
  /** Open a database from raw file bytes; closes any previously open one. */
  open(bytes: Uint8Array): Promise<void>
  /** User tables (internal sqlite_% rows excluded), sorted. */
  listTables(): Promise<string[]>
  /** All columns + capped rows of one table. */
  readTable(name: string): Promise<SqlTableData>
  close(): void
}

let enginePromise: Promise<SqliteEngine> | null = null

export function getSqliteEngine(): Promise<SqliteEngine> {
  if (!enginePromise) {
    // A failed first load (wasm fetch/compile) must not poison later opens.
    enginePromise = createEngine().catch((e) => {
      enginePromise = null
      throw e
    })
  }
  return enginePromise
}

async function createEngine(): Promise<SqliteEngine> {
  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  let db: Database | null = null

  function requireDb(): Database {
    if (!db) throw new Error('No SQLite file is open')
    return db
  }

  function closeDb(): void {
    if (db) {
      try {
        db.close()
      } catch {
        // already closed — nothing to do
      }
      db = null
    }
  }

  return {
    async open(bytes) {
      closeDb()
      // SQL.Database throws when the bytes are not a SQLite file.
      db = new SQL.Database(bytes)
    },

    async listTables() {
      const d = requireDb()
      const res = d.exec(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      const names = res.length > 0 ? (res[0].values.flat().map((v) => (typeof v === 'string' ? v : String(v)))) : []
      return sanitizeTableNames(names)
    },

    async readTable(name) {
      const d = requireDb()
      const q = quoteIdent(name)
      if (!q) throw new Error('Invalid table name')
      // COUNT first so the fetch is capped at exactly what will be shown —
      // a million-row table never materializes in JS beyond the cap.
      const countRes = d.exec(`SELECT COUNT(*) FROM ${q}`)
      const totalRows = Number(countRes[0]?.values[0]?.[0] ?? 0)
      const stmt = d.prepare(`SELECT * FROM ${q} LIMIT ?`) as unknown as ColumnStatement
      try {
        stmt.bind([Math.min(totalRows, MAX_RESULT_ROWS)])
        const records: Record<string, unknown>[] = []
        while (stmt.step()) records.push(stmt.getAsObject() as Record<string, unknown>)
        return mapTableResult(stmt.getColumnNames(), records, totalRows)
      } finally {
        stmt.free()
      }
    },

    close() {
      closeDb()
    },
  }
}
