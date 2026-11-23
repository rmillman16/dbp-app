// The sampling tracker to Excel (scope 19 Nov: "Excel tracker grouped by material group"; saved to
// EXTERNAL/02. Design/Sampling/). Red: due and not yet submitted. Amber: the specification changed
// after the sample was approved (resample, possible VO).
import type { Cell, Worksheet } from 'exceljs'
import { download, excelDate, fill, newWorkbook, placeLogo, safeName, setupPage } from './excel'
import { MATERIAL_GROUPS, SAMPLE_STATUS_LABELS, SAMPLE_TYPE_LABELS, overdue, type Sample } from './sampling'
import type { Company, Job } from './types'

const DATE = 'dd/mm/yyyy'
const HEAD = 'FFDCE6F1'
const GROUP = 'FFEEF3FA'
const LATE = 'FFFDECEA'
const CHANGED = 'FFFFF4D6'
const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }

function put(ws: Worksheet, r: number, c: number, v: Cell['value'], o: { bold?: boolean; fmt?: string; size?: number; italic?: boolean; wrap?: boolean } = {}) {
  const cell = ws.getRow(r).getCell(c)
  cell.value = v
  cell.font = { name: 'Calibri', size: o.size ?? 10, bold: o.bold, italic: o.italic }
  if (o.fmt) cell.numFmt = o.fmt
  cell.alignment = { vertical: 'top', wrapText: o.wrap }
  return cell
}

export async function exportSampling(job: Job, samples: Sample[], companies: Company[], today: string) {
  const { wb, logoId } = await newWorkbook()
  const ws = wb.addWorksheet('Sampling', { views: [{ state: 'frozen', ySplit: 7, showGridLines: false }] })
  const supplier = (s: Sample) => companies.find((c) => c.id === s.supplier_company_id)?.name ?? null
  type Col = { head: string; width: number; value: (s: Sample) => Cell['value']; fmt?: string; wrap?: boolean }
  const cols: Col[] = [
    { head: 'Code', width: 11, value: (s) => s.code },
    { head: 'Supplier', width: 20, value: supplier, wrap: true },
    { head: 'Description', width: 26, value: (s) => s.description, wrap: true },
    { head: 'Specification', width: 32, value: (s) => s.specification, wrap: true },
    { head: 'Locations', width: 14, value: (s) => (s.locations ?? []).join(', '), wrap: true },
    { head: 'Qty', width: 8, value: (s) => s.quantity ?? null, wrap: true },
    { head: 'Type', width: 12, value: (s) => SAMPLE_TYPE_LABELS[s.sample_type] },
    { head: 'Status', width: 16, value: (s) => SAMPLE_STATUS_LABELS[s.status] + (s.changed_after_approval ? ' (spec changed since)' : ''), wrap: true },
    { head: 'Requested', width: 11, value: (s) => excelDate(s.requested_date), fmt: DATE },
    { head: 'Due', width: 11, value: (s) => excelDate(s.due_date), fmt: DATE },
    { head: 'Submitted', width: 11, value: (s) => excelDate(s.submitted_date), fmt: DATE },
    { head: 'Signed off', width: 11, value: (s) => excelDate(s.decision_date), fmt: DATE },
    { head: 'Decided by', width: 14, value: (s) => s.decided_by, wrap: true },
    { head: 'Designer comments', width: 30, value: (s) => s.designer_comments, wrap: true },
    { head: 'Stored at', width: 14, value: (s) => s.stored_location, wrap: true },
  ]
  const widths = cols.map((c) => c.width)

  put(ws, 1, 1, 'Sample tracker', { bold: true, size: 14 })
  put(ws, 3, 1, `${job.job_no} ${job.code} · ${job.name}`, { bold: true })
  put(ws, 4, 1, `Prepared ${today.split('-').reverse().join('/')}`)
  put(ws, 5, 1, 'Red: due and not yet submitted. Amber: specification changed after approval (resample, possible variation).', { italic: true, size: 9 })

  let r = 7
  cols.forEach((c, i) => {
    const cell = put(ws, r, i + 1, c.head, { bold: true, wrap: true })
    fill(cell, HEAD)
    cell.border = { bottom: thin }
  })
  ws.getRow(r).height = 28
  r++
  const groups = [...MATERIAL_GROUPS, ...new Set(samples.map((s) => s.material_group).filter((g) => !MATERIAL_GROUPS.includes(g)))]
  for (const g of groups) {
    const list = samples.filter((s) => s.material_group === g)
    if (!list.length) continue
    put(ws, r, 1, `${g.toUpperCase()} (${list.length})`, { bold: true, size: 9 })
    for (let c = 1; c <= cols.length; c++) fill(ws.getRow(r).getCell(c), GROUP)
    r++
    for (const s of list) {
      const flag = overdue(s, today) ? LATE : s.changed_after_approval ? CHANGED : null
      cols.forEach((c, i) => {
        const cell = put(ws, r, i + 1, c.value(s), { fmt: c.fmt, wrap: c.wrap })
        cell.border = { bottom: thin }
        if (flag) fill(cell, flag)
      })
      r++
    }
  }
  const scale = setupPage(ws, widths, r, 'landscape', '7:7')
  placeLogo(ws, logoId, widths, scale)
  await download(wb, `${safeName(`${job.job_no} ${job.code} - Sample Tracker ${today.split('-').reverse().join('.')}`)}.xlsx`)
}
