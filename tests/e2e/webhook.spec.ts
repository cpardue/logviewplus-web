import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const FIXTURE = 'tests/fixtures/logs/mixed-levels.log'

interface FetchLogEntry {
  url: string
  body: string
}

declare global {
  interface Window {
    __fetchLog?: FetchLogEntry[]
    __fetchFail?: boolean
    __webhookSavedAt?: number
  }
}

/**
 * Records every fetch() call (url + JSON body) on window.__fetchLog and
 * answers 200, unless window.__fetchFail flips the response to 500. The app's
 * only other fetch users (DuckDB/sql.js lazy chunks) are never touched here.
 */
function installFetchStub(page: Page): Promise<void> {
  return page.addInitScript(() => {
    const log: FetchLogEntry[] = []
    window.__fetchLog = log
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      value: async (input: RequestInfo | URL, init?: RequestInit) => {
        log.push({ url: String(input), body: typeof init?.body === 'string' ? init.body : '' })
        return window.__fetchFail
          ? new Response('boom', { status: 500 })
          : new Response('{}', { status: 200 })
      },
    })
  })
}

/** Same in-memory growing file handle as tests/e2e/tail.spec.ts (live.log). */
function installFakePicker(page: Page): Promise<void> {
  return page.addInitScript(() => {
    const enc = new TextEncoder()
    const state: { bytes: Uint8Array } = { bytes: new Uint8Array(0) }
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
    }
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [
        {
          name: 'live.log',
          async getFile(): Promise<File> {
            return new File([new Uint8Array(state.bytes)], 'live.log', { type: 'text/plain' })
          },
        },
      ],
    })
  })
}

async function count(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __appCounts?: { total: number } }).__appCounts?.total ?? -1)
}

async function fetchLog(page: Page): Promise<FetchLogEntry[]> {
  return page.evaluate(() => window.__fetchLog ?? [])
}

const LINES = readFileSync(FIXTURE, 'utf8')
  .replace(/\r\n/g, '\n')
  .split('\n')
  .filter(l => l.trim() !== '')

test('live-appended matching entries are POSTed; initial parse is not', async ({ page }) => {
  const initial = LINES.slice(0, 4).join('\n') + '\n' // TRACE/DEBUG/INFO/INFO — no ERROR
  const more = LINES.slice(8, 10).join('\n') + '\n' // line 9 = ERROR …cache-host…, line 10 = WARN

  await installFetchStub(page)
  await installFakePicker(page)
  await page.goto('/')

  // Arm the webhook for ERROR lines before starting the tail.
  await page.getByTestId('webhook-url').fill('https://hooks.example.local/alerts')
  await page.getByTestId('webhook-level').selectOption('ERROR')

  await page.evaluate(s => (window as unknown as { __tail: { set(s: string): void } }).__tail.set(s), initial)
  await page.getByTestId('tail-button').click()

  // Initial read completes — replayed history must NOT have fired anything.
  await expect.poll(() => count(page), { timeout: 10_000 }).toBe(4)
  expect(await fetchLog(page)).toHaveLength(0)

  // Grow the file: one ERROR + one WARN. Only the ERROR matches → one POST.
  await page.evaluate(s => (window as unknown as { __tail: { append(s: string): void } }).__tail.append(s), more)
  await expect.poll(async () => (await fetchLog(page)).length, { timeout: 15_000 }).toBe(1)

  const [call] = await fetchLog(page)
  expect(call.url).toBe('https://hooks.example.local/alerts')
  const body = JSON.parse(call.body) as { app: string; time: string; entries: unknown[] }
  expect(body.app).toBe('logviewplus-web')
  expect(body.entries).toHaveLength(1)
  const item = body.entries[0] as Record<string, unknown>
  expect(item.file).toBe('live.log')
  expect(item.level).toBe('ERROR')
  expect(item.lineNo).toBe(5) // the ERROR is the 5th line of live.log
  expect(String(item.message)).toContain('cache-host')

  // Status line reports the successful send.
  await expect(page.getByTestId('webhook-status')).toContainText('HTTP 200')
})

test('Send test fires a one-off test POST', async ({ page }) => {
  await installFetchStub(page)
  await page.goto('/')
  await page.getByTestId('webhook-url').fill('https://hooks.example.local/alerts')
  await page.getByTestId('webhook-test').click()

  await expect.poll(async () => (await fetchLog(page)).length, { timeout: 10_000 }).toBe(1)
  const [call] = await fetchLog(page)
  const body = JSON.parse(call.body) as Record<string, unknown>
  expect(body.app).toBe('logviewplus-web')
  expect(body.test).toBe(true)
  expect('entries' in body).toBe(false)
  await expect(page.getByTestId('webhook-status')).toContainText('Test sent')
})

test('webhook config persists across reload (IndexedDB)', async ({ page }) => {
  await installFetchStub(page)
  await page.goto('/')
  await page.getByTestId('webhook-url').fill('https://hooks.example.local/alerts')
  await page.getByTestId('webhook-text').fill('cache')
  await page.getByTestId('webhook-file').fill('live.log')
  await page.getByTestId('webhook-level').selectOption('WARN')

  // Wait for the IDB put to commit, then reload and check the restore.
  await expect.poll(() => page.evaluate(() => window.__webhookSavedAt ?? 0), { timeout: 10_000 }).toBeGreaterThan(0)
  await page.reload()
  await expect(page.getByTestId('webhook-url')).toHaveValue('https://hooks.example.local/alerts')
  await expect(page.getByTestId('webhook-text')).toHaveValue('cache')
  await expect(page.getByTestId('webhook-file')).toHaveValue('live.log')
  await expect(page.getByTestId('webhook-level')).toHaveValue('WARN')
})

test('failed send surfaces in the status line (parse/display unaffected)', async ({ page }) => {
  const initial = LINES.slice(0, 3).join('\n') + '\n'
  await installFetchStub(page)
  await installFakePicker(page)
  await page.goto('/')
  await page.getByTestId('webhook-url').fill('https://hooks.example.local/alerts')
  await page.evaluate(() => {
    window.__fetchFail = true
  })
  await page.getByTestId('webhook-test').click()

  await expect(page.getByTestId('webhook-status')).toContainText('Test failed')
  await expect(page.getByTestId('webhook-status')).toContainText('HTTP 500')

  // The app keeps working normally — a tail still ingests and renders rows.
  await page.evaluate(s => (window as unknown as { __tail: { set(s: string): void } }).__tail.set(s), initial)
  await page.getByTestId('tail-button').click()
  await expect.poll(() => count(page), { timeout: 10_000 }).toBe(3)
})