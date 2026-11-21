// Cashflow: loading and saving (the sums are in cashflowCalc.ts; docs/decisions.md "Cashflow: built").
import { supabase } from './supabase'
import { cached, must } from './offline'
import { loadJobVariations, projectedValue } from './variations'
import { appName, frontSheet, latestRevisions, loadApplication, loadApplications, loadSowRevision } from './applications'
import { loadProgramme } from './programme'
import { loadBudgetLines, loadPackages } from './cvr'
import { GROUP_LABELS, byGroupThenName, groupOf } from './cvrCalc'
import {
  STANDARD_TRADES,
  defaultWeights,
  packageValues,
  suggestLineTrade,
  suggestTasks,
  suggestTrade,
  type CfItem,
  type CfStage,
  type CfWeight,
  type LineValue,
  type Timing,
} from './cashflowCalc'
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

// ---------- actuals from the Applications module (decided 19 Nov) ----------
// Past months show what was applied (DBP's gross application: internal copy only), certified (the
// client's assessment, gross) and paid. Applications are cumulative, so a month's figure is the
// change from the application before; paid is as entered, in the month it was paid.
export interface Actual {
  month: string // YYYY-MM
  applied: number | null
  certified: number | null
  paid: number | null
  label: string // "Application 3 R1"
}
export async function loadActuals(job: Job): Promise<Actual[]> {
  const apps = latestRevisions(await loadApplications(job.id))
    .filter((a) => a.valuation_date && a.sow_revision_id)
    .sort((a, b) => a.app_no - b.app_no)
  if (!apps.length) return []
  const vos = await loadJobVariations(job)
  const out = new Map<string, Actual>()
  let prevApplied = 0
  let prevCertified = 0
  for (const app of apps) {
    const [{ lines }, sow] = await Promise.all([loadApplication(app.id), loadSowRevision(app.sow_revision_id!)])
    const applied = frontSheet(job, app, sow.lines, lines, vos, 'dbp').totalApplication
    const assessed = app.client_certified != null || app.status === 'assessed' || app.status === 'paid'
    const certified = assessed ? frontSheet(job, app, sow.lines, lines, vos, 'client').totalApplication : null
    const month = app.valuation_date!.slice(0, 7)
    const a = out.get(month) ?? { month, applied: 0, certified: null, paid: null, label: '' }
    a.applied = Math.round(((a.applied ?? 0) + applied - prevApplied) * 100) / 100
    prevApplied = applied
    if (certified != null) {
      a.certified = Math.round(((a.certified ?? 0) + certified - prevCertified) * 100) / 100
      prevCertified = certified
    }
    a.label = appName(app)
    out.set(month, a)
    if (app.paid_amount != null) {
      const pm = (app.paid_date ?? app.valuation_date!).slice(0, 7)
      const p = out.get(pm) ?? { month: pm, applied: null, certified: null, paid: null, label: '' }
      p.paid = Math.round(((p.paid ?? 0) + Number(app.paid_amount)) * 100) / 100
      out.set(pm, p)
    }
  }
  return [...out.values()].sort((a, b) => a.month.localeCompare(b.month))
}

