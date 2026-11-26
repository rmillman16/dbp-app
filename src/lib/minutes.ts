// Meeting minutes (22 Nov, scripts 045 / 046): DBP Minutes (dbp-mint.firebaseapp.com) copied into the app. A meeting
// belongs to a job or an Estimating enquiry (tender meetings; they move to the job when it's won), whose number,
// code and name are its project name (23 Nov). It has a sub-title, date, attendees (staff logins or typed-in people) and a list of points; a point can be
// a section heading, or an action with an owner and a due date. Actions owned by a staff login go on their bell
// (the database does that, 045) and every open action shows on the job's To do and the owner's My tasks.
// The meeting is edited in memory and saved a moment after each change (as DBP Minutes did); a copy is kept on
// the device until the save goes through, so nothing typed is lost when the signal drops.
import { del, get, set } from 'idb-keyval'
import { supabase } from './supabase'
import { cached, must } from './offline'
import { ukDate } from './format'

export const FOOTNOTE_TEXT =
  "Comments or corrections on these notes? Get in touch with whoever sent them to you. If we don't hear back within 72 hours, the notes will be taken as agreed."
export const POINT_PLACEHOLDER = 'Type a point… @ mention, / link an RFI or snag, # heading, ! urgent, £ cost'
export const HEADING_PLACEHOLDER = 'Section heading…'

export interface Attendee {
  id: string
  name: string
  initials: string
  present: boolean // false = not at the meeting: apologies (below) or referenced only
  apology?: boolean // not present, and sent apologies (script 085)
  profileId: string | null // a staff login; null = typed in
  company: string | null
  email: string | null
}
// a record a point is about (script 085): shown as a link under the point
export type RefKind = 'rfi' | 'submittal' | 'snag' | 'vo'
export interface PointRef {
  kind: RefKind
  id: string
  label: string // "RFI 12"
}
export interface PointUpdate {
  id: string
  date: string
  text: string
}
export interface CarriedFrom {
  meetingId: string
  pointId?: string
  project: string
  date: string
}
export interface Point {
  id: string
  type: 'note' | 'heading'
  text: string
  isAction: boolean
  ownerId: string | null // an attendee's id
  dueDate: string | null
  done: boolean
  urgent: boolean
  costFlag: boolean // in the app only: never in exports or emails
  updates: PointUpdate[]
  carriedFrom: CarriedFrom | null
  carriedForward: boolean
  refs?: PointRef[] // RFIs, submittals, snags and variations this point is about (085)
  doneBy?: string | null // who ticked it done on the project hub (085)
}
export interface Meeting {
  id: string
  jobId: string | null
  enquiryId: string | null // a tender meeting (046); a meeting is a job's or an estimate's
  project: string
  subtitle: string
  date: string
  attendees: Attendee[]
  points: Point[]
  createdAt: number
  updatedAt: number
  no?: number | null // Meeting 12: counted per job / estimate, given by the database on first save (085)
  type?: string | null // a meeting type: see MEETING_TYPES (085)
  rev?: number // how many times it has been issued (085)
  locked?: boolean // issued: read-only until amended (085)
}
export interface MeetingSummary {
  id: string
  jobId: string | null
  enquiryId: string | null
  project: string
  subtitle: string
  date: string
  updatedAt: number
  attendees: Pick<Attendee, 'id' | 'name' | 'initials' | 'present'>[]
  no?: number | null // meeting number (085)
  type?: string | null // meeting type key, see MEETING_TYPES
  rev?: number // times issued
  locked?: boolean
}

