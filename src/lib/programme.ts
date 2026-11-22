// The job's programme, imported from the file saved from DBP Timeline (docs/decisions.md
// "Cashflow: built"), until Timeline is merged into the app. Two formats:
// - P6 .xer (Timeline's "Primavera" export): tab-separated tables. PROJWBS gives the sections,
//   TASK the activities (ID, name, dates), ACTVCODE / TASKACTV the trade of each. Started
//   activities use their actual dates, the rest their scheduled (early) dates.
// - Timeline's own file (.json, as read from its autosave on 18 Nov): groups, trades and tasks
//   with a start and a duration in working days.
// - MS Project XML (MS Project › Save As › XML, or Timeline's MS Project export): summary tasks
//   are the sections, the rest the activities, kept by their unique ID (UID) as task IDs renumber
//   when rows are inserted. A .mpp can't be read in a browser, so the app asks for the XML.
// Activities are kept by their ID (A1010…), so links to them survive a new revision. Links between
// activities (script 025) are read from all three: P6 TASKPRED, MS Project PredecessorLink and
// Timeline's predecessors.
import { supabase } from './supabase'
import { cached, must } from './offline'
import { addWorkingDays } from './cashflowCalc'

export interface ProgrammeTask {
  id?: string // once saved
  sort?: number
  code: string
  name: string
  section: string | null
  trade: string | null
  start_date: string // YYYY-MM-DD
  finish_date: string
  milestone: boolean
  predecessors?: Link[] // the tasks it follows (script 025)
}

// a link to a task this one follows, by its activity code: finish to start, start to start or
// finish to finish, plus a lag in working days (negative to overlap)
export type LinkType = 'FS' | 'SS' | 'FF'
export interface Link {
  code: string
  type: LinkType
  lag: number
}

// a programme's trade colours and its shutdowns (e.g. Christmas), edited in the app (script 025)
export interface Trade {
  name: string
  color: string
}
export interface Shutdown {
  name: string
  start: string
  end: string
}

export interface ParsedProgramme {
  project_name: string
  start_date: string | null
  finish_date: string | null
  tasks: ProgrammeTask[]
  trades?: Trade[] // from a Timeline file
  shutdowns?: Shutdown[]
}

export interface SavedProgramme {
  id: string
  job_id: string
  file_name: string | null
  project_name: string | null
  start_date: string | null
  finish_date: string | null
  imported_at: string
  trades?: Trade[] // script 025
  shutdowns?: Shutdown[]
}

const day = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null)

// links kept only to tasks in the programme, and never to itself
function tidyLinks(tasks: ProgrammeTask[]) {
  const codes = new Set(tasks.map((t) => t.code))
  for (const t of tasks) {
    const links = (t.predecessors ?? []).filter((l) => codes.has(l.code) && l.code !== t.code)
    if (links.length) t.predecessors = links
    else delete t.predecessors
  }
  return tasks
}

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
  if (!tasksIn.length) throw new Error('This .xer file has no activities (no TASK table). Save the programme from Timeline again and try once more.')
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
  // links: TASKPRED (P6 keeps lags in hours; an 8-hour day). Start-to-finish links are left out.
  const codeOf = new Map(tasksIn.map((t) => [t.task_id, t.task_code || t.task_id]))
  const byCode = new Map(tasks.map((t) => [t.code, t]))
  for (const p of tables.get('TASKPRED') ?? []) {
    const type = ({ PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF' } as Record<string, LinkType>)[p.pred_type]
    const t = byCode.get(codeOf.get(p.task_id) ?? '')
    const pred = codeOf.get(p.pred_task_id)
    if (type && t && pred) t.predecessors = [...(t.predecessors ?? []), { code: pred, type, lag: Math.round(Number(p.lag_hr_cnt || 0) / 8) }]
  }
  return { project_name: project?.proj_short_name || 'Programme', ...span(tasks), tasks: tidyLinks(tasks) }
}

// ---------- Timeline's own file ----------
// Timeline's Save puts the programme at the top of the file; its autosave wraps it in "data"
interface TimelineData {
  projectName?: string
  groups?: { id: string | number; name: string }[]
  trades?: { name: string; color: string }[]
  shutdowns?: { name?: string; start: string; end: string }[]
  tasks?: {
    id: string | number
    name: string
    groupId?: string | number
    trade?: string
    start: string
    duration?: number
    milestone?: boolean
    predecessors?: { id: string | number; type?: string; lag?: number }[]
  }[]
}
type TimelineFile = TimelineData & { data?: TimelineData }
function parseTimeline(json: TimelineFile): ParsedProgramme {
  const d = json.data ?? json
  if (!d?.tasks?.length) throw new Error('This file has no programme tasks. Save the programme from Timeline again and try once more.')
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
        predecessors: (t.predecessors ?? []).map((p) => ({
          code: String(p.id),
          type: (['SS', 'FF'].includes(p.type ?? '') ? p.type : 'FS') as LinkType,
          lag: Math.round(Number(p.lag ?? 0)),
        })),
      }
    })
  return {
    project_name: d.projectName || 'Programme',
    ...span(tasks),
    tasks: tidyLinks(tasks),
    trades: (d.trades ?? []).filter((t) => t.name && /^#[0-9a-f]{6}$/i.test(t.color)).map((t) => ({ name: t.name, color: t.color })),
    shutdowns: shut.filter((x) => day(x.start) && day(x.end)).map((x) => ({ name: x.name || 'Shutdown', start: x.start, end: x.end })),
  }
}

