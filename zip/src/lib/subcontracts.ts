// Subcontract orders, the subcontractor's applications and DBP's payment notices, as
// 2609 Kong / Logik Payment Notice 2 (test cases: 2611 Lumen £56,401.94, Mercury £44,056.19).
import { supabase } from './supabase'
import { cached, must } from './offline'
import { todayIso, addDaysIso, money } from './format'
import type { Adjustment, Block, Company, Order, PaymentNotice, SubAppLine, SubApplication, SubVariation } from './types'

const r2 = (n: number) => Math.round(n * 100) / 100

export const PAYMENT_DAYS = 30 // payment due date = valuation due date + 30 days (as the template)

// "01 - Electrical - Lumen Fit Out Ltd" (3. Orders folder name)
export const orderLabel = (o: Pick<Order, 'folder_no' | 'trade'>, c?: Pick<Company, 'name'> | null) =>
  [o.folder_no != null ? String(o.folder_no).padStart(2, '0') : null, o.trade, c?.name].filter(Boolean).join(' - ')

// ---------- loading ----------
export function loadCompanies() {
  return cached('companies', () => must<Company[]>(supabase.from('companies').select('*').order('name')))
}

// a contractor typed in that isn't on the list yet (the rest of its details on the Contractors page)
export async function addCompany(name: string, type: Company['type'] = 'subcontractor', trade: string | null = null) {
  const r = await supabase.from('companies').insert({ name: name.trim(), type, trade }).select('*').single()
  if (r.error) throw new Error(r.error.message)
  return r.data as Company
}

export function loadOrders(jobId: string) {
  return cached(`orders:${jobId}`, () => must<Order[]>(supabase.from('orders').select('*').eq('job_id', jobId).order('folder_no', { nullsFirst: false })))
}

export function loadOrder(orderId: string) {
  return cached(`order:${orderId}`, async () => ({
    order: await must<Order>(supabase.from('orders').select('*').eq('id', orderId).single()),
    vars: await must<SubVariation[]>(supabase.from('sub_variations').select('*').eq('order_id', orderId).order('ref')),
    notices: await must<PaymentNotice[]>(supabase.from('payment_notices').select('*').eq('order_id', orderId).order('notice_no')),
  }))
}

export function loadNotice(noticeId: string) {
  return cached(`pn:${noticeId}`, async () => {
    const pn = await must<PaymentNotice>(supabase.from('payment_notices').select('*').eq('id', noticeId).single())
    const app = pn.sub_application_id ? await must<SubApplication>(supabase.from('sub_applications').select('*').eq('id', pn.sub_application_id).single()) : null
    const lines = app ? await must<SubAppLine[]>(supabase.from('sub_application_lines').select('*').eq('sub_application_id', app.id).order('sort')) : []
    const adjustments = await must<Adjustment[]>(supabase.from('payment_notice_adjustments').select('*').eq('payment_notice_id', noticeId).order('sort'))
    return { pn, app, lines, adjustments }
  })
}

// ---------- creating ----------
// Application N and its payment notice N together; previously paid starts at what the earlier
// notices in the app were due (enter it by hand when the earlier notice was made outside the app).
export async function createNotice(order: Order, notices: PaymentNotice[]) {
  const no = Math.max(0, ...notices.map((n) => n.notice_no)) + 1
  const app = await supabase.from('sub_applications').insert({ order_id: order.id, app_no: no, received_date: todayIso() }).select('id').single()
  if (app.error) throw app.error
  const valuation = todayIso()
  const pn = await supabase
    .from('payment_notices')
    .insert({
      order_id: order.id,
      notice_no: no,
      sub_application_id: app.data.id,
      notice_date: todayIso(),
      valuation_date: valuation,
      payment_due_date: addDaysIso(valuation, PAYMENT_DAYS),
      retention_pct: order.retention_pct,
      previously_paid: null, // worked out from the previous notice; can be overwritten
    })
    .select('id')
    .single()
  if (pn.error) throw pn.error
  return pn.data.id as string
}

