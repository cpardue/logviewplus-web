import { openDB, type IDBPDatabase } from 'idb'

/**
 * Single shared IndexedDB handle for the app (version 2). Version 1 created
 * `saved-filters`; version 2 adds `rules`. The upgrade guards every store so
 * it runs cleanly on a fresh database (0 → 2) and an existing v1 one (1 → 2) —
 * opening a *lower* version than the stored one would throw, so all modules
 * must go through this single open.
 */
const DB_NAME = 'logviewplus-web'

let dbPromise: Promise<IDBPDatabase> | null = null

export function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 2, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('saved-filters')) {
          const s = d.createObjectStore('saved-filters', { keyPath: 'name' })
          s.createIndex('savedAt', 'savedAt')
        }
        if (!d.objectStoreNames.contains('rules')) {
          d.createObjectStore('rules', { keyPath: 'id' })
        }
      },
    })
  }
  return dbPromise
}
