import type { LogEntry } from '../parsers/types'
import { downloadBlob, entriesToCsv, entriesToJson } from '../lib/export'

interface Props {
  /** The currently filtered rows to export. */
  rows: LogEntry[]
  /** Base name for the downloaded file (sanitized). */
  label: string
}

/** CSV/JSON export of the visible (filtered) rows. */
export default function ExportBar({ rows, label }: Props) {
  const safe = label.replace(/[^\w.-]+/g, '_') || 'log'
  return (
    <div className="export-bar">
      <button
        className="btn"
        data-testid="export-csv"
        disabled={rows.length === 0}
        onClick={() => downloadBlob(entriesToCsv(rows), `${safe}.csv`, 'text/csv;charset=utf-8')}
      >
        Export CSV
      </button>
      <button
        className="btn"
        data-testid="export-json"
        disabled={rows.length === 0}
        onClick={() => downloadBlob(entriesToJson(rows), `${safe}.json`, 'application/json')}
      >
        Export JSON
      </button>
    </div>
  )
}
