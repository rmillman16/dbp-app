// The programme as issued to others (Richard, 23 Nov): a client programme (no subcontractors, trades
// or their colours) and a subcontractor programme (every trade, optionally shortened so they work to
// earlier dates than the master). Either can be a summary: each section rolled up into one bar, plus
// the milestones. These only make a copy for the print and the MS Project / P6 files: the master
// programme is never changed. Kept free of the screen and the database (pure, on Timeline's layout)
// so it can be tested on its own.
import type { TLGroup, TLState, TLTask } from './timelineFormat'
import { addWorkingDays, advanceWorkingDays, constructionStartAnchor, fromISO, taskEndDate, toISO, workingDaysBetween } from './timelineDates'

// the client programme's one bar colour: DBP blue
export const NEUTRAL_COLOR = '#007ABE'

// what never goes outside DBP: baselines, prerequisite notes and RAG (the chart's ghost bars and
// status dots), as there's no comparison or slippage on an issued programme
export function forIssue(state: TLState): TLState {
  return {
    ...state,
    tasks: state.tasks.map((t) => ({ ...t, baselineStart: null, baselineDuration: null, prereqNote: '', prereqConfirmed: false, rag: 'green' })),
  }
}

// the client programme: every task keeps its name, but no trade or contractor, and one colour
export function hideContractors(state: TLState): TLState {
  return {
    ...state,
    trades: [{ name: '', color: NEUTRAL_COLOR }],
    tasks: state.tasks.map((t) => ({ ...t, trade: '', contractor: '' })),
  }
}

const isStartOnSite = (name: string) => /start\s*on\s*site|site\s*start|commence/i.test(name)
const isPC = (name: string) => /completion|^\s*p\.?c\.?\s*$|^\s*pc\b/i.test(name)
const endOf = (state: TLState, t: TLTask) => taskEndDate(state, t)
const latestEnd = (state: TLState, tasks: TLTask[]) => tasks.reduce<Date | null>((m, t) => (!m || endOf(state, t) > m ? endOf(state, t) : m), null)

