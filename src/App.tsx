import { useEffect, useMemo, useRef, useState } from 'react'
import { useLogStore } from './store/logStore'
import { applyFilters } from './lib/filters'
import { pasteFileName, textToFile } from './lib/ingest'
import { isDirSupported } from './lib/dirWatch'
import { isTailSupported } from './lib/tail'
import Toolbar from './components/Toolbar'
import FilterBar from './components/FilterBar'
import ExportBar from './components/ExportBar'
import LogGrid from './components/LogGrid'
import ReportBar from './components/ReportBar'

const EMPTY_ROWS: never[] = []
// Evaluated once per page load — the File System Access API is either there (Chromium) or not.
const TAIL_SUPPORTED = isTailSupported()
const DIR_SUPPORTED = isDirSupported()

export default function App() {
  const files = useLogStore(s => s.files)
  const activeId = useLogStore(s => s.activeId)
  const filters = useLogStore(s => s.filters)
  const merged = useLogStore(s => s.merged)
  const dirName = useLogStore(s => s.dirName)
  const addFiles = useLogStore(s => s.addFiles)
  const startTail = useLogStore(s => s.startTail)
  const startDirMonitor = useLogStore(s => s.startDirMonitor)
  const stopDirMonitor = useLogStore(s => s.stopDirMonitor)
  const setActive = useLogStore(s => s.setActive)
  const setMerged = useLogStore(s => s.setMerged)
  const [dragOver, setDragOver] = useState(false)
  const [view, setView] = useState<'logs' | 'report'>('logs')
  const inputRef = useRef<HTMLInputElement>(null)

  const fileIds = Object.keys(files)
  const active = activeId ? files[activeId] : null
  // Merged view concatenates every ready file (insertion order); entries carry
  // their source name so the grid can show a File column.
  const allEntries = useMemo(
    () => fileIds.flatMap(id => (files[id].status === 'ready' ? files[id].entries : [])),
    [files, fileIds],
  )
  // Grid row data is only handed over once parsing completes (single O(n) model
  // build instead of a full re-diff per streamed batch); toolbar keeps live counts.
  const rows = useMemo(() => {
    if (merged) return allEntries.length > 0 ? applyFilters(allEntries, filters) : EMPTY_ROWS
    return active && active.status === 'ready' ? applyFilters(active.entries, filters) : EMPTY_ROWS
  }, [merged, allEntries, active, filters])
  // Reports run over the raw parsed scope (active file or merged), unfiltered.
  const scopeEntries = useMemo(() => {
    if (merged) return allEntries
    return active && active.status === 'ready' ? active.entries : []
  }, [merged, allEntries, active])

  // Expose counts for E2E assertions (the row data actually fed to the grid).
  useEffect(() => {
    ;(window as unknown as { __appCounts?: { total: number; visible: number } }).__appCounts = {
      total: merged ? allEntries.length : active?.entries.length ?? 0,
      visible: rows.length,
    }
  }, [rows, active, merged, allEntries])

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) addFiles([textToFile(text, pasteFileName())])
    } catch {
      // Clipboard API unavailable (permission/agent) — ignore.
    }
  }

  /** Ask for a file handle (Chromium File System Access API) and tail it. */
  async function pickAndTail() {
    if (!window.showOpenFilePicker) return // non-Chromium — button is hidden anyway
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Log files', accept: { 'text/plain': ['.log', '.txt', '.out'] } }],
        multiple: false,
      })
      startTail(handle)
    } catch {
      // User cancelled the picker (AbortError) — nothing to do.
    }
  }

  /** Ask for a folder handle (Chromium File System Access API) and watch it. */
  async function pickAndWatch() {
    if (!window.showDirectoryPicker) return // non-Chromium — button is hidden anyway
    try {
      const handle = await window.showDirectoryPicker({ id: 'logviewplus', mode: 'read' })
      startDirMonitor(handle)
    } catch {
      // User cancelled the picker (AbortError) — nothing to do.
    }
  }

  return (
    <main
      className={`app${dragOver ? ' drag-over' : ''}`}
      onDragOver={e => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files.length > 0) {
          addFiles(e.dataTransfer.files)
        } else {
          const text = e.dataTransfer.getData('text/plain')
          if (text.trim()) addFiles([textToFile(text, pasteFileName())])
        }
      }}
    >
      <header className="app-header">
        <h1>LogViewPlus Web</h1>
        <div className="file-tabs">
          {fileIds.length >= 2 && (
            <button
              data-testid="tab-all"
              className={merged && view === 'logs' ? 'tab active' : 'tab'}
              onClick={() => {
                setMerged(true)
                setView('logs')
              }}
            >
              All ({fileIds.length})
            </button>
          )}
          {fileIds.map(id => (
            <button
              key={id}
              data-testid={`tab-${files[id].name}`}
              className={!merged && id === activeId && view === 'logs' ? 'tab active' : 'tab'}
              onClick={() => {
                setActive(id)
                setView('logs')
              }}
            >
              {files[id].name}
              {files[id].tail && <span className="tab-tail" title="Live tailing"> ●</span>}
              {files[id].status === 'parsing' ? ' …' : ''}
            </button>
          ))}
          <button
            data-testid="tab-report"
            className={view === 'report' ? 'tab active' : 'tab'}
            onClick={() => setView(v => (v === 'report' ? 'logs' : 'report'))}
          >
            Report
          </button>
        </div>
        <button className="btn" onClick={() => inputRef.current?.click()}>
          Open files…
        </button>
        <button className="btn" data-testid="paste-button" onClick={() => void pasteFromClipboard()}>
          Paste
        </button>
        {TAIL_SUPPORTED && (
          <button className="btn" data-testid="tail-button" onClick={() => void pickAndTail()}>
            Tail live…
          </button>
        )}
        {dirName != null ? (
          <button className="btn" data-testid="dir-stop" onClick={() => stopDirMonitor()}>
            Stop watching {dirName}
          </button>
        ) : DIR_SUPPORTED ? (
          <button className="btn" data-testid="dir-button" onClick={() => void pickAndWatch()}>
            Watch folder…
          </button>
        ) : null}
        {!TAIL_SUPPORTED && !DIR_SUPPORTED && (
          <span className="tail-hint" data-testid="tail-unsupported">
            Live tail &amp; folder watch need Chrome or Edge
          </span>
        )}
        <input
          ref={inputRef}
          data-testid="file-input"
          type="file"
          multiple
          hidden
          accept=".log,.txt,.out,.json,.csv,.gc,.yml,.xml,.zip"
          onChange={e => {
            if (e.target.files && e.target.files.length > 0) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </header>
      {view === 'report' ? (
        <ReportBar entries={scopeEntries} scopeLabel={merged ? 'all files (merged)' : (active?.name ?? 'log')} />
      ) : (
        <>
          {merged ? (
            <div className="toolbar">
              <span className="t-name">All files (merged)</span>
              <span>
                {fileIds.length} file{fileIds.length === 1 ? '' : 's'} · {allEntries.length.toLocaleString()} entries
              </span>
            </div>
          ) : (
            <Toolbar file={active} />
          )}
          <FilterBar />
          <ExportBar rows={rows} label={merged ? 'all-files' : (active?.name ?? 'log')} />
          <section className="grid-wrap">
            {merged || active ? (
              <LogGrid rows={rows} fileId={merged ? 'all' : active!.id} showFile={merged} />
            ) : (
              <div className="empty-hint">Drop log files here, or click “Open files…”</div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
