// The job's programme, imported from the file saved from DBP Timeline (docs/decisions.md
// "Cashflow: built"), until Timeline is merged into the app. Two formats:
// - P6 .xer (Timeline's "Primavera" export): tab-separated tables. PROJWBS gives the sections,
//   TASK the activities (ID, name, dates), ACTVCODE / TASKACTV the trade of each. Started
//   activities use their actual dates, the rest their scheduled (early) dates.
// - Timeline's own file (.json, as read from its autosave on 18 Nov): groups, trades and tasks
//   with a start and a duration in working days.
// Activities are kept by their ID (A1010…), so links to them survive a new revision.
import { supabase } from './supabase'
import { cached, must } from './offline'
import { addWorkingDays } from './cashflowCalc'

export interface ProgrammeTask {
  code: string
  name: string
  section: string | null
  trade: string | null
  start_date: string // YYYY-MM-DD
  finish_date: string
  milestone: boolean
}

export interface ParsedProgramme {
  project_name: string
  start_date: string | null
  finish_date: string | null
  tasks: ProgrammeTask[]
}

export interface SavedProgramme {
  id: string
  job_id: string
  file_name: string | null
  project_name: string | null
  start_date: string | null
  finish_date: string | null
  imported_at: string
}

const day = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null)

function span(tasks: ProgrammeTask[]) {
  const starts = tasks.map((t) => t.start_date).sort()
  const ends = tasks.map((t) => t.finish_date).sort()
  return { start_date: starts[0] ?? null, finish_date: ends[ends.length - 1] ?? null }
}

// ---------- P6 .xer ----------
function parseXer(text: string): ParsedProgramme {
  const tables = new Map<string, Record<string, string>[]>()
  let name = ''
  let fields: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const p = line.split('\t')
    if (p[0] === '%T') {
      name = p[1]
      tables.set(name, [])
    } else if (p[0] === '%F') fields = p
    else if (p[0] === '%R') {
      const row: Record<string, string> = {}
      for (let i = 1; i < fields.length; i++) row[fields[i]] = p[i] ?? ''
      tables.get(name)?.push(row)
    }
  }
  const tasksIn = tables.get('TASK') ?? []
  if (!tasksIn.length) throw new Error("This .xer file has no activities (no TASK table). Save the programme from Timeline again and try once more.")
  const project = (tables.get('PROJECT') ?? [])[0]

  // sections: the WBS path below the project's own node
  const wbs = new Map((tables.get('PROJWBS') ?? []).map((w) => [w.wbs_id, w]))
  const sectionOf = (id: string) => {
    const parts: string[] = []
    for (let w = wbs.get(id); w && w.proj_node_flag !== 'Y'; w = wbs.get(w.parent_wbs_id)) parts.unshift(w.wbs_name)
    return parts.join(' / ') || null
  }
  // trade: the activity code of the "Trade" type (else the first code it has)
  const types = tables.get('ACTVTYPE') ?? []
  const tradeType = types.find((t) => /trade/i.test(t.actv_code_type))?.actv_code_type_id
  const codes = new Map((tables.get('ACTVCODE') ?? []).map((c) => [c.actv_code_id, c]))
  const tradeOf = new Map<string, string>()
  for (const a of tables.get('TASKACTV') ?? []) {
    if (tradeType && a.actv_code_type_id !== tradeType) continue
    if (!tradeOf.has(a.task_id)) tradeOf.set(a.task_id, codes.get(a.actv_code_id)?.actv_code_name ?? '')
  }

  const tasks: ProgrammeTask[] = []
  for (const t of tasksIn) {
    const start = day(t.act_start_date) ?? day(t.early_start_date) ?? day(t.target_start_date) ?? day(t.restart_date)
    const finish = day(t.act_end_date) ?? day(t.early_end_date) ?? day(t.target_end_date) ?? day(t.reend_date) ?? start
    if (!start || !finish) continue
    tasks.push({
      code: t.task_code || t.task_id,
      name: t.task_name,
      section: sectionOf(t.wbs_id),
      trade: tradeOf.get(t.task_id) || null,
      start_date: start,
      finish_date: finish < start ? start : finish,
      milestone: /mile/i.test(t.task_type),
    })
  }
  return { project_name: project?.proj_short_name || 'Programme', ...span(tasks), tasks }
}

