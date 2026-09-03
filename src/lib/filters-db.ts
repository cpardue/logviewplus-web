import { db } from './db'
import type { Filters } from './filters'

export interface SavedFilter {
  name: string
  filters: Filters
  savedAt: number
}

const STORE = 'saved-filters'

/** All saved filter sets, newest first. */
export async function listSavedFilters(): Promise<SavedFilter[]> {
  const d = await db()
  const all = (await d.getAll(STORE)) as SavedFilter[]
  return all.sort((a, b) => b.savedAt - a.savedAt)
}

/** Create or replace a saved filter set by name. */
export async function saveFilter(f: SavedFilter): Promise<void> {
  const d = await db()
  await d.put(STORE, f)
}

export async function deleteFilter(name: string): Promise<void> {
  const d = await db()
  await d.delete(STORE, name)
}