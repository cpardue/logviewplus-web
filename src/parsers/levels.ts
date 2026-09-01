import type { LogLevel } from './types'

const ALIASES: Record<string, LogLevel> = {
  TRACE: 'TRACE',
  FINE: 'TRACE',
  FINER: 'TRACE',
  FINEST: 'TRACE',
  VERBOSE: 'DEBUG',
  DEBUG: 'DEBUG',
  DBUG: 'DEBUG',
  INFO: 'INFO',
  INFORMATION: 'INFO',
  NOTICE: 'INFO',
  WARN: 'WARN',
  WARNING: 'WARN',
  ERROR: 'ERROR',
  ERR: 'ERROR',
  SEVERE: 'ERROR',
  CRIT: 'FATAL',
  CRITICAL: 'FATAL',
  FATAL: 'FATAL',
}

/** Normalize a free-form level token to a canonical LogLevel (null when unknown/absent). */
export function normalizeLevel(raw: string | null | undefined): LogLevel | null {
  if (!raw) return null
  return ALIASES[raw.trim().toUpperCase()] ?? null
}
