// The company dashboard: the directors' overview (rebuilt 23 Nov; docs/decisions.md "Company dashboard").
// Nothing new is stored: every figure comes from what the modules already hold, loaded in bulk (one query per
// table for all jobs, never one per job). A part the viewer can't open (Settings › Access) just comes back empty;
// the page says so rather than showing it as nothing.
//
// Definitions (all excluding VAT):
//   Gross value  = the latest finalised CVR's anticipated final value (SoW + agreed VOs + possible reduction);
//                  no finalised CVR: the contract sum + every VO's projected value (agreed, issued, not issued)
//   Net value    = the CVR's margin (value less total cost); no CVR: "no CVR", counted separately, never as 0
//   Applied      = the latest application sent (not a draft): £ claimed on its lines + materials on site + L&E
//   Certified    = the latest application the client has assessed: Client Assessment £ on its lines + MoS + L&E
//                  (gross); after retention and deposits it's the "Client certified £" typed on it
//   Paid         = every "Paid £" recorded on applications
//   Owed to DBP  = certified after retention less paid; overdue CLIENT_PAYMENT_DAYS after the assessed
//                  application was submitted (else its valuation date), as the front sheet's "Payment due within 14 days"
//   Retention    = gross certified × the application's retention % (halved once it's ticked practical completion);
//                  half back at PC, the rest at the end of the defects period (no defects date is held)
//   Owed to subcontractors = each order's latest issued payment notice (a later notice means the earlier one was
//                  paid) until its dbp payment date has passed; overdue once its payment due date has passed
import { supabase } from './supabase'
import { addDaysIso, todayIso } from './format'
import { buildUp, projectedValue } from './variations'
import { noticeTotals } from './subcontracts'
import { quoteTotal } from './quotations'
import { prolongation } from './eot'
import type { Adjustment, Application, EnquiryStatus, Job, PaymentNotice, Variation, VariationLine } from './types'

// jobs below this margin are flagged under Margin & risk: change it here
export const TARGET_MARGIN_PCT = 0.1
// the application front sheet says "Payment due within 14 days"
export const CLIENT_PAYMENT_DAYS = 14

export interface CvrFigures {
  date: string
  contractSum: number // the SoW total the CVR used
  agreedVos: number
  possibleReduction: number
  afv: number
  totalCost: number
  margin: number
  marginPct: number
}

export interface JobRow {
  job: Job
  // value
  cvr: CvrFigures | null // latest finalised CVR
  prevCvr: CvrFigures | null // the finalised CVR before it
  vosAgreed: number // projected value of agreed VOs (live, from the VO register)
  vosIssued: number // issued, not yet agreed
  vosNotIssued: number
  vosUnagreedCount: number
  gross: number | null
  net: number | null
  // cash
  applied: number | null
  certifiedGross: number | null
  certifiedNet: number | null
  paid: number
  owed: number
  owedDue: string | null // when the owed money was due
  retention: number
  retentionHalved: boolean // practical completion ticked on the assessed application
  lastApp: { id: string; no: number; revision: number; status: string; date: string | null } | null
  // programme and delivery
  forecastFinish: string | null
  slipDays: number | null // programme finish against PC (+ late)
  eotGrantedDays: number
  overdue: number // open reminders past their date
  openReqs: number
  omOverdue: number
  omOldestDue: string | null
  procLate: number
  procOldest: string | null
  // EOT
  eotOpen: { count: number; days: number; prolongation: number }
}

export interface SubNotice {
  jobId: string
  orderId: string
  noticeId: string
  company: string
  noticeNo: number
  due: number
  paymentDue: string | null
  draft: boolean
  overdue: boolean
}

export interface EnquiryRow {
  id: string
  ref: string
  name: string
  client: string | null
  status: EnquiryStatus
  dueDate: string | null
  value: number | null // its live quotation, null if none priced
  decided: string | null // won / lost: when
}

