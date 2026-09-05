import { describe, expect, it } from 'vitest'
import { StreamDecoder } from '../../src/lib/streamDecoder'

/** Decode `bytes` one byte per call (streaming) — the worst-case split. */
function decodeByteByByte(label: string, bytes: Uint8Array, finalStream = false): string {
  const d = new StreamDecoder(label)
  let out = ''
  for (let i = 0; i < bytes.length - 1; i++) out += d.decode(bytes.subarray(i, i + 1), true)
  if (bytes.length > 0) out += d.decode(bytes.subarray(bytes.length - 1), finalStream)
  return out
}

describe('StreamDecoder', () => {
  it('reassembles multi-byte characters split across chunks (streaming utf-8)', () => {
    const original = 'héllo wörld — line one\nsecond—line with émojis 🚀'
    expect(decodeByteByByte('utf-8', new TextEncoder().encode(original))).toBe(original)
  })

  it('reassembles UTF-16 units split across chunk boundaries (utf-16le)', () => {
    // "AB" in UTF-16LE = 41 00 42 00; a 3-byte slice cuts between B and its NUL
    const d = new StreamDecoder('utf-16le')
    const bytes = new Uint8Array([0x41, 0x00, 0x42, 0x00])
    expect(d.decode(bytes.subarray(0, 3), true) + d.decode(bytes.subarray(3), false)).toBe('AB')
  })

  it('supports utf-16be', () => {
    const d = new StreamDecoder('utf-16be')
    expect(d.decode(new Uint8Array([0x00, 0x63, 0x00, 0xe9]), false)).toBe('cé')
  })

  it('decodes windows-1252 high bytes (é ï €, byte 0x80)', () => {
    const d = new StreamDecoder('windows-1252')
    expect(
      d.decode(new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x6e, 0x61, 0xef, 0x76, 0x65, 0x20, 0x80]), false),
    ).toBe('café naïve €')
  })

  it('flushes a truncated trailing sequence at end-of-file (stream:false)', () => {
    // Lone 0xC3 at EOF: replaced with U+FFFD once the decoder flushes.
    const d = new StreamDecoder('utf-8')
    expect(d.decode(new Uint8Array([0x61, 0xc3]), false)).toBe('a\u{FFFD}')
  })

  it('buffers a trailing incomplete sequence while streaming (stream:true)', () => {
    const d = new StreamDecoder('utf-8')
    const first = d.decode(new Uint8Array([0x61, 0xc3]), true) // 'a', C3 held back
    const rest = d.decode(new Uint8Array([0xa9]), false) // completes é
    expect(first).toBe('a')
    expect(rest).toBe('é')
  })

  it('reset() drops buffered state so a re-read decodes cleanly', () => {
    const d = new StreamDecoder('utf-16le')
    d.decode(new Uint8Array([0x41, 0x00, 0x42]), true) // 'A' + half of B held back
    d.reset()
    expect(d.decode(new Uint8Array([0x43, 0x00]), false)).toBe('C')
  })

  it('decodes an empty buffer to an empty string', () => {
    const d = new StreamDecoder('utf-8')
    expect(d.decode(new Uint8Array(0), false)).toBe('')
  })
})
