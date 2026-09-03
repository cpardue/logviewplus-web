import wasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import workerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import type { LogEntry } from '../../parsers/types'
import { buildEntriesTable } from './entries-table'
import { mapArrowTableToResult, type ReportResult } from './result'

// This module (and its `@duckdb/duckdb-wasm` wrapper import) is only ever
// reached through a dynamic import from the report store, so nothing here —
// and the ~38 MB wasm referenced by the URLs above — joins the main bundle.
// The wasm itself is fetched by the worker glue only at first instantiate.

export interface SqlEngine {
  /** (Re)build the `entries` table; a no-op when the same array was loaded last. */
  loadEntries(entries: LogEntry[]): Promise<void>
  query(sql: string): Promise<ReportResult>
  close(): void
}

function errorMessage(e: unknown): string {
  const m =
    e instanceof Error
      ? e.message
      : typeof e === 'object' && e !== null && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e)
  return m || 'DuckDB error'
}

// Re-export for consumers that surface errors (keeps one normalization point).
export function sqlErrorMessage(e: unknown): string {
  const m = errorMessage(e)
  // The DuckDB-WASM MVP worker has a broken exception shim: errors thrown
  // inside the wasm surface as a JS ReferenceError instead of the real
  // message (upstream issue duckdb-wasm#1966). Say so rather than showing
  // the opaque shim artifact to the user.
  if (/(_setThrew|_resumeException)\s+is not defined/i.test(m)) {
    return 'Query failed — DuckDB-WASM could not report the cause (known upstream bug, duckdb-wasm#1966). Check the statement syntax and column types.'
  }
  return m
}

let enginePromise: Promise<SqlEngine> | null = null

export function getSqlEngine(): Promise<SqlEngine> {
  if (!enginePromise) {
    // A failed first load (wasm fetch/compile) must not poison later runs.
    enginePromise = createEngine().catch((e) => {
      enginePromise = null
      throw e
    })
  }
  return enginePromise
}

async function createEngine(): Promise<SqlEngine> {
  const duckdb = await import('@duckdb/duckdb-wasm')
  const worker = new Worker(workerUrl)
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker)
  try {
    await db.instantiate(wasmUrl, undefined)
  } catch (e) {
    worker.terminate()
    throw e
  }
  const conn = await db.connect()

  let lastLoaded: LogEntry[] | null = null

  return {
    async loadEntries(entries) {
      if (lastLoaded === entries) return
      lastLoaded = entries
      await conn.query('DROP TABLE IF EXISTS entries')
      await conn.insertArrowTable(buildEntriesTable(entries), { name: 'entries' })
    },
    async query(sql) {
      const table = await conn.query(sql)
      return mapArrowTableToResult(table)
    },
    close() {
      // terminate() shuts the worker down (and resolves only once it has);
      // the explicit worker.terminate() is a belt-and-braces fallback.
      void db.terminate().catch(() => undefined)
      worker.terminate()
    },
  }
}

