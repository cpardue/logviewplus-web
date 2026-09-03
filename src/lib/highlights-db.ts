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