// The cashflow sums (docs/decisions.md "Cashflow: built"). Kept free of the database so it can be
// tested on its own. A client-facing forecast of what DBP will apply for each month:
// - every item (a works package: joinery, metalwork, tiling… as the CVR, valued with its share
//   of OH&P; prelims; an agreed VO; issued VOs shown separately as at risk) is paid in stages:
//   the job's own list, Deposit, Progress, Delivery, Installation… as a guide
// - each stage takes a % of the item's value and falls at the start of, spread across (by working
//   day, Monday to Friday) or at the end of its activities, or on a typed date
// - "Start on site to PC" is an activity of its own (the job's dates)
// - all money is placed (Richard, 20 Nov): until it's set, a package is spread across the
//   activities that match its name, else start on site to PC; margin not tied to a package and
//   any difference to the contract sum go "in line with everything else" (pro rata each month)
// - retention at the job's %, halved from the PC month, as on the applications
// Months are calendar months (valuations fall at month end).

export type Timing = 'start' | 'spread' | 'end' | 'date'
export const TIMING_LABELS: Record<Timing, string> = { start: 'at the start of', spread: 'spread across', end: 'at the end of', date: 'on a date' }
export const SITE = '@site' // start on site to PC
export const SITE_LABEL = 'Start on site to PC'

