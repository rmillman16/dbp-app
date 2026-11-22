// The sampling tracker (docs/decisions.md "Sampling module — scope", built 22 Nov, script 030):
// physical samples per job, grouped by material group, from the designer's finishes schedule (or
// added by hand). Photos and the designer's approval are uploaded into the private "samples"
// storage area. A due date can follow the programme: N weeks before the activity it's needed for.
import { supabase } from './supabase'
import { cached, must } from './offline'
import { loadProgramme, type ProgrammeTask } from './programme'
import { addCompany, loadCompanies } from './subcontracts'
import { addDays } from './programmeEdit'
import type { Company } from './types'

export type SampleStatus = 'not_requested' | 'requested' | 'submitted' | 'approved' | 'approved_with_comments' | 'rejected_resubmit' | 'omitted' // omitted: script 031
export type SampleType = 'sample' | 'benchmark' | 'mock_up'
export const SAMPLE_STATUS_LABELS: Record<SampleStatus, string> = {
  not_requested: 'Not requested',
  requested: 'Requested',
  submitted: 'Submitted',
  approved: 'Approved',
  approved_with_comments: 'Approved with comments',
  rejected_resubmit: 'Rejected – resubmit',
  omitted: 'Omitted', // set by DBP when the client hasn't updated the schedule
}
export const SAMPLE_TYPE_LABELS: Record<SampleType, string> = { sample: 'Physical sample', benchmark: 'Benchmark', mock_up: 'Mock-up' }
// the material groups the tracker is grouped by (decided 19 Nov: by material, not by level)
export const MATERIAL_GROUPS = [
  'Fabrics',
  'Glass & mirrors',
  'Laminates & metal',
  'Paints',
  'Stone, ceramic & composite',
  'Timber & veneers',
  'Wall coverings',
  'Flooring',
  'Ironmongery & fittings',
  'Lighting & electrical',
  'Other',
]

export interface Sample {
  id: string
  job_id: string
  finish_schedule_id: string | null
  code: string // e.g. M-S102
  designer_ref: string | null // e.g. SFF17
  material_group: string
  locations: string[] | null
  description: string | null
  specification: string | null
  quantity?: string | null
  supplier_company_id: string | null
  sample_type: SampleType
  requested_date: string | null
  due_date: string | null
  submitted_date: string | null
  status: SampleStatus
  designer_comments: string | null
  decided_by: string | null
  decision_date: string | null
  approval_evidence_url: string | null
  stored_location: string | null
  photo_url: string | null
  changed_after_approval: boolean
  sort: number
  // script 030
  programme_task_code?: string | null
  weeks_before?: number | null
  photo_path?: string | null
  evidence_path?: string | null
  evidence_name?: string | null
}
export interface FinishSchedule {
  id: string
  job_id: string
  designer: string | null
  document_no: string | null
  revision: string | null
  file_name?: string | null
  imported_at: string
}

const ok = async (p: PromiseLike<{ error: { message: string } | null }>) => {
  const r = await p
  if (r.error) throw new Error(r.error.message)
}

export const isOpen = (s: Pick<Sample, 'status'>) => s.status === 'not_requested' || s.status === 'requested' || s.status === 'rejected_resubmit'
export const isApproved = (s: Pick<Sample, 'status'>) => s.status === 'approved' || s.status === 'approved_with_comments'
// due from the programme: N weeks before the start of the activity it's needed for
export function programmeDue(s: Pick<Sample, 'programme_task_code' | 'weeks_before'>, tasks: ProgrammeTask[]) {
  if (!s.programme_task_code) return null
  const t = tasks.find((x) => x.code === s.programme_task_code)
  if (!t) return null
  return addDays(t.start_date, -Math.round(Number(s.weeks_before ?? 0) * 7))
}
export const overdue = (s: Sample, today: string) => isOpen(s) && !!s.due_date && s.due_date < today

// a "sample" that's only a heading from the schedule: no number in its code, no description or
// specification, and never touched (no status, supplier, dates, photo or approval)
export const isHeadingRow = (s: Sample) =>
  !/\d/.test(s.code) &&
  !s.description &&
  !s.specification &&
  s.status === 'not_requested' &&
  !s.supplier_company_id &&
  !s.requested_date &&
  !s.submitted_date &&
  !s.decision_date &&
  !s.photo_path &&
  !s.evidence_path &&
  !s.designer_comments