export interface Pipeline {
  open: EnquiryRow[]
  byStatus: { status: EnquiryStatus; count: number; value: number }[]
  dueThisMonth: EnquiryRow[]
  winRate: { months: number; won: number; decided: number }[]
  wonByMonth: { month: string; value: number; count: number }[] // last 12 months, oldest first
}

export interface Dashboard {
  rows: JobRow[]
  notices: SubNotice[]
  pipeline: Pipeline
  today: string
}

const r2 = (n: number) => Math.round(n * 100) / 100
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
const num = (n: unknown) => (n == null ? 0 : Number(n))

interface Pageable {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>
}
// every row, for any number of ids: ids in chunks (URL length), rows in pages of 1,000.
// A part you can't open, or a script not run yet, just gives nothing.
async function fetchAll<T>(ids: string[], make: (chunk: string[]) => Pageable): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    for (let from = 0; ; from += 1000) {
      const { data, error } = await make(chunk).range(from, from + 999)
      if (error || !data) break
      out.push(...(data as T[]))
      if (data.length < 1000) break
    }
  }
  return out
}
function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>()
  for (const x of xs) {
    const k = key(x)
    const g = m.get(k)
    if (g) g.push(x)
    else m.set(k, [x])
  }
  return m
}

type CvrRow = {
  job_id: string
  period_end: string
  value: { contractSum: number; agreedVos: number; possibleReduction: number; afv: number } | null
  margin: number | null
  marginPct: number | null
  totalCost: number | null
}
type AppRow = Pick<
  Application,
  | 'id'
  | 'job_id'
  | 'app_no'
  | 'revision'
  | 'status'
  | 'valuation_date'
  | 'submitted_date'
  | 'materials_on_site'
  | 'loss_and_expense'
  | 'deposit'
  | 'retention_pct'
  | 'practical_completion'
  | 'client_certified'
  | 'paid_amount'
>

// the latest revision of each application, in order
function latestOf(jobApps: AppRow[]) {
  const byNo = new Map<number, AppRow>()
  for (const a of jobApps) if (!byNo.has(a.app_no) || byNo.get(a.app_no)!.revision < a.revision) byNo.set(a.app_no, a)
  return [...byNo.values()].sort((a, b) => a.app_no - b.app_no)
}

