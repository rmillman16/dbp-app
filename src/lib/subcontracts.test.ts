// The payment notice sums. Worked examples with known answers: change a rule and a test says so.
import { describe, expect, it } from 'vitest'
import { certAmount, certifyBy, lineAmount, noticeTotals } from './subcontracts'
import type { Adjustment, PaymentNotice, SubAppLine } from './types'

const notice = (o: Partial<PaymentNotice> = {}): PaymentNotice => ({
  id: 'n1', order_id: 'o1', notice_no: 1, sub_application_id: null, status: 'draft', notice_date: null, valuation_date: null,
  payment_due_date: null, dbp_payment_date: null, loss_and_expense: null, contra_charges: null, retention_pct: 5, previously_paid: null,
  prev_measured: null, prev_variations: null, prev_materials: null, prev_loss_and_expense: null, prev_contra: null, notes: null,
  measured_works: null, variations: null, materials_on_site: null, ...o,
})
const line = (o: Partial<SubAppLine> = {}): SubAppLine => ({
  block: 'measured', heading: null, item_ref: null, description: null, value: null, pct: null, amount: null, their_amount: null, note: null, sort: 0, ...o,
})
const adj = (block: Adjustment['block'], amount: number): Adjustment => ({ block, description: 'x', amount, sort: 0 })

describe('lineAmount (what the subcontractor claims)', () => {
  it('uses the amount they claim when given, even if % x value disagrees', () => {
    // Lumen prelims: stated 25% of 4,000 but 1,200 claimed
    expect(lineAmount({ value: 4000, pct: 0.25, their_amount: 1200 })).toBe(1200)
  })
  it('falls back to value x %, to the penny', () => {
    expect(lineAmount({ value: 1234.56, pct: 0.333, their_amount: null })).toBe(411.11)
  })
  it('is 0 with nothing to go on', () => {
    expect(lineAmount({ value: null, pct: null, their_amount: null })).toBe(0)
    expect(lineAmount({ value: 500, pct: null, their_amount: null })).toBe(0)
  })
})

describe('certAmount (what DBP certifies)', () => {
  const base = { value: 10000, pct: 0.5, their_amount: 5000 }
  it('is as claimed when DBP has typed nothing', () => {
    expect(certAmount({ ...base, cert_amount: null, cert_pct: null })).toBe(5000)
  })
  it('uses a typed amount', () => {
    expect(certAmount({ ...base, cert_amount: 4000, cert_pct: null })).toBe(4000)
  })
  it('uses a typed % of the line value', () => {
    expect(certAmount({ ...base, cert_amount: null, cert_pct: 0.4 })).toBe(4000)
  })
  it('a typed amount of 0 certifies nothing (not "as claimed")', () => {
    expect(certAmount({ ...base, cert_amount: 0, cert_pct: null })).toBe(0)
  })
})

describe('certifyBy (typing one fills the other)', () => {
  const l = line({ value: 8000 })
  it('% gives the amount', () => expect(certifyBy(l, 'pct', 0.25)).toEqual({ cert_pct: 0.25, cert_amount: 2000 }))
  it('amount gives the %', () => expect(certifyBy(l, 'amount', 2000)).toEqual({ cert_amount: 2000, cert_pct: 0.25 }))
  it('blank clears both', () => expect(certifyBy(l, 'pct', null)).toEqual({ cert_pct: null, cert_amount: null }))
  it('a line with no value keeps an amount but has no %', () => {
    expect(certifyBy(line(), 'amount', 700)).toEqual({ cert_amount: 700, cert_pct: null })
  })
})