// ---------- MS Project XML ----------
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescape = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()],
  )
const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)
  return m ? unescape(m[1].trim()) : null
}
function parseMsProjectXml(text: string): ParsedProgramme {
  const tasksXml = /<Tasks>([\s\S]*?)<\/Tasks>/.exec(text)?.[1] ?? ''
  const rows = [...tasksXml.matchAll(/<Task>([\s\S]*?)<\/Task>/g)].map((m) => m[1])
  if (!rows.length) throw new Error('This XML file has no MS Project tasks. In MS Project use File › Save As › XML Format, then import that file.')
  const tasks: ProgrammeTask[] = []
  const heads: string[] = [] // the summary task at each outline level
  for (const r of rows) {
    const level = Number(tag(r, 'OutlineLevel') ?? 1)
    const name = tag(r, 'Name') ?? ''
    if (level === 0 || tag(r, 'IsNull') === '1') continue // the project summary row / blank rows
    if (tag(r, 'Summary') === '1') {
      heads[level - 1] = name
      heads.length = level
      continue
    }
    const start = day(tag(r, 'ActualStart') ?? tag(r, 'Start') ?? undefined)
    const finish = day(tag(r, 'ActualFinish') ?? tag(r, 'Finish') ?? undefined) ?? start
    if (!start || !finish) continue
    tasks.push({
      code: tag(r, 'UID') ?? tag(r, 'ID') ?? String(tasks.length + 1),
      name,
      section:
        heads
          .slice(0, level - 1)
          .filter(Boolean)
          .join(' / ') || null,
      trade: null,
      start_date: start,
      finish_date: finish < start ? start : finish,
      milestone: tag(r, 'Milestone') === '1',
      // links: Type 0 FF, 1 FS, 3 SS (2, start to finish, left out); lag in tenths of a minute, 8-hour days
      predecessors: [...r.matchAll(/<PredecessorLink>([\s\S]*?)<\/PredecessorLink>/g)].flatMap((m) => {
        const type = ({ '0': 'FF', '1': 'FS', '3': 'SS' } as Record<string, LinkType>)[tag(m[1], 'Type') ?? '1']
        const code = tag(m[1], 'PredecessorUID')
        return type && code ? [{ code, type, lag: Math.round(Number(tag(m[1], 'LinkLag') ?? 0) / 4800) }] : []
      }),
    })
  }
  if (!tasks.length) throw new Error('The tasks in this MS Project file have no dates. Save it again from MS Project (File › Save As › XML Format) with the schedule calculated.')
  // MS Project's <Name> is the file name; the title is the project's own name
  const head = text.replace(/<Tasks>[\s\S]*$/, '')
  return { project_name: tag(head, 'Title') || tag(head, 'Name')?.replace(/\.(xml|mpp)$/i, '') || 'Programme', ...span(tasks), tasks: tidyLinks(tasks) }
}

