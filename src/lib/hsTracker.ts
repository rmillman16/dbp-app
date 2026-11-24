// Job › H&S › Inspections (24 Nov, script 083): a tracker for the inspections other parties do (scaffolders, lifting-equipment examiners,
// fire alarm engineers, the H&S consultant's audits...). Each has how often it is due; each report that comes in is logged with its date
// and the report itself; the next falls due the frequency after the last, and the PMs are reminded (and chased when overdue) by the
// database and the send-emails function. Reports are kept in the app (storage "hs") and filed into the job's synced SharePoint H&S folder.
import { supabase } from './supabase'
import { shrinkImage } from './image'
import { clean, writeInto } from './orderFolder'

const needs083 = (m: string) => (/relation|schema cache|does not exist/i.test(m) ? 'The inspection tracker needs script 083 run in Supabase first (supabase/README.md).' : m)
const fail = (e: { message: string }) => new Error(needs083(e.message))

export type Outcome = 'satisfactory' | 'actions' | 'unsatisfactory'
export const OUTCOMES: [Outcome, string][] = [
  ['satisfactory', 'Satisfactory'],
  ['actions', 'Satisfactory, with actions'],
  ['unsatisfactory', 'Unsatisfactory'],
]
export interface Tracker {
  id: string
  job_id: string
  name: string
  by_party: string | null
  frequency_days: number | null
  first_due: string
  remind_days: number
  owner_id: string | null
  active: boolean
  notes: string | null
  created_at: string
}
export interface Report {
  id: string
  tracker_id: string
  job_id: string
  inspected_on: string
  inspector: string | null // who did the inspection (script 084)
  outcome: Outcome
  note: string | null
  path: string | null
  file_name: string | null
  filed_to: string | null
  created_at: string
}
export const FREQUENCIES: [number | null, string][] = [
  [null, 'One-off'],
  [7, 'Weekly'],
  [14, 'Fortnightly'],
  [28, 'Every 4 weeks'],
  [91, 'Every 3 months'],
  [182, 'Every 6 months'],
  [365, 'Every year'],
]
export const freqLabel = (d: number | null) => FREQUENCIES.find(([k]) => k === d)?.[1] ?? (d ? `Every ${d} days` : 'One-off')
// common ones, to pick from when adding
export const SUGGESTIONS: { name: string; days: number | null; by: string }[] = [
  { name: 'Scaffold inspection', days: 7, by: 'Scaffolding contractor' },
  { name: 'Lifting equipment thorough examination (LOLER)', days: 182, by: 'Competent person / insurer' },
  { name: 'Fire alarm and emergency lighting test', days: 7, by: 'Fire alarm engineer' },
  { name: 'Temporary electrics and portable equipment test', days: 91, by: 'Electrician' },
  { name: 'Third-party H&S audit', days: 28, by: 'H&S consultant' },
  { name: 'Excavation inspection', days: 7, by: 'Groundworker' },
  { name: 'MEWP / plant inspection', days: 7, by: 'Hire company' },
  { name: 'Water hygiene (legionella) check', days: 28, by: 'Water hygiene contractor' },
  { name: 'Asbestos survey review', days: null, by: 'Asbestos surveyor' },
]

const add = (iso: string, days: number) => {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
export const todayIso = () => new Date().toISOString().slice(0, 10)

// the next one due: the frequency after the latest report, else its first due date; a one-off is done once it has a report
export function nextDue(t: Tracker, reports: Report[]): string | null {
  const last = reports.reduce<string | null>((m, r) => (!m || r.inspected_on > m ? r.inspected_on : m), null)
  if (t.frequency_days == null) return last ? null : t.first_due
  return last ? add(last, t.frequency_days) : t.first_due
}
export type State = 'overdue' | 'soon' | 'ok' | 'done' | 'paused'
export function stateOf(t: Tracker, reports: Report[], today = todayIso()): State {
  if (!t.active) return 'paused'
  const due = nextDue(t, reports)
  if (!due) return 'done'
  if (due < today) return 'overdue'
  return due <= add(today, t.remind_days) ? 'soon' : 'ok'
}
export const STATE_LABEL: Record<State, string> = { overdue: 'Overdue', soon: 'Due soon', ok: 'On track', done: 'Done', paused: 'Paused' }

// ---------- loading and saving ----------
export async function loadTrackers(jobId: string) {
  const [t, r] = await Promise.all([
    supabase.from('hs_trackers').select('*').eq('job_id', jobId).order('name'),
    supabase.from('hs_reports').select('*').eq('job_id', jobId).order('inspected_on', { ascending: false }),
  ])
  if (t.error) throw fail(t.error)
  if (r.error) throw fail(r.error)
  return { trackers: t.data as Tracker[], reports: r.data as Report[] }
}
export async function saveTracker(jobId: string, id: string | null, values: Partial<Omit<Tracker, 'id' | 'job_id' | 'created_at'>>) {
  const r = id ? await supabase.from('hs_trackers').update(values).eq('id', id).select('*').single() : await supabase.from('hs_trackers').insert({ ...values, job_id: jobId }).select('*').single()
  if (r.error) throw fail(r.error)
  return r.data as Tracker
}
export async function deleteTracker(t: Tracker, reports: Report[]) {
  const paths = reports.filter((r) => r.path).map((r) => r.path as string)
  const r = await supabase.from('hs_trackers').delete().eq('id', t.id)
  if (r.error) throw fail(r.error)
  if (paths.length) await supabase.storage.from('hs').remove(paths)
}

// Logs a report that has come in: the file goes into the app's storage and, when the job's synced SharePoint folder is linked (root),
// into SharePoint too, in "<Inspection name>/<date> <file name>".
export async function logReport(jobId: string, t: Tracker, v: { inspected_on: string; inspector: string }, file: File | null, root: FileSystemDirectoryHandle | null): Promise<Report> {
  let path: string | null = null
  let filedTo: string | null = null
  let name: string | null = null
  if (file) {
    const f = file.type.startsWith('image/') ? await shrinkImage(file) : file
    name = f.name
    path = `${jobId}/reports/${t.id}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${f.name.replace(/[^\w.\- ()]+/g, '_')}`
    const up = await supabase.storage.from('hs').upload(path, f, { contentType: f.type || undefined })
    if (up.error) throw fail(up.error)
    if (root) {
      try {
        filedTo = await writeInto(root, [...(/health|h\s?&\s?s|safety/i.test(root.name) ? [] : ['Health and Safety']), clean(t.name)], `${v.inspected_on} ${f.name}`, f)
      } catch (e) {
        // the report is safe in the app; say the filing failed rather than losing it
        filedTo = null
        console.warn('SharePoint filing failed:', e instanceof Error ? e.message : e)
      }
    }
  }
  const r = await supabase.from('hs_reports').insert({ tracker_id: t.id, job_id: jobId, inspected_on: v.inspected_on, inspector: v.inspector.trim() || null, path, file_name: name, filed_to: filedTo }).select('*').single()
  if (r.error) {
    if (path) await supabase.storage.from('hs').remove([path])
    throw fail(r.error)
  }
  return r.data as Report
}
export async function deleteReport(rep: Report) {
  const r = await supabase.from('hs_reports').delete().eq('id', rep.id)
  if (r.error) throw fail(r.error)
  if (rep.path) await supabase.storage.from('hs').remove([rep.path])
}
export async function reportUrl(path: string) {
  const r = await supabase.storage.from('hs').createSignedUrl(path, 3600)
  if (r.error || !r.data) throw new Error(r.error?.message ?? 'File not found')
  return r.data.signedUrl
}
