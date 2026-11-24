// The company cashflow (24 Nov): every live job's cashflow forecast added together by month, with what has actually
// been applied, certified and paid beside it. Nothing new is stored: each job's own Cashflow tab figures
// (cashflow.ts + cashflowCalc.ts) are worked out and summed. A job with no programme or no weighting yet is listed
// as left out rather than counted as nothing.
import { loadActuals, loadCashflow, loadStages } from './cashflow'
import { computeCashflow, siteDates } from './cashflowCalc'
import type { Job } from './types'

const r2 = (n: number) => Math.round(n * 100) / 100

export interface CompanyCashMonth {
  month: string // YYYY-MM
  forecast: number // what the jobs' programmes say we'll apply for (excl. variations at risk)
  atRisk: number // issued variations not yet agreed
  net: number // forecast after retention is held / released
  applied: number // actual, from Applications
  certified: number
  paid: number
}

export interface CompanyCashJob {
  job: Job
  months: Record<string, { forecast: number; net: number }>
  total: number
}

export interface CompanyCashflow {
  months: CompanyCashMonth[]
  jobs: CompanyCashJob[]
  left: { job: Job; why: string }[] // jobs not in the figures
}

type OneJob = { why: string; result?: undefined; actuals?: undefined } | { why?: undefined; result: ReturnType<typeof computeCashflow>; actuals: Awaited<ReturnType<typeof loadActuals>> }
async function oneJob(job: Job): Promise<OneJob> {
  const stages = await loadStages(job.id)
  if (!stages.length) return { why: 'no cashflow set up yet' as const }
  const data = await loadCashflow(job)
  if (!data.tasks.length) return { why: 'no programme imported' as const }
  const d = siteDates(data.tasks, { start: job.start_date, pc: job.pc_date })
  const result = computeCashflow({ items: data.items, tasks: data.tasks, siteStart: d.start, pc: d.pc, retentionPct: Number(job.retention_pct ?? 0) })
  if (!result.total) return { why: 'nothing to forecast yet' as const }
  const actuals = await loadActuals(job).catch(() => [])
  return { result, actuals }
}

export async function loadCompanyCashflow(jobs: Job[]): Promise<CompanyCashflow> {
  const byMonth = new Map<string, CompanyCashMonth>()
  const slot = (m: string) => {
    let s = byMonth.get(m)
    if (!s) byMonth.set(m, (s = { month: m, forecast: 0, atRisk: 0, net: 0, applied: 0, certified: 0, paid: 0 }))
    return s
  }
  const out: CompanyCashflow = { months: [], jobs: [], left: [] }
  // a few at a time: each job reads about a dozen tables
  for (let i = 0; i < jobs.length; i += 3) {
    const batch = await Promise.all(jobs.slice(i, i + 3).map((j) => oneJob(j).catch((e: Error): OneJob => ({ why: `couldn't be read (${e.message})` }))))
    batch.forEach((b, k) => {
      const job = jobs[i + k]
      if (!b.result || !b.actuals) return void out.left.push({ job, why: b.why ?? 'not available' })
      const mine: CompanyCashJob = { job, months: {}, total: b.result.total }
      for (const m of b.result.monthly) {
        const s = slot(m.month)
        s.forecast = r2(s.forecast + m.value)
        s.atRisk = r2(s.atRisk + m.atRisk)
        s.net = r2(s.net + m.netMonth)
        mine.months[m.month] = { forecast: m.value, net: m.netMonth }
      }
      for (const a of b.actuals) {
        const s = slot(a.month)
        s.applied = r2(s.applied + (a.applied ?? 0))
        s.certified = r2(s.certified + (a.certified ?? 0))
        s.paid = r2(s.paid + (a.paid ?? 0))
      }
      out.jobs.push(mine)
    })
  }
  out.months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
  return out
}
