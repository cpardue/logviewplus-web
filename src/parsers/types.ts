export const LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const
export type LogLevel = (typeof LEVELS)[number]

/** A single parsed log entry. `ts`/`level` are null when unresolvable. */
export interface LogEntry {
  /** Positional order within the dataset (0-based). */
  seq: number
  /** Epoch milliseconds, or null. */
  ts: number | null
  level: LogLevel | null
  message: string
  /** The original line text. */
  raw: string
  /** 1-based line number in the source file (blank lines counted). */
  lineNo: number
  /** Source file name (multi-file sets). */
  file?: string
}

/** Log formats the pipeline can autodetect and parse. */
export type ParserKind = 'pattern' | 'w3c' | 'combined' | 'json' | 'dsv' | 'log4j-xml'

/** Resolved field names for JSON-lines parsing (null = not found). */
export interface JsonKeys {
  tsKey: string | null
  levelKey: string | null
  msgKey: string | null
}

/** Serializable description of the parser to run (worker `init` payload). */
export type ParserSpec =
  | { kind: 'pattern'; template: string }
  | { kind: 'w3c'; fields: string[] }
  | { kind: 'combined' }
  | { kind: 'json'; keys: JsonKeys }
  | { kind: 'dsv'; delimiter: string; tsCol: number | null; levelCol: number | null }
  | { kind: 'log4j-xml' }

/** A parsed entry before the engine assigns its positional `seq`. */
export type DraftEntry = Omit<LogEntry, 'seq'>

/**
 * Line-oriented log parser. Stateless parsers emit one entry per line; stateful
 * parsers (XML) may emit 0..n entries from a line and must flush on `finish()`.
 */
export interface LogParser {
  readonly kind: ParserKind
  /** Parse one source line (CR already stripped, 1-based lineNo). May emit nothing. */
  parse(line: string, lineNo: number): DraftEntry[]
  /** End-of-file flush for stateful parsers (optional). */
  finish?(lineNo: number): DraftEntry | null
}
