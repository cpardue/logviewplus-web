import { create } from 'zustand'
import type { LogEntry, LogLevel } from '../parsers/types'
import { EMPTY_FILTERS, type Filters } from '../lib/filters'
import { startParse, type ParseSession } from '../lib/pipeline'

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
  entries: LogEntry[]
  error?: string
}

interface LogState {
  files: Record<string, FileState>
  activeId: string | null
  filters: Filters
  addFiles(list: FileList | File[]): void
  removeFile(id: string): void
  setActive(id: string | null): void
  setText(text: string): void
  toggleLevel(level: LogLevel): void
  clearFilters(): void
}

const sessions = new Map<string, ParseSession>()
let nextId = 1

export const useLogStore = create<LogState>(set => ({
  files: {},
  activeId: null,
  filters: EMPTY_FILTERS,

  addFiles(list) {
    for (const file of Array.from(list)) {
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
        startParse(file, {
          onRows(rows) {
            set(s => {
              const f = s.files[id]
              if (!f || f.status === 'error') return s
              return { files: { ...s.files, [id]: { ...f, entries: [...f.entries, ...rows] } } }
            })
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
        }),
      )
    }
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
    set({ activeId: id })
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
}))
