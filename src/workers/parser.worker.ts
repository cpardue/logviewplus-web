import { ParseEngine } from './parser-engine'
import type { ParserSpec } from '../parsers/types'

/**
 * Thin Web Worker shell around {@link ParseEngine}.
 * Inbound:  { type: 'init', spec?, fileName? } | { type: 'chunk', text } | { type: 'finish' }
 * Outbound: { type: 'rows', rows } | { type: 'progress', lines, entries } | { type: 'done', lines, entries }
 */
interface WorkerScope {
  onmessage: ((ev: MessageEvent) => void) | null
  postMessage(msg: unknown): void
}

const scope = self as unknown as WorkerScope

let engine: ParseEngine | null = null

scope.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as
    | { type: 'init'; spec?: ParserSpec; fileName?: string; tzMode?: 'local' | 'utc' }
    | { type: 'chunk'; text: string }
    | { type: 'finish' }

  switch (msg.type) {
    case 'init':
      engine = new ParseEngine(
        msg.spec,
        rows => scope.postMessage({ type: 'rows', rows }),
        5000,
        msg.fileName,
        msg.tzMode,
      )
      break
    case 'chunk':
      if (!engine) return
      engine.feed(msg.text ?? '')
      scope.postMessage({
        type: 'progress',
        lines: engine.stats.lines,
        entries: engine.stats.entries,
        bytes: engine.stats.bytesSeen,
      })
      break
    case 'finish':
      if (!engine) return
      engine.finish()
      scope.postMessage({
        type: 'done',
        lines: engine.stats.lines,
        entries: engine.stats.entries,
      })
      break
  }
}
