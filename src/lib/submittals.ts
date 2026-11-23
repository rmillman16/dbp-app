// Submittals (23 Nov, script 060): things a subcontractor / supplier submits for approval (shop drawings, product data,
// samples, method statements, certificates). Built on the RFI platform: the same people (project directory and DBP team),
// chasing, drafts, templates per project and reports; plus revisions (A, B, C…) and a response outcome.
import { supabase } from './supabase'
import { addDaysIso, todayIso } from './format'
import { cleanHtml } from './richText'
import { addWorkingDays, type PersonRef } from './rfis'

export type SubmittalStatus = 'draft' | 'out' | 'approved' | 'approved_noted' | 'revise' | 'rejected' | 'void'
export const SUBMITTAL_STATUS: Record<SubmittalStatus, string> = {
  draft: 'Draft',
  out: 'Out for review',
  approved: 'Approved',
  approved_noted: 'Approved as noted',
  revise: 'Revise and resubmit',
  rejected: 'Rejected',
  void: 'Void',
}
export type Outcome = 'approved' | 'approved_noted' | 'revise' | 'rejected'
export const OUTCOMES: [Outcome, string][] = [
  ['approved', 'Approved'],
  ['approved_noted', 'Approved as noted'],
  ['revise', 'Revise and resubmit'],
  ['rejected', 'Rejected'],
]
export type SubmittalType = 'shop_drawing' | 'product_data' | 'sample' | 'method_statement' | 'certificate' | 'other'
export const TYPES: [SubmittalType, string][] = [
  ['shop_drawing', 'Shop drawing'],
  ['product_data', 'Product data'],
  ['sample', 'Sample'],
  ['method_statement', 'Method statement'],
  ['certificate', 'Certificate'],
  ['other', 'Other'],
]
export const typeLabel = (t: string) => TYPES.find(([k]) => k === t)?.[1] ?? t
export const revLetter = (n: number) => (n >= 1 && n <= 26 ? String.fromCharCode(64 + n) : String(n)) // 1 = A
export const isFinal = (s: SubmittalStatus) => s === 'approved' || s === 'approved_noted'

export interface Submittal {
  id: string
  job_id: string
  number: number
  title: string
  description: string | null
  type: SubmittalType
  trade: string | null
  status: SubmittalStatus
  current_rev: number
  submitted_by: string | null // a project directory entry
  manager_id: string | null
  due_date: string | null // return by
  required_by: string | null // needed on site
  notify: boolean
  chase_days: number
  last_chased_at: string | null
  template_id: string | null
  created_by: string | null
  created_at: string
  submitted_at: string | null
  responded_at: string | null
}
export interface SubmittalPerson {
  id: string
  submittal_id: string
  role: 'reviewer' | 'cc'
  directory_id: string | null
  profile_id: string | null
}
export interface Revision {
  id: string
  submittal_id: string
  rev: number
  submitted_on: string | null
  due_date: string | null
  outcome: Outcome | null
  response_notes: string | null
  responded_by: string | null
  responded_on: string | null
  created_at: string
}
export interface SubmittalFile {
  id: string
  submittal_id: string
  revision_id: string | null
  kind: 'submission' | 'response'
  name: string
  path: string
  file_name: string
  created_at: string
}
export interface SubmittalTemplate {
  id: string
  job_id: string
  name: string
  type: SubmittalType
  trade: string | null
  submitter_key: string | null
  reviewer_keys: string[]
  cc_keys: string[]
  manager_id: string | null
  title_prefix: string | null
  due_days: number | null
  chase_days: number
  archived: boolean
}

const needs060 = (m: string) => (/relation|schema cache|does not exist/i.test(m) ? 'Submittals need script 060 run in Supabase first (supabase/README.md).' : m)
const fail = (e: { message: string }) => new Error(needs060(e.message))
async function ok<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const r = await p
  if (r.error) throw fail(r.error)
  return r.data as T
}

