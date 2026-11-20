// Cashflow: loading and saving (the sums are in cashflowCalc.ts; docs/decisions.md "Cashflow: built").
import { supabase } from './supabase'
import { cached, must } from './offline'
import { loadCurrentSow } from './applications'
import { loadJobVariations, projectedValue } from './variations'
import { loadProgramme } from './programme'
import { defaultWeights, type CfItem, type CfStage, type CfWeight, type Timing } from './cashflowCalc'
import type { Job, SowLine } from './types'

// the guide every job starts with (Richard, 20 Nov): renamed, added or removed per job.
// Completion is there for prelims' finish (cleans, snagging, handover).
export const DEFAULT_STAGES = ['Deposit', 'Progress', 'Delivery', 'Installation', 'Completion']

const must1 = async <T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
  const r = await p
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

// ---------- stages ----------
export async function loadStages(jobId: string) {
  return cached(`cashflow-stages:${jobId}`, () => must<(CfStage & { sort: number })[]>(supabase.from('cashflow_stages').select('*').eq('job_id', jobId).order('sort')))
}
export async function createDefaultStages(jobId: string) {
  await must1(supabase.from('cashflow_stages').insert(DEFAULT_STAGES.map((name, sort) => ({ job_id: jobId, name, sort }))))
}
export async function renameStage(id: string, name: string) {
  await must1(supabase.from('cashflow_stages').update({ name }).eq('id', id))
}
export async function addStage(jobId: string, name: string, sort: number) {
  await must1(supabase.from('cashflow_stages').insert({ job_id: jobId, name, sort }))
}
// its weights go with it (the items' stages then add up to less than 100% and are flagged)
export async function deleteStage(id: string) {
  await must1(supabase.from('cashflow_stages').delete().eq('id', id))
}
export async function moveStage(a: { id: string; sort: number }, b: { id: string; sort: number }) {
  await must1(supabase.from('cashflow_stages').update({ sort: b.sort }).eq('id', a.id))
  await must1(supabase.from('cashflow_stages').update({ sort: a.sort }).eq('id', b.id))
}

// ---------- each item's activities and weighting ----------
interface SavedWeight extends CfWeight {
  item_key: string
}
export async function saveItem(jobId: string, key: string, taskCodes: string[], weights: CfWeight[] | null) {
  await must1(supabase.from('cashflow_items').upsert({ job_id: jobId, item_key: key, task_codes: taskCodes }, { onConflict: 'job_id,item_key' }))
  await must1(supabase.from('cashflow_weights').delete().eq('job_id', jobId).eq('item_key', key))
  // null = back to the starting weighting (nothing saved)
  if (weights?.length)
    await must1(
      supabase.from('cashflow_weights').insert(
        weights.map((w) => ({ job_id: jobId, item_key: key, stage_id: w.stage_id, pct: w.pct, timing: w.timing, task_codes: w.task_codes?.length ? w.task_codes : null, on_date: w.timing === 'date' ? w.on_date : null })),
      ),
    )
}

export interface CashflowItem extends CfItem {
  defaulted: boolean // no weighting saved: the starting weighting is used
}

// SoW sections (the current priced SoW, below-the-line items left out), prelims, agreed VOs;
// issued VOs are at risk; not-issued and rejected VOs aren't in the cashflow
export function sowSections(lines: SowLine[]) {
  const out: { key: string; label: string; value: number; prelims: boolean }[] = []
  for (const l of lines) {
    if (l.below_line) continue
    if (l.kind === 'section') {
      const label = `${l.section ? `${l.section}. ` : ''}${l.description ?? ''}`.trim()
      if (!out.some((s) => s.key === `sow:${l.section}`)) out.push({ key: `sow:${l.section}`, label, value: 0, prelims: /prelim/i.test(l.description ?? '') })
    } else {
      const s = out.find((x) => x.key === `sow:${l.section}`)
      if (s) s.value += Number(l.total ?? 0)
    }
  }
  return out.map((s) => ({ ...s, value: Math.round(s.value * 100) / 100 }))
}

export async function loadCashflow(job: Job) {
  let stages = await loadStages(job.id)
  if (!stages.length && navigator.onLine) {
    await createDefaultStages(job.id)
    stages = await loadStages(job.id)
  }
  const [sow, vos, prog, items, weights] = await Promise.all([
    loadCurrentSow(job.id),
    loadJobVariations(job),
    loadProgramme(job.id),
    cached(`cashflow-items:${job.id}`, () => must<{ item_key: string; task_codes: string[] }[]>(supabase.from('cashflow_items').select('item_key, task_codes').eq('job_id', job.id))),
    cached(`cashflow-weights:${job.id}`, () => must<SavedWeight[]>(supabase.from('cashflow_weights').select('*').eq('job_id', job.id))),
  ])
  const linked = new Map(items.map((i) => [i.item_key, i.task_codes ?? []]))
  const stageIds = new Set(stages.map((s) => s.id))
  const make = (key: string, label: string, kind: CfItem['kind'], value: number): CashflowItem => {
    const tasks = linked.get(key) ?? []
    const saved = weights
      .filter((w) => w.item_key === key && stageIds.has(w.stage_id))
      .map((w) => ({ stage_id: w.stage_id, pct: Number(w.pct), timing: w.timing as Timing, task_codes: w.task_codes, on_date: w.on_date }))
    const defaulted = !saved.length
    return { key, label, kind, value, tasks, weights: defaulted ? defaultWeights({ kind, tasks }, stages) : saved, defaulted }
  }
  const list: CashflowItem[] = sowSections(sow.lines).map((s) => make(s.key, s.label, s.prelims ? 'prelims' : 'section', s.value))
  for (const v of vos) {
    if (v.vo.status !== 'agreed' && v.vo.status !== 'issued') continue
    list.push(make(`vo:${v.vo.id}`, `VO ${v.vo.vo_no} – ${v.vo.title}`, v.vo.status === 'agreed' ? 'vo' : 'vo_risk', Math.round(projectedValue(v.vo, v.build) * 100) / 100))
  }
  return { stages, items: list, programme: prog.programme, tasks: prog.tasks, sowRevision: sow.rev }
}
