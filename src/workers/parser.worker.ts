import { ParseEngine } from './parser-engine'
import type { ParserSpec } from '../parsers/types'

/**
 * Thin Web Worker shell around {@link ParseEngine}.
 * Inbound:  { type: 'init', spec?, fileName? } | { type: 'chunk', text } | { type: 'finish' } | { type: 'reset' }
 * Outbound: { type: 'rows', rows, epoch } | { type: 'progress', lines, entries, bytes, epoch }
 *          | { type: 'done', lines, entries, epoch } | { type: 'resetAck', epoch }
 *
 * `epoch` starts at 0 and increments on every 'reset' (which rebuilds the
 * engine with the same spec). Tail callers await 'resetAck' before clearing
 * UI state — worker-to-main message delivery is FIFO, so by the time the ack
 * arrives every row/progress message produced by the pre-reset engine has
 * already been delivered and cannot resurface after the clear.
 */
interface WorkerScope {
  onmessage: ((ev: MessageEvent) => void) | null
  postMessage(msg: unknown): void
}

const scope = self as unknown as WorkerScope

let engine: ParseEngine | null = null
let spec: ParserSpec | undefined
let fileName: string | undefined
let tzMode: 'local' | 'utc' | undefined
let epoch = 0

function makeEngine(): void {
  engine = new ParseEngine(
    spec,
    rows => scope.postMessage({ type: 'rows', rows, epoch }),
    5000,
    fileName,
    tzMode,
  )
}

scope.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as
    | { type: 'init'; spec?: ParserSpec; fileName?: string; tzMode?: 'local' | 'utc' }
    | { type: 'chunk'; text: string }
    | { type: 'finish' }
    | { type: 'reset' }

  switch (msg.type) {
    case 'init':
      spec = msg.spec
      fileName = msg.fileName
      tzMode = msg.tzMode
      makeEngine()
      break
    case 'chunk':
      if (!engine) return
      engine.feed(msg.text ?? '')
      scope.postMessage({
        type: 'progress',
        lines: engine.stats.lines,
        entries: engine.stats.entries,
        bytes: engine.stats.bytesSeen,
        epoch,
      })
      break
    case 'finish':
      if (!engine) return
      engine.finish()
      scope.postMessage({
        type: 'done',
        lines: engine.stats.lines,
        entries: engine.stats.entries,
        epoch,
      })
      break
    case 'reset':
      // Tail rotation: same file name, bytes restart at 0 — fresh line
      // counters and parser state, same detected spec.
      if (!engine) return
      epoch++
      makeEngine()
      scope.postMessage({ type: 'resetAck', epoch })
      break
  }
}
