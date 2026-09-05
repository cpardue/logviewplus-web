import { describe, expect, it } from 'vitest'
import { readByteChunks } from '../../src/lib/fileSource'

function concat(chunks: Array<{ buf: ArrayBuffer; isLast: boolean }>): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.buf.byteLength, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(new Uint8Array(c.buf), at)
    at += c.buf.byteLength
  }
  return out
}

describe('readByteChunks', () => {
  it('splits raw bytes at chunk boundaries and reassembles exactly', async () => {
    const original = new TextEncoder().encode(
      'héllo wörld — line one\n2026-09-01 08:00:01 INFO: second—line with émojis 🚀\n',
    )
    const blob = new Blob([original])
    const chunks: Array<{ buf: ArrayBuffer; isLast: boolean }> = []
    let sawLast = false
    for await (const c of readByteChunks(blob, 3)) {
      if (c.isLast) sawLast = true
      chunks.push(c)
    }
    expect(Array.from(concat(chunks))).toEqual(Array.from(original))
    expect(sawLast).toBe(true)
  })

  it('handles a blob whose size is an exact multiple of the chunk size', async () => {
    const blob = new Blob([new TextEncoder().encode('abc\nabc\n')])
    const chunks: Array<{ buf: ArrayBuffer; isLast: boolean }> = []
    for await (const c of readByteChunks(blob, 3)) chunks.push(c)
    expect(chunks.map(c => c.isLast)).toEqual([false, false, true])
    expect(concat(chunks)).toEqual(new TextEncoder().encode('abc\nabc\n'))
  })

  it('yields a single empty final chunk for an empty blob', async () => {
    const chunks: Array<{ buf: ArrayBuffer; isLast: boolean }> = []
    for await (const c of readByteChunks(new Blob([]), 8)) chunks.push(c)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].isLast).toBe(true)
    expect(chunks[0].buf.byteLength).toBe(0)
  })

  it('skips the BOM bytes and marks only the final chunk last', async () => {
    // EF BB BF (UTF-8 BOM) + five body bytes, 2-byte slices → 3 chunks
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf, 1, 2, 3, 4, 5])])
    const chunks: Array<{ buf: ArrayBuffer; isLast: boolean }> = []
    for await (const c of readByteChunks(blob, 2, 3)) chunks.push(c)
    expect(chunks.map(c => c.isLast)).toEqual([false, false, true])
    expect(Array.from(concat(chunks))).toEqual([1, 2, 3, 4, 5])
  })
})

