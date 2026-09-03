import type { GridApi } from '@ag-grid-community/core'
import type { LogEntry } from '../parsers/types'

/**
 * Scroll the pinned row into the active log grid and flash it. Best effort:
 * returns false (no-op) when there is no grid or the row is not in the
 * currently shown model — e.g. the source file is closed or filtered out.
 * Uses the same `window.__gridApi` handle the grid exposes for E2E. The pin's
 * (file, lineNo) maps to LogGrid's getRowId (`${file}-${lineNo}`), so the row
 * is found by identity — under virtualization only a window of rows is in the
 * DOM, and ensureIndexVisible renders + scrolls the target through AG Grid's
 * body-scroll feature.
 */
export function jumpToRow(file: string, lineNo: number): boolean {
  const api = (window as unknown as { __gridApi?: GridApi<LogEntry> }).__gridApi
  if (!api) return false
  const found: { index: number | null } = { index: null }
  try {
    api.forEachNode(node => {
      if (found.index !== null || !node.data) return
      if ((node.data.file ?? '') === file && node.data.lineNo === lineNo) {
        found.index = node.rowIndex
        ;(node as unknown as { setHighlighted?: (p: string | null) => void }).setHighlighted?.('center')
      }
    })
  } catch {
    return false // grid mid-transition — ignore
  }
  if (found.index === null) return false
  try {
    api.ensureIndexVisible(found.index, 'middle')
  } catch {
    // best effort
  }
  return true
}