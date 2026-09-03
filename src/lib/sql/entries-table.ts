import { Field, Float64, Int32, Schema, Table, Utf8, vectorFromArray } from 'apache-arrow'
import type { LogEntry } from '../../parsers/types'

/**
 * The exact column layout SQL reports run against. Types are explicit on
 * purpose: arrow's inference turns JS string arrays into Dictionary<Utf8, Int32>
 * vectors, which DuckDB-WASM's Arrow ingest rejects (see MILESTONE-3 notes).
 *
 * Every field is nullable=true on purpose: apache-arrow v17 infers every
 * vector as nullable, and `new Table(schema, columns)` validates the schema
 * against that inference — a stricter schema throws "schemas must be equivalent"
 * (including for empty input). DuckDB does not need NOT NULL here.
 */
export function entriesSchema(): Schema {
  return new Schema([
    new Field('seq', new Int32(), true),
    new Field('ts_ms', new Float64(), true),
    new Field('ts_iso', new Utf8(), true),
    new Field('level', new Utf8(), true),
    new Field('message', new Utf8(), true),
    new Field('raw', new Utf8(), true),
    new Field('file', new Utf8(), true),
    new Field('line_no', new Int32(), true),
  ])
}

/** Build the Arrow table backing the `entries` DuckDB table from parsed entries. */
export function buildEntriesTable(entries: LogEntry[]): Table {
  const seqs = new Int32Array(entries.length)
  const tss = new Array<number | null>(entries.length)
  const tsIsos = new Array<string | null>(entries.length)
  const levels = new Array<string | null>(entries.length)
  const messages = new Array<string>(entries.length)
  const raws = new Array<string>(entries.length)
  const files = new Array<string | null>(entries.length)
  const lineNos = new Int32Array(entries.length)
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    seqs[i] = e.seq
    tss[i] = e.ts
    tsIsos[i] = e.ts == null ? null : new Date(e.ts).toISOString()
    levels[i] = e.level
    messages[i] = e.message
    raws[i] = e.raw
    files[i] = e.file ?? null
    lineNos[i] = e.lineNo
  }
  const seqV = vectorFromArray(seqs)
  const tsMsV = vectorFromArray(tss, new Float64())
  const tsIsoV = vectorFromArray(tsIsos, new Utf8())
  const levelV = vectorFromArray(levels, new Utf8())
  const messageV = vectorFromArray(messages, new Utf8())
  const rawV = vectorFromArray(raws, new Utf8())
  const fileV = vectorFromArray(files, new Utf8())
  const lineNoV = vectorFromArray(lineNos)
  // Varargs form (schema + explicit vectors) recurses in apache-arrow v17's
  // ESM build for non-empty input; the column-map form works and validates
  // against the all-nullable schema above (empty input included).
  return new Table(entriesSchema(), {
    seq: seqV,
    ts_ms: tsMsV,
    ts_iso: tsIsoV,
    level: levelV,
    message: messageV,
    raw: rawV,
    file: fileV,
    line_no: lineNoV,
  })
}
