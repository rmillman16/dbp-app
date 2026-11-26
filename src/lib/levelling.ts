import { supabase } from './supabase'

// Tender levelling (script 094): a package's scope is a list of items; each contractor's return is levelled against it.
// Per item a contractor either INCLUDES it in their price or EXCLUDES it (the estimator then allows a plug £ and says why);
// items they add below the line are listed per contractor (negative = a deduction).
// Levelled total = their price + plugs for excluded items + below-the-line items.

export type ScopeKind = 'heading' | 'item'
export interface ScopeItem {
  id: string
  package_id: string
  sort: number
  kind: ScopeKind
  description: string
}
export type CellStatus = 'tbc' | 'included' | 'excluded'
export interface LevelCell {
  id: string
  invite_id: string
  item_id: string
  status: CellStatus
  their_amount: number | null
  plug_amount: number | null
  note: string | null
}
export interface LevelExtra {
  id: string
  invite_id: string
  description: string
  amount: number
  note: string | null
}
export interface ActivityRow {
  id: string
  at: string
  by_user: string | null
  action: string
  detail: string
}

const NEEDS_094 = 'Levelling needs script 094 (supabase/094_tender_levelling.sql) to be run first.'
function fail(e: { message: string }): Error {
  return new Error(/tender_(scope_items|level_cells|level_extras|activity)|schema cache|does not exist/i.test(e.message) ? NEEDS_094 : e.message)
}
const num = (v: number | string | null | undefined) => (v == null || v === '' ? 0 : Number(v))
const pence = (n: number) => Math.round(n * 100) / 100

// ---------- numbering and the scope as text ----------
// "1 Heading", "1.1 Item"; items before any heading are 1, 2, 3
export function numberItems(items: Pick<ScopeItem, 'kind' | 'description'>[]): string[] {
  const hasHeading = items.some((i) => i.kind === 'heading')
  let h = 0
  let n = 0
  return items.map((i) => {
    if (i.kind === 'heading') {
      h++
      n = 0
      return String(h)
    }
    n++
    return hasHeading && h > 0 ? `${h}.${n}` : String(n)
  })
}
// the list as it goes in the email and the PDF
export function scopeText(items: Pick<ScopeItem, 'kind' | 'description'>[]): string {
  const refs = numberItems(items)
  return items
    .filter((i) => i.description.trim())
    .map((i, k) => (i.kind === 'heading' ? `${k ? '\n' : ''}${refs[items.indexOf(i)]}. ${i.description.trim().toUpperCase()}` : `${refs[items.indexOf(i)]}  ${i.description.trim()}`))
    .join('\n')
}
// a pasted block of lines becomes items; a line starting with # (or ending with a colon) is a heading; an existing "1.1" or "- " is stripped
export function parseScope(text: string): { kind: ScopeKind; description: string }[] {
  const out: { kind: ScopeKind; description: string }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const head = /^#+\s*(.+)$/.exec(line)
    if (head) {
      out.push({ kind: 'heading', description: head[1].trim() })
      continue
    }
    const clean = line.replace(/^(\d+(\.\d+)*[.)]?\s+|[-•*]\s+)/, '').trim()
    if (!clean) continue
    if (/:$/.test(clean)) out.push({ kind: 'heading', description: clean.replace(/:$/, '').trim() })
    else out.push({ kind: 'item', description: clean })
  }
  return out
}

// ---------- the sums ----------
export interface Levelled {
  quoted: number // what they quoted (their price; failing that the sum of their item prices)
  itemPrices: number // the sum of their item prices, for comparison with the quote
  plugs: number // allowed for the excluded items
  extras: number // below the line
  total: number // the levelled total
  excluded: number
  checked: number // items looked at (included or excluded)
  items: number
}
export function levelTotals(items: ScopeItem[], cells: LevelCell[], extras: LevelExtra[], quote: number | string | null): Levelled {
  const real = items.filter((i) => i.kind === 'item')
  const ids = new Set(real.map((i) => i.id))
  const mine = cells.filter((c) => ids.has(c.item_id))
  const itemPrices = pence(mine.reduce((s, c) => s + num(c.their_amount), 0))
  const quoted = quote == null || quote === '' ? itemPrices : num(quote)
  const plugs = pence(mine.filter((c) => c.status === 'excluded').reduce((s, c) => s + num(c.plug_amount), 0))
  const ex = pence(extras.reduce((s, x) => s + num(x.amount), 0))
  return {
    quoted,
    itemPrices,
    plugs,
    extras: ex,
    total: pence(quoted + plugs + ex),
    excluded: mine.filter((c) => c.status === 'excluded').length,
    checked: mine.filter((c) => c.status !== 'tbc').length,
    items: real.length,
  }
}

