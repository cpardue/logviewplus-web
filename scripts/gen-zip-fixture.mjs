// One-shot generator for tests/fixtures/logs/packed.zip (committed artifact).
// Usage: node scripts/gen-zip-fixture.mjs   (fflate from node_modules)
import { strToU8, zipSync } from 'fflate'
import { mkdirSync, writeFileSync } from 'node:fs'

const zipped = zipSync({
  'a.log': strToU8(
    [
      '2026-09-01 08:00:01 INFO: alpha started',
      '2026-09-01 08:00:02 WARN: alpha retrying',
      '2026-09-01 08:00:03 ERROR: alpha failed',
    ].join('\n') + '\n',
  ),
  'b.csv': strToU8(
    [
      'timestamp,level,message',
      '2026-09-01 09:00:01,INFO,beta one',
      '2026-09-01 09:00:02,FATAL,beta two',
    ].join('\n') + '\n',
  ),
})

mkdirSync('tests/fixtures/logs', { recursive: true })
writeFileSync('tests/fixtures/logs/packed.zip', zipped)
console.log(`wrote tests/fixtures/logs/packed.zip (${zipped.length} bytes)`)
