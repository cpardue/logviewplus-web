import type { LogEntry } from '../parsers/types'

function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** Filtered rows → CSV (ts ISO + epoch ms, level, message, raw, file, line number). */
export function entriesToCsv(rows: LogEntry[]): string {
  const header = 'ts_iso,ts_ms,level,message,raw,file,line_no'
  const lines = rows.map(r =>
    [
      r.ts != null ? new Date(r.ts).toISOString() : '',
      r.ts != null ? String(r.ts) : '',
      r.level ?? '',
      csvEscape(r.message),
      csvEscape(r.raw),
      csvEscape(r.file ?? ''),
      String(r.lineNo),
    ].join(','),
  )
  return [header, ...lines].join('\n')
}

/** Filtered rows → pretty JSON array (positional seq is not exported). */
export function entriesToJson(rows: LogEntry[]): string {
  const out = rows.map(r => ({
    ts: r.ts,
    level: r.level,
    message: r.message,
    raw: r.raw,
    file: r.file ?? null,
    lineNo: r.lineNo,
  }))
  return JSON.stringify(out, null, 2)
}

/** Trigger a browser download of a generated string. */
export function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}