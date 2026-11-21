// The procurement schedule to Excel (docs/decisions.md "Procurement: built"). Two copies:
// - internal (full): package, supply / install, CDP, budget (cost), subcontractor, order value and
//   its difference to budget, order no. / date, design weeks, lead time, required on site (marked
//   provisional where it's from the programme activities matching the package), order by, status,
//   comments; red when the order date has passed without an order, amber within 2 weeks
// - client (decided 19 Nov, for progress reports): package, lead time and status only, with no
//   subcontractors, budgets or values
// Section A the SoW's packages by works group, section B the issued and agreed VOs.
import type { Cell, Worksheet } from 'exceljs'
import { download, excelDate, fill, newWorkbook, placeLogo, safeName, setupPage } from './excel'
import type { ProcRow } from './procurement'
import { rowDates, STATUS_LABELS, SUPPLY_LABELS } from './procurementCalc'
import type { ProgrammeTask } from './programme'
import type { Company, Job } from './types'

const GBP = '£#,##0;[Red]-£#,##0'
const DATE = 'dd/mm/yyyy'
const HEAD = 'FFDCE6F1'
const GROUP = 'FFEEF3FA'
const LATE = 'FFFDECEA'
const SOON = 'FFFFF4D6'
const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }

function put(
  ws: Worksheet,
  r: number,
  c: number,
  v: Cell['value'],
  o: { bold?: boolean; fmt?: string; size?: number; italic?: boolean; align?: 'left' | 'right' | 'center'; wrap?: boolean } = {},
) {
  const cell = ws.getRow(r).getCell(c)
  cell.value = v
  cell.font = { name: 'Calibri', size: o.size ?? 10, bold: o.bold, italic: o.italic }
  if (o.fmt) cell.numFmt = o.fmt
  cell.alignment = { horizontal: o.align, vertical: 'top', wrapText: o.wrap }
  return cell
}

export interface ProcurementExport {
  job: Job
  contract: ProcRow[]
  variations: ProcRow[]
  tasks: ProgrammeTask[]
  companies: Company[]
  copy: 'internal' | 'client'
}

