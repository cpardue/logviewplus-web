import { describe, expect, it } from 'vitest'
import { isTailSupported, TailFeed, type TailSource } from '../../src/lib/tail'

/** In-memory TailSource so the poll/rotation logic is testable without a browser. */
class MemSource implements TailSource {
  bytes = new Uint8Array(0)
  alive = true
  name = 'mem.log'
  sliceCalls: [number, number][] = []

  async stat(): Promise<number> {
    return this.alive ? this.bytes.length : -1
  }

  async slice(from: number, to: number): Promise<ArrayBuffer> {
    this.sliceCalls.push([from, to])
    const out = new Uint8Array(to - from)
    out.set(this.bytes.subarray(from, to))
    return out.buffer
  }

  set(s: string | Uint8Array): void {
    this.bytes = typeof s === 'string' ? new TextEncoder().encode(s) : s
  }

  append(s: string): void {
    const b = new TextEncoder().encode(s)
    const n = new Uint8Array(this.bytes.length + b.length)
    n.set(this.bytes)
    n.set(b, this.bytes.length)
    this.bytes = n
  }
}

type Step = Awaited<ReturnType<TailFeed['next']>>

/** Assert a 'bytes' step carries exactly the given bytes (M5-B: decode moved to the worker). */
function expectBytes(step: Step, expected: string | Uint8Array): void {
  expect(step.kind).toBe('bytes')
  if (step.kind !== 'bytes') return
  const want = typeof expected === 'string' ? new TextEncoder().encode(expected) : expected
  expect(new Uint8Array(step.buf)).toEqual(want)
}

describe('TailFeed', () => {
  it('consumes growth incrementally and reports none when idle', async () => {
    const source = new MemSource()
    source.set('line one\n')
    const feed = new TailFeed(source)

    const first = await feed.next()
    expectBytes(first, 'line one\n')
    if (first.kind !== 'bytes') return
    expect(first.offset).toBe(9)

    expect(await feed.next()).toEqual({ kind: 'none' })

    source.append('line two\n')
    const second = await feed.next()
    expectBytes(second, 'line two\n')
    if (second.kind !== 'bytes') return
    expect(second.offset).toBe(18)
    expect(feed.consumed).toBe(18)
    // Slices always start exactly where the last one ended.
    expect(source.sliceCalls).toEqual([
      [0, 9],
      [9, 18],
    ])
  })

  it('chunks reads at maxBytes and resumes across calls', async () => {
    const source = new MemSource()
    source.set('abcdef')
    const feed = new TailFeed(source)

    const a = await feed.next(2)
    expect(a).toMatchObject({ kind: 'bytes', offset: 2 })
    expectBytes(a, 'ab')
    const b = await feed.next(10)
    expect(b).toMatchObject({ kind: 'bytes', offset: 6 })
    expectBytes(b, 'cdef')
    expect(await feed.next()).toEqual({ kind: 'none' })
  })

  it('emits partial byte sequences as-is — decode reassembly is the worker decoder job', async () => {
    const source = new MemSource()
    // 'é' is 0xC3 0xA9 in UTF-8; hold back the second byte for a second read.
    source.set('a')
    const feed = new TailFeed(source)

    const first = await feed.next(1)
    expectBytes(first, 'a')
    if (first.kind !== 'bytes') return
    expect(first.offset).toBe(1)

    // Append 'é'; only its first byte is visible to this bounded read. The
    // dangling lead byte must pass through RAW — the worker's streaming
    // decoder keeps it buffered until the next read (see streamDecoder tests).
    source.append('é')
    const partial = await feed.next(1)
    expect(partial).toMatchObject({ kind: 'bytes', offset: 2 })
    if (partial.kind === 'bytes') expect(new Uint8Array(partial.buf)).toEqual(new Uint8Array([0xc3]))

    const rest = await feed.next()
    expect(rest).toMatchObject({ kind: 'bytes', offset: 3 })
    if (rest.kind === 'bytes') expect(new Uint8Array(rest.buf)).toEqual(new Uint8Array([0xa9]))
  })

  it('reports rotation when the file shrinks below the last observed size', async () => {
    const source = new MemSource()
    source.set('0123456789')
    const feed = new TailFeed(source)
    await feed.next() // consume all 10
    expect(await feed.next()).toEqual({ kind: 'none' })

    // Truncation in place…
    source.set('new')
    expect(await feed.next()).toEqual({ kind: 'rotate' })
    feed.reset()
    const reread = await feed.next()
    expect(reread).toMatchObject({ kind: 'bytes', offset: 3 })
    expectBytes(reread, 'new')

    // …and rotation after the growth was observed by a poll (prevSize tracks
    // the larger size), then the file truncates back down — cleanly detectable.
    const source2 = new MemSource()
    const feed2 = new TailFeed(source2)
    source2.set('0123456789')
    await feed2.next() // consume 10, prevSize=10
    source2.append('more data here\n')
    expect((await feed2.next()).kind).toBe('bytes') // poll sees the growth
    source2.set('after-rotate') // truncate/rotate to a smaller size
    expect(await feed2.next()).toEqual({ kind: 'rotate' })
  })

  it('reports removed when the source stops resolving and stays stopped', async () => {
    const source = new MemSource()
    source.set('hello\n')
    const feed = new TailFeed(source)
    expect(await feed.next()).toMatchObject({ kind: 'bytes' })

    source.alive = false
    expect(await feed.next()).toEqual({ kind: 'removed' })
    expect(await feed.next()).toEqual({ kind: 'removed' })
  })

  it('handles an empty source and growth into it', async () => {
    const source = new MemSource()
    const feed = new TailFeed(source)
    expect(await feed.next()).toEqual({ kind: 'none' })

    source.append('first\n')
    const step = await feed.next()
    expect(step).toMatchObject({ kind: 'bytes', offset: 6 })
    expectBytes(step, 'first\n')
  })

  it('reset() rewinds the feed', async () => {
    const source = new MemSource()
    source.set('0123456789')
    const feed = new TailFeed(source)
    await feed.next(6) // mid-file
    expect(feed.consumed).toBe(6)

    feed.reset()
    expect(feed.consumed).toBe(0)
    const step = await feed.next()
    expect(step).toMatchObject({ kind: 'bytes', offset: 10 })
    expectBytes(step, '0123456789')
  })
})

describe('isTailSupported', () => {
  it('returns false outside a browser (no window / no picker)', () => {
    expect(isTailSupported()).toBe(false)
  })
})
