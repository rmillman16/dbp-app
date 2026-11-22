// Every DBP Timeline action, on the app's programme (Programme tab, 22 Nov: "take the layout of
// Timeline and copy every feature of it"). Ported from reference/timeline-app-2026-11-21.html
// function by function (named in each comment), working on a copy of the programme in memory: the
// tab keeps the result, saves it a moment later and keeps the last 30 for Undo. Kept free of the
// database and the screen so it can be tested on its own.
//
// The programme here: its settings plus its tasks in the order shown, each section's tasks together,
// tasks with no section first (as in Timeline), sections in programme.sections' order (which keeps
// empty ones). Durations are working days; links are by activity code.
import { newTaskId, type Link, type ProgrammeTask, type SavedProgramme, type Shutdown, type Trade } from './programme'
import { addDays, duration, finishFor, isWorkingDay, nextCode, nextWorkingDay } from './programmeEdit'
import { calendarOf, follows, recalendar, reschedule, shiftWorking, workingDaysBetween } from './programmeLinks'

export interface Working {
  programme: SavedProgramme
  tasks: ProgrammeTask[]
}
type Dates = Pick<ProgrammeTask, 'start_date' | 'finish_date'>

const clone = (w: Working): Working => structuredClone(w)
const todayIso = () => new Date().toISOString().slice(0, 10)
const sd = (w: Working): Shutdown[] => w.programme.shutdowns ?? []
export const lengthOf = (t: ProgrammeTask, shutdowns: Shutdown[]) => (t.milestone ? 1 : duration(t, calendarOf(t, shutdowns)))
const withDates = (t: ProgrammeTask, d?: Dates) => (d ? Object.assign(t, d) : t)

// Timeline's colours: the du Boulay brand palette, and its starting trades (BRAND_TRADE_PALETTE, DEFAULT_TRADES)
export const BRAND_TRADE_PALETTE = ['#007ABE', '#1F1246', '#104682', '#5BA4D4', '#6B6F85', '#3A3566', '#9CC7E4', '#231F20', '#A7ABBD', '#2D6FA3']
export const DEFAULT_TRADES: Trade[] = [
  { name: 'Enabling Works / Strip-out', color: '#6B6F85' },
  { name: 'Groundworks & Structure', color: '#231F20' },
  { name: 'M&E', color: '#007ABE' },
  { name: 'Dry-lining & Partitions', color: '#104682' },
  { name: 'Joinery & Fit-out', color: '#1F1246' },
  { name: 'Finishes & Decoration', color: '#5BA4D4' },
  { name: 'FF&E & Equipment', color: '#3A3566' },
  { name: 'Commissioning & Handover', color: '#9CC7E4' },
]
export const CRITICAL_COLOR = '#C0392B'

// ---------- keeping the programme in order ----------
// sections in order (keeping empty ones), each section's tasks together, sort numbers to match, and
// every trade in use on the trade list with a colour (Timeline: resyncGroupOrder, getTrade)
export function normalize(w: Working): Working {
  const p = w.programme
  const sections = (p.sections ?? []).map((s) => ({ ...s }))
  for (const t of w.tasks) if (t.section != null && !sections.some((s) => s.name === t.section)) sections.push({ name: t.section, collapsed: false })
  p.sections = sections
  const ungrouped = w.tasks.filter((t) => t.section == null)
  w.tasks = [...ungrouped, ...sections.flatMap((s) => w.tasks.filter((t) => t.section === s.name))]
  w.tasks.forEach((t, i) => (t.sort = i))
  const trades = [...(p.trades ?? [])]
  for (const t of w.tasks)
    if (t.trade && !trades.some((x) => x.name === t.trade)) trades.push({ name: t.trade, color: BRAND_TRADE_PALETTE[trades.length % BRAND_TRADE_PALETTE.length] })
  if (trades.length !== (p.trades ?? []).length) p.trades = trades
  return w
}
// a programme as loaded: ids on every task (new ones get theirs here, saved with them)
export function prepare(programme: SavedProgramme, tasks: ProgrammeTask[]): Working {
  return normalize({ programme: { ...programme }, tasks: tasks.map((t) => ({ ...t, id: t.id ?? newTaskId(), predecessors: t.predecessors ?? [] })) })
}
// the programme's overall dates follow its tasks
function keepSpan(w: Working) {
  if (!w.tasks.length) return w
  w.programme.start_date = w.tasks.map((t) => t.start_date).sort()[0]
  w.programme.finish_date = w.tasks
    .map((t) => t.finish_date)
    .sort()
    .pop()!
  return w
}
// tasks changed: everything following them moves (Timeline: recalcTaskStart + cascadeFrom)
function settle(w: Working, codes: string[]) {
  const moves = reschedule(w.tasks, codes, sd(w))
  for (const t of w.tasks) withDates(t, moves.get(t.code))
  return keepSpan(normalize(w))
}
// the whole schedule run again after the calendar changes (Timeline: rescheduleAll)
function rescheduleAll(w: Working, before: Shutdown[] = sd(w)) {
  const moves = recalendar(w.tasks, before, sd(w))
  for (const t of w.tasks) withDates(t, moves.get(t.code))
  return keepSpan(normalize(w))
}
export const findTask = (w: Working, code: string) => w.tasks.find((t) => t.code === code)

