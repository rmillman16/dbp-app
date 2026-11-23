// RFIs (23 Nov, script 057): the register, creating one (optionally from a template that fills in the people by role),
// replies, files, closing. Outside people don't use this screen: they answer through a private link (built after the
// app is on a public address); until then DBP records a reply on their behalf.
import { supabase } from './supabase'
import { addDaysIso, todayIso } from './format'
import { loadTeam, type TeamMember } from './om'
import { cleanHtml } from './richText'

export type RfiStatus = 'draft' | 'open' | 'answered' | 'closed' | 'void'
export const STATUS_LABELS: Record<RfiStatus, string> = { draft: 'Draft', open: 'Open', answered: 'Answered', closed: 'Closed', void: 'Void' }
export const CHASE_OPTIONS: [number, string][] = [
  [1, 'Daily'],
  [2, 'Every 2 days'],
  [7, 'Weekly'],
  [14, 'Every 2 weeks'],
  [0, 'Off (never chased)'],
]
export const chaseLabel = (d: number) => CHASE_OPTIONS.find(([n]) => n === d)?.[1] ?? `Every ${d} days`

// an RFI belongs to a job or to an Estimating enquiry (script 059)
export type OwnerRef = { kind: 'job' | 'enquiry'; id: string }
const ownerCol = (o: OwnerRef) => (o.kind === 'job' ? 'job_id' : 'enquiry_id')

export interface Rfi {
  id: string
  job_id: string | null
  enquiry_id?: string | null
  number: number
  title: string
  question: string | null
  status: RfiStatus
  trade: string | null
  manager_id: string | null
  due_date: string | null
  received_from: string | null // a project directory entry
  notify: boolean
  chase_days: number
  last_chased_at: string | null
  template_id: string | null
  created_by: string | null
  created_at: string
  answered_at: string | null
  closed_at: string | null
  issued_at?: string | null // when a draft was issued (059)
  variation_id?: string | null // the VO raised from this RFI (062)
}
export interface RfiPerson {
  id: string
  rfi_id: string
  role: 'assignee' | 'cc'
  directory_id: string | null
  profile_id: string | null
}
export interface RfiResponse {
  id: string
  rfi_id: string
  kind: 'reply' | 'follow_up' | 'note'
  body: string | null
  author_id: string | null
  author_name: string | null
  created_at: string
}
export interface RfiFile {
  id: string
  rfi_id: string
  response_id: string | null
  name: string
  path: string
  file_name: string
  created_at: string
}
export interface RfiTemplate {
  id: string
  name: string
  trade: string | null
  manager_role: string | null
  assignee_roles: string[]
  cc_roles: string[]
  title_prefix: string | null
  question: string | null
  due_days: number | null
  chase_days: number
  archived: boolean
  sort: number
  // 058: a template can belong to one job, with its people named outright
  job_id?: string | null
  enquiry_id?: string | null
  assignee_keys?: string[]
  cc_keys?: string[]
  manager_id?: string | null
}

const needs057 = (m: string) =>
  /relation|schema cache|does not exist|rfi/i.test(m) && /schema cache|does not exist|relation/i.test(m) ? 'RFIs need script 057 run in Supabase first (supabase/README.md).' : m
const fail = (e: { message: string }) => new Error(needs057(e.message))
async function ok<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const r = await p
  if (r.error) throw fail(r.error)
  return r.data as T
}

// ---------- the project directory, as people an RFI can be addressed to ----------
export interface DirPerson {
  id: string // the job_directory entry
  name: string
  company: string
  role: string
  email: string | null
}
export async function loadDirPeople(o: OwnerRef): Promise<DirPerson[]> {
  const [d, c, p] = await Promise.all([
    supabase.from('job_directory').select('id, company_id, contact_id, role, client_direct').eq(ownerCol(o), o.id),
    supabase.from('companies').select('id, name, email'),
    supabase.from('contacts').select('id, name, email'),
  ])
  const co = new Map((c.data ?? []).map((x) => [x.id as string, x as { id: string; name: string; email: string | null }]))
  const ct = new Map((p.data ?? []).map((x) => [x.id as string, x as { id: string; name: string; email: string | null }]))
  return (d.data ?? []).map((e) => {
    const person = e.contact_id ? ct.get(e.contact_id as string) : null
    const company = co.get(e.company_id as string)
    return { id: e.id as string, name: person?.name ?? company?.name ?? 'Unnamed', company: company?.name ?? '', role: e.role as string, email: person?.email || company?.email || null }
  })
}

