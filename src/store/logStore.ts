import { create } from 'zustand'
import type { LogEntry, LogLevel } from '../parsers/types'
import { EMPTY_FILTERS, type Filters } from '../lib/filters'
import { startParse, startTail, type ParseSession } from '../lib/pipeline'
import { HandleSource } from '../lib/tail'
import { ingestZip } from '../lib/ingest'

export interface FileState {
  id: string
  name: string
  size: number
  status: 'parsing' | 'ready' | 'error'
  /** 0..1 fraction of bytes fed to the parser. */
  fraction: number
  lines: number
  startedAt: number
  finishedAt: number | null
  /**
   * Parsed rows. The array reference stays stable while a file parses —
   * batches are appended in place (see {@link appendRows}); tail rotation
   * swaps in a fresh array.
   */
  entries: LogEntry[]
  /** True while a live tail is appending to this file (Chromium only). */
  tail?: boolean
  error?: string
}

interface LogState {
  files: Record<string, FileState>
  activeId: string | null
  filters: Filters
  /** How zone-less timestamps are interpreted while parsing (persisted). */
  tzMode: 'local' | 'utc'
  /** "All" merged view across every ready file. */
  merged: boolean
  addFiles(list: FileList | File[]): void
  /** Start tail-following a File System Access API handle (Chromium only). */
  startTail(handle: FileSystemFileHandle): void
  removeFile(id: string): void
  setActive(id: string | null): void
  setMerged(on: boolean): void
  setText(text: string): void
  toggleLevel(level: LogLevel): void
  clearFilters(): void
  setFilters(f: Filters): void
  setTzMode(mode: 'local' | 'utc'): void
}

const sessions = new Map<string, ParseSession>()
let nextId = 1

const TZ_KEY = 'lvp.tzMode'

function readTzMode(): 'local' | 'utc' {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(TZ_KEY) === 'utc' ? 'utc' : 'local'
  } catch {
    return 'local'
  }
}

/** Expand a zip into its member files; non-zips pass through unchanged. */
async function expand(list: File[]): Promise<{ files: File[]; failures: { name: string; size: number; error: string }[] }> {
  const files: File[] = []
  const failures: { name: string; size: number; error: string }[] = []
  for (const f of list) {
    if (f.name.toLowerCase().endsWith('.zip')) {
      try {
        files.push(...(await ingestZip(f)))
      } catch (err) {
        failures.push({ name: f.name, size: f.size, error: `ZIP failed: ${String(err)}` })
      }
    } else {
      files.push(f)
    }
  }
  return { files, failures }
}

/**
 * Append a parsed row batch to the file's entry array IN PLACE (stable array
 * reference), then publish a fresh `FileState` object so subscribers re-render.
 * Copying `[...f.entries, ...rows]` per 5k-row batch re-copies the whole
 * accumulated log — O(n²) across the file (~280 full copies at 100 MB /
 * 1.4M rows). No consumer reads `entries` while a file parses (grid and report
 * row data are ready-gated in App.tsx), so the stable reference is safe; tail
 * rotation replaces the array with a fresh one and appends resume into it.
 */
function appendRows(id: string, rows: LogEntry[], set: (fn: (s: LogState) => Partial<LogState>) => void, get: () => LogState): void {
  const f = get().files[id]
  if (!f || f.status === 'error') return
  f.entries.push(...rows)
  set(s => {
    const cur = s.files[id]
    if (!cur) return s
    return { files: { ...s.files, [id]: { ...cur } } }
  })
}