export async function loadDashboard(): Promise<Dashboard> {
  const { data: jobs, error } = await supabase.from('jobs').select('*').order('job_no', { ascending: false })
  if (error) throw new Error(error.message)
  const list = (jobs ?? []) as Job[]
  const ids = list.map((j) => j.id)
  const today = todayIso()
  const placed = ['ordered', 'on_site', 'complete', 'covered', 'nothing_to_order'] // procurement: nothing more to order

  const [cvrs, apps, progs, notes, reqs, vos, orders, claims, events, om, proc, pipeline] = await Promise.all([
    fetchAll<CvrRow>(ids, (c) =>
      supabase
        .from('cvrs')
        .select('job_id, period_end, value:summary->value, margin:summary->margin, marginPct:summary->marginPct, totalCost:summary->totalCost')
        .eq('status', 'final')
        .not('summary', 'is', null)
        .in('job_id', c)
        .order('period_end', { ascending: false }),
    ),
    fetchAll<AppRow>(ids, (c) =>
      supabase
        .from('applications')
        .select(
          'id, job_id, app_no, revision, status, valuation_date, submitted_date, materials_on_site, loss_and_expense, deposit, retention_pct, practical_completion, client_certified, paid_amount',
        )
        .in('job_id', c)
        .order('id'),
    ),
    fetchAll<{ job_id: string; finish_date: string | null; imported_at: string }>(ids, (c) =>
      supabase.from('programmes').select('job_id, finish_date, imported_at').in('job_id', c).order('imported_at', { ascending: false }),
    ),
    fetchAll<{ job_id: string; kind: string; source_table: string | null; source_id: string | null; title: string }>(ids, (c) =>
      supabase.from('notifications').select('job_id, kind, source_table, source_id, title').eq('status', 'open').lt('due_date', today).in('job_id', c).order('id'),
    ),
    fetchAll<{ job_id: string }>(ids, (c) => supabase.from('requisitions').select('job_id').in('status', ['new', 'query', 'answered']).in('job_id', c).order('id')),
    fetchAll<Variation>(ids, (c) => supabase.from('variations').select('id, job_id, status, budget_value, ohp_pct, prelims_pct').in('job_id', c).order('id')),
    fetchAll<{ id: string; job_id: string; company_id: string; trade: string | null }>(ids, (c) =>
      supabase.from('orders').select('id, job_id, company_id, trade').in('job_id', c).order('id'),
    ),
    fetchAll<{ job_id: string; status: string; days_claimed: number | null; weekly_prelims: number | null }>(ids, (c) =>
      supabase.from('eot_claims').select('job_id, status, days_claimed, weekly_prelims').in('job_id', c).order('id'),
    ),
    fetchAll<{ job_id: string; days_granted: number | null }>(ids, (c) => supabase.from('delay_events').select('job_id, days_granted').in('job_id', c).order('id')),
    fetchAll<{ job_id: string; due_date: string }>(ids, (c) =>
      supabase
        .from('om_requirements')
        .select('job_id, due_date')
        .in('status', ['not_requested', 'requested', 'rejected_resubmit'])
        .lt('due_date', today)
        .in('job_id', c)
        .order('id'),
    ),
    fetchAll<{ job_id: string; latest_order_date: string }>(ids, (c) =>
      supabase
        .from('procurement_items')
        .select('job_id, latest_order_date')
        .not('status', 'in', `(${placed.join(',')})`)
        .lt('latest_order_date', today)
        .in('job_id', c)
        .order('id'),
    ),
    loadPipeline(today),
  ])

  // second round: what hangs off the first (still in bulk)
  const appsByJob = groupBy(apps, (a) => a.job_id)
  const sent = new Map<string, AppRow>() // job → latest application sent
  const assessed = new Map<string, AppRow>() // job → latest the client has assessed
  for (const [jobId, ja] of appsByJob) {
    const latest = latestOf(ja)
    const s = latest.filter((a) => a.status !== 'draft').pop()
    const c = latest.filter((a) => a.client_certified != null || a.status === 'assessed' || a.status === 'paid').pop()
    if (s) sent.set(jobId, s)
    if (c) assessed.set(jobId, c)
  }
  const appIds = [...new Set([...sent.values(), ...assessed.values()].map((a) => a.id))]
  const [appLines, voLines, notices, companies] = await Promise.all([
    fetchAll<{ application_id: string; amount_claimed: number | null; client_amount: number | null }>(appIds, (c) =>
      supabase.from('application_lines').select('application_id, amount_claimed, client_amount').in('application_id', c).order('id'),
    ),
    fetchAll<VariationLine>(
      vos.map((v) => v.id),
      (c) => supabase.from('variation_lines').select('id, variation_id, section, qty, rate').in('variation_id', c).order('id'),
    ),
    fetchAll<PaymentNotice>(
      orders.map((o) => o.id),
      (c) => supabase.from('payment_notices').select('*').in('order_id', c).order('id'),
    ),
    fetchAll<{ id: string; name: string }>([...new Set(orders.map((o) => o.company_id))], (c) => supabase.from('companies').select('id, name').in('id', c).order('id')),
  ])

  // ---- per job ----
  const toCvr = (c: CvrRow | undefined): CvrFigures | null =>
    c && c.value && c.margin != null
      ? {
          date: c.period_end,
          contractSum: num(c.value.contractSum),
          agreedVos: num(c.value.agreedVos),
          possibleReduction: num(c.value.possibleReduction),
          afv: num(c.value.afv),
          totalCost: num(c.totalCost),
          margin: num(c.margin),
          marginPct: num(c.marginPct),
        }
      : null
  const cvrsByJob = groupBy(cvrs, (c) => c.job_id)
  const linesByApp = groupBy(appLines, (l) => l.application_id)
  const linesByVo = groupBy(voLines, (l) => l.variation_id ?? '')
  const vosByJob = groupBy(vos, (v) => v.job_id)
  const progsByJob = groupBy(progs, (p) => p.job_id)
  const notesByJob = groupBy(notes, (n) => n.job_id)
  const reqsByJob = groupBy(reqs, (r) => r.job_id)
  const omByJob = groupBy(om, (o) => o.job_id)
  const procByJob = groupBy(proc, (p) => p.job_id)
  const claimsByJob = groupBy(claims, (c) => c.job_id)
  const eventsByJob = groupBy(events, (e) => e.job_id)

  const rows: JobRow[] = list.map((job) => {
    const jc = cvrsByJob.get(job.id) ?? []
    const cvr = toCvr(jc[0])
    const prevCvr = toCvr(jc[1])

    // VOs from the register: what each adds to the final account (firm price once priced, else budget)
    let vosAgreed = 0
    let vosIssued = 0
    let vosNotIssued = 0
    let vosUnagreedCount = 0
    const jobVos = vosByJob.get(job.id) ?? []
    for (const v of jobVos) {
      const val = projectedValue(v, buildUp(linesByVo.get(v.id) ?? [], v, job))
      if (v.status === 'agreed') vosAgreed += val
      else if (v.status === 'issued') {
        vosIssued += val
        vosUnagreedCount++
      } else if (v.status === 'not_issued') {
        vosNotIssued += val
        vosUnagreedCount++
      }
    }
    const noCvrGross = job.contract_sum == null && !jobVos.length ? null : r2(num(job.contract_sum) + vosAgreed + vosIssued + vosNotIssued)

    // cash
    const s = sent.get(job.id)
    const a = assessed.get(job.id)
    const sumLines = (app: AppRow, f: 'amount_claimed' | 'client_amount') => (linesByApp.get(app.id) ?? []).reduce((t, l) => t + num(l[f]), 0)
    const applied = s ? r2(sumLines(s, 'amount_claimed') + num(s.materials_on_site) + num(s.loss_and_expense)) : null
    let certifiedGross: number | null = null
    let certifiedNet: number | null = null
    let retention = 0
    if (a) {
      const fullPct = a.retention_pct != null ? Number(a.retention_pct) : Number(job.retention_pct ?? 0)
      const pct = (a.practical_completion ? fullPct / 2 : fullPct) / 100
      const fromLines = sumLines(a, 'client_amount')
      // gross from the Client Assessment lines; none typed: worked back from the certified total
      certifiedGross = fromLines
        ? r2(fromLines + num(a.materials_on_site) + num(a.loss_and_expense))
        : a.client_certified != null && pct < 1
          ? r2((num(a.client_certified) + num(a.deposit)) / (1 - pct))
          : null
      retention = certifiedGross != null ? r2(certifiedGross * pct) : 0
      certifiedNet = a.client_certified != null ? num(a.client_certified) : certifiedGross != null ? r2(certifiedGross - retention - num(a.deposit)) : null
    }
    const paid = r2((appsByJob.get(job.id) ?? []).reduce((t, x) => t + num(x.paid_amount), 0))
    const owed = certifiedNet != null ? Math.max(0, r2(certifiedNet - paid)) : 0
    const from = a?.submitted_date ?? a?.valuation_date ?? null
    const last = latestOf(appsByJob.get(job.id) ?? []).pop()

    const finish = (progsByJob.get(job.id) ?? []).find((p) => p.finish_date)?.finish_date ?? null
    const jobOm = (omByJob.get(job.id) ?? []).map((o) => o.due_date).sort()
    const jobProc = (procByJob.get(job.id) ?? []).map((p) => p.latest_order_date).sort()
    const open = (claimsByJob.get(job.id) ?? []).filter((c) => c.status !== 'granted' && c.status !== 'rejected')

    return {
      job,
      cvr,
      prevCvr,
      vosAgreed: r2(vosAgreed),
      vosIssued: r2(vosIssued),
      vosNotIssued: r2(vosNotIssued),
      vosUnagreedCount,
      gross: cvr ? cvr.afv : noCvrGross,
      net: cvr ? cvr.margin : null,
      applied,
      certifiedGross,
      certifiedNet,
      paid,
      owed,
      owedDue: owed > 0.5 && from ? addDaysIso(from, CLIENT_PAYMENT_DAYS) : null,
      retention,
      retentionHalved: !!a?.practical_completion,
      lastApp: last ? { id: last.id, no: last.app_no, revision: last.revision, status: last.status, date: last.valuation_date } : null,
      forecastFinish: finish,
      slipDays: finish && job.pc_date ? days(job.pc_date, finish) : null,
      eotGrantedDays: (eventsByJob.get(job.id) ?? []).reduce((t, e) => t + num(e.days_granted), 0),
      overdue: new Set((notesByJob.get(job.id) ?? []).map((n) => `${n.kind}|${n.source_table}|${n.source_id ?? n.title}`)).size,
      openReqs: reqsByJob.get(job.id)?.length ?? 0,
      omOverdue: jobOm.length,
      omOldestDue: jobOm[0] ?? null,
      procLate: jobProc.length,
      procOldest: jobProc[0] ?? null,
      eotOpen: {
        count: open.length,
        days: open.reduce((t, c) => t + num(c.days_claimed), 0),
        prolongation: r2(open.reduce((t, c) => t + prolongation(num(c.days_claimed), c.weekly_prelims ?? job.weekly_prelims), 0)),
      },
    }
  })

  // ---- what DBP owes subcontractors ----
  const companyName = new Map(companies.map((c) => [c.id, c.name]))
  const noticesByOrder = groupBy(notices, (n) => n.order_id)
  const owing: SubNotice[] = []
  for (const o of orders) {
    const ns = (noticesByOrder.get(o.id) ?? []).sort((x, y) => x.notice_no - y.notice_no)
    // the notice's stored DuB assessment, through the same sums as the notice itself
    const due = (pn: PaymentNotice) => {
      const stored: Adjustment[] = [
        { block: 'measured', description: '', amount: num(pn.measured_works), sort: 0 },
        { block: 'variations', description: '', amount: num(pn.variations), sort: 1 },
        { block: 'materials', description: '', amount: num(pn.materials_on_site), sort: 2 },
      ]
      return r2(noticeTotals(pn, [], stored, ns.find((p) => p.notice_no === pn.notice_no - 1) ?? null).dub.due)
    }
    const issued = ns.filter((n) => n.status === 'issued')
    const latest = issued[issued.length - 1]
    const base = { jobId: o.job_id, orderId: o.id, company: companyName.get(o.company_id) ?? o.trade ?? 'Subcontractor' }
    if (latest && !(latest.dbp_payment_date && latest.dbp_payment_date <= today))
      owing.push({
        ...base,
        noticeId: latest.id,
        noticeNo: latest.notice_no,
        due: due(latest),
        paymentDue: latest.payment_due_date,
        draft: false,
        overdue: !!latest.payment_due_date && latest.payment_due_date < today,
      })
    for (const d of ns.filter((n) => n.status === 'draft' && (!latest || n.notice_no > latest.notice_no)))
      owing.push({ ...base, noticeId: d.id, noticeNo: d.notice_no, due: due(d), paymentDue: d.payment_due_date, draft: true, overdue: false })
  }
  owing.sort((x, y) => Number(x.draft) - Number(y.draft) || Number(y.overdue) - Number(x.overdue) || (x.paymentDue ?? '9').localeCompare(y.paymentDue ?? '9'))

  return { rows, notices: owing, pipeline, today }
}