export const uid = () => crypto.randomUUID()

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseIso(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
// "Sun 22 Nov 2026": the meeting date on the page and in exports
export function formatDateNice(iso: string | null | undefined) {
  if (!iso) return ''
  const d = parseIso(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
// "22 Nov": due chips and plain-text notes
export function formatDateShort(iso: string | null | undefined) {
  if (!iso) return ''
  const d = parseIso(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
// lists and logs: DD/MM/YYYY
export const formatDateSidebar = (iso: string | null | undefined) => ukDate(iso)

export function daysBetween(aIso: string, bIso: string) {
  return Math.round((new Date(bIso + 'T00:00:00').getTime() - new Date(aIso + 'T00:00:00').getTime()) / 86400000)
}

// whose minutes: a job's (Minutes tab) or an Estimating enquiry's (tender meetings); label = "2611 FISL · Name" / "E012 · Name"
export type MinutesOwner = { jobId: string; enquiryId: null; label: string } | { jobId: null; enquiryId: string; label: string }

export function newMeeting(owner: MinutesOwner): Meeting {
  return {
    id: uid(),
    jobId: owner.jobId,
    enquiryId: owner.enquiryId,
    project: owner.label,
    subtitle: '',
    date: todayISO(),
    attendees: [],
    points: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    no: null,
    type: null,
    rev: 0,
    locked: false,
  }
}
export function newPoint(type: 'note' | 'heading' = 'note'): Point {
  return {
    id: uid(),
    type,
    text: '',
    isAction: false,
    ownerId: null,
    dueDate: null,
    done: false,
    urgent: false,
    costFlag: false,
    updates: [],
    carriedFrom: null,
    carriedForward: false,
    refs: [],
    doneBy: null,
  }
}
export function isMeetingEmpty(m: Meeting | null) {
  if (!m) return true
  // the project is the job / estimate, so it doesn't count
  return !m.subtitle.trim() && m.attendees.length === 0 && m.points.length === 0
}
export const projectNameOf = (m: { project: string }) => (m.project || '').trim() || 'Untitled project'

// ---------- initials and @mentions ----------
export function computeInitials(name: string, existing: { initials: string }[]) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  let base = words.length === 1 ? words[0].slice(0, 2) : (words[0]?.[0] ?? '') + (words[words.length - 1]?.[0] ?? '')
  base = base.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'XX'
  const taken = new Set(existing.map((a) => a.initials))
  let candidate = base
  let n = 2
  while (taken.has(candidate)) candidate = base + n++
  return candidate
}
export const attendeeById = (m: { attendees: Attendee[] }, id: string | null) => (id ? m.attendees.find((a) => a.id === id) : undefined)
// present !== false so anyone saved without the field counts as attending
export const presentAttendees = (m: { attendees: Attendee[] }) => m.attendees.filter((a) => a.present !== false)
export const awayAttendees = (m: { attendees: Attendee[] }) => m.attendees.filter((a) => a.present === false && !a.apology) // referenced only
export const apologyAttendees = (m: { attendees: Attendee[] }) => m.attendees.filter((a) => a.present === false && !!a.apology)

// ---------- meeting types and their standing agendas (085) ----------
// Choosing a type loads its headings; the next meeting of that type starts with them again (after the carried-forward actions).
export interface MeetingType {
  key: string
  label: string
  headings: string[]
}
export const MEETING_TYPES: MeetingType[] = [
  { key: 'progress', label: 'Progress meeting', headings: ['Health and safety', 'Programme', 'Progress and works planned', 'Design information, RFIs and submittals', 'Procurement', 'Quality and snagging', 'Commercial and variations', 'Any other business', 'Date of next meeting'] },
  { key: 'design', label: 'Design team meeting', headings: ['Design progress', 'Information required and RFIs', 'Coordination', 'Statutory approvals and building control', 'Programme and deadlines', 'Any other business', 'Date of next meeting'] },
  { key: 'prestart', label: 'Pre-start meeting', headings: ['Scope and programme', 'Health and safety, RAMS and permits', 'Site set-up, access and logistics', 'Information and approvals', 'Procurement and lead times', 'Quality and sign-off', 'Any other business'] },
  { key: 'hs', label: 'H&S meeting', headings: ['Accidents, incidents and near misses', 'Inspections and audits', 'RAMS and permits', 'Site conditions and welfare', 'Training and inductions', 'Any other business'] },
  { key: 'tender', label: 'Tender / pre-contract meeting', headings: ['Scope and clarifications', 'Programme', 'Pricing and commercial', 'Next steps'] },
]
export const meetingTypeOf = (key: string | null | undefined) => MEETING_TYPES.find((t) => t.key === key) ?? null
// the type's headings as empty sections, for a meeting that has none yet
export const standingHeadings = (key: string | null | undefined): Point[] => (meetingTypeOf(key)?.headings ?? []).map((h) => ({ ...newPoint('heading'), text: h }))

// ---------- numbering (085) ----------
// Sections count 1, 2, 3 and the points under each 1.1, 1.2...; points before the first heading are section 1 and the first heading
// then becomes 2. The number is worked out from the order, so it moves if points are reordered; an issued copy keeps its numbers.
export function numberPoints(points: { id: string; type: 'note' | 'heading' }[]): Map<string, string> {
  const out = new Map<string, string>()
  let sec = points.length && points[0].type !== 'heading' ? 1 : 0
  let n = 0
  for (const p of points) {
    if (p.type === 'heading') {
      sec++
      n = 0
      out.set(p.id, String(sec))
    } else out.set(p.id, `${sec}.${++n}`)
  }
  return out
}
// "12/4.3": the reference to quote in an email or an RFI
// issue 1 is Rev A, 2 Rev B...
export const revLetter = (n: number) => String.fromCharCode(64 + Math.max(1, n))
export const itemRef =(m: { no?: number | null }, num: string | undefined) => (m.no && num ? `${m.no}/${num}` : (num ?? ''))

type Named = { name: string; initials: string }
function mentionRe(attendees: Named[]) {
  const sorted = attendees.slice().sort((a, b) => b.initials.length - a.initials.length)
  const pattern = sorted.map((a) => a.initials.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return new RegExp('@(' + pattern + ')(?![a-zA-Z0-9])', 'gi')
}
const findByInitials = (attendees: Named[], initials: string) => attendees.find((a) => a.initials.toLowerCase() === initials.toLowerCase())

// splits text into plain runs and @mention runs (in the editor a mention shows as @AK; in exports as the name, bold)
export function mentionSegments(text: string, attendees: Named[]): { text: string; mention?: Named }[] {
  if (!attendees.length) return [{ text }]
  const re = mentionRe(attendees)
  const out: { text: string; mention?: Named }[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const att = findByInitials(attendees, match[1])
    if (!att) continue
    if (match.index > last) out.push({ text: text.slice(last, match.index) })
    out.push({ text: match[0], mention: att })
    last = match.index + match[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out.length ? out : [{ text }]
}
// plain text (copy / email): "@ak" reads as "Anthony Killeen"
export function plainMentions(text: string, attendees: Named[]) {
  return mentionSegments(text, attendees)
    .map((s) => (s.mention ? s.mention.name : s.text))
    .join('')
}
// PDF / Word: the name on its own, bold
export function mentionRuns(text: string, attendees: Named[]): { text: string; bold: boolean }[] {
  return mentionSegments(text, attendees).map((s) => (s.mention ? { text: s.mention.name, bold: true } : { text: s.text, bold: false }))
}

// ---------- due dates ----------
export type DueStatus = 'done' | 'later' | 'soon' | 'overdue'
export function dueStatus(point: Pick<Point, 'done' | 'dueDate'>): DueStatus {
  if (point.done) return 'done'
  if (!point.dueDate) return 'later'
  const diff = daysBetween(todayISO(), point.dueDate)
  if (diff < 0) return 'overdue'
  if (diff <= 2) return 'soon'
  return 'later'
}
export function dueLabel(point: Pick<Point, 'done' | 'dueDate'>) {
  const status = dueStatus(point)
  const d = formatDateShort(point.dueDate)
  if (status === 'overdue') return 'Overdue · ' + d
  if (status === 'done') return 'Done'
  return 'Due ' + d
}
export const dueWord = (p: Pick<Point, 'done' | 'dueDate'>) => (dueStatus(p) === 'overdue' ? 'Overdue: ' : 'Due: ')

// ---------- task summary: action items grouped by owner ----------
export function computeTaskSummary(meeting: Meeting) {
  const byOwner = new Map<string, { owner: Attendee | null; items: Point[] }>()
  meeting.attendees.forEach((a) => byOwner.set(a.id, { owner: a, items: [] }))
  const unassigned = { owner: null as Attendee | null, items: [] as Point[] }
  meeting.points.forEach((p) => {
    if (p.type === 'heading' || !p.isAction) return
    ;(p.ownerId && byOwner.get(p.ownerId) ? byOwner.get(p.ownerId)! : unassigned).items.push(p)
  })
  const groups = meeting.attendees.map((a) => byOwner.get(a.id)!).filter((g) => g.items.length)
  if (unassigned.items.length) groups.push(unassigned)
  return groups
}

export const countOpenActions = (m: Meeting | null) => (m ? m.points.filter((p) => p.isAction && !p.done && !p.carriedForward).length : 0)

// ---------- next meeting: carries this meeting's open actions forward ----------
// Same team (fresh ids), a heading, then every open action with its update log. The source points are marked
// carried forward, so they leave My tasks and the bell (the new copies take over).
export function buildNextMeeting(source: Meeting): Meeting {
  const next = newMeeting({ jobId: source.jobId, enquiryId: source.enquiryId, label: source.project } as MinutesOwner)
  next.subtitle = source.subtitle
  next.type = source.type ?? null
  const ownerIdMap: Record<string, string> = {}
  source.attendees.forEach((a) => {
    // someone who sent apologies is expected back; someone only referenced stays referenced
    const copy: Attendee = { ...a, id: uid(), present: a.apology ? true : a.present !== false, apology: false }
    next.attendees.push(copy)
    ownerIdMap[a.id] = copy.id
  })
  const ensureAttendeeByName = (name: string) => {
    const existing = next.attendees.find((a) => a.name.toLowerCase() === name.toLowerCase())
    if (existing) return existing.id
    const att: Attendee = { id: uid(), name, initials: computeInitials(name, next.attendees), present: true, profileId: null, company: null, email: null }
    next.attendees.push(att)
    return att.id
  }
  const open = source.points.filter((p) => p.isAction && !p.done && !p.carriedForward)
  if (open.length) {
    next.points.push({ ...newPoint('heading'), text: 'Action items from last meeting' })
    open.forEach((p) => {
      const newOwnerId = p.ownerId ? ownerIdMap[p.ownerId] || ensureAttendeeByName(attendeeById(source, p.ownerId)?.name || '') : null
      next.points.push({
        ...newPoint('note'),
        text: p.text,
        isAction: true,
        ownerId: newOwnerId || null,
        dueDate: p.dueDate || null,
        urgent: p.urgent || false,
        updates: p.updates.slice(),
        refs: (p.refs ?? []).slice(),
        carriedFrom: { meetingId: source.id, pointId: p.id, project: source.project, date: source.date },
      })
      p.carriedForward = true
    })
  }
  // the type's standing agenda, after the carried-forward actions
  next.points.push(...standingHeadings(next.type))
  return next
}

// ---------- plain text (copy to clipboard, email draft) ----------
export function buildPlainTextNotes(m: Meeting) {
  const lines: string[] = []
  lines.push(m.project || 'Untitled project')
  if (m.subtitle) lines.push(m.subtitle)
  lines.push(formatDateNice(m.date) + (m.no ? ` · Meeting ${m.no}` : '') + (m.rev ? ` · Rev ${revLetter(m.rev)}` : ''))
  const presentNames = presentAttendees(m).map(attendeeLabel).join(', ')
  const apologyNames = apologyAttendees(m).map(attendeeLabel).join(', ')
  const awayNames = awayAttendees(m).map(attendeeLabel).join(', ')
  if (presentNames) lines.push('Attendees: ' + presentNames)
  if (apologyNames) lines.push('Apologies: ' + apologyNames)
  if (awayNames) lines.push('Also referenced (not in attendance): ' + awayNames)
  lines.push('')
  const nums = numberPoints(m.points)
  m.points.forEach((p) => {
    if (p.type === 'heading') return void lines.push((nums.get(p.id) ?? '') + '. ' + (p.text || '').toUpperCase())
    const owner = attendeeById(m, p.ownerId)
    const meta: string[] = []
    if (p.urgent) meta.push('URGENT')
    if (owner) meta.push('Owner: ' + owner.name)
    if (p.dueDate) meta.push(dueWord(p) + formatDateShort(p.dueDate))
    lines.push((nums.get(p.id) ?? '-') + '  ' + plainMentions(p.text || '', m.attendees) + (meta.length ? '  (' + meta.join(' · ') + ')' : ''))
    p.updates.forEach((u) => lines.push('    ' + formatDateShort(u.date) + ': ' + u.text))
  })
  const summary = computeTaskSummary(m)
  if (summary.length) {
    lines.push('')
    lines.push('TASK SUMMARY')
    summary.forEach((g) => {
      lines.push((g.owner ? g.owner.name : 'Unassigned') + ':')
      g.items.forEach((p) => {
        const due = p.dueDate ? ' (Due ' + formatDateShort(p.dueDate) + ')' : ''
        lines.push('  ' + (p.done ? '[done] ' : '[ ] ') + plainMentions(p.text || '(no description)', m.attendees) + due)
      })
    })
  }
  lines.push('')
  lines.push(FOOTNOTE_TEXT)
  return lines.join('\n')
}
// an attendee in the attendee lists: "Name (Company)" when a company was typed
export const attendeeLabel = (a: Attendee) => (a.company ? `${a.name} (${a.company})` : a.name)

export function slug(str: string) {
  return (
    (str || 'meeting')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'meeting'
  )
}

// =====================================================================
// Database (045)
// =====================================================================
interface MeetingRow {
  id: string
  job_id: string | null
  enquiry_id?: string | null // 046
  project: string
  subtitle: string
  meeting_date: string
  created_at: string
  updated_at: string
  meeting_no?: number | null // 085
  meeting_type?: string | null
  issued_rev?: number
  locked?: boolean
}
interface AttendeeRow {
  id: string
  meeting_id: string
  profile_id: string | null
  name: string
  initials: string
  company: string | null
  email: string | null
  present: boolean
  apology?: boolean // 085
  sort: number
}
interface PointRow {
  id: string
  meeting_id: string
  sort: number
  type: 'note' | 'heading'
  text: string
  is_action: boolean
  owner_attendee_id: string | null
  due_date: string | null
  done: boolean
  urgent: boolean
  cost_flag: boolean
  updates: PointUpdate[] | null
  carried_from: CarriedFrom | null
  carried_forward: boolean
  refs?: PointRef[] | null // 085
  done_by?: string | null
}

export const needs045 = (m: string) =>
  /enquiry_id|enquiry_no/i.test(m) && /does not exist|schema cache|could not find|column/i.test(m)
    ? 'Minutes need script 046 run in Supabase first (supabase/README.md).'
    : /(meetings|meeting_attendees|meeting_points)/i.test(m) && /relation|table/i.test(m) && /does not exist|schema cache|could not find/i.test(m)
      ? 'Minutes need script 045 run in Supabase first (supabase/README.md).'
      : /meeting|minutes/i.test(m) && /does not exist|schema cache|could not find/i.test(m)
        ? `Minutes hit a database problem (a script may be missing or half-run). Database said: ${m}`
        : m

const toAttendee = (r: AttendeeRow): Attendee => ({
  id: r.id,
  name: r.name,
  initials: r.initials,
  present: r.present !== false,
  apology: !!r.apology,
  profileId: r.profile_id,
  company: r.company,
  email: r.email,
})
const toPoint = (r: PointRow): Point => ({
  id: r.id,
  type: r.type,
  text: r.text ?? '',
  isAction: r.is_action,
  ownerId: r.owner_attendee_id,
  dueDate: r.due_date,
  done: r.done,
  urgent: r.urgent,
  costFlag: r.cost_flag,
  updates: r.updates ?? [],
  carriedFrom: r.carried_from,
  carriedForward: r.carried_forward,
  refs: r.refs ?? [],
  doneBy: r.done_by ?? null,
})

// every meeting of a job or an estimate, with attendees for the avatars and search
export async function loadMeetingList(owner: MinutesOwner): Promise<MeetingSummary[]> {
  return cached(`minutes:list:${owner.jobId ?? 'e-' + owner.enquiryId}`, async () => {
    const mq = supabase.from('meetings').select('*')
    const ms = await must<Omit<MeetingRow, 'created_at'>[]>(owner.jobId ? mq.eq('job_id', owner.jobId) : mq.eq('enquiry_id', owner.enquiryId)).catch((e: Error) => {
      throw new Error(needs045(e.message))
    })
    sees085(ms[0])
    const as = ms.length
      ? await must<Pick<AttendeeRow, 'id' | 'meeting_id' | 'name' | 'initials' | 'present' | 'sort'>[]>(
          supabase
            .from('meeting_attendees')
            .select('id,meeting_id,name,initials,present,sort')
            .in(
              'meeting_id',
              ms.map((m) => m.id),
            )
            .order('sort'),
        )
      : []
    const byMeeting = new Map<string, MeetingSummary['attendees']>()
    as.forEach((a) => {
      const list = byMeeting.get(a.meeting_id) ?? []
      list.push({ id: a.id, name: a.name, initials: a.initials, present: a.present })
      byMeeting.set(a.meeting_id, list)
    })
    return ms.map((m) => ({
      id: m.id,
      jobId: m.job_id,
      enquiryId: m.enquiry_id ?? null,
      project: m.project,
      subtitle: m.subtitle,
      date: m.meeting_date,
      updatedAt: new Date(m.updated_at).getTime(),
      attendees: byMeeting.get(m.id) ?? [],
      no: m.meeting_no ?? null,
      type: m.meeting_type ?? null,
      rev: m.issued_rev ?? 0,
      locked: !!m.locked,
    }))
  })
}

export async function loadMeeting(id: string): Promise<Meeting | null> {
  const remote = await cached(`minutes:meeting:${id}`, async () => {
    const [m, as, ps] = await Promise.all([
      must<MeetingRow | null>(supabase.from('meetings').select('*').eq('id', id).maybeSingle()),
      must<AttendeeRow[]>(supabase.from('meeting_attendees').select('*').eq('meeting_id', id).order('sort')),
      must<PointRow[]>(supabase.from('meeting_points').select('*').eq('meeting_id', id).order('sort')),
    ]).catch((e: Error) => {
      throw new Error(needs045(e.message))
    })
    if (!m) return null
    sees085(m)
    return {
      id: m.id,
      jobId: m.job_id,
      enquiryId: m.enquiry_id ?? null,
      project: m.project,
      subtitle: m.subtitle,
      date: m.meeting_date,
      attendees: as.map(toAttendee),
      points: ps.map(toPoint),
      createdAt: new Date(m.created_at).getTime(),
      updatedAt: new Date(m.updated_at).getTime(),
      no: m.meeting_no ?? null,
      type: m.meeting_type ?? null,
      rev: m.issued_rev ?? 0,
      locked: !!m.locked,
    } satisfies Meeting
  })
  return remote
}

// ---------- the device copy (until the save goes through) ----------
const draftKey = (id: string) => `minutes-draft:${id}`
export const saveDraft = (m: Meeting) => set(draftKey(m.id), m).catch(() => {})
export const getDraft = (id: string) => get<Meeting>(draftKey(id)).catch(() => undefined)
export const clearDraft = (id: string) => del(draftKey(id)).catch(() => {})

// ---------- saving: only what changed since the last save ----------
export interface SavedState {
  meeting: string
  attendees: Map<string, string>
  points: Map<string, string>
}
export const emptySaved = (): SavedState => ({ meeting: '', attendees: new Map(), points: new Map() })

// whether script 085 is in (seen on a loaded meeting): the new columns are only sent then, or when they are used, so minutes keep
// working before it is run
let has085 = false
const sees085 = (r: object | undefined | null) => {
  if (r && 'meeting_no' in r) has085 = true
}

function rows(m: Meeting) {
  const attendeeIds = new Set(m.attendees.map((a) => a.id))
  // enquiry_id only when set, so a job's minutes work before script 046
  const meeting = {
    id: m.id,
    job_id: m.jobId,
    ...(m.enquiryId ? { enquiry_id: m.enquiryId } : {}),
    project: m.project,
    subtitle: m.subtitle,
    meeting_date: m.date || todayISO(),
    ...(has085 || m.type ? { meeting_type: m.type ?? null } : {}),
  }
  const attendees = m.attendees.map((a, i) => ({
    id: a.id,
    meeting_id: m.id,
    profile_id: a.profileId,
    name: a.name,
    initials: a.initials,
    company: a.company,
    email: a.email,
    present: a.present !== false,
    ...(has085 || a.apology ? { apology: !!a.apology && a.present === false } : {}),
    sort: i,
  }))
  const points = m.points.map((p, i) => ({
    id: p.id,
    meeting_id: m.id,
    sort: i,
    type: p.type,
    text: p.text,
    is_action: p.isAction,
    // an owner who has since been removed from the attendees is no owner
    owner_attendee_id: p.ownerId && attendeeIds.has(p.ownerId) ? p.ownerId : null,
    due_date: p.dueDate,
    done: p.done,
    urgent: p.urgent,
    cost_flag: p.costFlag,
    updates: p.updates,
    carried_from: p.carriedFrom,
    carried_forward: p.carriedForward,
    ...(has085 || p.refs?.length ? { refs: p.refs ?? [] } : {}),
  }))
  return { meeting, attendees, points }
}

export function savedStateOf(m: Meeting): SavedState {
  const r = rows(m)
  return {
    meeting: JSON.stringify(r.meeting),
    attendees: new Map(r.attendees.map((a) => [a.id, JSON.stringify(a)])),
    points: new Map(r.points.map((p) => [p.id, JSON.stringify(p)])),
  }
}

// Saves one meeting; returns what's now saved, and whether an action with a staff owner changed (so the
// email nudge is worth sending).
export async function saveMeeting(m: Meeting, last: SavedState): Promise<{ saved: SavedState; actionsChanged: boolean }> {
  const r = rows(m)
  const now = savedStateOf(m)
  const changedAttendees = r.attendees.filter((a) => last.attendees.get(a.id) !== now.attendees.get(a.id))
  const changedPoints = r.points.filter((p) => last.points.get(p.id) !== now.points.get(p.id))
  const goneAttendees = [...last.attendees.keys()].filter((id) => !now.attendees.has(id))
  const gonePoints = [...last.points.keys()].filter((id) => !now.points.has(id))
  const anything = now.meeting !== last.meeting || changedAttendees.length || changedPoints.length || goneAttendees.length || gonePoints.length
  if (!anything) return { saved: last, actionsChanged: false }

  const ok = (res: { error: { message: string } | null }) => {
    if (res.error) throw new Error(needs045(res.error.message))
  }
  // the meeting row every time, so its "last changed" moves and the list stays in order
  ok(await supabase.from('meetings').upsert(r.meeting))
  if (changedAttendees.length) ok(await supabase.from('meeting_attendees').upsert(changedAttendees))
  if (changedPoints.length) ok(await supabase.from('meeting_points').upsert(changedPoints))
  if (gonePoints.length) ok(await supabase.from('meeting_points').delete().in('id', gonePoints))
  if (goneAttendees.length) ok(await supabase.from('meeting_attendees').delete().in('id', goneAttendees))

  const staffOwned = new Set(m.attendees.filter((a) => a.profileId).map((a) => a.id))
  const actionsChanged = changedPoints.some((p) => p.is_action && p.owner_attendee_id && staffOwned.has(p.owner_attendee_id)) || changedAttendees.some((a) => a.profile_id)
  return { saved: now, actionsChanged }
}

export async function deleteMeeting(id: string) {
  const { error } = await supabase.from('meetings').delete().eq('id', id)
  if (error) throw new Error(needs045(error.message))
  await clearDraft(id)
}

// tick an action done / not done from outside the meeting (To do, My tasks): the owner or anyone with Minutes
export async function completeAction(pointId: string, done = true) {
  const { error } = await supabase.rpc('complete_minutes_action', { point: pointId, is_done: done })
  if (error) throw new Error(needs045(error.message))
}

// =====================================================================
// Script 085: issuing, links to records, what changed on the hub
// =====================================================================
const needs085 = (m: string) =>
  /issue_minutes|amend_minutes|meeting_issues|meeting_no|meeting_type|issued_rev|locked|apology|refs|done_by/i.test(m) && /does not exist|schema cache|could not find|column/i.test(m)
    ? 'This needs script 085 run in Supabase first (supabase/README.md).'
    : needs045(m)

export interface IssueRecord {
  id: string
  rev: number
  issuedAt: string
  issuedBy: string
  sentTo: { name: string; email: string }[]
  note: string | null
  snapshot: Meeting
}
// issue the minutes: the database keeps exactly this copy as the revision, locks the meeting and queues the outside owners' actions
export async function issueMinutes(m: Meeting, to: { name: string; email: string }[], note?: string): Promise<number> {
  const snap = JSON.parse(JSON.stringify(m)) as Meeting
  snap.rev = (m.rev ?? 0) + 1
  snap.locked = true
  const { data, error } = await supabase.rpc('issue_minutes', { p_meeting: m.id, p_snapshot: snap, p_to: to, p_note: note?.trim() || null })
  if (error) throw new Error(needs085(error.message))
  return data as number
}
export async function amendMinutes(id: string) {
  const { error } = await supabase.rpc('amend_minutes', { p_meeting: id })
  if (error) throw new Error(needs085(error.message))
}
export async function loadIssues(meetingId: string): Promise<IssueRecord[]> {
  const { data, error } = await supabase.from('meeting_issues').select('id, rev, issued_at, issued_by_name, sent_to, note, snapshot').eq('meeting_id', meetingId).order('rev', { ascending: false })
  if (error) throw new Error(needs085(error.message))
  return (data ?? []).map((r) => ({ id: r.id, rev: r.rev, issuedAt: r.issued_at, issuedBy: r.issued_by_name ?? '', sentTo: r.sent_to ?? [], note: r.note, snapshot: r.snapshot as Meeting }))
}
// the number the database gave a new meeting, and its issue state
export async function loadMeetingMeta(id: string) {
  const { data } = await supabase.from('meetings').select('meeting_no, issued_rev, locked').eq('id', id).maybeSingle()
  return data ? { no: (data.meeting_no as number | null) ?? null, rev: (data.issued_rev as number | null) ?? 0, locked: !!data.locked } : null
}
// what the project hub changed since the page was opened: actions ticked done by outside people, with their note in the update log
export async function loadPointStates(meetingId: string) {
  const { data } = await supabase.from('meeting_points').select('id, done, is_action, updates, done_by').eq('meeting_id', meetingId)
  return (data ?? []) as { id: string; done: boolean; is_action: boolean; updates: PointUpdate[] | null; done_by: string | null }[]
}

// ---------- links to records ----------
export interface LinkRecord extends PointRef {
  title: string
  status: string
}
const KIND_WORD: Record<RefKind, string> = { rfi: 'RFI', submittal: 'Submittal', snag: 'Snag', vo: 'VO' }
export const refWord = (k: RefKind) => KIND_WORD[k]
export const refPath = (jobId: string, r: { kind: RefKind; id: string }) =>
  `/jobs/${jobId}/${r.kind === 'rfi' ? 'rfis' : r.kind === 'submittal' ? 'submittals' : r.kind === 'snag' ? 'snagging' : 'variations'}/${r.id}`
// a job's RFIs, submittals, snags and variations, for the "/" picker and for linking "RFI 12" typed in a point
export async function loadLinkRecords(jobId: string): Promise<LinkRecord[]> {
  const one = async (kind: RefKind, table: string, numCol: string): Promise<LinkRecord[]> => {
    const r = await supabase.from(table).select(`id, ${numCol}, title, status`).eq('job_id', jobId)
    if (r.error || !r.data) return []
    return (r.data as unknown as Record<string, unknown>[]).map((x) => ({ kind, id: String(x.id), label: `${KIND_WORD[kind]} ${x[numCol]}`, title: String(x.title ?? ''), status: String(x.status ?? '') }))
  }
  const all = await Promise.all([one('rfi', 'rfis', 'number'), one('submittal', 'submittals', 'number'), one('snag', 'snags', 'number'), one('vo', 'variations', 'vo_no')])
  return all.flat()
}
// "RFI 12", "Snag 4", "VO 3", "Submittal 7" in the text: the records they name (typing them is enough, no picking needed)
export function refsInText(text: string, records: LinkRecord[]): PointRef[] {
  const out: PointRef[] = []
  const re = /\b(RFI|Submittal|Sub|Snag|VO|Variation)\s*(?:no\.?\s*)?#?0*(\d+)\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const w = m[1].toLowerCase()
    const kind: RefKind = w === 'rfi' ? 'rfi' : w === 'snag' ? 'snag' : w === 'vo' || w === 'variation' ? 'vo' : 'submittal'
    const hit = records.find((r) => r.kind === kind && r.label === `${KIND_WORD[kind]} ${Number(m![2])}`)
    if (hit && !out.some((o) => o.id === hit.id)) out.push({ kind: hit.kind, id: hit.id, label: hit.label })
  }
  return out
}

// ---------- the project team, in one click ----------
export interface TeamPerson {
  name: string
  company: string | null
  email: string | null
  profileId: string | null // a staff login (the job's team)
}
// the job's own team (staff) and everyone in its project directory, for "Add the project team" (an estimate has its directory only)
export async function loadProjectPeople(owner: { jobId: string | null; enquiryId: string | null }): Promise<TeamPerson[]> {
  const out: TeamPerson[] = []
  if (owner.jobId) {
    const t = await supabase.from('job_team').select('profile_id').eq('job_id', owner.jobId)
    for (const r of (t.data ?? []) as { profile_id: string | null }[]) if (r.profile_id) out.push({ name: '', company: null, email: null, profileId: r.profile_id })
  }
  const col = owner.jobId ? 'job_id' : 'enquiry_id'
  const [dir, cos, cts] = await Promise.all([
    supabase.from('job_directory').select('company_id, contact_id').eq(col, (owner.jobId ?? owner.enquiryId) as string),
    supabase.from('companies').select('id, name, email'),
    supabase.from('contacts').select('id, name, email, company_id'),
  ])
  const co = new Map(((cos.data ?? []) as { id: string; name: string; email: string | null }[]).map((c) => [c.id, c]))
  const ct = new Map(((cts.data ?? []) as { id: string; name: string; email: string | null; company_id: string }[]).map((c) => [c.id, c]))
  for (const d of (dir.data ?? []) as { company_id: string | null; contact_id: string | null }[]) {
    const c = d.contact_id ? ct.get(d.contact_id) : undefined
    const company = co.get(d.company_id ?? c?.company_id ?? '')
    const name = c?.name ?? company?.name
    if (!name) continue
    out.push({ name, company: c && company ? company.name : null, email: (c?.email || company?.email || '').trim() || null, profileId: null })
  }
  return out
}

export const minutesBase = (m: { jobId: string | null; enquiryId: string | null }) =>
  m.jobId ? `/jobs/${m.jobId}/minutes` : m.enquiryId ? `/estimating/e/${m.enquiryId}/minutes` : '/tasks'
export const meetingPath = (m: { id: string; jobId: string | null; enquiryId: string | null }) => (m.jobId || m.enquiryId ? `${minutesBase(m)}/${m.id}` : '/tasks')

// ---------- My tasks and the job's To do ----------
export interface OpenAction {
  pointId: string
  meetingId: string
  jobId: string | null
  enquiryId: string | null
  text: string
  dueDate: string | null
  urgent: boolean
  project: string
  subtitle: string
  meetingDate: string
  jobLabel: string | null
  jobArchived: boolean
  ownerName: string | null
  attendees: Named[]
}

const rank: Record<DueStatus, number> = { overdue: 0, soon: 1, later: 2, done: 3 }
export function sortActions(list: OpenAction[]) {
  return list.slice().sort((a, b) => {
    const sa = rank[dueStatus({ done: false, dueDate: a.dueDate })]
    const sb = rank[dueStatus({ done: false, dueDate: b.dueDate })]
    if (sa !== sb) return sa - sb
    const da = a.dueDate || '9999-12-31'
    const db = b.dueDate || '9999-12-31'
    return da < db ? -1 : da > db ? 1 : 0
  })
}

// mine, across all jobs and estimates (045 / 046 my_minutes_actions: works whatever my profile type)
export async function loadMyActions(): Promise<OpenAction[]> {
  type Row = {
    point_id: string
    meeting_id: string
    job_id: string | null
    text: string
    due_date: string | null
    urgent: boolean
    project: string
    subtitle: string
    meeting_date: string
    job_no: number | null
    job_code: string | null
    job_name: string | null
    job_status: string | null
    enquiry_id?: string | null // 046
    enquiry_no?: number | null
    enquiry_name?: string | null
    attendees: Named[]
  }
  const data = await cached('minutes:mine', () => must<Row[]>(supabase.rpc('my_minutes_actions'))).catch((e: Error) => {
    throw new Error(needs045(e.message))
  })
  return sortActions(
    data.map((r) => ({
      pointId: r.point_id,
      meetingId: r.meeting_id,
      jobId: r.job_id,
      enquiryId: r.enquiry_id ?? null,
      text: r.text,
      dueDate: r.due_date,
      urgent: r.urgent,
      project: r.project,
      subtitle: r.subtitle,
      meetingDate: r.meeting_date,
      jobLabel: r.job_no != null ? `${r.job_no} ${r.job_code}` : r.enquiry_no != null ? `E${String(r.enquiry_no).padStart(3, '0')} (estimate)` : null,
      jobArchived: r.job_status === 'archived',
      ownerName: null,
      attendees: r.attendees ?? [],
    })),
  )
}

// a job's open actions, everyone's (the job's To do)
export async function loadJobActions(jobId: string): Promise<OpenAction[]> {
  return cached(`minutes:todo:${jobId}`, async () => {
    const ps = await must<PointRow[]>(
      supabase.from('meeting_points').select('*').eq('job_id', jobId).eq('type', 'note').eq('is_action', true).eq('done', false).eq('carried_forward', false),
    )
    if (!ps.length) return []
    const meetingIds = [...new Set(ps.map((p) => p.meeting_id))]
    const [ms, as] = await Promise.all([
      must<Omit<MeetingRow, 'created_at' | 'updated_at'>[]>(supabase.from('meetings').select('id,job_id,project,subtitle,meeting_date').in('id', meetingIds)),
      must<Pick<AttendeeRow, 'id' | 'meeting_id' | 'name' | 'initials'>[]>(supabase.from('meeting_attendees').select('id,meeting_id,name,initials').in('meeting_id', meetingIds)),
    ])
    const meetings = new Map(ms.map((m) => [m.id, m]))
    return sortActions(
      ps.map((p) => {
        const m = meetings.get(p.meeting_id)
        const atts = as.filter((a) => a.meeting_id === p.meeting_id)
        return {
          pointId: p.id,
          meetingId: p.meeting_id,
          jobId,
          enquiryId: null,
          text: p.text,
          dueDate: p.due_date,
          urgent: p.urgent,
          project: m?.project ?? '',
          subtitle: m?.subtitle ?? '',
          meetingDate: m?.meeting_date ?? '',
          jobLabel: null,
          jobArchived: false,
          ownerName: atts.find((a) => a.id === p.owner_attendee_id)?.name ?? null,
          attendees: atts,
        }
      }),
    )
  }).catch(() => [] as OpenAction[]) // before 045, or no access to Minutes: nothing to show
}
