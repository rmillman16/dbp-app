// The cost value reconciliation: targets, costs, forecasts, margin. Worked example with known answers.
import { describe, expect, it } from 'vitest'
import { computeCvr, groupOf } from './cvrCalc'
import type { CalcInput, CalcPackage } from './cvrCalc'

const pkg = (id: string, name: string, budget: number, o: Partial<CalcPackage> = {}): CalcPackage => ({
  id, name, kind: 'cost', budget, target: null, target_note: null, supplier_note: null, sort: 0, ...o,
})

// £1m contract. Joinery budget 100k (nothing ordered), Electrical budget 200k (ordered at 190k + 5k variations), OH&P 80k omitted.
const base = (o: Partial<CalcInput> = {}): CalcInput => ({
  contractSum: 1_000_000,
  budgetTotal: 1_000_000,
  epPct: 4,
  packages: [pkg('p1', 'Joinery', 100000, { sort: 1 }), pkg('p2', 'Electrical', 200000, { sort: 2 }), pkg('p3', 'OH&P', 80000, { kind: 'omit', sort: 3 })],
  orders: [{ package_id: 'p2', label: 'Spark Ltd', order_value: 190000, instructed_variations: 5000 }],
  vos: [],
  allocations: [
    { supplier_code: 'A1', supplier_name: 'Wood Ltd', package_id: 'p1', share: 1 },
    { supplier_code: 'B1', supplier_name: 'Spark Ltd', package_id: 'p2', share: 1 },
  ],
  costs: [
    { supplier_code: 'A1', supplier_name: 'Wood Ltd', total_cost: 40000, last_reported: null },
    { supplier_code: 'B1', supplier_name: 'Spark Ltd', total_cost: 250000, last_reported: null },
  ],
  previousCosts: null,
  forecasts: [],
  possibleReduction: 0,
  certified: null,
  programme: { start: '2026-01-05', originalPc: '2026-07-31', revisedPc: null },
  ...o,
})
const row = (r: ReturnType<typeof computeCvr>, id: string) => r.packages.find((p) => p.id === id)!

describe('groupOf', () => {
  it.each([
    ['cost', 'Subbie Joinery', 'subcontract'],
    ['cost', 'DuB Labour', 'labour_materials'],
    ['cost', 'Materials', 'labour_materials'],
    ['cost', 'Site Manager', 'prelims'],
    ['cost', 'Skips and waste', 'prelims'],
    ['cost', 'Provisional sums', 'other'],
    ['cost', 'Contingency', 'other'],
    ['cost', 'Joinery', 'subcontract'], // anything else is a subcontract
    ['omit', 'DuB Management', 'prelims'],
    ['omit', 'OH&P', 'other'],
    ['ep', 'Extra preliminaries', 'other'],
  ] as const)('%s "%s" is %s', (kind, name, group) => expect(groupOf({ kind, name })).toBe(group))
  it('a typed group wins', () => expect(groupOf({ kind: 'cost', name: 'Joinery', cvr_group: 'prelims' })).toBe('prelims'))
})

describe('computeCvr: targets', () => {
  const r = computeCvr(base())
  it('no order: the target is the SoW budget', () => {
    expect(row(r, 'p1')).toMatchObject({ source: 'budget', target: 100000, cost: 40000, forecast: 100000, stillToCome: 60000, overrun: 0 })
  })
  it('with an order: the target is the order value plus instructed variations, not the budget', () => {
    expect(row(r, 'p2')).toMatchObject({ source: 'order', target: 195000 })
  })
  it('cost over the target forecasts at the cost and shows the overrun, with a warning', () => {
    expect(row(r, 'p2')).toMatchObject({ cost: 250000, forecast: 250000, stillToCome: 0, overrun: 55000 })
    expect(r.warnings.some((w) => /Electrical is over its target by £55,000\.00/.test(w))).toBe(true)
  })
  it('an omitted package has no target', () => {
    expect(row(r, 'p3')).toMatchObject({ source: 'omitted', target: 0, forecast: 0 })
  })
  it('a typed target beats the order and the budget', () => {
    const r2 = computeCvr(base({ packages: [pkg('p2', 'Electrical', 200000, { target: 210000, target_note: 'agreed with client' })] }))
    expect(row(r2, 'p2')).toMatchObject({ source: 'typed', target: 210000, sourceNote: 'agreed with client' })
  })
  it('an "ep" package is a % of the contract sum', () => {
    const r2 = computeCvr(base({ packages: [pkg('e', 'Extra preliminaries', 0, { kind: 'ep' })], orders: [], allocations: [], costs: [] }))
    expect(row(r2, 'e')).toMatchObject({ source: 'ep', target: 40000 })
  })
  it('agreed VO costs add to the package target and VO values to the final account', () => {
    const r2 = computeCvr(base({ vos: [{ id: 'v1', label: 'VO 1', value: 15000, cost: 10000, package_id: 'p1' }] }))
    expect(row(r2, 'p1').target).toBe(110000)
    expect(r2.value).toMatchObject({ agreedVos: 15000, afv: 1015000 })
  })
  it('a VO with no package is counted on its own and flagged', () => {
    const r2 = computeCvr(base({ vos: [{ id: 'v1', label: 'VO 1', value: 15000, cost: 10000, package_id: null }] }))
    expect(r2.unallocatedVos).toEqual([{ label: 'VO 1', cost: 10000 }])
    expect(r2.totalCost).toBe(r.totalCost + 10000)
    expect(r2.warnings.some((w) => /not given a package/.test(w))).toBe(true)
  })
})

