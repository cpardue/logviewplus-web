import { readTextChunks } from './fileSource'
import { PatternParser } from '../parsers/PatternParser'
import type { LogEntry } from '../parsers/types'

export interface ParseCallbacks {
  onRows(rows: LogEntry[]): void
  onProgress(lines: number, entries: number, bytes: number): void
  onDone(lines: number, entries: number): void
  onError(message: string): void
}

export interface ParseSession {
  close(): void
}

/**
 * Orchestrate one file: template autodetect from the first chunk, stream 1 MiB
 * text chunks into a parse worker, route results back via callbacks.
 */
export function startParse(file: File, callbacks: ParseCallbacks): ParseSession {
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
        const template = PatternParser.detectTemplate(text.split('\n').slice(0, 200))
        worker.postMessage({ type: 'init', template })
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