export async function parseProgramme(file: File): Promise<ParsedProgramme> {
  if (/\.mpp$/i.test(file.name))
    throw new Error('An MS Project .mpp file can’t be read in the browser. In MS Project use File › Save As, choose “XML Format (*.xml)”, then import that file here.')
  const bytes = await file.arrayBuffer()
  if (/\.xer$/i.test(file.name)) return parseXer(new TextDecoder('windows-1252').decode(bytes))
  const text = new TextDecoder('utf-8').decode(bytes)
  if (text.startsWith('ERMHDR')) return parseXer(text)
  if (/^\s*(<\?xml|<Project)/.test(text)) return parseMsProjectXml(text)
  try {
    return parseTimeline(JSON.parse(text) as TimelineFile)
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error('This isn’t a programme file the app can read. Use a P6 .xer, an MS Project XML (.xml) or a DBP Timeline .json file.')
    throw e
  }
}

// ---------- saving and loading ----------
export async function saveProgramme(jobId: string, p: ParsedProgramme, fileName: string) {
  const r = await supabase
    .from('programmes')
    .insert({
      job_id: jobId,
      file_name: fileName,
      project_name: p.project_name,
      start_date: p.start_date,
      finish_date: p.finish_date,
      // a Timeline file's trade colours and shutdowns come with it (script 025)
      ...(p.trades?.length ? { trades: p.trades } : {}),
      ...(p.shutdowns?.length ? { shutdowns: p.shutdowns } : {}),
    })
    .select('id')
    .single()
  if (r.error) throw new Error(r.error.message)
  // links only sent when there are some, so a programme without them imports before script 025
  const rows = p.tasks.map(({ predecessors, ...t }, i) => ({ ...t, ...(predecessors?.length ? { predecessors } : {}), programme_id: r.data.id, sort: i }))
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
    const cols = 'id, sort, code, name, section, trade, start_date, finish_date, milestone'
    const page = (from: number, links: boolean) =>
      must<ProgrammeTask[]>(
        supabase
          .from('programme_tasks')
          .select((links ? `${cols}, predecessors` : cols) as '*') // the column list is worked out, so not type-checked
          .eq('programme_id', programme!.id)
          .order('sort')
          .range(from, from + 999),
      )
    let links = true // until script 025 is run there are no links to read
    if (programme)
      for (let from = 0; ; from += 1000) {
        const rows = await page(from, links).catch((e: Error) => {
          if (!links || !/predecessors/.test(e.message)) throw e
          links = false
          return page(from, false)
        })
        tasks.push(...rows)
        if (rows.length < 1000) break
      }
    return { programme, tasks }
  })
}

// ---------- editing in the app (Programme tab, 21 Nov) ----------
const ok = async (p: PromiseLike<{ error: { message: string } | null }>) => {
  const r = await p
  if (r.error) throw new Error(r.error.message)
}
// a programme started from nothing: the job's start on site and PC as milestones
export async function startBlankProgramme(jobId: string, name: string, start: string, pc: string) {
  await saveProgramme(
    jobId,
    {
      project_name: name,
      start_date: start,
      finish_date: pc,
      tasks: [
        { code: 'A1010', name: 'Start on site', section: 'Milestones', trade: null, start_date: start, finish_date: start, milestone: true },
        { code: 'A1020', name: 'Practical Completion', section: 'Milestones', trade: null, start_date: pc, finish_date: pc, milestone: true },
      ],
    },
    'Started in the app',
  )
}
export async function updateTask(id: string, fields: Partial<Omit<ProgrammeTask, 'id'>>) {
  await ok(supabase.from('programme_tasks').update(fields).eq('id', id))
}
export async function addTask(programmeId: string, task: ProgrammeTask) {
  const { id: _id, ...row } = task
  await ok(supabase.from('programme_tasks').insert({ ...row, programme_id: programmeId }))
}
export async function deleteTask(id: string) {
  await ok(supabase.from('programme_tasks').delete().eq('id', id))
}
export async function renameSection(programmeId: string, from: string | null, to: string) {
  const q = supabase.from('programme_tasks').update({ section: to }).eq('programme_id', programmeId)
  await ok(from == null ? q.is('section', null) : q.eq('section', from))
}
// its name, overall dates, trade colours and shutdowns
export async function updateProgramme(id: string, fields: Partial<Pick<SavedProgramme, 'project_name' | 'start_date' | 'finish_date' | 'trades' | 'shutdowns'>>) {
  await ok(supabase.from('programmes').update(fields).eq('id', id))
}
