const DEFAULT_CHUNK = 1024 * 1024 // 1 MiB

export interface TextChunk {
  text: string
  isLast: boolean
}

/**
 * Stream a Blob/File as UTF-8 text in fixed-size slices.
 * `TextDecoder` runs in streaming mode so multi-byte characters split across
 * chunk boundaries decode correctly. The last yielded chunk may be an empty
 * string (decoder flush) — callers can ignore empty text.
 */
export async function* readTextChunks(
  blob: Blob,
  chunkSize: number = DEFAULT_CHUNK,
): AsyncGenerator<TextChunk> {
  if (blob.size === 0) {
    yield { text: '', isLast: true }
    return
  }
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let offset = 0
  while (offset < blob.size) {
    const end = Math.min(offset + chunkSize, blob.size)
    const buf = await blob.slice(offset, end).arrayBuffer()
    offset = end
    const isLast = offset >= blob.size
    yield { text: decoder.decode(new Uint8Array(buf), { stream: !isLast }), isLast }
  }
}
