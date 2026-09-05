import { DEFAULT_CHUNK, readByteChunks } from './fileSource'
import { resolveFromBlob, resolveFromSample, SAMPLE_BYTES, type EncodingChoice, type EncodingResolution } from './encoding'
import { detectFormat } from '../parsers/detect'
import { DirFeed, type DirEntry, type DirSource } from './dirWatch'
import { TailFeed, type TailSource } from './tail'
import type { LogEntry, ParserSpec } from '../parsers/types'

export interface ParseCallbacks {
  /** The file's encoding was resolved (BOM + sample or user override). */
  onEncoding?(enc: EncodingResolution): void
  onRows(rows: LogEntry[]): void
  onProgress(lines: number, entries: number, bytes: number): void
  onDone(lines: number, entries: number): void
  onError(message: string): void
}

export interface ParseSession {
  close(): void
}

export interface ParseOptions {
  /** How zone-less timestamps are interpreted while parsing this file. */
  tzMode?: 'local' | 'utc'
  /** File encoding: 'auto' (default) detects BOM + content sample. */
  encoding?: EncodingChoice
}

/**
 * Orchestrate one file: parser autodetect from the first chunk, transfer
 * 1 MiB byte chunks into a parse worker (decode + line splitting happen in
 * the worker — M5-B), route results back via callbacks.
 */
export function startParse(file: File, callbacks: ParseCallbacks, opts: ParseOptions = {}): ParseSession {
  const worker = new Worker(new URL('../workers/parser.worker.ts', import.meta.url), {
    type: 'module',
  })
  let closed = false
  let inited = false

  worker.onmessage = (ev: MessageEvent) => {
    if (closed) return
    const msg = ev.data as
      | { type: 'rows'; rows: LogEntry[] }
      | { type: 'progress'; lines: number; entries: number; bytes: number }
      | { type: 'done'; lines: number; entries: number }
    switch (msg.type) {
      case 'rows':
        callbacks.onRows(msg.rows)
        break
      case 'progress':
        callbacks.onProgress(msg.lines, msg.entries, msg.bytes)
        break
      case 'done':
        callbacks.onDone(msg.lines, msg.entries)
        worker.terminate()
        break
    }
  }
  worker.onerror = (e) => {
    if (closed) return
    closed = true
    callbacks.onError(e.message || 'Parser worker crashed')
  }

  void (async () => {
    const resolution = await resolveFromBlob(file, opts.encoding ?? 'auto')
    if (closed) return
    callbacks.onEncoding?.(resolution)
    // The leading chunk is decoded on main ONCE for parser autodetect (the
    // same first-200-lines window as before); the worker re-decodes every
    // byte itself from the transferred buffers.
    const probe = new TextDecoder(resolution.label, { fatal: false })
    for await (const { buf, isLast } of readByteChunks(file, DEFAULT_CHUNK, resolution.bomLength)) {
      if (closed) return
      if (!inited) {
        const sampleText = probe.decode(new Uint8Array(buf), { stream: true })
        const spec: ParserSpec = detectFormat(sampleText.split('\n').slice(0, 200))
        worker.postMessage({ type: 'init', spec, fileName: file.name, tzMode: opts.tzMode, encoding: resolution.label })
        inited = true
      }
      // `stream: false` on the final chunk flushes any trailing partial
      // decode sequence (matches the old main-thread decoder semantics).
      worker.postMessage({ type: 'chunk', buf, stream: !isLast }, [buf])
    }
    if (!closed && inited) worker.postMessage({ type: 'finish' })
  })().catch(err => {
    if (!closed) callbacks.onError(String(err))
  })

  return {
    close() {
      closed = true
      worker.terminate()
    },
  }
}


export interface TailCallbacks {
  /** The file's encoding was resolved (BOM + sample or user override). */
  onEncoding?(enc: EncodingResolution): void
  onRows(rows: LogEntry[]): void
  onProgress(lines: number, entries: number, bytes: number): void
  /** Initial full-file read complete — the file is usable; tailing continues. */
  onInitial(): void
  /**
   * Rotation committed (worker reset acked). All pre-rotation messages have
   * already been delivered, so stored rows for the file may be cleared now.
   */
  onRotation(): void
  /** The tailed file disappeared (deleted/moved); existing rows stay. */
  onStopped?: () => void
  onError(message: string): void
}