export const useLogStore = create<LogState>((set, get) => ({
  files: {},
  activeId: null,
  filters: EMPTY_FILTERS,
  tzMode: readTzMode(),
  merged: false,

  addFiles(list) {
    void (async () => {
      const { files, failures } = await expand(Array.from(list))
      for (const fail of failures) {
        const id = `f${nextId++}`
        set(s => ({
          files: {
            ...s.files,
            [id]: {
              id,
              name: fail.name,
              size: fail.size,
              status: 'error',
              fraction: 0,
              lines: 0,
              startedAt: performance.now(),
              finishedAt: performance.now(),
              entries: [],
              error: fail.error,
            },
          },
          activeId: s.activeId ?? id,
        }))
      }
      for (const file of files) {
        const id = `f${nextId++}`
        set(s => ({
          files: {
            ...s.files,
            [id]: {
              id,
              name: file.name,
              size: file.size,
              status: 'parsing',
              fraction: 0,
              lines: 0,
              startedAt: performance.now(),
              finishedAt: null,
              entries: [],
            },
          },
          activeId: s.activeId ?? id,
        }))
        sessions.set(
          id,
          startParse(
            file,
            {
              onRows(rows) {
                appendRows(id, rows, set, get)
              },
              onProgress(lines, _entries, bytes) {
                set(s => {
                  const f = s.files[id]
                  if (!f || f.status === 'error') return s
                  return {
                    files: {
                      ...s.files,
                      [id]: { ...f, lines, fraction: f.size > 0 ? Math.min(1, bytes / f.size) : 0 },
                    },
                  }
                })
              },
              onDone(lines) {
                set(s => {
                  const f = s.files[id]
                  if (!f) return s
                  return {
                    files: {
                      ...s.files,
                      [id]: { ...f, status: 'ready', lines, fraction: 1, finishedAt: performance.now() },
                    },
                  }
                })
                sessions.delete(id)
              },
              onError(message) {
                set(s => {
                  const f = s.files[id]
                  if (!f) return s
                  return {
                    files: {
                      ...s.files,
                      [id]: { ...f, status: 'error', error: message, finishedAt: performance.now() },
                    },
                  }
                })
                sessions.delete(id)
              },
            },
            { tzMode: get().tzMode },
          ),
        )
      }
    })()
  },

  startTail(handle) {
    void (async () => {
      let size: number
      try {
        size = (await handle.getFile()).size
      } catch {
        return // handle already dead — nothing to tail
      }
      const id = `f${nextId++}`
      set(s => ({
        files: {
          ...s.files,
          [id]: {
            id,
            name: handle.name,
            size,
            status: 'parsing',
            fraction: 0,
            lines: 0,
            startedAt: performance.now(),
            finishedAt: null,
            entries: [],
            tail: true,
          },
        },
        // Live tail is meant to be watched — switch to it.
        activeId: id,
        merged: false,
      }))
      const source = new HandleSource(handle)
      sessions.set(
        id,
        startTail(
          source,
          {
            onRows(rows) {
              appendRows(id, rows, set, get)
            },
            onProgress(lines, _entries, bytes) {
              set(s => {
                const f = s.files[id]
                if (!f || f.status === 'error') return s
                return {
                  files: {
                    ...s.files,
                    [id]: { ...f, lines, fraction: f.size > 0 ? Math.min(1, bytes / f.size) : 0 },
                  },
                }
              })
            },
            // Initial read done — usable; appended rows keep flowing after this.
            onInitial() {
              set(s => {
                const f = s.files[id]
                if (!f) return s
                return {
                  files: { ...s.files, [id]: { ...f, status: 'ready', fraction: 1, finishedAt: performance.now() } },
                }
              })
            },
            // Post-reset ack: safe to drop pre-rotation rows; refresh displayed size.
            onRotation() {
              void (async () => {
                let rotatedSize = size
                try {
                  rotatedSize = await source.stat()
                } catch {
                  // keep the last known size
                }
                set(s => {
                  const f = s.files[id]
                  if (!f) return s
                  return { files: { ...s.files, [id]: { ...f, entries: [], lines: 0, size: rotatedSize } } }
                })
              })()
            },
            onStopped() {
              set(s => {
                const f = s.files[id]
                if (!f) return s
                return { files: { ...s.files, [id]: { ...f, tail: false } } }
              })
            },
            onError(message) {
              set(s => {
                const f = s.files[id]
                if (!f) return s
                return {
                  files: { ...s.files, [id]: { ...f, status: 'error', error: message, finishedAt: performance.now() } },
                }
              })
            },
          },
          { tzMode: get().tzMode },
        ),
      )
    })()
  },

  removeFile(id) {
    sessions.get(id)?.close()
    sessions.delete(id)
    set(s => {
      const files = { ...s.files }
      delete files[id]
      return { files, activeId: s.activeId === id ? null : s.activeId }
    })
  },

  setActive(id) {
    set({ activeId: id, merged: false })
  },

  setMerged(on) {
    set({ merged: on })
  },

  setText(text) {
    set(s => ({ filters: { ...s.filters, text } }))
  },

  toggleLevel(level) {
    set(s => {
      const has = s.filters.levels.includes(level)
      return {
        filters: {
          ...s.filters,
          levels: has ? s.filters.levels.filter(l => l !== level) : [...s.filters.levels, level],
        },
      }
    })
  },

  clearFilters() {
    set({ filters: EMPTY_FILTERS })
  },

  setFilters(f) {
    set({ filters: f })
  },

  setTzMode(mode) {
    set({ tzMode: mode })
    try {
      localStorage.setItem(TZ_KEY, mode)
    } catch {
      // persistence is best-effort
    }
  },
}))