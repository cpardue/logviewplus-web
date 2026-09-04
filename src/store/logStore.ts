import { create } from 'zustand'
import type { LogEntry, LogLevel } from '../parsers/types'
import { EMPTY_FILTERS, type Filters } from '../lib/filters'
import { startParse, startTail, startDirMonitor as watchDir, type ParseSession } from '../lib/pipeline'
import { FsaDir } from '../lib/dirWatch'
import { HandleSource, type TailSource } from '../lib/tail'
import { ingestZip } from '../lib/ingest'
import { useSqliteStore } from './sqliteStore'
import { loadRules, saveRules } from '../lib/rules-db'
import type { Rule } from '../lib/rules'
import { loadHighlights, saveHighlight, deleteHighlight, replaceHighlights } from '../lib/highlights-db'
import { makeHighlight, type Highlight } from '../lib/highlights'
import { listSavedFilters, saveFilter, type SavedFilter } from '../lib/filters-db'
import { downloadBlob } from '../lib/export'
import {
  WorkspaceError,
  buildWorkspace,
  mergeHighlights,
  parseWorkspace,
  workspaceToJson,
  type WorkspaceArchive,
} from '../lib/workspace'

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
  /** Name of the watched folder (Chromium only); null when not watching. */
  dirName: string | null
  /** Row-coloring rules, ordered by priority (first match wins). Persisted. */
  rules: Rule[]
  /** Pinned rows with notes (exact file + lineNo identity). Persisted. */
  highlights: Highlight[]
  /** Bumped by workspace-archive loads so the FilterBar refreshes its saved sets. */
  savedFiltersVersion: number
  addFiles(list: FileList | File[]): void
  /** Start tail-following a File System Access API handle (Chromium only). */
  startTail(handle: FileSystemFileHandle): void
  /** Watch a folder: accepted top-level files are ingested + tailed (Chromium only). */
  startDirMonitor(handle: FileSystemDirectoryHandle): void
  /** Stop the folder watch; parsed rows stay, live sessions detach. */
  stopDirMonitor(): void
  removeFile(id: string): void
  setActive(id: string | null): void
  setMerged(on: boolean): void
  setText(text: string): void
  toggleLevel(level: LogLevel): void
  clearFilters(): void
  setFilters(f: Filters): void
  setTzMode(mode: 'local' | 'utc'): void
  /** Replace the rule list (persists to IndexedDB). */
  setRules(rules: Rule[]): void
  /** Pin a row with an empty note (no-op when already pinned); persists. */
  pinRow(entry: LogEntry): void
  /** Replace a pin's note text; persists. */
  setHighlightNote(id: string, note: string): void
  /** Remove a pin; persists. */
  unpinRow(id: string): void
  /** Bundle session state into a downloadable workspace archive (checkpoint D). */
  saveWorkspace(): Promise<void>
  /**
   * Restore a workspace archive: rules REPLACED, pins + saved filters MERGED
   * (archive wins on collisions), active filter + tz mode applied. Throws
   * {@link WorkspaceError} with a user-facing message on unreadable/invalid input.
   */
  loadWorkspace(file: File): Promise<void>
}

const sessions = new Map<string, ParseSession>()
let nextId = 1
/** Active folder monitor (null when not watching). */
let dirSession: ParseSession | null = null
/** id → file name for tabs opened by the directory monitor. */
const dirFiles = new Map<string, string>()

/** Binary databases route to the SQLite tab, not the text parser. */
const SQLITE_EXT = /\.(sqlite|db)$/i

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

type StoreSet = (fn: (s: LogState) => Partial<LogState>) => void
type StoreGet = () => LogState

/**
 * Create a FileState and an open-ended tail session for a tailable source;
 * returns the new file id (null when the source is already gone).
 * `activateIfNone` force-switches to the tab (manual "Tail live…" — a live
 * tail is meant to be watched); bulk directory ingest passes false so it only
 * activates when nothing is active and does not yank the view around.
 */
