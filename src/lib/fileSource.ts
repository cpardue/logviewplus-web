export const DEFAULT_CHUNK = 1024 * 1024 // 1 MiB

export interface ByteChunk {
  buf: ArrayBuffer
  isLast: boolean
}

/**
 * Stream a Blob/File as raw byte slices from `bomLength` onward (see
 * `src/lib/encoding.ts` — a resolved BOM is skipped here, so the worker never
 * sees it). Slicing and reading stay on the main thread because `Blob` is a
 * main-thread API; the caller then TRANSFERS each buffer to the parse worker
 * (`postMessage(msg, [buf])`), where decoding happens (M5-B) — no string
 * structured-clone crosses the boundary. The final chunk carries
 * `isLast: true`; an empty or BOM-only blob yields a single empty final chunk
 * so callers can still signal end-of-file (init + finish).
 */
export async function* readByteChunks(
  blob: Blob,
  chunkSize: number = DEFAULT_CHUNK,
  bomLength = 0,
): AsyncGenerator<ByteChunk> {
  const start = Math.min(bomLength, blob.size)
  if (blob.size <= start) {
    yield { buf: new ArrayBuffer(0), isLast: true }
    return
  }
  let offset = start
  while (offset < blob.size) {
    const end = Math.min(offset + chunkSize, blob.size)
    const buf = await blob.slice(offset, end).arrayBuffer()
    offset = end
    yield { buf, isLast: offset >= blob.size }
  }
}

