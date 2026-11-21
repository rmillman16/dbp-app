// Reads a priced Schedule of Works from Excel: the client or office SoW (e.g.
// "Micro by The Fix--sow-R5-office.xlsx", tab "R5") or an application workbook that
// carries one (2611 Application 2 R2, tab "R5 "). Columns are found by their headings
// (#, Description, Quantity, Unit, Rate, Total), so extra columns are ignored.
// If the sheet has "dbp Application N %" / "… Assessment N %" columns, those
// percentages are read too, so an existing application can be brought in.
import type { Worksheet } from 'exceljs'
import { loadXlsx } from './xlsxLoad'

export interface ParsedLine {
  kind: 'section' | 'item'
  section: string | null
  item_ref: string | null
  description: string
  qty: number | null
  unit: string | null
  rate: number | null
  total: number | null
  total_text: string | null
  below_line: boolean
  sort: number
  app_pct: number | null // from a "dbp Application N %" column, if any
  app_comment: string | null
  client_pct: number | null // from an "… Assessment N %" column, if any
}

export interface ParsedSow {
  sheet: string
  revision: string // R5
  lines: ParsedLine[]
  total: number // main schedule total (excl. VAT), excluding below-the-line items
  stated_total: number | null // the workbook's own "Total (excl. VAT)" figure
  app_no: number | null // N from "dbp Application N %"
}

type Cell = ReturnType<Worksheet['getCell']>

// the value a cell shows: formula results, rich text and errors flattened
function val(c: Cell): string | number | null {
  const v = c.value as unknown
  if (v == null) return null
  if (typeof v === 'number' || typeof v === 'string') return v
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; error?: string }
    if (o.richText) return o.richText.map((t) => t.text).join('')
    if ('result' in o) return typeof o.result === 'number' || typeof o.result === 'string' ? o.result : null
    if (o.error) return null
  }
  return null
}
const num = (c: Cell) => {
  const v = val(c)
  return typeof v === 'number' ? v : null
}
const text = (c: Cell) => {
  const v = val(c)
  return v == null ? '' : String(v).trim()
}

function findHeader(ws: Worksheet) {
  for (let r = 1; r <= 15; r++) {
    const cols: Record<string, number> = {}
    ws.getRow(r).eachCell((cell, c) => {
      const t = text(cell).toLowerCase()
      if (t === '#' || t === 'ref') cols.ref = c
      else if (t === 'description') cols.desc = c
      else if (t === 'quantity' || t === 'qty') cols.qty = c
      else if (t === 'unit') cols.unit = c
      else if (t === 'rate') cols.rate = c
      else if (t === 'total') cols.total = c
      else if (t === 'section total') cols.sectionTotal = c
      else if (/dbp application\s*\d+\s*%/.test(t)) {
        cols.appPct = c
        cols.appNo = Number(t.match(/application\s*(\d+)/)![1])
      } else if (t === 'dbp comments') cols.appComment = c
      else if (/assess?ment\s*\d*\s*%/.test(t)) cols.clientPct = c
    })
    if (cols.desc && cols.rate && cols.total) return { row: r, cols }
  }
  return null
}

export async function parseSow(data: ArrayBuffer | Uint8Array): Promise<ParsedSow> {
  // (refuses a file never calculated in Excel: its formulas would all read as blank)
  const wb = await loadXlsx(data)

  // the first visible sheet with SoW headings
  let ws: Worksheet | undefined
  let header: ReturnType<typeof findHeader> = null
  for (const s of wb.worksheets) {
    if (s.state !== 'visible') continue
    header = findHeader(s)
    if (header) {
      ws = s
      break
    }
  }
  if (!ws || !header) throw new Error("Couldn't find a priced schedule in this file (a sheet with #, Description, Quantity, Unit, Rate and Total headings).")
  const { row: headRow, cols } = header

  // revision: the cell after "Rev" near the top, else the sheet name if it looks like R5
  let revision = /^R\d+$/i.test(ws.name.trim()) ? ws.name.trim().toUpperCase() : ''
  for (let r = 1; r < headRow; r++)
    ws.getRow(r).eachCell((cell, c) => {
      if (text(cell).toLowerCase() === 'rev') revision = text(ws!.getRow(r).getCell(c + 1)) || revision
    })

  const lines: ParsedLine[] = []
  let section: string | null = null
  let belowLine = false
  let stated: number | null = null

  for (let r = headRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const desc = text(row.getCell(cols.desc))
    const refRaw = cols.ref ? val(row.getCell(cols.ref)) : null
    if (!desc && refRaw == null) continue

    // "Total (excl. VAT)" ends the main schedule; anything priced after it is below the line
    if (/^total\b/i.test(desc)) {
      if (!belowLine && /excl/i.test(desc)) stated = num(row.getCell(cols.sectionTotal ?? cols.total)) ?? num(row.getCell(cols.total))
      if (/excl/i.test(desc)) belowLine = true
      continue
    }
    if (!desc) continue

    const qty = cols.qty ? num(row.getCell(cols.qty)) : null
    const rate = num(row.getCell(cols.rate))
    const totalCell = row.getCell(cols.total)
    const total = num(totalCell)
    const totalText = total == null ? text(totalCell) || null : null
    const refNum = typeof refRaw === 'number' ? refRaw : refRaw != null && /^\d+(\.\d+)?$/.test(String(refRaw)) ? Number(refRaw) : null

    // a whole number with nothing priced is a section heading ("2  Structural work & Alterations")
    const isSection = refNum != null && Number.isInteger(refNum) && qty == null && rate == null && total == null
    if (isSection) {
      section = String(refNum)
      if (/below the line/i.test(desc)) belowLine = true
      lines.push({ kind: 'section', section, item_ref: section, description: desc, qty: null, unit: null, rate: null, total: null, total_text: null, below_line: belowLine, sort: lines.length, app_pct: null, app_comment: null, client_pct: null })
      continue
    }

    lines.push({
      kind: 'item',
      section,
      item_ref: refNum != null ? (Math.round(refNum * 100) / 100).toFixed(2) : refRaw != null ? String(refRaw) : null,
      description: desc,
      qty,
      unit: cols.unit ? text(row.getCell(cols.unit)) || null : null,
      rate,
      total,
      total_text: totalText,
      below_line: belowLine,
      sort: lines.length,
      app_pct: cols.appPct ? num(row.getCell(cols.appPct)) : null,
      app_comment: cols.appComment ? text(row.getCell(cols.appComment)) || null : null,
      client_pct: cols.clientPct ? num(row.getCell(cols.clientPct)) : null,
    })
  }

  const total = Math.round(lines.filter((l) => l.kind === 'item' && !l.below_line).reduce((s, l) => s + (l.total ?? 0), 0) * 100) / 100
  return { sheet: ws.name.trim(), revision: revision || 'R?', lines, total, stated_total: stated, app_no: cols.appNo ?? null }
}
