// The money on an order, in one place (24 Nov): budget (the procurement schedule), order value, instructed
// variations, certified to date, retention held, paid and what's left. Used by the Orders list and the order page.
// Certified comes from DBP's own payment notices (the same sums as the notice itself and the dashboard).
import { supabase } from './supabase'
import { cached } from './offline'
import { money, todayIso, ukDate } from './format'
import { noticeTotals } from './subcontracts'
import { pqqState, docExpiry, loadCompanyDocs, STATE_LABELS, type CompanyDoc } from './pqq'
import type { Adjustment, Company, Order, PaymentNotice, SubVariation } from './types'

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => (v == null ? 0 : Number(v))

export interface OrderMoney {
  budget: number | null // the package's budget in the procurement schedule
  orderValue: number
  variations: number // instructed variations
  variationsPending: number // on the list, not yet instructed
  revised: number // order value + instructed variations
  vsBudget: number | null // budget minus revised: positive is a saving, negative is over
  certified: number // gross certified to date (latest issued notice)
  retention: number // held on that
  net: number // certified after retention
  paid: number // net of the latest notice DBP has paid (payment date reached)
  toPay: number // certified net not yet paid
  remaining: number // revised minus certified: still to be certified
  pctCertified: number | null
  notices: number // issued payment notices
}

export interface OrderMoneyData {
  notices: PaymentNotice[]
  vars: SubVariation[]
}

// every payment notice and variation for these orders, in two queries
export function loadOrderMoneyData(orderIds: string[]): Promise<OrderMoneyData> {
  return cached(`ordermoney:${orderIds.join(',')}`, async () => {
    if (!orderIds.length) return { notices: [], vars: [] }
    const [n, v] = await Promise.all([
      supabase.from('payment_notices').select('*').in('order_id', orderIds),
      supabase.from('sub_variations').select('*').in('order_id', orderIds),
    ])
    if (n.error) throw new Error(n.error.message)
    if (v.error) throw new Error(v.error.message)
    return { notices: n.data as PaymentNotice[], vars: v.data as SubVariation[] }
  })
}

export function orderMoney(order: Order, budget: number | null, data: OrderMoneyData, today = todayIso()): OrderMoney {
  const ns = data.notices.filter((n) => n.order_id === order.id).sort((a, b) => a.notice_no - b.notice_no)
  const vs = data.vars.filter((v) => v.order_id === order.id)
  const orderValue = num(order.order_value)
  const variations = r2(vs.filter((v) => v.instructed).reduce((t, v) => t + num(v.value), 0))
  const variationsPending = r2(vs.filter((v) => !v.instructed).reduce((t, v) => t + num(v.value), 0))
  const revised = r2(orderValue + variations)

  // the notice's stored DuB assessment through the same sums as the notice itself
  const dub = (pn: PaymentNotice) => {
    const stored: Adjustment[] = [
      { block: 'measured', description: '', amount: num(pn.measured_works), sort: 0 },
      { block: 'variations', description: '', amount: num(pn.variations), sort: 1 },
      { block: 'materials', description: '', amount: num(pn.materials_on_site), sort: 2 },
    ]
    return noticeTotals(pn, [], stored, ns.find((p) => p.notice_no === pn.notice_no - 1) ?? null).dub
  }
  const issued = ns.filter((n) => n.status === 'issued')
  const latest = issued[issued.length - 1]
  const col = latest ? dub(latest) : null
  const certified = col ? r2(col.gross) : 0
  const retention = col ? r2(-col.retention) : 0
  const net = col ? r2(col.subTotal) : 0
  // paid: the latest issued notice whose DBP payment date has come
  const paidNotice = [...issued].reverse().find((n) => n.dbp_payment_date && n.dbp_payment_date <= today)
  const paid = paidNotice ? r2(dub(paidNotice).subTotal) : 0

  return {
    budget,
    orderValue,
    variations,
    variationsPending,
    revised,
    vsBudget: budget ? r2(budget - revised) : null,
    certified,
    retention,
    net,
    paid,
    toPay: r2(net - paid),
    remaining: r2(revised - certified),
    pctCertified: revised ? Math.round((certified / revised) * 1000) / 10 : null,
    notices: issued.length,
  }
}

// ---------- checks before placing an order ----------
export interface PlaceCheck {
  level: 'stop' | 'note' // stop = needs an "I understand" tick; note = for information
  text: string
}

// What other orders already exist on the same package (a package ordered twice is usually a mistake)
export function placeChecks(args: {
  order: Order
  company: Company | null
  docs: CompanyDoc[]
  budget: number | null
  others: Order[]
  today?: string
}): PlaceCheck[] {
  const { order, company, docs, budget, others } = args
  const today = args.today ?? todayIso()
  const out: PlaceCheck[] = []

  if (company && company.pqq_status !== undefined) {
    const s = pqqState(company, today)
    if (s === 'expired' || s === 'rejected') out.push({ level: 'stop', text: `${company.name}'s PQQ is ${STATE_LABELS[s].toLowerCase()}.` })
    else if (s === 'sent' || s === 'received') out.push({ level: 'stop', text: `${company.name}'s PQQ isn't approved yet (${STATE_LABELS[s].toLowerCase()}).` })
    else if (s === 'not_sent') out.push({ level: 'stop', text: `${company.name} has never been sent a PQQ.` })
    else if (s === 'expiring') out.push({ level: 'note', text: `${company.name}'s PQQ approval runs out on ${ukDate(company.pqq_expires_on)}: send them a new one soon.` })
  }
  for (const d of docs) {
    const e = docExpiry(d, today)
    if (e === 'expired') out.push({ level: 'stop', text: `${company?.name ?? 'They'}: ${d.name} expired on ${ukDate(d.expires_on)}.` })
    else if (e === 'expiring') out.push({ level: 'note', text: `${company?.name ?? 'They'}: ${d.name} expires on ${ukDate(d.expires_on)}.` })
  }
  if (order.order_value == null || Number(order.order_value) <= 0) out.push({ level: 'stop', text: 'The order has no value.' })
  if (budget && order.order_value != null && Number(order.order_value) > budget) {
    const over = r2(Number(order.order_value) - budget)
    out.push({ level: 'stop', text: `The order value is ${money(over)} over the package budget (${money(budget)}).` })
  }
  if (!order.delivery_date) out.push({ level: 'note', text: 'No delivery / start date is set.' })
  if (!order.scope?.trim()) out.push({ level: 'note', text: 'The scope of works is blank.' })
  const twin = others.find((o) => o.id !== order.id && o.package_name === order.package_name && o.status !== 'draft')
  if (twin) out.push({ level: 'stop', text: `This package already has a placed order (${twin.order_no ?? 'no number'}).` })
  return out
}

export const loadDocsFor = (companyId: string) => loadCompanyDocs(companyId).catch(() => [] as CompanyDoc[])

