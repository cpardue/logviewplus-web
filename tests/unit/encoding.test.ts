import { describe, expect, it } from 'vitest'
import { readTextChunks } from '../../src/lib/fileSource'
import { TailFeed, type TailSource } from '../../src/lib/tail'
import {
  detectBom,
  detectEncoding,
  isStrictUtf8,
  resolveFromBlob,
  resolveFromSample,
} from '../../src/lib/encoding'

/** UTF-8 bytes of a JS string (Node full-icu TextEncoder available). */
function u8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

describe('isStrictUtf8', () => {
  it('accepts empty and pure ASCII input', () => {
    expect(isStrictUtf8(new Uint8Array(0))).toBe(true)
    expect(isStrictUtf8(u8('plain ascii 123'))).toBe(true)
  })

  it('accepts valid 2-, 3- and 4-byte sequences', () => {
    expect(isStrictUtf8(u8('café'))).toBe(true) // é = C3 A9
    expect(isStrictUtf8(u8('日志'))).toBe(true) // 3-byte CJK
    expect(isStrictUtf8(u8('€'))).toBe(true) // 4-byte U+20AC
    expect(isStrictUtf8(new Uint8Array([0xc2, 0x80]))).toBe(true) // U+0080, shortest legal 2-byte
  })

  it('rejects a continuation byte in lead position', () => {
    expect(isStrictUtf8(new Uint8Array([0x80]))).toBe(false)
    expect(isStrictUtf8(new Uint8Array([0x61, 0x80, 0x62]))).toBe(false)
  })

  it('rejects truncated sequences at the end of the sample', () => {
    expect(isStrictUtf8(new Uint8Array([0xc3]))).toBe(false)
    expect(isStrictUtf8(new Uint8Array([0xe6, 0x97]))).toBe(false)
    expect(isStrictUtf8(new Uint8Array([0xf0, 0x9f, 0x98]))).toBe(false)
  })

  it('rejects a non-continuation byte inside a sequence', () => {
    expect(isStrictUtf8(new Uint8Array([0xe2, 0x28, 0xac]))).toBe(false)
  })

  it('rejects overlong encodings', () => {
    expect(isStrictUtf8(new Uint8Array([0xc0, 0x80]))).toBe(false)
    expect(isStrictUtf8(new Uint8Array([0xc1, 0xbf]))).toBe(false)
    expect(isStrictUtf8(new Uint8Array([0xf0, 0x80, 0x80, 0x80]))).toBe(false)
  })

  it('rejects code points above U+10FFFF but keeps U+10FFFF itself', () => {
    expect(isStrictUtf8(new Uint8Array([0xf5, 0x80, 0x80, 0x80]))).toBe(false)
    expect(isStrictUtf8(new Uint8Array([0xf4, 0x90, 0x80, 0x80]))).toBe(false)
    expect(isStrictUtf8(new Uint8Array([0xf4, 0x8f, 0xbf, 0xbf]))).toBe(true)
  })
})

