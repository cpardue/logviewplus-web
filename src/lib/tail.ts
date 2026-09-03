/**
 * Live tail-following for growing log files.
 *
 * The core ({@link TailFeed}) is DOM-free and directly unit-testable: it
 * tracks a byte offset inside an opaque {@link TailSource}, decodes each
 * growth with ONE persistent streaming UTF-8 decoder (multi-byte characters
 * split across read boundaries survive), and classifies every poll as
 * growth, rotation (the file shrank since the last observed size — truncated
 * or rotated in place) or removal (the source no longer resolves). Size-based
 * polling has two inherent blind spots, same class as `tail -f`: same-size
 * rewrites are undetectable, and a file that grows then shrinks between two
 * polls (ending larger than the last observed size) slips through. Both are
 * accepted limitations.
 *
 * The File System Access API adapter ({@link HandleSource} /
 * {@link isTailSupported}) is Chromium-only; feature detection happens in the
 * UI so non-Chromium browsers degrade gracefully.
 */

export interface TailSource {
  /** Current size in bytes; negative when the file no longer exists. */
  stat(): Promise<number>
  /** Bytes `[from, to)`. */
  slice(from: number, to: number): Promise<ArrayBuffer>
  /** Display name of the tailed file (for parser `file` stamping). */
  readonly name?: string
}

export type TailStep =
  | { kind: 'none' } // no new bytes since the last read
  | { kind: 'text'; text: string; offset: number } // decoded growth consumed up to offset
  | { kind: 'rotate' } // shrank since last observation — caller resets, then reads from byte 0
  | { kind: 'removed' } // source no longer resolves — stop tailing (existing rows stay)

export class TailFeed {
  private decoder = new TextDecoder('utf-8', { fatal: false })
  private offset = 0
  /** Size observed by the most recent `next()`; null until the first poll. */
  private prevSize: number | null = null

  constructor(private readonly source: TailSource) {}

  /** Bytes consumed from the source so far. */
  get consumed(): number {
    return this.offset
  }

  /**
   * Poll once. Reads at most `maxBytes` of growth per call — the initial full
   * read chunks at 1 MiB (memory-flat, progress-friendly), steady-state polls
   * use Infinity (catch up in one slice).
   */
  async next(maxBytes: number = Infinity): Promise<TailStep> {
    const size = await this.source.stat()
    if (size < 0) return { kind: 'removed' }
    if (this.prevSize != null && size < this.prevSize) {
      this.prevSize = size
      return { kind: 'rotate' }
    }
    if (size <= this.offset) {
      this.prevSize = size
      return { kind: 'none' }
    }
    const to = Math.min(size, this.offset + maxBytes)
    const buf = await this.source.slice(this.offset, to)
    // Always `stream: true` — the file may keep growing; a pending incomplete
    // sequence must stay buffered for the next read. Incomplete LINES are the
    // parse engine's job (it keeps a partial trailing line across feeds).
    const text = this.decoder.decode(new Uint8Array(buf), { stream: true })
    this.offset = to
    this.prevSize = size
    return { kind: 'text', text, offset: to }
  }

  /** Drop decoder state and rewind to byte 0 (after a rotation reset). */
  reset(): void {
    this.decoder = new TextDecoder('utf-8', { fatal: false })
    this.offset = 0
    this.prevSize = null
  }
}

/** File System Access API availability (Chromium; absent elsewhere). */
export function isTailSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'
}

/** Reads a {@link FileSystemFileHandle} as a live {@link TailSource}. */
export class HandleSource implements TailSource {
  constructor(private readonly handle: FileSystemFileHandle) {}

  get name(): string {
    return this.handle.name
  }

  async stat(): Promise<number> {
    try {
      return (await this.handle.getFile()).size
    } catch {
      // File deleted/moved since the handle was picked.
      return -1
    }
  }

  async slice(from: number, to: number): Promise<ArrayBuffer> {
    const file = await this.handle.getFile()
    return file.slice(from, to).arrayBuffer()
  }
}
