import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const FIXTURE = 'tests/fixtures/logs/mixed-levels.log'
// Line count of the deterministic 10 MB fixture produced by `npm run gen:logs -- 10`.
const LARGE_FIXTURE = 'tests/fixtures/logs/generated/app-10MB.log'
const LARGE_LINES = 139_769
const LARGE_100_FIXTURE = 'tests/fixtures/logs/generated/app-100MB.log'
const LARGE_100_LINES = 1_397_688

interface AppCounts {
  total: number
  visible: number
}

async function counts(page: import('@playwright/test').Page): Promise<AppCounts> {
  return page.evaluate(
    () =>
      (window as unknown as { __appCounts?: AppCounts }).__appCounts ?? { total: -1, visible: -1 },
  )
}

/** Sanity check that the AG Grid body actually rendered rows. */
async function gridPaintedRows(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const api = (window as unknown as { __gridApi?: { getDisplayedRowCount?: () => number } })
      .__gridApi
    return api?.getDisplayedRowCount ? api.getDisplayedRowCount() : -1
  })
}

test('parse fixture, then filter by level and text', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)

  // mixed-levels.log has 40 non-empty lines → 40 entries (1 unmatched, kept raw).
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })
  expect(await gridPaintedRows(page)).toBeGreaterThan(0)

  // Level filter: exactly 7 WARN rows remain.
  await page.getByTestId('level-WARN').click()
  await expect.poll(() => counts(page)).toEqual({ total: 40, visible: 7 })

  // Text filter narrows further to the single 'config' WARN line.
  await page.getByTestId('text-filter').fill('config')
  await expect.poll(() => counts(page)).toEqual({ total: 40, visible: 1 })
})

test('auto-detects W3C and JSON formats per file', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles([
    'tests/fixtures/logs/iis-u_ex.log',
    'tests/fixtures/logs/app.json',
  ])

  // Active tab is the first file (IIS u_ex): 4 # header rows kept raw + 14 data.
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 18, visible: 18 })

  // W3C level is derived from sc-status: exactly three 4xx rows are WARN.
  await page.getByTestId('level-WARN').click()
  await expect.poll(() => counts(page)).toEqual({ total: 18, visible: 3 })
  await page.getByTestId('level-WARN').click()

  // JSON tab: 12 entries, one FATAL.
  await page.getByTestId('tab-app.json').click()
  await expect.poll(() => counts(page)).toEqual({ total: 12, visible: 12 })
  await page.getByTestId('level-FATAL').click()
  await expect.poll(() => counts(page)).toEqual({ total: 12, visible: 1 })
})

test('merged All view combines files and filters across them', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles([FIXTURE, 'tests/fixtures/logs/iis-u_ex.log'])

  // First file active: 40 entries.
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  // "All" tab merges both (40 + 18 = 58); level filter spans both sources.
  await page.getByTestId('tab-all').click()
  await expect.poll(() => counts(page)).toEqual({ total: 58, visible: 58 })
  await page.getByTestId('level-WARN').click()
  await expect.poll(() => counts(page)).toEqual({ total: 58, visible: 10 }) // 7 + 3

  // Clicking a file tab exits the merged view.
  await page.getByTestId(`tab-${FIXTURE.split('/').pop()}`).click()
  await expect.poll(() => counts(page)).toEqual({ total: 40, visible: 7 }) // WARN filter persists
})

test('zip drop extracts members into separate parsed files', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/logs/packed.zip')

  // Both members land as tabs; first (a.log) is active with 3 entries.
  await expect(page.getByTestId('tab-a.log'), { timeout: 20_000 }).toBeVisible()
  await expect(page.getByTestId('tab-b.csv')).toBeVisible()
  await expect.poll(() => counts(page)).toEqual({ total: 3, visible: 3 })

  // a.log has one WARN; b.csv (DSV) has one FATAL.
  await page.getByTestId('level-WARN').click()
  await expect.poll(() => counts(page)).toEqual({ total: 3, visible: 1 })
  await page.getByTestId('level-WARN').click()
  await page.getByTestId('tab-b.csv').click()
  await expect.poll(() => counts(page)).toEqual({ total: 3, visible: 3 })
  await page.getByTestId('level-FATAL').click()
  await expect.poll(() => counts(page)).toEqual({ total: 3, visible: 1 })
})

