import { describe, expect, it } from 'vitest'
import { programmeProgress, reviewApplication, type FrontSheet } from './applications'
import type { Application, ApplicationLine, SowLine } from './types'
import type { ProgrammeTask } from './programme'

const task = (code: string, name: string, start: string, finish: string, progress: number): ProgrammeTask => ({ code, name, section: null, trade: null, start_date: start, finish_date: finish, milestone: false, progress })

describe('programmeProgress', () => {
  it('averages the matching activities, weighted by how long each lasts', () => {
    const tasks = [task('a', 'Joinery first fix', '2026-01-01', '2026-01-10', 100), task('b', 'Joinery second fix', '2026-01-11', '2026-01-30', 0), task('c', 'Flooring', '2026-01-01', '2026-01-30', 50)]
    // 10 days at 100% and 20 days at 0% = a third
    expect(programmeProgress('Joinery', tasks)).toEqual({ pct: 33, n: 2 })
  })
  it('is null when nothing matches', () => {
    expect(programmeProgress('Joinery', [task('c', 'Flooring', '2026-01-01', '2026-01-30', 50)])).toBeNull()
  })
})

describe('reviewApplication', () => {
  const sow = [{ id: 's1', kind: 'item', item_ref: '1.01', description: 'Door', total: 1000, below_line: false }] as unknown as SowLine[]
  const line = (pct: number): ApplicationLine => ({ sow_line_id: 's1', variation_id: null, pct_claimed: pct, amount_claimed: pct * 1000, client_pct: 0, client_amount: 0, comment: null, client_comment: null })
  const fs = { totalApplication: 500, retentionPct: 5 } as FrontSheet
  const app = { valuation_date: '2026-11-26', status: 'draft', previously_paid: 0, practical_completion: false } as Application
  const base = { app, sow, vos: [], fs, fsPrev: null, fsClient: null, prevLines: [] as ApplicationLine[] }

  it('flags more than 100% and a drop since last time', () => {
    const over = reviewApplication({ ...base, lines: [line(1.2)] })
    expect(over.some((n) => n.level === 'error' && /100%/.test(n.text))).toBe(true)
    const down = reviewApplication({ ...base, lines: [line(0.3)], prevLines: [line(0.5)] })
    expect(down.some((n) => n.level === 'warn' && /Lower than last time/.test(n.text))).toBe(true)
  })
  it('flags nothing claimed', () => {
    expect(reviewApplication({ ...base, fs: { ...fs, totalApplication: 0 } as FrontSheet, lines: [] })[0].level).toBe('error')
  })
})
