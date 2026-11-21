// Cashflow: loading and saving (the sums are in cashflowCalc.ts; docs/decisions.md "Cashflow: built").
import { supabase } from './supabase'
import { cached, must } from './offline'
import { loadJobVariations, projectedValue } from './variations'
import { loadProgramme } from './programme'
import { loadBudgetLines, loadPackages } from './cvr'
import { GROUP_LABELS, byGroupThenName, groupOf } from './cvrCalc'
import { defaultWeights, packageValues, suggestTasks, suggestTrade, type CfItem, type CfStage, type CfWeight, type LineValue, type Timing } from './cashflowCalc'
import type { Job } from './types'

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
        weights.map((w) => ({
          job_id: jobId,
          item_key: key,
          stage_id: w.stage_id,
          pct: w.pct,
          amount: w.amount ?? null,
          timing: w.timing,
          task_codes: w.task_codes?.length ? w.task_codes : null,
          on_date: w.timing === 'date' ? w.on_date : null,
        })),
      ),
    )
}

export interface CashflowItem extends CfItem {
  group: string // works group, as the CVR (Labour & materials, Subcontractors, Preliminaries, Other), or Variations
  defaulted: boolean // no weighting saved: the starting weighting is used
  suggested: boolean // its activities are suggested from its name, not yet chosen
  parent?: string // a SoW line with its own weighting: the trade it belongs to
  sources?: string[] // the CVR packages that make up this trade (itself plus e.g. "Subbie – 9 Electrical installation")
  lines?: (LineValue & { itemKey: string; own: boolean })[] // the trade's SoW line items; own = has its own weighting
}

// a CVR package and the trade it goes into in the cashflow (shown so it can be changed)
export interface TradeChoice {
  id: string
  name: string
  value: number
  trade: string // where it goes now (its own name = its own row)
  suggested: boolean // the app's suggestion, not yet confirmed
}

// where a package goes: null = the suggestion, '' = its own row, a name = that trade (script 021)
export async function saveTrade(packageId: string, trade: string | null) {
  await must1(supabase.from('packages').update({ cashflow_trade: trade }).eq('id', packageId))
}
// a SoW line's own weighting is kept under this key (gone = it follows its trade)
export const lineKey = (trade: string, line: string) => `line:${trade}::${line}`

// the starting stages are made once per job: the page can load twice at the same moment, and
// both used to see none and make a set each (found 20 Nov, everything doubled)
const creating = new Map<string, Promise<void>>()
async function ensureStages(jobId: string) {
  let stages = await loadStages(jobId)
  if (!stages.length && navigator.onLine) {
    if (!creating.has(jobId)) creating.set(jobId, createDefaultStages(jobId))
    await creating.get(jobId)
    stages = await loadStages(jobId)
  }
  // tidy a doubled set: the same name twice, the later one not used by any section, goes
  const seen = new Set<string>()
  const extra = stages.filter((s) => {
    const k = s.name.trim().toLowerCase()
    if (seen.has(k)) return true
    seen.add(k)
    return false
  })
  if (extra.length && navigator.onLine) {
    const used = new Set((await must<{ stage_id: string }[]>(supabase.from('cashflow_weights').select('stage_id').eq('job_id', jobId))).map((w) => w.stage_id))
    const gone = extra.filter((s) => !used.has(s.id)).map((s) => s.id)
    if (gone.length) {
      await must1(supabase.from('cashflow_stages').delete().in('id', gone))
      stages = await loadStages(jobId)
    }
  }
  return stages
}