// ---------- saving ----------
export async function saveNotice(pn: PaymentNotice, app: SubApplication, lines: SubAppLine[], adjustments: Adjustment[], checks: Check[], totals: NoticeTotals) {
  const { id, ...pnRest } = pn
  const steps = [
    () => supabase.from('payment_notices').update({ ...pnRest, measured_works: r2(totals.dub.measured), variations: r2(totals.dub.variations), materials_on_site: r2(totals.dub.materials) }).eq('id', id),
    () => supabase.from('sub_applications').update({ app_date: app.app_date, received_date: app.received_date, stated_gross: app.stated_gross, stated_previous: app.stated_previous, stated_due: app.stated_due, notes: app.notes, import_checks: checks }).eq('id', app.id),
    () => supabase.from('sub_application_lines').delete().eq('sub_application_id', app.id),
    () => (lines.length ? supabase.from('sub_application_lines').insert(lines.map(({ id: _i, ...l }, i) => ({ ...l, sub_application_id: app.id, sort: i }))) : null), // eslint-disable-line @typescript-eslint/no-unused-vars
    () => supabase.from('payment_notice_adjustments').delete().eq('payment_notice_id', id),
    () => (adjustments.length ? supabase.from('payment_notice_adjustments').insert(adjustments.map(({ id: _i, ...a }, i) => ({ ...a, payment_notice_id: id, sort: i }))) : null), // eslint-disable-line @typescript-eslint/no-unused-vars
  ]
  for (const step of steps) {
    const r = await step()
    if (r && r.error) throw r.error
  }
}

// ---------- the sums ----------
// Their valuation counts what they actually claim; % × value is only the cross-check
// (Lumen prelims: stated 25% of £4,000 but £1,200 claimed, corrected by a DuB adjustment).
export const lineAmount = (l: Pick<SubAppLine, 'value' | 'pct' | 'their_amount'>) =>
  l.their_amount != null ? Number(l.their_amount) : l.value != null && l.pct != null ? r2(l.value * l.pct) : 0

// DBP's certified amount for a line (054): typed by % or £ (the other follows); blank = as claimed
export const certAmount = (l: Pick<SubAppLine, 'value' | 'pct' | 'their_amount' | 'cert_amount' | 'cert_pct'>) =>
  l.cert_amount != null ? Number(l.cert_amount) : l.cert_pct != null && l.value != null ? r2(Number(l.value) * Number(l.cert_pct)) : lineAmount(l)
export const isCertified = (l: Pick<SubAppLine, 'cert_amount' | 'cert_pct'>) => l.cert_amount != null || l.cert_pct != null
// typing one fills in the other (against the line's value)
export function certifyBy(l: SubAppLine, by: 'pct' | 'amount', v: number | null): Partial<SubAppLine> {
  if (v == null) return { cert_pct: null, cert_amount: null }
  const value = l.value != null ? Number(l.value) : null
  if (by === 'pct') return { cert_pct: v, cert_amount: value != null ? r2(value * v) : null }
  return { cert_amount: v, cert_pct: value ? Math.round((v / value) * 1e6) / 1e6 : null }
}

export interface Column {
  measured: number
  variations: number
  materials: number
  lossAndExpense: number
  contra: number // shown negative
  gross: number
  retention: number // negative
  subTotal: number
  previouslyPaid: number // negative
  due: number
}

export interface NoticeTotals {
  // dub.measured etc. = certified lines + adjustments
  theirs: { measuredValue: number; variationsValue: number } & Column // the subcontractor's valuation
  dub: Column // DuB assessment: theirs plus adjustments
  previous: Column // the previous notice
  retentionPct: number
}

function column(measured: number, variations: number, materials: number, le: number, contra: number, retPct: number, prevPaid: number): Column {
  const gross = measured + variations + materials + le - contra
  const retention = -gross * (retPct / 100)
  const subTotal = gross + retention
  return { measured, variations, materials, lossAndExpense: le, contra: -contra, gross, retention, subTotal, previouslyPaid: -prevPaid, due: subTotal - prevPaid }
}

