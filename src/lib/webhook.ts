import { LEVELS, type LogEntry, type LogLevel } from '../parsers/types'

/** One POST carries at most this many matching entries (batches are serialized). */
export const MAX_ENTRIES_PER_POST = 50
/** Messages longer than this are truncated in the payload (keep bodies small). */
export const MAX_MESSAGE_CHARS = 2000
/** Default per-request timeout. */
export const DEFAULT_TIMEOUT_MS = 5000

/**
 * A webhook notification target (M4 checkpoint F). All non-empty conditions
 * must hold (AND) for an entry to be posted — same semantics as
 * {@link ../lib/rules.Rule}: text/file are case-insensitive substrings, empty
 * `levels` means every level (including null-level entries). The hook is ARMED
 * only when a URL is present; an empty URL disables all sending.
 */
export interface WebhookConfig {
  /** Target URL (non-empty after trim = armed). */
  url: string
  /** Case-insensitive substring match on message or raw line (empty = off). */
  text: string
  /** Levels to notify for. Empty = all (including null-level entries). */
  levels: LogLevel[]
  /** Case-insensitive substring match on the source file name (empty = any file). */
  file: string
}

export const EMPTY_WEBHOOK: WebhookConfig = { url: '', text: '', levels: [], file: '' }

/** Armed ⟺ a URL is set. */
export function isArmed(config: WebhookConfig): boolean {
  return config.url.trim() !== ''
}

/** AND of all non-empty conditions; mirrors {@link webhookMatches} callers. */
export function webhookMatches(entry: LogEntry, config: WebhookConfig): boolean {
  if (config.levels.length > 0 && (entry.level == null || !config.levels.includes(entry.level))) {
    return false
  }
  if (config.text !== '') {
    const t = config.text.toLowerCase()
    if (!entry.message.toLowerCase().includes(t) && !entry.raw.toLowerCase().includes(t)) {
      return false
    }
  }
  if (config.file !== '') {
    const f = config.file.toLowerCase()
    if (!(entry.file ?? '').toLowerCase().includes(f)) return false
  }
  return true
}

/** One entry as sent in the payload. */
export interface WebhookItem {
  file: string
  lineNo: number
  /** ISO-8601 timestamp, null when unresolvable. */
  timestamp: string | null
  level: LogLevel | null
  message: string
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** Map entries to payload items, capped (long messages truncated). */
export function toWebhookItems(
  entries: readonly LogEntry[],
  cap: number = MAX_ENTRIES_PER_POST,
): WebhookItem[] {
  return entries.slice(0, cap).map(e => ({
    file: e.file ?? '',
    lineNo: e.lineNo,
    timestamp: e.ts == null ? null : new Date(e.ts).toISOString(),
    level: e.level,
    message: truncate(e.message, MAX_MESSAGE_CHARS),
  }))
}

/** The JSON body POSTed for a batch of matching entries. */
export interface EntriesPayload {
  app: 'logviewplus-web'
  time: string
  entries: WebhookItem[]
}

/** The JSON body POSTed by "Send test". */
export interface TestPayload {
  app: 'logviewplus-web'
  time: string
  test: true
}

export type WebhookPayload = EntriesPayload | TestPayload

export function buildEntriesPayload(
  items: readonly WebhookItem[],
  now: number = Date.now(),
): EntriesPayload {
  return { app: 'logviewplus-web', time: new Date(now).toISOString(), entries: [...items] }
}

export function buildTestPayload(now: number = Date.now()): TestPayload {
  return { app: 'logviewplus-web', time: new Date(now).toISOString(), test: true }
}

/** Outcome of a single POST — failures never throw, they land in `error`. */
export interface WebhookResult {
  ok: boolean
  /** HTTP status when a response was received (null on network/timeout failure). */
  status: number | null
  error: string | null
}

export interface PostOptions {
  timeoutMs?: number
  /** Injectable for unit tests; defaults to the global fetch at call time. */
  fetchImpl?: typeof fetch
}

/**
 * POST a JSON payload to `url` with a per-request timeout. Never throws:
 * network/CORS/timeout failures come back as `{ ok: false, error }` so the
 * caller can surface them in the status line without any unhandled rejection.
 */
export async function postWebhook(
  url: string,
  payload: WebhookPayload,
  opts: PostOptions = {},
): Promise<WebhookResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return { ok: false, status: null, error: 'fetch unavailable in this environment' }
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    return { ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` }
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, status: null, error: `timed out after ${timeoutMs} ms` }
    }
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Tolerate a corrupt or stale IDB record (same policy as sanitizeRules):
 * keep only well-formed fields so a hand-edited/corrupted database can never
 * break the webhook bar.
 */
export function sanitizeWebhook(input: unknown): WebhookConfig {
  if (typeof input !== 'object' || input === null) return { ...EMPTY_WEBHOOK }
  const r = input as Record<string, unknown>
  const levels: LogLevel[] = Array.isArray(r.levels)
    ? r.levels.filter((l): l is LogLevel => typeof l === 'string' && (LEVELS as readonly string[]).includes(l))
    : []
  return {
    url: typeof r.url === 'string' ? r.url : '',
    text: typeof r.text === 'string' ? r.text : '',
    file: typeof r.file === 'string' ? r.file : '',
    levels,
  }
}