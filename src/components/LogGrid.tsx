import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CommunityFeaturesModule,
  GridCoreModule,
  ModuleRegistry,
} from '@ag-grid-community/core'
import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
import { AgGridReact } from '@ag-grid-community/react'
import type { ColDef, GridApi, GridReadyEvent } from '@ag-grid-community/core'
// AG Grid v32 modular builds ship no CSS of their own — without these the grid
// has no theme: broken row heights AND a non-functional scroll/virtualization
// (wheel + ensureIndexVisible are no-ops). Import at module load so styles are
// present before the first grid initialises.
import '@ag-grid-community/styles/ag-grid.css'
import '@ag-grid-community/styles/ag-theme-alpine.css'
import type { LogEntry } from '../parsers/types'
import { resolveRowColor, type Rule } from '../lib/rules'
import { HIGHLIGHT_ACCENT, highlightFor, type Highlight } from '../lib/highlights'

// Modules register once per page load (module code executes a single time).
ModuleRegistry.registerModules([GridCoreModule, CommunityFeaturesModule, ClientSideRowModelModule])

const ROW_STYLES: Record<string, string> = {
  TRACE: 'rgba(158,158,158,0.10)',
  DEBUG: 'rgba(102,187,106,0.10)',
  INFO: '',
  WARN: 'rgba(255,152,0,0.16)',
  ERROR: 'rgba(244,67,54,0.18)',
  FATAL: 'rgba(183,28,28,0.42)',
}

const BASE_COLUMNS: ColDef<LogEntry>[] = [
  {
    headerName: 'Time',
    field: 'ts',
    width: 205,
    valueFormatter: p => (p.value == null ? '' : new Date(p.value as number).toISOString()),
  },
  {
    headerName: 'Level',
    field: 'level',
    width: 90,
    cellClass: p => `lvl-${(p.value as string | null) ?? 'none'}`,
    valueFormatter: p => (p.value as string | null) ?? '–',
  },
  { headerName: 'Message', field: 'message', flex: 1 },
]

const FILE_COLUMN: ColDef<LogEntry> = { headerName: 'File', field: 'file', width: 180 }

interface Props {
  rows: LogEntry[]
  fileId: string
  /** Show the source-file column (merged view). */
  showFile?: boolean
  /** Row-coloring rules (first match wins); override built-in level tints. */
  rules: Rule[]
  /** Pinned rows with notes (exact file + lineNo identity). */
  highlights: Highlight[]
  /** Right-click a row → pin it with an empty note (NotesBar). */
  onPinRow(entry: LogEntry): void
  /** Remove a pin by id. */
  onUnpinRow(id: string): void
}

export default function LogGrid({ rows, fileId, showFile = false, rules, highlights, onPinRow, onUnpinRow }: Props) {
  const apiRef = useRef<GridApi<LogEntry> | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  /** Open row context menu (null = closed). Coordinates are viewport-relative. */
  const [menu, setMenu] = useState<{ x: number; y: number; entry: LogEntry } | null>(null)
  const columns = useMemo(
    () => (showFile ? [FILE_COLUMN, ...BASE_COLUMNS] : BASE_COLUMNS),
    [showFile],
  )

  // Expose the grid API for E2E assertions (row counts after virtualization).
  useEffect(() => {
    if (apiRef.current) {
      ;(window as unknown as { __gridApi?: GridApi }).__gridApi = apiRef.current
    }
  }, [rows])

  // Row styles are cached per row node — force a (visible-only, virtualized)
  // re-render when rules or pins change so already-shown rows pick it up.
  useEffect(() => {
    apiRef.current?.redrawRows()
  }, [rules, highlights])

  // Suppress the browser's native context menu over rows (capture phase runs
  // before the grid's own listener). AG Grid v32 moved its built-in menu UI to
  // @ag-grid-enterprise/menu (this app is Community-only), so the mapping from
  // clicked row → model entry happens via the onCellContextMenu grid option
  // below, which carries the RowNode — robust under virtualization, where only
  // a window of rows is in the DOM.
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    function onContextMenu(e: MouseEvent) {
      if ((e.target as HTMLElement | null)?.closest('.ag-row')) e.preventDefault()
    }
    el.addEventListener('contextmenu', onContextMenu, true)
    return () => el.removeEventListener('contextmenu', onContextMenu, true)
  }, [])

  // Close the menu on Escape or grid scrolling (a fixed menu would be stranded).
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    const onWheel = () => setMenu(null)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [menu])

  const menuPin = menu ? highlightFor(highlights, menu.entry) : null

  return (
    <div className="grid ag-theme-alpine-dark" ref={hostRef}>
      <AgGridReact<LogEntry>
        columnDefs={columns}
        rowData={rows}
        getRowId={p => `${p.data.file ?? fileId}-${p.data.lineNo}`}
        getRowStyle={p => {
          if (!p.data) return undefined
          // User rules take precedence over the built-in level tints.
          const bg = resolveRowColor(rules, p.data) ?? ROW_STYLES[p.data.level ?? '']
          const style: Record<string, string> = {}
          if (bg) style.backgroundColor = bg
          // A pin adds a left accent bar (independent of rule/level colors).
          if (highlightFor(highlights, p.data)) {
            style.boxShadow = `inset 3px 0 0 ${HIGHLIGHT_ACCENT}`
          }
          return Object.keys(style).length > 0 ? style : undefined
        }}
        onCellContextMenu={e => {
          const entry = e.data
          const me = e.event as MouseEvent | null
          if (!entry || !me) return // header/empty area → no custom menu
          setMenu({
            x: Math.min(me.clientX, window.innerWidth - 170),
            y: Math.min(me.clientY, window.innerHeight - 70),
            entry,
          })
        }}
        onGridReady={(e: GridReadyEvent<LogEntry>) => {
          apiRef.current = e.api
          ;(window as unknown as { __gridApi?: GridApi }).__gridApi = e.api
        }}
      />
      {menu && (
        <>
          <div className="ctx-backdrop" onMouseDown={() => setMenu(null)} />
          <div className="ctx-menu" data-testid="ctx-menu" style={{ left: menu.x, top: menu.y }} role="menu">
            {menuPin ? (
              <button
                className="ctx-item"
                data-testid="ctx-unpin"
                onClick={() => {
                  onUnpinRow(menuPin.id)
                  setMenu(null)
                }}
              >
                Remove note
              </button>
            ) : (
              <button
                className="ctx-item"
                data-testid="ctx-pin"
                onClick={() => {
                  onPinRow(menu.entry)
                  setMenu(null)
                }}
              >
                Add note…
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
