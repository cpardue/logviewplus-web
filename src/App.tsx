import { useEffect, useMemo, useRef, useState } from 'react'
import { useLogStore } from './store/logStore'
import { applyFilters } from './lib/filters'
import Toolbar from './components/Toolbar'
import FilterBar from './components/FilterBar'
import LogGrid from './components/LogGrid'

const EMPTY_ROWS: never[] = []

export default function App() {
  const files = useLogStore(s => s.files)
  const activeId = useLogStore(s => s.activeId)
  const filters = useLogStore(s => s.filters)
  const addFiles = useLogStore(s => s.addFiles)
  const setActive = useLogStore(s => s.setActive)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const fileIds = Object.keys(files)
  const active = activeId ? files[activeId] : null
  // Grid row data is only handed over once parsing completes (single O(n) model
  // build instead of a full re-diff per streamed batch); toolbar keeps live counts.
  const rows = useMemo(
    () =>
      active && active.status === 'ready' ? applyFilters(active.entries, filters) : EMPTY_ROWS,
    [active, filters],
  )

  // Expose counts for E2E assertions (the row data actually fed to the grid).
  useEffect(() => {
    ;(window as unknown as { __appCounts?: { total: number; visible: number } }).__appCounts = {
      total: active?.entries.length ?? 0,
      visible: rows.length,
    }
  }, [rows, active])

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
        if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
      }}
    >
      <header className="app-header">
        <h1>LogViewPlus Web</h1>
        <div className="file-tabs">
          {fileIds.map(id => (
            <button
              key={id}
              data-testid={`tab-${files[id].name}`}
              className={id === activeId ? 'tab active' : 'tab'}
              onClick={() => setActive(id)}
            >
              {files[id].name}
              {files[id].status === 'parsing' ? ' …' : ''}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => inputRef.current?.click()}>
          Open files…
        </button>
        <input
          ref={inputRef}
          data-testid="file-input"
          type="file"
          multiple
          hidden
          accept=".log,.txt,.out,.json,.csv,.gc,.yml"
          onChange={e => {
            if (e.target.files && e.target.files.length > 0) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </header>
      <Toolbar file={active} />
      <FilterBar />
      <section className="grid-wrap">
        {active ? (
          <LogGrid rows={rows} fileId={active.id} />
        ) : (
          <div className="empty-hint">Drop log files here, or click “Open files…”</div>
        )}
      </section>
    </main>
  )
}
