import { EMPTY_FILTERS, type Filters } from './filters'
import type { SavedFilter } from './filters-db'
import { sanitizeHighlights, type Highlight } from './highlights'
import { sanitizeRules, type Rule } from './rules'
import { LEVELS, type LogLevel } from '../parsers/types'

/**
 * Workspace archive (M4 checkpoint D): the session state — saved filter sets,
 * the working rule set, pinned notes, the active filter, the naive-timestamp
 * mode, and per-file metadata — bundled into one downloadable JSON file that a
 * different browser profile or machine can re-open. Log rows are NEVER
 * included: files are re-opened by the user (the app holds no persistent FSA
 * handles), so the archive only carries what makes the session recognizable.
 */

export const WORKSPACE_FORMAT = 'logviewplus.workspace' as const
export const WORKSPACE_VERSION = 1
/** Keep in sync with the package.json `version`. */
export const APP_VERSION = '0.1.0'

/** Thrown (and surfaced to the user) when an archive file cannot be loaded. */
export class WorkspaceError extends Error {}

export interface WorkspaceFileMeta {
  name: string
  size: number
  lines: number
  entries: number
  status: 'parsing' | 'ready' | 'error'
}

export interface WorkspaceArchive {
  format: typeof WORKSPACE_FORMAT
  version: number
  savedAt: number
  appVersion: string
  settings: { tzMode: 'local' | 'utc' }
  /** The active filter at save time (applied on load). */
  filters: Filters
  savedFilters: SavedFilter[]
  rules: Rule[]
  highlights: Highlight[]
  files: WorkspaceFileMeta[]
}

export interface WorkspaceInput {
  filters: Filters
  tzMode: 'local' | 'utc'
  savedFilters: SavedFilter[]
  rules: Rule[]
  highlights: Highlight[]
  /** Metadata for every open file (rows excluded — see module doc). */
  files: readonly WorkspaceFileMeta[]
}

/** Build a version-1 archive from the current session state (deep-copied). */
export function buildWorkspace(input: WorkspaceInput, savedAt = Date.now()): WorkspaceArchive {
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    savedAt,
    appVersion: APP_VERSION,
    settings: { tzMode: input.tzMode },
    filters: { text: input.filters.text, levels: [...input.filters.levels] },
    savedFilters: input.savedFilters.map(f => ({
      ...f,
      filters: { text: f.filters.text, levels: [...f.filters.levels] },
    })),
    rules: input.rules.map(r => ({ ...r, levels: [...r.levels] })),
    highlights: input.highlights.map(h => ({ ...h })),
    files: input.files.map(f => ({ ...f })),
  }
}

/** Pretty-printed JSON — a workspace archive is meant to be shared by hand. */
export function workspaceToJson(archive: WorkspaceArchive): string {
  return JSON.stringify(archive, null, 2)
}

const LEVEL_SET = new Set<string>(LEVELS as readonly string[])

/** Tolerate corrupt input: bad level entries are dropped, text must be a string. */
function sanitizeFilters(input: unknown): Filters {
  if (typeof input !== 'object' || input === null) return { ...EMPTY_FILTERS }
  const f = input as Record<string, unknown>
  const levels = Array.isArray(f.levels)
    ? (f.levels.filter((l): l is LogLevel => typeof l === 'string' && LEVEL_SET.has(l)) as LogLevel[])
    : []
  return { text: typeof f.text === 'string' ? f.text : '', levels }
}

function sanitizeSavedFilter(input: unknown, fallbackSavedAt: number): SavedFilter | null {
  if (typeof input !== 'object' || input === null) return null
  const f = input as Record<string, unknown>
  if (typeof f.name !== 'string' || f.name.trim() === '') return null
  return {
    name: f.name,
    filters: sanitizeFilters(f.filters),
    savedAt: typeof f.savedAt === 'number' ? f.savedAt : fallbackSavedAt,
  }
}

function sanitizeFileMeta(input: unknown): WorkspaceFileMeta | null {
  if (typeof input !== 'object' || input === null) return null
  const m = input as Record<string, unknown>
  if (typeof m.name !== 'string' || m.name === '') return null
  const num = (v: unknown) => (typeof v === 'number' && v >= 0 ? Math.trunc(v) : 0)
  return {
    name: m.name,
    size: num(m.size),
    lines: num(m.lines),
    entries: num(m.entries),
    status: m.status === 'ready' || m.status === 'error' ? m.status : 'parsing',
  }
}

/**
 * Parse + validate an archive (the already-JSON.parsed value). Throws
 * {@link WorkspaceError} with a human-readable message for a wrong format or
 * an unsupported version; corrupt nested records are dropped/sanitized so one
 * bad entry never blocks the rest of the workspace.
 */
export function parseWorkspace(raw: unknown): WorkspaceArchive {
  if (typeof raw !== 'object' || raw === null) throw new WorkspaceError('Not a workspace archive.')
  const a = raw as Record<string, unknown>
  if (a.format !== WORKSPACE_FORMAT) {
    throw new WorkspaceError(`Not a workspace archive (unknown format ${JSON.stringify(a.format ?? null)}).`)
  }
  const version = typeof a.version === 'number' ? a.version : NaN
  if (version !== WORKSPACE_VERSION) {
    throw new WorkspaceError(
      `Unsupported workspace version ${Number.isFinite(version) ? String(version) : 'unknown'} (this build reads v${WORKSPACE_VERSION}).`,
    )
  }
  const savedAt = typeof a.savedAt === 'number' ? a.savedAt : Date.now()
  const settings = (typeof a.settings === 'object' && a.settings !== null ? a.settings : {}) as Record<
    string,
    unknown
  >
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    savedAt,
    appVersion: typeof a.appVersion === 'string' ? a.appVersion : '',
    settings: { tzMode: settings.tzMode === 'utc' ? 'utc' : 'local' },
    filters: sanitizeFilters(a.filters),
    savedFilters: Array.isArray(a.savedFilters)
      ? a.savedFilters.map(x => sanitizeSavedFilter(x, savedAt)).filter((f): f is SavedFilter => f !== null)
      : [],
    rules: sanitizeRules(a.rules),
    highlights: sanitizeHighlights(a.highlights),
    files: Array.isArray(a.files)
      ? a.files.map(sanitizeFileMeta).filter((m): m is WorkspaceFileMeta => m !== null)
      : [],
  }
}

/**
 * Load-time pin merge: same (file, lineNo) identity → keep the LOCAL id but
 * take the archive note; local-only pins are kept; new pins are appended.
 * (Ids are random and only need to be unique within a profile, so reusing the
 * local id for an updated pin avoids any key change in the grid.)
 */
export function mergeHighlights(local: readonly Highlight[], incoming: readonly Highlight[]): Highlight[] {
  const out = local.map(h => ({ ...h }))
  for (const inc of incoming) {
    const existing = out.find(h => h.file === inc.file && h.lineNo === inc.lineNo)
    if (existing) existing.note = inc.note
    else out.push({ ...inc })
  }
  return out
}
