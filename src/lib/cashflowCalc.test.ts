// The cashflow: working days, how values spread across months, retention and the totals.
import { describe, expect, it } from 'vitest'
import { addWorkingDays, computeCashflow, curveWeights, frontLoadPct, siteDates, workingDaysByMonth } from './cashflowCalc'
import type { CfItem, CfTask } from './cashflowCalc'

const task = (code: string, start_date: string, finish_date: string, o: Partial<CfTask> = {}): CfTask => ({ code, name: code, start_date, finish_date, ...o })
const item = (o: Partial<CfItem>): CfItem => ({ key: 'pkg:A', label: 'A', kind: 'package', value: 10000, tasks: ['T1'], weights: [], ...o })
const stage = (pct: number, timing: 'start' | 'spread' | 'end' | 'date' = 'spread', extra: object = {}) => ({ stage_id: 's', pct, timing, task_codes: null, on_date: null, ...extra })

describe('working days', () => {
  it('counts Monday to Friday only, by month', () => {
    // Mon 26 Oct to Tue 3 Nov 2026: Oct 26-30 (5), Nov 2-3 (2)
    const m = workingDaysByMonth('2026-10-26', '2026-11-03')
    expect(m.get('2026-10')).toBe(5)
    expect(m.get('2026-11')).toBe(2)
  })
  it('a weekend-only span still lands in its month', () => {
    expect([...workingDaysByMonth('2026-11-07', '2026-11-08')]).toEqual([['2026-11', 1]])
  })
  it('addWorkingDays skips weekends', () => {
    expect(addWorkingDays('2026-11-20', 1)).toBe('2026-11-23') // Fri -> Mon
    expect(addWorkingDays('2026-11-23', 5)).toBe('2026-11-30')
  })
  it('addWorkingDays skips shutdowns', () => {
    expect(addWorkingDays('2026-12-18', 1, [{ start: '2026-12-21', end: '2027-01-01' }])).toBe('2027-01-04')
  })
})

describe('front-loaded curve for the difference to the contract sum', () => {
  it('20% up to 500k, 10% from 5m, sliding between', () => {
    expect(frontLoadPct(300000)).toBe(20)
    expect(frontLoadPct(500000)).toBe(20)
    expect(frontLoadPct(5000000)).toBe(10)
    expect(frontLoadPct(9000000)).toBe(10)
    expect(frontLoadPct(2750000)).toBe(15)
  })
  it('weights always add up to 1', () => {
    for (const n of [1, 2, 3, 4, 5, 8, 12]) expect(curveWeights(n, 1_000_000).reduce((s, w) => s + w, 0)).toBeCloseTo(1, 10)
    expect(curveWeights(0, 1)).toEqual([])
    expect(curveWeights(2, 1)).toEqual([0.6, 0.4])
  })
  it('the first month takes the front-load share', () => {
    expect(curveWeights(6, 300000)[0]).toBeCloseTo(0.2, 10)
  })
})

describe('siteDates', () => {
  const tasks = [task('D1', '2026-01-05', '2026-02-27', { trade: 'Design' }), task('W1', '2026-03-02', '2026-06-30'), task('W2', '2026-04-01', '2026-07-31')]
  it('uses the job dates when there are no milestones', () => {
    expect(siteDates(tasks, { start: '2026-03-09', pc: '2026-08-14' })).toMatchObject({ start: '2026-03-09', pc: '2026-08-14' })
  })
  it('otherwise the first and last construction activity, ignoring design', () => {
    expect(siteDates(tasks, { start: null, pc: null })).toMatchObject({ start: '2026-03-02', pc: '2026-07-31' })
  })
  it('the programme milestones win over the job dates', () => {
    const t = [...tasks, task('M1', '2026-03-16', '2026-03-16', { name: 'Start on site' }), task('M2', '2026-08-28', '2026-08-28', { name: 'Practical Completion' })]
    const r = siteDates(t, { start: '2026-03-09', pc: '2026-08-14' })
    expect(r).toMatchObject({ start: '2026-03-16', pc: '2026-08-28' })
    expect(r.fromProgramme).toEqual({ start: true, pc: true })
  })
})

