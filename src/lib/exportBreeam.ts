// The BREEAM tracker to Excel: a Score Overview sheet, then the Credit Tracker laid out like the assessor's (a heading row per
// section, the lines, a totals row), each status coloured, ready to send back.
import { download, excelDate, fill, newWorkbook, safeName } from './excel'
import { scoreOverview, statusLabel, type BreeamItem } from './breeam'
import type { Job } from './types'

const FILL: Record<string, string> = { completed: 'FFE2F0D9', in_progress: 'FFFFF2CC', not_complete: 'FFFDECEA', by_others: 'FFE3F1FA', no_action: 'FFEDEDED' }

export async function exportBreeam(job: Job, items: BreeamItem[]) {
  const { wb } = await newWorkbook()
  const title = `BREEAM tracker: ${job.job_no} ${job.code} ${job.name}`
  const score = scoreOverview(items)

  // ---- Score Overview
  const so = wb.addWorksheet('Score Overview', { views: [{ showGridLines: false }] })
  so.getCell('A1').value = title
  so.getCell('A1').font = { bold: true, size: 14 }
  so.getCell('A2').value = `Issued ${new Date().toLocaleDateString('en-GB')}`
  const sh = ['Section', 'Credits achieved', 'Credits targeted', 'Credits available', '% of target achieved', 'Still to get']
  sh.forEach((h, i) => {
    const c = so.getCell(4, i + 1)
    c.value = h
    c.font = { bold: true }
    c.alignment = { wrapText: true, vertical: 'middle' }
    fill(c, 'FFDCE6F1')
  })
  ;[...score.rows, score.total].forEach((r, k) => {
    const row = 5 + k
    ;[r.category, r.achieved, r.targeted, r.available, r.targeted > 0 ? r.achieved / r.targeted : 0, Math.max(0, r.targeted - r.achieved)].forEach((v, i) => {
      const c = so.getCell(row, i + 1)
      c.value = v
      if (i === 4) c.numFmt = '0%'
      if (r === score.total) c.font = { bold: true }
    })
  })
  ;[26, 12, 12, 12, 14, 12].forEach((w, i) => (so.getColumn(i + 1).width = w))

  // ---- Credit Tracker
  const ws = wb.addWorksheet('Credit Tracker', { views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] })
  ws.getCell('A1').value = title
  ws.getCell('A1').font = { bold: true, size: 14 }
  const heads = ['Ref', 'Credit', 'Credits available', 'Credits targeted', 'Credits achieved', 'Credit criteria', 'Evidence required', 'Action', 'Status', 'Due', 'Comments']
  const widths = [9, 30, 10, 10, 10, 60, 45, 26, 18, 12, 40]
  heads.forEach((h, i) => {
    const c = ws.getCell(3, i + 1)
    c.value = h
    c.font = { bold: true }
    c.alignment = { wrapText: true, vertical: 'middle' }
    fill(c, 'FF92D050')
    ws.getColumn(i + 1).width = widths[i]
  })
  let r = 4
  const cats = [...new Set(items.map((i) => i.category || 'Other'))]
  for (const cat of cats) {
    ws.mergeCells(r, 1, r, heads.length)
    ws.getCell(r, 1).value = cat
    ws.getCell(r, 1).font = { bold: true, size: 12 }
    fill(ws.getCell(r, 1), 'FFDCE6F1')
    r++
    for (const it of items.filter((x) => (x.category || 'Other') === cat)) {
      const p = it.prerequisite ? 'P' : null
      ;[it.ref, it.title, it.credits_available ?? p, it.credits_targeted ?? p, it.credits_achieved ?? p, it.criteria, it.evidence, it.responsible, statusLabel(it.status), it.due_date ? excelDate(it.due_date) : null, it.comments].forEach((v, i) => {
        const c = ws.getCell(r, i + 1)
        c.value = v
        c.alignment = { vertical: 'top', wrapText: [1, 5, 6, 7, 10].includes(i), horizontal: i >= 2 && i <= 4 ? 'center' : undefined }
        if (i === 9) c.numFmt = 'dd/mm/yyyy'
      })
      fill(ws.getCell(r, 9), FILL[it.status])
      r++
    }
    const s = score.rows.find((x) => x.category === cat)
    if (s) {
      ws.getCell(r, 1).value = `${cat.trim()} totals:`
      ;[s.available, s.targeted, s.achieved].forEach((v, i) => (ws.getCell(r, 3 + i).value = v))
      ws.getRow(r).font = { bold: true }
      for (let c = 1; c <= heads.length; c++) fill(ws.getCell(r, c), 'FFF2F2F2')
      r++
    }
  }
  await download(wb, `${safeName(`${job.job_no} ${job.code} - BREEAM tracker ${new Date().toLocaleDateString('en-GB').replace(/\//g, '.')}`)}.xlsx`)
}
