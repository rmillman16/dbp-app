// The cashflow sums (docs/decisions.md "Cashflow: built"). Kept free of the database so it can be
// tested on its own. A client-facing forecast of what DBP will apply for each month:
// - every item (a SoW section, prelims, an agreed VO; issued VOs shown separately as at risk)
//   is paid in stages: the job's own list, Deposit, Progress, Delivery, Installation… as a guide
// - each stage takes a % of the item's value and falls at the start of, spread across (by working
//   day, Monday to Friday) or at the end of its activities, or on a typed date
// - "Start on site to PC" is an activity of its own (the job's dates), for prelims
// - what isn't placed yet (no activities, weights short of 100%) is listed, not lost
// - retention at the job's %, halved from the PC month, as on the applications
// Months are calendar months (valuations fall at month end).

export type Timing = 'start' | 'spread' | 'end' | 'date'
export const TIMING_LABELS: Record<Timing, string> = { start: 'at the start of', spread: 'spread across', end: 'at the end of', date: 'on a date' }
export const SITE = '@site' // start on site to PC
export const SITE_LABEL = 'Start on site to PC'

export type ItemKind = 'section' | 'prelims' | 'vo' | 'vo_risk'
export interface CfStage {
  id: string
  name: string
}
export interface CfWeight {
  stage_id: string
  pct: number // 0–100
  timing: Timing
  task_codes: string[] | null // null = the item's linked activities
  on_date: string | null
}
export interface CfItem {
  key: string // "sow:3", "prelims:1", "vo:<id>"
  label: string
  kind: ItemKind
  value: number
  tasks: string[] // linked activities
  weights: CfWeight[]
}
export interface CfTask {
  code: string
  name: string
  section?: string | null
  trade?: string | null
  start_date: string
  finish_date: string
}
export interface CashflowInput {
  items: CfItem[]
  tasks: CfTask[]
  siteStart: string | null
  pc: string | null
  retentionPct: number
}
export interface CfRow {
  key: string
  label: string
  kind: ItemKind
  value: number
  months: number[] // aligned to the result's months
  unplaced: number
  issues: string[]
}
export interface CfMonth {
  month: string // YYYY-MM
  value: number // this month (excl. VOs at risk)
  atRisk: number // issued VOs this month
  cumulative: number
  cumPct: number
  retention: number // held to date (negative)
  netCumulative: number
  netMonth: number // this month's payment after retention
}
export interface CashflowResult {
  months: string[]
  rows: CfRow[]
  monthly: CfMonth[]
  total: number // excl. VOs at risk
  atRiskTotal: number
  unplaced: number // not yet in a month (excl. at risk)
}

const r2 = (n: number) => Math.round(n * 100) / 100
const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
export const monthOf = (isoDate: string) => isoDate.slice(0, 7)
const isWeekday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6

// working days (Monday to Friday) from start to finish inclusive, counted by month
export function workingDaysByMonth(start: string, finish: string): Map<string, number> {
  const out = new Map<string, number>()
  const end = toDate(finish < start ? start : finish)
  for (let d = toDate(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) if (isWeekday(d)) out.set(iso(d).slice(0, 7), (out.get(iso(d).slice(0, 7)) ?? 0) + 1)
  // a milestone or weekend-only span still lands in its month
  if (!out.size) out.set(monthOf(start), 1)
  return out
}

// n working days after start (Timeline durations), skipping weekends and shutdowns
export function addWorkingDays(start: string, n: number, shutdowns: { start: string; end: string }[] = []) {
  const shut = (d: Date) => shutdowns.some((s) => iso(d) >= s.start.slice(0, 10) && iso(d) <= s.end.slice(0, 10))
  const d = toDate(start)
  for (let left = n; left > 0; ) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (isWeekday(d) && !shut(d)) left--
  }
  return iso(d)
}

const monthsBetween = (a: string, b: string) => {
  const out: string[] = []
  let [y, m] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  while (y < by || (y === by && m <= bm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) (m = 1), y++
  }
  return out
}

// the starting weighting for an item that hasn't been set (agreed 20 Nov):
// prelims 10% set-up at start on site, 80% spread to PC, 10% at PC; a linked section 100% Progress
export function defaultWeights(item: Pick<CfItem, 'kind' | 'tasks'>, stages: CfStage[]): CfWeight[] {
  if (!stages.length) return []
  const progress = stages.find((s) => /progress/i.test(s.name)) ?? stages[0]
  if (item.kind === 'prelims') {
    const first = stages[0].id === progress.id ? null : stages[0]
    const last = stages.find((s) => /complet|finish|handover/i.test(s.name)) ?? (stages[stages.length - 1].id === progress.id ? null : stages[stages.length - 1])
    const w = (s: CfStage, pct: number, timing: Timing): CfWeight => ({ stage_id: s.id, pct, timing, task_codes: [SITE], on_date: null })
    if (!first || !last || first.id === last.id) return [w(progress, 100, 'spread')]
    return [w(first, 10, 'start'), w(progress, 80, 'spread'), w(last, 10, 'end')]
  }
  return item.tasks.length ? [{ stage_id: progress.id, pct: 100, timing: 'spread', task_codes: null, on_date: null }] : []
}