describe('noticeTotals', () => {
  it('first notice: gross, retention and due', () => {
    // 100,000 measured at 60% claimed = 60,000; 5% retention = 3,000; due 57,000
    const t = noticeTotals(notice(), [line({ value: 100000, pct: 0.6 })], [], null)
    expect(t.theirs.gross).toBe(60000)
    expect(t.theirs.retention).toBe(-3000)
    expect(t.theirs.subTotal).toBe(57000)
    expect(t.theirs.due).toBe(57000)
    expect(t.dub.due).toBe(57000)
  })

  it('adds measured works, variations and materials, then takes retention off the lot', () => {
    const t = noticeTotals(
      notice({ retention_pct: 3 }),
      [line({ value: 50000, their_amount: 20000 }), line({ block: 'variations', value: 5000, their_amount: 5000 }), line({ block: 'materials', value: 0, their_amount: 10000 })],
      [],
      null,
    )
    expect(t.dub.gross).toBe(35000)
    expect(t.dub.retention).toBe(-1050)
    expect(t.dub.subTotal).toBe(33950)
  })

  it('later notice: due this time is the sub total less what was previously certified after retention', () => {
    const first = notice({ notice_no: 1, status: 'issued', measured_works: 40000, retention_pct: 5 }) // certified 40,000, net 38,000
    const second = notice({ id: 'n2', notice_no: 2 })
    const t = noticeTotals(second, [line({ value: 100000, their_amount: 70000 })], [], first)
    expect(t.previous.subTotal).toBe(38000)
    expect(t.dub.gross).toBe(70000)
    expect(t.dub.subTotal).toBe(66500)
    expect(t.dub.previouslyPaid).toBe(-38000)
    expect(t.dub.due).toBe(28500)
  })

  it('a notice made outside the app uses the prev_ figures typed on this notice', () => {
    const t = noticeTotals(notice({ prev_measured: 20000, prev_variations: 2000 }), [line({ value: 100000, their_amount: 50000 })], [], null)
    expect(t.previous.gross).toBe(22000)
    expect(t.previous.subTotal).toBe(20900)
    expect(t.dub.due).toBe(47500 - 20900)
  })

  it('previously_paid typed on the notice overrides the sum', () => {
    const t = noticeTotals(notice({ prev_measured: 20000, previously_paid: 13704.51 }), [line({ value: 100000, their_amount: 50000 })], [], null)
    expect(t.dub.previouslyPaid).toBeCloseTo(-13704.51, 2)
    expect(t.dub.due).toBeCloseTo(47500 - 13704.51, 2)
  })

  it('DBP adjustments change the DBP column only, never theirs', () => {
    const t = noticeTotals(notice(), [line({ value: 100000, their_amount: 50000 })], [adj('measured', -5000)], null)
    expect(t.theirs.gross).toBe(50000)
    expect(t.dub.gross).toBe(45000)
    expect(t.dub.subTotal).toBe(42750)
  })

  it('DBP certified amounts replace the claim in the DBP column', () => {
    const t = noticeTotals(notice(), [line({ value: 100000, their_amount: 50000, cert_amount: 40000 })], [], null)
    expect(t.theirs.gross).toBe(50000)
    expect(t.dub.gross).toBe(40000)
  })

  it('loss and expense adds, contra charges take off, both before retention', () => {
    const t = noticeTotals(notice({ loss_and_expense: 1000, contra_charges: 2500 }), [line({ value: 100000, their_amount: 50000 })], [], null)
    expect(t.dub.gross).toBe(48500)
    expect(t.dub.contra).toBe(-2500)
    expect(t.dub.retention).toBe(-2425)
    expect(t.dub.subTotal).toBe(46075)
  })

  it('retention defaults to 5% when not set', () => {
    const t = noticeTotals(notice({ retention_pct: null }), [line({ value: 1000, their_amount: 1000 })], [], null)
    expect(t.retentionPct).toBe(5)
    expect(t.dub.retention).toBe(-50)
  })

  it('0% retention holds nothing', () => {
    const t = noticeTotals(notice({ retention_pct: 0 }), [line({ value: 1000, their_amount: 1000 })], [], null)
    expect(t.dub.retention).toBeCloseTo(0, 10)
    expect(t.dub.subTotal).toBe(1000)
  })

  it('a negative adjustment can make this notice negative (an overpayment to recover)', () => {
    const first = notice({ status: 'issued', measured_works: 50000 }) // net 47,500 previously
    const t = noticeTotals(notice({ id: 'n2', notice_no: 2 }), [line({ value: 100000, their_amount: 40000 })], [], first)
    expect(t.dub.due).toBe(38000 - 47500)
  })
})