// ---------- trades (the spec section list) ----------
export async function loadTrades(): Promise<string[]> {
  const r = await supabase.from('rfi_trades').select('name').order('sort').order('name')
  if (r.error) return ['Architectural', 'Structural', 'Mechanical', 'Electrical', 'Joinery', 'General']
  return (r.data ?? []).map((x) => x.name as string)
}
export async function addTrade(name: string) {
  const r = await supabase.from('rfi_trades').insert({ name: name.trim(), sort: 500 })
  if (r.error && !/duplicate/i.test(r.error.message)) throw fail(r.error)
}

// ---------- templates ----------
// the standard templates (Settings), plus this job's or enquiry's own when given. Before script 058 / 059 only the standard ones exist.
export async function loadTemplates(o?: OwnerRef): Promise<RfiTemplate[]> {
  const base = () => supabase.from('rfi_templates').select('*').eq('archived', false)
  const std = 'and(job_id.is.null,enquiry_id.is.null)'
  let r = await (o ? base().or(`${std},${o.kind === 'job' ? 'job_id' : 'enquiry_id'}.eq.${o.id}`) : base().is('job_id', null)).order('sort').order('name')
  if (r.error && o) r = await base().or(`job_id.is.null,job_id.eq.${o.kind === 'job' ? o.id : '00000000-0000-0000-0000-000000000000'}`).order('sort').order('name') // before 059
  if (r.error) r = await base().order('sort').order('name') // before 058
  if (r.error) return []
  return r.data as RfiTemplate[]
}
export async function saveTemplate(t: Partial<RfiTemplate> & { name: string }) {
  const row = { ...t }
  const r = t.id ? await supabase.from('rfi_templates').update(row).eq('id', t.id).select('*').single() : await supabase.from('rfi_templates').insert(row).select('*').single()
  if (r.error) throw fail(r.error)
  return r.data as RfiTemplate
}
export async function archiveTemplate(id: string) {
  const r = await supabase.from('rfi_templates').update({ archived: true }).eq('id', id)
  if (r.error) throw fail(r.error)
}

// working days from a date (weekends skipped)
export function addWorkingDays(from: string, days: number) {
  let d = from
  let n = 0
  while (n < days) {
    d = addDaysIso(d, 1)
    const wd = new Date(d + 'T00:00:00').getDay()
    if (wd !== 0 && wd !== 6) n++
  }
  return d
}