export interface TailOptions extends ParseOptions {
  /** Poll interval in ms (default 1000). */
  pollMs?: number
}

/**
 * Tail a live file: read the current content in 1 MiB chunks through one
 * persistent parse worker (spec autodetected from the first chunk, NO
 * `finish` — the engine stays open so line/seq counters keep running), then
 * poll for growth. Growth bytes are transferred to the worker, which decodes
 * them with ONE persistent streaming decoder (always `stream: true` — the
 * file may keep growing) under the resolved encoding (leading sample; user
 * override wins). On rotation (file shrank) the worker engine AND decoder are
 * reset (epoch bump) and the file re-read from byte 0. Returns a
 * {@link ParseSession}; `close()` stops polling and terminates the worker.
 */
export function startTail(source: TailSource, callbacks: TailCallbacks, opts: TailOptions = {}): ParseSession {
  const worker = new Worker(new URL('../workers/parser.worker.ts', import.meta.url), {
    type: 'module',
  })
  let closed = false
  let inited = false
  let initialDone = false
  let busy = false
  let stopped = false
  let resetAck: (() => void) | null = null
  /** Created once the leading sample resolves the file's encoding. */
  let feed: TailFeed | null = null
  /** Resolved decoder label for init (set together with `feed`). */
  let encLabel: string | null = null
  let timer: number | null = null
  const pollMs = opts.pollMs ?? 1000

  worker.onmessage = (ev: MessageEvent) => {
    if (closed) return
    const msg = ev.data as
      | { type: 'rows'; rows: LogEntry[]; epoch: number }
      | { type: 'progress'; lines: number; entries: number; bytes: number; epoch: number }
      | { type: 'resetAck'; epoch: number }
    switch (msg.type) {
      case 'rows':
        callbacks.onRows(msg.rows)
        break
      case 'progress':
        callbacks.onProgress(msg.lines, msg.entries, msg.bytes)
        break
      case 'resetAck':
        resetAck?.()
        resetAck = null
        break
    }
  }
  worker.onerror = (e) => {
    if (closed) return
    closed = true
    callbacks.onError(e.message || 'Parser worker crashed')
  }

  async function handleRotation(f: TailFeed): Promise<void> {
    // Rewind the byte feed before asking the worker to reset; onRotation()
    // runs only after the ack, at which point every pre-reset rows/progress
    // message has already been delivered (FIFO) — clearing stored rows then
    // cannot lose or duplicate entries.
    f.reset()
    if (!inited) return
    await new Promise<void>(resolve => {
      resetAck = resolve
      worker.postMessage({ type: 'reset' })
    })
    callbacks.onRotation()
  }

  /** One pump: consume up to the current file size, then wait for the next poll. */
  async function pump(): Promise<void> {
    const f = feed
    if (!f || closed || busy || stopped) return
    busy = true
    try {
      for (;;) {
        const step = await f.next(DEFAULT_CHUNK)
        switch (step.kind) {
          case 'none':
            if (!initialDone) {
              initialDone = true
              // Fires even when `inited` is false (the file started empty —
              // no chunk to autodetect from); later growth still feeds, and a
              // first non-empty chunk inits the engine on that occasion.
              callbacks.onInitial()
            }
            return
          case 'removed':
            stopped = true
            if (!inited) callbacks.onError('Tailed file disappeared before it could be read')
            else callbacks.onStopped?.()
            return
          case 'rotate':
            await handleRotation(f)
            // Loop again: re-read the (new) content from byte 0.
            break
          case 'bytes': {
            const { buf } = step
            if (!inited) {
              // The leading chunk is decoded on main ONCE for parser
              // autodetect (same first-200-lines window as before); the
              // worker re-decodes every byte from the transferred buffers.
              const sampleText = new TextDecoder(encLabel ?? 'utf-8', { fatal: false }).decode(
                new Uint8Array(buf),
                { stream: true },
              )
              const spec: ParserSpec = detectFormat(sampleText.split('\n').slice(0, 200))
              worker.postMessage({ type: 'init', spec, fileName: source.name, tzMode: opts.tzMode, encoding: encLabel ?? 'utf-8' })
              inited = true
            }
            if (buf.byteLength > 0) worker.postMessage({ type: 'chunk', buf, stream: true }, [buf])
            break
          }
        }
      }
    } catch (err) {
      if (!closed && !stopped) callbacks.onError(String(err))
    } finally {
      busy = false
    }
  }

  // Resolve the encoding from a leading sample BEFORE the first pump so the
  // whole session (initial read, every growth poll, post-rotation re-read)
  // decodes with one label; the feed is created only once that is known.
  void (async () => {
    let sampleSize: number
    try {
      sampleSize = await source.stat()
    } catch {
      return // handle already dead — the first poll would report it anyway
    }
    if (closed) return
    if (sampleSize < 0) {
      stopped = true
      callbacks.onError('Tailed file disappeared before it could be read')
      return
    }
    const sample =
      sampleSize === 0
        ? new Uint8Array(0)
        : new Uint8Array(await source.slice(0, Math.min(sampleSize, SAMPLE_BYTES)))
    if (closed) return
    const resolution = resolveFromSample(sample, opts.encoding ?? 'auto')
    callbacks.onEncoding?.(resolution)
    feed = new TailFeed(source, resolution)
    encLabel = resolution.label
    void pump()
    timer = window.setInterval(() => void pump(), pollMs)
  })().catch(err => {
    if (!closed && !stopped) callbacks.onError(String(err))
  })

  return {
    close() {
      closed = true
      stopped = true
      if (timer != null) window.clearInterval(timer)
      worker.terminate()
    },
  }
}