// previous: the previous payment notice when it's in the app (null when it was made outside
// the app: then this notice's prev_* figures are used).
export function noticeTotals(pn: PaymentNotice, lines: SubAppLine[], adjustments: Adjustment[], previous: PaymentNotice | null): NoticeTotals {
  const sum = (b: Block, f: (l: SubAppLine) => number) => lines.filter((l) => l.block === b).reduce((s, l) => s + f(l), 0)
  const adj = (b: Block) => adjustments.filter((a) => a.block === b).reduce((s, a) => s + Number(a.amount), 0)
  const retPct = Number(pn.retention_pct ?? 5)
  // the previous notice: from the app when it's there, otherwise as entered on this notice
  const p = previous
    ? { m: previous.measured_works, v: previous.variations, mat: previous.materials_on_site, le: previous.loss_and_expense, c: previous.contra_charges, paid: previous.previously_paid }
    : { m: pn.prev_measured, v: pn.prev_variations, mat: pn.prev_materials, le: pn.prev_loss_and_expense, c: pn.prev_contra, paid: 0 }
  const prevCol = column(Number(p.m ?? 0), Number(p.v ?? 0), Number(p.mat ?? 0), Number(p.le ?? 0), Number(p.c ?? 0), Number(previous?.retention_pct ?? retPct), Number(p.paid ?? 0))
  // previously paid = what the previous notice certified after retention, to the penny (Lumen £13,704.51)
  const prevPaid = pn.previously_paid != null ? Number(pn.previously_paid) : r2(prevCol.subTotal)
  const theirM = sum('measured', lineAmount)
  const theirV = sum('variations', lineAmount)
  const theirMat = sum('materials', lineAmount)
  const le = Number(pn.loss_and_expense ?? 0)
  const contra = Number(pn.contra_charges ?? 0)
  const theirs = {
    ...column(theirM, theirV, theirMat, 0, 0, retPct, prevPaid),
    measuredValue: sum('measured', (l) => Number(l.value ?? 0)),
    variationsValue: sum('variations', (l) => Number(l.value ?? 0)),
  }
  // DuB: each line as DBP certified it (as claimed where not certified), plus the adjustments
  const dub = column(sum('measured', certAmount) + adj('measured'), sum('variations', certAmount) + adj('variations'), sum('materials', certAmount) + adj('materials'), le, contra, retPct, prevPaid)
  return { theirs, dub, previous: prevCol, retentionPct: retPct }
}

// ---------- checks run on every application (docs/decisions.md) ----------
export interface Check {
  level: 'issue' | 'note'
  text: string
}

