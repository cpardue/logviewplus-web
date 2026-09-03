/**
 * Preset reports shown as one-click chips above the SQL editor. All run
 * against the `entries` table (see MILESTONE-3.md for its schema).
 */
export interface ReportPreset {
  slug: string
  label: string
  sql: string
}

export const REPORT_PRESETS: ReportPreset[] = [
  {
    slug: 'level-counts',
    label: 'Level counts',
    sql: `SELECT
  COALESCE(level, '(none)') AS level,
  COUNT(*) AS entries
FROM entries
GROUP BY 1
ORDER BY 2 DESC`,
  },
  {
    slug: 'entries-per-minute',
    label: 'Entries per minute',
    // ts_iso is a UTC ISO-8601 string; slicing it is timezone-proof and avoids
    // numeric epoch casts (and DuckDB-WASM's broken error path, upstream #1966,
    // which hides the real cause of any SQL-level failure).
    sql: `SELECT
  replace(substr(ts_iso, 1, 16), 'T', ' ') AS minute,
  COUNT(*) AS entries
FROM entries
WHERE ts_iso IS NOT NULL
GROUP BY 1
ORDER BY 1`,
  },
  {
    slug: 'top-messages',
    label: 'Top messages',
    sql: `SELECT message, COUNT(*) AS n
FROM entries
GROUP BY 1
ORDER BY 2 DESC, 1
LIMIT 50`,
  },
  {
    slug: 'per-file',
    label: 'Entries per file',
    sql: `SELECT
  COALESCE(file, '(unknown)') AS file,
  COUNT(*) AS entries
FROM entries
GROUP BY 1
ORDER BY 2 DESC`,
  },
]