// the people a template stands for on one job: roles looked up in that job's directory / team
export interface PersonRef {
  directory_id?: string
  profile_id?: string
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const roleMatch = (have: string, want: string) => {
  const a = norm(have)
  const b = norm(want)
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
}
export interface Filled {
  assignees: PersonRef[]
  cc: PersonRef[]
  managerId: string | null
  trade: string
  title: string
  question: string
  dueDate: string
  chaseDays: number
  missing: string[] // roles that nobody on this job holds yet
}
export function fillFromTemplate(t: RfiTemplate, dir: DirPerson[], team: TeamMember[], me: string | null): Filled {
  const missing: string[] = []
  // a project template names its people outright; those no longer on the job are dropped with a note
  if (t.job_id || t.enquiry_id || t.assignee_keys?.length || t.cc_keys?.length) {
    const valid = new Set([...dir.map((p) => `d:${p.id}`), ...team.map((m) => `p:${m.profile_id}`)])
    const toRef = (k: string): PersonRef => (k.startsWith('d:') ? { directory_id: k.slice(2) } : { profile_id: k.slice(2) })
    const keep = (keys: string[] = []) => keys.filter((k) => (valid.has(k) ? true : (missing.push('someone who has left the job'), false))).map(toRef)
    return {
      assignees: keep(t.assignee_keys),
      cc: keep(t.cc_keys),
      managerId: t.manager_id ?? me,
      trade: t.trade ?? '',
      title: t.title_prefix ?? '',
      question: t.question ? `<p>${t.question.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</p>` : '',
      dueDate: t.due_days != null ? addWorkingDays(todayIso(), t.due_days) : '',
      chaseDays: t.chase_days,
      missing,
    }
  }
  const pick = (roles: string[]): PersonRef[] => {
    const out: PersonRef[] = []
    for (const role of roles) {
      const fromDir = dir.filter((p) => roleMatch(p.role, role))
      const fromTeam = team.filter((m) => roleMatch(m.role, role))
      if (!fromDir.length && !fromTeam.length) missing.push(role)
      for (const p of fromDir) out.push({ directory_id: p.id })
      for (const m of fromTeam) out.push({ profile_id: m.profile_id })
    }
    // no one twice
    return out.filter((p, i, a) => a.findIndex((x) => x.directory_id === p.directory_id && x.profile_id === p.profile_id) === i)
  }
  const manager = t.manager_role ? team.find((m) => roleMatch(m.role, t.manager_role!)) : null
  if (t.manager_role && !manager) missing.push(`${t.manager_role} (RFI manager, on the job's Team)`)
  return {
    assignees: pick(t.assignee_roles),
    cc: pick(t.cc_roles),
    managerId: manager?.profile_id ?? me,
    trade: t.trade ?? '',
    title: t.title_prefix ?? '',
    question: t.question ? `<p>${t.question.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</p>` : '',
    dueDate: t.due_days != null ? addWorkingDays(todayIso(), t.due_days) : '',
    chaseDays: t.chase_days,
    missing,
  }
}

// ---------- loading ----------
export async function loadRfis(o: OwnerRef) {
  const rfis = await ok<Rfi[]>(supabase.from('rfis').select('*').eq(ownerCol(o), o.id).order('number', { ascending: false }))
  const ids = rfis.map((r) => r.id)
  const people = ids.length ? await ok<RfiPerson[]>(supabase.from('rfi_people').select('*').in('rfi_id', ids)) : []
  // how many files each RFI has, so the list can show a paperclip
  const rows = ids.length ? await ok<{ rfi_id: string }[]>(supabase.from('rfi_files').select('rfi_id').in('rfi_id', ids)) : []
  const files: Record<string, number> = {}
  for (const f of rows) files[f.rfi_id] = (files[f.rfi_id] ?? 0) + 1
  return { rfis, people, files }
}
export async function loadRfi(id: string) {
  const [rfi, people, responses, files] = await Promise.all([
    ok<Rfi>(supabase.from('rfis').select('*').eq('id', id).single()),
    ok<RfiPerson[]>(supabase.from('rfi_people').select('*').eq('rfi_id', id)),
    ok<RfiResponse[]>(supabase.from('rfi_responses').select('*').eq('rfi_id', id).order('created_at')),
    ok<RfiFile[]>(supabase.from('rfi_files').select('*').eq('rfi_id', id).order('created_at')),
  ])
  return { rfi, people, responses, files }
}
export const nextNumber = async (o: OwnerRef) => {
  const r = await supabase.from('rfis').select('number').eq(ownerCol(o), o.id).order('number', { ascending: false }).limit(1)
  return ((r.data?.[0]?.number as number | undefined) ?? 0) + 1
}

// ---------- creating and changing ----------
export interface NewRfi {
  job_id: string | null
  enquiry_id: string | null
  number: number | null
  title: string
  question: string
  status: RfiStatus
  trade: string | null
  manager_id: string | null
  due_date: string | null
  received_from: string | null
  notify: boolean
  chase_days: number
  template_id: string | null
  assignees: PersonRef[]
  cc: PersonRef[]
}
export async function createRfi(n: NewRfi, files: File[]) {
  const { assignees, cc, ...row } = n
  const r = await supabase
    .from('rfis')
    .insert({ ...row, question: cleanHtml(n.question), number: n.number ?? 0 })
    .select('*')
    .single()
  if (r.error) throw fail(r.error)
  const rfi = r.data as Rfi
  const people = [...assignees.map((p) => ({ ...p, role: 'assignee' })), ...cc.map((p) => ({ ...p, role: 'cc' }))].map((p) => ({ rfi_id: rfi.id, role: p.role, directory_id: p.directory_id ?? null, profile_id: p.profile_id ?? null }))
  if (people.length) {
    const pr = await supabase.from('rfi_people').insert(people)
    if (pr.error) throw fail(pr.error)
  }
  for (const f of files) await addRfiFile(rfi.id, f, null)
  return rfi
}
export async function updateRfi(id: string, patch: Partial<Omit<Rfi, 'id' | 'job_id' | 'enquiry_id' | 'created_at'>>) {
  const r = await supabase.from('rfis').update(patch).eq('id', id).select('*').single()
  if (r.error) throw fail(r.error)
  return r.data as Rfi
}
// tender RFIs are drafted, then issued to the client together: drafts become open
export async function issueRfis(ids: string[]) {
  if (!ids.length) return
  const r = await supabase.from('rfis').update({ status: 'open' }).in('id', ids)
  if (r.error) throw fail(r.error)
}
export async function deleteRfi(id: string) {
  const files = await supabase.from('rfi_files').select('path').eq('rfi_id', id)
  const r = await supabase.from('rfis').delete().eq('id', id)
  if (r.error) throw fail(r.error)
  const paths = (files.data ?? []).map((f) => f.path as string)
  if (paths.length) await supabase.storage.from('rfis').remove(paths)
}
export async function setPeople(rfiId: string, role: 'assignee' | 'cc', refs: PersonRef[], current: RfiPerson[]) {
  const key = (p: { directory_id: string | null; profile_id: string | null }) => `${p.directory_id ?? ''}|${p.profile_id ?? ''}`
  const have = current.filter((p) => p.role === role)
  const want = new Set(refs.map((p) => key({ directory_id: p.directory_id ?? null, profile_id: p.profile_id ?? null })))
  const drop = have.filter((p) => !want.has(key(p)))
  const haveKeys = new Set(have.map(key))
  const add = refs.filter((p) => !haveKeys.has(key({ directory_id: p.directory_id ?? null, profile_id: p.profile_id ?? null })))
  if (drop.length) {
    const d = await supabase.from('rfi_people').delete().in('id', drop.map((p) => p.id))
    if (d.error) throw fail(d.error)
  }
  if (add.length) {
    const a = await supabase.from('rfi_people').insert(add.map((p) => ({ rfi_id: rfiId, role, directory_id: p.directory_id ?? null, profile_id: p.profile_id ?? null })))
    if (a.error) throw fail(a.error)
  }
}
export async function addResponse(rfiId: string, body: string, kind: RfiResponse['kind'], authorName: string | null, files: File[] = []) {
  const r = await supabase.from('rfi_responses').insert({ rfi_id: rfiId, kind, body: cleanHtml(body), author_name: authorName }).select('*').single()
  if (r.error) throw fail(r.error)
  const resp = r.data as RfiResponse
  const added: RfiFile[] = []
  for (const f of files) added.push(await addRfiFile(rfiId, f, resp.id))
  return { resp, files: added }
}

// ---------- files (private storage area "rfis") ----------
export async function addRfiFile(rfiId: string, file: File, responseId: string | null) {
  const safe = file.name.replace(/[^\w.\- ()]+/g, '_')
  const path = `${rfiId}/${Date.now()}-${safe}`
  const up = await supabase.storage.from('rfis').upload(path, file, { contentType: file.type || undefined })
  if (up.error) throw fail(up.error)
  const r = await supabase.from('rfi_files').insert({ rfi_id: rfiId, response_id: responseId, name: file.name, path, file_name: file.name }).select('*').single()
  if (r.error) {
    await supabase.storage.from('rfis').remove([path])
    throw fail(r.error)
  }
  return r.data as RfiFile
}
export async function removeRfiFile(f: RfiFile) {
  const r = await supabase.from('rfi_files').delete().eq('id', f.id)
  if (r.error) throw fail(r.error)
  await supabase.storage.from('rfis').remove([f.path])
}
export async function openRfiFile(path: string) {
  const r = await supabase.storage.from('rfis').createSignedUrl(path, 3600)
  if (r.error || !r.data) throw new Error(r.error?.message ?? 'File not found')
  window.open(r.data.signedUrl, '_blank', 'noopener')
}

export { loadTeam }

// ---------- reading the register ----------
export const daysOpen = (r: Pick<Rfi, 'created_at' | 'closed_at' | 'answered_at' | 'status'>, today = todayIso()) => {
  const end = r.status === 'closed' || r.status === 'void' ? (r.closed_at ?? today) : today
  return Math.max(0, Math.floor((new Date(end.slice(0, 10)).getTime() - new Date(r.created_at.slice(0, 10)).getTime()) / 86400000))
}
export const isOverdue = (r: Pick<Rfi, 'status' | 'due_date'>, today = todayIso()) => r.status === 'open' && !!r.due_date && r.due_date < today

// ---------- RFI to variation (script 062) ----------
// An answered RFI that changes the scope becomes a draft variation carrying the question and the answer(s), and the two are
// linked: the RFI shows its VO, and the VO shows the RFI it came from.
export interface RaisedVo {
  id: string
  vo_no: number
}
export async function raiseVariationFromRfi(rfi: Rfi, answers: { by: string; text: string }[]): Promise<RaisedVo> {
  if (!rfi.job_id) throw new Error('Only a job’s RFI can raise a variation.')
  const [job, max] = await Promise.all([
    supabase.from('jobs').select('ohp_pct, prelims_pct').eq('id', rfi.job_id).single(),
    supabase.from('variations').select('vo_no').eq('job_id', rfi.job_id).order('vo_no', { ascending: false }).limit(1),
  ])
  if (job.error) throw new Error(job.error.message)
  if (max.error) throw new Error(max.error.message)
  const { htmlToText } = await import('./richText')
  const question = htmlToText(rfi.question)
  const description = [
    `Raised from RFI ${rfi.number}: ${rfi.title}`,
    question ? `\nQuestion:\n${question}` : '',
    ...answers.map((a) => `\nAnswer (${a.by}):\n${a.text}`),
  ]
    .filter(Boolean)
    .join('\n')
  const vo_no = ((max.data?.[0]?.vo_no as number | undefined) ?? 0) + 1
  const ins = await supabase
    .from('variations')
    .insert({
      job_id: rfi.job_id,
      vo_no,
      title: `RFI ${rfi.number}: ${rfi.title}`.slice(0, 200),
      description,
      status: 'not_issued',
      vo_date: todayIso(),
      ohp_pct: job.data.ohp_pct,
      prelims_pct: job.data.prelims_pct,
      programme_days: 0,
    })
    .select('id, vo_no')
    .single()
  if (ins.error) throw new Error(ins.error.message)
  const link = await supabase.from('rfis').update({ variation_id: ins.data.id }).eq('id', rfi.id)
  if (link.error) throw fail(link.error)
  return ins.data as RaisedVo
}
export async function loadRfiVariation(variationId: string) {
  const r = await supabase.from('variations').select('id, vo_no, title, status').eq('id', variationId).maybeSingle()
  return r.data as { id: string; vo_no: number; title: string; status: string } | null
}
export async function loadRfiForVariation(variationId: string) {
  const r = await supabase.from('rfis').select('id, number, title, job_id').eq('variation_id', variationId).limit(1)
  return r.error ? null : ((r.data?.[0] as { id: string; number: number; title: string; job_id: string } | undefined) ?? null)
}
