// The programme compared with the original (contract) programme or any committed revision (Richard,
// 22 Nov: "an overlay feature where the new programme is shown as an overlay on the original programme
// to see slippage", for an EOT). Tasks are matched by activity code. Kept free of the database and the
// screen so it can be tested on its own.
import type { ProgrammeTask, Shutdown } from './programme'
import { daysBetween } from './programmeEdit'
import { workingDaysBetween } from './programmeLinks'
import { fromTimeline, type TLState } from './timelineFormat'

export interface CompareBar {
  name: string
  start_date: string
  finish_date: string
  milestone: boolean
}
export interface Comparison {
  rev_no: number
  label: string // e.g. "Initial issue (original)"
  bars: Map<string, CompareBar>
  shutdowns: Shutdown[]
}

// a committed revision's tasks, by activity code
export function comparisonFrom(rev_no: number, label: string, data: unknown): Comparison {
  const p = fromTimeline((data ?? {}) as Partial<TLState>)
  return {
    rev_no,
    label,
    shutdowns: p.shutdowns ?? [],
    bars: new Map(p.tasks.map((t) => [t.code, { name: t.name, start_date: t.start_date, finish_date: t.finish_date, milestone: t.milestone }])),
  }
}

// how far a task's finish has moved: calendar days (as Timeline's slip) and working days
export function finishSlip(t: Pick<ProgrammeTask, 'finish_date'>, was: CompareBar | undefined, shutdowns: Shutdown[] = []) {
  if (!was) return null
  return { days: daysBetween(was.finish_date, t.finish_date), working: workingDaysBetween(was.finish_date, t.finish_date, shutdowns) }
}

// completion: the Practical Completion milestone if there is one (else the last task to finish)
const isPC = (name: string) => /practical\s*completion|^\s*p\.?c\.?\s*$|^\s*pc\b/i.test(name)
function completion(tasks: { code: string; name: string; finish_date: string; milestone: boolean }[]) {
  const pc = tasks.filter((t) => t.milestone && isPC(t.name)).sort((a, b) => b.finish_date.localeCompare(a.finish_date))[0]
  return pc ?? [...tasks].sort((a, b) => b.finish_date.localeCompare(a.finish_date))[0] ?? null
}

// the summary over the overlay: completion then and now, and how many tasks moved
export function compareSummary(tasks: ProgrammeTask[], c: Comparison, shutdowns: Shutdown[] = []) {
  let later = 0
  let earlier = 0
  let same = 0
  const added: ProgrammeTask[] = []
  for (const t of tasks) {
    const s = finishSlip(t, c.bars.get(t.code), shutdowns)
    if (!s) added.push(t)
    else if (s.days > 0) later++
    else if (s.days < 0) earlier++
    else same++
  }
  const codes = new Set(tasks.map((t) => t.code))
  const removed = [...c.bars.entries()].filter(([code]) => !codes.has(code)).map(([, b]) => b.name)
  const nowEnd = completion(tasks)
  // compare like with like: the same task if it's still there, else the original's own completion
  const wasEnd = nowEnd && c.bars.get(nowEnd.code) ? c.bars.get(nowEnd.code)! : completion([...c.bars.entries()].map(([code, b]) => ({ code, ...b })))
  const moved =
    nowEnd && wasEnd ? { days: daysBetween(wasEnd.finish_date, nowEnd.finish_date), working: workingDaysBetween(wasEnd.finish_date, nowEnd.finish_date, shutdowns) } : null
  return { later, earlier, same, added, removed, completionName: nowEnd?.name ?? null, wasFinish: wasEnd?.finish_date ?? null, nowFinish: nowEnd?.finish_date ?? null, moved }
}