// the summary (key activity) programme: each section one bar from its first start to its last
// finish, then the milestones (start on site and completion added if the programme has none).
// keepTrades: a section whose tasks are all one trade / contractor keeps it (and its colour).
export function summarise(state: TLState, keepTrades: boolean): TLState {
  const msGroup: TLGroup = { id: 'key-dates', name: 'Key dates', collapsed: false }
  const actGroup: TLGroup = { id: 'key-activities', name: 'Key activities', collapsed: false }
  const codes = new Set(state.tasks.map((t) => t.id))
  const blank = (over: Partial<TLTask>): TLTask => ({
    id: '',
    name: '',
    trade: '',
    contractor: '',
    start: '',
    duration: 1,
    milestone: false,
    progress: 0,
    rag: 'green',
    prereqConfirmed: false,
    prereqNote: '',
    predecessors: [],
    skeleton: false,
    baselineStart: null,
    baselineDuration: null,
    groupId: null,
    ...over,
  })
  const freeId = (base: string) => {
    let id = base
    for (let i = 2; codes.has(id); i++) id = `${base}-${i}`
    codes.add(id)
    return id
  }

  // the milestones, in date order
  const milestones: TLTask[] = state.tasks.filter((t) => t.milestone).map((t) => ({ ...t, predecessors: [], groupId: msGroup.id, critical: false }))
  const work = state.tasks.filter((t) => !t.milestone)
  if (work.length && !milestones.some((m) => isStartOnSite(m.name))) {
    const sos = state.weekStart ?? (constructionStartAnchor(state) ? toISO(constructionStartAnchor(state)!) : null)
    if (sos) milestones.push(blank({ id: freeId('SOS'), name: 'Start on site', start: sos, milestone: true, groupId: msGroup.id }))
  }
  if (work.length && !milestones.some((m) => isPC(m.name)))
    milestones.push(blank({ id: freeId('PC'), name: 'Completion', start: toISO(latestEnd(state, work)!), milestone: true, groupId: msGroup.id }))
  milestones.sort((a, b) => a.start.localeCompare(b.start))

  // one bar per section (and one for tasks in no section), in the programme's order
  const buckets: { name: string; tasks: TLTask[] }[] = []
  for (const g of state.groups) buckets.push({ name: g.name, tasks: work.filter((t) => t.groupId === g.id) })
  const loose = work.filter((t) => !t.groupId || !state.groups.some((g) => g.id === t.groupId))
  if (loose.length) buckets.push({ name: state.groups.length ? 'Other works' : 'Works', tasks: loose })
  const bars: TLTask[] = []
  buckets
    .filter((b) => b.tasks.length)
    .forEach((b, i) => {
      const start = b.tasks.map((t) => t.start).sort()[0]
      const end = latestEnd(state, b.tasks)!
      // working days from start to end; if the last task is a skeleton crew's ending in a shutdown, count through it
      let skeleton = false
      let duration = 1 + workingDaysBetween(state, fromISO(start), end)
      if (toISO(addWorkingDays(state, fromISO(start), duration)) !== toISO(end)) {
        skeleton = true
        duration = 1 + workingDaysBetween({ shutdowns: [] }, fromISO(start), end)
      }
      const one = (k: 'trade' | 'contractor') => {
        const vals = new Set(b.tasks.map((t) => (t[k] || '').trim()))
        return keepTrades && vals.size === 1 ? [...vals][0] : ''
      }
      const weight = b.tasks.reduce((s, t) => s + t.duration, 0) || 1
      bars.push(
        blank({
          id: freeId(`S${String(i + 1).padStart(2, '0')}`),
          name: b.name,
          trade: one('trade'),
          contractor: one('contractor'),
          start,
          duration,
          skeleton,
          progress: Math.round(b.tasks.reduce((s, t) => s + (t.progress || 0) * t.duration, 0) / weight),
          groupId: actGroup.id,
        }),
      )
    })
  const groups = [...(milestones.length ? [msGroup] : []), ...(bars.length ? [actGroup] : [])]
  return { ...state, groups, tasks: [...milestones, ...bars] }
}

// ---------- shortening (the subcontractor programme) ----------
// Every task's timing is scaled pro rata from the programme's start, in working days (weekends and
// shutdowns don't count, as everywhere else in the module): a task's start offset and its finish
// offset are both multiplied by the factor and rounded, so its duration shrinks in proportion and
// the order of tasks is kept. Non-milestones last at least a day; milestones stay milestones. Lags
// are scaled too. Where a link was met in the master (it always is once the module has scheduled
// it), the shortened task is pushed later if rounding (or the one-day minimum) would break it.

// the programme's first start and last finish, and its length in working days (both ends counted)
export function programmeSpan(state: TLState) {
  if (!state.tasks.length) return null
  const start = state.tasks.map((t) => t.start).sort()[0]
  const end = latestEnd(state, state.tasks)!
  return { start, end: toISO(end), days: 1 + workingDaysBetween(state, fromISO(start), end) }
}

// how much to keep (0.1–1) from a percentage or a number of working days off
export function shortenFactor(state: TLState, by: { percent: number } | { days: number }) {
  const span = programmeSpan(state)
  if (!span) return 1
  const cut = 'percent' in by ? by.percent / 100 : by.days / span.days
  return Math.min(1, Math.max(0.1, 1 - (Number.isFinite(cut) ? cut : 0)))
}

