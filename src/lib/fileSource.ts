import type { EncodingResolution } from './encoding'

export const DEFAULT_CHUNK = 1024 * 1024 // 1 MiB

export interface TextChunk {
  text: string
  isLast: boolean
}

const UTF8_ONLY: EncodingResolution = { label: 'utf-8', bomLength: 0 }

/**
 * Stream a Blob/File as text in fixed-size slices, decoded with
 * `resolution.label` (see `src/lib/encoding.ts`; default plain UTF-8).
 * `TextDecoder` runs in streaming mode so multi-byte characters (and
 * UTF-16's two-byte units) split across chunk boundaries decode correctly.
 * Reading starts at `resolution.bomLength` so a detected BOM is skipped.
 * The last yielded chunk may be an empty string (decoder flush) — callers
 * can ignore empty text.
 */
export async function* readTextChunks(
  blob: Blob,
  chunkSize: number = DEFAULT_CHUNK,
  resolution: EncodingResolution = UTF8_ONLY,
): AsyncGenerator<TextChunk> {
  const start = Math.min(resolution.bomLength, blob.size)
  if (blob.size <= start) {
    yield { text: '', isLast: true }
    return
  }
  const decoder = new TextDecoder(resolution.label, { fatal: false })
  let offset = start
  while (offset < blob.size) {
    const end = Math.min(offset + chunkSize, blob.size)
    const buf = await blob.slice(offset, end).arrayBuffer()
    offset = end
    const isLast = offset >= blob.size
    yield { text: decoder.decode(new Uint8Array(buf), { stream: !isLast }), isLast }
  }
}

