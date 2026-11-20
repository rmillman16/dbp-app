// CVR budgets from the office SoW (docs/decisions.md "CVR: built"). Two layouts:
// - Micro (e.g. "Micro by The Fix--sow-R5-office.xlsx"): the package cost columns appear twice
//   in the heading row; the second block holds each line's cost (qty × unit cost), ending with
//   the OHP column. Only priced lines count (a Total that's a number, or FOC / incl): "Client
//   Direct", "Excluded", "Omitted", options and blanks still carry cost in those columns but
//   aren't in the price. OH&P is each line's Total less its cost, not the OHP column, which
//   uses 15% even where a line has its own OH&P (M&E at 10%) and ignores VE omissions priced
//   without a cost; so the packages always add back to the SoW total (found 20 Nov on Micro).
//   "Subbie" is one column for every subcontract item, so it's split by SoW section.
//   Preliminaries are priced as one lump with the prelims headings listed unpriced under it
//   (Project & commercial management, Site management & multi services team…): each heading
//   becomes a prelims section package that draws the lump down (agreed 20 Nov, see cvrCalc).
// - Breakdown (e.g. the "CVR 030826" tab of 2609 KOSH CVR): package names over rows 2–4
//   (L onwards), each line's Total in H spread across them; the totals row is where column A
//   holds the grand total with no description.
// Below-the-line items aren't part of the contract sum, so they're left out of the budgets.
// The lines are kept too (script 018) for the CVR export's breakdown sheet, laid out as the
// KOSH "CVR 030826" tab: each item, then its cost by package and its OH&P on lines under it.
import type { Worksheet } from 'exceljs'
import { loadXlsx } from './xlsxLoad'

export type PackageKind = 'cost' | 'omit' | 'ep'

export interface BudgetPackage {
  name: string
  kind: PackageKind
  budget: number
  sow_column: string // where it came from, e.g. "AT" or "BM · section 3"
  supplier_note: string | null // e.g. subbie names / the breakdown's supplier row
  group?: 'prelims' // prelims sections and the lump they draw down
  is_remainder?: boolean // the lump: "Preliminaries – not yet split"
}

export const PRELIMS_LUMP = 'Preliminaries – not yet split'

// a SoW line that doesn't reconcile, shown after the import
export interface BudgetQuery {
  ref: string
  description: string
  total: string // the line's Total as shown
  cost: number // cost in the package columns
  issue: 'no_cost' | 'not_priced' // priced with no cost build-up / carries cost but isn't in the price
}

// a row of the breakdown: a section heading, an item (its SoW total), or a line of an item
// (its amount, in one package column or a few)
export interface BudgetLine {
  kind: 'section' | 'item' | 'line'
  ref: string | null
  description: string
  qty: number | null
  unit: string | null
  rate: number | null
  total: number | null
  shown: string | null // a total in words: FOC, Included…
  amounts: Record<string, number> // package name → amount; OH&P under "OH&P"
  note: string | null
}

export interface ParsedBudget {
  layout: 'micro' | 'breakdown'
  sheet: string
  packages: BudgetPackage[]
  total: number // sum of every package, OH&P included
  sow_total: number | null // the schedule's own total (excl. below the line), to check against
  queries: BudgetQuery[]
  lines: BudgetLine[]
}

