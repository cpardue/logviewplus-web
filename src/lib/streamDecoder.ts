/**
 * Persistent streaming decoder for one fixed encoding label.
 *
 * DOM-free (worker- and unit-test-friendly): wraps a single `TextDecoder` so
 * byte sequences split across chunk boundaries (UTF-8 multi-byte characters,
 * UTF-16 two-byte units) decode correctly across calls. The parse worker owns
 * one instance per session — decode moved off the main thread in M5-B, where
 * previously `fileSource`/`TailFeed` decoded on main and posted strings.
 */
export class StreamDecoder {
  private readonly label: string
  private decoder: TextDecoder

  constructor(label: string) {
    this.label = label
    this.decoder = new TextDecoder(label, { fatal: false })
  }

  /**
   * Decode one byte chunk. `stream: true` keeps a trailing partial sequence
   * buffered for the next call (the file may keep growing — tail polls);
   * `stream: false` flushes it (parse end-of-file).
   */
  decode(bytes: Uint8Array, stream: boolean): string {
    return this.decoder.decode(bytes, { stream })
  }

  /** Drop decoder state — after a rotation rewinds the byte feed to byte 0. */
  reset(): void {
    this.decoder = new TextDecoder(this.label, { fatal: false })
  }
}
