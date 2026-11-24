// The BREEAM tracker to Excel: grouped by category, each line with its status coloured, ready to send to the assessor.
import { download, excelDate, fill, newWorkbook, safeName } from './excel'
import { statusLabel, type BreeamItem } from './breeam'
import type { Job } from './types'

const FILL: Record<string, string> = { completed: 'FFE2F0D9', in_progress: 'FFFFF2CC', not_complete: 'FFFDECEA', by_others: 'FFE3F1FA', no_action: 'FFEDEDED' }

export async function exportBreeam(job: Job, items: BreeamItem[]) {
  const { wb } = await newWorkbook()
  const ws = wb.addWorksheet('BREEAM', { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] })
  ws.getCell('A1').value = `BREEAM tracker: ${job.job_no} ${job.code} ${job.name}`
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.getCell('A2').value = `Issued ${new Date().toLocaleDateString('en-GB')}`
  const heads = ['Ref', 'Category', 'Issue / credit', 'Credits available', 'Credits targeted', 'Responsible', 'Status', 'Due', 'Comments']
  const widths = [9, 22, 52, 11, 11, 24, 20, 12, 52]
  heads.forEach((h, i) => {
    const c = ws.getCell(4, i + 1)
    c.value = h
    c.font = { bold: true }
    c.alignment = { wrapText: true, vertical: 'middle' }
    fill(c, 'FFDCE6F1')
    ws.getColumn(i + 1).width = widths[i]
  })
  items.forEach((it, k) => {
    const r = 5 + k
    ;[it.ref, it.category, it.title, it.credits_available, it.credits_targeted, it.responsible, statusLabel(it.status), it.due_date ? excelDate(it.due_date) : null, it.comments].forEach((v, i) => {
      const c = ws.getCell(r, i + 1)
      c.value = v
      c.alignment = { vertical: 'top', wrapText: i === 2 || i === 8 }
      if (i === 7) c.numFmt = 'dd/mm/yyyy'
    })
    fill(ws.getCell(r, 7), FILL[it.status])
  })
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + items.length, column: heads.length } }
  await download(wb, `${safeName(`${job.job_no} ${job.code} - BREEAM tracker ${new Date().toLocaleDateString('en-GB').replace(/\//g, '.')}`)}.xlsx`)
}
