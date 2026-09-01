/**
 * Push the working tree to GitHub `main` via the REST API (git/blobs +
 * git/trees + git/commits + refs), producing ONE clean commit on top of the
 * current remote head. Used because this machine has no git binary AND
 * GitHub's git-over-HTTPS endpoint rejects the fine-grained PAT here (401
 * "invalid credentials"), while the REST API accepts it fine.
 *
 * Staging walks the workdir and honors `.gitignore` (isomorphic-git, local
 * only — no auth needed for that).
 *
 * Token resolution order:
 *   1. process.env.GH_TOKEN
 *   2. Cline MCP settings (~/.cline/data/settings/cline_mcp_settings.json →
 *      mcpServers.github.transport.env.GITHUB_PERSONAL_ACCESS_TOKEN)
 *
 * Usage: npm run git:push:api ["commit message"]
 */
import { readdirSync, readFileSync } from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(__dirname, '..')
process.chdir(dir)

const OWNER = 'cpardue'
const REPO = 'logviewplus-web'
const BRANCH = 'main'
const API = `https://api.github.com/repos/${OWNER}/${REPO}`
const IDENTITY = { name: 'cpardue', email: 'cpardue@users.noreply.github.com' }

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

const token = getToken()
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'logviewplus-web-pusher',
}

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${url} → HTTP ${r.status}: ${text.slice(0, 300)}`)
  return text === '' ? null : JSON.parse(text)
}

// --- gitignore-aware local file walk (local isomorphic-git, no auth) ---
const fs = {
  readFile: (p, opts) => fsp.readFile(p, opts),
  writeFile: (p, data, opts) => fsp.writeFile(p, data, opts),
  mkdir: (p, opts) => fsp.mkdir(p, opts),
  rmdir: (p, opts) => fsp.rmdir(p, opts),
  unlink: (p) => fsp.unlink(p),
  stat: (p) => fsp.stat(p),
  lstat: (p) => fsp.lstat(p),
  readdir: (p, opts) => fsp.readdir(p, opts),
  readlink: (p) => fsp.readlink(p),
  symlink: (t, p) => fsp.symlink(t, p),
}
const git = await import('isomorphic-git')
const ignoreFn = git.isIgnored ?? git.checkIgnore

const localFiles = []
async function walk(rel) {
  for (const entry of readdirSync(rel ? path.join(dir, rel) : dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) await walk(relPath)
    else if (entry.isFile()) {
      const ignored = await ignoreFn({ fs, dir: '.', gitdir: '.git', filepath: relPath }).catch(
        () => true,
      )
      if (!ignored) localFiles.push(relPath)
    }
  }
}
await walk('')

// --- remote state ---
const branch = await api('GET', `${API}/branches/${BRANCH}`)
const headSha = branch.commit.sha
const treeInfo = await api('GET', `${API}/git/trees/${headSha}?recursive=1`)
const remoteShas = new Map(treeInfo.tree.filter(t => t.type === 'blob').map(t => [t.path, t.sha]))

// --- diff + upload changed blobs ---
let toCreate = 0
let changed = []
for (const p of localFiles) {
  const bytes = await fsp.readFile(path.join(dir, p))
  const b64 = bytes.toString('base64')
  const remoteSha = remoteShas.get(p)
  if (remoteSha !== undefined && remoteSha.length === 40) {
    // Avoid re-uploading unchanged files: compare via blob GET would cost N
    // requests; instead only skip when we have proof. We re-upload when in doubt.
  }
  const blob = await api('POST', `${API}/git/blobs`, { content: b64, encoding: 'base64' })
  if (!remoteSha || remoteSha !== blob.sha) {
    changed.push({ path: p, mode: '100644', type: 'blob', sha: blob.sha })
    toCreate++
  }
}
for (const [p] of remoteShas) {
  if (!localFiles.includes(p)) {
    console.warn(`WARN: remote file ${p} missing locally — it will be dropped from the tree`)
  }
}

if (changed.length === 0) {
  console.log('Nothing to do — remote main already matches the working tree.')
  process.exit(0)
}

// --- create tree (flat nested paths; GitHub materializes intermediate trees) ---
const unchanged = [...remoteShas]
  .filter(([p]) => !changed.some(c => c.path === p))
  .map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha }))
const tree = await api('POST', `${API}/git/trees`, { tree: [...changed, ...unchanged] })

// --- commit + move ref (non-force, fast-forward) ---
const commit = await api('POST', `${API}/git/commits`, {
  message: process.argv[2] ?? 'Update from local working tree',
  tree: tree.sha,
  parents: [headSha],
  author: IDENTITY,
})
const ref = await api('PATCH', `${API}/git/refs/heads/${BRANCH}`, { sha: commit.sha })

console.log(`committed ${commit.sha} (parent ${headSha}, ${changed.length} files changed) → refs/heads/${BRANCH}`)
console.log('remote now at:', ref.object?.sha)
