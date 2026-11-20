// CVR: loading and saving (the sums are in cvrCalc.ts; docs/decisions.md "CVR: built").
import { supabase } from './supabase'
import { cached, must } from './offline'
import { todayIso } from './format'
import { loadJobVariations } from './variations'
import { frontSheet, latestRevisions, loadApplication, loadApplications, loadSowRevision, appName } from './applications'
import { loadCompanies, loadOrders } from './subcontracts'
import { loadEot, programme } from './eot'
import { supplierKey, computeCvr, type Allocation, type CalcInput, type CvrResult, type Forecast, type Group } from './cvrCalc'
import type { BudgetLine, ParsedBudget } from './cvrBudget'
import type { CostLine, ParsedCosts } from './cvrCosts'
import type { Cvr, CvrPackage, Job, SubVariation } from './types'

export type SavedCostLine = CostLine & { id: string; import_id: string }

export function loadPackages(jobId: string) {
  return cached(`packages:${jobId}`, () => must<CvrPackage[]>(supabase.from('packages').select('*').eq('job_id', jobId).order('sort')))
}

export function loadAllocations(jobId: string) {
  return cached(`supplier-packages:${jobId}`, () => must<(Allocation & { job_id: string })[]>(supabase.from('supplier_packages').select('*').eq('job_id', jobId)))
}

export function loadCvrs(jobId: string) {
  return cached(`cvrs:${jobId}`, () => must<Cvr[]>(supabase.from('cvrs').select('*').eq('job_id', jobId).order('period_end')))
}

export function loadCvr(id: string) {
  return cached(`cvr:${id}`, async () => {
    const cvr = await must<Cvr>(supabase.from('cvrs').select('*').eq('id', id).single())
    const costs = cvr.cost_import_id
      ? await must<SavedCostLine[]>(supabase.from('cost_lines').select('*').eq('import_id', cvr.cost_import_id).order('sort'))
      : []
    const imp = cvr.cost_import_id ? await must<{ file_name: string | null; report_date: string | null }>(supabase.from('cost_imports').select('file_name, report_date').eq('id', cvr.cost_import_id).single()) : null
    const forecasts = await must<(Forecast & { cvr_id: string })[]>(supabase.from('cvr_package_forecasts').select('*').eq('cvr_id', id))
    return { cvr, costs, imp, forecasts }
  })
}

const must1 = async <T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
  const r = await p
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

// ---------- budgets ----------
// Re-importing (a new SoW revision) updates each package's budget by name; typed targets,
// notes, orders and supplier allocations are kept. Packages no longer in the SoW go to £0.
export async function importBudget(job: Job, p: ParsedBudget, fileName: string, existing: CvrPackage[]) {
  const byName = new Map(existing.map((x) => [x.name, x]))
  const rows = p.packages.map((k, i) => {
    const old = byName.get(k.name)
    return {
      job_id: job.id,
      name: k.name,
      kind: old?.kind ?? k.kind,
      budget: k.budget,
      sow_column: k.sow_column,
      supplier_note: old?.supplier_note ?? k.supplier_note,
      cvr_group: old?.cvr_group ?? k.group ?? null,
      is_remainder: !!k.is_remainder,
      sort: i,
    }
  })
  await must1(supabase.from('packages').upsert(rows, { onConflict: 'job_id,name' }))
  const gone = existing.filter((x) => !p.packages.some((k) => k.name === x.name)).map((x) => x.id)
  if (gone.length) await must1(supabase.from('packages').update({ budget: 0, sort: 1000 }).in('id', gone))
  // the SoW's lines, for the breakdown sheet of the export (script 018)
  await must1(supabase.from('cvr_budget_lines').delete().eq('job_id', job.id))
  const lines = p.lines.map((l, i) => ({ ...l, job_id: job.id, sort: i }))
  for (let i = 0; i < lines.length; i += 500) await must1(supabase.from('cvr_budget_lines').insert(lines.slice(i, i + 500)))
  await must1(supabase.from('jobs').update({ cvr_budget_file: fileName, cvr_budget_total: p.total, cvr_budget_imported_at: new Date().toISOString() }).eq('id', job.id))
}

export type SavedBudgetLine = BudgetLine & { id: string; job_id: string; sort: number }
export function loadBudgetLines(jobId: string) {
  return cached(`cvr-budget-lines:${jobId}`, () => must<SavedBudgetLine[]>(supabase.from('cvr_budget_lines').select('*').eq('job_id', jobId).order('sort')))
}

