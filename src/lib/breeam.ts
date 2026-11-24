// The BREEAM tracker (24 Nov, script 071): one line per issue or credit, each with a status dropdown, like the sampling tracker.
// Lines come from the Excel tracker the assessor or client sends (any layout: the header row is found by its words, as the
// sampling import does), or are added by hand.
import { supabase } from './supabase'

export type BreeamStatus = 'not_complete' | 'in_progress' | 'completed' | 'by_others' | 'no_action'
export const STATUSES: [BreeamStatus, string][] = [
  ['not_complete', 'Not complete'],
  ['in_progress', 'In progress'],
  ['completed', 'Completed'],
  ['by_others', 'By others'],
  ['no_action', 'No action required'],
]
export const statusLabel = (s: string) => STATUSES.find(([k]) => k === s)?.[1] ?? s

export interface BreeamItem {
  id: string
  job_id: string
  ref: string | null
  category: string | null
  title: string
  credits_available: number | null
  credits_targeted: number | null
  responsible: string | null
  status: BreeamStatus
  due_date: string | null
  evidence_link: string | null
  comments: string | null
  sort: number
}

const needs071 = (m: string) => (/relation|schema cache|does not exist/i.test(m) ? 'The BREEAM tracker needs script 071 run in Supabase first (supabase/README.md).' : m)
export async function loadBreeam(jobId: string) {
  const r = await supabase.from('breeam_items').select('*').eq('job_id', jobId).order('sort').order('created_at')
  if (r.error) throw new Error(needs071(r.error.message))
  return r.data as BreeamItem[]
}
export async function updateItem(id: string, patch: Partial<BreeamItem>) {
  const r = await supabase.from('breeam_items').update(patch).eq('id', id)
  if (r.error) throw new Error(needs071(r.error.message))
}
export async function addItems(jobId: string, rows: Omit<BreeamItem, 'id' | 'job_id'>[]) {
  for (let i = 0; i < rows.length; i += 200) {
    const r = await supabase.from('breeam_items').insert(rows.slice(i, i + 200).map((x) => ({ ...x, job_id: jobId })))
    if (r.error) throw new Error(needs071(r.error.message))
  }
}
export async function deleteItem(id: string) {
  const r = await supabase.from('breeam_items').delete().eq('id', id)
  if (r.error) throw new Error(r.error.message)
}

// ---------- reading a tracker from Excel ----------
const CATEGORY_BY_PREFIX: Record<string, string> = {
  man: 'Management',
  hea: 'Health and wellbeing',
  ene: 'Energy',
  tra: 'Transport',
  wat: 'Water',
  mat: 'Materials',
  wst: 'Waste',
  was: 'Waste',
  le: 'Land use and ecology',
  lue: 'Land use and ecology',
  pol: 'Pollution',
  inn: 'Innovation',
}
export const categoryOfRef = (ref: string) => CATEGORY_BY_PREFIX[ref.trim().toLowerCase().replace(/[^a-z].*$/, '')] ?? ''

