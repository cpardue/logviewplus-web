import { expect, test } from '@playwright/test'

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

