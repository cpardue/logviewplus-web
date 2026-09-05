/**
 * Deterministic large-log generator (matches the default `%d %l: %m` template).
 * Usage: node scripts/gen-large.ts <MB> [outPath]
 * Seed is fixed → output for a given size is reproducible.
 */
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MESSAGES = [
  'Request processed (id={id}) status=200 latency={n}ms',
  'Cache miss for key user:{id}, fetched from db in {n}ms',
  'Connection pool stats: active={a} idle={b} waiters={c}',
  'Scheduled task heartbeat ok (drift={n}ms)',
  'User session refreshed (user=u{id})',
  'Retry succeeded on attempt {a}/{b} for upstream svc-{id}',
  'Metrics flushed to sink (batch={n} points)',
  'Config hot-reload applied ({n} keys changed)',
  'Query executed in {n}ms: SELECT * FROM events WHERE ts > ? LIMIT {id}',
  'WebSocket frame relayed (bytes={n})',
]

// Level weights: mostly INFO, some DEBUG/WARN, few ERROR, rare TRACE/FATAL.
const LEVEL_TABLE = [
  ['INFO', 55],
  ['DEBUG', 20],
  ['TRACE', 5],
  ['WARN', 12],
  ['ERROR', 6],
  ['FATAL', 2],
] as const

function pickLevel(r: number): string {
  let acc = 0
  for (const [lvl, w] of LEVEL_TABLE) {
    acc += w
    if (r * 100 < acc) return lvl
  }
  return 'INFO'
}

const mbArg = Number(process.argv[2] ?? '10')
const target = process.argv[3] ?? `tests/fixtures/logs/generated/app-${mbArg}MB.log`
if (!Number.isFinite(mbArg) || mbArg <= 0) {
  console.error('Usage: node scripts/gen-large.ts <MB> [outPath]')
  process.exit(1)
}
const targetBytes = Math.floor(mbArg * 1024 * 1024)

const rnd = mulberry32(42)
let ms = Date.UTC(2026, 8, 1, 8, 0, 0)
let size = 0
let i = 0
// Chunked writes: a single ~1 GB joined string would hit V8's max string
// length (~512 MB). Flush once the buffer passes FLUSH_BYTES so memory stays
// flat and any fixture size works. Output bytes are identical to the old
// single writeFileSync (same line sequence, same seed).
const FLUSH_BYTES = 4 * 1024 * 1024

mkdirSync(dirname(target), { recursive: true })
const fd = openSync(target, 'w')
let buf = ''

while (size < targetBytes) {
  const lvl = pickLevel(rnd())
  const msg = MESSAGES[i % MESSAGES.length]
    .replaceAll('{id}', String(1000 + (i % 500)))
    .replaceAll('{n}', String(1 + Math.floor(rnd() * 2000)))
    .replaceAll('{a}', String(1 + Math.floor(rnd() * 8)))
    .replaceAll('{b}', String(9 + Math.floor(rnd() * 10)))
    .replaceAll('{c}', String(Math.floor(rnd() * 3)))
  const d = new Date(ms)
  const line = `${d.toISOString().slice(0, 19).replace('T', ' ')} ${lvl}: ${msg}\n`
  buf += line
  if (buf.length >= FLUSH_BYTES) {
    writeSync(fd, buf, 'utf8')
    buf = ''
  }
  size += Buffer.byteLength(line, 'utf8')
  ms += 7 + Math.floor(rnd() * 400)
  i++
}
writeSync(fd, buf, 'utf8')
closeSync(fd)
console.log(`wrote ${target}: ${(size / 1048576).toFixed(2)} MB, ${i} lines`)
