// DBP Timeline's working-day calendar and schedule helpers (reference/timeline-app-2026-11-21.html:
// DATE HELPERS, SHUTDOWN CALENDAR, CRITICAL PATH, getRenderList, week numbering), ported for the
// Timeline exports, print and diff. Timeline read a global `state`; here each helper is handed the
// programme (or just its shutdowns). Dates are local-time Date objects, as in Timeline (fromISO/toISO).
import type { TLGroup, TLShutdown, TLState, TLTask } from './timelineFormat'

/** anything with Timeline's shutdown calendar: a TLState, or just { shutdowns } */
export interface TLCalendar {
  shutdowns?: TLShutdown[] | null
}

// ── DATE HELPERS ──────────────────────────────────────────────────────────
export const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
export const toISO = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
export function fromISO(s: string) {
  const p = s.split('-').map(Number)
  return new Date(p[0], p[1] - 1, p[2])
}
export function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
export function isWeekend(d: Date) {
  const w = d.getDay()
  return w === 0 || w === 6
}
/** "4 Jan" */
export const fmtShort = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
/** "04/01/27" */
export const fmtUKShort = (d: Date) => pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(-2)
export const escapeHtml = (s: string | null | undefined) =>
  (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

// ── SHUTDOWN CALENDAR (e.g. Christmas) ────────────────────────────────────
// shutdowns = [{id, name, start, end}] with inclusive ISO dates. Those days are non-working for
// everything on the programme except tasks flagged `skeleton` (skeleton crew works through).
export function isShutdown(cal: TLCalendar, d: Date) {
  const s = toISO(d)
  return (cal.shutdowns || []).some((p) => p.start && p.end && s >= p.start && s <= p.end)
}
export function isNonWorking(cal: TLCalendar, d: Date, through?: boolean) {
  return isWeekend(d) || (!through && isShutdown(cal, d))
}
/** the date of the Nth working day, counting startDate as day 1 */
export function addWorkingDays(cal: TLCalendar, startDate: Date, workingDays: number | null | undefined, through?: boolean) {
  let d = new Date(startDate)
  let count = 1
  const n = Math.max(1, workingDays || 1)
  while (count < n) {
    d = addDays(d, 1)
    if (!isNonWorking(cal, d, through)) count++
  }
  return d
}
/** move n working days from date (not counting date itself); n may be negative */
export function advanceWorkingDays(cal: TLCalendar, date: Date, n: number) {
  let d = new Date(date)
  let moved = 0
  const step = n >= 0 ? 1 : -1
  while (moved !== n) {
    d = addDays(d, step)
    if (!isNonWorking(cal, d)) moved += step
  }
  return d
}
/** working days after `from` up to and including `to` (0 if to <= from) */
export function workingDaysBetween(cal: TLCalendar, from: Date, to: Date) {
  let n = 0
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (!isNonWorking(cal, d)) n++
  return n
}
export type TLDated = Pick<TLTask, 'start' | 'duration' | 'milestone' | 'skeleton'>
export const taskEndDate = (cal: TLCalendar, t: TLDated) => addWorkingDays(cal, fromISO(t.start), t.milestone ? 1 : t.duration, !!t.skeleton)

// ── TRADE COLOURS ─────────────────────────────────────────────────────────
// du Boulay brand palette: new trades take the next colour in turn (Timeline's getTrade).
export const BRAND_TRADE_PALETTE = ['#007ABE', '#1F1246', '#104682', '#5BA4D4', '#6B6F85', '#3A3566', '#9CC7E4', '#231F20', '#A7ABBD', '#2D6FA3']
export const CRITICAL_COLOR = '#C0392B'
/** Timeline's getTrade without touching the programme: a trade not in the list gets the next palette
 *  colour, remembered for the rest of this resolver's life (as Timeline's push into state.trades) */
export function tradeResolver(state: Pick<TLState, 'trades'>) {
  const trades = (state.trades || []).map((t) => ({ ...t }))
  return (name: string) => {
    let t = trades.find((x) => x.name === name)
    if (!t) {
      t = { name, color: BRAND_TRADE_PALETTE[trades.length % BRAND_TRADE_PALETTE.length] }
      trades.push(t)
    }
    return t
  }
}
export function darken(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, (n >> 16) - amt),
    g = Math.max(0, ((n >> 8) & 0xff) - amt),
    b = Math.max(0, (n & 0xff) - amt)
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}