test('pasted text drop ingests as a synthetic file', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData(
      'text/plain',
      '2026-09-01 08:00:01 INFO: pasted one\n2026-09-01 08:00:02 ERROR: pasted two',
    )
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
    document.querySelector('.app')?.dispatchEvent(ev)
  })

  // Synthetic file parses like any other (2 entries, 1 ERROR).
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 2, visible: 2 })
  const tabName = await page.locator('[data-testid^="tab-pasted-"]').first().getAttribute('data-testid')
  expect(tabName).toMatch(/^tab-pasted-\d{8}-\d{6}\.log$/)
  await page.getByTestId('level-ERROR').click()
  await expect.poll(() => counts(page)).toEqual({ total: 2, visible: 1 })
})

test('saved filters persist in IndexedDB and reapply after reload', async ({ page }) => {
  await page.goto('/')
  let dialogHandled = false
  page.on('dialog', d => {
    dialogHandled = true
    void d.accept('my filter')
  })

  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })
  await page.getByTestId('level-WARN').click()
  await page.getByTestId('text-filter').fill('config')
  await expect.poll(() => counts(page)).toEqual({ total: 40, visible: 1 })

  await page.getByTestId('save-filter').click()
  await expect.poll(() => dialogHandled, { timeout: 5_000 }).toBe(true)

  // Block until the put is committed: FilterBar only adds the dropdown option after
  // saveFilter() resolves (awaited IDB put), so a reload below cannot race it.
  await expect
    .poll(() => page.getByTestId('saved-select').locator('option').count(), { timeout: 5_000 })
    .toBe(2)

  // Reload: runtime filter state is gone, but the saved set survives in IndexedDB.
  await page.reload()
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  // Applying the saved filter restores text + level and narrows to the one row.
  await page.getByTestId('saved-select').selectOption('my filter')
  await expect.poll(() => counts(page)).toEqual({ total: 40, visible: 1 })
  await expect(page.getByTestId('text-filter')).toHaveValue('config')

  // Deleting removes it from the persisted list (only the placeholder remains).
  await page.getByTestId('delete-filter').click()
  await expect
    .poll(async () => (await page.getByTestId('saved-select').locator('option').count()))
    .toBe(1)
})

test('export downloads the filtered rows as CSV and JSON', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })
  await page.getByTestId('level-WARN').click()
  await expect.poll(() => counts(page)).toEqual({ total: 40, visible: 7 })

  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()])
  expect(csv.suggestedFilename()).toBe('mixed-levels.log.csv')
  const csvText = readFileSync(String(await csv.path()), 'utf8')
  const csvLines = csvText.split('\n').filter(l => l !== '')
  expect(csvLines[0]).toBe('ts_iso,ts_ms,level,message,raw,file,line_no')
  expect(csvLines.length).toBe(8) // header + 7 WARN rows
  expect(csvLines.slice(1).every(l => /,WARN,/.test(l))).toBe(true)

  const [json] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()])
  expect(json.suggestedFilename()).toBe('mixed-levels.log.json')
  const parsed = JSON.parse(readFileSync(String(await json.path()), 'utf8'))
  expect(parsed).toHaveLength(7)
  expect(parsed.every((r: { level?: string }) => r.level === 'WARN')).toBe(true)
})

test('perf: 10 MB file parses and fully paints in acceptable time', async ({ page }) => {
  test.skip(!process.env.PERF, 'set PERF=1 to run the perf gate (needs generated fixture)')
  await page.goto('/')

  const t0 = Date.now()
  await page.getByTestId('file-input').setInputFiles(LARGE_FIXTURE)
  await expect.poll(() => counts(page), { timeout: 120_000 }).toEqual({
    total: LARGE_LINES,
    visible: LARGE_LINES,
  })
  const ms = Date.now() - t0

  console.log(`[perf] 10 MB parse + full row model ready: ${ms} ms (${LARGE_LINES} rows)`)
  // Target: < 3 s. Gate allows 5 s headroom for slow CI machines.
  expect(ms).toBeLessThan(5_000)
})

test('perf: 100 MB file completes without crashing and grid scrolls', async ({ page }) => {
  test.skip(process.env.PERF_100 !== '1', 'set PERF_100=1 to run the 100 MB gate (needs generated fixture)')
  await page.goto('/')

  const t0 = Date.now()
  await page.getByTestId('file-input').setInputFiles(LARGE_100_FIXTURE)
  await expect.poll(() => counts(page), { timeout: 300_000 }).toEqual({
    total: LARGE_100_LINES,
    visible: LARGE_100_LINES,
  })
  const ms = Date.now() - t0

  console.log(`[perf] 100 MB parse complete: ${ms} ms (${LARGE_100_LINES} rows)`)

  // Virtualized grid must keep rendering and accept scrolling.
  await page.mouse.move(400, 400)
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 2000)
    await page.waitForTimeout(100)
  }
  expect(await gridPaintedRows(page)).toBeGreaterThan(0)
})