// ---------- loading ----------
export async function loadSubmittals(jobId: string) {
  const items = await ok<Submittal[]>(supabase.from('submittals').select('*').eq('job_id', jobId).order('number', { ascending: false }))
  const ids = items.map((s) => s.id)
  const people = ids.length ? await ok<SubmittalPerson[]>(supabase.from('submittal_people').select('*').in('submittal_id', ids)) : []
  // how many files each submittal has, so the list can show a paperclip
  const rows = ids.length ? await ok<{ submittal_id: string }[]>(supabase.from('submittal_files').select('submittal_id').in('submittal_id', ids)) : []
  const files: Record<string, number> = {}
  for (const f of rows) files[f.submittal_id] = (files[f.submittal_id] ?? 0) + 1
  return { items, people, files }
}
export async function loadSubmittal(id: string) {
  const [s, people, revisions, files] = await Promise.all([
    ok<Submittal>(supabase.from('submittals').select('*').eq('id', id).single()),
    ok<SubmittalPerson[]>(supabase.from('submittal_people').select('*').eq('submittal_id', id)),
    ok<Revision[]>(supabase.from('submittal_revisions').select('*').eq('submittal_id', id).order('rev')),
    ok<SubmittalFile[]>(supabase.from('submittal_files').select('*').eq('submittal_id', id).order('created_at')),
  ])
  return { s, people, revisions, files }
}
export async function nextSubmittalNumber(jobId: string) {
  const r = await supabase.from('submittals').select('number').eq('job_id', jobId).order('number', { ascending: false }).limit(1)
  return ((r.data?.[0]?.number as number | undefined) ?? 0) + 1
}
export async function loadSubmittalTemplates(jobId: string): Promise<SubmittalTemplate[]> {
  const r = await supabase.from('submittal_templates').select('*').eq('job_id', jobId).eq('archived', false).order('sort').order('name')
  return r.error ? [] : (r.data as SubmittalTemplate[])
}
export async function saveSubmittalTemplate(t: Partial<SubmittalTemplate> & { name: string; job_id: string }) {
  const r = t.id ? await supabase.from('submittal_templates').update(t).eq('id', t.id).select('*').single() : await supabase.from('submittal_templates').insert(t).select('*').single()
  if (r.error) throw fail(r.error)
  return r.data as SubmittalTemplate
}
export async function archiveSubmittalTemplate(id: string) {
  const r = await supabase.from('submittal_templates').update({ archived: true }).eq('id', id)
  if (r.error) throw fail(r.error)
}
export function fillSubmittalTemplate(t: SubmittalTemplate, valid: Set<string>, me: string | null) {
  const keep = (keys: string[]) => keys.filter((k) => valid.has(k))
  return {
    type: t.type,
    trade: t.trade ?? '',
    title: t.title_prefix ?? '',
    submitterKey: t.submitter_key && valid.has(t.submitter_key) ? t.submitter_key : '',
    reviewers: keep(t.reviewer_keys),
    cc: keep(t.cc_keys),
    managerId: t.manager_id ?? me,
    dueDate: t.due_days != null ? addWorkingDays(todayIso(), t.due_days) : '',
    chaseDays: t.chase_days,
    dropped: [...t.reviewer_keys, ...t.cc_keys, ...(t.submitter_key ? [t.submitter_key] : [])].filter((k) => !valid.has(k)).length,
  }
}

