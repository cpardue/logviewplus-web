import { DEFAULT_CHUNK, readTextChunks } from './fileSource'
import { detectFormat } from '../parsers/detect'
import { TailFeed, type TailSource } from './tail'
import type { LogEntry, ParserSpec } from '../parsers/types'

export interface ParseCallbacks {
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
}

/**
 * Orchestrate one file: parser autodetect from the first chunk, stream 1 MiB
 * text chunks into a parse worker, route results back via callbacks.
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
    for await (const { text } of readTextChunks(file)) {
      if (closed) return
      if (!inited) {
        const spec: ParserSpec = detectFormat(text.split('\n').slice(0, 200))
        worker.postMessage({ type: 'init', spec, fileName: file.name, tzMode: opts.tzMode })
        inited = true
      }
      worker.postMessage({ type: 'chunk', text })
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
 * poll for growth. Growth is decoded by one streaming UTF-8 decoder across
 * polls and fed as chunks. On rotation (file shrank) the worker engine is
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
  const feed = new TailFeed(source)
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

  async function handleRotation(): Promise<void> {
    // Rewind the byte feed before asking the worker to reset; onRotation()
    // runs only after the ack, at which point every pre-reset rows/progress
    // message has already been delivered (FIFO) — clearing stored rows then
    // cannot lose or duplicate entries.
    feed.reset()
    if (!inited) return
    await new Promise<void>(resolve => {
      resetAck = resolve
      worker.postMessage({ type: 'reset' })
    })
    callbacks.onRotation()
  }

  /** One pump: consume up to the current file size, then wait for the next poll. */
  async function pump(): Promise<void> {
    if (closed || busy || stopped) return
    busy = true
    try {
      for (;;) {
        const step = await feed.next(DEFAULT_CHUNK)
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
            await handleRotation()
            // Loop again: re-read the (new) content from byte 0.
            break
          case 'text': {
            const text = step.text
            if (!inited) {
              const spec: ParserSpec = detectFormat(text.split('\n').slice(0, 200))
              worker.postMessage({ type: 'init', spec, fileName: source.name, tzMode: opts.tzMode })
              inited = true
            }
            if (text !== '') worker.postMessage({ type: 'chunk', text })
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

  void pump()
  const timer = setInterval(() => void pump(), pollMs)

  return {
    close() {
      closed = true
      stopped = true
      clearInterval(timer)
      worker.terminate()
    },
  }
}
