import { expect, test } from '@playwright/test'

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

/** Read the parsed rows actually fed to the grid (virtualized set = all rows for these small fixtures). */
async function gridRows(page: import('@playwright/test').Page): Promise<{ message: string; raw: string }[]> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __gridApi?: {
        getDisplayedRowCount: () => number
        getDisplayedRowAtIndex: (i: number) => { data?: { message: string; raw: string } } | undefined
      }
    }).__gridApi
    if (!api) return []
    const out: { message: string; raw: string }[] = []
    for (let i = 0; i < api.getDisplayedRowCount(); i++) {
      const r = api.getDisplayedRowAtIndex(i)
      if (r?.data) out.push({ message: r.data.message, raw: r.data.raw })
    }
    return out
  })
}

test('auto-detects Windows-1252 and decodes high bytes without replacement', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/logs/win1252.log')
  // 10 lines, all matching the pattern template.
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 10, visible: 10 })
  await expect(page.getByTestId('file-encoding')).toHaveText('windows-1252')

  const rows = await gridRows(page)
  expect(rows[0].message).toContain('café') // 0xE9 must decode to é, not U+FFFD
  const all = rows.map(r => r.message).join('\n')
  expect(all).toContain('€') // byte 0x80 — only correct under real windows-1252
  expect(all).not.toContain('\uFFFD')
})

test('auto-detects UTF-16LE via its BOM and strips the BOM', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/logs/utf16le.log')
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 3, visible: 3 })
  await expect(page.getByTestId('file-encoding')).toHaveText('utf-16le')

  const rows = await gridRows(page)
  // BOM must not leak into the first line as U+FEFF.
  expect(rows[0].raw.startsWith('\uFEFF')).toBe(false)
  expect(rows[0].message).toContain('Unicode service online')
  expect(rows[1].message).toContain('café') // é = E9 00 in UTF-16LE
})

test('valid multi-byte UTF-8 still auto-detects as utf-8 (no regression)', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/logs/utf8-mb.log')
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 3, visible: 3 })
  await expect(page.getByTestId('file-encoding')).toHaveText('utf-8')

  const rows = await gridRows(page)
  expect(rows[0].message).toContain('café') // 2-byte
  expect(rows[1].message).toContain('über') // 2-byte
  expect(rows[2].message).toContain('日志') // 3-byte CJK
})

test('explicit encoding override wins over auto-detection', async ({ page }) => {
  await page.goto('/')
  // Force UTF-8 before opening: the same win1252 file must now be decoded as
  // (mangled) UTF-8 — proof the select, not the detector, drives the decoder.
  await page.getByTestId('encoding-select').selectOption('utf-8')
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/logs/win1252.log')
  await expect.poll(() => counts(page), { timeout: 20_000 }).toEqual({ total: 10, visible: 10 })
  await expect(page.getByTestId('file-encoding')).toHaveText('utf-8')

  const rows = await gridRows(page)
  expect(rows[0].message).not.toContain('café')
  expect(rows[0].message).toContain('\uFFFD') // 0xE9 replaced under forced utf-8
})

test('encoding choice persists across reloads', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('encoding-select').selectOption('windows-1252')
  await page.reload()
  await expect(page.getByTestId('encoding-select')).toHaveValue('windows-1252')
})