describe('computeCashflow', () => {
  const tasks = [task('T1', '2026-01-05', '2026-03-31')] // Jan 20 working days, Feb 20, Mar 22
  const input = (items: CfItem[], extra = {}) => ({ items, tasks, siteStart: '2026-01-05', pc: '2026-03-31', retentionPct: 5, ...extra })

  it('spreads a value across the activity by working day', () => {
    const r = computeCashflow(input([item({ weights: [stage(100)] })]))
    expect(r.months).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(r.rows[0].months).toEqual([3225.81, 3225.81, 3548.38])
    expect(r.rows[0].months.reduce((s, v) => s + v, 0)).toBeCloseTo(10000, 2)
    expect(r.unplaced).toBe(0)
  })

  it('timing "start" puts it all in the first month, "end" in the last', () => {
    const r = computeCashflow(input([item({ key: 'a', weights: [stage(30, 'start'), stage(70, 'end')] })]))
    expect(r.rows[0].months).toEqual([3000, 0, 7000])
  })

  it('a stage on a date lands in that date\'s month', () => {
    const r = computeCashflow(input([item({ weights: [stage(100, 'date', { on_date: '2026-02-14' })] })]))
    expect(r.rows[0].months).toEqual([0, 10000, 0])
  })

  it('weights by fixed amount', () => {
    const r = computeCashflow(input([item({ weights: [stage(0, 'start', { amount: 2500 }), stage(0, 'end', { amount: 7500 })] })]))
    expect(r.rows[0].months).toEqual([2500, 0, 7500])
  })

  it('stages adding up to less than 100% leave the rest unplaced, and say so', () => {
    const r = computeCashflow(input([item({ weights: [stage(60, 'start')] })]))
    expect(r.rows[0].unplaced).toBe(4000)
    expect(r.unplaced).toBe(4000)
    expect(r.rows[0].issues.join(' ')).toMatch(/60%/)
  })

  it('an item with no weighting is wholly unplaced', () => {
    const r = computeCashflow(input([item({ weights: [] })]))
    expect(r.unplaced).toBe(10000)
    expect(r.rows[0].issues.length).toBe(1)
  })

  it('an activity missing from the programme is reported, not silently dropped', () => {
    const r = computeCashflow(input([item({ tasks: ['GONE'], weights: [stage(100)] })]))
    expect(r.unplaced).toBe(10000)
    expect(r.rows[0].issues.join(' ')).toMatch(/GONE not in the programme/)
  })

  it('the total excludes variations at risk, which are shown separately', () => {
    const r = computeCashflow(input([item({ weights: [stage(100, 'start')] }), item({ key: 'vo:1', kind: 'vo_risk', value: 2000, weights: [stage(100, 'end')] })]))
    expect(r.total).toBe(10000)
    expect(r.atRiskTotal).toBe(2000)
    expect(r.monthly[2].atRisk).toBe(2000)
    expect(r.monthly[2].value).toBe(0)
  })

  it('retention: full % held until PC month, then half is released', () => {
    const r = computeCashflow(input([item({ weights: [stage(100, 'date', { on_date: '2026-01-15' })] })]))
    expect(r.monthly[0].retention).toBe(-500)
    expect(r.monthly[0].netCumulative).toBe(9500)
    // March is the PC month: retention drops to 2.5% of the cumulative
    expect(r.monthly[2].retention).toBe(-250)
    expect(r.monthly[2].netCumulative).toBe(9750)
    expect(r.monthly[2].netMonth).toBe(250)
  })

  it('cumulative reaches 100% and the net months add up to the final net', () => {
    const r = computeCashflow(input([item({ weights: [stage(100)] })]))
    const last = r.monthly[r.monthly.length - 1]
    expect(last.cumulative).toBe(10000)
    expect(last.cumPct).toBe(1)
    expect(r.monthly.reduce((s, m) => s + m.netMonth, 0)).toBeCloseTo(last.netCumulative, 2)
  })

  it('an "adjust" item (difference to the contract sum) is spread in line with everything else', () => {
    const r = computeCashflow(
      input([item({ key: 'a', value: 9000, weights: [stage(100, 'start')] }), item({ key: 'adjust:contract', kind: 'adjust', value: 1000, tasks: [], weights: [] })]),
    )
    expect(r.total).toBe(10000)
    expect(r.rows[1].months).toEqual([1000, 0, 0])
  })

  it('a curved adjustment takes the front-load share first, peaks in the middle, tails off, and still adds up', () => {
    const r = computeCashflow(input([item({ key: 'adjust:contract', kind: 'adjust', value: 3000, tasks: [], weights: [], curve: 300000 })]))
    expect(r.rows[0].months).toEqual([600, 1800, 600]) // 20% first, then 75/25 of the rest
    expect(r.rows[0].months[1]).toBeGreaterThan(r.rows[0].months[2])
    expect(r.rows[0].months.reduce((s, v) => s + v, 0)).toBeCloseTo(3000, 2)
  })

  it('the months of each row always add back to the row value (no lost pennies)', () => {
    const r = computeCashflow(input([item({ value: 12345.67, weights: [stage(33.33), stage(66.67, 'end')] })]))
    expect(r.rows[0].months.reduce((s, v) => s + v, 0)).toBeCloseTo(12345.67, 2)
  })

  it('no items, no months, no crash', () => {
    const r = computeCashflow({ items: [], tasks: [], siteStart: null, pc: null, retentionPct: 5 })
    expect(r.months).toEqual([])
    expect(r.total).toBe(0)
  })
})
