// TEMP PROBE: verify live Pages site serves the M1 build (markers in index + JS bundle).
// Retries ~3 min for CDN propagation. Writes _probe_out.txt.
import fsp from 'node:fs/promises'

const BASE = 'https://cpardue.github.io/logviewplus-web/'
const MARKERS = ['Open files', 'level-WARN']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = []

for (let attempt = 1; attempt <= 8; attempt++) {
  const ir = await fetch(BASE, { headers: { 'cache-control': 'no-cache' } })
  if (ir.status === 404) {
    out.push(`attempt ${attempt}: index 404 (propagation?)`)
    await sleep(25_000)
    continue
  }
  const html = await ir.text()
  const srcMatch = html.match(/<script[^>]+src="([^"]+\.js)"/)
  if (ir.status !== 200 || !srcMatch) {
    out.push(`attempt ${attempt}: index status=${ir.status} no-js-src; html head: ${html.slice(0, 200)}`)
    await sleep(25_000)
    continue
  }
  const src = srcMatch[1]
  const abs = src.startsWith('http') ? src : `https://cpardue.github.io/${src.replace(/^\//, '')}`
  const jr = await fetch(abs, { headers: { 'cache-control': 'no-cache' } })
  const js = await jr.text()
  const found = MARKERS.map((m) => `${m}=${js.includes(m)}`)
  out.push(`attempt ${attempt}: index=${ir.status} js=${jr.status} size=${js.length} ${abs}`)
  out.push(`markers: ${found.join(' ')}`)
  if (jr.status === 200 && MARKERS.every((m) => js.includes(m))) {
    out.push('RESULT: SITE LIVE, M1 BUILD CONFIRMED')
  } else {
    out.push('RESULT: NOT YET — old scaffold or propagation in progress')
  }
  break
}

await fsp.writeFile('_probe_out.txt', out.join('\n') + '\n')
console.log('site probe done')
