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
  credits_achieved: number | null
  criteria: string | null
  evidence: string | null
  prerequisite: boolean
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

type Field = 'ref' | 'category' | 'title' | 'available' | 'targeted' | 'achieved' | 'criteria' | 'evidence' | 'responsible' | 'status' | 'due' | 'comments'
const TESTS: [Field, RegExp][] = [
  ['available', /credits? (available|avail)|\bavailable\b|\bmax(imum)?\b/i],
  ['due', /\b(due|deadline|target date|date)\b/i],
  ['targeted', /target/i],
  ['achieved', /achiev|awarded/i],
  ['status', /\b(status|progress|state)\b/i],
  ['criteria', /criteri|requirement/i],
  ['evidence', /evidence|\blink\b|document/i],
  ['responsible', /responsib|\bowner\b|by whom|\bwho\b|\blead\b|\baction\b|assigned|party/i],
  ['comments', /comments?|notes?|remarks?|update/i],
  ['category', /\b(category|section|issue group|group)\b/i],
  ['ref', /\b(ref(erence)?\.?|issue (no|number|id)|credit (no|number|ref|id)|id|code|no\.?)\b/i],
  ['title', /\b(title|description|issue|credit|name|item)\b/i],
]
const txt = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const REF = /^[A-Za-z]{2,4}\s?\d{1,2}\b/
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
// no status column (the usual BREEAM tracker has credits achieved against credits targeted instead): worked out from those
function statusFromCredits(available: string, targeted: string, achieved: string): BreeamStatus {
  if (/^n\/?a$/i.test(targeted) || /^n\/?a$/i.test(available)) return 'no_action'
  if (/^p$/i.test(achieved)) return 'completed'
  const t = num(targeted) ?? 0
  const a = num(achieved) ?? 0
  if (t <= 0) return 'no_action'
  if (a >= t) return 'completed'
  return a > 0 ? 'in_progress' : 'not_complete'
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

type Read = Omit<BreeamItem, 'id' | 'job_id'>
// Every sheet is tried; the one that yields the most lines is used (so a Cover or Score Overview sheet is skipped). Heading rows
// (merged cells repeating one word across the row, e.g. "Management") set the category for the lines under them; "... Totals:" rows
// are skipped. When the ref and credit-name columns have no heading (as in the usual tracker) they are found from the data.
export function readTracker(sheets: { name: string; rows: unknown[][] }[]): { items: Read[]; sheet: string } {
  let best: { items: Read[]; sheet: string } = { items: [], sheet: '' }
  for (const sh of sheets) {
    const h = header(sh.rows)
    if (h < 0) continue
    const cols: Partial<Record<Field, number>> = {}
    const used = new Set<number>()
    for (const [f, re] of TESTS) sh.rows[h].forEach((c, i) => cols[f] === undefined && !used.has(i) && re.test(txt(c)) && ((cols[f] = i), used.add(i)))
    const body = sh.rows.slice(h + 1)
    if (cols.ref === undefined) {
      const width = Math.max(...body.slice(0, 200).map((r) => r.length), 0)
      let bestCol = -1
      let bestHits = 2
      for (let c = 0; c < width; c++) {
        if (used.has(c)) continue
        const hits = body.filter((r) => REF.test(txt(r[c]))).length
        if (hits > bestHits) ((bestCol = c), (bestHits = hits))
      }
      if (bestCol >= 0) ((cols.ref = bestCol), used.add(bestCol))
    }
    if (cols.title === undefined && cols.ref !== undefined && !used.has(cols.ref + 1)) ((cols.title = cols.ref + 1), used.add(cols.ref + 1))
    const raw = (r: unknown[], f: Field) => (cols[f] === undefined ? '' : txt(r[cols[f]!]))
    const items: Read[] = []
    let heading = ''
    for (const r of body) {
      const cells = r.map(txt).filter(Boolean)
      if (!cells.length) continue
      if (new Set(cells).size === 1) {
        if (!/totals?:?$/i.test(cells[0])) heading = cells[0].replace(/\s+/g, ' ')
        continue
      }
      if (/totals?:?\s*$/i.test(txt(r[cols.ref ?? 0]))) continue
      let ref = raw(r, 'ref')
      let title = raw(r, 'title')
      if (!title && ref.length > 12) [ref, title] = [REF.exec(ref)?.[0] ?? '', ref.replace(/^[A-Za-z]{2,4}\s?\d{1,2}\b[\s:.-]*/, '')]
      if (!title) continue
      const [avail, targ, ach] = [raw(r, 'available'), raw(r, 'targeted'), raw(r, 'achieved')]
      const prereq = [avail, targ, ach].some((x) => /^p$/i.test(x))
      const link = raw(r, 'evidence')
      items.push({
        ref: ref || null,
        category: raw(r, 'category') || heading || categoryOfRef(ref) || null,
        title,
        credits_available: num(avail),
        credits_targeted: num(targ),
        credits_achieved: num(ach),
        criteria: raw(r, 'criteria') || null,
        evidence: link || null,
        prerequisite: prereq,
        responsible: raw(r, 'responsible') || null,
        status: cols.status !== undefined ? statusFromText(raw(r, 'status')) : statusFromCredits(avail, targ, ach),
        due_date: isoDate(r[cols.due ?? -1]),
        evidence_link: /^https?:/i.test(link) ? link : null,
        comments: raw(r, 'comments') || null,
        sort: items.length,
      })
    }
    if (items.length > best.items.length) best = { items, sheet: sh.name }
  }
  return best
}

// ---------- the score overview ----------
// One credit can run over several rows (Tra 02's eleven options all carry the same 10 / 10 / 5), so a credit is counted once: by
// category, ref and name. Credits achieved is the figure on the line; if none was typed, a line marked Completed counts as achieved.
export const lineKey = (i: Pick<BreeamItem, 'category' | 'ref' | 'title'>) => `${i.category ?? ''}|${i.ref ?? ''}|${i.title}`.toLowerCase()
export interface Score {
  category: string
  available: number
  targeted: number
  achieved: number
  lines: number
  done: number
  prereqs: number
  prereqsMet: number
}
export function scoreOverview(items: BreeamItem[]): { rows: Score[]; total: Score } {
  const seen = new Map<string, BreeamItem[]>()
  for (const i of items) seen.set(lineKey(i), [...(seen.get(lineKey(i)) ?? []), i])
  const blank = (category: string): Score => ({ category, available: 0, targeted: 0, achieved: 0, lines: 0, done: 0, prereqs: 0, prereqsMet: 0 })
  const by = new Map<string, Score>()
  for (const i of items) by.has(i.category || 'Other') || by.set(i.category || 'Other', blank(i.category || 'Other'))
  for (const [, group] of seen) {
    const i = group[0]
    const s = by.get(i.category || 'Other')!
    s.lines += 1
    if (group.every((g) => g.status === 'completed' || g.status === 'no_action' || g.status === 'by_others')) s.done += 1
    if (i.prerequisite) {
      s.prereqs += 1
      if (group.some((g) => g.status === 'completed')) s.prereqsMet += 1
    }
    const targeted = i.status === 'no_action' ? 0 : (i.credits_targeted ?? 0)
    s.available += i.credits_available ?? 0
    s.targeted += i.credits_targeted ?? 0
    const typed = Math.max(...group.map((g) => g.credits_achieved ?? 0))
    s.achieved += typed > 0 ? typed : group.some((g) => g.status === 'completed') ? targeted : 0
  }
  const rows = [...by.values()]
  const total = rows.reduce((t, r) => ({ ...t, available: t.available + (/^innovation/i.test(r.category) ? 0 : r.available), targeted: t.targeted + r.targeted, achieved: t.achieved + r.achieved, lines: t.lines + r.lines, done: t.done + r.done, prereqs: t.prereqs + r.prereqs, prereqsMet: t.prereqsMet + r.prereqsMet }), blank('Total'))
  return { rows, total }
}