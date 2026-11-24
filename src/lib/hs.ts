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

// ---------- inspections ----------
export type Result = 'pass' | 'fail' | 'na'
export interface InspectionItem {
  q: string
  result: Result | null
  note: string
}
export type InspectionResult = 'satisfactory' | 'actions' | 'unsatisfactory'
export const INSPECTION_RESULTS: [InspectionResult, string][] = [
  ['satisfactory', 'Satisfactory'],
  ['actions', 'Satisfactory, with actions'],
  ['unsatisfactory', 'Unsatisfactory'],
]
export interface Inspection {
  id: string
  job_id: string
  inspected_on: string
  kind: string
  area: string | null
  inspector: string | null
  items: InspectionItem[]
  result: InspectionResult
  actions: string | null
  actions_due: string | null
  actions_closed_on: string | null
  notes: string | null
  created_at: string
}
// the standard checklists; "Other" starts empty and takes your own items
export const INSPECTION_TYPES: Record<string, string[]> = {
  'Weekly site inspection': [
    'Site access and escape routes clear',
    'Housekeeping and waste',
    'Work at height controlled (edge protection, ladders, towers, MEWPs)',
    'Scaffold tagged and inspected',
    'Excavations supported and protected',
    'Electrical equipment and temporary supply (110V, PAT)',
    'Plant and lifting equipment certified',
    'PPE worn correctly',
    'Welfare facilities clean and stocked',
    'Fire extinguishers in place and escape routes clear',
    'Hazardous substances stored safely, COSHH assessments to hand',
    'Dust, noise and vibration controlled',
    'Signage and notices displayed (F10, H&S law poster)',
    'First aid kit stocked and a first aider on site',
    'Permits to work in place where needed',
    'Visitors signed in and inducted',
  ],
  'Scaffold inspection': [
    'Base plates and sole boards sound',
    'Standards plumb and braced',
    'Ledgers and transoms in place',
    'Guardrails and toe boards complete',
    'Boards fully decked and secured',
    'Ties adequate',
    'Access ladders secure',
    'Scaffold tag in date',
  ],
  'Fire safety walk': [
    'Escape routes clear',
    'Fire exits unlocked',
    'Extinguishers in place and in date',
    'Fire points signed',
    'Hot works permits in place',
    'Combustible materials stored safely',
    'Alarm tested',
    'Muster point known to everyone',
  ],
  Other: [],
}
export const newItems = (kind: string): InspectionItem[] => (INSPECTION_TYPES[kind] ?? []).map((q) => ({ q, result: null, note: '' }))
export const failCount = (i: Pick<Inspection, 'items'>) => i.items.filter((x) => x.result === 'fail').length
// open actions: something to do and not closed
export const actionsOpen = (i: Pick<Inspection, 'actions' | 'actions_closed_on'>) => !!i.actions?.trim() && !i.actions_closed_on

// ---------- loading and saving ----------
type Table = 'site_diaries' | 'delivery_notes' | 'hs_inspections'
const dateCol: Record<Table, string> = { site_diaries: 'diary_date', delivery_notes: 'delivered_on', hs_inspections: 'inspected_on' }

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
  record_kind: 'diary' | 'delivery' | 'inspection'
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
