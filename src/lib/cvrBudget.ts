// CVR budgets from the office SoW (docs/decisions.md "CVR: built"). Two layouts:
// - Micro (e.g. "Micro by The Fix--sow-R5-office.xlsx"): the package cost columns appear twice
//   in the heading row; the second block holds each line's cost (qty × unit cost), ending with
//   the OHP column. Only priced lines count (a Total that's a number, or FOC / incl): "Client
//   Direct", "Excluded", "Omitted", options and blanks still carry cost in those columns but
//   aren't in the price. OH&P is each line's Total less its cost, not the OHP column, which
//   uses 15% even where a line has its own OH&P (M&E at 10%) and ignores VE omissions priced
//   without a cost; so the packages always add back to the SoW total (found 20 Nov on Micro).
//   "Subbie" is one column for every subcontract item, so it's split by SoW section.
// - Breakdown (e.g. the "CVR 030826" tab of 2609 KOSH CVR): package names over rows 2–4
//   (L onwards), each line's Total in H spread across them; the totals row is where column A
//   holds the grand total with no description.
// Below-the-line items aren't part of the contract sum, so they're left out of the budgets.
import type { Worksheet } from 'exceljs'
import { loadXlsx } from './xlsxLoad'

export type PackageKind = 'cost' | 'omit' | 'ep'

export interface BudgetPackage {
  name: string
  kind: PackageKind
  budget: number
  sow_column: string // where it came from, e.g. "AT" or "BM · section 3"
  supplier_note: string | null // e.g. subbie names / the breakdown's supplier row
}

// a SoW line that doesn't reconcile, shown after the import
export interface BudgetQuery {
  ref: string
  description: string
  total: string // the line's Total as shown
  cost: number // cost in the package columns
  issue: 'no_cost' | 'not_priced' // priced with no cost build-up / carries cost but isn't in the price
}

export interface ParsedBudget {
  layout: 'micro' | 'breakdown'
  sheet: string
  packages: BudgetPackage[]
  total: number // sum of every package, OH&P included
  sow_total: number | null // the schedule's own total (excl. below the line), to check against
  queries: BudgetQuery[]
}

type Cell = ReturnType<Worksheet['getCell']>

