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
