// Links between a programme's tasks and the critical path (Programme tab, 21 Nov). Ported from DBP
// Timeline's scheduling engine (reference/timeline-app-2026-11-21.html: computeImpliedStart,
// cascadeFrom, computeLateFinishes) so a programme behaves the same here as it did there:
// - a linked task starts as soon as its links allow: finish-to-start (the day after the task it
//   follows finishes), start-to-start (the day it starts) or finish-to-finish (finishing when it
//   finishes), each plus a lag in working days (negative to overlap);
// - change a task and everything that follows it moves with it;
// - the critical path: tasks that can't slip a day without pushing the programme's finish out.
// Links are by activity code, so they survive a new revision. Kept free of the database so it can
// be tested on its own.
import type { Link, LinkType, ProgrammeTask, Shutdown } from './programme'
import { addDays, duration, finishFor, isWorkingDay, nextWorkingDay } from './programmeEdit'

export const LINK_TYPES: { type: LinkType; label: string; short: string }[] = [
  { type: 'FS', label: 'Starts after it finishes (finish to start)', short: 'after it finishes' },
  { type: 'SS', label: 'Starts when it starts (start to start)', short: 'when it starts' },
  { type: 'FF', label: 'Finishes when it finishes (finish to finish)', short: 'finishes with it' },
]

// n working days on from a date, not counting the date itself (n may be negative)
export function shiftWorking(date: string, n: number, shutdowns: Shutdown[] = []) {
  let d = date
  const step = n >= 0 ? 1 : -1
  for (let moved = 0, guard = 0; moved !== n && guard < 5000; guard++) {
    d = addDays(d, step)
    if (isWorkingDay(d, shutdowns)) moved += step
  }
  return d
}
// working days from a to b: positive if b is later (counts the days after a up to and including b)
export function workingDaysBetween(a: string, b: string, shutdowns: Shutdown[] = []) {
  if (a === b) return 0
  const step = b > a ? 1 : -1
  let n = 0
  for (let d = a, guard = 0; d !== b && guard < 5000; guard++) {
    d = addDays(d, step)
    if (isWorkingDay(d, shutdowns)) n += step
  }
  return n
}

// a task's length for the links: a milestone counts as one day, as in Timeline
// a skeleton crew works through shutdowns, so its own length counts them (Timeline: taskEndDate)
export const calendarOf = (t: Pick<ProgrammeTask, 'skeleton'>, shutdowns: Shutdown[]) => (t.skeleton ? [] : shutdowns)
const length = (t: ProgrammeTask, shutdowns: Shutdown[]) => (t.milestone ? 1 : duration(t, calendarOf(t, shutdowns)))

// where one link would put the task's start
export function impliedStart(link: Link, pred: ProgrammeTask, days: number, shutdowns: Shutdown[] = []) {
  const lag = Math.round(link.lag || 0)
  if (link.type === 'SS') return shiftWorking(pred.start_date, lag, shutdowns)
  if (link.type === 'FF') return shiftWorking(shiftWorking(pred.finish_date, lag, shutdowns), -(days - 1), shutdowns)
  return shiftWorking(pred.finish_date, 1 + lag, shutdowns) // FS
}

// the tasks a change moves. `tasks` already holds the edited tasks as edited; `edited` are their
// codes. A linked edited task is put back where its links say; then everything following each
// edited task is moved in turn. Returns only the tasks whose dates change.
export function reschedule(tasks: ProgrammeTask[], edited: string[], shutdowns: Shutdown[] = []) {
  const byCode = new Map(tasks.map((t) => [t.code, { ...t }]))
  const days = new Map(tasks.map((t) => [t.code, length(t, shutdowns)]))
  const followers = new Map<string, string[]>()
  for (const t of tasks) for (const l of t.predecessors ?? []) followers.set(l.code, [...(followers.get(l.code) ?? []), t.code])
  const changed = new Map<string, Pick<ProgrammeTask, 'start_date' | 'finish_date'>>()

  const place = (code: string) => {
    const t = byCode.get(code)
    if (!t) return false
    let latest = ''
    for (const l of t.predecessors ?? []) {
      const p = byCode.get(l.code)
      if (!p || l.code === code) continue
      const s = impliedStart(l, p, days.get(code)!, shutdowns)
      if (s > latest) latest = s
    }
    if (!latest) return false
    // a skeleton crew may start in a shutdown; anything else moves to the next working day (Timeline
    // can leave one starting on a shut day after a negative lag: deliberately not copied)
    const start = nextWorkingDay(latest, calendarOf(t, shutdowns))
    const finish = t.milestone ? start : finishFor(start, days.get(code)!, calendarOf(t, shutdowns))
    if (start === t.start_date && finish === t.finish_date) return false
    t.start_date = start
    t.finish_date = finish
    changed.set(code, { start_date: start, finish_date: finish })
    return true
  }

  edited.forEach(place)
  const queue = [...edited]
  for (let guard = 0; queue.length && guard < tasks.length * 50 + 100; guard++) {
    const code = queue.shift()!
    for (const f of followers.get(code) ?? []) if (place(f)) queue.push(f)
  }
  return changed
}

