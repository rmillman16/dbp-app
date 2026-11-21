// A CVR done the old way, in Excel, uploaded to the job (Richard, 21 Nov), so the job's CVR history
// is complete and the next CVR made in the app can show the movement from it. Read from the KOSH
// layout's summary sheet ("Interim Cost Value Reconciliation", e.g. "CVR_June 26"; the app's own
// export has the same layout), each figure found by its label:
//   Cost as at · Date prepared · Order Value · Jobcost Report · Total Cost · Final account
//   projected · Possible reduction / negotiations · Anticipated Final Value · Gross margin ·
//   Gross margin % on sales · Gross Certified / invoiced to date
// and the suppliers under "Name / Company" (code, name, "Included in cost from JC").
import type { Worksheet } from 'exceljs'
import { supabase } from './supabase'
import { loadXlsx } from './xlsxLoad'
import type { CostLine } from './cvrCosts'
import type { Job } from './types'

export interface OldCvr {
  sheet: string
  periodEnd: string | null // cost as at, ISO
  prepared: string | null
  contractSum: number | null // tender order value
  jcTotal: number | null
  totalCost: number | null
  finalAccount: number | null
  possibleReduction: number
  afv: number | null
  margin: number | null
  marginPct: number | null
  certified: number | null
  suppliers: CostLine[]
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
  return v == null || v instanceof Date ? '' : String(v).replace(/\s+/g, ' ').trim()
}
const r2 = (n: number) => Math.round(n * 100) / 100
// a date cell: a Date, or an Excel day number
const isoOf = (v: string | number | Date | null) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10)
  return null
}

export async function parseOldCvr(data: ArrayBuffer): Promise<OldCvr> {
  const wb = await loadXlsx(data)
  const titled = (w: Worksheet) => {
    for (let r = 1; r <= 4; r++) for (let c = 1; c <= 6; c++) if (/interim cost value reconcil/i.test(text(w.getRow(r).getCell(c)))) return true
    return false
  }
  const ws = wb.worksheets.find((w) => w.state === 'visible' && titled(w))
  if (!ws) throw new Error('No CVR summary sheet found ("Interim Cost Value Reconciliation" at the top, as the KOSH CVR). Upload the CVR workbook done in Excel.')

  // where a label is, and the first figure to its right
  const find = (re: RegExp) => {
    for (let r = 1; r <= Math.min(ws.rowCount, 400); r++) {
      const row = ws.getRow(r)
      for (let c = 1; c <= Math.min(ws.columnCount, 20); c++) if (re.test(text(row.getCell(c)))) return { r, c }
    }
    return null
  }
  const toTheRight = (re: RegExp) => {
    const at = find(re)
    if (!at) return []
    const row = ws.getRow(at.r)
    const out: (string | number | Date | null)[] = []
    for (let c = at.c + 1; c <= Math.min(ws.columnCount, 20); c++) out.push(val(row.getCell(c)))
    return out
  }
  // the first figure (to the penny, unless raw) or date to the right of a label
  const figure = (re: RegExp, raw = false): number | null => {
    const v = toTheRight(re).find((x): x is number => typeof x === 'number')
    return v == null ? null : raw ? v : r2(v)
  }
  const date = (re: RegExp): string | null =>
    toTheRight(re)
      .map(isoOf)
      .find((d): d is string => !!d) ?? null

  // the suppliers: under the "Name / Company" heading, down to Deposit Payments / OH&P
  const head = find(/^name \/ company$/i)
  const suppliers: CostLine[] = []
  if (head) {
    const row = ws.getRow(head.r)
    let jcCol = 0
    for (let c = 1; c <= Math.min(ws.columnCount, 20); c++) if (/included in cost from jc/i.test(text(row.getCell(c)))) jcCol = c
    for (let r = head.r + 1; jcCol && r <= ws.rowCount; r++) {
      const rr = ws.getRow(r)
      const name = text(rr.getCell(head.c))
      if (/^(deposit payments|unforeseen costs|oh&p)$/i.test(name)) break
      const cost = val(rr.getCell(jcCol))
      if (!name || typeof cost !== 'number') continue
      const code = val(rr.getCell(head.c - 1))
      suppliers.push({
        supplier_code: code == null || code instanceof Date ? '' : String(code).trim(),
        supplier_name: name,
        po_total: null,
        invoiced: null,
        committed: null,
        unposted: null,
        provisions: null,
        total_cost: r2(cost),
        last_reported: null,
        this_period: null,
        paid_to_date: null,
        retention: null,
        outstanding: null,
        explanation: null,
        sort: suppliers.length,
      })
    }
  }

  const pct = figure(/^gross margin % on sales$/i, true) // a fraction, not to the penny
  return {
    sheet: ws.name,
    periodEnd: date(/^cost as at$/i),
    prepared: date(/^date prepared$/i),
    contractSum: figure(/^order value$/i),
    jcTotal: figure(/^jobcost report$/i),
    totalCost: figure(/^total cost$/i),
    finalAccount: figure(/^final account projected$/i),
    possibleReduction: figure(/^possible reduction/i) ?? 0,
    afv: figure(/^anticipated final value$/i),
    margin: figure(/^gross margin$/i),
    marginPct: pct == null ? null : Math.abs(pct) > 1.5 ? pct / 100 : pct, // 19.5 or 0.195
    certified: figure(/^gross certified/i),
    suppliers,
  }
}