// ---------- Timeline's own file ----------
interface TimelineFile {
  data?: {
    projectName?: string
    groups?: { id: string | number; name: string }[]
    shutdowns?: { start: string; end: string }[]
    tasks?: { id: string | number; name: string; groupId?: string | number; trade?: string; start: string; duration?: number; milestone?: boolean }[]
  }
}
function parseTimeline(json: TimelineFile): ParsedProgramme {
  const d = json.data
  if (!d?.tasks?.length) throw new Error("This file has no programme tasks. Save the programme from Timeline again and try once more.")
  const groups = new Map((d.groups ?? []).map((g) => [String(g.id), g.name]))
  const shut = d.shutdowns ?? []
  const tasks: ProgrammeTask[] = d.tasks
    .filter((t) => day(t.start))
    .map((t) => {
      const start = day(t.start)!
      const days = Math.max(1, Math.round(Number(t.duration ?? 1)))
      return {
        code: String(t.id),
        name: t.name,
        section: t.groupId != null ? (groups.get(String(t.groupId)) ?? null) : null,
        trade: t.trade || null,
        start_date: start,
        finish_date: t.milestone ? start : addWorkingDays(start, days - 1, shut),
        milestone: !!t.milestone,
      }
    })
  return { project_name: d.projectName || 'Programme', ...span(tasks), tasks }
}

export async function parseProgramme(file: File): Promise<ParsedProgramme> {
  const bytes = await file.arrayBuffer()
  if (/\.xer$/i.test(file.name)) return parseXer(new TextDecoder('windows-1252').decode(bytes))
  const text = new TextDecoder('utf-8').decode(bytes)
  if (text.startsWith('ERMHDR')) return parseXer(text)
  try {
    return parseTimeline(JSON.parse(text) as TimelineFile)
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error('This isn’t a programme file the app can read. Save it from DBP Timeline as a P6 .xer (or its own .json) file.')
    throw e
  }
}

// ---------- saving and loading ----------
export async function saveProgramme(jobId: string, p: ParsedProgramme, fileName: string) {
  const r = await supabase
    .from('programmes')
    .insert({ job_id: jobId, file_name: fileName, project_name: p.project_name, start_date: p.start_date, finish_date: p.finish_date })
    .select('id')
    .single()
  if (r.error) throw new Error(r.error.message)
  const rows = p.tasks.map((t, i) => ({ ...t, programme_id: r.data.id, sort: i }))
  for (let i = 0; i < rows.length; i += 500) {
    const w = await supabase.from('programme_tasks').insert(rows.slice(i, i + 500))
    if (w.error) throw new Error(w.error.message)
  }
  // only the latest is used: earlier imports go (links are by activity ID, so they're kept)
  const old = await supabase.from('programmes').delete().eq('job_id', jobId).neq('id', r.data.id)
  if (old.error) throw new Error(old.error.message)
}

export function loadProgramme(jobId: string) {
  return cached(`programme:${jobId}`, async () => {
    const progs = await must<SavedProgramme[]>(supabase.from('programmes').select('*').eq('job_id', jobId).order('imported_at', { ascending: false }).limit(1))
    const programme = progs[0] ?? null
    const tasks: ProgrammeTask[] = []
    if (programme)
      for (let from = 0; ; from += 1000) {
        const page = await must<ProgrammeTask[]>(
          supabase.from('programme_tasks').select('code, name, section, trade, start_date, finish_date, milestone').eq('programme_id', programme.id).order('sort').range(from, from + 999),
        )
        tasks.push(...page)
        if (page.length < 1000) break
      }
    return { programme, tasks }
  })
}