async function beginTail(get: StoreGet, set: StoreSet, source: TailSource, activateIfNone: boolean): Promise<string | null> {
  let size: number
  try {
    size = await source.stat()
  } catch {
    return null // handle already dead — nothing to tail
  }
  if (size < 0) return null
  const id = `f${nextId++}`
  set(s => ({
    files: {
      ...s.files,
      [id]: {
        id,
        name: source.name ?? 'unknown',
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
    activeId: activateIfNone ? id : (s.activeId ?? id),
    merged: activateIfNone ? false : s.merged,
  }))
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
              files: { ...s.files, [id]: { ...f, lines, fraction: f.size > 0 ? Math.min(1, bytes / f.size) : 0 } },
            }
          })
        },
        // Initial read done — usable; appended rows keep flowing after this.
        onInitial() {
          set(s => {
            const f = s.files[id]
            if (!f) return s
            return { files: { ...s.files, [id]: { ...f, status: 'ready', fraction: 1, finishedAt: performance.now() } } }
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
        // File disappeared (deleted/moved): rows stay, badge clears.
        onStopped() {
          detachTail(id, set)
        },
        onError(message) {
          set(s => {
            const f = s.files[id]
            if (!f) return s
            return { files: { ...s.files, [id]: { ...f, status: 'error', error: message, finishedAt: performance.now() } } }
          })
        },
      },
      { tzMode: get().tzMode },
    ),
  )
  return id
}

/**
 * Detach a live tail session while keeping the parsed rows: terminate the
 * worker, clear the tail badge, and flip a file still mid-initial-read to
 * `ready` with its partial content (otherwise it would stay "parsing…"
 * forever — the worker that would finish it is gone).
 */
function detachTail(id: string, set: StoreSet): void {
  sessions.get(id)?.close()
  set(s => {
    const f = s.files[id]
    if (!f) return s
    return {
      files: {
        ...s.files,
        [id]: {
          ...f,
          tail: false,
          status: f.status === 'parsing' ? 'ready' : f.status,
          fraction: 1,
          finishedAt: f.finishedAt ?? performance.now(),
        },
      },
    }
  })
}

