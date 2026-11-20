// The iPlicit job costing report ("Jobcost Report", run each month from iPlicit's Excel add-in;
// layout as 2609_Jobcosting report 26.10.15). Columns are found by their headings, which run
// over several rows ("Final / Total / Costs"), so moved or extra columns don't matter.
// One row per supplier: Cost Code (e.g. 9LOG01, CC04 or a number), Description (supplier name),
// iPlicit PO total (memorandum only), Invoiced, Committed, Unposted, Final provisions,
// Final Total Costs, Last Reported, This Period, Paid to Date, Retention, O/S, Explanation.
// The supplier list ends at the count row under it; the revenue build-up below is ignored
// (certified figures come from Applications).
import type { Worksheet } from 'exceljs'

export interface CostLine {
  supplier_code: string
  supplier_name: string
  po_total: number | null
  invoiced: number | null
  committed: number | null
  unposted: number | null
  provisions: number | null
  total_cost: number // Final Total Costs
  last_reported: number | null
  this_period: number | null
  paid_to_date: number | null
  retention: number | null
  outstanding: number | null
  explanation: string | null
  sort: number
}

export interface ParsedCosts {
  project: string | null // "2609KOSH"
  report_date: string | null // PREPARED date, ISO
  last_reported_date: string | null
  lines: CostLine[]
  total: number
  stated_total: number | null // the report's own total under the Final Total Costs column
  checks: string[] // anything that didn't add up
}

type Cell = ReturnType<Worksheet['getCell']>

function val(c: Cell): string | number | Date | null {
  const v = c.value as unknown
  if (v == null) return null
  if (typeof v === 'number' || typeof v === 'string' || v instanceof Date) return v
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[] }
    if (o.richText) return o.richText.map((t) => t.text).join('')
    if ('result' in o) return typeof o.result === 'number' || typeof o.result === 'string' || o.result instanceof Date ? (o.result as string | number | Date) : null
  }
  return null
}
const text = (c: Cell) => {
  const v = val(c)
  return v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, ' ').trim()
}
// "(64)" and "-" as accountants write them
function money(c: Cell): number | null {
  const v = val(c)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.replace(/[£,\s]/g, '')
  if (s === '' || s === '-') return null
  const neg = /^\(.*\)$/.test(s)
  const n = Number(s.replace(/[()]/g, ''))
  return Number.isFinite(n) ? (neg ? -n : n) : null
}
function isoDate(c: Cell): string | null {
  const v = val(c)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10)
  if (typeof v === 'string') {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}
const r2 = (n: number) => Math.round(n * 100) / 100

type Key = Exclude<keyof CostLine, 'supplier_code' | 'supplier_name' | 'sort'> | 'code' | 'name'
// order matters: the first heading that matches a column wins
const HEADINGS: [Key, RegExp][] = [
  ['code', /cost code/],
  ['name', /^description/],
  ['po_total', /purchase order/],
  ['invoiced', /invoiced/],
  ['committed', /commit+ed/],
  ['unposted', /unposted/],
  ['provisions', /provisions/],
  ['total_cost', /final total/],
  ['last_reported', /last reported/],
  ['this_period', /this period/],
  ['paid_to_date', /paid to date/],
  ['retention', /retention/],
  ['outstanding', /o\/s/],
  ['explanation', /explanation/],
]

export async function parseJobCosting(data: ArrayBuffer | Uint8Array): Promise<ParsedCosts> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data as ArrayBuffer)
  for (const ws of wb.worksheets) {
    if (ws.state !== 'visible') continue
    const p = parseSheet(ws)
    if (p) return p
  }
  throw new Error("Couldn't find the job costing table in this file (a sheet with Cost Code, Description and Final Total Costs headings). Use the iPlicit Jobcost Report as Excel.")
}

