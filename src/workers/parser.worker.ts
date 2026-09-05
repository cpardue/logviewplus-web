import { ParseEngine } from './parser-engine'
import { StreamDecoder } from '../lib/streamDecoder'
import type { ParserSpec } from '../parsers/types'

/**
 * Thin Web Worker shell around {@link ParseEngine} + {@link StreamDecoder}.
 * Inbound:  { type: 'init', spec?, fileName?, tzMode?, encoding? }
 *          | { type: 'chunk', buf: ArrayBuffer, stream: boolean }  (buf transferred)
 *          | { type: 'finish' } | { type: 'reset' }
 * Outbound: { type: 'rows', rows, epoch } | { type: 'progress', lines, entries, bytes, epoch }
 *          | { type: 'done', lines, entries, epoch } | { type: 'resetAck', epoch }
 *
 * Decode lives here (M5-B): the main thread only reads Blob slices and
 * transfers the ArrayBuffers — no string structured-clone crosses the
 * boundary. The worker's ONE persistent streaming decoder reassembles
 * sequences split across 1 MiB chunks; `stream: true` keeps a trailing
 * partial sequence buffered (tail polls — the file may grow),
 * `stream: false` flushes it (parse end-of-file).
 *
 * `epoch` starts at 0 and increments on every 'reset' (which rebuilds the
 * engine AND the decoder with the same spec/encoding). Tail callers await
 * 'resetAck' before clearing UI state — worker-to-main message delivery is
 * FIFO, so by the time the ack arrives every row/progress message produced
 * by the pre-reset engine has already been delivered and cannot resurface
 * after the clear.
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
let decoder: StreamDecoder | null = null
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
    | { type: 'init'; spec?: ParserSpec; fileName?: string; tzMode?: 'local' | 'utc'; encoding?: string }
    | { type: 'chunk'; buf: ArrayBuffer; stream: boolean }
    | { type: 'finish' }
    | { type: 'reset' }

  switch (msg.type) {
    case 'init':
      spec = msg.spec
      fileName = msg.fileName
      tzMode = msg.tzMode
      decoder = new StreamDecoder(msg.encoding ?? 'utf-8')
      makeEngine()
      break
    case 'chunk':
      if (!engine || !decoder) return
      engine.feed(decoder.decode(new Uint8Array(msg.buf), msg.stream))
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
      // counters, parser state AND decoder state, same spec/encoding.
      if (!engine || !decoder) return
      epoch++
      decoder.reset()
      makeEngine()
      scope.postMessage({ type: 'resetAck', epoch })
      break
  }
}
