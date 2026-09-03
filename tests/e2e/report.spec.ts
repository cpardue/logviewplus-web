import { expect, test } from '@playwright/test'

const FIXTURE = 'tests/fixtures/logs/mixed-levels.log'

interface ReportState {
  status: string
  rowCount: number
  totalRows: number
  truncated: boolean
  error: string | null
  columns: string[]
  rows: (string | number | boolean | null)[][]
}

async function report(page: import('@playwright/test').Page): Promise<ReportState | undefined> {
  return page.evaluate(() => (window as unknown as { __report?: ReportState }).__report)
}

/** mixed-levels.log: 40 entries — INFO 15, DEBUG 7, WARN 7, ERROR 5, TRACE 3, FATAL 2, no level 1. */
async function parseReady(page: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __appCounts?: { total: number } }).__appCounts?.total ?? -1), {
      timeout: 20_000,
    })
    .toBe(40)
}

test('report tab runs the level-counts preset over the parsed entries', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await parseReady(page)

  await page.getByTestId('tab-report').click()
  // First Run downloads + compiles the DuckDB-WASM engine (~38 MB wasm) — allow
  // generous headroom; later runs reuse the live engine.
  await page.getByTestId('report-run').click()
  await expect.poll(async () => (await report(page))?.status, { timeout: 180_000 }).toBe('ready')

  const r = (await report(page))!
  expect(r.columns).toEqual(['level', 'entries'])
  expect(r.totalRows).toBe(7)
  // Assert as a set (DuckDB does not guarantee order among ties).
  const byLevel = Object.fromEntries(r.rows.map(([level, n]) => [level, n]))
  expect(byLevel).toEqual({ INFO: 15, DEBUG: 7, WARN: 7, ERROR: 5, TRACE: 3, FATAL: 2, '(none)': 1 })

  // Status line shows the row count.
  await expect(page.getByTestId('report-status')).toContainText('7 rows')
})

test('custom SQL queries run against the entries table; errors surface', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await parseReady(page)
  await page.getByTestId('tab-report').click()

  // Engine loads on this first run (preset default is in the editor).
  await page.getByTestId('report-run').click()
  await expect.poll(async () => (await report(page))?.status, { timeout: 180_000 }).toBe('ready')

  // COUNT(*) over all entries.
  await page.getByTestId('report-editor').fill('SELECT COUNT(*) AS n FROM entries')
  await page.getByTestId('report-run').click()
  await expect.poll(async () => (await report(page))?.status, { timeout: 60_000 }).toBe('ready')
  let r = (await report(page))!
  expect(r.totalRows).toBe(1)
  expect(r.rows[0][0]).toBe(40)

  // WHERE on the parsed level column.
  await page.getByTestId('report-editor').fill("SELECT COUNT(*) AS n FROM entries WHERE level = 'FATAL'")
  await page.getByTestId('report-run').click()
  await expect.poll(async () => (await report(page))?.status, { timeout: 60_000 }).toBe('ready')
  r = (await report(page))!
  expect(r.rows[0][0]).toBe(2)

  // A broken query reports an error without killing the engine.
  await page.getByTestId('report-editor').fill('SELEC oops FROM nowheresland')
  await page.getByTestId('report-run').click()
  await expect.poll(async () => (await report(page))?.status, { timeout: 60_000 }).toBe('error')
  expect(((await report(page))?.error ?? '').length).toBeGreaterThan(0)

  // …and a valid query afterwards recovers to ready.
  await page.getByTestId('report-editor').fill('SELECT COUNT(*) AS n FROM entries')
  await page.getByTestId('report-run').click()
  await expect.poll(async () => (await report(page))?.status, { timeout: 60_000 }).toBe('ready')
  expect(((await report(page))!.rows[0][0])).toBe(40)
})

test('entries-per-minute preset groups by minute (TZ-independent count)', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await parseReady(page)
  await page.getByTestId('tab-report').click()

  // The fixture spans three minutes (08:00/08:01/08:02); the label timezone
  // depends on the machine, so assert the distinct-minute count only.
  await page.getByTestId('preset-entries-per-minute').click()
  await page.getByTestId('report-run').click()
  await expect.poll(async () => (await report(page))?.status, { timeout: 180_000 }).toBe('ready')
  const r = (await report(page))!
  expect(r.totalRows).toBe(3)
  // 39 entries have timestamps; per-minute sizes are 11/15/13 in some order.
  expect(r.rows.map((row) => row[1]).sort((a, b) => Number(a) - Number(b))).toEqual([11, 13, 15])
})