// where new tasks start when there's nothing to follow: the programme start, else today (defaultStartDate)
export const defaultStart = (w: Working) => nextWorkingDay(w.programme.project_start || todayIso(), sd(w))
// the section a new task goes in: the last task's, else the last section (lastTaskGroupId)
export function lastSection(w: Working) {
  const last = w.tasks[w.tasks.length - 1]
  return last ? last.section : (w.programme.sections?.at(-1)?.name ?? null)
}
// a trade's colour, adding it to the list if it's new (getTrade)
export function tradeColorOf(w: Working, name: string | null) {
  if (!name) return '#6B6F85'
  const trades = w.programme.trades ?? []
  return trades.find((t) => t.name === name)?.color ?? BRAND_TRADE_PALETTE[trades.length % BRAND_TRADE_PALETTE.length]
}
function newTask(w: Working, fields: Partial<ProgrammeTask> & Pick<ProgrammeTask, 'name' | 'start_date'>): ProgrammeTask {
  const start = fields.skeleton ? fields.start_date : nextWorkingDay(fields.start_date, sd(w))
  return {
    id: newTaskId(),
    code: nextCode(w.tasks),
    section: lastSection(w),
    trade: null,
    contractor: null,
    milestone: false,
    progress: 0,
    rag: 'green',
    prereq_confirmed: false,
    prereq_note: null,
    predecessors: [],
    skeleton: false,
    baseline_start: null,
    baseline_duration: null,
    ...fields,
    start_date: start,
    finish_date: fields.finish_date ?? start,
  }
}

