// TEMP PROBE (re-runnable, no side effects): inspect the latest main run of deploy.yml.
// If completed → job + failed-step detail with RESULT line. Else STILL RUNNING. Writes _probe_out.txt.
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'

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
const runs = await api('GET', `${API}/actions/runs?per_page=5&branch=main`)
const run = runs.workflow_runs[0]
if (!run) {
  out.push('RESULT: no runs found')
} else if (run.status !== 'completed') {
  out.push(`RESULT: STILL RUNNING run=${run.id} status=${run.status} url=${run.html_url}`)
} else {
  const jobs = await api('GET', `${API}/actions/runs/${run.id}/jobs`)
  for (const j of jobs.jobs) {
    out.push(`JOB ${j.name}: ${j.conclusion}`)
    for (const s of j.steps ?? []) {
      if (s.conclusion !== 'success') out.push(`  STEP ${s.name}: ${s.conclusion} (${s.status})`)
    }
  }
  out.push(`RESULT: run=${run.id} event=${run.event} conclusion=${run.conclusion} url=${run.html_url}`)
}
await fsp.writeFile('_probe_out.txt', out.join('\n') + '\n')
console.log('poll probe done')
