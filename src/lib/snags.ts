// Snagging (24 Nov, script 070): a numbered snag per defect on a job, with photos, an assignee from the project directory, a
// status, and the task for the approver to check what a trade says is done. The trades see their own list on a private link
// (no login), through the "snag-external" Edge Function. See supabase/070_snagging.sql.
import { supabase } from './supabase'
import { shrinkImage } from './image'
import { enqueue, isLocalPath, localFileUrl, newId, queued, tryOrQueue } from './outbox'

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
// number 0 = made offline and not sent yet: the number is given when it reaches the database
export const snagRef = (job: { job_no: string | number; code: string }, n: number) => (n ? `${job.job_no}_${job.code}_SNAG_${String(n).padStart(3, '0')}` : `${job.job_no}_${job.code}_SNAG_(number given when sent)`)
export const snagNo = (n: number) => (n ? String(n) : '…')

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
// Work made offline that hasn't been sent yet, shown as if it had been: new snags (number 0), changes and photos
async function pendingSnags(jobId?: string) {
  const items = await queued()
  const made: Snag[] = items
    .filter((i) => i.op.t === 'snag.create' && (!jobId || i.jobId === jobId))
    .map((i) => {
      const op = i.op as Extract<typeof i.op, { t: 'snag.create' }>
      return { number: 0, description: null, location: null, raised_by: null, assignee_id: null, trade: null, marked_done_at: null, marked_done_by: null, done_note: null, completed_at: null, ...op.row, id: op.id, created_at: i.at } as Snag
    })
  const patches = new Map<string, Record<string, unknown>>()
  for (const i of items) if (i.op.t === 'snag.update') patches.set(i.op.id, { ...patches.get(i.op.id), ...i.op.patch })
  return { made, patches, items }
}
const patched = (s: Snag, patches: Map<string, Record<string, unknown>>): Snag => (patches.has(s.id) ? ({ ...s, ...patches.get(s.id) } as Snag) : s)

export async function loadSnags(jobId: string) {
  const p = await pendingSnags(jobId)
  const r = await supabase.from('snags').select('*').eq('job_id', jobId).order('number', { ascending: false })
  if (r.error) throw fail(r.error)
  const snags = [...p.made.reverse(), ...(r.data as Snag[]).map((s) => patched(s, p.patches))]
  // how many photos each has, for the list
  const ids = snags.filter((s) => s.number).map((s) => s.id)
  const photos: Record<string, number> = {}
  for (const i of p.items) if (i.op.t === 'snag.photo') photos[i.op.snagId] = (photos[i.op.snagId] ?? 0) + 1
  for (let i = 0; i < ids.length; i += 200) {
    const f = await supabase.from('snag_files').select('snag_id').in('snag_id', ids.slice(i, i + 200))
    for (const x of f.data ?? []) photos[x.snag_id as string] = (photos[x.snag_id as string] ?? 0) + 1
  }
  return { snags, photos }
}
export async function loadSnag(id: string) {
  const p = await pendingSnags()
  const waiting = p.made.find((m) => m.id === id)
  // photos still on the device (path "local:<id>")
  const local: SnagFile[] = p.items
    .filter((i) => i.op.t === 'snag.photo' && i.op.snagId === id)
    .map((i) => {
      const op = i.op as Extract<typeof i.op, { t: 'snag.photo' }>
      return { id: op.fileId, snag_id: id, kind: op.kind as SnagFile['kind'], name: op.file.name, path: `local:${op.fileId}`, uploaded_by: null, created_at: i.at }
    })
  if (waiting) return { snag: patched(waiting, p.patches), files: local }
  const [s, f] = await Promise.all([supabase.from('snags').select('*').eq('id', id).single(), supabase.from('snag_files').select('*').eq('snag_id', id).order('created_at')])
  if (s.error) throw fail(s.error)
  return { snag: patched(s.data as Snag, p.patches), files: [...((f.data ?? []) as SnagFile[]), ...local] }
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
  const id = newId()
  const row = { job_id: n.job_id, title: n.title.trim(), description: n.description.trim() || null, location: n.location.trim() || null, assignee_id: n.assignee_id, trade: n.trade?.trim() || null, status: n.status }
  let made = null as Snag | null
  // no signal (or it drops): kept on the device and sent when it's back, with its photos
  const queuedIt = await tryOrQueue(
    async () => {
      const r = await supabase.from('snags').insert({ id, ...row }).select('*').single()
      if (r.error) throw fail(r.error)
      made = r.data as Snag
      for (const p of photos) await addSnagPhoto(id, p, 'raised')
    },
    async () => {
      await enqueue(`New snag: ${row.title}`, n.job_id, { t: 'snag.create', id, row })
      for (const p of photos) await addSnagPhoto(id, p, 'raised', true)
    },
  )
  return queuedIt || !made ? ({ ...row, id, number: 0, raised_by: null, marked_done_at: null, marked_done_by: null, done_note: null, completed_at: null, created_at: new Date().toISOString() } as Snag) : (made as Snag)
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
  let done = null as Snag | null
  await tryOrQueue(
    async () => {
      const r = await supabase.from('snags').update(patch).eq('id', id).select('*').single()
      if (r.error) throw fail(r.error)
      done = r.data as Snag
    },
    () => enqueue('Change to a snag', null, { t: 'snag.update', id, patch }),
    id,
  )
  // queued: what the screen loads is the snag with the waiting change on it
  return done ?? (await loadSnag(id)).snag
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
export async function addSnagPhoto(snagId: string, file: File, kind: SnagFile['kind'], forceQueue = false): Promise<SnagFile> {
  const small = await shrinkImage(file)
  const fileId = newId()
  const waiting = (): SnagFile => ({ id: fileId, snag_id: snagId, kind, name: small.name, path: `local:${fileId}`, uploaded_by: null, created_at: new Date().toISOString() })
  const later = () => enqueue('Snag photo', null, { t: 'snag.photo', fileId, snagId, kind, file: small })
  if (forceQueue) {
    await later()
    return waiting()
  }
  let added = null as SnagFile | null
  await tryOrQueue(
    async () => {
      added = await uploadSnagPhoto(snagId, small, kind)
    },
    later,
    snagId,
  )
  return added ?? waiting()
}
async function uploadSnagPhoto(snagId: string, small: File, kind: SnagFile['kind']) {
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
  if (isLocalPath(path)) return localFileUrl(path)
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
