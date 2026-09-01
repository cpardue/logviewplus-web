import { describe, expect, it } from 'vitest'
import { readTextChunks } from '../../src/lib/fileSource'

describe('readTextChunks', () => {
  it('reassembles text split across chunks (mid-line and multi-byte boundaries)', async () => {
    const original =
      'héllo wörld — line one\n2026-09-01 08:00:01 INFO: second—line with émojis 🚀\n'
    const bytes = new TextEncoder().encode(original)
    const blob = new Blob([bytes])
    let out = ''
    let sawLast = false
    for await (const { text, isLast } of readTextChunks(blob, 3)) {
      out += text
      if (isLast) sawLast = true
    }
    expect(out).toBe(original)
    expect(sawLast).toBe(true)
  })

  it('handles a blob whose size is an exact multiple of the chunk size', async () => {
    const original = 'abc\nabc\n'
    const blob = new Blob([new TextEncoder().encode(original)])
    let out = ''
    for await (const { text } of readTextChunks(blob, 3)) out += text
    expect(out).toBe(original)
  })

  it('yields a single empty final chunk for an empty blob', async () => {
    const chunks: Array<{ text: string; isLast: boolean }> = []
    for await (const c of readTextChunks(new Blob([]), 8)) chunks.push(c)
    expect(chunks).toEqual([{ text: '', isLast: true }])
  })
})