// ---------- tasks ----------
// quick add: after the last task, linked to it if wanted (submitQuickAdd)
export function quickAdd(w0: Working, o: { name: string; trade: string | null; days: number; link: boolean; contractor?: string | null }) {
  const w = clone(w0)
  const last = w.tasks[w.tasks.length - 1]
  const start = last ? shiftWorking(last.finish_date, 1, sd(w)) : defaultStart(w)
  const days = Math.max(1, Math.round(o.days) || 5)
  const t = newTask(w, {
    name: o.name.trim(),
    trade: o.trade,
    contractor: o.contractor || null,
    start_date: start,
    finish_date: finishFor(start, days, sd(w)),
    section: lastSection(w),
    predecessors: last && o.link ? [{ code: last.code, type: 'FS', lag: 0 }] : [],
  })
  w.tasks.push(t)
  return { w: settle(w, [t.code]), code: t.code }
}
// a blank task / milestone for the task form (openTaskModal)
export function draftTask(w: Working, milestone = false, contractor: string | null = null): ProgrammeTask {
  const start = defaultStart(w)
  return newTask(w, {
    name: '',
    start_date: start,
    finish_date: milestone ? start : finishFor(start, 5, sd(w)),
    milestone,
    trade: w.programme.trades?.[0]?.name ?? null,
    contractor,
  })
}
// the task form saved (saveTaskFromModal): a task moved to another section goes to its end (to the top
// with no section); a linked task's start is where its links put it
export function saveTask(w0: Working, t: ProgrammeTask) {
  const w = clone(w0)
  const i = w.tasks.findIndex((x) => x.id === t.id)
  const fixed = { ...t, predecessors: (t.predecessors ?? []).filter((l) => l.code !== t.code) }
  if (!fixed.skeleton) {
    fixed.start_date = nextWorkingDay(fixed.start_date, sd(w))
    if (!fixed.milestone && fixed.finish_date < fixed.start_date) fixed.finish_date = fixed.start_date
  }
  if (fixed.milestone) fixed.finish_date = fixed.start_date
  const moving = i < 0 || w.tasks[i].section !== fixed.section
  if (i >= 0) w.tasks.splice(i, 1)
  if (!moving) w.tasks.splice(i, 0, fixed)
  else if (fixed.section == null) w.tasks.unshift(fixed)
  else {
    const last = w.tasks.map((x) => x.section).lastIndexOf(fixed.section)
    w.tasks.splice(last < 0 ? w.tasks.length : last + 1, 0, fixed)
  }
  return settle(w, [fixed.code])
}
// deleteCurrentTask: links to it go too
export function deleteTask(w0: Working, code: string) {
  const w = clone(w0)
  w.tasks = w.tasks.filter((t) => t.code !== code)
  const followers = w.tasks.filter((t) => t.predecessors?.some((l) => l.code === code)).map((t) => t.code)
  for (const t of w.tasks) t.predecessors = (t.predecessors ?? []).filter((l) => l.code !== code)
  return settle(w, followers)
}
// duplicateCurrentTask: a copy straight after it, then opened to rename / re-date
export function duplicateTask(w0: Working, code: string) {
  const w = clone(w0)
  const i = w.tasks.findIndex((t) => t.code === code)
  if (i < 0) return { w: w0, code }
  const copy: ProgrammeTask = {
    ...structuredClone(w.tasks[i]),
    id: newTaskId(),
    code: nextCode(w.tasks),
    name: `${w.tasks[i].name} (copy)`,
    progress: 0,
    baseline_start: null,
    baseline_duration: null,
  }
  w.tasks.splice(i + 1, 0, copy)
  return { w: settle(w, [copy.code]), code: copy.code }
}
// a start typed in (editStartCell): a linked task keeps its links, with the change added to their lag
export function setStart(w0: Working, code: string, iso: string) {
  const w = clone(w0)
  const t = findTask(w, code)
  if (!t) return w0
  const start = t.skeleton ? iso : nextWorkingDay(iso, sd(w))
  if (t.predecessors?.length) {
    const n = workingDaysBetween(t.start_date, start, sd(w))
    t.predecessors = t.predecessors.map((l) => ({ ...l, lag: (l.lag || 0) + n }))
  }
  const days = lengthOf(t, sd(w))
  t.start_date = start
  t.finish_date = t.milestone ? start : finishFor(start, days, calendarOf(t, sd(w)))
  return settle(w, [code])
}
// a duration typed in (editDaysCell)
export function setDuration(w0: Working, code: string, days: number) {
  const w = clone(w0)
  const t = findTask(w, code)
  if (!t || t.milestone) return w0
  t.finish_date = finishFor(t.start_date, Math.max(1, Math.round(days)), calendarOf(t, sd(w)))
  return settle(w, [code])
}
// a bar dragged (move) or its end dragged (length): as setStart / setDuration
export function dragTo(w0: Working, code: string, dates: Partial<Dates>) {
  const t = findTask(w0, code)
  if (!t) return w0
  if (dates.start_date && dates.start_date !== t.start_date) return setStart(w0, code, dates.start_date)
  if (dates.finish_date && dates.finish_date !== t.finish_date) {
    const w = clone(w0)
    const x = findTask(w, code)!
    x.finish_date = dates.finish_date < x.start_date ? x.start_date : dates.finish_date
    return settle(w, [code])
  }
  return w0
}
// cycleRag: green → amber → red
export function cycleRag(w0: Working, code: string) {
  const w = clone(w0)
  const t = findTask(w, code)
  if (t) t.rag = t.rag === 'green' || !t.rag ? 'amber' : t.rag === 'amber' ? 'red' : 'green'
  return w
}
// link mode: the first task tapped, then its follower; tapping a linked pair unlinks them (handleLinkClick)
export function toggleLink(w0: Working, first: string, then: string, type: Link['type'] = 'FS'): { w: Working; result: 'linked' | 'unlinked' | 'loop' } {
  const w = clone(w0)
  const t = findTask(w, then)
  if (!t || first === then) return { w: w0, result: 'loop' }
  if (t.predecessors?.some((l) => l.code === first)) {
    t.predecessors = t.predecessors.filter((l) => l.code !== first)
    return { w: settle(w, [then]), result: 'unlinked' }
  }
  if (follows(w.tasks, first, then)) return { w: w0, result: 'loop' }
  t.predecessors = [...(t.predecessors ?? []), { code: first, type, lag: 0 }]
  return { w: settle(w, [then]), result: 'linked' }
}
// setBaseline: the current dates kept as the baseline, for tasks that don't have one yet
export function setBaseline(w0: Working) {
  const w = clone(w0)
  let n = 0
  for (const t of w.tasks)
    if (!t.baseline_start) {
      t.baseline_start = t.start_date
      t.baseline_duration = lengthOf(t, sd(w))
      n++
    }
  return { w, n }
}
// slipInfo: calendar days a task's start has moved from its baseline (null with no baseline)
export const slip = (t: ProgrammeTask) => (t.baseline_start ? Math.round((Date.parse(t.start_date) - Date.parse(t.baseline_start)) / 86400000) : null)