export async function savePackage(p: Pick<CvrPackage, 'id' | 'kind' | 'target' | 'target_note' | 'supplier_note' | 'cvr_group'>) {
  const { id, kind, target, target_note, supplier_note, cvr_group } = p
  await must1(supabase.from('packages').update({ kind, target, target_note, supplier_note, cvr_group }).eq('id', id))
}

export async function addPackage(job: Job, name: string, sort: number, group: Group) {
  return must1<CvrPackage>(supabase.from('packages').insert({ job_id: job.id, name, kind: 'cost', budget: 0, sort, cvr_group: group }).select('*').single())
}
export async function linkOrder(orderId: string, packageId: string | null) {
  await must1(supabase.from('orders').update({ package_id: packageId }).eq('id', orderId))
}

export async function linkVo(variationId: string, packageId: string | null) {
  await must1(supabase.from('variations').update({ cvr_package_id: packageId }).eq('id', variationId))
}

// ---------- suppliers to packages ----------
// split: by share (amount null), or by £ (amount set; share kept between 0 and 1 for reference)
export type Split = { package_id: string; share: number; amount?: number | null }[]
export async function saveAllocation(jobId: string, code: string, name: string, split: Split) {
  await must1(supabase.from('supplier_packages').delete().eq('job_id', jobId).eq('supplier_code', code).eq('supplier_name', name))
  if (split.length) await must1(supabase.from('supplier_packages').insert(split.map((s) => ({ job_id: jobId, supplier_code: code, supplier_name: name, ...s }))))
}

// ---------- CVRs ----------
async function saveCosts(job: Job, p: ParsedCosts, fileName: string, periodEnd: string) {
  const imp = await must1<{ id: string }>(
    supabase.from('cost_imports').insert({ job_id: job.id, period_end: periodEnd, file_name: fileName, report_date: p.report_date }).select('id').single(),
  )
  const rows = p.lines.map((l) => ({ ...l, import_id: imp.id }))
  for (let i = 0; i < rows.length; i += 500) await must1(supabase.from('cost_lines').insert(rows.slice(i, i + 500)))
  return imp.id
}

export async function createCvr(job: Job, p: ParsedCosts, fileName: string, periodEnd: string) {
  const importId = await saveCosts(job, p, fileName, periodEnd)
  const cvr = await must1<{ id: string }>(
    supabase.from('cvrs').insert({ job_id: job.id, period_end: periodEnd, cost_import_id: importId, prepared_date: todayIso(), status: 'draft' }).select('id').single(),
  )
  return cvr.id
}

// a corrected report for a draft CVR
export async function replaceCosts(job: Job, cvr: Cvr, p: ParsedCosts, fileName: string) {
  const importId = await saveCosts(job, p, fileName, cvr.period_end)
  await must1(supabase.from('cvrs').update({ cost_import_id: importId }).eq('id', cvr.id))
  if (cvr.cost_import_id) await must1(supabase.from('cost_imports').delete().eq('id', cvr.cost_import_id))
}

export async function saveCvr(cvr: Pick<Cvr, 'id' | 'period_end' | 'prepared_date' | 'possible_reduction' | 'notes'>) {
  const { id, ...rest } = cvr
  await must1(supabase.from('cvrs').update(rest).eq('id', id))
}

export async function saveForecast(cvrId: string, packageId: string, forecast: number | null, note: string | null) {
  if (forecast == null) await must1(supabase.from('cvr_package_forecasts').delete().eq('cvr_id', cvrId).eq('package_id', packageId))
  else await must1(supabase.from('cvr_package_forecasts').upsert({ cvr_id: cvrId, package_id: packageId, forecast, note }, { onConflict: 'cvr_id,package_id' }))
}

// finalising keeps the figures as issued, so later changes to budgets, orders or VOs don't rewrite it
export async function finaliseCvr(cvrId: string, result: CvrResult) {
  await must1(supabase.from('cvrs').update({ status: 'final', summary: result }).eq('id', cvrId))
}
export async function reopenCvr(cvrId: string) {
  await must1(supabase.from('cvrs').update({ status: 'draft', summary: null }).eq('id', cvrId))
}

// ---------- everything the sums need ----------
export interface CvrContext {
  input: CalcInput
  packages: CvrPackage[]
  orders: { id: string; label: string; package_id: string | null }[]
  vos: { id: string; label: string; status: string; cost: number; value: number; package_id: string | null }[]
}

