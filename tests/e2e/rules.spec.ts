import { expect, test, type Page } from '@playwright/test'

const FIXTURE = 'tests/fixtures/logs/mixed-levels.log'
const IIS_FIXTURE = 'tests/fixtures/logs/iis-u_ex.log'

// RULE_COLORS[0]/[1] in src/lib/rules.ts, as Chromium normalizes inline styles.
const RED = 'rgb(248, 81, 73)' // #f85149 — first added rule
const GREEN = 'rgb(63, 185, 80)' // #3fb950 — second added rule
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

/** Inline background-color of the first rendered grid row containing `text`. */
async function rowBg(page: Page, text: string): Promise<string | null> {
  return page.evaluate(t => {
    const row = Array.from(document.querySelectorAll('.ag-row')).find(r =>
      r.textContent?.includes(t),
    )
    return row ? (row as HTMLElement).style.backgroundColor : null
  }, text)
}

test('text rule colors matching rows and overrides the built-in level tint', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  // Line 9 is the ERROR row "Failed to connect to cache-host:6379…" — before
  // the rule it only carries the built-in ERROR tint.
  await expect.poll(() => rowBg(page, 'Failed to connect to cache-host')).toBe(BASE_ERROR)

  await page.getByTestId('rules-add').click()
  await page.locator('[data-testid^="rule-text-"]').fill('cache-host')

  // The rule color replaces the level tint on the match; non-matching rows
  // (this INFO row) stay unstyled.
  await expect.poll(() => rowBg(page, 'Failed to connect to cache-host')).toBe(RED)
  await expect.poll(() => rowBg(page, 'Configuration loaded (42 keys)')).toBe('')
})

test('level rule matches; first matching rule wins and reorder changes priority', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  // Rule 1 (red): level ERROR → lines 9, 17, 18.
  await page.getByTestId('rules-add').click()
  await page.locator('[data-testid^="rule-level-"]').first().selectOption('ERROR')
  await expect.poll(() => rowBg(page, 'Failed to connect to cache-host')).toBe(RED)

  // Rule 2 (green): text "upstream" → line 17 only. Line 17 matches both,
  // and rule 1 is earlier in the list → it stays red.
  await page.getByTestId('rules-add').click()
  await page.locator('[data-testid^="rule-text-"]').nth(1).fill('upstream')
  await expect.poll(() => rowBg(page, 'Timeout after 30000 ms')).toBe(RED)

  // Move rule 2 above rule 1 → line 17 flips to green; line 9 stays red.
  await page.locator('[data-testid^="rule-up-"]').nth(1).click()
  await expect.poll(() => rowBg(page, 'Timeout after 30000 ms')).toBe(GREEN)
  await expect.poll(() => rowBg(page, 'Failed to connect to cache-host')).toBe(RED)
})


test('file rule colors only rows from that source in the merged view', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles([FIXTURE, IIS_FIXTURE])
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  // Merged view: mixed-levels.log rows come first (insertion order).
  await page.getByTestId('tab-all').click()
  await expect.poll(() => counts(page)).toEqual({ total: 58, visible: 58 })

  await page.getByTestId('rules-add').click()
  await page.locator('[data-testid^="rule-file-"]').fill('mixed')

  // The grid virtualizes rows (only a viewport window is in the DOM), so count
  // at model level via the grid API: every mixed-levels.log row (40) matches
  // the file rule and none of the 18 iis-u_ex.log rows do.
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const api = (window as unknown as {
          __gridApi?: { forEachNode?: (cb: (n: { data?: { file?: string } }) => void) => void }
        }).__gridApi
        let mixed = 0
        let iis = 0
        api?.forEachNode?.(node => {
          if (node.data?.file === 'mixed-levels.log') mixed++
          else if (node.data?.file === 'iis-u_ex.log') iis++
        })
        return `${mixed}/${iis}`
      })
    })
    .toBe('40/18')

  // …and rendered rows actually carry the rule color (grid starts at the top,
  // where all visible rows are mixed-levels.log).
  await expect
    .poll(async () => {
      return page.evaluate(
        rgb =>
          Array.from(document.querySelectorAll('.ag-row')).filter(
            r => (r as HTMLElement).style.backgroundColor === rgb,
          ).length,
        RED,
      )
    })
    .toBeGreaterThan(0)

  // An INFO row from the other source stays uncolored (scroll it into existence).
  const iisRow = await page.evaluate(() => {
    const api = (window as unknown as {
      __gridApi?: { forEachNode?: (cb: (n: { data?: { message?: string }; rowIndex: number | null }) => void) => void }
    }).__gridApi
    let idx: number | null = null
    api?.forEachNode?.(n => {
      if (idx === null && n.data?.message?.includes('static/app.js')) idx = n.rowIndex
    })
    return idx
  })
  expect(iisRow).not.toBeNull()
  await page.evaluate(i => {
    const api = (window as unknown as {
      __gridApi?: { ensureIndexVisible?: (i: number, p?: string) => void }
    }).__gridApi
    if (typeof i === 'number') api?.ensureIndexVisible?.(i, 'middle')
  }, iisRow)
  await expect.poll(() => rowBg(page, 'static/app.js')).toBe('')
})

test('rules persist across reload (IndexedDB)', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  await page.getByTestId('rules-add').click()
  await page.locator('[data-testid^="rule-text-"]').fill('cache-host')
  // Block until the IDB put commits (the store sets __rulesSavedAt after
  // saveRules resolves) so the reload below cannot race it.
  await expect.poll(
    () =>
      page.evaluate(() => (window as unknown as { __rulesSavedAt?: number }).__rulesSavedAt ?? 0),
  ).toBeGreaterThan(0)

  await page.reload()
  // The rule comes back from IndexedDB at startup.
  await expect(page.locator('[data-testid^="rule-text-"]')).toHaveValue('cache-host')

  // Re-open the fixture and the coloring is applied (rules may land after the
  // first render — the grid redraws when they arrive).
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })
  await expect.poll(() => rowBg(page, 'Failed to connect to cache-host')).toBe(RED)
})

test('deleting a rule clears its coloring and restores the built-in tints', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  await page.getByTestId('rules-add').click()
  await page.locator('[data-testid^="rule-text-"]').fill('cache-host')
  await expect.poll(() => rowBg(page, 'Failed to connect to cache-host')).toBe(RED)

  await page.locator('[data-testid^="rule-delete-"]').click()
  await expect(page.getByTestId('rules-empty')).toBeVisible()
  // Back to the built-in ERROR tint.
  await expect.poll(() => rowBg(page, 'Failed to connect to cache-host')).toBe(BASE_ERROR)
})
