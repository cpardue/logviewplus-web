import { db } from './db'
import { sanitizeHighlights, type Highlight } from './highlights'

const STORE = 'highlights'

/** All stored pins (empty when none have been saved yet). */
export async function loadHighlights(): Promise<Highlight[]> {
  const d = await db()
  return sanitizeHighlights(await d.getAll(STORE))
}

/** Upsert one pin (add or replace on its id). */
export async function saveHighlight(h: Highlight): Promise<void> {
  const d = await db()
  await d.put(STORE, h)
}

/** Delete one pin by id. */
export async function deleteHighlight(id: string): Promise<void> {
  const d = await db()
  await d.delete(STORE, id)
}

/**
 * Replace the full pin set in one transaction (workspace-archive load merges
 * into the whole local set; pin counts are small enough that clear+put is
 * cheaper than diffing keys).
 */
export async function replaceHighlights(all: Highlight[]): Promise<void> {
  const d = await db()
  const tx = d.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).clear()
  for (const h of all) tx.objectStore(STORE).put(h)
  await tx.done
}