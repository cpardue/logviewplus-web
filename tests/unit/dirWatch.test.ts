import { describe, expect, it } from 'vitest'
import { DirFeed, diffDirs, isDirSupported, type DirSource, type TailSource } from '../../src/lib/dirWatch'

/** In-memory DirSource so the diff/poll logic is testable without a browser. */
class MemDir implements DirSource {
  files = new Map<string, Uint8Array>()

  set(name: string, s: string | Uint8Array): void {
    this.files.set(name, typeof s === 'string' ? new TextEncoder().encode(s) : s)
  }

  delete(name: string): void {
    this.files.delete(name)
  }

  async list() {
    return [...this.files].map(([name, bytes]) => ({ name, size: bytes.length }))
  }

  async open(name: string): Promise<TailSource | null> {
    const files = this.files
    const bytes = files.get(name)
    if (!bytes) return null
    const source: TailSource = {
      name,
      async stat() {
        return files.has(name) ? bytes.length : -1
      },
      async slice(from, to) {
        const out = new Uint8Array(to - from)
        out.set(bytes.subarray(from, to))
        return out.buffer
      },
    }
    return source
  }
}

describe('diffDirs', () => {
  it('reports added and removed names; size changes alone are not events', () => {
    const prev = new Map([
      ['a.log', 100],
      ['b.log', 50],
    ])
    const curr = [
      { name: 'a.log', size: 250 }, // grew — not a directory event (per-file tail owns it)
      { name: 'c.log', size: 1 }, // new
    ]
    expect(diffDirs(prev, curr)).toEqual({
      added: [{ name: 'c.log', size: 1 }],
      removed: [{ name: 'b.log', size: 50 }],
    })
  })

  it('reports nothing for an unchanged directory', () => {
    const prev = new Map([['a.log', 10]])
    expect(diffDirs(prev, [{ name: 'a.log', size: 10 }])).toEqual({ added: [], removed: [] })
  })

  it('reports nothing at all for an empty→empty diff', () => {
    expect(diffDirs(new Map(), [])).toEqual({ added: [], removed: [] })
  })
})

describe('DirFeed', () => {
  it('first() emits every entry as added, nothing as removed', async () => {
    const dir = new MemDir()
    dir.set('a.log', 'hello')
    dir.set('b.txt', 'world!!')
    const feed = new DirFeed(dir)

    const first = await feed.first()
    expect(first.added.sort((x, y) => x.name.localeCompare(y.name))).toEqual([
      { name: 'a.log', size: 5 },
      { name: 'b.txt', size: 7 },
    ])
    expect(first.removed).toEqual([])

    // An unchanged second poll is quiet.
    expect(await feed.next()).toEqual({ added: [], removed: [] })
  })

  it('next() before first() behaves like first()', async () => {
    const dir = new MemDir()
    dir.set('a.log', 'x')
    const feed = new DirFeed(dir)

    expect(await feed.next()).toEqual({ added: [{ name: 'a.log', size: 1 }], removed: [] })
    expect(await feed.next()).toEqual({ added: [], removed: [] })
  })

  it('tracks additions and removals across polls', async () => {
    const dir = new MemDir()
    dir.set('a.log', 'aaa')
    const feed = new DirFeed(dir)
    await feed.first()

    dir.set('b.log', 'bb')
    expect(await feed.next()).toEqual({ added: [{ name: 'b.log', size: 2 }], removed: [] })

    dir.delete('a.log')
    expect(await feed.next()).toEqual({ added: [], removed: [{ name: 'a.log', size: 3 }] })

    // Re-adding a name the feed never saw again counts as added.
    dir.set('a.log', 'zz')
    expect(await feed.next()).toEqual({ added: [{ name: 'a.log', size: 2 }], removed: [] })
  })

  it('size growth on an existing file is not a directory event', async () => {
    const dir = new MemDir()
    dir.set('a.log', 'one')
    const feed = new DirFeed(dir)
    await feed.first()

    dir.set('a.log', 'one two three')
    expect(await feed.next()).toEqual({ added: [], removed: [] })
  })
})

describe('DirSource.open (MemDir)', () => {
  it('resolves a live file to a readable TailSource and null when gone', async () => {
    const dir = new MemDir()
    dir.set('a.log', 'hello\n')

    const src = await dir.open('a.log')
    expect(src).not.toBeNull()
    if (src) {
      expect(src.name).toBe('a.log')
      expect(await src.stat()).toBe(6)
      const buf = await src.slice(0, 5)
      expect(new TextDecoder().decode(buf)).toBe('hello')
    }

    dir.delete('a.log')
    expect(await dir.open('a.log')).toBeNull()
  })
})

describe('isDirSupported', () => {
  it('is false outside the browser (no window)', () => {
    expect(isDirSupported()).toBe(false)
  })
})
