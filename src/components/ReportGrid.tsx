import { useMemo } from 'react'
import { CommunityFeaturesModule, GridCoreModule, ModuleRegistry } from '@ag-grid-community/core'
import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
import { AgGridReact } from '@ag-grid-community/react'
import type { ColDef } from '@ag-grid-community/core'
import type { CellValue } from '../lib/sql/result'

// Modules register once per page load; LogGrid.tsx already does this, and the
// module cache makes a second registration a no-op — but keep the list here so
// this file is self-contained.
ModuleRegistry.registerModules([GridCoreModule, CommunityFeaturesModule, ClientSideRowModelModule])

type Row = Record<string, CellValue>

interface Props {
  columns: string[]
  rows: CellValue[][]
}

/** Virtualized grid for arbitrary query results (AG Grid client-side model). */
export default function ReportGrid({ columns, rows }: Props) {
  const rowData = useMemo<Row[]>(
    () => rows.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i]]))),
    [columns, rows],
  )
  const colDefs = useMemo<ColDef<Row>[]>(() => {
    const defs: ColDef<Row>[] = columns.map(c => ({ headerName: c, field: c, width: 180 }))
    if (defs.length > 0) defs[0].flex = 1
    return defs
  }, [columns])

  return (
    <div className="grid ag-theme-alpine-dark">
      <AgGridReact<Row>
        columnDefs={colDefs}
        rowData={rowData}
        defaultColDef={{ resizable: true }}
      />
    </div>
  )
}