// ---- Estimating: enquiries and their quotations ----
async function loadPipeline(today: string): Promise<Pipeline> {
  const { data } = await supabase.from('enquiries').select('id, enquiry_no, name, client_name, status, due_date, updated_at').order('enquiry_no', { ascending: false })
  const enquiries = (data ?? []) as {
    id: string
    enquiry_no: number
    name: string
    client_name: string | null
    status: EnquiryStatus
    due_date: string | null
    updated_at: string
  }[]
  const quotes = await fetchAll<{ id: string; enquiry_id: string; quote_no: number; status: string; accepted_date: string | null }>(
    enquiries.map((e) => e.id),
    (c) => supabase.from('quotations').select('id, enquiry_id, quote_no, status, accepted_date').in('enquiry_id', c).order('id'),
  )
  const lines = await fetchAll<{ quotation_id: string; qty: number | null; rate: number | null }>(
    quotes.map((q) => q.id),
    (c) => supabase.from('quotation_lines').select('id, quotation_id, qty, rate').in('quotation_id', c).order('id'),
  )
  const linesByQuote = groupBy(lines, (l) => l.quotation_id)
  const quotesByEnq = groupBy(quotes, (q) => q.enquiry_id)

  const rows: EnquiryRow[] = enquiries.map((e) => {
    const qs = (quotesByEnq.get(e.id) ?? []).sort((a, b) => a.quote_no - b.quote_no)
    // the accepted quotation(s), else the latest that isn't rejected or withdrawn
    const accepted = qs.filter((q) => q.status === 'accepted')
    const live = accepted.length ? accepted : qs.filter((q) => q.status !== 'rejected' && q.status !== 'withdrawn').slice(-1)
    const value = live.length ? r2(live.reduce((t, q) => t + quoteTotal(linesByQuote.get(q.id) ?? []), 0)) : null
    const acceptedOn = accepted
      .map((q) => q.accepted_date)
      .filter((d): d is string => !!d)
      .sort()
      .pop()
    return {
      id: e.id,
      ref: `E${String(e.enquiry_no).padStart(3, '0')}`,
      name: e.name,
      client: e.client_name,
      status: e.status,
      dueDate: e.due_date,
      value,
      // won: the quotation's acceptance date, else when the enquiry was last changed; lost: when last changed
      decided: e.status === 'won' ? (acceptedOn ?? e.updated_at.slice(0, 10)) : e.status === 'lost' ? e.updated_at.slice(0, 10) : null,
    }
  })

  const OPEN: EnquiryStatus[] = ['enquiry', 'pricing', 'submitted']
  const open = rows.filter((r) => OPEN.includes(r.status))
  const monthsAgo = (n: number) => {
    const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - n, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  const winRate = [6, 12].map((m) => {
    const since = `${monthsAgo(m)}-${today.slice(8, 10)}` // the same day, m months ago
    const decided = rows.filter((r) => r.decided && r.decided >= since)
    return { months: m, won: decided.filter((r) => r.status === 'won').length, decided: decided.length }
  })
  const wonByMonth = Array.from({ length: 12 }, (_, i) => {
    const m = monthsAgo(11 - i)
    const won = rows.filter((r) => r.status === 'won' && r.decided?.slice(0, 7) === m)
    return { month: m, value: r2(won.reduce((t, r) => t + (r.value ?? 0), 0)), count: won.length }
  })
  return {
    open,
    byStatus: OPEN.map((s) => {
      const xs = open.filter((r) => r.status === s)
      return { status: s, count: xs.length, value: r2(xs.reduce((t, r) => t + (r.value ?? 0), 0)) }
    }),
    dueThisMonth: open.filter((r) => r.dueDate?.slice(0, 7) === today.slice(0, 7)).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
    winRate,
    wonByMonth,
  }
}
