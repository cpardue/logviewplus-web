import { PatternParser, DEFAULT_TEMPLATE } from './PatternParser'
import { normalizeLevel } from './levels'
import { parseTimestamp } from './timestamps'
import { COMBINED_RE } from './CombinedParser'
import type { JsonKeys, ParserSpec } from './types'

const JSON_TS_KEYS = ['@timestamp', 'ts', 'time', 'timestamp', 'datetime', 'date', 't', '_time']
const JSON_LEVEL_KEYS = ['level', 'severity', 'lvl', 'loglevel', 'syslogseverity']
const JSON_MSG_KEYS = ['msg', 'message', 'text', 'body']

/** Pick the first alias that appears in at least one sample object. */
export function resolveJsonKeys(parsed: Record<string, unknown>[]): JsonKeys {
  const pick = (cands: string[]): string | null => {
    for (const c of cands) if (parsed.some(o => c in o)) return c
    return null
  }
  return { tsKey: pick(JSON_TS_KEYS), levelKey: pick(JSON_LEVEL_KEYS), msgKey: pick(JSON_MSG_KEYS) }
}

function jsonSample(lines: string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of lines) {
    const v = line.trim()
    if (!v.startsWith('{')) continue
    try {
      const o: unknown = JSON.parse(v)
      if (typeof o === 'object' && o !== null && !Array.isArray(o)) out.push(o as Record<string, unknown>)
    } catch {
      // not JSON — ignore
    }
  }
  return out
}

/**
 * Choose the parser spec for a file from its first sample lines. Order:
 * JSON → W3C (#Fields header) → common/combined → Log4j XML → DSV → pattern.
 * Pattern template autodetect is the final fallback (never fails).
 */
export function detectFormat(sampleLines: string[]): ParserSpec {
  const lines = sampleLines.filter(l => l.trim() !== '')
  if (lines.length === 0) return { kind: 'pattern', template: DEFAULT_TEMPLATE }

  // 1. JSON lines — near-unanimous parse success.
  const objs = jsonSample(lines)
  if (objs.length >= Math.max(1, Math.ceil(lines.length * 0.9))) {
    return { kind: 'json', keys: resolveJsonKeys(objs) }
  }

  // 2. W3C extended — a #Fields header with matching data rows.
  const fieldsLine = lines.find(l => l.startsWith('#Fields:'))
  if (fieldsLine) {
    const fields = fieldsLine.slice('#Fields:'.length).trim().split(/\s+/)
    const dataLines = lines.filter(l => !l.startsWith('#'))
    if (dataLines.length > 0) {
      let ok = 0
      for (const l of dataLines) {
        const parts = l.split(' ')
        if (parts.length >= fields.length && parseTimestamp(`${parts[0]} ${parts[1]}`) != null) ok++
      }
      if (ok / dataLines.length >= 0.8) return { kind: 'w3c', fields }
    }
  }

  // 3. Apache/Nginx common + combined.
  let comb = 0
  for (const l of lines) if (COMBINED_RE.exec(l)) comb++
  if (comb >= 2 && comb / lines.length >= 0.8) return { kind: 'combined' }

  // 4. Log4j XML (1.x or 2.x events).
  let events = 0
  for (const l of lines) if (l.includes('<log4j:event') || l.includes('<LogRecord')) events++
  if (events > 0 && events >= Math.ceil(lines.length * 0.1)) return { kind: 'log4j-xml' }

  // 5. DSV — one consistent delimiter with ≥ 2 columns across ~all lines.
  const dsv = detectDsv(lines)
  if (dsv) return dsv

  // 6. Pattern template fallback.
  return { kind: 'pattern', template: PatternParser.detectTemplate(sampleLines) }
}

const DSV_DELIMS = ['\t', '|', ';', ',']

function detectDsv(lines: string[]): ParserSpec | null {
  for (const d of DSV_DELIMS) {
    const rows = lines.map(l => l.split(d))
    const counts = rows.map(r => r.length)
    const maxCount = Math.max(...counts)
    if (maxCount < 2) continue
    const consistent = counts.filter(c => c === maxCount).length / counts.length
    if (consistent < 0.95) continue

    let tsCol: number | null = null
    let levelCol: number | null = null
    for (let i = 0; i < maxCount; i++) {
      if (tsCol == null) {
        let hit = 0
        for (const r of rows) if (i < r.length && parseTimestamp(r[i]) != null) hit++
        if (hit / rows.length >= 0.5) tsCol = i
      }
      if (levelCol == null && i !== tsCol) {
        let hit = 0
        for (const r of rows) if (i < r.length && normalizeLevel(r[i]) != null) hit++
        if (hit / rows.length >= 0.5) levelCol = i
      }
    }
    return { kind: 'dsv', delimiter: d, tsCol, levelCol }
  }
  return null
}