// the shutdowns changed (Timeline's rescheduleAll): each task keeps its length in working days, so
// one across a new shutdown finishes later; an unlinked task starting in a shutdown moves to the
// next working day; then the links are followed. Returns only the tasks whose dates change.
export function recalendar(tasks: ProgrammeTask[], before: Shutdown[], after: Shutdown[]) {
  const changed = new Map<string, Pick<ProgrammeTask, 'start_date' | 'finish_date'>>()
  const next = tasks.map((t) => {
    const days = length(t, before)
    const start = t.predecessors?.length || t.skeleton ? t.start_date : nextWorkingDay(t.start_date, after)
    const finish = t.milestone ? start : finishFor(start, days, calendarOf(t, after))
    if (start !== t.start_date || finish !== t.finish_date) changed.set(t.code, { start_date: start, finish_date: finish })
    return { ...t, start_date: start, finish_date: finish }
  })
  for (const [code, d] of reschedule(
    next,
    next.map((t) => t.code),
    after,
  ))
    changed.set(code, d)
  return changed
}

// does task `a` follow task `b`, directly or through others? (a link from b to a would be a loop)
export function follows(tasks: ProgrammeTask[], a: string, b: string) {
  const byCode = new Map(tasks.map((t) => [t.code, t]))
  const seen = new Set<string>()
  const stack = [a]
  while (stack.length) {
    const c = stack.pop()!
    if (c === b) return true
    if (seen.has(c)) continue
    seen.add(c)
    for (const l of byCode.get(c)?.predecessors ?? []) stack.push(l.code)
  }
  return false
}

// the critical path: Timeline's backward pass. For each task, the latest it could finish without
// pushing the programme's finish out; a task with no slack (or already past it) is critical.
export function criticalPath(tasks: ProgrammeTask[], shutdowns: Shutdown[] = []) {
  const critical = new Set<string>()
  if (!tasks.length) return critical
  const end = tasks
    .map((t) => t.finish_date)
    .sort()
    .pop()!
  const followers = new Map<string, { t: ProgrammeTask; link: Link }[]>()
  const codes = new Set(tasks.map((t) => t.code))
  for (const t of tasks) for (const link of t.predecessors ?? []) if (codes.has(link.code)) followers.set(link.code, [...(followers.get(link.code) ?? []), { t, link }])

  const late = new Map<string, string>()
  const visiting = new Set<string>()
  const latestFinish = (t: ProgrammeTask): string => {
    const known = late.get(t.code)
    if (known) return known
    if (visiting.has(t.code)) return t.finish_date // a loop: stop here
    visiting.add(t.code)
    let lf: string | null = null
    for (const { t: f, link } of followers.get(t.code) ?? []) {
      const fLf = latestFinish(f)
      const fLs = shiftWorking(fLf, -(length(f, shutdowns) - 1), shutdowns)
      const lag = Math.round(link.lag || 0)
      const limit =
        link.type === 'SS'
          ? finishFor(shiftWorking(fLs, -lag, shutdowns), length(t, shutdowns), shutdowns) // Timeline counts these on the full calendar, skeleton or not
          : link.type === 'FF'
            ? shiftWorking(fLf, -lag, shutdowns)
            : shiftWorking(fLs, -(1 + lag), shutdowns)
      if (lf === null || limit < lf) lf = limit
    }
    visiting.delete(t.code)
    const result = lf ?? end
    late.set(t.code, result)
    return result
  }
  for (const t of tasks) if (t.finish_date === latestFinish(t)) critical.add(t.code) // no slack (Timeline: exactly equal)
  return critical
}