export async function loadSampling(jobId: string) {
  const [samples, schedules, prog, companies] = await Promise.all([
    cached(`samples:${jobId}`, () => must<Sample[]>(supabase.from('samples').select('*').eq('job_id', jobId).order('sort').order('code'))),
    cached(`finish-schedules:${jobId}`, () => must<FinishSchedule[]>(supabase.from('finish_schedules').select('*').eq('job_id', jobId).order('imported_at', { ascending: false }))),
    loadProgramme(jobId).catch(() => ({ programme: null, tasks: [] as ProgrammeTask[] })),
    loadCompanies().catch(() => [] as Company[]),
  ])
  // heading rows an import took for samples (22 Nov: "FABRIC" above FB-01) are cleared out as the tab opens
  const headings = samples.filter(isHeadingRow)
  if (headings.length && navigator.onLine) {
    const r = await supabase
      .from('samples')
      .delete()
      .in(
        'id',
        headings.map((s) => s.id),
      )
    if (!r.error) samples.splice(0, samples.length, ...samples.filter((s) => !headings.includes(s)))
  }
  // due dates that follow the programme are kept up to date (so the bell's reminders are right too)
  const moved = samples.filter((s) => {
    const d = programmeDue(s, prog.tasks)
    return d && d !== s.due_date
  })
  for (const s of moved) {
    s.due_date = programmeDue(s, prog.tasks)
    await supabase.from('samples').update({ due_date: s.due_date }).eq('id', s.id)
  }
  return { samples, schedules, tasks: prog.tasks, companies }
}

// a sample's columns (only what the scripts run so far have added: 030's are left out until it's run)
const COLS_030 = ['quantity', 'programme_task_code', 'weeks_before', 'photo_path', 'evidence_path', 'evidence_name'] as const
let has030 = true
function row(s: Partial<Sample>) {
  const { id: _id, ...rest } = s as Sample
  void _id
  if (!has030) for (const k of COLS_030) delete (rest as Partial<Sample>)[k]
  return rest
}
async function with030(write: () => Promise<unknown>) {
  try {
    await write()
  } catch (e) {
    if (!has030 || !/quantity|programme_task_code|weeks_before|photo_path|evidence/.test((e as Error).message)) throw e
    has030 = false
    await write()
  }
}
export async function saveSample(s: Sample) {
  if (s.id.startsWith('new'))
    await with030(async () => {
      const r = await supabase.from('samples').insert(row(s)).select('id').single()
      if (r.error) throw new Error(r.error.message.includes('duplicate') ? `There's already a sample ${s.code} on this job.` : r.error.message)
      s.id = r.data.id
    })
  else await with030(() => ok(supabase.from('samples').update(row(s)).eq('id', s.id)))
  return s.id
}
export async function deleteSample(s: Sample) {
  const paths = [s.photo_path, s.evidence_path].filter((p): p is string => !!p)
  if (paths.length) await supabase.storage.from('samples').remove(paths)
  await ok(supabase.from('samples').delete().eq('id', s.id))
}