// ── CRITICAL PATH (CPM backward pass) ─────────────────────────────────────
// Each task's actual start/end is its early date (the scheduler keeps dependants pinned), so only the
// backward pass is needed: how late each task could finish without pushing the project end out.
export function computeLateFinishes(state: TLState): Record<string, Date> {
  if (!state.tasks.length) return {}
  const projectEnd = state.tasks.reduce<Date | null>((max, t) => {
    const ef = taskEndDate(state, t)
    return !max || ef > max ? ef : max
  }, null) as Date
  const dependents: Record<string, { dep: TLTask; pred: TLTask['predecessors'][number] }[]> = {}
  state.tasks.forEach((t) => (t.predecessors || []).forEach((p) => (dependents[p.id] = dependents[p.id] || []).push({ dep: t, pred: p })))
  const lfCache: Record<string, Date> = {}
  const visiting = new Set<string>()
  function latestFinish(task: TLTask): Date {
    if (lfCache[task.id] !== undefined) return lfCache[task.id]
    if (visiting.has(task.id)) return taskEndDate(state, task) // dependency cycle guard
    visiting.add(task.id)
    const deps = dependents[task.id]
    let lf: Date | null = null
    if (deps && deps.length) {
      deps.forEach(({ dep, pred }) => {
        const depLF = latestFinish(dep)
        const depLS = advanceWorkingDays(state, depLF, -((dep.milestone ? 1 : dep.duration) - 1))
        const lag = pred.lag || 0
        let constraint: Date
        if (pred.type === 'SS') {
          const taskLS = advanceWorkingDays(state, depLS, -lag)
          constraint = addWorkingDays(state, taskLS, task.milestone ? 1 : task.duration)
        } else if (pred.type === 'FF') {
          constraint = advanceWorkingDays(state, depLF, -lag)
        } else {
          constraint = advanceWorkingDays(state, depLS, -(1 + lag))
        }
        if (lf === null || constraint < lf) lf = constraint
      })
    }
    const out: Date = lf ?? projectEnd
    visiting.delete(task.id)
    lfCache[task.id] = out
    return out
  }
  state.tasks.forEach((t) => latestFinish(t))
  return lfCache
}
/** ids of the tasks with no slack */
export function computeCriticalPath(state: TLState) {
  const critical = new Set<string>()
  const lateFinish = computeLateFinishes(state)
  state.tasks.forEach((t) => {
    if (toISO(lateFinish[t.id]) === toISO(taskEndDate(state, t))) critical.add(t.id)
  })
  return critical
}

// ── WEEK NUMBERS ──────────────────────────────────────────────────────────
// Week 1 is the week construction starts: a section literally named "Construction", else whatever sits
// outside the Precon / Close-out bookends, else the earliest task. A manual Wk 1 date (weekStart) wins.
const isPreconName = (name: string | null | undefined) => /pre[\s-]?con/i.test(name || '')
export function constructionStartAnchor(state: TLState) {
  if (!state || !state.tasks.length) return null
  const groups = state.groups || []
  const earliestIn = (tasks: TLTask[]) =>
    tasks.reduce((min, t) => {
      const d = fromISO(t.start)
      return d < min ? d : min
    }, fromISO(tasks[0].start))
  const constructionGroup = groups.find((g) => /construction/i.test(g.name) && !isPreconName(g.name))
  if (constructionGroup) {
    const ts = state.tasks.filter((t) => t.groupId === constructionGroup.id)
    if (ts.length) return earliestIn(ts)
  }
  const isBookend = (g: TLGroup | null | undefined) => !!g && (isPreconName(g.name) || /close.?out/i.test(g.name))
  const midTasks = state.tasks.filter((t) => !isBookend(t.groupId ? groups.find((x) => x.id === t.groupId) : null))
  return earliestIn(midTasks.length ? midTasks : state.tasks)
}
export function weekAnchorMonday(state: TLState) {
  const anchor = state && state.weekStart ? fromISO(state.weekStart) : constructionStartAnchor(state)
  if (!anchor) return null
  const day = anchor.getDay() // 0=Sun..6=Sat
  return addDays(anchor, -(day === 0 ? 6 : day - 1))
}
/** Wk 1, 2, 3… from the anchor Monday; before it a countdown Wk -1, -2… (no Wk 0) */
export function weekNumberFor(d: Date, mondayAnchor: Date | null) {
  if (!mondayAnchor) return null
  const diffDays = Math.round((d.getTime() - mondayAnchor.getTime()) / 86400000)
  return diffDays >= 0 ? Math.floor(diffDays / 7) + 1 : Math.floor(diffDays / 7)
}

// ── ROW LIST (sections and tasks in display order) ────────────────────────
export type TLRenderItem = { type: 'group'; group: TLGroup; empty?: boolean; continued?: boolean } | { type: 'task'; task: TLTask }
export interface TLRenderOpts {
  forPrint?: boolean // collapsed sections still list their tasks
  unfiltered?: boolean // ignore `visible`
  visible?: ((t: TLTask) => boolean) | null // Timeline's taskVisible (contractor filter); null = everyone
}
export function getRenderList(state: TLState, opts: TLRenderOpts = {}): TLRenderItem[] {
  const filtering = !!opts.visible && !opts.unfiltered
  const tasks = filtering ? state.tasks.filter(opts.visible!) : state.tasks
  if (!state.groups || !state.groups.length) return tasks.map((t) => ({ type: 'task', task: t }))
  const list: TLRenderItem[] = []
  let lastGroupId: string | null = '__unset__'
  tasks.forEach((t) => {
    const gidVal = t.groupId || null
    const g = gidVal ? state.groups.find((x) => x.id === gidVal) : null
    if (gidVal !== lastGroupId) {
      if (g) list.push({ type: 'group', group: g })
      lastGroupId = gidVal
    }
    if (!g || !g.collapsed || opts.forPrint) list.push({ type: 'task', task: t })
  })
  // trailing empty sections (no tasks yet) still show as headers
  if (!filtering)
    state.groups.forEach((g) => {
      if (!state.tasks.some((t) => t.groupId === g.id)) list.push({ type: 'group', group: g, empty: true })
    })
  return list
}