type Field = 'ref' | 'category' | 'title' | 'available' | 'targeted' | 'responsible' | 'status' | 'due' | 'link' | 'comments'
const TESTS: [Field, RegExp][] = [
  ['available', /\b(credits? (available|avail)|available|max(imum)?( credits)?|credits? max)\b/i],
  ['targeted', /\b(target(ed)?|credits? (targeted|sought|aimed)|aim)\b/i],
  ['status', /\b(status|progress|state)\b/i],
  ['responsible', /\b(responsib\w*|owner|by whom|who|lead|action by|assigned|party)\b/i],
  ['due', /\b(due|date|deadline|target date)\b/i],
  ['link', /\b(evidence|link|document|file|ref doc)\b/i],
  ['comments', /\b(comments?|notes?|remarks?|action|update)\b/i],
  ['category', /\b(category|section|issue group|group)\b/i],
  ['ref', /\b(ref(erence)?\.?|issue (no|number|id)|credit (no|number|ref|id)|id|code|no\.?)\b/i],
  ['title', /\b(title|description|issue|credit|criteria|requirement|name|item)\b/i],
]
const txt = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
function header(rows: unknown[][]) {
  let best = -1
  let bestScore = 0
  rows.slice(0, 40).forEach((r, i) => {
    const score = new Set(r.flatMap((c) => TESTS.filter(([, re]) => re.test(txt(c))).map(([f]) => f))).size
    if (score > bestScore) ((best = i), (bestScore = score))
  })
  return bestScore >= 2 ? best : -1
}
export function statusFromText(t: string): BreeamStatus {
  const s = t.toLowerCase()
  if (!s) return 'not_complete'
  if (/other|third|client|landlord|base ?build/.test(s)) return 'by_others'
  if (/no action|n\/?a\b|not applicable|not required|not targeted|none required|out of scope/.test(s)) return 'no_action'
  if (/not (yet )?(complete|started|done|achieved)|outstanding|open|todo|to do|not started/.test(s)) return 'not_complete'
  if (/complete|achieved|done|closed|signed off|approved|agreed|received|submitted/.test(s)) return 'completed'
  if (/progress|ongoing|partial|underway|started|draft|pending|review|chasing/.test(s)) return 'in_progress'
  return 'not_complete'
}
const num = (v: unknown) => {
  const n = parseFloat(txt(v).replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}
const isoDate = (v: unknown) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(txt(v))
  return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}

// every sheet is tried; the one that yields the most lines is used. A row naming only a heading (nothing else filled in) sets the
// category for the lines under it.
export function readTracker(sheets: { name: string; rows: unknown[][] }[]): { items: Omit<BreeamItem, 'id' | 'job_id'>[]; sheet: string } {
  let best: { items: Omit<BreeamItem, 'id' | 'job_id'>[]; sheet: string } = { items: [], sheet: '' }
  for (const sh of sheets) {
    const h = header(sh.rows)
    if (h < 0) continue
    const cols: Partial<Record<Field, number>> = {}
    const used = new Set<number>()
    for (const [f, re] of TESTS) sh.rows[h].forEach((c, i) => cols[f] === undefined && !used.has(i) && re.test(txt(c)) && ((cols[f] = i), used.add(i)))
    // no title column but a ref one: the ref column also holds the wording ("Man 01 Project brief")
    const get = (r: unknown[], f: Field) => (cols[f] === undefined ? '' : txt(r[cols[f]!]))
    const items: Omit<BreeamItem, 'id' | 'job_id'>[] = []
    let heading = ''
    for (const r of sh.rows.slice(h + 1)) {
      const cells = r.map(txt).filter(Boolean)
      if (!cells.length) continue
      if (cells.length === 1 && cells[0].length < 60) {
        heading = cells[0]
        continue
      }
      let ref = get(r, 'ref')
      let title = get(r, 'title')
      if (!title && ref.length > 12) [ref, title] = [(/^[A-Za-z]{2,4}\s?\d{1,2}\b/.exec(ref)?.[0] ?? ''), ref.replace(/^[A-Za-z]{2,4}\s?\d{1,2}\b[\s:.-]*/, '')]
      if (!title) continue
      const targeted = num(r[cols.targeted ?? -1])
      items.push({
        ref: ref || null,
        category: get(r, 'category') || heading || categoryOfRef(ref) || null,
        title,
        credits_available: num(r[cols.available ?? -1]),
        credits_targeted: targeted,
        responsible: get(r, 'responsible') || null,
        status: statusFromText(get(r, 'status')),
        due_date: isoDate(r[cols.due ?? -1]),
        evidence_link: /^https?:/i.test(get(r, 'link')) ? get(r, 'link') : null,
        comments: [get(r, 'comments'), /^https?:/i.test(get(r, 'link')) ? '' : get(r, 'link')].filter(Boolean).join(' · ') || null,
        sort: items.length,
      })
    }
    if (items.length > best.items.length) best = { items, sheet: sh.name }
  }
  return best
}