// activities that look like they belong to an item: a shared word in the name, trade or section
const STOP = new Set(['and', 'the', 'for', 'with', 'all', 'works', 'work', 'install', 'installation', 'supply', 'subbie', 'general', 'items', 'item', 'areas', 'area', 'level', 'floor', 'floors'])
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/m\s*&\s*e\b/g, 'mechanical electrical') // programmes say M&E, SoWs spell it out
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.slice(0, 5))
export function suggestTasks(label: string, tasks: CfTask[]): string[] {
  const mine = new Set(words(label))
  if (!mine.size) return []
  return tasks.filter((t) => words(`${t.name} ${t.trade ?? ''}`).some((w) => mine.has(w))).map((t) => t.code)
}

export function computeCashflow(i: CashflowInput): CashflowResult {
  const byCode = new Map(i.tasks.map((t) => [t.code, t]))
  const site = i.siteStart && i.pc ? { code: SITE, name: SITE_LABEL, start_date: i.siteStart, finish_date: i.pc } : null
  const resolve = (code: string) => (code === SITE ? site : byCode.get(code))

  // each item's amounts by month
  const placed = i.items.map((item) => {
    const by = new Map<string, number>()
    const issues: string[] = []
    let unplaced = 0
    const add = (m: string, v: number) => by.set(m, (by.get(m) ?? 0) + v)
    const pctTotal = item.weights.reduce((s, w) => s + Number(w.pct || 0), 0)
    if (!item.weights.length) {
      unplaced += item.value
      if (item.value) issues.push(item.tasks.length ? 'no weighting yet' : 'not linked to the programme yet')
    }
    for (const w of item.weights) {
      const amount = (item.value * Number(w.pct || 0)) / 100
      if (!amount) continue
      if (w.timing === 'date') {
        if (w.on_date) add(monthOf(w.on_date), amount)
        else (unplaced += amount), issues.push('a stage on a date has no date')
        continue
      }
      const codes = w.task_codes?.length ? w.task_codes : item.tasks
      const found = codes.map(resolve).filter((t): t is CfTask => !!t)
      const missing = codes.filter((c) => !resolve(c))
      if (missing.length) issues.push(missing.includes(SITE) ? 'the job has no start on site / PC date' : `${missing.join(', ')} not in the programme`)
      if (!found.length) {
        unplaced += amount
        if (!codes.length) issues.push('a stage has no activities')
        continue
      }
      if (w.timing === 'start') add(monthOf(found.map((t) => t.start_date).sort()[0]), amount)
      else if (w.timing === 'end') add(monthOf(found.map((t) => t.finish_date).sort().pop()!), amount)
      else {
        // by working day across every activity (overlapping activities each count)
        const days = new Map<string, number>()
        for (const t of found) for (const [m, n] of workingDaysByMonth(t.start_date, t.finish_date)) days.set(m, (days.get(m) ?? 0) + n)
        const all = [...days.values()].reduce((s, n) => s + n, 0)
        for (const [m, n] of days) add(m, (amount * n) / all)
      }
    }
    if (item.weights.length && Math.abs(pctTotal - 100) > 0.001) {
      unplaced += (item.value * (100 - pctTotal)) / 100
      issues.push(`stages add up to ${r2(pctTotal)}%, not 100%`)
    }
    return { item, by, unplaced: r2(unplaced), issues: [...new Set(issues)] }
  })

  // the months: from the first to the last amount, and at least start on site to PC
  const keys = placed.flatMap((p) => [...p.by.keys()])
  if (i.siteStart) keys.push(monthOf(i.siteStart))
  if (i.pc) keys.push(monthOf(i.pc))
  keys.sort()
  const months = keys.length ? monthsBetween(keys[0], keys[keys.length - 1]) : []

  const rows: CfRow[] = placed.map(({ item, by, unplaced, issues }) => {
    const amounts = months.map((m) => r2(by.get(m) ?? 0))
    // pennies lost to rounding go to the biggest month, so the months add back to the value exactly
    const diff = r2(item.value - unplaced - amounts.reduce((s, v) => s + v, 0))
    if (diff && amounts.some((v) => v)) {
      const k = amounts.indexOf(Math.max(...amounts))
      amounts[k] = r2(amounts[k] + diff)
    }
    return { key: item.key, label: item.label, kind: item.kind, value: item.value, months: amounts, unplaced, issues }
  })
  const contract = rows.filter((r) => r.kind !== 'vo_risk')
  const total = r2(contract.reduce((s, r) => s + r.value, 0))
  const pcMonth = i.pc ? monthOf(i.pc) : null
  let cumulative = 0
  let prevNet = 0
  const monthly: CfMonth[] = months.map((m, k) => {
    const value = r2(contract.reduce((s, r) => s + r.months[k], 0))
    const atRisk = r2(rows.filter((r) => r.kind === 'vo_risk').reduce((s, r) => s + r.months[k], 0))
    cumulative = r2(cumulative + value)
    const pct = pcMonth && m >= pcMonth ? i.retentionPct / 2 : i.retentionPct
    const retention = r2((-cumulative * pct) / 100)
    const netCumulative = r2(cumulative + retention)
    const netMonth = r2(netCumulative - prevNet)
    prevNet = netCumulative
    return { month: m, value, atRisk, cumulative, cumPct: total ? cumulative / total : 0, retention, netCumulative, netMonth }
  })
  return {
    months,
    rows,
    monthly,
    total,
    atRiskTotal: r2(rows.filter((r) => r.kind === 'vo_risk').reduce((s, r) => s + r.value, 0)),
    unplaced: r2(contract.reduce((s, r) => s + r.unplaced, 0)),
  }
}
