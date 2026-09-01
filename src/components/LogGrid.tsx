import { useEffect, useRef } from 'react'
import {
  CommunityFeaturesModule,
  GridCoreModule,
  ModuleRegistry,
} from '@ag-grid-community/core'
import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
import { AgGridReact } from '@ag-grid-community/react'
import type { ColDef, GridApi, GridReadyEvent } from '@ag-grid-community/core'
import type { LogEntry } from '../parsers/types'

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

const columns: ColDef<LogEntry>[] = [
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

interface Props {
  rows: LogEntry[]
  fileId: string
}

export default function LogGrid({ rows, fileId }: Props) {
  const apiRef = useRef<GridApi<LogEntry> | null>(null)

  // Expose the grid API for E2E assertions (row counts after virtualization).
  useEffect(() => {
    if (apiRef.current) {
      ;(window as unknown as { __gridApi?: GridApi }).__gridApi = apiRef.current
    }
  }, [rows])

  return (
    <div className="grid">
      <AgGridReact<LogEntry>
        columnDefs={columns}
        rowData={rows}
        getRowId={p => `${fileId}-${p.data.lineNo}`}
        getRowStyle={p => {
          const bg = p.data ? ROW_STYLES[p.data.level ?? ''] : ''
          return bg ? { backgroundColor: bg } : undefined
        }}
        onGridReady={(e: GridReadyEvent<LogEntry>) => {
          apiRef.current = e.api
          ;(window as unknown as { __gridApi?: GridApi }).__gridApi = e.api
        }}
      />
    </div>
  )
}
