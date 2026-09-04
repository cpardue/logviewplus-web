import { useEffect, useRef } from 'react'
import { useSqliteStore, type SqliteStatus } from '../store/sqliteStore'
import ReportGrid from './ReportGrid'

interface StatusBits {
  status: SqliteStatus
  error: string | null
  fileName: string | null
  tables: string[]
  activeTable: string | null
  totalRows: number
  truncated: boolean
  rowCount: number
  queryMs: number
}

function statusText(s: StatusBits): string {
  switch (s.status) {
    case 'idle':
      return 'Open a .sqlite or .db file to browse its tables'
    case 'loading':
      return `${s.fileName ? `Opening ${s.fileName}…` : 'Opening…'} (the first open also downloads the SQL engine)`
    case 'ready': {
      if (!s.activeTable) {
        return `${s.fileName ?? 'Database'} — ${s.tables.length} table${s.tables.length === 1 ? '' : 's'}; pick one to browse`
      }
      return (
        `${s.activeTable}: ${s.totalRows.toLocaleString()} row${s.totalRows === 1 ? '' : 's'} in ${s.queryMs} ms` +
        (s.truncated ? ` — showing first ${s.rowCount.toLocaleString()}` : '') +
        (s.fileName ? ` · ${s.fileName}` : '')
      )
    }
    case 'error':
      return s.error ?? 'Open failed'
  }
}

export default function SqliteBar() {
  const status = useSqliteStore(s => s.status)
  const error = useSqliteStore(s => s.error)
  const fileName = useSqliteStore(s => s.fileName)
  const tables = useSqliteStore(s => s.tables)
  const activeTable = useSqliteStore(s => s.activeTable)
  const columns = useSqliteStore(s => s.columns)
  const rows = useSqliteStore(s => s.rows)
  const totalRows = useSqliteStore(s => s.totalRows)
  const truncated = useSqliteStore(s => s.truncated)
  const queryMs = useSqliteStore(s => s.queryMs)
  const openFile = useSqliteStore(s => s.openFile)
  const selectTable = useSqliteStore(s => s.selectTable)
  const inputRef = useRef<HTMLInputElement>(null)

  // Expose state for E2E assertions.
  useEffect(() => {
    ;(window as unknown as { __sqlite?: unknown }).__sqlite = {
      status,
      error,
      fileName,
      tables,
      activeTable,
      columns,
      rows: rows.slice(0, 1000),
      totalRows,
      truncated,
    }
  }, [status, error, fileName, tables, activeTable, columns, rows, totalRows, truncated])

  return (
    <section className="report">
      <div className="report-bar">
        <button className="btn" data-testid="sqlite-open" onClick={() => inputRef.current?.click()}>
          Open SQLite…
        </button>
        <input
          ref={inputRef}
          data-testid="sqlite-input"
          type="file"
          hidden
          accept=".sqlite,.db"
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void openFile(f)
          }}
        />
        <div className="chips">
          {tables.map(t => (
            <button
              key={t}
              className={`chip${activeTable === t ? ' on' : ''}`}
              data-testid={`sqlite-table-${t}`}
              disabled={status === 'loading'}
              onClick={() => void selectTable(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <span data-testid="sqlite-status" className={status === 'error' ? 't-error' : undefined}>
          {statusText({ status, error, fileName, tables, activeTable, totalRows, truncated, rowCount: rows.length, queryMs })}
        </span>
      </div>
      <div className="grid-wrap">
        {columns.length > 0 ? (
          <ReportGrid columns={columns} rows={rows} />
        ) : (
          <div className="empty-hint">
            {status === 'error'
              ? 'The file could not be opened — see the status above'
              : fileName && activeTable == null
                ? 'Pick a table to browse its rows'
                : 'Open a .sqlite or .db file to browse its tables'}
          </div>
        )}
      </div>
    </section>
  )
}
