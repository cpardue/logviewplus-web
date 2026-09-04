// Deterministic .sqlite fixture for the SQLite-tab e2e specs (checkpoint E).
// Run: npm run gen:sqlite  →  writes tests/fixtures/sqlite/sample.sqlite
//
// Contents (no timestamps/randomness — byte-identical on every run):
//   users(id INTEGER PK AUTOINCREMENT, name TEXT, active INTEGER) — 5 rows.
//     The AUTOINCREMENT side-tables sqlite_master with sqlite_sequence, so the
//     e2e also covers internal sqlite_% table exclusion.
//   orders(id INTEGER PK, user_id INTEGER, amount REAL, note TEXT, payload BLOB)
//     — 8 rows: 5 non-NULL notes / 3 NULLs, 3 small BLOBs (4/6/1 bytes),
//     plus an index on user_id (an sqlite_master non-table row).
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const initSqlJs = require('sql.js')

async function main() {
  const SQL = await initSqlJs({ locateFile: (p) => require.resolve(`sql.js/dist/${p}`) })
  const db = new SQL.Database()
  db.run(`
    CREATE TABLE users (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO users (name, active) VALUES
      ('alice', 1),
      ('bob',   0),
      ('carol', 1),
      ('dave',  1),
      ('erin',  0);

    CREATE TABLE orders (
      id      INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount  REAL,
      note    TEXT,
      payload BLOB
    );
    INSERT INTO orders (user_id, amount, note, payload) VALUES
      (1, 19.99, 'first order', x'01020304'),
      (1,  5.50, NULL,          NULL),
      (2, 42.00, 'repeat',      x'010203040506'),
      (3,  7.25, NULL,          NULL),
      (3, 99.99, 'big one',     NULL),
      (4,  0.10, 'penny order', x'ff'),
      (4,  3.30, NULL,          NULL),
      (5, 12.75, 'last call',   NULL);

    CREATE INDEX idx_orders_user ON orders(user_id);
  `)

  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'sqlite')
  fs.mkdirSync(outDir, { recursive: true })
  const out = path.join(outDir, 'sample.sqlite')
  const bytes = db.export()
  fs.writeFileSync(out, Buffer.from(bytes))
  db.close()

  // Sanity: re-open and confirm the shape the e2e asserts.
  const check = new SQL.Database(bytes)
  const tables = check.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  const userCount = check.exec('SELECT COUNT(*) FROM users')[0].values[0][0]
  const orderCount = check.exec('SELECT COUNT(*) FROM orders')[0].values[0][0]
  check.close()
  if (userCount !== 5 || orderCount !== 8) throw new Error('fixture row counts drifted')
  console.log(`wrote ${path.relative(process.cwd(), out)} (${fs.statSync(out).size} bytes); tables=${JSON.stringify(tables[0].values.flat())}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