// The items: the job's works packages (as the CVR, from the office SoW imported on the CVR tab)
// with their share of OH&P; margin not tied to a package and any difference to the contract sum
// (spread in line with everything else); agreed VOs; issued VOs at risk. Not-issued and rejected
// VOs aren't in the cashflow.
export async function loadCashflow(job: Job) {
  const stages = await ensureStages(job.id)
  const [packages, lines, vos, prog, items, weights] = await Promise.all([
    loadPackages(job.id),
    loadBudgetLines(job.id).catch(() => []),
    loadJobVariations(job),
    loadProgramme(job.id),
    cached(`cashflow-items:${job.id}`, () => must<{ item_key: string; task_codes: string[] }[]>(supabase.from('cashflow_items').select('item_key, task_codes').eq('job_id', job.id))),
    cached(`cashflow-weights:${job.id}`, () => must<SavedWeight[]>(supabase.from('cashflow_weights').select('*').eq('job_id', job.id))),
  ])
  const linked = new Map(items.map((i) => [i.item_key, i.task_codes ?? []]))
  const stageIds = new Set(stages.map((s) => s.id))
  const make = (key: string, label: string, kind: CfItem['kind'], value: number, group: string, inherit?: string[]): CashflowItem => {
    // not chosen yet: a line takes its trade's activities, a trade those that match its name
    const chosen = linked.get(key)
    const tasks = chosen ?? inherit ?? (kind === 'package' ? suggestTasks(label, prog.tasks) : [])
    const saved = weights
      .filter((w) => w.item_key === key && stageIds.has(w.stage_id))
      .map((w) => ({ stage_id: w.stage_id, pct: Number(w.pct), amount: w.amount == null ? null : Number(w.amount), timing: w.timing as Timing, task_codes: w.task_codes, on_date: w.on_date }))
    const defaulted = !saved.length
    return { key, label, kind, value, group, tasks, weights: defaulted ? defaultWeights({ kind, tasks }, stages) : saved, defaulted, suggested: !chosen && tasks.length > 0 }
  }

  const pv = packageValues(
    packages.map((p) => ({ name: p.name, kind: p.kind, budget: p.budget == null ? null : Number(p.budget) })),
    lines,
  )
  const byName = new Map(packages.map((p) => [p.name, p]))
  const names = [...pv.values.keys()]

  // ---- packages into trades (Richard, 21 Nov): "Subbie – 9 Electrical installation" → Electrical ----
  const choice = (name: string) => {
    const set = byName.get(name)?.cashflow_trade
    if (set === '') return { trade: name, suggested: false }
    if (set && set !== name && pv.values.has(set)) return { trade: set, suggested: false }
    const s = /^subbie/i.test(name) ? suggestTrade(name, names) : null
    return s ? { trade: s, suggested: true } : { trade: name, suggested: false }
  }
  const tradeOf = (name: string) => {
    let t = name
    for (let i = 0; i < 5 && choice(t).trade !== t; i++) t = choice(t).trade // A → B → C
    return t
  }
  const trades = new Map<string, { value: number; sources: string[]; lines: LineValue[] }>()
  const choices: TradeChoice[] = []
  for (const [name, value] of pv.values) {
    const t = tradeOf(name)
    const c = choice(name)
    const p = byName.get(name)
    if (p && (/^subbie/i.test(name) || p.cashflow_trade != null)) choices.push({ id: p.id, name, value, trade: t, suggested: c.suggested })
    const tr = trades.get(t) ?? { value: 0, sources: [], lines: [] }
    tr.value += value
    tr.sources.push(name)
    for (const l of pv.items.get(name) ?? []) {
      const same = tr.lines.find((x) => x.key === l.key)
      if (same) same.value = Math.round((same.value + l.value) * 100) / 100
      else tr.lines.push({ ...l })
    }
    trades.set(t, tr)
  }

  // ---- each trade, then its SoW lines that have their own weighting ----
  const own = new Set(weights.filter((w) => w.item_key.startsWith('line:')).map((w) => w.item_key))
  const list: CashflowItem[] = []
  const sorted = [...trades]
    .map(([name, t]) => {
      const p = byName.get(name)
      return { name, t, group: groupOf({ kind: p?.kind ?? 'cost', name, cvr_group: p?.cvr_group ?? null }) }
    })
    .sort((a, b) => byGroupThenName({ group: a.group, name: a.name }, { group: b.group, name: b.name }))
  for (const { name, t, group } of sorted) {
    const key = `pkg:${name}`
    const lines = t.lines.map((l) => ({ ...l, itemKey: lineKey(name, l.key), own: own.has(lineKey(name, l.key)) }))
    const ownValue = lines.filter((l) => l.own).reduce((s, l) => s + l.value, 0)
    // the CVR's prelims lump ("Preliminaries – not yet split") is simply Preliminaries here
    const label = byName.get(name)?.is_remainder ? 'Preliminaries' : name
    const item = make(key, label, group === 'prelims' ? 'prelims' : 'package', Math.round((t.value - ownValue) * 100) / 100, GROUP_LABELS[group])
    list.push({ ...item, sources: t.sources, lines })
    for (const l of lines.filter((x) => x.own))
      list.push({ ...make(l.itemKey, `${l.ref ? `${l.ref} ` : ''}${l.description}`, 'package', l.value, GROUP_LABELS[group], item.tasks), parent: key })
  }
  // priced lines with no cost in a package: VE omissions (Micro: −£29,459.81), OH&P-only lines
  if (pv.loose) list.push(make('adjust:margin', 'Omissions and OH&P not tied to a package', 'adjust', pv.loose, GROUP_LABELS.other))
  const contract = job.contract_sum == null ? 0 : Math.round((Number(job.contract_sum) - pv.total) * 100) / 100
  if (pv.total && contract) list.push(make('adjust:contract', 'Difference to the contract sum', 'adjust', contract, GROUP_LABELS.other))
  for (const v of vos) {
    if (v.vo.status !== 'agreed' && v.vo.status !== 'issued') continue
    list.push(make(`vo:${v.vo.id}`, `VO ${v.vo.vo_no} – ${v.vo.title}`, v.vo.status === 'agreed' ? 'vo' : 'vo_risk', Math.round(projectedValue(v.vo, v.build) * 100) / 100, 'Variations'))
  }
  return {
    stages,
    items: list,
    choices,
    trades: sorted.map((s) => s.name),
    programme: prog.programme,
    tasks: prog.tasks,
    sowTotal: pv.total,
    fromLines: pv.fromLines,
    budgetFile: job.cvr_budget_file,
  }
}
