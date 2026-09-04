import { expect, test } from '@playwright/test'

// Deterministic fixture (scripts/gen-sqlite-fixture.mjs): users(5 rows,
// AUTOINCREMENT → internal sqlite_sequence table) + orders(8 rows: 5 non-NULL
// notes, BLOBs of 4/6/1 bytes) + an index.
const FIXTURE = 'tests/fixtures/sqlite/sample.sqlite'

interface SqliteState {
  status: string
  error: string | null
  fileName: string | null
  tables: string[]
  activeTable: string | null
  columns: string[]
  rows: (string | number | boolean | null)[][]
  totalRows: number
  truncated: boolean
}

async function state(page: import('@playwright/test').Page): Promise<SqliteState | undefined> {
  return page.evaluate(() => (window as unknown as { __sqlite?: SqliteState }).__sqlite)
}

/** First open downloads + compiles the sql.js wasm (~1.2 MB) — allow headroom. */
async function ready(page: import('@playwright/test').Page): Promise<SqliteState> {
  await expect.poll(async () => (await state(page))?.status, { timeout: 120_000 }).toBe('ready')
  return (await state(page))!
}

test('open a .sqlite file, list tables, browse rows (null + blob cells)', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tab-sqlite').click()
  await page.getByTestId('sqlite-input').setInputFiles(FIXTURE)
  const s0 = await ready(page)

  // Users tables only — the AUTOINCREMENT-internal sqlite_sequence is excluded.
  expect(s0.fileName).toBe('sample.sqlite')
  expect(s0.tables).toEqual(['orders', 'users'])
  expect(s0.activeTable).toBeNull()
  await expect(page.getByTestId('sqlite-status')).toContainText('2 tables; pick one to browse')

  // users: columns + exact rows. (Poll on status+table together — selectTable
  // flips activeTable while still loading, so table alone is not a ready signal.)
  await page.getByTestId('sqlite-table-users').click()
  await expect.poll(async () => {
    const s = await state(page)
    return s?.status === 'ready' ? s.activeTable : null
  }, { timeout: 30_000 }).toBe('users')
  let s = (await state(page))!
  expect(s.columns).toEqual(['id', 'name', 'active'])
  expect(s.totalRows).toBe(5)
  expect(s.truncated).toBe(false)
  const alice = s.rows.find((r) => r[1] === 'alice')
  expect(alice).toEqual([1, 'alice', 1])
  const bob = s.rows.find((r) => r[1] === 'bob')
  expect(bob).toEqual([2, 'bob', 0])

  // orders: NULLs stay null; BLOBs become byte markers.
  await page.getByTestId('sqlite-table-orders').click()
  await expect.poll(async () => {
    const s = await state(page)
    return s?.status === 'ready' ? s.activeTable : null
  }, { timeout: 30_000 }).toBe('orders')
  s = (await state(page))!
  expect(s.columns).toEqual(['id', 'user_id', 'amount', 'note', 'payload'])
  expect(s.totalRows).toBe(8)
  const withNote = s.rows.filter((r) => r[3] !== null)
  expect(withNote.length).toBe(5)
  const blobs = s.rows.map((r) => r[4]).filter((v) => typeof v === 'string' && v.startsWith('<binary'))
  expect(blobs.sort()).toEqual(['<binary 1 byte>', '<binary 4 bytes>', '<binary 6 bytes>'])

  // Status line shows the table, row count and source file.
  await expect(page.getByTestId('sqlite-status')).toContainText('orders: 8 rows')
})

test('a non-SQLite file reports an error; a valid file recovers', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tab-sqlite').click()

  // A text log is not a SQLite database.
  await page.getByTestId('sqlite-input').setInputFiles('tests/fixtures/logs/mixed-levels.log')
  await expect.poll(async () => (await state(page))?.status, { timeout: 120_000 }).toBe('error')
  let s = (await state(page))!
  expect((s.error ?? '').length).toBeGreaterThan(0)
  expect(s.tables).toEqual([])
  await expect(page.getByTestId('sqlite-status')).toContainText(s.error!)

  // The engine survives — a valid file afterwards recovers to ready.
  await page.getByTestId('sqlite-input').setInputFiles(FIXTURE)
  s = await ready(page)
  expect(s.tables).toEqual(['orders', 'users'])
})

test('.db via the main open-files path routes to the SQLite tab, not the parser', async ({ page }) => {
  await page.goto('/')
  // The main input's accept list does not include .sqlite — but drag & drop and
  // programmatic sets can deliver it; it must never be text-parsed.
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  const s = await ready(page)

  expect(s.fileName).toBe('sample.sqlite')
  expect(s.tables).toEqual(['orders', 'users'])
  // No log entries were parsed and no file tab was created for the binary.
  const total = await page.evaluate(() => (window as unknown as { __appCounts?: { total: number } }).__appCounts?.total ?? -1)
  expect(total).toBe(0)
  await expect(page.getByTestId('tab-sample.sqlite')).toHaveCount(0)
})
