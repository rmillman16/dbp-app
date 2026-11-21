// The procurement schedule's packages (docs/decisions.md "Procurement: built"). Kept free of the
// database so it can be tested on its own.
// - Each office SoW line's cost, by the package column it's priced in. The specific columns
//   (Joinery, Metalwork, Electrical…) are their package; the general ones (Subbie, Subbie Prelims,
//   Labour, Materials) are read line by line from the description, as the cashflow does ("not
//   just from the pricing elements… read the line items", Richard, 21 Nov).
// - Any line can be moved to another package, or its £ split across packages (a bar: mirrors,
//   joinery, metalwork, install), kept per job. What a split doesn't give follows the SoW's own.
// - Budgets are cost (the office SoW's package columns), to compare with the order values.
// - Latest order date = required on site − lead time − design / approval weeks; red when it has
//   passed without an order, amber within 2 weeks.
import { suggestLineTrade } from './cashflowCalc'

export interface ProcLine {
  key: string // the SoW item number (or its description), stable across re-imports
  ref: string | null
  description: string
  section: string // the SoW section it's in
  value: number // its cost
  parts: Record<string, number> // the SoW's own split: package → £
  alloc: Record<string, number> // after any move / split
  split: boolean // moved or split by hand
}
export interface SplitRow {
  line_key: string
  package: string
  amount: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
// columns priced for more than one trade, read line by line
export const isGeneral = (column: string) => /^subbie\b|^(dub\s+)?labour$|^(dub\s+)?materials$/i.test(column.trim())

export function procurementLines(
  packages: { name: string; kind: string }[],
  lines: { kind: string; ref?: string | null; description?: string; amounts: Record<string, number> }[],
  splits: SplitRow[],
): ProcLine[] {
  // margin (OH&P, DuB management / design) and EP (DBP's contingency) aren't ordered
  const omitted = new Set(packages.filter((p) => p.kind === 'omit' || p.kind === 'ep').map((p) => p.name))
  const isMargin = (n: string) => omitted.has(n) || /^(oh&p|ohp|overh)/i.test(n) || /^ep$/i.test(n.trim())
  // the job's own trades: the specific columns
  const specific = [...new Set(lines.flatMap((l) => Object.keys(l.amounts ?? {})))].filter((n) => !isMargin(n) && !isGeneral(n))

  // an item and the lines under it are one SoW line; sections head them
  const items: { ref: string | null; description: string; section: string; amounts: Record<string, number> }[] = []
  let section = ''
  let cur: (typeof items)[number] | null = null
  for (const l of lines) {
    if (l.kind === 'section') {
      section = l.description ?? ''
      cur = null
      continue
    }
    if (l.kind === 'item' || !cur) items.push((cur = { ref: l.ref ?? null, description: l.description ?? '', section, amounts: {} }))
    for (const [n, v] of Object.entries(l.amounts ?? {})) if (!isMargin(n)) cur.amounts[n] = (cur.amounts[n] ?? 0) + Number(v)
  }

  const byLine = new Map<string, SplitRow[]>()
  for (const s of splits) byLine.set(s.line_key, [...(byLine.get(s.line_key) ?? []), s])
  const out: ProcLine[] = []
  for (const it of items) {
    const parts: Record<string, number> = {}
    for (const [col, v] of Object.entries(it.amounts)) {
      if (!v) continue
      // "Subbie – 4 Basement 2 based on GPAD": the section part, when it's a trade, helps
      const pkg = isGeneral(col) ? (suggestLineTrade(it.description, specific, col.replace(/^subbie\s*[–-]?\s*\d*\s*/i, '') || it.section) ?? col) : col
      parts[pkg] = r2((parts[pkg] ?? 0) + v)
    }
    const value = r2(Object.values(parts).reduce((s, v) => s + v, 0))
    if (Math.abs(value) < 0.005) continue
    const key = it.ref || it.description
    // a move / split: its amounts, and what's left follows the SoW's own split
    const mine = byLine.get(key) ?? []
    let alloc = parts
    if (mine.length) {
      alloc = {}
      for (const s of mine) alloc[s.package] = r2((alloc[s.package] ?? 0) + Number(s.amount))
      const left = r2(value - mine.reduce((s, x) => s + Number(x.amount), 0))
      if (Math.abs(left) >= 0.005) for (const [p, v] of Object.entries(parts)) alloc[p] = r2((alloc[p] ?? 0) + (left * v) / value)
    }
    out.push({ key, ref: it.ref, description: it.description, section: it.section, value, parts, alloc, split: mine.length > 0 })
  }
  return out
}

// each package's budget, from the lines as allocated
export function packageBudgets(lines: ProcLine[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of lines) for (const [p, v] of Object.entries(l.alloc)) out.set(p, r2((out.get(p) ?? 0) + v))
  return out
}

export type ProcStatus = 'not_started' | 'enquiry_out' | 'quotes_in' | 'recommended' | 'ordered' | 'on_site' | 'complete' | 'covered' | 'nothing_to_order'
export const STATUS_LABELS: Record<ProcStatus, string> = {
  not_started: 'Not started',
  enquiry_out: 'Enquiry out',
  quotes_in: 'Quotes in',
  recommended: 'Recommended',
  ordered: 'Ordered',
  on_site: 'On site',
  complete: 'Complete',
  covered: 'Covered by an existing order',
  nothing_to_order: 'Nothing to order',
}
const PLACED: ProcStatus[] = ['ordered', 'on_site', 'complete', 'covered', 'nothing_to_order']

// required on site: a typed date, else the start of the earliest linked activity
export function onSiteDate(typed: string | null, codes: string[], tasks: { code: string; start_date: string }[]) {
  if (typed) return typed
  const starts = codes.map((c) => tasks.find((t) => t.code === c)?.start_date).filter((d): d is string => !!d)
  return starts.sort()[0] ?? null
}
export function latestOrderDate(onSite: string | null, leadWeeks: number | null, designWeeks: number | null) {
  if (!onSite) return null
  const d = new Date(`${onSite}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - Math.round((Number(leadWeeks ?? 0) + Number(designWeeks ?? 0)) * 7))
  return d.toISOString().slice(0, 10)
}
// red: the latest order date has passed without an order; amber: within 2 weeks
export function urgency(orderBy: string | null, status: ProcStatus, today: string): 'late' | 'soon' | null {
  if (!orderBy || PLACED.includes(status)) return null
  if (orderBy < today) return 'late'
  const soon = new Date(`${today}T00:00:00Z`)
  soon.setUTCDate(soon.getUTCDate() + 14)
  return orderBy <= soon.toISOString().slice(0, 10) ? 'soon' : null
}
