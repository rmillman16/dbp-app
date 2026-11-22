// DBP Timeline's own programme layout (reference/timeline-app-2026-11-21.html: newState / serialize).
// The app turns a programme into this shape for everything ported from Timeline (print, MS Project
// and P6 export, "what changed" between revisions) and for the .json download, so a file saved
// here opens in Timeline and the other way round. Timeline task IDs are the app's activity codes.
import type { ParsedProgramme, ProgrammeTask, SavedProgramme, Shutdown } from './programme'
import { duration, finishFor } from './programmeEdit'

export type Rag = 'green' | 'amber' | 'red'
export interface TLLink {
  id: string // the task it follows (its activity code)
  type: 'FS' | 'SS' | 'FF'
  lag: number // working days
}
export interface TLTask {
  id: string
  name: string
  trade: string
  contractor: string
  start: string // YYYY-MM-DD
  duration: number // working days (a milestone is 1)
  milestone: boolean
  progress: number
  rag: Rag
  prereqConfirmed: boolean
  prereqNote: string
  predecessors: TLLink[]
  skeleton: boolean // works through shutdowns
  baselineStart: string | null
  baselineDuration: number | null
  groupId: string | null
  critical?: boolean // the app's own: marked as on the critical path
}
export interface TLGroup {
  id: string
  name: string
  collapsed: boolean
}
export interface TLShutdown {
  id: string
  name: string
  start: string
  end: string
}
export interface TLState {
  schemaVersion: number
  projectName: string
  clientLogo: string | null // a data URL
  projectStart: string | null
  weekStart: string | null // the Monday-or-any date Wk 1 starts; null = worked out
  shutdowns: TLShutdown[]
  trades: { name: string; color: string }[]
  tasks: TLTask[] // same-section tasks together, in programme order
  groups: TLGroup[] // sections in order
}

// Timeline's revision names: 1 = Initial issue, 2 = Rev A, 3 = Rev B … 28 = Rev AA
export function revLabel(n: number) {
  let s = ''
  while (n > 0) {
    n--
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26)
  }
  return s
}
export const revName = (n: number) => (n === 1 ? 'Initial issue' : `Rev ${revLabel(n - 1)}`)

// a section's place: the programme's own order first (it keeps empty sections), then any others in
// the order their first task comes
export function sectionOrder(programme: Pick<SavedProgramme, 'sections'> | null, tasks: Pick<ProgrammeTask, 'section' | 'sort'>[]) {
  const order: { name: string | null; collapsed: boolean }[] = (programme?.sections ?? []).map((s) => ({ name: s.name, collapsed: !!s.collapsed }))
  for (const t of [...tasks].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) if (!order.some((s) => s.name === t.section)) order.push({ name: t.section, collapsed: false })
  return order
}

// a Timeline programme (its file, or an issued revision) in the app's layout: every field kept
export function fromTimeline(d: Partial<TLState>): ParsedProgramme {
  const day = (s: unknown) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null)
  const shutdowns: Shutdown[] = (d.shutdowns ?? []).filter((x) => day(x.start) && day(x.end)).map((x) => ({ name: x.name || 'Shutdown', start: day(x.start)!, end: day(x.end)! }))
  const groups = new Map((d.groups ?? []).map((g) => [String(g.id), g]))
  const tasks: ProgrammeTask[] = (d.tasks ?? [])
    .filter((t) => day(t.start))
    .map((t) => {
      const start = day(t.start)!
      const days = Math.max(1, Math.round(Number(t.duration ?? 1)))
      return {
        code: String(t.id),
        name: t.name ?? '',
        section: t.groupId != null ? (groups.get(String(t.groupId))?.name ?? null) : null,
        trade: t.trade || null,
        contractor: t.contractor || null,
        start_date: start,
        finish_date: t.milestone ? start : finishFor(start, days, t.skeleton ? [] : shutdowns),
        milestone: !!t.milestone,
        progress: Math.round(Number(t.progress ?? 0)) || 0,
        rag: t.rag === 'amber' || t.rag === 'red' ? t.rag : 'green',
        prereq_confirmed: !!t.prereqConfirmed,
        prereq_note: t.prereqNote || null,
        skeleton: !!t.skeleton,
        baseline_start: day(t.baselineStart),
        baseline_duration: t.baselineDuration != null ? Math.round(Number(t.baselineDuration)) : null,
        critical: !!t.critical,
        predecessors: (t.predecessors ?? []).map((p) => ({
          code: String(p.id),
          type: p.type === 'SS' || p.type === 'FF' ? p.type : 'FS',
          lag: Math.round(Number(p.lag ?? 0)) || 0,
        })),
      }
    })
  const codes = new Set(tasks.map((t) => t.code))
  for (const t of tasks) t.predecessors = t.predecessors!.filter((l) => codes.has(l.code) && l.code !== t.code)
  const starts = tasks.map((t) => t.start_date).sort()
  const ends = tasks.map((t) => t.finish_date).sort()
  return {
    project_name: d.projectName || 'Programme',
    start_date: starts[0] ?? null,
    finish_date: ends[ends.length - 1] ?? null,
    tasks,
    trades: (d.trades ?? []).filter((t) => t.name && /^#[0-9a-f]{6}$/i.test(t.color)).map((t) => ({ name: t.name, color: t.color })),
    shutdowns,
    sections: (d.groups ?? []).map((g) => ({ name: g.name, collapsed: !!g.collapsed })),
    project_start: day(d.projectStart),
    week_start: day(d.weekStart),
    client_logo: typeof d.clientLogo === 'string' && d.clientLogo.startsWith('data:image/') ? d.clientLogo : null,
  }
}

// the app's programme in Timeline's layout
export function toTimeline(programme: SavedProgramme, tasks: ProgrammeTask[]): TLState {
  const shutdowns = programme.shutdowns ?? []
  const sections = sectionOrder(programme, tasks)
  const groups: TLGroup[] = sections.filter((s) => s.name != null).map((s, i) => ({ id: `g${i + 1}`, name: s.name!, collapsed: s.collapsed }))
  const groupOf = (name: string | null) => groups.find((g) => g.name === name)?.id ?? null
  const ordered = sections.flatMap((s) => tasks.filter((t) => t.section === s.name).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)))
  return {
    schemaVersion: 1,
    projectName: programme.project_name || 'Programme',
    clientLogo: programme.client_logo ?? null,
    projectStart: programme.project_start ?? null,
    weekStart: programme.week_start ?? null,
    shutdowns: shutdowns.map((s, i) => ({ id: `s${i + 1}`, ...s })),
    trades: programme.trades ?? [],
    groups,
    tasks: ordered.map((t) => ({
      id: t.code,
      name: t.name,
      trade: t.trade ?? '',
      contractor: t.contractor ?? '',
      start: t.start_date,
      duration: t.milestone ? 1 : duration(t, t.skeleton ? [] : shutdowns),
      milestone: t.milestone,
      progress: t.progress ?? 0,
      rag: t.rag ?? 'green',
      prereqConfirmed: !!t.prereq_confirmed,
      prereqNote: t.prereq_note ?? '',
      predecessors: (t.predecessors ?? []).map((l) => ({ id: l.code, type: l.type, lag: l.lag })),
      skeleton: !!t.skeleton,
      baselineStart: t.baseline_start ?? null,
      baselineDuration: t.baseline_duration ?? null,
      groupId: groupOf(t.section),
      critical: !!t.critical,
    })),
  }
}