// ---------- rows ----------
// a row dragged in the task list (applyTaskDrop): dropped before another task (into its section), on a
// section heading (to the top of that section), or at the end
export function moveTaskRow(w0: Working, code: string, before: { code: string } | { section: string } | null) {
  const w = clone(w0)
  const i = w.tasks.findIndex((t) => t.code === code)
  if (i < 0 || (before && 'code' in before && before.code === code)) return w0
  const [t] = w.tasks.splice(i, 1)
  if (!before) {
    t.section = w.tasks.length ? w.tasks[w.tasks.length - 1].section : (w.programme.sections?.at(-1)?.name ?? null)
    w.tasks.push(t)
  } else if ('section' in before) {
    t.section = before.section
    const at = w.tasks.findIndex((x) => x.section === before.section)
    w.tasks.splice(at < 0 ? w.tasks.length : at, 0, t)
  } else {
    const b = w.tasks.findIndex((x) => x.code === before.code)
    t.section = w.tasks[b].section
    w.tasks.splice(b, 0, t)
  }
  return normalize(w)
}
// moveTask (the ▲▼ on a task): within its section
export function nudgeTask(w0: Working, code: string, dir: -1 | 1) {
  const w = clone(w0)
  const i = w.tasks.findIndex((t) => t.code === code)
  const j = i + dir
  if (i < 0 || j < 0 || j >= w.tasks.length || w.tasks[j].section !== w.tasks[i].section) return w0
  ;[w.tasks[i], w.tasks[j]] = [w.tasks[j], w.tasks[i]]
  return normalize(w)
}
// sortTasksBy('start'): within each section, earliest first (or last first, the second time)
export function sortByStart(w0: Working, dir: 1 | -1) {
  const w = clone(w0)
  const order = [null, ...(w.programme.sections ?? []).map((s) => s.name)]
  w.tasks = order.flatMap((s) => w.tasks.filter((t) => t.section === s).sort((a, b) => a.start_date.localeCompare(b.start_date) * dir))
  return normalize(w)
}