// Saved as a finalised CVR: its figures in the summary (marked as uploaded, so it isn't opened in
// the app's editor) and its suppliers' costs as that month's job costing report.
export async function saveOldCvr(job: Job, p: OldCvr, fileName: string) {
  if (!p.periodEnd) throw new Error('The "Cost as at" date wasn’t found on the CVR sheet.')
  const imp = await supabase.from('cost_imports').insert({ job_id: job.id, period_end: p.periodEnd, file_name: fileName, report_date: p.prepared }).select('id').single()
  if (imp.error) throw new Error(imp.error.message)
  if (p.suppliers.length) {
    const w = await supabase.from('cost_lines').insert(p.suppliers.map((l) => ({ ...l, import_id: imp.data.id })))
    if (w.error) throw new Error(w.error.message)
  }
  const summary = {
    uploaded: true,
    file: fileName,
    sheet: p.sheet,
    value: { contractSum: p.contractSum ?? 0, agreedVos: 0, possibleReduction: p.possibleReduction, afv: p.afv ?? 0 },
    totalCost: p.totalCost ?? 0,
    margin: p.margin ?? (p.afv != null && p.totalCost != null ? r2(p.afv - p.totalCost) : 0),
    marginPct: p.marginPct ?? (p.afv ? ((p.afv ?? 0) - (p.totalCost ?? 0)) / p.afv : 0),
    jcTotal: p.jcTotal ?? r2(p.suppliers.reduce((s, l) => s + l.total_cost, 0)),
    certified: p.certified == null ? null : { gross: p.certified, retention: 0, label: 'from the uploaded CVR' },
  }
  const cvr = await supabase
    .from('cvrs')
    .insert({
      job_id: job.id,
      period_end: p.periodEnd,
      cost_import_id: imp.data.id,
      prepared_date: p.prepared ?? p.periodEnd,
      status: 'final',
      possible_reduction: p.possibleReduction,
      notes: `Done in Excel, uploaded from ${fileName}`,
      summary,
    })
    .select('id')
    .single()
  if (cvr.error) throw new Error(cvr.error.message)
}

// an uploaded CVR (and its job costing lines) removed
export async function removeOldCvr(cvrId: string, costImportId: string | null) {
  const d = await supabase.from('cvrs').delete().eq('id', cvrId)
  if (d.error) throw new Error(d.error.message)
  if (costImportId) await supabase.from('cost_imports').delete().eq('id', costImportId)
}