export function runChecks(args: {
  order: Order
  app: SubApplication
  lines: SubAppLine[]
  vars: SubVariation[]
  totals: NoticeTotals
  hasPrevious: boolean
  pn: PaymentNotice
}): Check[] {
  const { order, app, lines, vars, totals, hasPrevious, pn } = args
  const out: Check[] = []
  const tol = 1 // £1

  // each line's stated % × value vs the amount they claim
  for (const l of lines) {
    if (l.value != null && l.pct != null && l.their_amount != null) {
      const calc = r2(l.value * l.pct)
      if (Math.abs(calc - l.their_amount) > tol)
        out.push({ level: 'issue', text: `${l.item_ref ?? ''} ${l.description ?? ''}: ${Math.round(l.pct * 1000) / 10}% of ${money(l.value)} is ${money(calc)}, but ${money(l.their_amount)} is claimed (${money(l.their_amount - calc)}).` })
    }
  }
  // line totals vs their stated totals
  const linesGross = totals.theirs.measured + totals.theirs.variations + totals.theirs.materials
  if (app.stated_gross != null && Math.abs(linesGross - Number(app.stated_gross)) > tol)
    out.push({ level: 'issue', text: `Their lines add up to ${money(linesGross)} but their stated gross to date is ${money(app.stated_gross)}.` })
  // previous: their figure vs DBP's own last payment notice
  if (app.stated_previous != null) {
    const ours = -totals.previous.subTotal
    const paid = -totals.dub.previouslyPaid
    const matches = [totals.previous.gross, totals.previous.subTotal, paid].some((x) => Math.abs(Math.abs(x) - Number(app.stated_previous)) <= tol)
    if (!matches)
      out.push({ level: 'issue', text: `They show ${money(app.stated_previous)} as previous; DBP's last notice: gross ${money(totals.previous.gross)}, after retention ${money(-ours)}, previously paid on this notice ${money(paid)}.` })
    // they deduct the previous gross, but DBP paid less (retention held): their "due" is understated
    else if (Math.abs(Number(app.stated_previous) - paid) > tol)
      out.push({ level: 'note', text: `They deduct ${money(app.stated_previous)} as previous, but DBP paid ${money(paid)} (after retention), so their own figure is ${money(Number(app.stated_previous) - paid)} too low; this notice uses the amount actually paid.` })
  }
  if (app.app_no > 1 && !hasPrevious && pn.prev_measured == null)
    out.push({ level: 'issue', text: `No Payment Notice ${app.app_no - 1} on file: enter the previous notice's figures so the previous / movement columns and previously paid can be checked.` })
  // their variations vs DBP's subcontract variation list
  const known = new Map(vars.map((v) => [(v.ref ?? '').trim().toLowerCase(), v]))
  for (const l of lines.filter((x) => x.block === 'variations')) {
    const v = known.get((l.item_ref ?? '').trim().toLowerCase())
    if (!v) out.push({ level: 'issue', text: `Variation ${l.item_ref ?? ''} ${l.description ?? ''} isn't on DBP's variation list for this order.` })
    else {
      if (v.value != null && l.value != null && Math.abs(Number(v.value) - l.value) > tol) out.push({ level: 'issue', text: `Variation ${l.item_ref}: they value it at ${money(l.value)}, DBP's list says ${money(v.value)}.` })
      if (!v.instructed) out.push({ level: 'note', text: `Variation ${l.item_ref} is claimed but not marked as instructed.` })
    }
    if (l.value == null && (l.description ?? '').trim()) out.push({ level: 'issue', text: `Variation ${l.item_ref ?? ''} ${l.description}: no value given.` })
  }
  // order value vs their contract sum
  if (order.order_value != null && Math.abs(Number(order.order_value) - totals.theirs.measuredValue) > tol)
    out.push({ level: 'issue', text: `Their contract works total ${money(totals.theirs.measuredValue)}; the order value is ${money(order.order_value)}.` })
  if (!order.order_no) out.push({ level: 'note', text: 'No order number on this order.' })
  // 100% claimed on supply items is worth a look
  for (const l of lines.filter((x) => x.block === 'measured' && x.pct === 1 && (x.value ?? 0) > 5000))
    out.push({ level: 'note', text: `${l.item_ref ?? ''} ${l.description}: 100% claimed (${money(l.value)}): confirm delivered or installed.` })
  return out
}

// ---------- pasting lines from their Excel / PDF ----------
// Rows copied from a spreadsheet arrive tab-separated. Recognised layouts (by column count):
//   ref | description | value | % | amount     (5+)
//   description | value | % | amount           (4)
//   description | value | %                    (3)
// A row with text but no value starts a new heading (section). % may be 40 or 40% or 0.4.
export function parsePasted(text: string, block: Block): SubAppLine[] {
  const num = (s: string | undefined) => {
    if (s == null) return null
    const t = s.replace(/[£,\s]/g, '')
    if (!t || !/^-?\d*\.?\d+%?$/.test(t)) return null
    return Number(t.replace('%', ''))
  }
  const pct = (s: string | undefined) => {
    if (s == null) return null
    const n = num(s)
    if (n == null) return null
    return s.includes('%') || n > 1 ? n / 100 : n
  }
  const out: SubAppLine[] = []
  let heading: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue
    const c = raw.split('\t').map((x) => x.trim())
    let ref: string | null = null
    let desc: string, v: string | undefined, p: string | undefined, a: string | undefined
    if (c.length >= 5) [ref, desc, v, p, a] = [c[0] || null, c[1], c[2], c[3], c[4]]
    else if (c.length === 4) [desc, v, p, a] = c
    else if (c.length === 3) [desc, v, p] = c
    else [desc, v] = [c[0], c[1]]
    const value = num(v)
    if (value == null && !num(a)) {
      heading = [ref, desc].filter(Boolean).join(' ') || heading
      continue
    }
    const line: SubAppLine = { block, heading, item_ref: ref, description: desc || null, value, pct: pct(p), amount: null, their_amount: num(a), note: null, sort: out.length }
    line.amount = lineAmount(line)
    out.push(line)
  }
  return out
}