// ---------- sections ----------
export function addSection(w0: Working, name: string) {
  const w = clone(w0)
  if (!w.programme.sections?.some((s) => s.name === name)) w.programme.sections = [...(w.programme.sections ?? []), { name, collapsed: false }]
  return w
}
export function renameSection(w0: Working, from: string, to: string) {
  const w = clone(w0)
  for (const t of w.tasks) if (t.section === from) t.section = to
  const exists = w.programme.sections!.some((s) => s.name === to)
  w.programme.sections = exists ? w.programme.sections!.filter((s) => s.name !== from) : w.programme.sections!.map((s) => (s.name === from ? { ...s, name: to } : s))
  return normalize(w)
}
export function toggleCollapse(w0: Working, name: string) {
  const w = clone(w0)
  w.programme.sections = w.programme.sections!.map((s) => (s.name === name ? { ...s, collapsed: !s.collapsed } : s))
  return w
}
// moveGroup (▲▼ on a section heading)
export function moveSection(w0: Working, name: string, dir: -1 | 1) {
  const w = clone(w0)
  const list = w.programme.sections!
  const i = list.findIndex((s) => s.name === name)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return w0
  ;[list[i], list[j]] = [list[j], list[i]]
  return normalize(w)
}
// a section heading dragged (applyGroupDrop): before another section, or to the end
export function moveSectionTo(w0: Working, name: string, before: string | null) {
  const w = clone(w0)
  if (before === name) return w0
  const list = w.programme.sections!
  const s = list.splice(
    list.findIndex((x) => x.name === name),
    1,
  )[0]
  const at = before == null ? list.length : list.findIndex((x) => x.name === before)
  list.splice(at < 0 ? list.length : at, 0, s)
  return normalize(w)
}
// deleteGroup / confirmDeleteGroup: the heading only (its tasks kept, with no section) or with its tasks
export function deleteSection(w0: Working, name: string, mode: 'header' | 'all') {
  const w = clone(w0)
  w.programme.sections = w.programme.sections!.filter((s) => s.name !== name)
  if (mode === 'header') {
    for (const t of w.tasks) if (t.section === name) t.section = null
    return normalize(w)
  }
  const gone = new Set(w.tasks.filter((t) => t.section === name).map((t) => t.code))
  w.tasks = w.tasks.filter((t) => !gone.has(t.code))
  const followers = w.tasks.filter((t) => t.predecessors?.some((l) => gone.has(l.code))).map((t) => t.code)
  for (const t of w.tasks) t.predecessors = (t.predecessors ?? []).filter((l) => !gone.has(l.code))
  return settle(w, followers)
}
// insertSectionBefore: this task and the ones after it in the same section start a new section
export function insertSectionBefore(w0: Working, code: string, name: string) {
  const w = clone(w0)
  const i = w.tasks.findIndex((t) => t.code === code)
  if (i < 0) return w0
  const was = w.tasks[i].section
  for (let k = i; k < w.tasks.length && w.tasks[k].section === was; k++) w.tasks[k].section = name
  const list = w.programme.sections ?? []
  const after = list.findIndex((s) => s.name === was)
  list.splice(after < 0 ? 0 : after + 1, 0, { name, collapsed: false })
  w.programme.sections = list
  return normalize(w)
}
// SECTION_TEMPLATES: opt-in starter tasks, chained one after another after the last task
export const SECTION_TEMPLATES: Record<'precon' | 'closeout', { name: string; tasks: { name: string; duration?: number; milestone?: boolean }[] }> = {
  precon: {
    name: 'Precon',
    tasks: [
      { name: 'Tender received', milestone: true },
      { name: 'Tender period', duration: 14 },
      { name: 'Tender submission', milestone: true },
      { name: 'Tender review / negotiation', duration: 10 },
      { name: 'Contract award', milestone: true },
      { name: 'Design portion', duration: 15 },
      { name: 'Long lead orders placed', milestone: true },
      { name: 'Orders placed', milestone: true },
      { name: 'Mobilisation', duration: 5 },
    ],
  },
  closeout: {
    name: 'Close-out',
    tasks: [
      { name: 'Snag review', duration: 3 },
      { name: 'Snagging close out', duration: 10 },
      { name: 'Mastic', duration: 3 },
      { name: 'Cleaning', duration: 3 },
      { name: 'PC', milestone: true },
      { name: 'Handover', milestone: true },
    ],
  },
}
export function insertTemplate(w0: Working, key: keyof typeof SECTION_TEMPLATES) {
  const w = clone(w0)
  const tmpl = SECTION_TEMPLATES[key]
  let name = tmpl.name
  for (let k = 2; w.programme.sections?.some((s) => s.name === name); k++) name = `${tmpl.name} ${k}`
  w.programme.sections = [...(w.programme.sections ?? []), { name, collapsed: false }]
  const last = w.tasks[w.tasks.length - 1]
  let start = last ? shiftWorking(last.finish_date, 1, sd(w)) : defaultStart(w)
  let prev: string | null = null
  for (const spec of tmpl.tasks) {
    const t = newTask(w, {
      name: spec.name,
      section: name,
      trade: tmpl.name, // Timeline gives the starter tasks a trade named after the section
      start_date: start,
      finish_date: spec.milestone ? start : finishFor(start, spec.duration ?? 1, sd(w)),
      milestone: !!spec.milestone,
      predecessors: prev ? [{ code: prev, type: 'FS', lag: 0 }] : [],
    })
    w.tasks.push(t)
    start = shiftWorking(t.finish_date, 1, sd(w))
    prev = t.code
  }
  return keepSpan(normalize(w))
}
// "Floor 1" → "Floor 2", "Floor 3"…; names without a number get " 2", " 3" (nextCopyName)
export function nextCopyName(name: string, k: number) {
  const m = /^(.*?)(\d+)(\D*)$/.exec(name)
  return m ? m[1] + (parseInt(m[2], 10) + k) + m[3] : `${name} ${k + 1}`
}
// duplicateSection: copies of a section (repeating floors, blocks, plots), each starting N working days
// after the previous copy starts (staggered) or finishes (back to back), optionally linked so they stay in step
export function duplicateSection(w0: Working, name: string, o: { copies: number; offset: number; firstName: string; mode: 'starts' | 'finishes'; link: boolean }) {
  const w = clone(w0)
  const src = w.tasks.filter((t) => t.section === name)
  if (!src.length) return w0
  const earliest = (list: ProgrammeTask[]) => list.reduce((a, t) => (t.start_date < a.start_date ? t : a), list[0])
  const latest = (list: ProgrammeTask[]) => list.reduce((a, t) => (t.finish_date > a.finish_date ? t : a), list[0])
  const srcFirst = earliest(src)
  const srcFirstIdx = src.indexOf(srcFirst)
  let prev = src
  let after = name
  for (let c = 1; c <= o.copies; c++) {
    let section = c === 1 ? o.firstName : nextCopyName(o.firstName, c - 1)
    for (let k = 2; w.programme.sections!.some((s) => s.name === section); k++) section = `${c === 1 ? o.firstName : nextCopyName(o.firstName, c - 1)} (${k})`
    const target = o.mode === 'finishes' ? shiftWorking(latest(prev).finish_date, 1 + o.offset, sd(w)) : shiftWorking(earliest(prev).start_date, o.offset, sd(w))
    const k = Math.max(0, workingDaysBetween(srcFirst.start_date, target, sd(w)))
    const codes = new Map<string, string>()
    const clones = src.map((t) => {
      const copy: ProgrammeTask = {
        ...structuredClone(t),
        id: newTaskId(),
        code: nextCode(w.tasks),
        section,
        progress: 0,
        rag: 'green',
        baseline_start: null,
        baseline_duration: null,
      }
      w.tasks.push(copy) // so the next code counts on
      codes.set(t.code, copy.code)
      const days = lengthOf(t, sd(w))
      copy.start_date = shiftWorking(t.start_date, k, sd(w))
      if (!t.skeleton) copy.start_date = nextWorkingDay(copy.start_date, sd(w))
      copy.finish_date = t.milestone ? copy.start_date : finishFor(copy.start_date, days, calendarOf(t, sd(w)))
      return copy
    })
    // links inside the section point at the copies; links to outside tasks stay as they were
    for (const t of clones) t.predecessors = (t.predecessors ?? []).map((l) => ({ ...l, code: codes.get(l.code) ?? l.code }))
    if (o.link) {
      const first = clones[srcFirstIdx]
      const link: Link = o.mode === 'finishes' ? { code: latest(prev).code, type: 'FS', lag: o.offset } : { code: earliest(prev).code, type: 'SS', lag: o.offset }
      if (!first.predecessors!.some((l) => l.code === link.code)) first.predecessors!.push(link)
    }
    const at = w.programme.sections!.findIndex((s) => s.name === after)
    w.programme.sections!.splice(at + 1, 0, { name: section, collapsed: false })
    after = section
    prev = clones
  }
  return rescheduleAll(w)
}