export async function loadContext(job: Job, cvr: Cvr, costs: SavedCostLine[], forecasts: Forecast[]): Promise<CvrContext> {
  const [packages, allocations, orders, companies, vos, cvrs] = await Promise.all([
    loadPackages(job.id),
    loadAllocations(job.id),
    loadOrders(job.id),
    loadCompanies(),
    loadJobVariations(job),
    loadCvrs(job.id),
  ])
  const subVars = orders.length ? await cached(`sub-vars:${job.id}`, () => must<SubVariation[]>(supabase.from('sub_variations').select('*').in('order_id', orders.map((o) => o.id)))) : []
  const orderRows = orders.map((o) => {
    const co = companies.find((c) => c.id === o.company_id)
    return {
      id: o.id,
      package_id: o.package_id,
      label: `${co?.name ?? 'Order'}${o.trade ? ` (${o.trade})` : ''}`,
      order_value: o.order_value,
      instructed_variations: subVars.filter((v) => v.order_id === o.id && v.instructed).reduce((s, v) => s + Number(v.value ?? 0), 0),
    }
  })
  const voRows = vos
    .filter((v) => v.vo.status !== 'rejected')
    .map((v) => ({
      id: v.vo.id,
      label: `VO ${v.vo.vo_no} – ${v.vo.title}`,
      status: v.vo.status,
      cost: Math.round(v.build.subtotal * 100) / 100,
      value: v.build.priced ? Math.round(v.build.total * 100) / 100 : Number(v.vo.budget_value ?? 0),
      package_id: v.vo.cvr_package_id,
    }))

  // last month: the CVR before this one
  const before = cvrs.filter((c) => c.period_end < cvr.period_end).pop()
  const previousCosts = before?.cost_import_id ? await must<SavedCostLine[]>(supabase.from('cost_lines').select('*').eq('import_id', before.cost_import_id)) : null

  // gross certified and retention: the latest application the client has assessed
  let certified: CalcInput['certified'] = null
  try {
    const apps = latestRevisions(await loadApplications(job.id)).filter((a) => a.client_certified != null || a.status === 'assessed' || a.status === 'paid')
    const app = apps.filter((a) => !a.valuation_date || a.valuation_date <= cvr.period_end).pop()
    if (app?.sow_revision_id) {
      const [{ lines }, sow] = await Promise.all([loadApplication(app.id), loadSowRevision(app.sow_revision_id)])
      const fs = frontSheet(job, app, sow.lines, lines, vos, 'client')
      certified = { gross: Math.round(fs.totalApplication * 100) / 100, retention: Math.round(-fs.retention * 100) / 100, label: `${appName(app)}${app.valuation_date ? `, valuation ${app.valuation_date}` : ''}` }
    }
  } catch {
    certified = null
  }

  let revisedPc: string | null = null
  try {
    revisedPc = programme(job, (await loadEot(job.id)).events).revisedPc
  } catch {
    revisedPc = null
  }

  return {
    packages,
    orders: orderRows.map(({ id, label, package_id }) => ({ id, label, package_id })),
    vos: voRows,
    input: {
      contractSum: Number(job.contract_sum ?? job.cvr_budget_total ?? 0),
      budgetTotal: job.cvr_budget_total,
      epPct: Number(job.cvr_ep_pct ?? 4),
      packages: packages.map((p) => ({ ...p, budget: p.budget == null ? null : Number(p.budget), target: p.target == null ? null : Number(p.target) })),
      orders: orderRows,
      vos: voRows.filter((v) => v.status === 'agreed'),
      allocations: allocations.map((a) => ({ ...a, share: Number(a.share), amount: a.amount == null ? null : Number(a.amount) })),
      costs: costs.map((c) => ({ ...c, total_cost: Number(c.total_cost ?? 0), last_reported: c.last_reported == null ? null : Number(c.last_reported) })),
      previousCosts: previousCosts?.map((c) => ({ ...c, total_cost: Number(c.total_cost ?? 0), last_reported: null })) ?? null,
      forecasts: forecasts.map((f) => ({ ...f, forecast: f.forecast == null ? null : Number(f.forecast) })),
      possibleReduction: Number(cvr.possible_reduction ?? 0),
      certified,
      programme: { start: job.start_date, originalPc: job.pc_date, revisedPc },
    },
  }
}

export { computeCvr, supplierKey }