export function shorten(state: TLState, factor: number): TLState {
  const f = Math.min(1, Math.max(0.1, factor))
  if (f === 1 || !state.tasks.length) return state
  const p0 = fromISO(state.tasks.map((t) => t.start).sort()[0])
  const off = (d: Date) => (d <= p0 ? 0 : workingDaysBetween(state, p0, d))
  const dateAt = (n: number) => (n <= 0 ? p0 : advanceWorkingDays(state, p0, n))
  // offsets in working days from the start: start, and finish (the last day; a milestone's own day)
  const was = new Map(state.tasks.map((t) => [t.id, { s: off(fromISO(t.start)), e: t.milestone ? off(fromISO(t.start)) : off(endOf(state, t)) }]))
  const now = new Map<string, { s: number; len: number; milestone: boolean }>()
  for (const t of state.tasks) {
    const o = was.get(t.id)!
    const s = Math.round(o.s * f)
    const len = t.milestone ? 0 : Math.max(1, Math.round((o.e + 1) * f) - s)
    now.set(t.id, { s, len, milestone: t.milestone })
  }
  const endOff = (x: { s: number; len: number; milestone: boolean }) => (x.milestone ? x.s : x.s + x.len - 1)
  const wasEnd = (id: string) => was.get(id)!.e
  // the earliest a task may start for one link (in offsets), or null if the master didn't meet it
  const needs = (t: TLTask, l: TLTask['predecessors'][number]) => {
    const pw = was.get(l.id)
    const pn = now.get(l.id)
    if (!pw || !pn) return null
    const tw = was.get(t.id)!
    const tn = now.get(t.id)!
    const lagNow = Math.round(l.lag * f)
    if (l.type === 'SS') return tw.s >= pw.s + l.lag ? pn.s + lagNow : null
    if (l.type === 'FF') return wasEnd(t.id) >= pw.e + l.lag ? endOff(pn) + lagNow - (endOff(tn) - tn.s) : null
    return tw.s >= pw.e + 1 + l.lag ? endOff(pn) + 1 + lagNow : null
  }
  for (let pass = 0, changed = true; changed && pass < state.tasks.length + 1; pass++) {
    changed = false
    for (const t of state.tasks) {
      const x = now.get(t.id)!
      for (const l of t.predecessors || []) {
        const min = needs(t, l)
        if (min != null && x.s < min) ((x.s = min), (changed = true))
      }
    }
  }
  const weekStart = state.weekStart ? toISO(dateAt(Math.round(off(fromISO(state.weekStart)) * f))) : state.weekStart
  return {
    ...state,
    weekStart,
    tasks: state.tasks.map((t) => {
      const x = now.get(t.id)!
      const start = toISO(dateAt(x.s))
      return {
        ...t,
        start,
        duration: t.milestone ? 1 : t.skeleton ? Math.max(1, Math.round(t.duration * f)) : x.len,
        predecessors: (t.predecessors || []).map((l) => ({ ...l, lag: Math.round(l.lag * f) })),
      }
    }),
  }
}

// "Finishes 12/03/2027 instead of 02/04/2027 (15 working days / 10.0% shorter)"
export function shortenPreview(state: TLState, factor: number) {
  const before = programmeSpan(state)
  const after = programmeSpan(shorten(state, factor))
  if (!before || !after) return null
  const saved = workingDaysBetween(state, fromISO(after.end), fromISO(before.end))
  return { from: before.end, to: after.end, days: saved, percent: before.days ? (saved / before.days) * 100 : 0, span: before.days }
}

// the client and subcontractor programmes
export type IssueKind = 'client' | 'subcontractor'
export interface IssueOptions {
  kind: IssueKind
  summary: boolean
  factor?: number // subcontractor only: 1 = as the master
}
export function issueView(state: TLState, o: IssueOptions): TLState {
  let s = forIssue(state)
  if (o.kind === 'client') s = hideContractors(s)
  else if (o.factor && o.factor < 1) s = shorten(s, o.factor)
  if (o.summary) s = summarise(s, o.kind === 'subcontractor')
  return s
}
export const issueTitle = (o: Pick<IssueOptions, 'kind' | 'summary'>) => `${o.kind === 'client' ? 'Client' : 'Subcontractor'} programme${o.summary ? ' (summary)' : ''}`
