import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMEOUT_MS,
  EMPTY_WEBHOOK,
  MAX_ENTRIES_PER_POST,
  MAX_MESSAGE_CHARS,
  buildEntriesPayload,
  buildTestPayload,
  isArmed,
  postWebhook,
  sanitizeWebhook,
  toWebhookItems,
  webhookMatches,
} from '../../src/lib/webhook'
import type { LogEntry } from '../../src/parsers/types'

function entry(partial: Partial<LogEntry> = {}): LogEntry {
  return { seq: 0, ts: null, level: null, message: '', raw: '', lineNo: 1, ...partial }
}

describe('isArmed', () => {
  it('armed only when a non-blank URL is set', () => {
    expect(isArmed({ ...EMPTY_WEBHOOK, url: 'https://x' })).toBe(true)
    expect(isArmed(EMPTY_WEBHOOK)).toBe(false)
    expect(isArmed({ ...EMPTY_WEBHOOK, url: '   ' })).toBe(false)
  })
})

describe('webhookMatches', () => {
  it('matches everything when all conditions are empty', () => {
    const cfg = { ...EMPTY_WEBHOOK, url: 'https://x' }
    expect(webhookMatches(entry(), cfg)).toBe(true)
    expect(webhookMatches(entry({ level: 'FATAL', file: 'a.log' }), cfg)).toBe(true)
  })

  it('text is a case-insensitive substring on message OR raw', () => {
    const cfg = { ...EMPTY_WEBHOOK, url: 'https://x', text: 'cache' }
    expect(webhookMatches(entry({ message: 'CACHE full' }), cfg)).toBe(true)
    expect(webhookMatches(entry({ message: 'no hit', raw: 'xx Cache xx' }), cfg)).toBe(true)
    expect(webhookMatches(entry({ message: 'nothing', raw: 'nothere' }), cfg)).toBe(false)
  })

  it('levels filter; empty levels = all (including null-level entries)', () => {
    const errOnly = { ...EMPTY_WEBHOOK, url: 'https://x', levels: ['ERROR'] }
    expect(webhookMatches(entry({ level: 'ERROR' }), errOnly)).toBe(true)
    expect(webhookMatches(entry({ level: 'INFO' }), errOnly)).toBe(false)
    expect(webhookMatches(entry({ level: null }), errOnly)).toBe(false)
    expect(webhookMatches(entry({ level: null }), { ...EMPTY_WEBHOOK, url: 'https://x' })).toBe(true)
  })

  it('file is a case-insensitive substring; a missing file never matches a file condition', () => {
    const cfg = { ...EMPTY_WEBHOOK, url: 'https://x', file: 'app.log' }
    expect(webhookMatches(entry({ file: 'MyApp.log.bak' }), cfg)).toBe(true)
    expect(webhookMatches(entry({ file: 'other.txt' }), cfg)).toBe(false)
    expect(webhookMatches(entry(), cfg)).toBe(false)
  })

  it('conditions combine with AND', () => {
    const cfg = { ...EMPTY_WEBHOOK, url: 'https://x', text: 'oom', levels: ['FATAL'] }
    expect(webhookMatches(entry({ level: 'FATAL', message: 'OOM killer' }), cfg)).toBe(true)
    expect(webhookMatches(entry({ level: 'ERROR', message: 'OOM killer' }), cfg)).toBe(false)
    expect(webhookMatches(entry({ level: 'FATAL', message: 'other' }), cfg)).toBe(false)
  })
})

describe('sanitizeWebhook', () => {
  it('passes a well-formed record through', () => {
    const cfg = { url: 'https://x/hook', text: 'boom', file: 'app', levels: ['ERROR', 'FATAL'] }
    expect(sanitizeWebhook(cfg)).toEqual(cfg)
  })

  it('returns an empty (disarmed) config for non-objects', () => {
    expect(sanitizeWebhook(undefined)).toEqual(EMPTY_WEBHOOK)
    expect(sanitizeWebhook(null)).toEqual(EMPTY_WEBHOOK)
    expect(sanitizeWebhook('https://x')).toEqual(EMPTY_WEBHOOK)
    expect(sanitizeWebhook([])).toEqual(EMPTY_WEBHOOK)
  })

  it('keeps only well-formed fields from a corrupt record', () => {
    expect(
      sanitizeWebhook({ url: 42, text: 'ok', file: null, levels: ['ERROR', 'NOPE', 7], extra: true }),
    ).toEqual({ url: '', text: 'ok', file: '', levels: ['ERROR'] })
  })
})

