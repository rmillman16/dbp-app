// The company dashboard (22 Nov): one row per job, from figures the modules already hold. Nothing new is
// calculated here: margin and value are the job's latest finalised CVR, cash is what applications record as
// paid, the programme finish is the job's programme, overdue items are open reminders past their date, and hire
// is the hire requisitions. A part you can't open (Settings › Access) just comes back empty.
import { supabase } from './supabase'
import { todayIso } from './format'
import type { Job } from './types'
import type { CvrResult } from './cvrCalc'

export interface DashRow {
  job: Job
  value: number | null // anticipated final value (CVR), else the contract sum
  valueFromCvr: boolean
  margin: number | null
  marginPct: number | null
  cvrDate: string | null
  received: number // paid to date (applications)
  lastApp: { no: number; status: string; date: string | null } | null
  forecastFinish: string | null // the programme's finish
  slipDays: number | null // programme finish against the PC date (+ late)
  overdue: number // open reminders past their date (one per item, however many people it's addressed to)
  openReqs: number // requisitions not yet ordered
  onHire: number
  hireSpend: number // order value of hire ordered / on hire / off-hired
  hireOverdue: number // on hire past its end date
}

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)

async function rows<T>(q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data } = await q
  return data ?? [] // a part you can't open, or a script not run yet: just nothing
}

export async function loadDashboard(statuses: string[]): Promise<DashRow[]> {
  const { data: jobs, error } = await supabase.from('jobs').select('*').in('status', statuses).order('job_no', { ascending: false })
  if (error) throw new Error(error.message)
  const list = (jobs ?? []) as Job[]
  if (list.length === 0) return []
  const ids = list.map((j) => j.id)
  const today = todayIso()

  const [cvrs, apps, progs, notes, reqs] = await Promise.all([
    rows<{ job_id: string; period_end: string; summary: CvrResult | null }>(
      supabase.from('cvrs').select('job_id, period_end, summary').eq('status', 'final').in('job_id', ids).order('period_end', { ascending: false }),
    ),
    rows<{ job_id: string; app_no: number; revision: number; status: string; valuation_date: string | null; paid_amount: number | null }>(
      supabase.from('applications').select('job_id, app_no, revision, status, valuation_date, paid_amount').in('job_id', ids),
    ),
    rows<{ job_id: string; finish_date: string | null; imported_at: string }>(
      supabase.from('programmes').select('job_id, finish_date, imported_at').in('job_id', ids).order('imported_at', { ascending: false }),
    ),
    rows<{ job_id: string; kind: string; source_table: string | null; source_id: string | null; title: string }>(
      supabase.from('notifications').select('job_id, kind, source_table, source_id, title').eq('status', 'open').lt('due_date', today).in('job_id', ids),
    ),
    rows<{ job_id: string; kind: string; status: string; order_value: number | null; data: Record<string, unknown> }>(
      supabase.from('requisitions').select('job_id, kind, status, order_value, data').in('job_id', ids),
    ),
  ])

  return list.map((job) => {
    const cvr = cvrs.find((c) => c.job_id === job.id && c.summary)
    const s = cvr?.summary ?? null
    const jobApps = apps.filter((a) => a.job_id === job.id)
    const last = [...jobApps].sort((a, b) => b.app_no - a.app_no || b.revision - a.revision)[0]
    const prog = progs.find((p) => p.job_id === job.id && p.finish_date)
    const finish = prog?.finish_date ?? null
    const overdueKeys = new Set(notes.filter((n) => n.job_id === job.id).map((n) => `${n.kind}|${n.source_table}|${n.source_id ?? n.title}`))
    const jobReqs = reqs.filter((r) => r.job_id === job.id)
    const hire = jobReqs.filter((r) => r.kind === 'hire')
    const on = hire.filter((r) => r.status === 'ordered' || r.status === 'delivered')
    return {
      job,
      value: s?.value.afv ?? job.contract_sum ?? null,
      valueFromCvr: !!s,
      margin: s?.margin ?? null,
      marginPct: s?.marginPct ?? null,
      cvrDate: cvr?.period_end ?? null,
      received: jobApps.reduce((t, a) => t + (a.paid_amount ?? 0), 0),
      lastApp: last ? { no: last.app_no, status: last.status, date: last.valuation_date } : null,
      forecastFinish: finish,
      slipDays: finish && job.pc_date ? days(job.pc_date, finish) : null,
      overdue: overdueKeys.size,
      openReqs: jobReqs.filter((r) => ['new', 'query', 'answered'].includes(r.status)).length,
      onHire: on.length,
      hireSpend: hire.filter((r) => ['ordered', 'delivered', 'off_hired'].includes(r.status)).reduce((t, r) => t + (r.order_value ?? 0), 0),
      hireOverdue: on.filter((r) => typeof r.data?.hire_end === 'string' && (r.data.hire_end as string) < today).length,
    }
  })
}