const blank = { ref: null, qty: null, unit: null, rate: null, total: null, shown: null, amounts: {}, note: null }

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
  const lines: BudgetLine[] = []
  const prelimSections: string[] = []
  const prelimColumns = new Set<string>() // packages the prelims lump was priced into
  let prelimSectionNo = ''
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
      lines.push({ ...blank, kind: 'section', ref: sectionNo, description: desc })
      continue
    }
    const costs = pkgCols.map(({ c, name }) => ({ c, name, v: num(row.getCell(c)) ?? 0 })).filter((x) => x.v)
    const cost = costs.reduce((s, x) => s + x.v, 0)
    const shown = lineTotal != null ? String(r2(lineTotal)) : text(totalCell)
    const refText = ref == null ? '' : typeof ref === 'number' ? ref.toFixed(2) : String(ref)
    const priced = lineTotal != null || /^(foc|incl)/i.test(shown)
    const inPrelims = /prelim/i.test(section)
    // an unpriced heading under Preliminaries is a prelims section
    if (inPrelims && !priced && !costs.length) {
      if (!prelimSections.includes(desc)) prelimSections.push(desc)
      prelimSectionNo = sectionNo
      lines.push({ ...blank, kind: 'item', ref: refText || null, description: desc })
      continue
    }
    if (inPrelims) for (const { name } of costs) if (!/^subbie/i.test(name)) prelimColumns.add(name)
    if (!priced) {
      if (Math.abs(cost) >= 0.01) queries.push({ ref: refText, description: desc, total: shown || '(blank)', cost: r2(cost), issue: 'not_priced' })
      continue
    }
    sowTotal += lineTotal ?? 0
    ohp += (lineTotal ?? 0) - cost
    if (lineTotal && !costs.length) queries.push({ ref: refText, description: desc, total: shown, cost: 0, issue: 'no_cost' })
    const item: BudgetLine = {
      ...blank,
      kind: 'item',
      ref: refText || null,
      description: desc,
      qty: cols.qty ? num(row.getCell(cols.qty)) : null,
      unit: cols.unit ? text(row.getCell(cols.unit)) || null : null,
      rate: num(row.getCell(cols.rate)),
      total: lineTotal == null ? null : r2(lineTotal),
      shown: lineTotal == null ? shown : null,
    }
    lines.push(item)
    // the item's cost by package, then its OH&P (Total less cost), each on a line under it
    const parts = new Map<string, number>()
    for (const { c, name, v } of costs) {
      let pkg = name
      if (/^subbie$/i.test(name) && section) {
        const who = subbieNameCol ? text(row.getCell(subbieNameCol)) : ''
        pkg = `Subbie – ${sectionNo} ${section}`
        add(pkg, `${colName(c)} · section ${sectionNo}`, v, who || undefined)
      } else add(name, colName(c), v)
      parts.set(pkg, (parts.get(pkg) ?? 0) + v)
    }
    const lineOhp = r2((lineTotal ?? 0) - cost)
    if (Math.abs(lineOhp) >= 0.005) parts.set('OH&P', lineOhp)
    for (const [pkg, v] of parts) lines.push({ ...blank, kind: 'line', description: pkg, qty: 1, unit: 'item', rate: r2(v), total: r2(v), amounts: { [pkg]: r2(v) } })
  }
  add('OH&P', `${colName(ohpCol)} (Total less cost)`, ohp)
  // the prelims lump becomes "Preliminaries – not yet split" with the sections drawing it down
  const lumpName = [...prelimColumns].find((n) => /prelim/i.test(n))
  if (prelimSections.length && lumpName && totals.has(lumpName)) {
    const lump = totals.get(lumpName)!
    totals.delete(lumpName)
    totals.set(PRELIMS_LUMP, { ...lump, name: PRELIMS_LUMP, group: 'prelims', is_remainder: true })
    for (const l of lines)
      if (lumpName in l.amounts) {
        l.amounts = { [PRELIMS_LUMP]: l.amounts[lumpName] }
        l.description = PRELIMS_LUMP
      }
  }
  const packages: BudgetPackage[] = [...totals.values()].map((p) => ({ ...p, budget: r2(p.budget) })).filter((p) => p.budget !== 0)
  if (totals.has(PRELIMS_LUMP))
    for (const s of prelimSections)
      if (!packages.some((p) => p.name === s)) packages.push({ name: s, kind: 'cost', budget: 0, sow_column: `section ${prelimSectionNo}`, supplier_note: null, group: 'prelims' })
  return { layout: 'micro', sheet: ws.name.trim(), packages, total: r2(packages.reduce((s, p) => s + p.budget, 0)), sow_total: r2(sowTotal), queries, lines }
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
  const lines: BudgetLine[] = []
  let totalsRow = 0
  for (let r = 5; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const desc = text(row.getCell(4))
    if (/below the line/i.test(desc)) break
    if (!desc && num(row.getCell(1)) != null && num(row.getCell(8)) != null) {
      totalsRow = r
      break
    }
    const amounts: Record<string, number> = {}
    for (const { c, name } of names) {
      const v = num(row.getCell(c))
      if (v) {
        sums.set(c, (sums.get(c) ?? 0) + v)
        amounts[name] = (amounts[name] ?? 0) + v
      }
    }
    // A: a section's total; B: an item's total (C its number); otherwise a line of the item
    if (!desc && !Object.keys(amounts).length) continue
    const h = val(row.getCell(8))
    const refV = val(row.getCell(3))
    const kind = num(row.getCell(1)) != null && desc ? 'section' : num(row.getCell(2)) != null ? 'item' : 'line'
    lines.push({
      kind,
      ref: refV == null ? null : typeof refV === 'number' ? refV.toFixed(2) : String(refV),
      description: desc,
      qty: num(row.getCell(5)),
      unit: text(row.getCell(6)) || null,
      rate: num(row.getCell(7)),
      total: kind === 'item' ? num(row.getCell(2)) : typeof h === 'number' ? r2(h) : null,
      shown: typeof h === 'string' ? text(row.getCell(8)) : null,
      amounts,
      note: text(row.getCell(11)) || null,
    })
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
  return { layout: 'breakdown', sheet: ws.name.trim(), packages, total: r2(packages.reduce((s, p) => s + p.budget, 0)), sow_total: num(ws.getRow(totalsRow).getCell(8)), queries: [], lines }
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
      else if ((t === 'quantity' || t === 'qty') && !cols.qty) cols.qty = c
      else if (t === 'unit' && !cols.unit) cols.unit = c
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