export async function exportProcurement({ job, contract, variations, tasks, companies, copy }: ProcurementExport) {
  const internal = copy === 'internal'
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const { wb, logoId } = await newWorkbook()
  const ws = wb.addWorksheet('Procurement', { views: [{ state: 'frozen', ySplit: 7, showGridLines: false }] })

  type Col = { head: string; width: number; value: (r: ProcRow) => Cell['value']; fmt?: string; align?: 'right' | 'center'; wrap?: boolean; italic?: (r: ProcRow) => boolean }
  const company = (r: ProcRow) => companies.find((c) => c.id === r.company_id)?.name ?? null
  const dates = (r: ProcRow) => rowDates(r, tasks, today)
  const cols: Col[] = internal
    ? [
        { head: 'Package', width: 34, value: (r) => r.label, wrap: true },
        { head: 'Supply / install', width: 13, value: (r) => (r.supply_install ? SUPPLY_LABELS[r.supply_install] : null) },
        { head: 'CDP', width: 6, value: (r) => (r.cdp ? 'Yes' : null), align: 'center' },
        { head: 'Budget (cost)', width: 13, value: (r) => (r.budget ? r.budget : null), fmt: GBP, align: 'right' },
        { head: 'Subcontractor', width: 24, value: company, wrap: true },
        { head: 'Order value', width: 13, value: (r) => r.order_value, fmt: GBP, align: 'right' },
        { head: '± budget', width: 11, value: (r) => (r.order_value != null && r.budget ? Math.round((r.order_value - r.budget) * 100) / 100 : null), fmt: GBP, align: 'right' },
        { head: 'Order no.', width: 14, value: (r) => r.order_no },
        { head: 'Order date', width: 11, value: (r) => excelDate(r.order_date), fmt: DATE },
        { head: 'Design (wks)', width: 9, value: (r) => r.design_weeks, align: 'center' },
        { head: 'Lead time (wks)', width: 9, value: (r) => r.lead_weeks, align: 'center' },
        { head: 'Required on site', width: 12, value: (r) => excelDate(dates(r).onSite), fmt: DATE, italic: (r) => dates(r).from === 'provisional' },
        { head: 'Order by', width: 11, value: (r) => excelDate(dates(r).orderBy), fmt: DATE },
        { head: 'Status', width: 16, value: (r) => STATUS_LABELS[r.status], wrap: true },
        { head: 'Comments', width: 30, value: (r) => r.comments, wrap: true },
      ]
    : [
        { head: 'Package', width: 40, value: (r) => r.label, wrap: true },
        { head: 'Lead time (weeks)', width: 14, value: (r) => r.lead_weeks, align: 'center' },
        { head: 'Status', width: 24, value: (r) => STATUS_LABELS[r.status], wrap: true },
      ]
  const widths = cols.map((c) => c.width)
  const last = cols.length

  // ---- header ----
  put(ws, 1, 1, 'Procurement schedule', { bold: true, size: 14 })
  put(ws, 3, 1, `${job.job_no} ${job.code} · ${job.name}`, { bold: true })
  put(ws, 4, 1, `Prepared ${today.split('-').reverse().join('/')}`)
  if (internal)
    put(
      ws,
      5,
      1,
      'Red: the order date has passed without an order. Amber: order due within 2 weeks. Required on site in italics is provisional (from the programme activities matching the package).',
      { italic: true, size: 9 },
    )

  let r = 7
  const header = () => {
    cols.forEach((c, i) => {
      const cell = put(ws, r, i + 1, c.head, { bold: true, align: c.align, wrap: true })
      fill(cell, HEAD)
      cell.border = { bottom: thin }
    })
    ws.getRow(r).height = 28
    r++
  }
  const heading = (t: string) => {
    put(ws, r, 1, t.toUpperCase(), { bold: true, size: 9 })
    for (let c = 1; c <= last; c++) fill(ws.getRow(r).getCell(c), GROUP)
    r++
  }
  const rows = (list: ProcRow[], groups: boolean) => {
    let group = ''
    for (const row of list) {
      if (groups && row.group !== group) heading((group = row.group))
      const flag = internal ? dates(row).flag : null
      cols.forEach((c, i) => {
        const cell = put(ws, r, i + 1, c.value(row), { fmt: c.fmt, align: c.align, wrap: c.wrap, italic: c.italic?.(row) })
        cell.border = { bottom: thin }
        if (flag) fill(cell, flag === 'late' ? LATE : SOON)
      })
      r++
    }
  }

  header()
  put(ws, r++, 1, 'A · Contract packages', { bold: true, size: 11 })
  rows(contract, true)
  if (internal) {
    // the budget and order totals
    const bc = cols.findIndex((c) => c.head === 'Budget (cost)') + 1
    const oc = cols.findIndex((c) => c.head === 'Order value') + 1
    put(ws, r, 1, 'Total', { bold: true })
    put(
      ws,
      r,
      bc,
      contract.reduce((s, x) => s + x.budget, 0),
      { fmt: GBP, bold: true, align: 'right' },
    )
    put(
      ws,
      r,
      oc,
      contract.reduce((s, x) => s + Number(x.order_value ?? 0), 0),
      { fmt: GBP, bold: true, align: 'right' },
    )
    r++
  }
  if (variations.length) {
    r++
    put(ws, r++, 1, 'B · Variations', { bold: true, size: 11 })
    rows(variations, false)
  }

  const scale = setupPage(ws, widths, r, 'landscape', '7:7')
  placeLogo(ws, logoId, widths, scale)
  const day = today.split('-').reverse().join('.')
  await download(wb, `${safeName(`${job.job_no} ${job.code} - Procurement Schedule${internal ? '' : ' (client)'} ${day}`)}.xlsx`)
}
