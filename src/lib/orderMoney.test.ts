// The money on an order: budget, value, variations, certified, retention, paid and what's left.
import { describe, expect, it } from 'vitest'
import { orderMoney, placeChecks } from './orderMoney'
import type { Order, PaymentNotice, SubVariation } from './types'

const order = (o: Partial<Order> = {}) => ({ id: 'o1', order_value: 100000, ...o }) as Order
const notice = (o: Partial<PaymentNotice>) =>
  ({ id: 'n', order_id: 'o1', notice_no: 1, status: 'issued', retention_pct: 5, dbp_payment_date: null, loss_and_expense: null, contra_charges: null, previously_paid: null,
    prev_measured: null, prev_variations: null, prev_materials: null, prev_loss_and_expense: null, prev_contra: null,
    measured_works: 0, variations: 0, materials_on_site: 0, ...o }) as PaymentNotice
const vo = (value: number, instructed: boolean, order_id = 'o1') => ({ order_id, ref: null, description: null, value, instructed }) as SubVariation

const TODAY = '2026-11-24'

describe('orderMoney', () => {
  it('a new order with nothing certified', () => {
    const m = orderMoney(order(), 120000, { notices: [], vars: [] }, TODAY)
    expect(m).toMatchObject({ budget: 120000, orderValue: 100000, variations: 0, revised: 100000, vsBudget: 20000, certified: 0, retention: 0, net: 0, paid: 0, toPay: 0, remaining: 100000, pctCertified: 0, notices: 0 })
  })

  it('only instructed variations count toward the revised value; pending ones are shown separately', () => {
    const m = orderMoney(order(), null, { notices: [], vars: [vo(5000, true), vo(2500.5, true), vo(9999, false), vo(1000, true, 'other')] }, TODAY)
    expect(m.variations).toBe(7500.5)
    expect(m.variationsPending).toBe(9999)
    expect(m.revised).toBe(107500.5)
  })

  it('budget minus revised: positive is a saving, negative is over', () => {
    expect(orderMoney(order(), 90000, { notices: [], vars: [] }, TODAY).vsBudget).toBe(-10000)
    expect(orderMoney(order(), 110000, { notices: [], vars: [vo(4000, true)] }, TODAY).vsBudget).toBe(6000)
  })

  it('no budget set: no comparison', () => {
    expect(orderMoney(order(), null, { notices: [], vars: [] }, TODAY).vsBudget).toBeNull()
  })

  it('certified comes from the latest ISSUED notice only', () => {
    const notices = [notice({ notice_no: 1, measured_works: 20000 }), notice({ notice_no: 2, measured_works: 50000 }), notice({ notice_no: 3, status: 'draft', measured_works: 90000 })]
    const m = orderMoney(order(), null, { notices, vars: [] }, TODAY)
    expect(m.certified).toBe(50000)
    expect(m.retention).toBe(2500)
    expect(m.net).toBe(47500)
    expect(m.remaining).toBe(50000)
    expect(m.pctCertified).toBe(50)
    expect(m.notices).toBe(2)
  })

  it('certified includes variations and materials on site', () => {
    const m = orderMoney(order(), null, { notices: [notice({ measured_works: 30000, variations: 5000, materials_on_site: 5000 })], vars: [vo(5000, true)] }, TODAY)
    expect(m.certified).toBe(40000)
    expect(m.revised).toBe(105000)
    expect(m.remaining).toBe(65000)
  })

  it('paid: the latest issued notice whose payment date has arrived', () => {
    const notices = [
      notice({ notice_no: 1, measured_works: 20000, dbp_payment_date: '2026-10-30' }), // net 19,000, paid
      notice({ notice_no: 2, measured_works: 50000, dbp_payment_date: '2026-12-30' }), // net 47,500, not yet
    ]
    const m = orderMoney(order(), null, { notices, vars: [] }, TODAY)
    expect(m.paid).toBe(19000)
    expect(m.net).toBe(47500)
    expect(m.toPay).toBe(28500)
  })

  it('a payment date of today counts as paid', () => {
    const m = orderMoney(order(), null, { notices: [notice({ measured_works: 10000, dbp_payment_date: TODAY })], vars: [] }, TODAY)
    expect(m.paid).toBe(9500)
    expect(m.toPay).toBe(0)
  })

  it('notices of other orders are ignored', () => {
    const m = orderMoney(order(), null, { notices: [notice({ order_id: 'other', measured_works: 99999 })], vars: [] }, TODAY)
    expect(m.certified).toBe(0)
  })

  it('an order with no value has no % certified (no divide by zero)', () => {
    const m = orderMoney(order({ order_value: 0 }), null, { notices: [], vars: [] }, TODAY)
    expect(m.pctCertified).toBeNull()
  })

  it('rounds the revised value to the penny', () => {
    const m = orderMoney(order({ order_value: 33333.333 }), null, { notices: [], vars: [vo(0.01, true)] }, TODAY)
    expect(m.revised).toBe(33333.34)
  })
})

describe('placeChecks (before an order goes out)', () => {
  const base = { company: null, docs: [], budget: null, others: [] as Order[], today: TODAY }
  it('stops an order with no value', () => {
    const c = placeChecks({ ...base, order: order({ order_value: null }) })
    expect(c.some((x) => x.level === 'stop' && /no value/i.test(x.text))).toBe(true)
  })
  it('stops an order over the package budget and says by how much', () => {
    const c = placeChecks({ ...base, order: order({ order_value: 105000 }), budget: 100000 })
    expect(c.find((x) => x.level === 'stop')?.text).toMatch(/5,000/)
  })
  it('a complete order within budget has no checks', () => {
    const o = order({ order_value: 90000, delivery_date: '2026-12-01', scope: 'Supply and fit the doors' })
    expect(placeChecks({ ...base, order: o, budget: 100000 })).toEqual([])
  })
  it('a missing delivery date and blank scope are notes, not stops', () => {
    const c = placeChecks({ ...base, order: order() })
    expect(c.length).toBeGreaterThan(0)
    expect(c.every((x) => x.level === 'note')).toBe(true)
  })
})
