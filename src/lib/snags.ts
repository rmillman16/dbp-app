// Snagging (24 Nov, script 070): a numbered snag per defect on a job, with photos, an assignee from the project directory, a
// status, and the task for the approver to check what a trade says is done. The trades see their own list on a private link
// (no login), through the "snag-external" Edge Function. See supabase/070_snagging.sql.
import { supabase } from './supabase'
import { shrinkImage } from './image'

export type SnagStatus = 'incomplete' | 'complete'
export interface Snag {
  id: string
  job_id: string
  number: number
  title: string
  description: string | null
  location: string | null
  status: SnagStatus
  raised_by: string | null
  assignee_id: string | null
  trade: string | null
  marked_done_at: string | null
  marked_done_by: string | null
  done_note: string | null
  completed_at: string | null
  rejected_at?: string | null // sent back by the approver (script 079)
  reject_note?: string | null
  reject_count?: number
  created_at: string
}
export interface SnagFile {
  id: string
  snag_id: string
  kind: 'raised' | 'proof' | 'previous' // previous = the proof from an attempt that was sent back
  name: string
  path: string
  uploaded_by: string | null
  created_at: string
}
// where a snag stands: waiting for the trade, the trade says it is done (the approver checks), or complete
export type SnagState = 'todo' | 'check' | 'complete'
export const stateOf = (s: Pick<Snag, 'status' | 'marked_done_at'>): SnagState => (s.status === 'complete' ? 'complete' : s.marked_done_at ? 'check' : 'todo')
export const STATE_LABEL: Record<SnagState, string> = { todo: 'To do', check: 'To check', complete: 'Complete' }
export const snagRef = (job: { job_no: string | number; code: string }, n: number) => `${job.job_no}_${job.code}_SNAG_${String(n).padStart(3, '0')}`

const needs070 = (m: string) => (/relation|schema cache|does not exist|snag/i.test(m) && /schema cache|does not exist|relation/i.test(m) ? 'Snagging needs script 070 run in Supabase first (supabase/README.md).' : m)
const fail = (e: { message: string }) => new Error(needs070(e.message))

// ---------- who a snag can be given to: the subcontractors and suppliers in this job's project directory ----------
export interface Assignee {
  id: string // the job_directory entry
  name: string
  company: string
  companyId: string
  trade: string
  type: string // the company's type: subcontractor, supplier...
  email: string | null
}
export async function loadAssignees(jobId: string): Promise<Assignee[]> {
  const [d, c, p] = await Promise.all([
    supabase.from('job_directory').select('id, company_id, contact_id').eq('job_id', jobId),
    supabase.from('companies').select('id, name, trade, type, email'),
    supabase.from('contacts').select('id, name, email'),
  ])
  if (d.error) throw fail(d.error)
  const co = new Map((c.data ?? []).map((x) => [x.id as string, x as { id: string; name: string; trade: string | null; type: string; email: string | null }]))
  const ct = new Map((p.data ?? []).map((x) => [x.id as string, x as { id: string; name: string; email: string | null }]))
  return (d.data ?? [])
    .filter((e) => e.company_id)
    .map((e) => {
      const company = co.get(e.company_id as string)!
      const person = e.contact_id ? ct.get(e.contact_id as string) : null
      return { id: e.id as string, name: person?.name ?? company.name, company: company.name, companyId: company.id, trade: company.trade ?? '', type: company.type, email: person?.email || company.email || null }
    })
}

// ---------- loading ----------
export async function loadSnags(jobId: string) {
  const r = await supabase.from('snags').select('*').eq('job_id', jobId).order('number', { ascending: false })
  if (r.error) throw fail(r.error)
  const snags = r.data as Snag[]
  // how many photos each has, for the list
  const ids = snags.map((s) => s.id)
  const photos: Record<string, number> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const f = await supabase.from('snag_files').select('snag_id').in('snag_id', ids.slice(i, i + 200))
    for (const x of f.data ?? []) photos[x.snag_id as string] = (photos[x.snag_id as string] ?? 0) + 1
  }
  return { snags, photos }
}
export async function loadSnag(id: string) {
  const [s, f] = await Promise.all([supabase.from('snags').select('*').eq('id', id).single(), supabase.from('snag_files').select('*').eq('snag_id', id).order('created_at')])
  if (s.error) throw fail(s.error)
  return { snag: s.data as Snag, files: (f.data ?? []) as SnagFile[] }
}

