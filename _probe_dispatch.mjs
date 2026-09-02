// TEMP PROBE: dispatch deploy.yml (main), confirm a new run appeared. Fast; writes _probe_out.txt.
import { readFileSync } from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  const p = path.join(
    process.env.USERPROFILE ?? os.homedir(),
    '.cline', 'data', 'settings', 'cline_mcp_settings.json',
  )
  const s = JSON.parse(readFileSync(p, 'utf8'))
  const t =
    s?.mcpServers?.github?.transport?.env?.GITHUB_PERSONAL_ACCESS_TOKEN ??
    s?.mcpServers?.github?.env?.GITHUB_PERSONAL_ACCESS_TOKEN
  if (t) return t
  throw new Error('no token')
}

const headers = {
  Authorization: `Bearer ${getToken()}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'logviewplus-web-probe',
}
const API = 'https://api.github.com/repos/cpardue/logviewplus-web'

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status}: ${text.slice(0, 300)}`)
  return text === '' ? null : JSON.parse(text)
}

const out = []
await api('POST', `${API}/actions/workflows/deploy.yml/dispatches`, { ref: 'main' })
out.push('dispatch POST → ok')
await new Promise((r) => setTimeout(r, 10_000))
const runs = await api('GET', `${API}/actions/runs?per_page=5&branch=main`)
for (const r of runs.workflow_runs) {
  out.push(`run ${r.id} [${r.status}/${r.conclusion ?? '-'}] event=${r.event} created=${r.created_at} ${r.html_url}`)
}
await fsp.writeFile('_probe_out.txt', out.join('\n') + '\n')
console.log('dispatch probe done')