// a subcontract line and the trade it goes into (read from its description, or overruled)
export interface LineTradeChoice extends LineValue {
  section: string // the SoW section it's in (on some jobs an area)
  trade: string
  suggested: boolean // read from the description, not chosen
}
export const NO_TRADE = 'Subcontract – trade to choose'
// null = back to the app's reading of the description (script 022)
export async function saveLineTrade(jobId: string, line: string, trade: string | null) {
  if (trade == null) await must1(supabase.from('cashflow_line_trades').delete().eq('job_id', jobId).eq('line_key', line))
  else await must1(supabase.from('cashflow_line_trades').upsert({ job_id: jobId, line_key: line, trade }, { onConflict: 'job_id,line_key' }))
}

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
    cached(`cashflow-items:${job.id}`, () =>
      must<{ item_key: string; task_codes: string[] }[]>(supabase.from('cashflow_items').select('item_key, task_codes').eq('job_id', job.id)),
    ),
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
      .map((w) => ({
        stage_id: w.stage_id,
        pct: Number(w.pct),
        amount: w.amount == null ? null : Number(w.amount),
        timing: w.timing as Timing,
        task_codes: w.task_codes,
        on_date: w.on_date,
      }))
    const defaulted = !saved.length
    return { key, label, kind, value, group, tasks, weights: defaulted ? defaultWeights({ kind, tasks }, stages) : saved, defaulted, suggested: !chosen && tasks.length > 0 }
  }

  const pv = packageValues(
    packages.map((p) => ({ name: p.name, kind: p.kind, budget: p.budget == null ? null : Number(p.budget) })),
    lines,
  )
  const byName = new Map(packages.map((p) => [p.name, p]))
  // the CVR's Subbie-by-section packages ("Subbie – 4 Basement 2 based on GPAD"): their lines go
  // to trades one by one (below), as a section can be an area, not a trade (Richard, 21 Nov)
  const bySection = (name: string) => /^subbie\s*[–-]\s*\d/i.test(name) && (pv.items.get(name)?.length ?? 0) > 0
  const names = [...pv.values.keys()].filter((n) => !bySection(n))
  const lineTrades = new Map(
    (
      await cached(`cashflow-line-trades:${job.id}`, () =>
        must<{ line_key: string; trade: string }[]>(supabase.from('cashflow_line_trades').select('line_key, trade').eq('job_id', job.id)),
      ).catch(() => [])
    ).map((r) => [r.line_key, r.trade]),
  )

  // ---- packages into trades (Richard, 21 Nov): e.g. Subbie Prelims → Preliminaries ----
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
  const addTo = (t: string, value: number, source: string, ls: LineValue[]) => {
    const tr = trades.get(t) ?? { value: 0, sources: [], lines: [] }
    tr.value += value
    if (!tr.sources.includes(source)) tr.sources.push(source)
    for (const l of ls) {
      const same = tr.lines.find((x) => x.key === l.key)
      if (same) same.value = Math.round((same.value + l.value) * 100) / 100
      else tr.lines.push({ ...l })
    }
    trades.set(t, tr)
  }
  const choices: TradeChoice[] = []
  const lineChoices: LineTradeChoice[] = []
  for (const [name, value] of pv.values) {
    if (bySection(name)) {
      // each subcontract line: its overruled trade, else read from its description
      for (const l of pv.items.get(name) ?? []) {
        const set = lineTrades.get(l.key)
        const guess = suggestLineTrade(l.description, names, name.replace(/^subbie\s*[–-]\s*\d*\s*/i, ''))
        const t = set ?? guess ?? NO_TRADE
        lineChoices.push({ ...l, section: name.replace(/^subbie\s*[–-]\s*/i, ''), trade: t, suggested: !set })
        addTo(t, l.value, name, [l])
      }
      continue
    }
    const t = tradeOf(name)
    const c = choice(name)
    const p = byName.get(name)
    if (p && (/^subbie/i.test(name) || p.cashflow_trade != null)) choices.push({ id: p.id, name, value, trade: t, suggested: c.suggested })
    addTo(t, value, name, pv.items.get(name) ?? [])
  }

  // ---- each trade, then its SoW lines that have their own weighting ----
  const own = new Set(weights.filter((w) => w.item_key.startsWith('line:')).map((w) => w.item_key))
  const list: CashflowItem[] = []
  const sorted = [...trades]
    .map(([name, t]) => {
      const p = byName.get(name)
      // a standard trade made up of subcontract lines (not a CVR package of its own) is a subcontract
      return { name, t, group: p ? groupOf({ kind: p.kind, name, cvr_group: p.cvr_group ?? null }) : ('subcontract' as const) }
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
  // the difference to the contract sum: front-loaded across the site months, tailing off (21 Nov)
  const contract = job.contract_sum == null ? 0 : Math.round((Number(job.contract_sum) - pv.total) * 100) / 100
  if (pv.total && contract) list.push({ ...make('adjust:contract', 'Difference to the contract sum', 'adjust', contract, GROUP_LABELS.other), curve: Number(job.contract_sum) })
  for (const v of vos) {
    if (v.vo.status !== 'agreed' && v.vo.status !== 'issued') continue
    list.push(
      make(`vo:${v.vo.id}`, `VO ${v.vo.vo_no} – ${v.vo.title}`, v.vo.status === 'agreed' ? 'vo' : 'vo_risk', Math.round(projectedValue(v.vo, v.build) * 100) / 100, 'Variations'),
    )
  }
  return {
    stages,
    items: list,
    choices,
    lineChoices,
    // what a line can go into: the job's trades and the usual fit-out trades
    tradeOptions: [...new Set([...names.filter((n) => byName.get(n)?.kind !== 'omit'), ...STANDARD_TRADES])].sort((a, b) => a.localeCompare(b, 'en-GB')),
    trades: sorted.map((s) => s.name),
    contractDiff: contract,
    programme: prog.programme,
    tasks: prog.tasks,
    sowTotal: pv.total,
    fromLines: pv.fromLines,
    budgetFile: job.cvr_budget_file,
  }
}