describe('detectBom', () => {
  it('detects the three BOMs', () => {
    expect(detectBom(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toEqual({ label: 'utf-8', length: 3 })
    expect(detectBom(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toEqual({ label: 'utf-16le', length: 2 })
    expect(detectBom(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toEqual({ label: 'utf-16be', length: 2 })
  })

  it('returns null for missing, short or non-BOM prefixes', () => {
    expect(detectBom(u8('plain'))).toBeNull()
    expect(detectBom(new Uint8Array([0xef]))).toBeNull()
    expect(detectBom(new Uint8Array([0xff]))).toBeNull()
    expect(detectBom(new Uint8Array([]))).toBeNull()
  })
})

describe('detectEncoding (auto)', () => {
  it('treats pure ASCII as utf-8', () => {
    expect(detectEncoding(u8('2026-09-04 INFO: all ascii'))).toBe('utf-8')
  })

  it('follows a BOM', () => {
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, ...u8('x')]))).toBe('utf-8')
    expect(detectEncoding(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe('utf-16le')
    expect(detectEncoding(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toBe('utf-16be')
  })

  it('keeps valid multi-byte UTF-8 as utf-8', () => {
    expect(detectEncoding(u8('café naïve über € 日志'))).toBe('utf-8')
  })

  it('falls back to windows-1252 for high bytes that are not UTF-8', () => {
    // é as a single 0xE9 byte (invalid UTF-8 lead without continuations)
    expect(detectEncoding(new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20]))).toBe('windows-1252')
  })

  it('detects BOM-less UTF-16 via the zero-parity pattern (LE and BE)', () => {
    const le = Buffer.from('hello world hello world', 'utf16le')
    // Node's Buffer has no utf16be — swap each 16-bit unit.
    const be = new Uint8Array(le.length)
    for (let i = 0; i < le.length; i += 2) {
      be[i] = le[i + 1]
      be[i + 1] = le[i]
    }
    expect(detectEncoding(new Uint8Array(le))).toBe('utf-16le')
    expect(detectEncoding(be)).toBe('utf-16be')
  })
})

describe('resolveFromSample (explicit choices + BOM skip)', () => {
  const leBom = new Uint8Array([0xff, 0xfe, 0x61, 0x00])
  const utf8Bom = new Uint8Array([0xef, 0xbb, 0xbf, ...u8('hi')])

  it('auto: reports the BOM length to skip', () => {
    expect(resolveFromSample(utf8Bom)).toEqual({ label: 'utf-8', bomLength: 3 })
    expect(resolveFromSample(leBom)).toEqual({ label: 'utf-16le', bomLength: 2 })
    expect(resolveFromSample(u8('no bom'))).toEqual({ label: 'utf-8', bomLength: 0 })
  })

  it('auto: an empty sample resolves to plain utf-8', () => {
    expect(resolveFromSample(new Uint8Array(0))).toEqual({ label: 'utf-8', bomLength: 0 })
  })

  it('explicit choice wins the label; a matching BOM is still skipped', () => {
    expect(resolveFromSample(utf8Bom, 'utf-8')).toEqual({ label: 'utf-8', bomLength: 3 })
    expect(resolveFromSample(leBom, 'utf-16le')).toEqual({ label: 'utf-16le', bomLength: 2 })
    expect(resolveFromSample(u8('x'), 'windows-1252')).toEqual({ label: 'windows-1252', bomLength: 0 })
  })

  it('explicit choice: a mismatched BOM is NOT skipped (user misconfiguration)', () => {
    expect(resolveFromSample(leBom, 'utf-8')).toEqual({ label: 'utf-8', bomLength: 0 })
    expect(resolveFromSample(utf8Bom, 'windows-1252')).toEqual({ label: 'windows-1252', bomLength: 0 })
  })
})

function leBomBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xfe, 0x61, 0x00])
}

describe('resolveFromBlob', () => {
  it('auto-detects through a real Blob', async () => {
    expect(await resolveFromBlob(new Blob([new Uint8Array([0x63, 0x61, 0x66, 0xe9])])))
      .toEqual({ label: 'windows-1252', bomLength: 0 })
    expect(await resolveFromBlob(new Blob([leBomBytes()]))).toEqual({ label: 'utf-16le', bomLength: 2 })
    expect(await resolveFromBlob(new Blob([]))).toEqual({ label: 'utf-8', bomLength: 0 })
  })

  it('honors an explicit override', async () => {
    const res = await resolveFromBlob(new Blob([new Uint8Array([0x63, 0x61, 0x66, 0xe9])]), 'utf-8')
    expect(res).toEqual({ label: 'utf-8', bomLength: 0 })
  })
})

describe('TextDecoder labels actually work (Chromium + Node full-icu)', () => {
  it('decodes windows-1252 high bytes to the expected characters', () => {
    // 0xE9 = é, 0xEF = ï, 0x80 = € (1252-specific — not in latin-1)
    const out = new TextDecoder('windows-1252').decode(
      new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x6e, 0x61, 0xef, 0x76, 0x65, 0x20, 0x80]),
    )
    expect(out).toBe('café naïve €')
  })

  it('decodes utf-16le and utf-16be', () => {
    const le = new TextDecoder('utf-16le').decode(new Uint8Array([0x63, 0x00, 0xe9, 0x00]))
    const be = new TextDecoder('utf-16be').decode(new Uint8Array([0x00, 0x63, 0x00, 0xe9]))
    expect(le).toBe('cé')
    expect(be).toBe('cé')
  })
})