// ---------- shifting ----------
// shiftProgramme: every task (and the programme start / Wk 1) moved by calendar days; baselines stay, so
// the shift shows as slip
export function shiftProgramme(w0: Working, days: number) {
  const w = clone(w0)
  for (const t of w.tasks) {
    if (t.predecessors?.length) continue
    const len = lengthOf(t, sd(w))
    t.start_date = addDays(t.start_date, days)
    if (!t.skeleton) t.start_date = nextWorkingDay(t.start_date, sd(w))
    t.finish_date = t.milestone ? t.start_date : finishFor(t.start_date, len, calendarOf(t, sd(w)))
  }
  if (w.programme.project_start) w.programme.project_start = addDays(w.programme.project_start, days)
  if (w.programme.week_start) w.programme.week_start = addDays(w.programme.week_start, days)
  return rescheduleAll(w)
}
// shiftSection: a section moved by working days; its links from outside the section take the shift as
// lag, so what follows it moves too
export function shiftSection(w0: Working, name: string | null, days: number) {
  const w = clone(w0)
  const inScope = (t: ProgrammeTask) => t.section === name
  const byCode = new Map(w.tasks.map((t) => [t.code, t]))
  for (const t of w.tasks.filter(inScope)) {
    if (!t.predecessors?.length) {
      const len = lengthOf(t, sd(w))
      t.start_date = shiftWorking(t.start_date, days, sd(w))
      t.finish_date = t.milestone ? t.start_date : finishFor(t.start_date, len, calendarOf(t, sd(w)))
    } else
      t.predecessors = t.predecessors.map((l) => {
        const p = byCode.get(l.code)
        return p && !inScope(p) ? { ...l, lag: (l.lag || 0) + days } : l
      })
  }
  return rescheduleAll(w)
}

