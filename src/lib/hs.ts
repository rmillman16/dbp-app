// Job › H&S (24 Nov, script 081): site diaries, delivery notes and H&S inspections, each with photos (storage "hs").
import { supabase } from './supabase'
import { shrinkImage } from './image'

const needs081 = (m: string) => (/relation|schema cache|does not exist/i.test(m) ? 'H&S needs script 081 run in Supabase first (supabase/README.md).' : m)
const fail = (e: { message: string }) => new Error(needs081(e.message))

// ---------- site diaries ----------
export interface LabourLine {
  trade: string
  company: string
  number: number
}
export interface SiteDiary {
  id: string
  job_id: string
  diary_date: string
  weather: string | null
  temperature: string | null
  labour: LabourLine[]
  work_done: string | null
  delays: string | null
  instructions: string | null
  visitors: string | null
  deliveries: string | null
  plant: string | null
  safety: string | null
  notes: string | null
  created_at: string
  updated_at: string
}
export const WEATHER = ['Dry and bright', 'Dry, overcast', 'Showers', 'Rain', 'Heavy rain', 'Snow or ice', 'Windy', 'Fog']

// ---------- delivery notes ----------
export type Condition = 'ok' | 'damaged' | 'short' | 'rejected'
export const CONDITIONS: [Condition, string][] = [
  ['ok', 'Received in good order'],
  ['damaged', 'Damaged'],
  ['short', 'Short delivery'],
  ['rejected', 'Rejected'],
]
export interface DeliveryNote {
  id: string
  job_id: string
  delivered_on: string
  supplier: string
  note_ref: string | null
  order_ref: string | null
  description: string | null
  quantity: string | null
  received_by: string | null
  condition: Condition
  notes: string | null
  created_at: string
}

// ---------- accident and incident reports (script 082) ----------
export type AccidentKind = 'accident' | 'near_miss' | 'dangerous_occurrence' | 'ill_health' | 'damage' | 'environmental'
export const ACCIDENT_KINDS: [AccidentKind, string][] = [
  ['accident', 'Accident (someone injured)'],
  ['near_miss', 'Near miss'],
  ['dangerous_occurrence', 'Dangerous occurrence'],
  ['ill_health', 'Work-related ill health'],
  ['damage', 'Property or plant damage'],
  ['environmental', 'Environmental incident'],
]
export type Severity = 'none' | 'first_aid' | 'medical' | 'lost_time' | 'major' | 'fatal'
export const SEVERITIES: [Severity, string][] = [
  ['none', 'No injury'],
  ['first_aid', 'First aid only'],
  ['medical', 'Medical treatment'],
  ['lost_time', 'Over 7 days off work'],
  ['major', 'Major / specified injury'],
  ['fatal', 'Fatal'],
]
export const PERSON_TYPES: [string, string][] = [
  ['employee', 'DBP employee'],
  ['subcontractor', 'Subcontractor / operative'],
  ['visitor', 'Visitor'],
  ['public', 'Member of the public'],
]
export type Riddor = 'no' | 'check' | 'yes'
export const RIDDOR: [Riddor, string][] = [
  ['no', 'Not reportable'],
  ['check', 'Not sure: check'],
  ['yes', 'Reportable'],
]
export interface AccidentReport {
  id: string
  job_id: string
  number: number
  incident_on: string
  incident_time: string | null
  location: string | null
  kind: AccidentKind
  person_name: string | null
  person_type: string | null
  person_company: string | null
  person_role: string | null
  person_phone: string | null
  severity: Severity
  injury: string | null
  treatment: string | null
  hospital: boolean
  days_lost: number | null
  description: string | null
  witnesses: string | null
  immediate_cause: string | null
  root_cause: string | null
  immediate_action: string | null
  riddor: Riddor
  riddor_ref: string | null
  riddor_on: string | null
  corrective: string | null
  corrective_owner: string | null
  corrective_due: string | null
  corrective_closed_on: string | null
  reported_by: string | null
  investigated_by: string | null
  status: 'open' | 'closed'
  created_at: string
}
export const accidentRef = (n: number) => `A${String(n).padStart(3, '0')}`

// ---------- loading and saving ----------
type Table = 'site_diaries' | 'delivery_notes' | 'hs_inspections' | 'accident_reports'
const dateCol: Record<Table, string> = { site_diaries: 'diary_date', delivery_notes: 'delivered_on', hs_inspections: 'inspected_on', accident_reports: 'incident_on' }

export async function loadRows<T>(table: Table, jobId: string): Promise<T[]> {
  const r = await supabase.from(table).select('*').eq('job_id', jobId).order(dateCol[table], { ascending: false }).order('created_at', { ascending: false })
  if (r.error) throw fail(r.error)
  return r.data as T[]
}
export async function saveRow<T extends { id: string }>(table: Table, jobId: string, id: string | null, values: Record<string, unknown>): Promise<T> {
  const r = id ? await supabase.from(table).update(values).eq('id', id).select('*').single() : await supabase.from(table).insert({ ...values, job_id: jobId }).select('*').single()
  if (r.error) throw fail(r.error)
  return r.data as T
}
export async function deleteRow(table: Table, id: string, kind: HsFile['record_kind']) {
  const files = await supabase.from('hs_files').select('path').eq('record_kind', kind).eq('record_id', id)
  const r = await supabase.from(table).delete().eq('id', id)
  if (r.error) throw fail(r.error)
  const paths = (files.data ?? []).map((f) => f.path as string)
  if (paths.length) {
    await supabase.storage.from('hs').remove(paths)
    await supabase.from('hs_files').delete().eq('record_kind', kind).eq('record_id', id)
  }
}

// ---------- photos ----------
export interface HsFile {
  id: string
  job_id: string
  record_kind: 'diary' | 'delivery' | 'inspection' | 'accident'
  record_id: string
  name: string
  path: string
  created_at: string
}
export async function loadFiles(kind: HsFile['record_kind'], recordId: string): Promise<HsFile[]> {
  const r = await supabase.from('hs_files').select('*').eq('record_kind', kind).eq('record_id', recordId).order('created_at')
  if (r.error) throw fail(r.error)
  return r.data as HsFile[]
}
export async function addFile(jobId: string, kind: HsFile['record_kind'], recordId: string, file: File): Promise<HsFile> {
  const f = file.type.startsWith('image/') ? await shrinkImage(file) : file
  const safe = f.name.replace(/[^\w.\- ()]+/g, '_')
  const path = `${jobId}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${safe}`
  const up = await supabase.storage.from('hs').upload(path, f, { contentType: f.type || undefined })
  if (up.error) throw fail(up.error)
  const r = await supabase.from('hs_files').insert({ job_id: jobId, record_kind: kind, record_id: recordId, name: f.name, path }).select('*').single()
  if (r.error) {
    await supabase.storage.from('hs').remove([path])
    throw fail(r.error)
  }
  return r.data as HsFile
}
export async function removeFile(f: HsFile) {
  const r = await supabase.from('hs_files').delete().eq('id', f.id)
  if (r.error) throw fail(r.error)
  await supabase.storage.from('hs').remove([f.path])
}
export async function fileUrl(path: string) {
  const r = await supabase.storage.from('hs').createSignedUrl(path, 3600)
  if (r.error || !r.data) throw new Error(r.error?.message ?? 'File not found')
  return r.data.signedUrl
}