describe('computeCvr: forecasts', () => {
  it('a typed forecast replaces the default', () => {
    const r = computeCvr(base({ forecasts: [{ package_id: 'p1', forecast: 90000, note: 'saving' }] }))
    expect(row(r, 'p1')).toMatchObject({ forecast: 90000, stillToCome: 50000, forecastTyped: true, forecastNote: 'saving', overrun: 0 })
  })
  it('a forecast below the cost to date is flagged', () => {
    const r = computeCvr(base({ forecasts: [{ package_id: 'p1', forecast: 30000, note: null }] }))
    expect(r.warnings.some((w) => /Joinery: the forecast .* below the cost to date/.test(w))).toBe(true)
  })
  it('a typed forecast above the target is an overrun', () => {
    const r = computeCvr(base({ forecasts: [{ package_id: 'p1', forecast: 120000, note: null }] }))
    expect(row(r, 'p1').overrun).toBe(20000)
  })
})

describe('computeCvr: costs and suppliers', () => {
  it('a supplier split by share goes to its packages in proportion', () => {
    const r = computeCvr(
      base({
        allocations: [
          { supplier_code: 'A1', supplier_name: 'Wood Ltd', package_id: 'p1', share: 0.25 },
          { supplier_code: 'A1', supplier_name: 'Wood Ltd', package_id: 'p2', share: 0.75 },
        ],
        costs: [{ supplier_code: 'A1', supplier_name: 'Wood Ltd', total_cost: 40000, last_reported: null }],
      }),
    )
    expect(row(r, 'p1').cost).toBe(10000)
    expect(row(r, 'p2').cost).toBe(30000)
    expect(r.unallocatedCost).toBe(0)
  })
  it('a supplier split by £ goes by amount, and warns when the cost has moved on', () => {
    const r = computeCvr(
      base({
        allocations: [
          { supplier_code: 'A1', supplier_name: 'Wood Ltd', package_id: 'p1', share: 0, amount: 30000 },
          { supplier_code: 'A1', supplier_name: 'Wood Ltd', package_id: 'p2', share: 0, amount: 5000 },
        ],
        costs: [{ supplier_code: 'A1', supplier_name: 'Wood Ltd', total_cost: 40000, last_reported: null }],
      }),
    )
    expect(row(r, 'p1').cost).toBe(30000)
    expect(r.suppliers[0].unallocated).toBe(5000)
    expect(r.warnings.some((w) => /has moved on from its split/.test(w))).toBe(true)
  })
  it('an unallocated supplier counts in the total cost but not in a package', () => {
    const r = computeCvr(base({ allocations: [], costs: [{ supplier_code: 'Z', supplier_name: 'Mystery Ltd', total_cost: 7000, last_reported: null }] }))
    expect(r.unallocatedCost).toBe(7000)
    expect(r.totals.cost).toBe(0)
    expect(r.jcTotal).toBe(7000)
    expect(r.totalCost).toBe(r.totals.forecast + 7000)
    expect(r.warnings.some((w) => /not allocated to a package yet/.test(w))).toBe(true)
  })
  it('over 100% allocated is flagged', () => {
    const r = computeCvr(
      base({
        allocations: [
          { supplier_code: 'A1', supplier_name: 'Wood Ltd', package_id: 'p1', share: 0.7 },
          { supplier_code: 'A1', supplier_name: 'Wood Ltd', package_id: 'p2', share: 0.7 },
        ],
      }),
    )
    expect(r.warnings.some((w) => /more than 100%/.test(w))).toBe(true)
  })
  it('movement is this month less last month, per supplier and in total', () => {
    const r = computeCvr(base({ previousCosts: [{ supplier_code: 'A1', supplier_name: 'Wood Ltd', total_cost: 30000, last_reported: null }, { supplier_code: 'B1', supplier_name: 'Spark Ltd', total_cost: 260000, last_reported: null }] }))
    expect(r.suppliers.map((s) => s.movement)).toEqual([10000, -10000])
    expect(r.movement).toBe(0)
  })
  it('cost allocated to an omitted package still counts and reduces the margin', () => {
    const r = computeCvr(base({ allocations: [{ supplier_code: 'A1', supplier_name: 'Wood Ltd', package_id: 'p3', share: 1 }], costs: [{ supplier_code: 'A1', supplier_name: 'Wood Ltd', total_cost: 12000, last_reported: null }] }))
    expect(row(r, 'p3')).toMatchObject({ cost: 12000, forecast: 12000 })
    expect(r.warnings.some((w) => /omitted from the budget/.test(w))).toBe(true)
  })
})