// ---------- the database ----------
export async function loadScope(packageIds: string[]): Promise<ScopeItem[]> {
  if (!packageIds.length) return []
  const r = await supabase.from('tender_scope_items').select('*').in('package_id', packageIds).order('sort')
  if (r.error) throw fail(r.error)
  return r.data as ScopeItem[]
}
export async function loadLevelling(inviteIds: string[]) {
  if (!inviteIds.length) return { cells: [] as LevelCell[], extras: [] as LevelExtra[] }
  const [c, x] = await Promise.all([supabase.from('tender_level_cells').select('*').in('invite_id', inviteIds), supabase.from('tender_level_extras').select('*').in('invite_id', inviteIds).order('updated_at')])
  if (c.error) throw fail(c.error)
  if (x.error) throw fail(x.error)
  return { cells: c.data as LevelCell[], extras: x.data as LevelExtra[] }
}
export async function addScopeItems(packageId: string, list: { kind: ScopeKind; description: string }[], startAt = 0) {
  if (!list.length) return
  const r = await supabase.from('tender_scope_items').insert(list.map((x, i) => ({ package_id: packageId, sort: startAt + i, kind: x.kind, description: x.description })))
  if (r.error) throw fail(r.error)
}
export async function updateScopeItem(id: string, patch: Partial<Pick<ScopeItem, 'description' | 'kind' | 'sort'>>) {
  const r = await supabase.from('tender_scope_items').update(patch).eq('id', id)
  if (r.error) throw fail(r.error)
}
export async function deleteScopeItem(id: string) {
  const r = await supabase.from('tender_scope_items').delete().eq('id', id)
  if (r.error) throw fail(r.error)
}
// keeps tender_packages.scope (the text that goes in the email) in step with the list
export async function syncScopeText(packageId: string) {
  const items = await loadScope([packageId])
  const r = await supabase.from('tender_packages').update({ scope: scopeText(items) || null }).eq('id', packageId)
  if (r.error) throw fail(r.error)
}
export async function saveCell(invite_id: string, item_id: string, patch: Partial<Pick<LevelCell, 'status' | 'their_amount' | 'plug_amount' | 'note'>>) {
  const r = await supabase.from('tender_level_cells').upsert({ invite_id, item_id, ...patch }, { onConflict: 'invite_id,item_id' })
  if (r.error) throw fail(r.error)
}
export async function addExtra(invite_id: string, description: string, amount: number, note: string | null) {
  const r = await supabase.from('tender_level_extras').insert({ invite_id, description, amount, note })
  if (r.error) throw fail(r.error)
}
export async function updateExtra(id: string, patch: Partial<Pick<LevelExtra, 'description' | 'amount' | 'note'>>) {
  const r = await supabase.from('tender_level_extras').update(patch).eq('id', id)
  if (r.error) throw fail(r.error)
}
export async function deleteExtra(id: string) {
  const r = await supabase.from('tender_level_extras').delete().eq('id', id)
  if (r.error) throw fail(r.error)
}
export async function loadActivity(packageId: string): Promise<(ActivityRow & { who: string })[]> {
  const r = await supabase.from('tender_activity').select('*').eq('package_id', packageId).order('at', { ascending: false }).limit(200)
  if (r.error) throw fail(r.error)
  const rows = r.data as ActivityRow[]
  const ids = [...new Set(rows.map((x) => x.by_user).filter(Boolean) as string[])]
  const names = new Map<string, string>()
  if (ids.length) {
    const p = await supabase.from('profiles').select('id, full_name').in('id', ids)
    for (const x of (p.data ?? []) as { id: string; full_name: string | null }[]) names.set(x.id, x.full_name ?? 'Someone')
  }
  return rows.map((x) => ({ ...x, who: x.by_user ? names.get(x.by_user) ?? 'Someone' : 'System' }))
}