/** Extensions a directory monitor ingests by default (mirrors the file input). */
export const DEFAULT_DIR_ACCEPT = ['.log', '.txt', '.out', '.json', '.csv', '.gc', '.yml', '.xml']

export interface DirMonitorCallbacks {
  /** A top-level file appeared (initial scan or added later). */
  onNewFile(entry: DirEntry, open: () => Promise<TailSource | null>): void
  /** A monitored file disappeared; the caller should detach its tail session. */
  onRemoved(name: string): void
  /** The directory listing failed (permission revoked, folder moved) — the monitor stops. */
  onError(message: string): void
}

export interface DirMonitorOptions {
  /** Poll interval in ms (default 1000). */
  pollMs?: number
  /** Dot-prefixed extensions to ingest, case-insensitive. */
  accept?: string[]
}

function hasAcceptedName(name: string, accept: string[]): boolean {
  const lower = name.toLowerCase()
  return accept.some(ext => lower.endsWith(ext))
}

/**
 * Watch a directory: the initial scan emits every accepted top-level file,
 * then polls for membership changes (added → emit, removed → notify).
 * Per-file growth/rotation is NOT handled here — each ingested file is tailed
 * by its own session and sees byte-level changes on its own poll.
 */
export function startDirMonitor(source: DirSource, callbacks: DirMonitorCallbacks, opts: DirMonitorOptions = {}): ParseSession {
  const feed = new DirFeed(source)
  const pollMs = opts.pollMs ?? 1000
  const accept = opts.accept ?? DEFAULT_DIR_ACCEPT
  let closed = false
  let initialDone = false
  let timer: ReturnType<typeof setInterval> | null = null

  async function pollOnce(): Promise<void> {
    if (closed || !initialDone) return
    try {
      const diff = await feed.next()
      if (closed) return
      for (const entry of diff.added) {
        if (hasAcceptedName(entry.name, accept)) callbacks.onNewFile(entry, () => source.open(entry.name))
      }
      for (const entry of diff.removed) callbacks.onRemoved(entry.name)
    } catch (err) {
      // Listing failed — mid-session this is unrecoverable (e.g. permission
      // revoked); stop and surface the error.
      if (!closed) {
        closed = true
        if (timer) clearInterval(timer)
        callbacks.onError(String(err))
      }
    }
  }

  timer = setInterval(() => void pollOnce(), pollMs)

  void (async () => {
    try {
      const first = await feed.first()
      if (closed) return
      for (const entry of first.added) {
        if (hasAcceptedName(entry.name, accept)) callbacks.onNewFile(entry, () => source.open(entry.name))
      }
    } catch (err) {
      if (!closed) {
        closed = true
        if (timer) clearInterval(timer)
        callbacks.onError(String(err))
      }
    } finally {
      initialDone = true
    }
  })()

  return {
    close() {
      closed = true
      initialDone = true
      if (timer) clearInterval(timer)
    },
  }
}
