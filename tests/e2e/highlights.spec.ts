import { expect, test, type Page } from '@playwright/test'

const FIXTURE = 'tests/fixtures/logs/mixed-levels.log'
const IIS_FIXTURE = 'tests/fixtures/logs/iis-u_ex.log'

// HIGHLIGHT_ACCENT in src/lib/highlights.ts, as Chromium normalizes inline styles.
const ACCENT = 'rgb(255, 215, 94) 3px 0px 0px inset' // #ffd75e
const BASE_ERROR = 'rgba(244, 67, 54, 0.18)' // built-in ERROR tint

interface AppCounts {
  total: number
  visible: number
}

async function counts(page: Page): Promise<AppCounts> {
  return page.evaluate(
    () =>
      (window as unknown as { __appCounts?: AppCounts }).__appCounts ?? { total: -1, visible: -1 },
  )
}

/** Inline background + box-shadow of the first rendered grid row containing `text`. */
async function rowStyle(page: Page, text: string): Promise<{ bg: string | null; shadow: string | null }> {
  return page.evaluate(t => {
    const row = Array.from(document.querySelectorAll('.ag-row')).find(r => r.textContent?.includes(t))
    if (!row) return { bg: null, shadow: null }
    const s = (row as HTMLElement).style
    return { bg: s.backgroundColor || null, shadow: s.boxShadow || null }
  }, text)
}

/** Right-click the first rendered grid row containing `text` and open its context menu. */
async function rightClickRow(page: Page, text: string): Promise<void> {
  await page.locator('.ag-row', { hasText: text }).click({ button: 'right' })
}

/**
 * Scroll the grid so model row `index` is rendered. The themed grid virtualizes
 * (only a viewport window of rows is in the DOM), so deep rows must be scrolled
 * into existence before they can be clicked or style-asserted.
 */
async function ensureRow(page: Page, index: number): Promise<void> {
  await page.evaluate(i => {
    const api = (window as unknown as {
      __gridApi?: { ensureIndexVisible?: (i: number, p?: string) => void }
    }).__gridApi
    api?.ensureIndexVisible?.(i, 'middle')
  }, index)
}

test('right-click pins a row with an accent bar and a note entry', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  // Line 9 is the ERROR row "Failed to connect to cache-host:6379…".
  await rightClickRow(page, 'Failed to connect to cache-host')
  const addItem = page.getByTestId('ctx-pin')
  await expect(addItem).toBeVisible()
  await addItem.click()

  // The note entry shows the exact file:line identity; the row gets the accent bar.
  await expect(page.locator('.note')).toHaveCount(1)
  await expect(page.locator('.note-loc')).toHaveText('mixed-levels.log:9')
  await expect.poll(async () => (await rowStyle(page, 'Failed to connect to cache-host')).shadow).toBe(ACCENT)

  // A non-pinned row stays unstyled.
  expect((await rowStyle(page, 'Configuration loaded (42 keys)')).shadow).toBe(null)

  // Typing a note lands in the bar entry (persistence is covered by the reload spec).
  await page.locator('[data-testid^="note-text-"]').fill('retry after flush')
  await expect(page.locator('[data-testid^="note-text-"]')).toHaveValue('retry after flush')
})

test('a pinned row offers Remove note; removing restores the plain coloring', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  await rightClickRow(page, 'Failed to connect to cache-host')
  await page.getByTestId('ctx-pin').click()
  await expect.poll(async () => (await rowStyle(page, 'Failed to connect to cache-host')).shadow).toBe(ACCENT)
  // The accent composes with the built-in ERROR tint, not replacing it.
  expect((await rowStyle(page, 'Failed to connect to cache-host')).bg).toBe(BASE_ERROR)

  // Right-click again: the pin is offered for removal instead of a second add.
  await rightClickRow(page, 'Failed to connect to cache-host')
  await expect(page.getByTestId('ctx-unpin')).toBeVisible()
  await expect(page.getByTestId('ctx-pin')).toHaveCount(0)
  await page.getByTestId('ctx-unpin').click()

  await expect(page.locator('.note')).toHaveCount(0)
  await expect(page.getByTestId('notes-empty')).toBeVisible()
  // The grid redraws its cached row style on the next effect tick — poll for it.
  await expect.poll(async () => (await rowStyle(page, 'Failed to connect to cache-host')).shadow).toBe(null)
  expect((await rowStyle(page, 'Failed to connect to cache-host')).bg).toBe(BASE_ERROR) // back to the built-in tint
})

