// The buyer's list (material or hire) to Excel: whatever the list is showing (filters and search applied), one row per requisition.
import { download, excelDate, fill, newWorkbook, safeName } from './excel'
import { isDefectsJob, jobLabel, reqRef, statusLabel, ADMIN_LIST_NAME, type ReqKind, type Requisition } from './requisitions'
import type { Job } from './types'

export async function exportRequisitions(kind: ReqKind, rows: Requisition[], jobs: Job[]) {
  const { wb } = await newWorkbook()
  const hire = kind === 'hire'
  const ws = wb.addWorksheet(hire ? 'Hire requisitions' : 'Material requisitions', { views: [{ state: 'frozen', ySplit: 2, showGridLines: false }] })
  const byId = new Map(jobs.map((j) => [j.id, j]))
  ws.getCell('A1').value = `${ADMIN_LIST_NAME[kind]}: ${rows.length} requisition${rows.length === 1 ? '' : 's'}, issued ${new Date().toLocaleDateString('en-GB')}`
  ws.getCell('A1').font = { bold: true, size: 13 }

  const cols: [string, number, (r: Requisition) => string | number | Date | null][] = [
    ['Ref', 9, (r) => reqRef(r)],
    ['Site', 34, (r) => jobLabel(byId.get(r.job_id))],
    ['Defect work for', 28, (r) => (isDefectsJob(byId.get(r.job_id)) ? ((r.data?.original_job as string) ?? '') : null)],
    ...(hire ? [] : ([['Element of work', 22, (r: Requisition) => r.element]] as [string, number, (r: Requisition) => string][])),
    [hire ? 'Hire requisition' : 'Materials required', 55, (r) => r.details],
    [hire ? 'Hire start' : 'Required by', 12, (r) => (r.required_by ? excelDate(r.required_by) : null)],
    ...(hire ? ([['Hire end', 12, (r: Requisition) => (r.data?.hire_end ? excelDate(r.data.hire_end as string) : null)]] as [string, number, (r: Requisition) => Date | null][]) : []),
    ['Requested by', 22, (r) => r.requester_name ?? ''],
    ['Raised on', 12, (r) => excelDate(r.created_at.slice(0, 10))],
    ['Status', 14, (r) => statusLabel(r.status, r.kind)],
    [hire ? 'Hire company' : 'Supplier', 24, (r) => r.supplier ?? ''],
    ['PO number', 12, (r) => r.po_number ?? ''],
    ['Order value (£)', 14, (r) => r.order_value],
    ['Order date', 12, (r) => (r.order_date ? excelDate(r.order_date) : null)],
    [hire ? 'On site' : 'Delivery date', 12, (r) => (r.delivery_date ? excelDate(r.delivery_date) : null)],
    ['Notes', 36, (r) => r.notes ?? ''],
    ['Buyer notes', 36, (r) => (r.data?.buyer_notes as string) ?? ''],
  ]
  cols.forEach(([h, w], i) => {
    const c = ws.getCell(2, i + 1)
    c.value = h
    c.font = { bold: true }
    c.alignment = { wrapText: true, vertical: 'middle' }
    fill(c, 'FFDCE6F1')
    ws.getColumn(i + 1).width = w
  })
  rows.forEach((r, k) => {
    cols.forEach(([h, , get], i) => {
      const c = ws.getCell(3 + k, i + 1)
      c.value = get(r)
      c.alignment = { vertical: 'top', wrapText: /required|notes|Site|Defect/i.test(h) }
      if (/date|start|end|by$|on site|raised/i.test(h) && c.value instanceof Date) c.numFmt = 'dd/mm/yyyy'
      if (h.startsWith('Order value')) c.numFmt = '#,##0.00'
    })
  })
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } }
  await download(wb, `${safeName(`${ADMIN_LIST_NAME[kind]} ${new Date().toLocaleDateString('en-GB').replace(/\//g, '.')}`)}.xlsx`)
}