// ---------- shutdowns (Christmas etc.) ----------
// the shutdowns changed: tasks keep their working-day lengths, so the schedule rolls over them
export function setShutdowns(w0: Working, list: Shutdown[]) {
  const w = clone(w0)
  const before = sd(w)
  w.programme.shutdowns = [...list].sort((a, b) => a.start.localeCompare(b.start))
  return rescheduleAll(w, before)
}
// suggestedXmasShutdowns: each Christmas inside the programme with no shutdown yet; two weeks from the
// Monday of Christmas Eve's week
export function suggestedXmasShutdowns(w: Working) {
  if (!w.tasks.length) return []
  const min = w.tasks.map((t) => t.start_date).sort()[0]
  const max = w.tasks
    .map((t) => t.finish_date)
    .sort()
    .pop()!
  const out: { year: number; start: string; end: string }[] = []
  for (let y = Number(min.slice(0, 4)); y <= Number(max.slice(0, 4)); y++) {
    const xmas = `${y}-12-25`
    if (xmas < min || xmas > max) continue
    if (sd(w).some((p) => p.start <= xmas && p.end >= xmas)) continue
    let s = `${y}-12-24`
    while (new Date(`${s}T00:00:00Z`).getUTCDay() !== 1) s = addDays(s, -1)
    out.push({ year: y, start: s, end: addDays(s, 11) })
  }
  return out
}

