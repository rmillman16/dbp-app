// The cashflow to Excel (docs/decisions.md "Cashflow: built"): trades down the side, a column per
// month (valuations at month end), excl. VAT; then the monthly total, cumulative, cumulative %,
// retention held and the payment after retention; issued VOs at risk shown separately; and the
// actuals from Applications for past months. Two copies (decided 19 Nov):
// - internal: adds DBP's applied figure
// - client: certified and paid only, and the margin / contract-sum adjustment rows and EP shown as
//   one "Allowances and adjustments" row, so no OH&P or contingency reaches the client
// No S-curve in the Excel for now (Richard, 21 Nov).
import type { Cell, Worksheet } from 'exceljs'
import { download, excelDate, fill, newWorkbook, placeLogo, safeName, setupPage } from './excel'
import type { CashflowResult } from './cashflowCalc'
import type { Actual, CashflowItem } from './cashflow'
import type { Job } from './types'

const GBP = '£#,##0;[Red]-£#,##0'
const PCT = '0.0%'
const HEAD = 'FFDCE6F1'
const GROUP = 'FFEEF3FA'
const RISK = 'FFFFF2CC'
const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const colName = (c: number) => {
  let s = ''
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function put(
  ws: Worksheet,
  r: number,
  c: number,
  v: Cell['value'],
  o: { bold?: boolean; fmt?: string; size?: number; italic?: boolean; align?: 'left' | 'right' | 'center'; bg?: string; indent?: number } = {},
) {
  const cell = ws.getRow(r).getCell(c)
  cell.value = v
  cell.font = { name: 'Calibri', size: o.size ?? 10, bold: o.bold, italic: o.italic }
  if (o.fmt) cell.numFmt = o.fmt
  cell.alignment = { horizontal: o.align, vertical: 'middle', indent: o.indent }
  if (o.bg) fill(cell, o.bg)
  return cell
}

export interface CashflowExport {
  job: Job
  items: CashflowItem[]
  result: CashflowResult
  actuals: Actual[]
  siteStart: string | null
  pc: string | null
  programmeName: string | null
  copy: 'internal' | 'client'
}

export async function exportCashflow({ job, items, result, actuals, siteStart, pc, programmeName, copy }: CashflowExport) {
  const internal = copy === 'internal'
  const { wb, logoId } = await newWorkbook()
  const ws = wb.addWorksheet('Cashflow', { views: [{ state: 'frozen', xSplit: 1, ySplit: 11, showGridLines: false }] })

  // the months: the forecast's, and any month an application was made, valued or paid
  const months = [...new Set([...result.months, ...actuals.map((a) => a.month)])].sort()
  const idx = new Map(result.months.map((m, k) => [m, k]))
  const at = (row: number[], m: string) => (idx.has(m) ? row[idx.get(m)!] : 0)
  const FIRST = 2
  const TOTAL = FIRST + months.length
  const widths = [42, ...months.map(() => 11.5), 13]
  const L = colName(FIRST)
  const R = colName(TOTAL - 1)

  // ---- header ----
  put(ws, 1, 1, internal ? 'Cashflow forecast · internal' : 'Cashflow forecast', { bold: true, size: 14 })
  const today = new Date()
  const facts: [string, Cell['value'], string?][] = [
    ['Project', job.name],
    ['Job no', `${job.job_no} ${job.code}`],
    ['Prepared', excelDate(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`), 'dd/mm/yyyy'],
    ['Contract sum', Number(job.contract_sum ?? 0), '£#,##0.00'],
    // the SoW's total where that's higher than the contract sum entered (21 Nov)
    ['Forecast total', result.total, '£#,##0.00'],
    ['Start on site / PC', `${siteStart ? siteStart.split('-').reverse().join('/') : '–'} to ${pc ? pc.split('-').reverse().join('/') : '–'}`],
    ['Retention', `${Number(job.retention_pct ?? 0)}%, halved from PC`],
  ]
  facts.forEach(([k, v, fmt], i) => {
    put(ws, 3 + i, 1, k, { bold: true })
    put(ws, 3 + i, 2, v, { fmt, align: 'left' })
  })
  put(ws, 10, 1, `Excl. VAT. Valuations at month end.${programmeName ? ` From the programme "${programmeName}".` : ''}`, { italic: true, size: 9 })

  // ---- the trades by month ----
  const H = 11
  put(ws, H, 1, 'Trade', { bold: true, bg: HEAD })
  months.forEach((m, k) => put(ws, H, FIRST + k, monthLabel(m), { bold: true, align: 'right', bg: HEAD }))
  put(ws, H, TOTAL, 'Total', { bold: true, align: 'right', bg: HEAD })
  for (let c = 1; c <= TOTAL; c++) ws.getRow(H).getCell(c).border = { bottom: thin }

  const rowOf = new Map(result.rows.map((r) => [r.key, r]))
  // the client copy: margin not tied to a package, the contract-sum difference and EP (DBP's own
  // contingency) as one "Allowances and adjustments" row, so neither OH&P nor EP is shown
  const internalOnly = (i: CashflowItem) => i.kind === 'adjust' || /^ep\b|contingency/i.test(i.label)
  const shown = items.filter((i) => i.kind !== 'vo_risk' && (internal || !internalOnly(i)))
  const adjust = items.filter((i) => i.kind !== 'vo_risk' && internalOnly(i))
  let r = H + 1
  const first = r
  let group = ''
  const line = (label: string, values: number[], o: { indent?: number; italic?: boolean } = {}) => {
    put(ws, r, 1, label, { indent: o.indent, italic: o.italic })
    months.forEach((m, k) => {
      const v = at(values, m)
      put(ws, r, FIRST + k, v ? Math.round(v * 100) / 100 : null, { fmt: GBP })
    })
    put(ws, r, TOTAL, { formula: `SUM(${L}${r}:${R}${r})` }, { fmt: GBP, bold: true })
    r++
  }
  for (const it of shown) {
    if (it.group !== group) {
      group = it.group
      put(ws, r, 1, group.toUpperCase(), { bold: true, size: 9, bg: GROUP })
      for (let c = 2; c <= TOTAL; c++) fill(ws.getRow(r).getCell(c), GROUP)
      r++
    }
    line(it.label, rowOf.get(it.key)?.months ?? [], { indent: it.parent ? 2 : 0, italic: !!it.parent })
  }
  if (!internal && adjust.length) {
    const sum = result.months.map((_, k) => adjust.reduce((s, a) => s + (rowOf.get(a.key)?.months[k] ?? 0), 0))
    if (sum.some((v) => Math.abs(v) >= 0.005)) {
      // under the Other heading (added only if the trades above didn't end with it)
      if (group !== 'Other') {
        put(ws, r, 1, 'OTHER', { bold: true, size: 9, bg: GROUP })
        for (let c = 2; c <= TOTAL; c++) fill(ws.getRow(r).getCell(c), GROUP)
        r++
      }
      line('Allowances and adjustments', sum)
    }
  }
  const last = r - 1

  // ---- totals, cumulative, retention, payment ----
  const tot = r
  put(ws, tot, 1, 'Total this month', { bold: true })
  for (let c = FIRST; c <= TOTAL; c++) {
    const cell = put(ws, tot, c, { formula: `SUM(${colName(c)}${first}:${colName(c)}${last})` }, { fmt: GBP, bold: true })
    cell.border = { top: thin, bottom: { style: 'double' } }
  }
  ws.getRow(tot).getCell(1).border = { top: thin, bottom: { style: 'double' } }
  const byMonth = new Map(result.monthly.map((m) => [m.month, m]))
  const summary = (label: string, v: (m: string, k: number) => Cell['value'], fmt = GBP) => {
    r++
    put(ws, r, 1, label)
    months.forEach((m, k) => put(ws, r, FIRST + k, v(m, k), { fmt }))
  }
  summary('Cumulative', (_, k) => ({ formula: k ? `${colName(FIRST + k - 1)}${r}+${colName(FIRST + k)}${tot}` : `${L}${tot}` }))
  const cumRow = r
  summary('Cumulative %', (_, k) => ({ formula: `IF($${colName(TOTAL)}$${tot}=0,0,${colName(FIRST + k)}${cumRow}/$${colName(TOTAL)}$${tot})` }), PCT)
  summary('Retention held', (m) => byMonth.get(m)?.retention ?? null)
  summary('Payment after retention', (m) => byMonth.get(m)?.netMonth ?? null)

  // ---- issued VOs: at risk, not in the totals ----
  const risk = items.filter((i) => i.kind === 'vo_risk')
  if (risk.length) {
    r += 2
    put(ws, r, 1, 'Issued variations (not yet agreed, not included above)', { bold: true, bg: RISK })
    for (let c = 2; c <= TOTAL; c++) fill(ws.getRow(r).getCell(c), RISK)
    r++
    for (const it of risk) line(it.label, rowOf.get(it.key)?.months ?? [], { italic: true })
  }

  // ---- actuals from Applications ----
  if (actuals.length) {
    r += 2
    put(ws, r, 1, 'Actual (from the applications)', { bold: true, bg: HEAD })
    for (let c = 2; c <= TOTAL; c++) fill(ws.getRow(r).getCell(c), HEAD)
    r++
    const byA = new Map(actuals.map((a) => [a.month, a]))
    const actual = (label: string, pick: (a: Actual) => number | null) => {
      put(ws, r, 1, label)
      months.forEach((m, k) => {
        const a = byA.get(m)
        put(ws, r, FIRST + k, a ? pick(a) : null, { fmt: GBP })
      })
      put(ws, r, TOTAL, { formula: `SUM(${L}${r}:${R}${r})` }, { fmt: GBP, bold: true })
      r++
    }
    if (internal) actual('Applied (gross)', (a) => a.applied)
    actual('Certified (gross)', (a) => a.certified)
    actual('Paid', (a) => a.paid)
  }

  const scale = setupPage(ws, widths, r, 'landscape', `${H}:${H}`)
  placeLogo(ws, logoId, widths, scale)
  const d = today.toLocaleDateString('en-GB').replace(/\//g, '.')
  await download(wb, `${safeName(`${job.job_no} ${job.code} - Cashflow${internal ? ' (internal)' : ''} ${d}`)}.xlsx`)
}
