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
import { fromTimeline, type TLState } from './timelineFormat'

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
  progress?: number // % (script 025)
  // Timeline's other task fields (script 026)
  contractor?: string | null
  rag?: 'green' | 'amber' | 'red'
  prereq_confirmed?: boolean
  prereq_note?: string | null
  skeleton?: boolean // a skeleton crew works through shutdowns
  baseline_start?: string | null
  baseline_duration?: number | null // working days
  critical?: boolean // marked as on the critical path (script 028), as well as those the links make critical
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
  sections?: Section[]
  project_start?: string | null
  week_start?: string | null
  client_logo?: string | null
}

// a section in the programme's order; kept on the programme so an empty one stays (script 026)
export interface Section {
  name: string
  collapsed?: boolean
}

export interface SavedProgramme {
  id: string
  job_id: string | null // a job's, or an Estimating enquiry's (script 026)
  enquiry_id?: string | null
  file_name: string | null
  project_name: string | null
  start_date: string | null
  finish_date: string | null
  imported_at: string
  trades?: Trade[] // script 025
  shutdowns?: Shutdown[]
  // Timeline's settings (script 026)
  project_start?: string | null // "Programme starts"
  week_start?: string | null // "Start on site (Wk 1)"; blank = worked out
  client_logo?: string | null // data URL
  contract_rev?: number | null // the original (contract) programme: a committed revision's number (script 027)
  sections?: Section[]
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
// Timeline's Save puts the programme at the top of the file; its autosave wraps it in "data".
// Every field is kept (timelineFormat.fromTimeline).
type TimelineFile = Partial<TLState> & { data?: Partial<TLState> }
function parseTimeline(json: TimelineFile): ParsedProgramme {
  const d = json.data ?? json
  if (!d?.tasks?.length) throw new Error('This file has no programme tasks. Save the programme from Timeline again and try once more.')
  return fromTimeline(d)
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
// a programme belongs to a job, or to an Estimating enquiry until it's won (script 026)
export type Owner = { jobId: string } | { enquiryId: string }
const ownerOf = (o: string | Owner): Owner => (typeof o === 'string' ? { jobId: o } : o)
const ownerKey = (o: Owner) => ('jobId' in o ? `job:${o.jobId}` : `enquiry:${o.enquiryId}`)
const ownerRow = (o: Owner) => ('jobId' in o ? { job_id: o.jobId } : { enquiry_id: o.enquiryId })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const forOwner = (q: any, o: Owner) => ('jobId' in o ? q.eq('job_id', o.jobId) : q.eq('enquiry_id', o.enquiryId).is('job_id', null))

const ok = async (p: PromiseLike<{ error: { message: string } | null }>) => {
  const r = await p
  if (r.error) throw new Error(r.error.message)
}
const newId = () => crypto.randomUUID()

// the owner's programme (the latest, if there were ever two)
async function findProgramme(o: Owner) {
  const progs = await must<SavedProgramme[]>(forOwner(supabase.from('programmes').select('*'), o).order('imported_at', { ascending: false }).limit(1))
  return progs[0] ?? null
}
async function loadTasks(programmeId: string) {
  const tasks: ProgrammeTask[] = []
  for (let from = 0; ; from += 1000) {
    // every column there is, so it works whichever scripts have been run
    const rows = await must<ProgrammeTask[]>(
      supabase
        .from('programme_tasks')
        .select('*')
        .eq('programme_id', programmeId)
        .order('sort')
        .range(from, from + 999),
    )
    tasks.push(...rows)
    if (rows.length < 1000) break
  }
  return tasks
}

export function loadProgramme(owner: string | Owner) {
  const o = ownerOf(owner)
  return cached(`programme:${ownerKey(o)}`, async () => {
    const programme = await findProgramme(o)
    return { programme, tasks: programme ? await loadTasks(programme.id) : [] }
  })
}

// the columns a task row has in the database (only those the scripts run so far have added)
const TASK_COLUMNS = ['code', 'name', 'section', 'trade', 'start_date', 'finish_date', 'milestone', 'sort'] as const
const COLUMNS_025 = ['predecessors', 'progress'] as const
const COLUMNS_026 = ['contractor', 'rag', 'prereq_confirmed', 'prereq_note', 'skeleton', 'baseline_start', 'baseline_duration'] as const
export const has026 = (p: SavedProgramme | null) => !!p && 'sections' in p
export const has027 = (p: SavedProgramme | null) => !!p && 'contract_rev' in p
// script 028 (a task marked critical): until it's run, saving leaves the column out (found on the first save)
let has028 = true
async function withCritical(write: () => Promise<void>) {
  try {
    await write()
  } catch (e) {
    if (!has028 || !/critical/.test((e as Error).message)) throw e
    has028 = false
    await write()
  }
}
function taskRow(t: ProgrammeTask, programmeId: string, with026: boolean) {
  const row: Record<string, unknown> = { programme_id: programmeId }
  for (const k of TASK_COLUMNS) row[k] = t[k] ?? (k === 'sort' ? 0 : null)
  row.predecessors = t.predecessors ?? []
  row.progress = t.progress ?? 0
  if (with026) {
    row.contractor = t.contractor ?? null
    row.rag = t.rag ?? 'green'
    row.prereq_confirmed = !!t.prereq_confirmed
    row.prereq_note = t.prereq_note ?? null
    row.skeleton = !!t.skeleton
    row.baseline_start = t.baseline_start ?? null
    row.baseline_duration = t.baseline_duration ?? null
    if (has028) row.critical = !!t.critical
  }
  return row
}
const SETTINGS = ['project_name', 'start_date', 'finish_date', 'trades', 'shutdowns'] as const
const SETTINGS_026 = ['project_start', 'week_start', 'client_logo', 'sections'] as const

// a programme imported, made from the SoW, started blank or copied: an owner with a programme
// already keeps it (and its issued revisions), with its tasks and settings replaced
export async function saveProgramme(owner: string | Owner, p: ParsedProgramme, fileName: string) {
  const o = ownerOf(owner)
  const existing = await findProgramme(o)
  const with026 = existing ? has026(existing) : true
  const fields: Record<string, unknown> = {
    file_name: fileName,
    project_name: p.project_name,
    start_date: p.start_date,
    finish_date: p.finish_date,
    imported_at: new Date().toISOString(),
    trades: p.trades ?? [],
    shutdowns: p.shutdowns ?? [],
  }
  if (with026) Object.assign(fields, { sections: p.sections ?? [], project_start: p.project_start ?? null, week_start: p.week_start ?? null, client_logo: p.client_logo ?? null })
  let id: string
  if (existing) {
    id = existing.id
    await ok(supabase.from('programmes').update(fields).eq('id', id))
    await ok(supabase.from('programme_tasks').delete().eq('programme_id', id))
  } else {
    const r = await supabase
      .from('programmes')
      .insert({ ...ownerRow(o), ...fields })
      .select('id')
      .single()
    if (r.error) {
      // before script 026 a programme can't have the newer settings, or belong to an enquiry
      if ('jobId' in o && /column|schema cache/i.test(r.error.message) && with026) {
        for (const k of SETTINGS_026) delete fields[k]
        const again = await supabase
          .from('programmes')
          .insert({ ...ownerRow(o), ...fields })
          .select('id')
          .single()
        if (again.error) throw new Error(again.error.message)
        id = again.data.id
        return insertTasks(id, p.tasks, false)
      }
      throw new Error(/enquiry_id/.test(r.error.message) ? 'Programmes for estimates need script 026 run in Supabase first (supabase/README.md).' : r.error.message)
    }
    id = r.data.id
  }
  await insertTasks(id, p.tasks, with026)
}
async function insertTasks(programmeId: string, tasks: ProgrammeTask[], with026: boolean) {
  await withCritical(async () => {
    const rows = tasks.map((t, i) => taskRow({ ...t, sort: i }, programmeId, with026))
    for (let i = 0; i < rows.length; i += 500) await ok(supabase.from('programme_tasks').insert(rows.slice(i, i + 500)))
  })
}

// ---------- saving edits (the Programme tab saves a moment after each change) ----------
// what changed between the last save and now is written: new tasks added, changed ones updated,
// removed ones deleted, and the programme's own settings
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
export async function syncProgramme(before: { programme: SavedProgramme; tasks: ProgrammeTask[] }, after: { programme: SavedProgramme; tasks: ProgrammeTask[] }) {
  const id = after.programme.id
  const with026 = has026(before.programme)
  const keys = [...TASK_COLUMNS, ...COLUMNS_025, ...(with026 ? COLUMNS_026 : []), ...(with026 ? (['critical'] as const) : [])]
  const old = new Map(before.tasks.map((t) => [t.id, t]))
  const now = new Set(after.tasks.map((t) => t.id))
  const gone = before.tasks.filter((t) => t.id && !now.has(t.id)).map((t) => t.id!)
  const added = after.tasks.filter((t) => t.id && !old.has(t.id))
  const changed = after.tasks.filter((t) => {
    const b = t.id && old.get(t.id)
    return b && keys.some((k) => !same(b[k], t[k]))
  })
  if (gone.length)
    for (let i = 0; i < gone.length; i += 200)
      await ok(
        supabase
          .from('programme_tasks')
          .delete()
          .in('id', gone.slice(i, i + 200)),
      )
  if (added.length)
    await withCritical(async () => {
      for (let i = 0; i < added.length; i += 500) await ok(supabase.from('programme_tasks').insert(added.slice(i, i + 500).map((t) => ({ id: t.id, ...taskRow(t, id, with026) }))))
    })
  if (changed.length)
    await withCritical(async () => {
      for (let i = 0; i < changed.length; i += 500)
        await ok(supabase.from('programme_tasks').upsert(changed.slice(i, i + 500).map((t) => ({ id: t.id, ...taskRow(t, id, with026) }))))
    })
  const settings: Record<string, unknown> = {}
  for (const k of [...SETTINGS, ...(with026 ? SETTINGS_026 : []), ...(has027(before.programme) ? (['contract_rev'] as const) : [])])
    if (!same(before.programme[k], after.programme[k])) settings[k] = after.programme[k] ?? (k === 'trades' || k === 'shutdowns' || k === 'sections' ? [] : null)
  if (Object.keys(settings).length) await ok(supabase.from('programmes').update(settings).eq('id', id))
}
export { newId as newTaskId }

// a programme started from nothing: start on site and PC as milestones
export async function startBlankProgramme(owner: string | Owner, name: string, start: string, pc: string) {
  await saveProgramme(
    owner,
    {
      project_name: name,
      start_date: start,
      finish_date: pc,
      project_start: start,
      week_start: start,
      tasks: [
        { code: 'A1010', name: 'Start on site', section: 'Milestones', trade: null, start_date: start, finish_date: start, milestone: true },
        { code: 'A1020', name: 'Practical Completion', section: 'Milestones', trade: null, start_date: pc, finish_date: pc, milestone: true },
      ],
      sections: [{ name: 'Milestones' }],
    },
    'Started in the app',
  )
}

// ---------- previous programmes (to start a new one from) ----------
export interface ProgrammeListItem {
  id: string
  project_name: string | null
  start_date: string | null
  finish_date: string | null
  job_id: string | null
  enquiry_id?: string | null
  owner: string // e.g. "2611 MICR Micro by the Fix" or "E012 Corsham Street (estimate)"
}
export async function listProgrammes(): Promise<ProgrammeListItem[]> {
  type Row = Omit<ProgrammeListItem, 'owner'> & {
    jobs?: { job_no: string; code: string; name: string } | null
    enquiries?: { enquiry_no: number; name: string } | null
  }
  const base = 'id, project_name, start_date, finish_date, job_id, jobs(job_no, code, name)'
  const rows = await must<Row[]>(
    supabase
      .from('programmes')
      .select(`${base}, enquiry_id, enquiries(enquiry_no, name)` as '*')
      .order('imported_at', { ascending: false }),
  ).catch(() =>
    must<Row[]>(
      supabase
        .from('programmes')
        .select(base as '*')
        .order('imported_at', { ascending: false }),
    ),
  )
  return rows.map((r) => ({
    id: r.id,
    project_name: r.project_name,
    start_date: r.start_date,
    finish_date: r.finish_date,
    job_id: r.job_id,
    enquiry_id: r.enquiry_id ?? null,
    owner: r.jobs
      ? `${r.jobs.job_no} ${r.jobs.code} ${r.jobs.name}`
      : r.enquiries
        ? `E${String(r.enquiries.enquiry_no).padStart(3, '0')} ${r.enquiries.name} (estimate)`
        : r.project_name || 'Programme',
  }))
}
// another programme's tasks and settings, to copy
export async function loadProgrammeById(id: string) {
  const progs = await must<SavedProgramme[]>(supabase.from('programmes').select('*').eq('id', id).limit(1))
  if (!progs[0]) throw new Error('That programme has been deleted.')
  return { programme: progs[0], tasks: await loadTasks(id) }
}

// ---------- issued revisions (Initial issue, Rev A, Rev B…: script 026) ----------
export interface ProgrammeRevision {
  id: string
  programme_id: string
  rev_no: number
  note: string | null
  created_by: string | null
  created_at: string
  task_count: number
  data?: unknown // the programme as issued, in Timeline's layout
}
export function listRevisions(programmeId: string) {
  return must<ProgrammeRevision[]>(
    supabase
      .from('programme_revisions')
      .select('id, programme_id, rev_no, note, created_by, created_at, task_count')
      .eq('programme_id', programmeId)
      .order('rev_no', { ascending: false }),
  )
}
export async function loadRevisionData(programmeId: string, revNos: number[]) {
  return must<{ rev_no: number; data: unknown }[]>(supabase.from('programme_revisions').select('rev_no, data').eq('programme_id', programmeId).in('rev_no', revNos))
}
export async function issueRevision(programmeId: string, note: string, data: unknown, taskCount: number) {
  const last = await must<{ rev_no: number }[]>(
    supabase.from('programme_revisions').select('rev_no').eq('programme_id', programmeId).order('rev_no', { ascending: false }).limit(1),
  )
  const rev_no = (last[0]?.rev_no ?? 0) + 1
  await ok(supabase.from('programme_revisions').insert({ programme_id: programmeId, rev_no, note: note || null, data, task_count: taskCount }))
  return rev_no
}

// a won enquiry's programme becomes the job's (unless the job already has one)
export async function moveEnquiryProgramme(enquiryId: string, jobId: string) {
  const has = await must<{ id: string }[]>(supabase.from('programmes').select('id').eq('job_id', jobId).limit(1))
  if (has.length) return
  const r = await supabase.from('programmes').update({ job_id: jobId }).eq('enquiry_id', enquiryId).is('job_id', null)
  if (r.error && !/enquiry_id/.test(r.error.message)) throw new Error(r.error.message) // before script 026 there's nothing to move
}
