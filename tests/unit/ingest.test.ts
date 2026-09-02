import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { ingestZip, pasteFileName, textToFile } from '../../src/lib/ingest'

describe('textToFile / pasteFileName', () => {
  it('wraps text in a named file', async () => {
    const f = textToFile('hello\nworld', 'pasted-x.log')
    expect(f.name).toBe('pasted-x.log')
    expect(await f.text()).toBe('hello\nworld')
  })

  it('produces a timestamped pasted name', () => {
    expect(pasteFileName()).toMatch(/^pasted-\d{8}-\d{6}\.log$/)
  })
})

describe('ingestZip', () => {
  it('extracts member files with their names and content', async () => {
    const zipBytes = zipSync({
      'inner/app.log': strToU8('2026-09-01 08:00:01 INFO: hi\n'),
      'readme.txt': strToU8('notes'),
    })
    const f = new File([zipBytes as unknown as BlobPart], 'bundle.zip')
    const files = await ingestZip(f)
    expect(files.map(x => x.name).sort()).toEqual(['inner/app.log', 'readme.txt'])
    const app = files.find(x => x.name === 'inner/app.log')!
    expect(await app.text()).toBe('2026-09-01 08:00:01 INFO: hi\n')
  })

  it('skips directory entries', async () => {
    const zipBytes = zipSync({ 'dir/': new Uint8Array(0), 'a.log': strToU8('x\n') })
    const files = await ingestZip(new File([zipBytes as unknown as BlobPart], 'd.zip'))
    expect(files.map(x => x.name)).toEqual(['a.log'])
  })

  it('throws on non-zip data (caller reports a zip failure)', async () => {
    const notZip = new File([strToU8('definitely not a zip')], 'bad.zip')
    await expect(ingestZip(notZip)).rejects.toThrow()
  })

  it('round-trips the shipped packed.zip fixture', async () => {
    const { readFileSync } = await import('node:fs')
    const bytes = new Uint8Array(readFileSync('tests/fixtures/logs/packed.zip'))
    const files = await ingestZip(new File([bytes as unknown as BlobPart], 'packed.zip'))
    expect(files.map(x => x.name).sort()).toEqual(['a.log', 'b.csv'])
  })
})