describe('readTextChunks with an encoding resolution', () => {
  it('skips the BOM and decodes the rest as utf-8', async () => {
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf, ...u8('hello')])])
    const texts: string[] = []
    for await (const c of readTextChunks(blob, 2, { label: 'utf-8', bomLength: 3 })) texts.push(c.text)
    expect(texts.join('')).toBe('hello')
  })

  it('reassembles a multi-byte character split across chunks (streaming utf-8)', async () => {
    // "é x" = C3 A9 20 78, chunked one byte at a time
    const blob = new Blob([new Uint8Array([0xc3, 0xa9, 0x20, 0x78])])
    const texts: string[] = []
    for await (const c of readTextChunks(blob, 1, { label: 'utf-8', bomLength: 0 })) texts.push(c.text)
    expect(texts.join('')).toBe('é x')
  })

  it('reassembles UTF-16 units split across chunk boundaries', async () => {
    // "AB" in UTF-16LE = 41 00 42 00; a 3-byte chunk cuts between B and its zero
    const blob = new Blob([new Uint8Array([0x41, 0x00, 0x42, 0x00])])
    const texts: string[] = []
    for await (const c of readTextChunks(blob, 3, { label: 'utf-16le', bomLength: 0 })) texts.push(c.text)
    expect(texts.join('')).toBe('AB')
  })

  it('decodes windows-1252 content', async () => {
    const blob = new Blob([new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20])])
    const texts: string[] = []
    for await (const c of readTextChunks(blob, 2, { label: 'windows-1252', bomLength: 0 })) texts.push(c.text)
    expect(texts.join('')).toBe('café ')
  })

  it('a file that is only a BOM yields a single empty final chunk', async () => {
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf])])
    const chunks: { text: string; isLast: boolean }[] = []
    for await (const c of readTextChunks(blob, 4, { label: 'utf-8', bomLength: 3 })) chunks.push(c)
    expect(chunks).toEqual([{ text: '', isLast: true }])
  })

  it('keeps the default plain-UTF-8 behavior when no resolution is given', async () => {
    const blob = new Blob([new Uint8Array([0x61, 0x62])])
    const texts: string[] = []
    for await (const c of readTextChunks(blob)) texts.push(c.text)
    expect(texts.join('')).toBe('ab')
  })
})

class MemSource implements TailSource {
  bytes = new Uint8Array(0)
  name = 'mem.log'
  async stat(): Promise<number> {
    return this.bytes.length
  }
  async slice(from: number, to: number): Promise<ArrayBuffer> {
    return this.bytes.slice(from, to).buffer as ArrayBuffer
  }
}

describe('TailFeed with an encoding resolution', () => {
  it('decodes growth with the chosen label', async () => {
    const src = new MemSource()
    src.bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]) // 'café' in windows-1252
    const feed = new TailFeed(src, { label: 'windows-1252', bomLength: 0 })
    expect(await feed.next()).toEqual({ kind: 'text', text: 'café', offset: 4 })
  })

  it('starts past the BOM and resumes with the same decoder after reset', async () => {
    const src = new MemSource()
    // FF FE BOM + "hi" in UTF-16LE
    src.bytes = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])
    const feed = new TailFeed(src, { label: 'utf-16le', bomLength: 2 })
    expect(await feed.next()).toEqual({ kind: 'text', text: 'hi', offset: 6 })

    // Rotation: rewind to the file start (past the BOM of the new content) and grow again.
    src.bytes = new Uint8Array([0xff, 0xfe, 0x6f, 0x00])
    feed.reset()
    expect(await feed.next()).toEqual({ kind: 'text', text: 'o', offset: 4 })
  })

  it('still defaults to UTF-8 without an explicit resolution', async () => {
    const src = new MemSource()
    src.bytes = new Uint8Array([0x68, 0x69])
    expect(await new TailFeed(src).next()).toEqual({ kind: 'text', text: 'hi', offset: 2 })
  })
})