function val(c: Cell): string | number | null {
  const v = c.value as unknown
  if (v == null) return null
  if (typeof v === 'number' || typeof v === 'string') return v
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[] }
    if (o.richText) return o.richText.map((t) => t.text).join('')
    if ('result' in o) return typeof o.result === 'number' || typeof o.result === 'string' ? o.result : null
  }
  return null
}
const num = (c: Cell) => {
  const v = val(c)
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
const text = (c: Cell) => {
  const v = val(c)
  return v == null ? '' : String(v).replace(/\s+/g, ' ').trim()
}
const r2 = (n: number) => Math.round(n * 100) / 100
const colName = (c: number) => {
  let s = ''
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

// OH&P, DuB management and DuB design are shown and omitted; EP / contingency is costed at a %
export function kindOf(name: string): PackageKind {
  const n = name.toLowerCase()
  if (/^(oh&p|ohp|overh)/.test(n) || /\b(dub|du boulay) (management|design)\b/.test(n)) return 'omit'
  if (n === 'ep' || /^ep\b/.test(n)) return 'ep'
  return 'cost'
}

const NOT_PACKAGES = /^(comments|roundup val|custom ohp|rate|subbie name|provision notes|balancing)$/i

// namesRow: the row with the package names (row 2); headRow: the # / Description row (row 5)
function parseMicro(ws: Worksheet, namesRow: number, headRow: number, cols: Record<string, number>): ParsedBudget | null {
  // find the second block of names (a name seen before, to the right of Total)
  const head = ws.getRow(namesRow)
  const seen = new Map<string, number>()
  let start = 0
  for (let c = (cols.total ?? 1) + 1; c <= ws.columnCount; c++) {
    const t = text(head.getCell(c)).toLowerCase()
    if (!t) continue
    if (seen.has(t)) {
      start = c
      break
    }
    seen.set(t, c)
  }
  if (!start) return null
  const pkgCols: { c: number; name: string }[] = []
  let ohpCol = 0
  for (let c = start; c <= ws.columnCount; c++) {
    const name = text(head.getCell(c))
    if (!name || NOT_PACKAGES.test(name)) continue
    if (/^ohp$/i.test(name)) {
      ohpCol = c
      break
    }
    pkgCols.push({ c, name })
  }
  if (!ohpCol || pkgCols.length < 5) return null

  const totals = new Map<string, BudgetPackage>()
  const add = (name: string, column: string, amount: number, supplier?: string) => {
    const p = totals.get(name) ?? { name, kind: kindOf(name), budget: 0, sow_column: column, supplier_note: null }
    p.budget += amount
    if (supplier && !(p.supplier_note ?? '').split(', ').includes(supplier)) p.supplier_note = p.supplier_note ? `${p.supplier_note}, ${supplier}` : supplier
    totals.set(name, p)
  }
  const subbieNameCol = [...seen.entries()].find(([k]) => k === 'subbie name')?.[1]
  const queries: BudgetQuery[] = []
  let section = ''
  let sectionNo = ''
  let sowTotal = 0
  let ohp = 0
  for (let r = headRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const desc = text(row.getCell(cols.desc))
    const ref = cols.ref ? val(row.getCell(cols.ref)) : null
    if (!desc && ref == null) continue
    const totalCell = row.getCell(cols.total)
    const lineTotal = num(totalCell)
    if (typeof ref === 'number' && Number.isInteger(ref) && lineTotal == null && num(row.getCell(cols.rate)) == null) {
      if (/below the line/i.test(desc)) break
      section = desc
      sectionNo = String(ref)
      continue
    }
    const costs = pkgCols.map(({ c, name }) => ({ c, name, v: num(row.getCell(c)) ?? 0 })).filter((x) => x.v)
    const cost = costs.reduce((s, x) => s + x.v, 0)
    const shown = lineTotal != null ? String(r2(lineTotal)) : text(totalCell)
    const refText = ref == null ? '' : typeof ref === 'number' ? ref.toFixed(2) : String(ref)
    const priced = lineTotal != null || /^(foc|incl)/i.test(shown)
    if (!priced) {
      if (Math.abs(cost) >= 0.01) queries.push({ ref: refText, description: desc, total: shown || '(blank)', cost: r2(cost), issue: 'not_priced' })
      continue
    }
    sowTotal += lineTotal ?? 0
    ohp += (lineTotal ?? 0) - cost
    if (lineTotal && !costs.length) queries.push({ ref: refText, description: desc, total: shown, cost: 0, issue: 'no_cost' })
    for (const { c, name, v } of costs) {
      if (/^subbie$/i.test(name) && section) {
        const who = subbieNameCol ? text(row.getCell(subbieNameCol)) : ''
        add(`Subbie – ${sectionNo} ${section}`, `${colName(c)} · section ${sectionNo}`, v, who || undefined)
      } else add(name, colName(c), v)
    }
  }
  add('OH&P', `${colName(ohpCol)} (Total less cost)`, ohp)
  const packages = [...totals.values()].map((p) => ({ ...p, budget: r2(p.budget) })).filter((p) => p.budget !== 0)
  return { layout: 'micro', sheet: ws.name.trim(), packages, total: r2(packages.reduce((s, p) => s + p.budget, 0)), sow_total: r2(sowTotal), queries }
}

// the older breakdown: names in rows 2–4 from column L, descriptions in D, totals in H
function parseBreakdown(ws: Worksheet): ParsedBudget | null {
  const first = 12 // L
  const names: { c: number; name: string; supplier: string }[] = []
  for (let c = first; c <= ws.columnCount; c++) {
    const parts = [2, 3, 4].map((r) => text(ws.getRow(r).getCell(c))).filter(Boolean)
    if (!parts.length) continue
    // "DUB" over another word is DuB's own (management, design, expenses…)
    const name = parts[0].toUpperCase() === 'DUB' && parts.length > 1 ? `DuB ${parts.slice(1).join(' ')}` : parts.join(' ')
    names.push({ c, name, supplier: '' })
  }
  if (names.length < 5 || !names.some((n) => /oh&p/i.test(n.name))) return null

  const sums = new Map<number, number>()
  let totalsRow = 0
  for (let r = 5; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const desc = text(row.getCell(4))
    if (/below the line/i.test(desc)) break
    if (!desc && num(row.getCell(1)) != null && num(row.getCell(8)) != null) {
      totalsRow = r
      break
    }
    for (const { c } of names) {
      const v = num(row.getCell(c))
      if (v) sums.set(c, (sums.get(c) ?? 0) + v)
    }
  }
  if (!totalsRow) return null
  // the supplier row a few rows under the totals ("Logik", "Client Direct"…), not the % or target rows
  for (let r = totalsRow + 1; r <= Math.min(ws.rowCount, totalsRow + 12); r++) {
    const row = ws.getRow(r)
    const filled = names.filter((n) => typeof val(row.getCell(n.c)) === 'string' && text(row.getCell(n.c))).length
    if (filled > names.length / 3) {
      for (const n of names) n.supplier = text(row.getCell(n.c))
      break
    }
  }
  const packages = names
    .map(({ c, name, supplier }) => ({ name, kind: kindOf(name), budget: r2(sums.get(c) ?? 0), sow_column: colName(c), supplier_note: supplier && supplier !== '0' ? supplier : null }))
    .filter((p) => p.budget !== 0)
  return { layout: 'breakdown', sheet: ws.name.trim(), packages, total: r2(packages.reduce((s, p) => s + p.budget, 0)), sow_total: num(ws.getRow(totalsRow).getCell(8)), queries: [] }
}

// the # / Description / Rate / Total row of a priced schedule
function findHeader(ws: Worksheet) {
  for (let r = 1; r <= 15; r++) {
    const cols: Record<string, number> = {}
    ws.getRow(r).eachCell((cell, c) => {
      const t = text(cell).toLowerCase()
      if ((t === '#' || t === 'ref') && !cols.ref) cols.ref = c
      else if (t === 'description' && !cols.desc) cols.desc = c
      else if (t === 'rate' && !cols.rate) cols.rate = c
      else if (t === 'total' && !cols.total) cols.total = c
    })
    if (cols.desc && cols.rate && cols.total) return { row: r, cols }
  }
  return null
}

export async function parseBudget(data: ArrayBuffer | Uint8Array): Promise<ParsedBudget> {
  const wb = await loadXlsx(data)
  for (const ws of wb.worksheets) {
    if (ws.state !== 'visible') continue
    const h = findHeader(ws)
    if (h) {
      // the package names are in a heading row at or above the # / Description row
      for (let r = 1; r <= h.row; r++) {
        const p = parseMicro(ws, r, h.row, h.cols)
        if (p && p.packages.length) return p
      }
    }
    const b = parseBreakdown(ws)
    if (b) return b
  }
  throw new Error("Couldn't find the package cost columns in this file. Use the office SoW (--sow--office) or a CVR breakdown tab.")
}
