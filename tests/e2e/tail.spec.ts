import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const FIXTURE = 'tests/fixtures/logs/mixed-levels.log'

/**
 * Installs a fake File System Access API picker backed by an in-memory byte
 * buffer that the test can grow/replace between polls. `getFile()` returns a
 * fresh File snapshot each call, mirroring how a real handle re-reads disk.
 */
function installFakePicker(page: Page): Promise<void> {
  return page.addInitScript(() => {
    const enc = new TextEncoder()
    const state: { bytes: Uint8Array; alive: boolean } = { bytes: new Uint8Array(0), alive: true }
    ;(window as unknown as Record<string, unknown>).__tail = {
      set: (s: string) => {
        state.bytes = enc.encode(s)
      },
      append: (s: string) => {
        const b = enc.encode(s)
        const n = new Uint8Array(state.bytes.length + b.length)
        n.set(state.bytes)
        n.set(b, state.bytes.length)
        state.bytes = n
      },
      kill: () => {
        state.alive = false
      },
    }
    // Own property shadows the prototype accessor (plain assignment could
    // silently no-op if Chromium exposes it setter-less).
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [
        {
          name: 'live.log',
          async getFile(): Promise<File> {
            if (!state.alive) throw new DOMException('File not found', 'NotFoundError')
            const copy = new Uint8Array(state.bytes)
            return new File([copy], 'live.log', { type: 'text/plain' })
          },
        },
      ],
    })
  })
}

async function count(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __appCounts?: { total: number } }).__appCounts?.total ?? -1)
}

const LINES = readFileSync(FIXTURE, 'utf8')
  .replace(/\r\n/g, '\n')
  .split('\n')
  .filter(l => l.trim() !== '')

test('tail appends new lines to the running file tab', async ({ page }) => {
  const initial = LINES.slice(0, 10).join('\n') + '\n'
  const more = LINES.slice(10, 15).join('\n') + '\n'

  await installFakePicker(page)
  await page.goto('/')
  await expect(page.getByTestId('tail-button')).toBeVisible()

  await page.evaluate(s => (window as unknown as { __tail: { set(s: string): void } }).__tail.set(s), initial)
  await page.getByTestId('tail-button').click()

  // New tab appears, is active, and shows the tail badge.
  await expect(page.getByTestId('tab-live.log')).toBeVisible()
  await expect(page.getByTestId('tab-live.log')).toHaveClass(/active/)
  await expect(page.getByTestId('tail-badge')).toBeVisible()
  await expect.poll(() => count(page), { timeout: 10_000 }).toBe(10)

  // Grow the file — the next poll picks up exactly the new lines.
  await page.evaluate(s => (window as unknown as { __tail: { append(s: string): void } }).__tail.append(s), more)
  await expect.poll(() => count(page), { timeout: 10_000 }).toBe(15)
})

test('rotated file is re-parsed from byte 0 (entries reset, not duplicated)', async ({ page }) => {
  const before = LINES.slice(0, 5).join('\n') + '\n' // 5 entries
  const after = LINES.slice(5, 8).join('\n') + '\n' // 3 entries — smaller

  await installFakePicker(page)
  await page.goto('/')

  await page.evaluate(s => (window as unknown as { __tail: { set(s: string): void } }).__tail.set(s), before)
  await page.getByTestId('tail-button').click()
  await expect.poll(() => count(page), { timeout: 10_000 }).toBe(5)

  // Replace with a SMALLER file (rotation/truncation in place). Without the
  // epoch-guarded reset the parser would keep appending and land on 8.
  await page.evaluate(s => (window as unknown as { __tail: { set(s: string): void } }).__tail.set(s), after)
  await expect.poll(() => count(page), { timeout: 10_000 }).toBe(3)
})

test('non-Chromium: picker missing → button hidden, notice shown, no crash', async ({ page }) => {
  // Shadow the prototype accessor with undefined — the app must feature-detect.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('/')
  await expect(page.getByTestId('tail-button')).toHaveCount(0)
  await expect(page.getByTestId('tail-unsupported')).toBeVisible()
})