// ---------- files: photos of approved samples, the designer's approval ----------
// a photo is made smaller on the device first (long side 1600 px), so phone photos upload quickly
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = () => rej(new Error("That file isn't an image the browser can read."))
    i.src = URL.createObjectURL(file)
  })
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
  if (scale === 1 && file.size < 1_500_000) return file
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale)
  c.height = Math.round(img.height * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return new Promise((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', 0.85))
}
export async function uploadSampleFile(s: Sample, kind: 'photo' | 'evidence', file: File) {
  if (s.id.startsWith('new')) throw new Error('Save the sample first, then add the file.')
  const isPhoto = kind === 'photo'
  const body = isPhoto ? await shrink(file) : file
  const ext = isPhoto && body !== file ? 'jpg' : (file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `${s.job_id}/${s.id}/${kind}-${Date.now()}.${ext}`
  const r = await supabase.storage.from('samples').upload(path, body, { contentType: isPhoto && body !== file ? 'image/jpeg' : file.type || undefined, upsert: true })
  if (r.error) throw new Error(/bucket/i.test(r.error.message) ? 'Uploads need script 030 run in Supabase first (supabase/README.md).' : r.error.message)
  const old = isPhoto ? s.photo_path : s.evidence_path
  if (old) await supabase.storage.from('samples').remove([old])
  return path
}
export async function removeSampleFile(path: string) {
  await supabase.storage.from('samples').remove([path])
}
// a short-lived link to view a file (the storage area is private)
const urlCache = new Map<string, { url: string; until: number }>()
export async function fileUrl(path: string) {
  const hit = urlCache.get(path)
  if (hit && hit.until > Date.now()) return hit.url
  const r = await supabase.storage.from('samples').createSignedUrl(path, 3600)
  if (r.error || !r.data) throw new Error(r.error?.message ?? 'File not found')
  urlCache.set(path, { url: r.data.signedUrl, until: Date.now() + 50 * 60 * 1000 })
  return r.data.signedUrl
}

// ---------- the designer's finishes schedule ----------
export interface ScheduleItem {
  code: string
  designer_ref: string | null
  material_group: string
  locations: string[]
  description: string | null
  specification: string | null
  quantity: string | null
  supplier: string | null // from the schedule: its supplier / manufacturer column, else the start of the spec
}
// a new schedule (or revision): what's added, removed and changed against the samples already here
export function compareSchedule(existing: Sample[], items: ScheduleItem[]) {
  const byCode = new Map(existing.map((s) => [s.code.trim().toUpperCase(), s]))
  const codes = new Set(items.map((i) => i.code.trim().toUpperCase()))
  const added: ScheduleItem[] = []
  const changed: { sample: Sample; item: ScheduleItem; what: string[] }[] = []
  for (const it of items) {
    const s = byCode.get(it.code.trim().toUpperCase())
    if (!s) {
      added.push(it)
      continue
    }
    const what: string[] = []
    if ((s.description ?? '') !== (it.description ?? '')) what.push('description')
    if ((s.specification ?? '') !== (it.specification ?? '')) what.push('specification')
    if ([...(s.locations ?? [])].sort().join('|') !== [...it.locations].sort().join('|')) what.push('locations')
    if ((s.quantity ?? '') !== (it.quantity ?? '') && it.quantity) what.push('quantity')
    if (what.length) changed.push({ sample: s, item: it, what })
  }
  // only samples that came from a schedule can drop off it (ones added by hand stay)
  const removed = existing.filter((s) => s.finish_schedule_id && !codes.has(s.code.trim().toUpperCase()))
  return { added, changed, removed }
}
export async function applySchedule(
  jobId: string,
  meta: { designer: string | null; document_no: string | null; revision: string | null; file_name: string },
  existing: Sample[],
  items: ScheduleItem[],
  removedAction: 'keep' | 'omit' | 'delete', // samples no longer on the schedule
  companies: Company[] = [],
) {
  // the schedule's suppliers, matched to the contractor list by name (a new name is added to it)
  const known = [...companies]
  const companyId = async (name: string | null) => {
    if (!name?.trim()) return null
    const n = name.trim().toLowerCase()
    let c = known.find((x) => x.name.trim().toLowerCase() === n)
    if (!c) {
      c = await addCompany(name.trim(), 'supplier', null)
      known.push(c)
    }
    return c.id
  }
  const fields = (it: ScheduleItem) => {
    const { supplier: _s, ...rest } = it
    void _s
    return rest
  }
  const r = await supabase.from('finish_schedules').insert({ job_id: jobId, designer: meta.designer, document_no: meta.document_no, revision: meta.revision }).select('id').single()
  if (r.error) throw new Error(r.error.message)
  const scheduleId = r.data.id
  await supabase.from('finish_schedules').update({ file_name: meta.file_name }).eq('id', scheduleId) // 030's column; harmless before it
  const { added, changed, removed } = compareSchedule(existing, items)
  const start = Math.max(0, ...existing.map((s) => s.sort)) + 1
  if (added.length) {
    const ids = await Promise.all(added.map((it) => companyId(it.supplier)))
    await with030(() =>
      ok(
        supabase.from('samples').insert(
          added.map((it, i) =>
            row({
              job_id: jobId,
              finish_schedule_id: scheduleId,
              ...fields(it),
              supplier_company_id: ids[i],
              sample_type: 'sample',
              status: 'not_requested',
              changed_after_approval: false,
              sort: start + i,
            }),
          ),
        ),
      ),
    )
  }
  for (const c of changed) {
    // its status (and group, if changed by hand) is kept; a change to something already approved is flagged (resample, possible VO);
    // a supplier already chosen is kept too
    const supplier = c.sample.supplier_company_id ? {} : { supplier_company_id: await companyId(c.item.supplier) }
    await with030(() =>
      ok(
        supabase
          .from('samples')
          .update(
            row({
              ...fields(c.item),
              ...supplier,
              material_group: c.sample.material_group,
              finish_schedule_id: scheduleId,
              changed_after_approval: c.sample.changed_after_approval || isApproved(c.sample),
            }),
          )
          .eq('id', c.sample.id),
      ),
    )
  }
  const unchanged = existing.filter((s) => items.some((i) => i.code.trim().toUpperCase() === s.code.trim().toUpperCase()) && !changed.some((c) => c.sample.id === s.id))
  // unchanged samples with no supplier yet take the schedule's
  for (const s of unchanged) {
    if (s.supplier_company_id) continue
    const it = items.find((i) => i.code.trim().toUpperCase() === s.code.trim().toUpperCase())
    const id = await companyId(it?.supplier ?? null)
    if (id) await ok(supabase.from('samples').update({ supplier_company_id: id }).eq('id', s.id))
  }
  if (unchanged.length)
    await ok(
      supabase
        .from('samples')
        .update({ finish_schedule_id: scheduleId })
        .in(
          'id',
          unchanged.map((s) => s.id),
        ),
    )
  // heading rows an earlier import took for samples (e.g. FABRIC): no number, nothing filled in, never touched. Always removed.
  const junk = removed.filter(isHeadingRow)
  for (const s of junk) await deleteSample(s)
  const rest = removed.filter((s) => !junk.includes(s))
  if (removedAction === 'delete') for (const s of rest) await deleteSample(s)
  if (removedAction === 'omit' && rest.length) {
    const r = await supabase
      .from('samples')
      .update({ status: 'omitted' })
      .in(
        'id',
        rest.map((s) => s.id),
      )
    if (r.error)
      throw new Error(/omitted/.test(r.error.message) ? 'The schedule was imported, but marking samples Omitted needs script 031 run in Supabase first.' : r.error.message)
  }
  return { added: added.length, changed: changed.length, removed: removed.length }
}
