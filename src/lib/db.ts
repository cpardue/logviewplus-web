import { openDB, type IDBPDatabase } from 'idb'

/**
 * Single shared IndexedDB handle for the app (version 4). Version 1 created
 * `saved-filters`; version 2 adds `rules`; version 3 adds `highlights`;
 * version 4 adds `webhooks`. The upgrade guards every store so it runs cleanly
 * on a fresh database (0 → 4) and any existing v1/v2/v3 one — opening a
 * *lower* version than the stored one would throw, so all modules must go
 * through this single open.
 */
const DB_NAME = 'logviewplus-web'

let dbPromise: Promise<IDBPDatabase> | null = null

export function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 4, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('saved-filters')) {
          const s = d.createObjectStore('saved-filters', { keyPath: 'name' })
          s.createIndex('savedAt', 'savedAt')
        }
        if (!d.objectStoreNames.contains('rules')) {
          d.createObjectStore('rules', { keyPath: 'id' })
        }
        if (!d.objectStoreNames.contains('highlights')) {
          d.createObjectStore('highlights', { keyPath: 'id' })
        }
        if (!d.objectStoreNames.contains('webhooks')) {
          d.createObjectStore('webhooks', { keyPath: 'id' })
        }
      },
    })
  }
  return dbPromise
}
