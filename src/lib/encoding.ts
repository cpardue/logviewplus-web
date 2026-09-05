/**
 * File-encoding detection and decoder resolution (M5 checkpoint A).
 *
 * The core (`detectBom` / `isStrictUtf8` / `detectEncoding` /
 * `resolveFromSample`) is pure byte logic — no DOM, directly unit-testable.
 * Decoding itself always happens with the platform `TextDecoder` under one of
 * the labels in {@link ResolvedEncoding} (supported by Chromium and Node).
 *
 * Auto-detection order:
 *   1. BOM (UTF-8 / UTF-16 LE / UTF-16 BE) — decisive, and its bytes are
 *      skipped before decoding;
 *   2. UTF-16 zero-pattern heuristic (ASCII text in UTF-16 has ~half its
 *      bytes zero on one parity) → utf-16le / utf-16be. Checked BEFORE the
 *      pure-ASCII shortcut because BOM-less UTF-16 of ASCII text has NO high
 *      bytes; safe first, since genuine UTF-8 text never produces a strong
 *      NUL-parity bias (its non-ASCII bytes are all >= 0x80);
 *   3. no high bytes at all → pure ASCII → utf-8;
 *   4. strict UTF-8 validation over the sample → utf-8;
 *   5. anything else with high bytes → windows-1252 (the common Windows ANSI
 *      codepage — legacy `café`/`€` logs are the canonical case).
 *
 * Step 3 runs on a LEADING SAMPLE (see {@link SAMPLE_BYTES}), not the whole
 * file: a mixed-encoding file whose first 64 KiB is valid UTF-8 but whose
 * tail carries 1252 bytes will be misread as utf-8 (replacement characters).
 * That is an accepted limitation — the user override always wins. Full-file
 * validation becomes cheap once M5-B moves decoding into the worker.
 */

export const UTF8_BOM = [0xef, 0xbb, 0xbf] as const
export const UTF16LE_BOM = [0xff, 0xfe] as const
export const UTF16BE_BOM = [0xfe, 0xff] as const

/** Decoder labels we may hand to `TextDecoder` (all supported in Chromium + Node). */
export type ResolvedEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

/** What the user selects for newly opened files. */
export type EncodingChoice = 'auto' | ResolvedEncoding

export interface EncodingResolution {
  /** TextDecoder label to use for the whole file. */
  label: ResolvedEncoding
  /** Leading BOM bytes to skip before decoding (0 when none / mismatched). */
  bomLength: number
}

/** Select options shown in the FilterBar (value = store state). */
export const ENCODING_CHOICES: { value: EncodingChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'windows-1252', label: 'Windows-1252 (ANSI)' },
]

/** Size of the leading slice read for auto-detection. */
export const SAMPLE_BYTES = 64 * 1024

const UTF8_ONLY: EncodingResolution = { label: 'utf-8', bomLength: 0 }

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false
  return true
}

/** BOM at the start of `bytes`, or null. */
export function detectBom(bytes: Uint8Array): { label: ResolvedEncoding; length: number } | null {
  if (startsWith(bytes, UTF8_BOM)) return { label: 'utf-8', length: 3 }
  if (startsWith(bytes, UTF16LE_BOM)) return { label: 'utf-16le', length: 2 }
  if (startsWith(bytes, UTF16BE_BOM)) return { label: 'utf-16be', length: 2 }
  return null
}

/**
 * Pure strict UTF-8 validity scan (no replacement semantics, no BOM handling):
 * checks lead/continuation byte shapes, sequence lengths, overlong encodings
 * and the U+10FFFF upper bound.
 */
export function isStrictUtf8(bytes: Uint8Array): boolean {
  let i = 0
  const n = bytes.length
  while (i < n) {
    const b = bytes[i]
    if (b <= 0x7f) {
      i++
      continue
    }
    let extra: number
    if ((b & 0xe0) === 0xc0) extra = 1
    else if ((b & 0xf0) === 0xe0) extra = 2
    else if ((b & 0xf8) === 0xf0) extra = 3
    else return false // 10xxxxxx continuation or 0xF5–0xFF lead byte
    if (i + extra >= n) return false // truncated at end of sample
    if (extra === 1 && b < 0xc2) return false // overlong 2-byte
    if (
      extra === 3 &&
      (b === 0xf0 ? bytes[i + 1] < 0x90 : b > 0xf4 || (b === 0xf4 && bytes[i + 1] > 0x8f))
    ) {
      return false // below U+0800 (overlong) or above U+10FFFF
    }
    for (let k = 1; k <= extra; k++) {
      if ((bytes[i + k] & 0xc0) !== 0x80) return false
    }
    i += extra + 1
  }
  return true
}

/**
 * UTF-16 zero-pattern heuristic (BOM already ruled out). ASCII text in
 * UTF-16LE has zeros at ODD indices, in BE at EVEN ones; require a strong
 * bias so dense binary or latin-1 data does not false-positive.
 */
function detectUtf16(sample: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(sample.length, 1024)
  if (n < 8) return null
  let even = 0
  let odd = 0
  for (let i = 0; i < n; i++) {
    if (sample[i] === 0) {
      if (i % 2 === 0) even++
      else odd++
    }
  }
  if (odd >= n / 4 && odd > 4 * even + 2) return 'utf-16le'
  if (even >= n / 4 && even > 4 * odd + 2) return 'utf-16be'
  return null
}

/** Auto-detect the encoding of a leading byte sample. */
export function detectEncoding(sample: Uint8Array): ResolvedEncoding {
  const bom = detectBom(sample)
  if (bom) return bom.label
  // Before the pure-ASCII shortcut: BOM-less UTF-16 of ASCII text carries no
  // high bytes at all, and a real UTF-8 text file cannot mimic its zero
  // parity (UTF-8 non-ASCII bytes are all >= 0x80).
  const u16 = detectUtf16(sample)
  if (u16) return u16
  let hasHigh = false
  for (const b of sample) {
    if (b > 0x7f) {
      hasHigh = true
      break
    }
  }
  if (!hasHigh) return 'utf-8' // pure ASCII is valid UTF-8
  if (isStrictUtf8(sample)) return 'utf-8'
  return 'windows-1252'
}

/**
 * Resolve decoder label + BOM skip length from a leading byte sample.
 * An explicit choice always wins the label; a BOM is skipped only when it
 * matches that label (decoding a mismatched BOM's bytes under the chosen
 * encoding would just produce garbage).
 */
export function resolveFromSample(
  sample: Uint8Array,
  choice: EncodingChoice = 'auto',
): EncodingResolution {
  const bom = detectBom(sample)
  if (choice !== 'auto') {
    return { label: choice, bomLength: bom && bom.label === choice ? bom.length : 0 }
  }
  if (sample.length === 0) return UTF8_ONLY
  return { label: detectEncoding(sample), bomLength: bom?.length ?? 0 }
}

/** Read the leading sample of a Blob and resolve its encoding. */
export async function resolveFromBlob(
  blob: Blob,
  choice: EncodingChoice = 'auto',
): Promise<EncodingResolution> {
  const n = Math.min(blob.size, SAMPLE_BYTES)
  const sample = new Uint8Array(await blob.slice(0, n).arrayBuffer())
  return resolveFromSample(sample, choice)
}

