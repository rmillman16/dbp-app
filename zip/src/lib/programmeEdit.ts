// Dates for editing a programme in the app (the Programme tab, 21 Nov). Kept free of the database
// so it can be tested on its own. Durations are working days: Monday to Friday, less the
// programme's shutdowns (e.g. Christmas), as DBP Timeline counts them.
import type { ProgrammeTask, Shutdown } from './programme'

const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (s: string, n: number) => {
  const d = toDate(s)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000)

export function isWorkingDay(s: string, shutdowns: Shutdown[] = []) {
  const wd = toDate(s).getUTCDay()
  return wd !== 0 && wd !== 6 && !shutdowns.some((x) => s >= x.start && s <= x.end)
}
// the day itself if it's a working day, else the next one
export function nextWorkingDay(s: string, shutdowns: Shutdown[] = []) {
  let d = s
  for (let i = 0; i < 400 && !isWorkingDay(d, shutdowns); i++) d = addDays(d, 1)
  return d
}
// working days from start to finish, both counted (a milestone is 0)
export function duration(t: Pick<ProgrammeTask, 'start_date' | 'finish_date' | 'milestone'>, shutdowns: Shutdown[] = []) {
  if (t.milestone) return 0
  let n = 0
  for (let d = t.start_date; d <= t.finish_date; d = addDays(d, 1)) if (isWorkingDay(d, shutdowns)) n++
  return Math.max(1, n)
}
// the finish for a start and a number of working days
export function finishFor(start: string, days: number, shutdowns: Shutdown[] = []) {
  let d = nextWorkingDay(start, shutdowns)
  for (let left = Math.max(1, Math.round(days)) - 1; left > 0;) {
    d = addDays(d, 1)
    if (isWorkingDay(d, shutdowns)) left--
  }
  return d
}
// a task moved by a number of calendar days, keeping its working-day duration
export function moved(t: ProgrammeTask, days: number, shutdowns: Shutdown[] = []): Pick<ProgrammeTask, 'start_date' | 'finish_date'> {
  const start = nextWorkingDay(addDays(t.start_date, days), shutdowns)
  return { start_date: start, finish_date: t.milestone ? start : finishFor(start, duration(t, shutdowns), shutdowns) }
}
// a task's finish dragged by a number of calendar days (never before its start)
export function stretched(t: ProgrammeTask, days: number): Pick<ProgrammeTask, 'finish_date'> {
  const f = addDays(t.finish_date, days)
  return { finish_date: f < t.start_date ? t.start_date : f }
}

// the next activity number in the programme's own style (A1010 → A1420), else A1010, A1020…
export function nextCode(tasks: Pick<ProgrammeTask, 'code'>[]) {
  let prefix = 'A'
  let max = 1000
  for (const t of tasks) {
    const m = /^([A-Za-z]*)(\d+)$/.exec(t.code)
    if (m && Number(m[2]) >= max) ((prefix = m[1] || prefix), (max = Number(m[2])))
  }
  return `${prefix}${max + 10}`
}

// a trade's colour: its own, else one of these by its name (the same each time)
const PALETTE = ['#2f6fb5', '#d07149', '#5c9e4a', '#8c5bb8', '#c9a227', '#3b9a9c', '#b8476a', '#6d7f99', '#a4508a', '#4c5b70', '#ea7a1a', '#1f8a70']
export function tradeColor(name: string | null, own: { name: string; color: string }[] = []) {
  if (!name) return '#7d8597'
  const set = own.find((t) => t.name === name)?.color
  if (set) return set
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

// the chart's range: whole weeks (Monday to Sunday) around every task, with a little room
export function chartRange(tasks: Pick<ProgrammeTask, 'start_date' | 'finish_date'>[], fallback: string) {
  const starts = tasks.map((t) => t.start_date).sort()
  const ends = tasks.map((t) => t.finish_date).sort()
  let from = addDays(starts[0] ?? fallback, -7)
  const to = addDays(ends[ends.length - 1] ?? addDays(fallback, 90), 21)
  while (toDate(from).getUTCDay() !== 1) from = addDays(from, -1)
  return { from, days: daysBetween(from, to) + 1 }
}
