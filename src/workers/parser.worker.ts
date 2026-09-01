import { ParseEngine } from './parser-engine'

/**
 * Thin Web Worker shell around {@link ParseEngine}.
 * Inbound:  { type: 'init', template? } | { type: 'chunk', text } | { type: 'finish' }
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
    | { type: 'init'; template?: string }
    | { type: 'chunk'; text: string }
    | { type: 'finish' }

  switch (msg.type) {
    case 'init':
      engine = new ParseEngine(msg.template, rows => scope.postMessage({ type: 'rows', rows }))
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
