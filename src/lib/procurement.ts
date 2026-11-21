// Procurement schedule: loading and saving (the grouping and dates are in procurementCalc.ts;
// docs/decisions.md "Procurement: built"). One procurement_items row per package (section A, by
// name) and per issued / agreed VO (section B), made the first time it's saved.
import { supabase } from './supabase'
import { cached, must } from './offline'
import { loadBudgetLines, loadPackages } from './cvr'
import { loadCompanies, loadOrders } from './subcontracts'
import { loadJobVariations, projectedValue } from './variations'
import { loadProgramme } from './programme'
import { GROUP_LABELS, byGroupThenName, groupOf } from './cvrCalc'
import { packageBudgets, procurementLines, type ProcLine, type ProcStatus, type SplitRow } from './procurementCalc'
import type { Job } from './types'

export type SupplyInstall = 'supply' | 'install' | 'supply_and_install'
export const SUPPLY_LABELS: Record<SupplyInstall, string> = { supply: 'Supply', install: 'Install', supply_and_install: 'Supply and install' }

export interface ProcItem {
  id: string | null // null until first saved
  section: 'contract' | 'variation'
  description: string // the package's name (or the VO's)
  variation_id: string | null
  supply_install: SupplyInstall | null
  cdp: boolean
  company_id: string | null
  order_id: string | null
  order_value: number | null
  order_no: string | null
  order_date: string | null
  design_weeks: number | null
  lead_weeks: number | null
  required_on_site: string | null // typed; else from the linked activities
  timeline_task_refs: string[]
  status: ProcStatus
  comments: string | null
}
export interface ProcRow extends ProcItem {
  key: string
  label: string
  group: string
  budget: number // section A: from the SoW lines; section B: the VO's value
  lines: { key: string; ref: string | null; description: string; amount: number }[]
}

const must1 = async <T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
  const r = await p
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}
const blank = (section: ProcItem['section'], description: string, variation_id: string | null = null): ProcItem => ({
  id: null,
  section,
  description,
  variation_id,
  supply_install: null,
  cdp: false,
  company_id: null,
  order_id: null,
  order_value: null,
  order_no: null,
  order_date: null,
  design_weeks: null,
  lead_weeks: null,
  required_on_site: null,
  timeline_task_refs: [],
  status: 'not_started',
  comments: null,
})
const num = (v: unknown) => (v == null ? null : Number(v))

export async function loadProcurement(job: Job) {
  const [packages, budgetLines, vos, prog, companies, orders, items, splits] = await Promise.all([
    loadPackages(job.id),
    loadBudgetLines(job.id).catch(() => []),
    loadJobVariations(job),
    loadProgramme(job.id),
    loadCompanies(),
    loadOrders(job.id),
    cached(`procurement:${job.id}`, () => must<(ProcItem & { id: string })[]>(supabase.from('procurement_items').select('*').eq('job_id', job.id).order('sort'))),
    cached(`procurement-splits:${job.id}`, () => must<SplitRow[]>(supabase.from('procurement_splits').select('line_key, package, amount').eq('job_id', job.id))).catch(() => []),
  ])
  const lines: ProcLine[] = procurementLines(
    packages.map((p) => ({ name: p.name, kind: p.kind })),
    budgetLines,
    splits.map((s) => ({ ...s, amount: Number(s.amount) })),
  )
  const budgets = packageBudgets(lines)
  const byName = new Map(packages.map((p) => [p.name, p]))
  const saved = (i: ProcItem & { id: string }) => ({
    ...i,
    order_value: num(i.order_value),
    design_weeks: num(i.design_weeks),
    lead_weeks: num(i.lead_weeks),
    timeline_task_refs: i.timeline_task_refs ?? [],
  })

  // section A: every package the SoW lines make (plus any added by hand), by works group
  const names = new Set([...budgets.keys(), ...items.filter((i) => i.section === 'contract').map((i) => i.description)])
  const contract: ProcRow[] = [...names]
    .map((name) => {
      const p = byName.get(name)
      return { name, group: groupOf({ kind: p?.kind ?? 'cost', name, cvr_group: p?.cvr_group ?? null }) }
    })
    .sort(byGroupThenName)
    .map(({ name, group }) => {
      const item = items.find((i) => i.section === 'contract' && i.description === name)
      return {
        ...(item ? saved(item) : blank('contract', name)),
        key: `pkg:${name}`,
        label: byName.get(name)?.is_remainder ? 'Preliminaries' : name,
        group: GROUP_LABELS[group],
        budget: budgets.get(name) ?? 0,
        lines: lines.filter((l) => l.alloc[name]).map((l) => ({ key: l.key, ref: l.ref, description: l.description, amount: l.alloc[name] })),
      }
    })

  // section B: issued and agreed VOs, each with what needs ordering
  const variations: ProcRow[] = vos
    .filter((v) => v.vo.status === 'issued' || v.vo.status === 'agreed')
    .map((v) => {
      const item = items.find((i) => i.variation_id === v.vo.id)
      const label = `VO ${v.vo.vo_no} – ${v.vo.title}`
      return {
        ...(item ? saved(item) : blank('variation', label, v.vo.id)),
        key: `vo:${v.vo.id}`,
        label: `${label}${v.vo.status === 'issued' ? ' (issued)' : ''}`,
        group: 'Variations',
        budget: Math.round(projectedValue(v.vo, v.build) * 100) / 100,
        lines: [],
      }
    })

  return { contract, variations, lines, tasks: prog.tasks, companies, orders, hasLines: budgetLines.length > 0 }
}

const FIELDS = [
  'supply_install',
  'cdp',
  'company_id',
  'order_id',
  'order_value',
  'order_no',
  'order_date',
  'design_weeks',
  'lead_weeks',
  'required_on_site',
  'timeline_task_refs',
  'status',
  'comments',
] as const

export async function saveProcItem(jobId: string, row: ProcItem) {
  const fields = Object.fromEntries(FIELDS.map((f) => [f, row[f]]))
  if (row.id) await must1(supabase.from('procurement_items').update(fields).eq('id', row.id))
  else await must1(supabase.from('procurement_items').insert({ job_id: jobId, section: row.section, description: row.description, variation_id: row.variation_id, ...fields }))
}

// a package added by hand (e.g. "Mirrors", for splitting a bar's lines into)
export async function addProcPackage(jobId: string, name: string) {
  await must1(supabase.from('procurement_items').insert({ job_id: jobId, section: 'contract', description: name }))
}

// a line moved or split: null = back to the SoW's own split
export async function saveSplit(jobId: string, lineKey: string, rows: { package: string; amount: number }[] | null) {
  await must1(supabase.from('procurement_splits').delete().eq('job_id', jobId).eq('line_key', lineKey))
  if (rows?.length) await must1(supabase.from('procurement_splits').insert(rows.map((r) => ({ job_id: jobId, line_key: lineKey, package: r.package, amount: r.amount }))))
}