// ---------- trades / legend ----------
export function setTradeColor(w0: Working, name: string, color: string) {
  const w = clone(w0)
  const trades = [...(w.programme.trades ?? [])]
  const i = trades.findIndex((t) => t.name === name)
  if (i >= 0) trades[i] = { name, color }
  else trades.push({ name, color })
  w.programme.trades = trades
  return w
}
export function addTrade(w0: Working, name: string) {
  const w = clone(w0)
  if (!(w.programme.trades ?? []).some((t) => t.name === name)) w.programme.trades = [...(w.programme.trades ?? []), { name, color: tradeColorOf(w, name) }]
  return w
}
// applyBrandPalette
export function brandColours(w0: Working) {
  const w = clone(w0)
  w.programme.trades = (w.programme.trades ?? []).map((t, i) => ({ ...t, color: BRAND_TRADE_PALETTE[i % BRAND_TRADE_PALETTE.length] }))
  return w
}
// toneDownTradeColours: each colour part-way to grey, keeping its hue (toneDownHex)
export function toneDownHex(hex: string, keep: number) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  s *= keep
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    t = (t + 1) % 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const to = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(f(h + 1 / 3))}${to(f(h))}${to(f(h - 1 / 3))}`
}
export function toneDown(w0: Working) {
  const w = clone(w0)
  w.programme.trades = (w.programme.trades ?? []).map((t) => ({ ...t, color: toneDownHex(t.color, 0.7) }))
  return w
}

// ---------- week numbers (Wk 1 = start on site) ----------
// constructionStartAnchor: a section called Construction, else outside Precon / Close-out, else everything
const isPrecon = (name: string | null) => /pre[\s-]?con/i.test(name ?? '')
export function constructionStart(w: Working) {
  if (!w.tasks.length) return null
  const earliest = (list: ProgrammeTask[]) => list.map((t) => t.start_date).sort()[0]
  const construction = w.programme.sections?.find((s) => /construction/i.test(s.name) && !isPrecon(s.name))
  if (construction) {
    const ts = w.tasks.filter((t) => t.section === construction.name)
    if (ts.length) return earliest(ts)
  }
  const bookend = (name: string | null) => !!name && (isPrecon(name) || /close.?out/i.test(name))
  const mid = w.tasks.filter((t) => !bookend(t.section))
  return earliest(mid.length ? mid : w.tasks)
}
// weekAnchorMonday: the Monday of Wk 1 (set by hand, else worked out)
export function weekOneMonday(w: Working) {
  const anchor = w.programme.week_start || constructionStart(w)
  if (!anchor) return null
  let d = anchor
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, -1)
  return d
}
// weekNumberFor: Wk 1, 2, 3… from start on site; before it Wk -1, -2… (no Wk 0)
export function weekNumber(iso: string, monday: string | null) {
  if (!monday) return null
  const diff = Math.round((Date.parse(iso) - Date.parse(monday)) / 86400000)
  return diff >= 0 ? Math.floor(diff / 7) + 1 : Math.floor(diff / 7)
}

// ---------- typing dates (parseUKDate) ----------
// "28/9", "28/9/26" or "28/9/2026"; with no year, the first such date on or after the programme start
export function parseUKDate(str: string, fallbackYear: number, anchor: string | null) {
  const m = (str || '').trim().match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/)
  if (!m) return null
  const d = parseInt(m[1])
  const mo = parseInt(m[2])
  let y = m[3] !== undefined ? parseInt(m[3]) : fallbackYear
  if (y < 100) y += y < 70 ? 2000 : 1900
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const iso = (yy: number) => `${yy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const valid = (s: string) => new Date(`${s}T00:00:00Z`).getUTCMonth() === mo - 1
  let out = iso(y)
  if (!valid(out)) return null
  if (m[3] === undefined && anchor) {
    out = iso(Number(anchor.slice(0, 4)))
    if (out < anchor) out = iso(Number(anchor.slice(0, 4)) + 1)
    if (!valid(out)) return null
  }
  return out
}

// ---------- programme settings ----------
export function setSetting(w0: Working, fields: Partial<Pick<SavedProgramme, 'project_name' | 'project_start' | 'week_start' | 'client_logo' | 'contract_rev'>>) {
  const w = clone(w0)
  Object.assign(w.programme, fields)
  return w
}

// ---------- a previous programme as the start of a new one ----------
// everything moved so its first task starts on the new date (in working days, so the pattern of the
// weeks is kept), links and sections kept; progress, RAG and baselines cleared. Shutdowns are calendar
// dates, so they're left behind (the Shutdown menu offers Christmas again).
export function copyForNewStart(
  source: { programme: SavedProgramme; tasks: ProgrammeTask[] },
  start: string,
): Pick<Working, 'tasks'> & { sections: SavedProgramme['sections']; trades: Trade[] } {
  const was = source.programme.shutdowns ?? []
  const first = source.tasks.map((t) => t.start_date).sort()[0] ?? start
  const k = workingDaysBetween(first, nextWorkingDay(start), [])
  const tasks = source.tasks.map((t) => {
    const len = lengthOf(t, was)
    const s = nextWorkingDay(shiftWorking(t.start_date, k, []))
    return {
      ...t,
      id: undefined,
      start_date: s,
      finish_date: t.milestone ? s : finishFor(s, len, []),
      progress: 0,
      rag: 'green' as const,
      baseline_start: null,
      baseline_duration: null,
    }
  })
  const moves = reschedule(
    tasks,
    tasks.map((t) => t.code),
    [],
  )
  return {
    tasks: tasks.map((t) => ({ ...t, ...(moves.get(t.code) ?? {}) })),
    sections: (source.programme.sections ?? []).map((s) => ({ name: s.name, collapsed: false })),
    trades: source.programme.trades ?? [],
  }
}
export const isWorking = isWorkingDay