function parseSheet(ws: Worksheet): ParsedCosts | null {
  // the row with "Cost Code"
  let codeRow = 0
  let codeCol = 0
  for (let r = 1; r <= Math.min(ws.rowCount, 40) && !codeRow; r++)
    ws.getRow(r).eachCell((cell, c) => {
      if (!codeRow && /^cost code$/i.test(text(cell))) {
        codeRow = r
        codeCol = c
      }
    })
  if (!codeRow) return null

  // each column's heading: the text in the rows just above and below "Cost Code"
  const cols = new Map<Key, number>()
  const heads: string[] = []
  for (let c = 1; c <= ws.columnCount; c++) {
    heads[c] = [-2, -1, 0, 1, 2, 3]
      .map((d) => (codeRow + d >= 1 ? text(ws.getRow(codeRow + d).getCell(c)) : ''))
      .filter((t) => t && !/^\d/.test(t))
      .join(' ')
      .toLowerCase()
  }
  for (const [key, re] of HEADINGS)
    for (let c = 1; c <= ws.columnCount; c++) {
      if ([...cols.values()].includes(c)) continue
      if (re.test(key === 'name' ? heads[c].replace(/^costs\s*/, '') : heads[c])) {
        cols.set(key, c)
        break
      }
    }
  cols.set('code', codeCol)
  if (!cols.has('name')) cols.set('name', codeCol + 1)
  if (!cols.has('total_cost')) return null

  // header details above the table
  let project: string | null = null
  let reportDate: string | null = null
  for (let r = 1; r < codeRow; r++) {
    const row = ws.getRow(r)
    row.eachCell((cell, c) => {
      const t = text(cell).toLowerCase()
      if (t === 'project' && !project) project = text(row.getCell(c + 1)) || null
      if (t === 'prepared' && !reportDate) reportDate = isoDate(row.getCell(c + 1))
    })
    if (r === 1 && !reportDate) row.eachCell((cell) => (reportDate ??= isoDate(cell)))
  }
  let lastReportedDate: string | null = null
  const lastCol = cols.get('last_reported')
  if (lastCol) for (let r = codeRow; r <= codeRow + 3; r++) lastReportedDate ??= isoDate(ws.getRow(r).getCell(lastCol))

  const lines: CostLine[] = []
  let stated: number | null = null
  const n = (row: ReturnType<Worksheet['getRow']>, k: Key) => (cols.has(k) ? money(row.getCell(cols.get(k)!)) : null)
  for (let r = codeRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const code = text(row.getCell(cols.get('code')!))
    const name = text(row.getCell(cols.get('name')!))
    if (/revenue build/i.test(code + name)) break
    // the count row under the list ("17") with the column totals
    if (!name && code && /^\d+$/.test(code) && lines.length) {
      stated = n(row, 'total_cost')
      break
    }
    if (!name) continue
    const total = n(row, 'total_cost')
    const parts = (['invoiced', 'committed', 'unposted', 'provisions'] as const).map((k) => n(row, k))
    // a supplier with nothing against it at all is still listed (it may have a PO)
    lines.push({
      supplier_code: code,
      supplier_name: name,
      po_total: n(row, 'po_total'),
      invoiced: parts[0],
      committed: parts[1],
      unposted: parts[2],
      provisions: parts[3],
      total_cost: total ?? r2(parts.reduce<number>((s, x) => s + (x ?? 0), 0)),
      last_reported: n(row, 'last_reported'),
      this_period: n(row, 'this_period'),
      paid_to_date: n(row, 'paid_to_date'),
      retention: n(row, 'retention'),
      outstanding: n(row, 'outstanding'),
      explanation: cols.has('explanation') ? text(row.getCell(cols.get('explanation')!)) || null : null,
      sort: lines.length,
    })
  }

  const total = r2(lines.reduce((s, l) => s + l.total_cost, 0))
  const checks: string[] = []
  // Final Total Costs = invoiced + committed + unposted + provisions; the report rounds to £1
  for (const l of lines) {
    const sum = (l.invoiced ?? 0) + (l.committed ?? 0) + (l.unposted ?? 0) + (l.provisions ?? 0)
    if (Math.abs(sum - l.total_cost) > 1.5) checks.push(`${l.supplier_code} ${l.supplier_name}: Final Total Costs ${l.total_cost} isn't invoiced + committed + unposted + provisions (${r2(sum)}).`)
  }
  if (stated != null && Math.abs(stated - total) > Math.max(2, lines.length)) checks.push(`The suppliers add up to ${total}, but the report's total is ${stated}.`)
  return { project, report_date: reportDate, last_reported_date: lastReportedDate, lines, total, stated_total: stated, checks }
}
