import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const FIXTURE = 'tests/fixtures/logs/mixed-levels.log'

/**
 * Installs a fake File System Access API directory picker backed by an
 * in-memory file map the test can mutate between polls. Each `values()` call
 * snapshots the current names (mirroring a real re-list), and `getFile()`
 * returns a fresh File snapshot, mirroring how a real handle re-reads disk.
 */
function installFakeDirPicker(page: Page): Promise<void> {
  return page.addInitScript(() => {
    const enc = new TextEncoder()
    const files: Map<string, Uint8Array> = new Map()
    const handleFor = (name: string) => ({
      kind: 'file',
      name,
      async getFile(): Promise<File> {
        const bytes = files.get(name)
        if (!bytes) throw new DOMException('File not found', 'NotFoundError')
        return new File([new Uint8Array(bytes)], name, { type: 'text/plain' })
      },
    })
    ;(window as unknown as Record<string, unknown>).__dir = {
      set: (name: string, s: string) => {
        files.set(name, enc.encode(s))
      },
      append: (name: string, s: string) => {
        const cur = files.get(name) ?? new Uint8Array(0)
        const b = enc.encode(s)
        const n = new Uint8Array(cur.length + b.length)
        n.set(cur)
        n.set(b, cur.length)
        files.set(name, n)
      },
      remove: (name: string) => {
        files.delete(name)
      },
    }
    // Own property shadows the prototype accessor (plain assignment could
    // silently no-op if Chromium exposes it setter-less).
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => ({
        name: 'monitored',
        values: () => {
          const names = [...files.keys()]
          let i = 0
          return {
            [Symbol.asyncIterator]() {
              return {
                next: async (): Promise<{ done: boolean; value?: unknown }> =>
                  i < names.length
                    ? { done: false, value: handleFor(names[i++]) }
                    : { done: true, value: undefined },
              }
            },
          }
        },
        getFileHandle: async (name: string) => {
          if (!files.has(name)) throw new DOMException('File not found', 'NotFoundError')
          return handleFor(name)
        },
      }),
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

test('watching a folder ingests and tails its log files', async ({ page }) => {
  await installFakeDirPicker(page)
  await page.goto('/')
  await expect(page.getByTestId('dir-button')).toBeVisible()

  const appLog = LINES.slice(0, 10).join('\n') + '\n' // 10 entries
  const svcLog = LINES.slice(10, 15).join('\n') + '\n' // 5 entries
  await page.evaluate(([a, b]) => {
    const d = (window as unknown as { __dir: { set(n: string, s: string): void } }).__dir
    d.set('app.log', a)
    d.set('svc.log', b)
  }, [appLog, svcLog])

  await page.getByTestId('dir-button').click()
  await expect(page.getByTestId('dir-stop')).toHaveText(/monitored/)
  await expect(page.getByTestId('tab-app.log')).toBeVisible()
  await expect(page.getByTestId('tab-svc.log')).toBeVisible()

  // Bulk ingest must not yank the view per file: the FIRST file is active.
  await expect(page.getByTestId('tab-app.log')).toHaveClass(/active/)

  // Merged "All" view lands on 15 once both initial reads are done.
  await page.getByTestId('tab-all').click()
  await expect.poll(() => count(page), { timeout: 10_000 }).toBe(15)
})

test('a file added to the watched folder appears as a new tailed tab', async ({ page }) => {
  await installFakeDirPicker(page)
  await page.goto('/')

  const setFile = (name: string, content: string) =>
    page.evaluate(([n, s]) => (window as unknown as { __dir: { set(n: string, s: string): void } }).__dir.set(n, s), [name, content])
  await setFile('app.log', LINES.slice(0, 10).join('\n') + '\n')
  await page.getByTestId('dir-button').click()
  await expect(page.getByTestId('tab-app.log')).toHaveClass(/active/)
  await expect.poll(() => count(page), { timeout: 10_000 }).toBe(10)

  // A new file shows up on the next directory poll — no re-pick, no reload.
  const extra = LINES.slice(20, 23).join('\n') + '\n' // 3 entries
  await setFile('extra.log', extra)
  await expect(page.getByTestId('tab-extra.log')).toBeVisible({ timeout: 10_000 })

  // The view was NOT taken over by the new file — switch to it explicitly.
  await page.getByTestId('tab-extra.log').click()
  await expect.poll(() => count(page), { timeout: 10_000 }).toBe(3)
})

test('a file removed from the watched folder keeps its rows but drops the live badge', async ({ page }) => {
  await installFakeDirPicker(page)
  await page.goto('/')

  const content = LINES.slice(0, 5).join('\n') + '\n' // 5 entries
  await page.evaluate(([n, s]) => (window as unknown as { __dir: { set(n: string, s: string): void } }).__dir.set(n, s), ['a.log', content])
  await page.getByTestId('dir-button').click()
  await expect(page.getByTestId('tab-a.log')).toHaveClass(/active/)
  await expect.poll(() => count(page), { timeout: 10_000 }).toBe(5)
  await expect(page.getByTestId('tail-badge')).toBeVisible()

  await page.evaluate(() => (window as unknown as { __dir: { remove(n: string): void } }).__dir.remove('a.log'))
  // The live badge clears on the next poll; the parsed rows stay in the tab.
  await expect(page.getByTestId('tail-badge')).toHaveCount(0, { timeout: 10_000 })
  expect(await count(page)).toBe(5)
})

test('stop watching detaches the live sessions but keeps every tab', async ({ page }) => {
  await installFakeDirPicker(page)
  await page.goto('/')

  await page.evaluate(
    ([n, s]) => (window as unknown as { __dir: { set(n: string, s: string): void } }).__dir.set(n, s),
    ['app.log', LINES.slice(0, 10).join('\n') + '\n'],
  )
  await page.getByTestId('dir-button').click()
  await expect(page.getByTestId('tab-app.log')).toHaveClass(/active/)
  await expect.poll(() => count(page), { timeout: 10_000 }).toBe(10)

  // Prove it is live before stopping.
  await page.evaluate(
    ([n, s]) => (window as unknown as { __dir: { append(n: string, s: string): void } }).__dir.append(n, s),
    ['app.log', LINES.slice(10, 12).join('\n') + '\n'],
  )
  await expect.poll(() => count(page), { timeout: 10_000 }).toBe(12)

  await page.getByTestId('dir-stop').click()
  await expect(page.getByTestId('dir-button')).toBeVisible()
  await expect(page.getByTestId('tail-badge')).toHaveCount(0, { timeout: 5_000 })
  expect(await count(page)).toBe(12) // rows survived the stop
})

test('non-Chromium: no File System Access pickers → both buttons hidden, notice shown', async ({ page }) => {
  // Shadow both prototype accessors with undefined — the app must feature-detect.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true })
  })
  await page.goto('/')
  await expect(page.getByTestId('tail-button')).toHaveCount(0)
  await expect(page.getByTestId('dir-button')).toHaveCount(0)
  await expect(page.getByTestId('tail-unsupported')).toBeVisible()
})