export const useLogStore = create<LogState>((set, get) => ({
  files: {},
  activeId: null,
  filters: EMPTY_FILTERS,
  tzMode: readTzMode(),
  merged: false,
  dirName: null,
  rules: [],
  highlights: [],
  /**
   * Bumped when the saved-filter set can have changed from outside FilterBar
   * (a workspace-archive load) so the bar re-reads IndexedDB.
   */
  savedFiltersVersion: 0,

  addFiles(list) {
    void (async () => {
      const all = Array.from(list)
      // .sqlite/.db files are binary databases, not logs — open them in the
      // SQLite tab instead of feeding them to the parser (last one wins when
      // several arrive at once). openFile never rejects; failures land in its
      // error status where the user can see them.
      const sqliteFiles = all.filter(f => SQLITE_EXT.test(f.name))
      for (const f of sqliteFiles) await useSqliteStore.getState().openFile(f)
      const rest = all.filter(f => !SQLITE_EXT.test(f.name))
      if (rest.length === 0) return
      const { files, failures } = await expand(rest)
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
      await beginTail(get, set, new HandleSource(handle), true)
    })()
  },

  startDirMonitor(handle) {
    if (dirSession) return // already watching — the UI hides the button anyway
    set({ dirName: handle.name })
    const source = new FsaDir(handle)
    dirSession = watchDir(
      source,
      {
        onNewFile(entry, open) {
          void (async () => {
            const src = await open()
            if (!src) return // vanished between the directory listing and the open
            const id = await beginTail(get, set, src, false)
            if (id) dirFiles.set(id, entry.name)
          })()
        },
        onRemoved(name) {
          for (const [id, n] of [...dirFiles]) {
            if (n !== name) continue
            dirFiles.delete(id)
            detachTail(id, set)
          }
        },
        // Listing failed (permission revoked, folder moved): stop cleanly —
        // the button comes back and already-parsed rows stay where they are.
        onError: () => {
          get().stopDirMonitor()
        },
      },
      { pollMs: 1000 },
    )
  },

  stopDirMonitor() {
    dirSession?.close()
    dirSession = null
    for (const id of [...dirFiles.keys()]) detachTail(id, set)
    dirFiles.clear()
    if (get().dirName != null) set({ dirName: null })
  },

  removeFile(id) {
    sessions.get(id)?.close()
    sessions.delete(id)
    dirFiles.delete(id)
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

  setRules(rules) {
    set({ rules })
    void saveRules(rules)
      .then(() => {
        // Test hook: E2E waits on this commit marker before reloading the page.
        ;(window as unknown as { __rulesSavedAt?: number }).__rulesSavedAt = Date.now()
      })
      .catch(() => {
        // DB unavailable — rules still apply for this session.
      })
  },

  pinRow(entry) {
    const file = entry.file ?? ''
    if (get().highlights.some(h => h.file === file && h.lineNo === entry.lineNo)) return
    const h = makeHighlight(file, entry.lineNo)
    set(s => ({ highlights: [...s.highlights, h] }))
    void persistHighlight(() => saveHighlight(h))
  },

  setHighlightNote(id, note) {
    const cur = get().highlights.find(x => x.id === id)
    if (!cur || cur.note === note) return
    const next = { ...cur, note }
    set(s => ({ highlights: s.highlights.map(x => (x.id === id ? next : x)) }))
    void persistHighlight(() => saveHighlight(next))
  },

  unpinRow(id) {
    set(s => ({ highlights: s.highlights.filter(x => x.id !== id) }))
    void persistHighlight(() => deleteHighlight(id))
  },

  async saveWorkspace() {
    const st = get()
    let savedFilters: SavedFilter[] = []
    try {
      savedFilters = await listSavedFilters()
    } catch {
      // DB unavailable — export what is in memory (rules/highlights/filters).
    }
    const archive = buildWorkspace({
      filters: st.filters,
      tzMode: st.tzMode,
      savedFilters,
      rules: st.rules,
      highlights: st.highlights,
      files: Object.values(st.files).map(f => ({
        name: f.name,
        size: f.size,
        lines: f.lines,
        entries: f.entries.length,
        status: f.status,
      })),
    })
    downloadBlob(workspaceToJson(archive), 'logviewplus-workspace.json', 'application/json')
  },

  async loadWorkspace(file) {
    let text: string
    try {
      text = await file.text()
    } catch {
      throw new WorkspaceError('Could not read the archive file.')
    }
    let archive: WorkspaceArchive
    try {
      archive = parseWorkspace(JSON.parse(text))
    } catch (err) {
      if (err instanceof WorkspaceError) throw err
      throw new WorkspaceError('Not a valid workspace archive (invalid JSON).')
    }
    // Every write is awaited before the commit marker (E2E waits on it).
    get().setFilters(archive.filters)
    get().setTzMode(archive.settings.tzMode)
    await saveRules(archive.rules) // the working set is a snapshot → replace
    set({ rules: archive.rules })
    for (const f of archive.savedFilters) await saveFilter(f) // upsert by name; archive wins
    const merged = mergeHighlights(get().highlights, archive.highlights)
    await replaceHighlights(merged)
    // FilterBar only re-reads its saved-filter list when this bumps.
    set(s => ({ highlights: merged, savedFiltersVersion: s.savedFiltersVersion + 1 }))
    ;(window as unknown as { __workspaceLoadedAt?: number }).__workspaceLoadedAt = Date.now()
  },
}))

/** Fire-and-forget IDB write with the E2E commit marker; session state never blocks. */
function persistHighlight(write: () => Promise<void>): void {
  void write()
    .then(() => {
      // Test hook: E2E waits on this commit marker before reloading the page.
      ;(window as unknown as { __highlightsSavedAt?: number }).__highlightsSavedAt = Date.now()
    })
    .catch(() => {
      // DB unavailable — pins still apply for this session.
    })
}

// Restore the persisted rule set at startup. IndexedDB is async, so rules may
// arrive after the first render — LogGrid redraws its rows when they land.
void loadRules().then(rules => useLogStore.setState({ rules }))
// Same for pinned notes (grid redraw picks them up on arrival).
void loadHighlights().then(highlights => useLogStore.setState({ highlights }))
