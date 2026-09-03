import { describe, expect, it } from 'vitest'
import { REPORT_PRESETS } from '../../src/lib/sql/presets'

describe('REPORT_PRESETS', () => {
  it('has unique slugs and labels', () => {
    const slugs = REPORT_PRESETS.map(p => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const p of REPORT_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.sql.trim().length).toBeGreaterThan(10)
    }
  })

  it('every preset queries the entries table with an aggregate or LIMIT', () => {
    for (const p of REPORT_PRESETS) {
      const sql = p.sql.toUpperCase()
      expect(sql).toContain('FROM ENTRIES')
      expect(/(COUNT\(|GROUP BY|LIMIT)/.test(sql)).toBe(true)
      // no DDL/DML ever
      expect(/(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\s/.test(sql)).toBe(false)
    }
  })

  it('level-counts is the default (first) preset', () => {
    expect(REPORT_PRESETS[0].slug).toBe('level-counts')
    expect(REPORT_PRESETS[0].sql).toContain("COALESCE(level, '(none)')")
  })
})