// ---------- creating and changing ----------
export interface NewSnag {
  job_id: string
  title: string
  description: string
  location: string
  assignee_id: string | null
  trade: string | null
  status: SnagStatus
}
export async function createSnag(n: NewSnag, photos: File[]) {
  const r = await supabase
    .from('snags')
    .insert({ job_id: n.job_id, title: n.title.trim(), description: n.description.trim() || null, location: n.location.trim() || null, assignee_id: n.assignee_id, trade: n.trade?.trim() || null, status: n.status })
    .select('*')
    .single()
  if (r.error) throw fail(r.error)
  const snag = r.data as Snag
  for (const p of photos) await addSnagPhoto(snag.id, p, 'raised')
  return snag
}
// The approver finds it isn't done, or isn't good enough: it goes back to "to do" on the trade's list with the reason, and the photos
// from that attempt are kept as "previous" (script 079).
export async function sendBackSnag(snag: Pick<Snag, 'id' | 'reject_count'>, reason: string) {
  const r = await supabase
    .from('snags')
    .update({ marked_done_at: null, marked_done_by: null, done_note: null, rejected_at: new Date().toISOString(), reject_note: reason.trim(), reject_count: (snag.reject_count ?? 0) + 1 })
    .eq('id', snag.id)
    .select('*')
    .single()
  if (r.error) throw new Error(/reject_|schema cache/i.test(r.error.message) ? 'Sending a snag back needs script 079 run in Supabase first (supabase/README.md).' : needs070(r.error.message))
  await supabase.from('snag_files').update({ kind: 'previous' }).eq('snag_id', snag.id).eq('kind', 'proof')
  return r.data as Snag
}

export async function updateSnag(id: string, patch: Partial<Pick<Snag, 'title' | 'description' | 'location' | 'status' | 'assignee_id' | 'trade' | 'marked_done_at' | 'marked_done_by' | 'done_note' | 'raised_by'>>) {
  const r = await supabase.from('snags').update(patch).eq('id', id).select('*').single()
  if (r.error) throw fail(r.error)
  return r.data as Snag
}
export async function deleteSnag(id: string) {
  const files = await supabase.from('snag_files').select('path').eq('snag_id', id)
  const r = await supabase.from('snags').delete().eq('id', id).select('id')
  if (r.error) throw fail(r.error)
  if (!r.data?.length) throw new Error('Only an admin can delete a snag.')
  const paths = (files.data ?? []).map((f) => f.path as string)
  if (paths.length) await supabase.storage.from('snags').remove(paths)
}

// ---------- photos (private storage area "snags") ----------
export async function addSnagPhoto(snagId: string, file: File, kind: SnagFile['kind']) {
  const small = await shrinkImage(file)
  const safe = small.name.replace(/[^\w.\- ()]+/g, '_')
  const path = `${snagId}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${safe}`
  const up = await supabase.storage.from('snags').upload(path, small, { contentType: small.type || undefined })
  if (up.error) throw fail(up.error)
  const r = await supabase.from('snag_files').insert({ snag_id: snagId, kind, name: small.name, path }).select('*').single()
  if (r.error) {
    await supabase.storage.from('snags').remove([path])
    throw fail(r.error)
  }
  return r.data as SnagFile
}
export async function removeSnagFile(f: SnagFile) {
  const r = await supabase.from('snag_files').delete().eq('id', f.id)
  if (r.error) throw fail(r.error)
  await supabase.storage.from('snags').remove([f.path])
}
export async function snagPhotoUrl(path: string, seconds = 3600) {
  const r = await supabase.storage.from('snags').createSignedUrl(path, seconds)
  if (r.error || !r.data) throw new Error(r.error?.message ?? 'Picture not found')
  return r.data.signedUrl
}
export async function snagPhotoBlob(path: string): Promise<Blob | null> {
  try {
    const r = await supabase.storage.from('snags').download(path)
    return r.error ? null : r.data
  } catch {
    return null
  }
}

// ---------- private links for the trades ----------
export async function issueSnagLink(jobId: string, companyId: string): Promise<string> {
  const r = await supabase.rpc('issue_snag_link', { p_job: jobId, p_company: companyId })
  if (r.error) throw new Error(/function|does not exist/i.test(r.error.message) ? 'Snagging needs script 070 run in Supabase first.' : r.error.message)
  return `${location.origin}/s/${r.data as string}`
}
export async function revokeSnagLinks(jobId: string, companyId: string) {
  const r = await supabase.rpc('revoke_snag_links', { p_job: jobId, p_company: companyId })
  if (r.error) throw new Error(r.error.message)
  return r.data as number
}
export async function loadLinkStatus(jobId: string) {
  const r = await supabase.from('snag_links').select('company_id, last_used_at, use_count, revoked_at, expires_at').eq('job_id', jobId)
  if (r.error) return new Map<string, { active: number; lastUsed: string | null; uses: number }>()
  const m = new Map<string, { active: number; lastUsed: string | null; uses: number }>()
  const now = new Date().toISOString()
  for (const l of r.data as { company_id: string; last_used_at: string | null; use_count: number; revoked_at: string | null; expires_at: string }[]) {
    const s = m.get(l.company_id) ?? { active: 0, lastUsed: null, uses: 0 }
    if (!l.revoked_at && l.expires_at > now) s.active++
    s.uses += l.use_count
    if (l.last_used_at && (!s.lastUsed || l.last_used_at > s.lastUsed)) s.lastUsed = l.last_used_at
    m.set(l.company_id, s)
  }
  return m
}
