/**
 * Push the working tree to GitHub `main` without a system git binary
 * (this machine has no git/gh CLI). Staging walks the workdir and honors
 * `.gitignore` via isomorphic-git's isIgnored/checkIgnore, so large generated
 * fixtures and node_modules never get committed.
 *
 * Token resolution order:
 *   1. process.env.GH_TOKEN
 *   2. Cline MCP settings (~/.cline/data/settings/cline_mcp_settings.json →
 *      mcpServers.github.transport.env.GITHUB_PERSONAL_ACCESS_TOKEN)
 *
 * Usage: npm run git:push ["commit message"]
 */
import { readdirSync, readFileSync } from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(__dirname, '..')
process.chdir(dir)

const REMOTE_URL = 'https://github.com/cpardue/logviewplus-web.git'
const REF = 'refs/heads/main'

function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  const settingsPath = path.join(
    process.env.USERPROFILE ?? os.homedir(),
    '.cline', 'data', 'settings', 'cline_mcp_settings.json',
  )
  try {
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const t =
      s?.mcpServers?.github?.transport?.env?.GITHUB_PERSONAL_ACCESS_TOKEN ??
      s?.mcpServers?.github?.env?.GITHUB_PERSONAL_ACCESS_TOKEN
    if (t) return t
  } catch {
    // fall through
  }
  throw new Error('No token found. Set GH_TOKEN or put a GitHub PAT in Cline MCP settings.')
}

// --- minimal promise fs adapter (isomorphic-git's 10-command contract) ---
const fs = {
  readFile: (p, opts) => fsp.readFile(p, opts), // must forward {encoding}
  writeFile: (p, data, opts) => fsp.writeFile(p, data, opts),
  mkdir: (p, opts) => fsp.mkdir(p, opts),
  rmdir: (p, opts) => fsp.rmdir(p, opts), // forwards {recursive}
  unlink: (p) => fsp.unlink(p),
  stat: (p) => fsp.stat(p),
  lstat: (p) => fsp.lstat(p),
  readdir: (p, opts) => fsp.readdir(p, opts),
  readlink: (p) => fsp.readlink(p),
  symlink: (target, p) => fsp.symlink(target, p),
}

const git = await import('isomorphic-git')
const { request } = await import('isomorphic-git/http/node')
const http = { request } // HttpClient contract: { request: HttpFetch }
const ignoreFn = git.isIgnored ?? git.checkIgnore
const REPO = { fs, dir: '.', gitdir: '.git' } // v1.41.x requires explicit dir/gitdir

const token = getToken()
const headers = { Authorization: `Bearer ${token}` }

// --- safety: local main must exist; if remote has main it must match (fast-forward) ---
let localSha
try {
  localSha = await git.resolveRef({ ...REPO, ref: 'main' })
} catch {
  throw new Error('Local main missing — refusing to push a fresh orphan history')
}
const info = await git.getRemoteInfo({ http, url: REMOTE_URL, headers })
const remoteSha = info?.refs?.[REF] ?? null
if (remoteSha && remoteSha !== localSha) {
  throw new Error(`Diverged: local main ${localSha} != remote main ${remoteSha}. Resolve manually.`)
}

// --- gitignore-aware staging walk ---
const toStage = []
async function walk(rel) {
  for (const entry of readdirSync(rel ? path.join(dir, rel) : dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await walk(relPath)
    } else if (entry.isFile()) {
      const ignored = await ignoreFn({ ...REPO, filepath: relPath }).catch(() => true)
      if (!ignored) toStage.push(relPath)
    }
  }
}
await walk('')
if (toStage.length === 0) throw new Error('Nothing to stage (all files ignored?)')

await git.add({ ...REPO, filepath: toStage })

const message =
  process.argv[2] ??
  'M1: pattern parser, streaming worker, grid UI, filters, fixtures, tests, perf gate'
const identity = { name: 'cpardue', email: 'cpardue@users.noreply.github.com' }
const commit = await git.commit({ ...REPO, message, author: identity, committer: identity })

// --- push ---
const head = await git.push({ fs, http, dir: '.', gitdir: '.git', url: REMOTE_URL, ref: 'main', headers })

// --- verify tree sanity on the pushed commit ---
const files = await git.listFiles({ ...REPO, ref: commit })
const bad = files.filter(f => /(^|\/)(node_modules|dist|generated)(\/|$)/.test(f))
if (bad.length > 0) throw new Error(`Commit contains ignored paths: ${bad.slice(0, 5).join(', ')}…`)

console.log(`committed ${commit} (${toStage.length} files staged) → pushed to ${REF}`)
console.log(
  `tree files: ${files.length}; fixture logs: ${files.filter(f => f.startsWith('tests/fixtures/logs/')).join(', ')}`,
)
console.log('push result:', JSON.stringify(head))

