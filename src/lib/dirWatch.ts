/**
 * Directory monitoring — watch a folder for log files appearing or leaving.
 *
 * The core ({@link DirFeed} / {@link diffDirs}) is DOM-free and directly
 * unit-testable: each poll takes a snapshot of top-level `{ name, size }`
 * entries and classifies the delta against the previous snapshot into
 * `added` (a name not seen before) and `removed` (a name gone). A SIZE change
 * on a still-present file is deliberately NOT a directory event: byte-level
 * growth, truncation and rotation of an open file are handled by that file's
 * own {@link TailFeed} (`src/lib/tail.ts`), which re-resolves the file on
 * every poll. `lastModified` is deliberately not part of the diff key — it
 * changes on every append, so including it would flag a normally-growing log
 * as changed on every poll. Same-name delete+recreate is a documented blind
 * spot (a reused name is treated as the same file — recover by deleting and
 * re-adding the tab); same class as the size-polling blind spots in tail.ts.
 *
 * The File System Access API adapter ({@link FsaDir} / {@link isDirSupported})
 * is Chromium-only; feature detection happens in the UI so non-Chromium
 * browsers degrade gracefully. Subdirectories are ignored (top-level files
 * only — see MILESTONE-4.md as-built notes).
 */

import { HandleSource, type TailSource } from './tail'

export interface DirEntry {
  name: string
  size: number
}

export interface DirDiff {
  added: DirEntry[]
  removed: DirEntry[]
}

export interface DirSource {
  /** Snapshot of top-level files (subdirectories excluded by the adapter). */
  list(): Promise<DirEntry[]>
  /** Open a file of this directory as a tailable source; null when it is gone. */
  open(name: string): Promise<TailSource | null>
}

/**
 * Pure snapshot diff. Membership (name) only — size changes are handled at
 * the per-file tail level, see module docs.
 */
export function diffDirs(prev: ReadonlyMap<string, number>, curr: readonly DirEntry[]): DirDiff {
  const now = new Set<string>()
  const added: DirEntry[] = []
  for (const e of curr) {
    if (!prev.has(e.name)) added.push(e)
    now.add(e.name)
  }
  const removed: DirEntry[] = []
  for (const [name, size] of prev) {
    if (!now.has(name)) removed.push({ name, size })
  }
  return { added, removed }
}

/** Maintains the previous directory snapshot and emits per-poll diffs. */
export class DirFeed {
  private prev: Map<string, number> = new Map()
  private seen = false

  constructor(private readonly source: DirSource) {}

  /** Initial scan — every entry counts as `added`; nothing can be removed. */
  async first(): Promise<DirDiff> {
    const entries = await this.source.list()
    this.prev = new Map(entries.map(e => [e.name, e.size]))
    this.seen = true
    return { added: entries.slice(), removed: [] }
  }

  /** One poll — diff against the previous snapshot, then adopt it. */
  async next(): Promise<DirDiff> {
    if (!this.seen) return this.first()
    const entries = await this.source.list()
    const diff = diffDirs(this.prev, entries)
    this.prev = new Map(entries.map(e => [e.name, e.size]))
    return diff
  }
}

/** File System Access API directory support (Chromium; absent elsewhere). */
export function isDirSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

/** Reads a {@link FileSystemDirectoryHandle} as a live {@link DirSource}. */
export class FsaDir implements DirSource {
  constructor(private readonly handle: FileSystemDirectoryHandle) {}

  get name(): string {
    return this.handle.name
  }

  async list(): Promise<DirEntry[]> {
    const out: DirEntry[] = []
    for await (const entry of this.handle.values()) {
      if (entry.kind !== 'file') continue // subdirectories ignored (M4-A limitation)
      const name = entry.name
      try {
        // getFile() is a lazy stat — it does not read the file's bytes.
        out.push({ name, size: (await (entry as FileSystemFileHandle).getFile()).size })
      } catch {
        // Deleted between enumeration and stat — skip for this poll.
      }
    }
    return out
  }

  async open(name: string): Promise<TailSource | null> {
    try {
      const entry = await this.handle.getFileHandle(name)
      await entry.getFile() // throw when it vanished between list and open
      return new HandleSource(entry)
    } catch {
      return null
    }
  }
}