// adjust: spread in line with everything else (pro rata), no stages of its own
export type ItemKind = 'package' | 'prelims' | 'adjust' | 'vo' | 'vo_risk'
export interface CfStage {
  id: string
  name: string
}
export interface CfWeight {
  stage_id: string
  pct: number // 0–100
  amount?: number | null // set = weighted by £ (fixed), else by % (script 020)
  timing: Timing
  task_codes: string[] | null // null = the item's linked activities
  on_date: string | null
}
export interface CfItem {
  key: string // "pkg:Joinery", "adjust:contract", "vo:<id>"
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

// Start on site and PC for the cashflow: the programme's own milestones ("Start on site",
// "Practical Completion") where it has them, as the most up-to-date dates; else the job's dates;
// else the programme's first and last construction activities (not design or pre-construction,
// which on Corsham start 10 weeks before site, found 21 Nov).
export function siteDates(tasks: CfTask[], job: { start: string | null; pc: string | null }) {
  const named = (re: RegExp) => tasks.find((t) => re.test(t.name))
  const works = tasks.filter((t) => !NOT_WORKS.test(t.trade ?? '') && !NOT_WORKS.test(t.section ?? ''))
  const first = works.map((t) => t.start_date).sort()[0] ?? null
  const last = works.map((t) => t.finish_date).sort().pop() ?? null
  const start = named(/start\s+on\s+site|site\s+start|possession/i)?.start_date ?? job.start ?? first
  const pc = named(/practical\s+completion|^pc$|\bPC\b/i)?.finish_date ?? job.pc ?? last
  return { start, pc, fromProgramme: { start: !!named(/start\s+on\s+site|site\s+start|possession/i), pc: !!named(/practical\s+completion|^pc$|\bPC\b/i) } }
}

// the starting weighting for an item that hasn't been set (agreed 20 Nov), so every pound is placed:
// prelims 10% set-up at start on site, 80% spread to PC, 10% at PC; anything else 100% Progress
// spread across its activities, or start on site to PC when it has none
export function defaultWeights(item: Pick<CfItem, 'kind' | 'tasks'>, stages: CfStage[]): CfWeight[] {
  if (!stages.length || item.kind === 'adjust') return []
  const progress = stages.find((s) => /progress/i.test(s.name)) ?? stages[0]
  if (item.kind === 'prelims') {
    const first = stages[0].id === progress.id ? null : stages[0]
    const last = stages.find((s) => /complet|finish|handover/i.test(s.name)) ?? (stages[stages.length - 1].id === progress.id ? null : stages[stages.length - 1])
    const w = (s: CfStage, pct: number, timing: Timing): CfWeight => ({ stage_id: s.id, pct, timing, task_codes: [SITE], on_date: null })
    if (!first || !last || first.id === last.id) return [w(progress, 100, 'spread')]
    return [w(first, 10, 'start'), w(progress, 80, 'spread'), w(last, 10, 'end')]
  }
  return [{ stage_id: progress.id, pct: 100, timing: 'spread', task_codes: item.tasks.length ? null : [SITE], on_date: null }]
}

// Each works package's value for the cashflow: its cost from the office SoW lines plus its share
// of each line's margin (OH&P, and anything else shown and omitted), shared in proportion to the
// line's cost, so the packages add up to the price (Richard, 20 Nov: "all monies must be
// allocated"). A line with margin but no cost (or the SoW lines not imported yet: budgets then
// stand as they are) leaves "loose" margin, spread in line with everything else.
export interface LineValue {
  key: string // the SoW item number (or its description), stable across re-imports
  ref: string | null
  description: string
  value: number // its cost in this package plus its share of the line's margin
}
export function packageValues(
  packages: { name: string; kind: string; budget: number | null }[],
  lines: { kind: string; ref?: string | null; description?: string; amounts: Record<string, number> }[],
): { values: Map<string, number>; items: Map<string, LineValue[]>; loose: number; total: number; fromLines: boolean } {
  const omitted = new Set(packages.filter((p) => p.kind === 'omit').map((p) => p.name))
  const isMargin = (n: string) => omitted.has(n) || /^(oh&p|ohp|overh)/i.test(n)
  const values = new Map<string, number>()
  const items = new Map<string, LineValue[]>() // each package's SoW line items
  let total = 0
  if (!lines.length) {
    for (const p of packages) {
      const v = Number(p.budget ?? 0)
      total += v
      if (!isMargin(p.name) && v) values.set(p.name, v)
    }
  } else {
    // an item and the lines under it are one priced line of the SoW
    const groups: { ref: string | null; description: string; amounts: Record<string, number> }[] = []
    let cur: (typeof groups)[number] | null = null
    for (const l of lines) {
      if (l.kind !== 'line' || !cur) groups.push((cur = { ref: l.ref ?? null, description: l.description ?? '', amounts: {} }))
      for (const [n, v] of Object.entries(l.amounts ?? {})) cur.amounts[n] = (cur.amounts[n] ?? 0) + Number(v)
    }
    for (const g of groups) {
      const entries = Object.entries(g.amounts)
      const costs = entries.filter(([n]) => !isMargin(n))
      const margin = entries.filter(([n]) => isMargin(n)).reduce((s, [, v]) => s + v, 0)
      const cost = costs.reduce((s, [, v]) => s + v, 0)
      total += cost + margin
      if (Math.abs(cost) < 0.005) continue // all margin: loose
      for (const [n, v] of costs) {
        const share = v + (margin * v) / cost
        values.set(n, (values.get(n) ?? 0) + share)
        const list = items.get(n) ?? []
        const key = g.ref || g.description || `line ${groups.indexOf(g) + 1}`
        const same = list.find((x) => x.key === key)
        if (same) same.value += share
        else list.push({ key, ref: g.ref, description: g.description, value: share })
        items.set(n, list)
      }
    }
    for (const list of items.values()) for (const x of list) x.value = r2(x.value)
  }
  const out = new Map<string, number>()
  for (const [n, v] of values) if (Math.abs(r2(v)) >= 0.01) out.set(n, r2(v))
  total = r2(total)
  // whatever isn't in a package (pennies included) is loose, so it all adds back to the price
  const loose = r2(total - [...out.values()].reduce((s, v) => s + v, 0))
  return { values: out, items, loose, total, fromLines: lines.length > 0 }
}

// The trade a package goes into in the cashflow (Richard, 21 Nov: the Micro SoW's single Subbie
// column is split by section in the CVR, "Subbie – 9 Electrical installation"; the cashflow is by
// trade). Suggested from a shared word with the trade's name: "Electrical installation" →
// Electrical, "Joinery, fixtures & fittings" → Joinery, "Floor finishes" → Flooring.
// usual fit-out pairings for SoW section wording, as suggestions only (confirmed per job)
const TRADE_HINTS: [RegExp, string][] = [
  [/ceiling/i, 'dry lining drylining'],
  [/wall finish/i, 'decorating decorations'],
  [/\bdoors?\b/i, 'joinery'],
]
// here "floor" is a trade (flooring), not a level, so only the plain stop words are left out
const tradeWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/m\s*&\s*e\b/g, 'mechanical electrical')
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !['and', 'the', 'with', 'works', 'work', 'items', 'item', 'subbie', 'finishes', 'finish', 'installation', 'supply'].includes(w))
    .map((w) => w.slice(0, 5))
export function suggestTrade(name: string, trades: string[]): string | null {
  const own = name.replace(/^subbie\s*[–-]?\s*\d*\s*/i, '')
  const mine = new Set(tradeWords(`${own} ${TRADE_HINTS.filter(([re]) => re.test(own)).map(([, w]) => w).join(' ')}`))
  let best: string | null = null
  let score = 0
  for (const t of trades) {
    if (t === name || /^subbie/i.test(t)) continue
    const s = tradeWords(t).filter((w) => mine.has(w)).length
    if (s > score) (best = t), (score = s)
  }
  return best
}