describe('computeCvr: value and margin', () => {
  const r = computeCvr(base())
  it('total cost is the forecast across packages', () => {
    expect(r.totals).toMatchObject({ budget: 380000, target: 295000, cost: 290000, forecast: 350000, stillToCome: 60000, overrun: 55000 })
    expect(r.totalCost).toBe(350000)
  })
  it('final account value is the contract sum plus agreed VOs plus any possible reduction', () => {
    const r2 = computeCvr(base({ possibleReduction: -20000, vos: [{ id: 'v', label: 'VO', value: 15000, cost: 0, package_id: null }] }))
    expect(r2.value.afv).toBe(995000)
  })
  it('margin is value less total cost, and the % is of the value', () => {
    expect(r.margin).toBe(650000)
    expect(r.marginPct).toBeCloseTo(0.65, 10)
  })
  it('OH&P is read from the omitted OH&P package', () => {
    expect(r.tender).toMatchObject({ ohp: 80000, omitted: 80000 })
    expect(r.tender.ohpPct).toBeCloseTo(0.08, 10)
  })
  it('programme weeks and delay', () => {
    const r2 = computeCvr(base({ programme: { start: '2026-01-05', originalPc: '2026-07-31', revisedPc: '2026-08-14' } }))
    expect(r2.programme.originalWeeks).toBe(29.57) // 207 days
    expect(r2.programme.weeksDelay).toBe(2)
  })
  it('flags a contract sum that is not the SoW total, and budgets from a different SoW', () => {
    const r2 = computeCvr(base({ enteredContractSum: 950000, budgetTotal: 990000 }))
    expect(r2.warnings.some((w) => /entered on the job/.test(w))).toBe(true)
    expect(r2.warnings.some((w) => /office SoW total/.test(w))).toBe(true)
  })
  it('a difference of £1 or less is not flagged', () => {
    expect(computeCvr(base({ enteredContractSum: 1_000_000.5 })).warnings.some((w) => /entered on the job/.test(w))).toBe(false)
  })
  it('no packages: says to import the SoW, and doesn\'t divide by zero', () => {
    const r2 = computeCvr(base({ packages: [], orders: [], allocations: [], costs: [], contractSum: 0, budgetTotal: null }))
    expect(r2.marginPct).toBe(0)
    expect(r2.warnings).toContain('No budgets yet: import the office SoW first.')
  })
})

describe('computeCvr: prelims lump drawn down by its sections', () => {
  const lump = pkg('pl', 'Preliminaries', 60000, { is_remainder: true, sort: 1 })
  const sec = (id: string, name: string, sort: number) => pkg(id, name, 0, { sort })
  it('the lump is its budget less what the sections have drawn', () => {
    const r = computeCvr(
      base({
        packages: [lump, sec('s1', 'Site Manager', 2), sec('s2', 'Skips and waste', 3)],
        orders: [],
        allocations: [
          { supplier_code: 'A1', supplier_name: 'Mgr', package_id: 's1', share: 1 },
          { supplier_code: 'B1', supplier_name: 'Skip', package_id: 's2', share: 1 },
        ],
        costs: [
          { supplier_code: 'A1', supplier_name: 'Mgr', total_cost: 20000, last_reported: null },
          { supplier_code: 'B1', supplier_name: 'Skip', total_cost: 5000, last_reported: null },
        ],
      }),
    )
    expect(row(r, 's1')).toMatchObject({ source: 'drawdown', target: 0, forecast: 20000, overrun: 0 })
    expect(row(r, 'pl')).toMatchObject({ source: 'remainder', target: 35000, overrun: 0 })
    expect(r.warnings.some((w) => /over the prelims budget/.test(w))).toBe(false)
  })
  it('the overspend shows on the lump, not the sections, when the group goes over', () => {
    const r = computeCvr(
      base({
        packages: [lump, sec('s1', 'Site Manager', 2)],
        orders: [],
        allocations: [{ supplier_code: 'A1', supplier_name: 'Mgr', package_id: 's1', share: 1 }],
        costs: [{ supplier_code: 'A1', supplier_name: 'Mgr', total_cost: 75000, last_reported: null }],
      }),
    )
    expect(row(r, 's1').overrun).toBe(0)
    expect(row(r, 'pl').overrun).toBe(15000)
    expect(r.warnings.some((w) => /over the prelims budget .* by £15,000\.00/.test(w))).toBe(true)
  })
})