test('pins persist across reload (IndexedDB)', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  await rightClickRow(page, 'Failed to connect to cache-host')
  await page.getByTestId('ctx-pin').click()
  await page.locator('[data-testid^="note-text-"]').fill('keep me')
  // Block until the IDB put commits (the store sets __highlightsSavedAt after
  // each write resolves) so the reload below cannot race it.
  await expect.poll(
    () => page.evaluate(() => (window as unknown as { __highlightsSavedAt?: number }).__highlightsSavedAt ?? 0),
  ).toBeGreaterThan(0)

  await page.reload()
  // The pin comes back from IndexedDB at startup (before any file is opened).
  await expect(page.locator('[data-testid^="note-text-"]')).toHaveValue('keep me')

  // Re-open the fixture and the accent is applied (pins may land after the
  // first render — the grid redraws when they arrive).
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })
  await expect.poll(async () => (await rowStyle(page, 'Failed to connect to cache-host')).shadow).toBe(ACCENT)
})

test('a pin follows its row into the merged view (exact file + line match)', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles([FIXTURE, IIS_FIXTURE])
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  // Pin line 9 in the mixed-levels.log tab (the first file is active).
  await rightClickRow(page, 'Failed to connect to cache-host')
  await page.getByTestId('ctx-pin').click()
  await expect.poll(async () => (await rowStyle(page, 'Failed to connect to cache-host')).shadow).toBe(ACCENT)

  // Merged view: the pin colors exactly its own row — the iis-u_ex.log row at
  // the same line number is NOT matched (identity includes the file name).
  await page.getByTestId('tab-all').click()
  await expect.poll(() => counts(page)).toEqual({ total: 58, visible: 58 })
  await ensureRow(page, 8) // pinned row (line 9) — make sure it is rendered
  await expect
    .poll(async () => {
      return page.evaluate(
        accent =>
          Array.from(document.querySelectorAll('.ag-row')).filter(
            r => (r as HTMLElement).style.boxShadow === accent,
          ).length,
        ACCENT,
      )
    })
    .toBe(1)
  expect((await rowStyle(page, 'Failed to connect to cache-host')).shadow).toBe(ACCENT)

  // And back in the single-file tab the pin is still there.
  await page.getByTestId('tab-mixed-levels.log').click()
  await ensureRow(page, 8)
  await expect.poll(async () => (await rowStyle(page, 'Failed to connect to cache-host')).shadow).toBe(ACCENT)
})

test('the jump button scrolls a pinned row into view', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  // Line 37 (FATAL "Watchdog detected deadlock…") sits near the end of the log,
  // outside the grid's initial viewport (and its virtualized render window).
  await ensureRow(page, 36)
  await rightClickRow(page, 'Watchdog detected deadlock')
  await page.getByTestId('ctx-pin').click()
  await expect(page.locator('.note-loc')).toHaveText('mixed-levels.log:37')

  // Scroll back to the top so the pinned row is out of view again.
  await ensureRow(page, 0)
  const inView = () =>
    page.evaluate(() => {
      const r = Array.from(document.querySelectorAll('.ag-row')).find(x =>
        x.textContent?.includes('Watchdog detected deadlock'),
      )
      const g = document.querySelector('.grid')
      if (!r || !g) return false // virtualized away — definitely not in view
      const rb = (r as HTMLElement).getBoundingClientRect()
      const gb = (g as HTMLElement).getBoundingClientRect()
      return rb.top >= gb.top && rb.bottom <= gb.bottom
    })
  expect(await inView()).toBe(false)

  // Jump: the pinned row is rendered and scrolled to the middle of the grid.
  await page.locator('[data-testid^="note-go-"]').click()
  await expect.poll(inView, { timeout: 5_000 }).toBe(true)
})