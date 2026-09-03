import { expect, test, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const FIXTURE = 'tests/fixtures/logs/mixed-levels.log'

// RULE_COLORS[0] in src/lib/rules.ts, as Chromium normalizes inline styles.
const RED = 'rgb(248, 81, 73)' // #f85149 — first added rule
// HIGHLIGHT_ACCENT in src/lib/highlights.ts.
const ACCENT = 'rgb(255, 215, 94) 3px 0px 0px inset' // #ffd75e

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

async function ensureRow(page: Page, index: number): Promise<void> {
  await page.evaluate(i => {
    const api = (window as unknown as {
      __gridApi?: { ensureIndexVisible?: (i: number, p?: string) => void }
    }).__gridApi
    api?.ensureIndexVisible?.(i, 'middle')
  }, index)
}

/**
 * Build a full session state in the UI: saved filter set "errors-only",
 * a text rule, and a pinned row 9 with a note — then save it as a download.
 */
async function setupAndSave(page: Page): Promise<string> {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  // Saved filter set "errors-only" (the active text filter at save time).
  await page.locator('[data-testid="text-filter"]').fill('cache-host')
  // Wait for the 250 ms debounce to reach the store (visible drops to the one
  // cache-host row) so the saved set captures the applied filter, not an empty one.
  await expect.poll(() => counts(page)).toEqual({ total: 40, visible: 1 })
  page.on('dialog', d => void d.accept('errors-only'))
  await page.getByTestId('save-filter').click()

  // A text rule (palette color 1 = red).
  await page.getByTestId('rules-add').click()
  await page.locator('[data-testid^="rule-text-"]').fill('cache-host')

  // Pin line 9 (the ERROR "cache-host" row) with a note.
  await rightClickRow(page, 'Failed to connect to cache-host')
  await page.getByTestId('ctx-pin').click()
  await expect(page.locator('.note-loc')).toHaveText('mixed-levels.log:9')
  await page.locator('[data-testid^="note-text-"]').fill('from spec')

  // Save the workspace and capture the downloaded archive.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('workspace-save').click(),
  ])
  const p = path.join(os.tmpdir(), `lvp-ws-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  await download.saveAs(p)
  return p
}

const loadedMarker = (page: Page) => () =>
  page.evaluate(() => (window as unknown as { __workspaceLoadedAt?: number }).__workspaceLoadedAt ?? 0)

test('saving bundles saved filters, rules, notes and file metadata into a JSON archive', async ({
  page,
}) => {
  const p = await setupAndSave(page)
  try {
    const raw = fs.readFileSync(p, 'utf8')
    const arch = JSON.parse(raw)
    expect(arch.format).toBe('logviewplus.workspace')
    expect(arch.version).toBe(1)
    expect(typeof arch.savedAt).toBe('number')
    expect(arch.settings.tzMode).toBe('local')
    // The active filter at save time.
    expect(arch.filters).toEqual({ text: 'cache-host', levels: [] })
    // All saved filter sets (here just the one made in this spec).
    expect(arch.savedFilters).toHaveLength(1)
    expect(arch.savedFilters[0].name).toBe('errors-only')
    expect(arch.savedFilters[0].filters).toEqual({ text: 'cache-host', levels: [] })
    // The working rule set.
    expect(arch.rules).toHaveLength(1)
    expect(arch.rules[0].text).toBe('cache-host')
    expect(arch.rules[0].color).toBe('#f85149')
    // Pinned notes with their exact identity.
    expect(arch.highlights).toHaveLength(1)
    expect(arch.highlights[0]).toMatchObject({ file: 'mixed-levels.log', lineNo: 9, note: 'from spec' })
    // Per-file metadata (rows are NOT bundled).
    expect(arch.files).toEqual([
      expect.objectContaining({ name: 'mixed-levels.log', lines: 40, entries: 40, status: 'ready' }),
    ])
    expect(typeof arch.files[0].size).toBe('number')
    // And the archive contains no log content at all.
    expect(raw).not.toContain('Failed to connect to cache-host')
  } finally {
    fs.unlinkSync(p)
  }
})

test('loading an archive restores filters, rules and pins in a fresh profile', async ({ page }) => {
  const p = await setupAndSave(page)
  try {
    // Simulate another machine: wipe this profile's IndexedDB + localStorage.
    await page.evaluate(() => void indexedDB.deleteDatabase('logviewplus-web'))
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.getByTestId('rules-empty')).toBeVisible()
    await expect(page.getByTestId('notes-empty')).toBeVisible()

    // Load the archive (waits out every IDB write via the commit marker).
    await page.getByTestId('workspace-input').setInputFiles(p)
    await expect.poll(loadedMarker(page)).toBeGreaterThan(0)

    // Everything is back in the bars.
    await expect(page.locator('[data-testid^="rule-text-"]')).toHaveValue('cache-host')
    await expect(page.locator('.note-loc')).toHaveText('mixed-levels.log:9')
    await expect(page.locator('[data-testid^="note-text-"]')).toHaveValue('from spec')
    await expect(page.getByTestId('saved-select')).toContainText('errors-only')

    // The restored ACTIVE filter is applied: re-open the fixture → only the
    // one cache-host row matches, and it carries BOTH the rule color and the
    // pin accent (rules/pins really took effect, not just the bars).
    await page.getByTestId('file-input').setInputFiles(FIXTURE)
    await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 1 })
    const style = await rowStyle(page, 'Failed to connect to cache-host')
    expect(style.bg).toBe(RED)
    expect(style.shadow).toBe(ACCENT)

    // …and the restored state is persisted: a second reload keeps it.
    await page.reload()
    await expect(page.locator('[data-testid^="rule-text-"]')).toHaveValue('cache-host')
    await expect(page.locator('.note-loc')).toHaveText('mixed-levels.log:9')
  } finally {
    fs.unlinkSync(p)
  }
})

test('loading a non-archive file surfaces an error and changes nothing', async ({ page }) => {
  await page.goto('/')
  // Local state to prove stays untouched.
  await page.getByTestId('rules-add').click()
  await page.locator('[data-testid^="rule-text-"]').fill('deadlock')

  const bad = path.join(os.tmpdir(), `lvp-ws-bad-${Date.now()}.json`)
  fs.writeFileSync(bad, '{"format":"nope"}')
  try {
    const dialog = page.waitForEvent('dialog')
    await page.getByTestId('workspace-input').setInputFiles(bad)
    const d = await dialog
    expect(d.type()).toBe('alert')
    expect(d.message()).toContain('workspace')
    await d.dismiss()
    // No commit marker — nothing was applied.
    expect(await loadedMarker(page)()).toBe(0)
    await expect(page.locator('[data-testid^="rule-text-"]')).toHaveValue('deadlock')
    await expect(page.getByTestId('notes-empty')).toBeVisible()
  } finally {
    fs.unlinkSync(bad)
  }
})

test('loading merges pins and saved filters, replacing the working rules', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 40, visible: 40 })

  // Local state: pin line 37 (FATAL deadlock — deep row), saved filter
  // "local-only", and a local rule.
  await ensureRow(page, 36)
  await rightClickRow(page, 'Watchdog detected deadlock')
  await page.getByTestId('ctx-pin').click()
  await expect(page.locator('.note-loc')).toHaveText('mixed-levels.log:37')
  await page.locator('[data-testid^="note-text-"]').fill('local pin')

  await page.locator('[data-testid="text-filter"]').fill('deadlock')
  // Debounce must reach the store before the set is saved (same as setupAndSave).
  await expect.poll(() => counts(page)).toEqual({ total: 40, visible: 1 })
  page.on('dialog', d => void d.accept('local-only'))
  await page.getByTestId('save-filter').click()

  await page.getByTestId('rules-add').click()
  await page.locator('[data-testid^="rule-text-"]').fill('deadlock')

  // Hand-crafted archive: a DIFFERENT rule, one pin with the same identity as
  // the local pin (archive note must win), one new pin, one saved filter, UTC mode.
  const p = path.join(os.tmpdir(), `lvp-ws-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  fs.writeFileSync(
    p,
    JSON.stringify({
      format: 'logviewplus.workspace',
      version: 1,
      savedAt: 1756850000000,
      appVersion: '0.1.0',
      settings: { tzMode: 'utc' },
      filters: { text: '', levels: [] },
      savedFilters: [{ name: 'archived-filter', filters: { text: '', levels: ['ERROR'] }, savedAt: 1756850000000 }],
      rules: [{ id: 'r-in', text: 'cache-host', levels: [], file: '', color: '#3fb950' }],
      highlights: [
        { id: 'h-in-1', file: 'mixed-levels.log', lineNo: 9, note: 'archived pin' },
        { id: 'h-in-2', file: 'mixed-levels.log', lineNo: 37, note: 'archive note wins' },
      ],
      files: [],
    }),
  )
  try {
    await page.getByTestId('workspace-input').setInputFiles(p)
    await expect.poll(loadedMarker(page)).toBeGreaterThan(0)

    // Rules are REPLACED (the local "deadlock" rule is gone).
    await expect(page.locator('[data-testid^="rule-text-"]')).toHaveCount(1)
    await expect(page.locator('[data-testid^="rule-text-"]')).toHaveValue('cache-host')

    // Pins are MERGED: the shared identity takes the archive note, the new pin
    // is appended, and the tz mode came along.
    const noteFor = (loc: string) =>
      page.locator('.note', { has: page.locator('.note-loc', { hasText: loc }) }).locator('[data-testid^="note-text-"]')
    await expect(page.locator('.note-loc')).toHaveCount(2)
    await expect(noteFor('mixed-levels.log:37')).toHaveValue('archive note wins')
    await expect(noteFor('mixed-levels.log:9')).toHaveValue('archived pin')
    await expect(page.getByTestId('tz-select')).toHaveValue('utc')

    // Saved filters are MERGED by name (both sets survive).
    const select = page.getByTestId('saved-select')
    await expect(select).toContainText('local-only')
    await expect(select).toContainText('archived-filter')

    // …and the merged state persists across a reload.
    await page.reload()
    await expect(page.locator('[data-testid^="rule-text-"]')).toHaveValue('cache-host')
    await expect(page.locator('.note-loc')).toHaveCount(2)
  } finally {
    fs.unlinkSync(p)
  }
})