describe('toWebhookItems', () => {
  it('maps entries with ISO timestamps (null when unresolved) and default file', () => {
    const [item] = toWebhookItems([entry({ lineNo: 7, ts: Date.parse('2026-09-04T10:00:00Z'), level: 'WARN' })])
    expect(item).toEqual({
      file: '',
      lineNo: 7,
      timestamp: '2026-09-04T10:00:00.000Z',
      level: 'WARN',
      message: '',
    })
    const [nulled] = toWebhookItems([entry()])
    expect(nulled.timestamp).toBeNull()
  })

  it('caps at MAX_ENTRIES_PER_POST by default (keeps the first N)', () => {
    const rows = Array.from({ length: MAX_ENTRIES_PER_POST + 5 }, (_, i) => entry({ lineNo: i + 1 }))
    const items = toWebhookItems(rows)
    expect(items).toHaveLength(MAX_ENTRIES_PER_POST)
    expect(items[0].lineNo).toBe(1)
  })

  it('truncates long messages with an ellipsis marker', () => {
    const long = 'x'.repeat(MAX_MESSAGE_CHARS + 50)
    const [item] = toWebhookItems([entry({ message: long })])
    expect(item.message).toHaveLength(MAX_MESSAGE_CHARS + 1)
    expect(item.message.endsWith('…')).toBe(true)
  })
})

describe('payload builders', () => {
  it('entries payload carries app id, ISO time and a copy of the items', () => {
    const items = toWebhookItems([entry({ lineNo: 3, message: 'boom' })])
    const p = buildEntriesPayload(items, 1_700_000_000_000)
    expect(p).toEqual({ app: 'logviewplus-web', time: new Date(1_700_000_000_000).toISOString(), entries: items })
    p.entries.push({ file: '', lineNo: 99, timestamp: null, level: null, message: '' })
    expect(items).toHaveLength(1) // builder copies — caller data is not aliased
  })

  it('test payload has the test flag and no entries', () => {
    const p = buildTestPayload(0)
    expect(p.test).toBe(true)
    expect(p.time).toBe(new Date(0).toISOString())
    expect('entries' in p).toBe(false)
  })
})

describe('postWebhook', () => {
  const fakeFetch = (responder: (url: string, init: RequestInit | undefined) => Promise<Response>) =>
    ((url: RequestInfo | URL, init?: RequestInit) => responder(String(url), init)) as unknown as typeof fetch

  it('resolves ok for a 2xx response', async () => {
    const r = await postWebhook('https://x/hook', buildTestPayload(), {
      fetchImpl: fakeFetch(async () => new Response('{}', { status: 200 })),
    })
    expect(r).toEqual({ ok: true, status: 200, error: null })
  })

  it('resolves non-ok (no throw) for other HTTP statuses', async () => {
    const r = await postWebhook('https://x/hook', buildTestPayload(), {
      fetchImpl: fakeFetch(async () => new Response('boom', { status: 500 })),
    })
    expect(r).toEqual({ ok: false, status: 500, error: 'HTTP 500' })
  })

  it('never throws on network/CORS failure — the message lands in error', async () => {
    const r = await postWebhook('https://x/hook', buildTestPayload(), {
      fetchImpl: fakeFetch(async () => {
        throw new TypeError('Failed to fetch')
      }),
    })
    expect(r).toEqual({ ok: false, status: null, error: 'Failed to fetch' })
  })

  it('aborts and reports a timeout when the request is slow', async () => {
    const r = await postWebhook('https://x/hook', buildTestPayload(), {
      timeoutMs: 25,
      fetchImpl: fakeFetch(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          }),
      ),
    })
    expect(r.ok).toBe(false)
    expect(r.status).toBeNull()
    expect(r.error).toContain('timed out')
  })

  it('sends POST JSON with the payload body', async () => {
    let seen: { method?: string; headers: Record<string, string>; body: string } | null = null
    const r = await postWebhook('https://x/hook', buildTestPayload(0), {
      fetchImpl: fakeFetch(async (_url, init) => {
        seen = {
          method: init?.method,
          headers: init?.headers as Record<string, string>,
          body: String(init?.body ?? ''),
        }
        return new Response(null, { status: 204 })
      }),
    })
    expect(r.ok).toBe(true)
    expect(seen?.method).toBe('POST')
    expect(seen?.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(seen!.body)).toEqual(buildTestPayload(0))
  })

  it('has a sensible default timeout', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(5000)
  })
})