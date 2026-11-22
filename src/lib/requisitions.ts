// Site › requisitions (agreed 22 Nov, script 032; docs/decisions.md "Material and hire requisition forms").
// A site manager raises a material requisition from its own link (/site/requisitions/new); the buyer works
// one list across all jobs and can ask the requester questions on each one. A buyer's question goes on the
// requester's bell and the job's To do; the answer goes back to the buyer (the database does this, 032).
// Hire requisitions follow on the same footing (kind 'hire', their own fields in data).
// The buyer's lists (material, hire) are for Operations logins and admins (script 034).
import { supabase } from './supabase'
import { cached, must } from './offline'
import type { Job } from './types'
import { nudgeEmails } from './notifications'

export type ReqKind = 'material' | 'hire'
export type ReqStatus = 'new' | 'query' | 'answered' | 'ordered' | 'delivered' | 'off_hired' | 'cancelled' // off_hired: hire only (039)
export const REQ_STATUS_LABELS: Record<ReqStatus, string> = {
  new: 'New',
  query: 'Query raised',
  answered: 'Answered',
  ordered: 'Ordered',
  delivered: 'Delivered',
  off_hired: 'Off-hired',
  cancelled: 'Voided', // as on the SharePoint lists (22 Nov)
}
export const OPEN_STATUSES: ReqStatus[] = ['new', 'query', 'answered', 'ordered']
// a hire that's delivered is "On hire"; off-hired is for hire only
export const statusLabel = (s: ReqStatus, kind: ReqKind) => (kind === 'hire' && s === 'delivered' ? 'On hire' : REQ_STATUS_LABELS[s])
export const statusesFor = (kind: ReqKind) => (Object.keys(REQ_STATUS_LABELS) as ReqStatus[]).filter((s) => kind === 'hire' || s !== 'off_hired')
// the back ends' names (22 Nov)
export const ADMIN_LIST_NAME: Record<ReqKind, string> = { material: 'Material Req - ADMIN', hire: 'Hire Req - ADMIN' }

export interface Requisition {
  id: string
  req_no: number
  kind: ReqKind
  job_id: string
  element: string
  details: string
  required_by: string
  notes: string | null
  status: ReqStatus
  requested_by: string | null
  requester_name: string | null
  requester_email: string | null
  buyer_id: string | null
  supplier_company_id: string | null // unused since 038
  supplier: string | null // typed by the buyer (038)
  po_number: string | null
  order_value: number | null
  order_date: string | null
  delivery_date: string | null
  data: Record<string, unknown>
  created_at: string
  updated_at: string
}
export interface ReqMessage {
  id: string
  requisition_id: string
  author_id: string | null
  author_name: string | null
  body: string
  created_at: string
}
export interface ReqFile {
  id: string
  requisition_id: string
  path: string
  name: string
  created_at: string
}

export const reqRef = (r: Pick<Requisition, 'kind' | 'req_no'>) => `${r.kind === 'hire' ? 'HR' : 'MR'}${String(r.req_no).padStart(4, '0')}`
export const jobLabel = (j: Pick<Job, 'job_no' | 'code' | 'name'> | undefined) => (j ? `${j.job_no} ${j.code} · ${j.name}` : '—')

const needs032 = (m: string) =>
  /requisition/i.test(m) && /does not exist|schema cache|bucket/i.test(m) ? 'Requisitions need script 032 run in Supabase first (supabase/README.md).' : m

export async function me() {
  const { data } = await supabase.auth.getSession()
  return data.session?.user ?? null
}