// ---------- creating and changing ----------
export interface NewSubmittal {
  job_id: string
  number: number | null
  title: string
  description: string
  type: SubmittalType
  trade: string | null
  submitted_by: string | null
  manager_id: string | null
  due_date: string | null
  required_by: string | null
  notify: boolean
  chase_days: number
  template_id: string | null
  reviewers: PersonRef[]
  cc: PersonRef[]
  out: boolean // submit for review straight away
}
export async function createSubmittal(n: NewSubmittal, files: File[]) {
  const { reviewers, cc, out, ...row } = n
  // made as a draft with its people, then set out, so the database tells the right people
  const r = await supabase
    .from('submittals')
    .insert({ ...row, description: cleanHtml(n.description), number: n.number ?? 0, status: 'draft' })
    .select('*')
    .single()
  if (r.error) throw fail(r.error)
  const s = r.data as Submittal
  const people = [...reviewers.map((p) => ({ ...p, role: 'reviewer' })), ...cc.map((p) => ({ ...p, role: 'cc' }))].map((p) => ({
    submittal_id: s.id,
    role: p.role,
    directory_id: p.directory_id ?? null,
    profile_id: p.profile_id ?? null,
  }))
  if (people.length) {
    const pr = await supabase.from('submittal_people').insert(people)
    if (pr.error) throw fail(pr.error)
  }
  const rev = await supabase.from('submittal_revisions').insert({ submittal_id: s.id, rev: 1, due_date: n.due_date }).select('*').single()
  if (rev.error) throw fail(rev.error)
  for (const f of files) await addFile(s.id, (rev.data as Revision).id, f, 'submission')
  if (out) return submitForReview(s.id, (rev.data as Revision).id, n.due_date)
  return s
}
export async function updateSubmittal(id: string, patch: Partial<Omit<Submittal, 'id' | 'job_id' | 'created_at'>>) {
  const r = await supabase.from('submittals').update(patch).eq('id', id).select('*').single()
  if (r.error) throw fail(r.error)
  return r.data as Submittal
}
export async function setSubmittalPeople(id: string, role: 'reviewer' | 'cc', refs: PersonRef[], current: SubmittalPerson[]) {
  const key = (p: { directory_id?: string | null; profile_id?: string | null }) => `${p.directory_id ?? ''}|${p.profile_id ?? ''}`
  const have = current.filter((p) => p.role === role)
  const want = new Set(refs.map(key))
  const drop = have.filter((p) => !want.has(key(p)))
  const haveKeys = new Set(have.map(key))
  const add = refs.filter((p) => !haveKeys.has(key(p)))
  if (drop.length) {
    const d = await supabase.from('submittal_people').delete().in('id', drop.map((p) => p.id))
    if (d.error) throw fail(d.error)
  }
  if (add.length) {
    const a = await supabase.from('submittal_people').insert(add.map((p) => ({ submittal_id: id, role, directory_id: p.directory_id ?? null, profile_id: p.profile_id ?? null })))
    if (a.error) throw fail(a.error)
  }
}
// the revision goes out for review
export async function submitForReview(id: string, revisionId: string, due: string | null) {
  const rv = await supabase.from('submittal_revisions').update({ submitted_on: todayIso(), due_date: due }).eq('id', revisionId)
  if (rv.error) throw fail(rv.error)
  return updateSubmittal(id, { status: 'out', due_date: due })
}
// a response from the reviewers (recorded by DBP): the revision is answered, the submittal takes the outcome
export async function recordResponse(s: Submittal, revisionId: string, o: { outcome: Outcome; notes: string; by: string; on: string }, files: File[]) {
  const rv = await supabase
    .from('submittal_revisions')
    .update({ outcome: o.outcome, response_notes: cleanHtml(o.notes), responded_by: o.by || null, responded_on: o.on || todayIso() })
    .eq('id', revisionId)
  if (rv.error) throw fail(rv.error)
  for (const f of files) await addFile(s.id, revisionId, f, 'response')
  return updateSubmittal(s.id, { status: o.outcome })
}
// "Revise and resubmit" / "Rejected": start the next revision (a draft)
export async function newRevision(s: Submittal) {
  const next = s.current_rev + 1
  const rv = await supabase.from('submittal_revisions').insert({ submittal_id: s.id, rev: next, due_date: s.due_date }).select('*').single()
  if (rv.error) throw fail(rv.error)
  await updateSubmittal(s.id, { status: 'draft', current_rev: next })
  return rv.data as Revision
}
export async function deleteSubmittal(id: string) {
  const files = await supabase.from('submittal_files').select('path').eq('submittal_id', id)
  const r = await supabase.from('submittals').delete().eq('id', id)
  if (r.error) throw fail(r.error)
  const paths = (files.data ?? []).map((f) => f.path as string)
  if (paths.length) await supabase.storage.from('submittals').remove(paths)
}

// ---------- files (private storage area "submittals") ----------
export async function addFile(submittalId: string, revisionId: string | null, file: File, kind: SubmittalFile['kind']) {
  const safe = file.name.replace(/[^\w.\- ()]+/g, '_')
  const path = `${submittalId}/${Date.now()}-${safe}`
  const up = await supabase.storage.from('submittals').upload(path, file, { contentType: file.type || undefined })
  if (up.error) throw fail(up.error)
  const r = await supabase.from('submittal_files').insert({ submittal_id: submittalId, revision_id: revisionId, kind, name: file.name, path, file_name: file.name }).select('*').single()
  if (r.error) {
    await supabase.storage.from('submittals').remove([path])
    throw fail(r.error)
  }
  return r.data as SubmittalFile
}
export async function removeFile(f: SubmittalFile) {
  const r = await supabase.from('submittal_files').delete().eq('id', f.id)
  if (r.error) throw fail(r.error)
  await supabase.storage.from('submittals').remove([f.path])
}
export async function openFile(path: string) {
  const r = await supabase.storage.from('submittals').createSignedUrl(path, 3600)
  if (r.error || !r.data) throw new Error(r.error?.message ?? 'File not found')
  window.open(r.data.signedUrl, '_blank', 'noopener')
}

// ---------- reading the register ----------
export const daysOut = (s: Pick<Submittal, 'status' | 'submitted_at' | 'responded_at'>, today = todayIso()) => {
  if (!s.submitted_at) return 0
  const end = s.status === 'out' ? today : (s.responded_at ?? today)
  return Math.max(0, Math.floor((new Date(end.slice(0, 10)).getTime() - new Date(s.submitted_at.slice(0, 10)).getTime()) / 86400000))
}
export const isLate = (s: Pick<Submittal, 'status' | 'due_date'>, today = todayIso()) => s.status === 'out' && !!s.due_date && s.due_date < today
export const dueSoon = (s: Pick<Submittal, 'status' | 'due_date'>, today = todayIso()) => s.status === 'out' && !!s.due_date && s.due_date >= today && s.due_date <= addDaysIso(today, 3)
