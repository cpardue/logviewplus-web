import { strToU8, unzipSync } from 'fflate'

const MAX_FILES_PER_ZIP = 200

/** Extract files from a dropped/picked .zip (directories skipped, capped). */
export async function ingestZip(file: File): Promise<File[]> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const entries = unzipSync(buf)
  const out: File[] = []
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/')) continue
    out.push(new File([data as unknown as BlobPart], path, { type: 'text/plain' }))
    if (out.length >= MAX_FILES_PER_ZIP) break
  }
  return out
}

/** Wrap pasted/dropped text as a synthetic file for the normal ingest path. */
export function textToFile(text: string, name: string): File {
  return new File([strToU8(text)], name, { type: 'text/plain' })
}

/** Deterministic-ish unique name for pasted content. */
export function pasteFileName(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `pasted-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.log`
}