// activities that look like they belong to an item: a shared word in the name, trade or section
const STOP = new Set(['and', 'the', 'for', 'with', 'all', 'works', 'work', 'install', 'installation', 'supply', 'subbie', 'general', 'items', 'item', 'areas', 'area', 'level', 'floor', 'floors'])
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/m\s*&\s*e\b/g, 'mechanical electrical') // programmes say M&E, SoWs spell it out
    .replace(/\b(hvac|plumbing|ventilation|air conditioning)\b/g, '$1 mechanical')
    .replace(/\blighting\b/g, 'lighting electrical')
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.slice(0, 5))
// (only construction activities: not design, pre-construction / procurement or the client's)
const NOT_WORKS = /design|precon|pre-construction|procurement|client|internal pm/i
export function suggestTasks(label: string, tasks: CfTask[]): string[] {
  const mine = new Set(words(label))
  if (!mine.size) return []
  return tasks
    .filter((t) => !NOT_WORKS.test(t.trade ?? '') && !NOT_WORKS.test(t.section ?? ''))
    .filter((t) => words(`${t.name} ${t.trade ?? ''}`).some((w) => mine.has(w)))
    .map((t) => t.code)
}

export function computeCashflow(i: CashflowInput): CashflowResult {
  const byCode = new Map(i.tasks.map((t) => [t.code, t]))
  const site = i.siteStart && i.pc ? { code: SITE, name: SITE_LABEL, start_date: i.siteStart, finish_date: i.pc } : null
  const resolve = (code: string) => (code === SITE ? site : byCode.get(code))

  // each item's amounts by month (the pro rata items follow once the rest are placed)
  const placed = i.items.map((item) => {
    const by = new Map<string, number>()
    const issues: string[] = []
    let unplaced = 0
    const add = (m: string, v: number) => by.set(m, (by.get(m) ?? 0) + v)
    // a weighting by £ (fixed amounts) or by % of the value
    const byAmount = item.weights.some((w) => w.amount != null)
    const amountOf = (w: CfWeight) => (byAmount ? Number(w.amount ?? 0) : (item.value * Number(w.pct || 0)) / 100)
    const weighted = r2(item.weights.reduce((s, w) => s + amountOf(w), 0))
    if (item.kind === 'adjust') return { item, by, unplaced: 0, issues }
    if (!item.weights.length) {
      unplaced += item.value
      if (item.value) issues.push(item.tasks.length ? 'no weighting yet' : 'not linked to the programme yet')
    }
    for (const w of item.weights) {
      const amount = amountOf(w)
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
    // the stages must come to the whole value: short is listed as not placed, over is flagged
    const short = r2(item.value - weighted)
    if (item.weights.length && Math.abs(short) >= 0.005) {
      if (short > 0) unplaced += short
      issues.push(byAmount ? `stages add up to £${weighted.toLocaleString('en-GB', { minimumFractionDigits: 2 })}, not the value` : `stages add up to ${r2((weighted / (item.value || 1)) * 100)}%, not 100%`)
    }
    return { item, by, unplaced: r2(unplaced), issues: [...new Set(issues)] }
  })
  // margin not tied to a package and the difference to the contract sum: in line with the rest
  const base = new Map<string, number>()
  for (const p of placed) if (p.item.kind !== 'adjust' && p.item.kind !== 'vo_risk') for (const [m, v] of p.by) base.set(m, (base.get(m) ?? 0) + v)
  const baseTotal = [...base.values()].reduce((s, v) => s + v, 0)
  for (const p of placed) {
    if (p.item.kind !== 'adjust' || !p.item.value) continue
    if (!baseTotal) {
      p.unplaced = p.item.value
      p.issues.push('nothing else is placed yet to spread it with')
      continue
    }
    for (const [m, v] of base) p.by.set(m, (p.item.value * v) / baseTotal)
  }

  // the months: from the first to the last amount, and at least start on site to PC
  const keys = placed.flatMap((p) => [...p.by.keys()])
  if (i.siteStart) keys.push(monthOf(i.siteStart))
  if (i.pc) keys.push(monthOf(i.pc))
  keys.sort()
  const months = keys.length ? monthsBetween(keys[0], keys[keys.length - 1]) : []

  const rows: CfRow[] = placed.map(({ item, by, unplaced, issues }) => {
    const amounts = months.map((m) => r2(by.get(m) ?? 0))
    // pennies lost to rounding go to the biggest month, so the months add back to the value exactly
    // (not when stages come to more than the value: that's flagged instead)
    const placedSum = r2([...by.values()].reduce((s, v) => s + v, 0))
    const diff = r2(placedSum - amounts.reduce((s, v) => s + v, 0))
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