// mine: only the ones I raised (the site manager's view); else all I can see (Operations: all of them, script 034)
export function loadRequisitions(opts: { mine?: string; jobId?: string; kind?: ReqKind } = {}) {
  let q = supabase.from('requisitions').select('*')
  if (opts.kind) q = q.eq('kind', opts.kind)
  if (opts.mine) q = q.eq('requested_by', opts.mine)
  if (opts.jobId) q = q.eq('job_id', opts.jobId)
  return cached(`requisitions:${opts.mine ?? ''}:${opts.jobId ?? ''}:${opts.kind ?? ''}`, () => must<Requisition[]>(q.order('req_no', { ascending: false }))).catch((e: Error) => {
    throw new Error(needs032(e.message))
  })
}
export function loadRequisition(id: string) {
  return Promise.all([
    cached(`requisition:${id}`, () => must<Requisition>(supabase.from('requisitions').select('*').eq('id', id).single())),
    cached(`requisition-messages:${id}`, () => must<ReqMessage[]>(supabase.from('requisition_messages').select('*').eq('requisition_id', id).order('created_at'))),
    cached(`requisition-files:${id}`, () => must<ReqFile[]>(supabase.from('requisition_files').select('*').eq('requisition_id', id).order('created_at'))),
  ]).catch((e: Error) => {
    throw new Error(needs032(e.message))
  })
}

// the jobs a requisition can be for (the form's "Site name"): live ones, then tenders
// just number, code and name (script 043: requisition_sites(), so people who can raise requisitions but not open
// jobs still get the list); before 043 is run, straight from jobs. Only id, job_no, code, name and status are filled.
export function loadSites() {
  return cached('req-sites', async () => {
    const r = await supabase.rpc('requisition_sites')
    if (!r.error) return r.data as Job[]
    return must<Job[]>(supabase.from('jobs').select('id,job_no,code,name,status').in('status', ['live', 'tender']).order('job_no', { ascending: false }))
  })
}

export interface NewRequisition {
  kind: ReqKind
  job_id: string
  element: string
  details: string
  required_by: string
  notes: string | null
  data?: Record<string, unknown>
}
// raised by the signed-in person; their name and email are taken from their details
export async function raiseRequisition(r: NewRequisition, files: File[]) {
  const user = await me()
  if (!user) throw new Error('Sign in first.')
  const prof = await supabase.from('profiles').select('full_name,email').eq('id', user.id).maybeSingle()
  const ins = await supabase
    .from('requisitions')
    .insert({
      ...r,
      data: r.data ?? {},
      requested_by: user.id,
      requester_name: prof.data?.full_name ?? user.email ?? null,
      requester_email: prof.data?.email ?? user.email ?? null,
    })
    .select('*')
    .single()
  if (ins.error) throw new Error(needs032(ins.error.message))
  const req = ins.data as Requisition
  for (const f of files) await addFile(req, f)
  nudgeEmails()
  return req
}

export async function updateRequisition(id: string, patch: Partial<Requisition>) {
  const r = await supabase.from('requisitions').update(patch).eq('id', id)
  if (r.error) throw new Error(needs032(r.error.message))
  if (patch.status || patch.data) nudgeEmails()
}

export async function postMessage(req: Requisition, body: string) {
  const user = await me()
  if (!user) throw new Error('Sign in first.')
  const prof = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  const r = await supabase
    .from('requisition_messages')
    .insert({ requisition_id: req.id, author_id: user.id, author_name: prof.data?.full_name ?? user.email ?? null, body: body.trim() })
    .select('*')
    .single()
  if (r.error) throw new Error(needs032(r.error.message))
  nudgeEmails()
  return r.data as ReqMessage
}

export async function addFile(req: Requisition, file: File) {
  const safe = file.name.replace(/[^\w.\- ]+/g, '_')
  const path = `${req.job_id}/${req.id}/${Date.now()}-${safe}`
  const up = await supabase.storage.from('requisitions').upload(path, file, { contentType: file.type || undefined })
  if (up.error) throw new Error(needs032(up.error.message))
  const r = await supabase.from('requisition_files').insert({ requisition_id: req.id, path, name: file.name }).select('*').single()
  if (r.error) throw new Error(needs032(r.error.message))
  return r.data as ReqFile
}
export async function removeFile(f: ReqFile) {
  await supabase.storage.from('requisitions').remove([f.path])
  const r = await supabase.from('requisition_files').delete().eq('id', f.id)
  if (r.error) throw new Error(r.error.message)
}
export async function fileUrl(path: string) {
  const r = await supabase.storage.from('requisitions').createSignedUrl(path, 3600)
  if (r.error || !r.data) throw new Error(r.error?.message ?? 'File not found')
  return r.data.signedUrl
}
