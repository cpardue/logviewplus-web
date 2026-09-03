import { useEffect } from 'react'
import type { LogEntry } from '../parsers/types'
import { useReportStore, type ReportStatus } from '../store/reportStore'
import { REPORT_PRESETS } from '../lib/sql/presets'
import ReportGrid from './ReportGrid'

interface Props {
  /** The unfiltered entry set of the current scope (active file or merged). */
  entries: LogEntry[]
  /** Human label of the scope, for the status line. */
  scopeLabel: string
}

interface StatusBits {
  status: ReportStatus
  sql: string
  error: string | null
  queryMs: number
  loadMs: number
  totalRows: number
  truncated: boolean
  rowCount: number
}

function statusText(s: StatusBits): string {
  switch (s.status) {
    case 'idle':
      return s.sql ? 'Ready — press Run' : 'Write or pick a query, then Run'
    case 'loading':
      return 'Running… (the first run also downloads the SQL engine)'
    case 'ready':
      return `${s.totalRows.toLocaleString()} row${s.totalRows === 1 ? '' : 's'} in ${s.queryMs} ms` +
        (s.truncated ? ` — showing first ${s.rowCount.toLocaleString()}` : '') +
        ` · entries loaded in ${s.loadMs} ms`
    case 'error':
      return s.error ?? 'Query failed'
  }
}

export default function ReportBar({ entries, scopeLabel }: Props) {
  const sql = useReportStore(s => s.sql)
  const status = useReportStore(s => s.status)
  const error = useReportStore(s => s.error)
  const columns = useReportStore(s => s.columns)
  const rows = useReportStore(s => s.rows)
  const totalRows = useReportStore(s => s.totalRows)
  const truncated = useReportStore(s => s.truncated)
  const rowCount = useReportStore(s => s.rowCount)
  const queryMs = useReportStore(s => s.queryMs)
  const loadMs = useReportStore(s => s.loadMs)
  const setSql = useReportStore(s => s.setSql)
  const applyPreset = useReportStore(s => s.applyPreset)
  const run = useReportStore(s => s.run)

  // Expose state for E2E assertions.
  useEffect(() => {
    ;(window as unknown as { __report?: unknown }).__report = {
      status,
      rowCount,
      totalRows,
      truncated,
      error,
      columns,
      rows: rows.slice(0, 1000),
    }
  }, [status, rowCount, totalRows, truncated, error, columns, rows])

  const disabled = status === 'loading' || entries.length === 0

  return (
    <section className="report">
      <div className="report-bar">
        <div className="chips">
          {REPORT_PRESETS.map(p => (
            <button
              key={p.slug}
              className={`chip${sql === p.sql ? ' on' : ''}`}
              data-testid={`preset-${p.slug}`}
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          className="btn"
          data-testid="report-run"
          disabled={disabled}
          onClick={() => void run(entries)}
        >
          Run
        </button>
        <span
          data-testid="report-status"
          className={status === 'error' ? 't-error' : undefined}
          title={scopeLabel}
        >
          {statusText({ status, sql, error, queryMs, loadMs, totalRows, truncated, rowCount })}
        </span>
      </div>
      <textarea
        className="report-editor"
        data-testid="report-editor"
        spellCheck={false}
        value={sql}
        onChange={e => setSql(e.target.value)}
        placeholder="SELECT level, COUNT(*) AS n FROM entries GROUP BY 1 ORDER BY 2 DESC"
      />
      <div className="grid-wrap">
        {columns.length > 0 ? (
          <ReportGrid columns={columns} rows={rows} />
        ) : (
          <div className="empty-hint">
            {entries.length === 0
              ? 'Open log files first — reports run over the parsed entries'
              : `Reports over ${scopeLabel} · available columns: seq, ts_ms, ts_iso, level, message, raw, file, line_no`}
          </div>
        )}
      </div>
    </section>
  )
}
