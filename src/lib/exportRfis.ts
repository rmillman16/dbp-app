// The RFI register as Excel and as a PDF report (23 Nov). Both take the same rows, so the weekly "unanswered RFIs"
// report is just this with only the open ones. Excel: the register (filterable) and every reply. PDF: A4 landscape,
// the register table with the question under each RFI.
import type { Job } from './types'
import { todayIso, ukDate } from './format'
import { STATUS_LABELS, chaseLabel, daysOpen, isOverdue, type Rfi } from './rfis'
import { htmlToText } from './richText'
import { downloadBlob } from './letter'
import { download, excelDate, newWorkbook, safeName } from './excel'

export interface RegisterRow {
  rfi: Rfi
  assignees: string
  cc: string
  manager: string
  receivedFrom: string
  replies: { at: string; by: string; kind: string; text: string }[]
}
const fileBase = (job: Pick<Job, 'job_no' | 'code'>, title: string) => safeName(`${job.job_no} ${job.code} ${title} ${todayIso()}`)

// ---------- Excel ----------
export async function exportRfisExcel(job: Pick<Job, 'job_no' | 'code' | 'name'>, rows: RegisterRow[], title = 'RFI register') {
  const { wb } = await newWorkbook()
  const ws = wb.addWorksheet('RFIs', { views: [{ state: 'frozen', ySplit: 4 }] })
  const cols: [string, number][] = [
    ['RFI', 7], ['Title', 38], ['Status', 11], ['Trade', 14], ['Assignees', 30], ['RFI manager', 18], ['Received from', 24], ['Cc', 26],
    ['Created', 12], ['Due', 12], ['Answered', 12], ['Closed', 12], ['Days open', 10], ['Chased', 15], ['Question', 60],
  ]
  ws.getCell('A1').value = `${job.job_no} ${job.code} ${job.name}`
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.getCell('A2').value = `${title}, ${ukDate(todayIso())} (${rows.length} RFI${rows.length === 1 ? '' : 's'})`
  const head = ws.getRow(4)
  cols.forEach(([h, w], i) => {
    ws.getColumn(i + 1).width = w
    const c = head.getCell(i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F1246' } }
  })
  const today = todayIso()
  rows.forEach(({ rfi: r, assignees, cc, manager, receivedFrom }, i) => {
    const row = ws.getRow(5 + i)
    const iso = (s: string | null) => (s ? excelDate(s.slice(0, 10)) : null)
    ;[
      r.number, r.title, STATUS_LABELS[r.status], r.trade ?? '', assignees, manager, receivedFrom, cc, iso(r.created_at), iso(r.due_date), iso(r.answered_at), iso(r.closed_at),
      daysOpen(r, today), chaseLabel(r.chase_days), htmlToText(r.question),
    ].forEach((v, k) => {
      const c = row.getCell(k + 1)
      c.value = v as never
      c.alignment = { vertical: 'top', wrapText: k === 1 || k === 4 || k === 7 || k === 14 }
      if (k >= 8 && k <= 11) c.numFmt = 'dd/mm/yyyy'
    })
    if (isOverdue(r, today)) row.getCell(10).font = { color: { argb: 'FFC00000' }, bold: true }
    const fillOf: Record<string, string> = { open: 'FFFFF2CC', answered: 'FFDDEBF7', closed: 'FFE2F0D9', void: 'FFEDEDED' }
    row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillOf[r.status] } }
  })
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: cols.length } }
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }

  const rs = wb.addWorksheet('Replies')
  ;['RFI', 'Date', 'From', 'Type', 'Reply'].forEach((h, i) => {
    const c = rs.getRow(1).getCell(i + 1)
    c.value = h
    c.font = { bold: true }
  })
  ;[7, 12, 22, 12, 100].forEach((w, i) => (rs.getColumn(i + 1).width = w))
  let n = 2
  for (const { rfi, replies } of rows)
    for (const p of replies) {
      const v = [rfi.number, excelDate(p.at.slice(0, 10)), p.by, p.kind === 'follow_up' ? 'Follow-up' : p.kind === 'note' ? 'Note' : 'Reply', p.text]
      v.forEach((x, k) => {
        const c = rs.getRow(n).getCell(k + 1)
        c.value = x as never
        c.alignment = { vertical: 'top', wrapText: k === 4 }
        if (k === 1) c.numFmt = 'dd/mm/yyyy'
      })
      n++
    }
  await download(wb, `${fileBase(job, title)}.xlsx`)
}

// ---------- PDF ----------
type PdfLib = typeof import('pdf-lib')
const W = 841.89
const H = 595.28
const M = 36
// the built-in font only shows Latin-1 and a few more
const clean = (s: string) => s.replace(/[•]/g, '-').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/\t/g, ' ').replace(/[^\n\x20-\x7e\xa0-\xff]/g, '?')

export async function exportRfisPdf(job: Pick<Job, 'job_no' | 'code' | 'name'>, rows: RegisterRow[], title = 'RFI register') {
  const PDFLib: PdfLib = await import('pdf-lib')
  const doc = await PDFLib.PDFDocument.create()
  doc.setTitle(`${job.job_no} ${job.code} ${job.name}: ${title}`)
  doc.setCreator('DBP app')
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica)
  const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold)
  const navy = PDFLib.rgb(0.12, 0.07, 0.27)
  const grey = PDFLib.rgb(0.42, 0.42, 0.47)
  const red = PDFLib.rgb(0.75, 0, 0)
  const today = todayIso()

  const cols: { h: string; w: number }[] = [
    { h: 'RFI', w: 34 }, { h: 'Title', w: 190 }, { h: 'Trade', w: 70 }, { h: 'Assigned to', w: 160 }, { h: 'Manager', w: 84 },
    { h: 'Due', w: 62 }, { h: 'Status', w: 58 }, { h: 'Open', w: 40 }, { h: 'Chase', w: 62 },
  ]
  const wrap = (text: string, width: number, size: number, f = font) => {
    const out: string[] = []
    for (const para of clean(text).split('\n')) {
      let line = ''
      for (const word of para.split(' ')) {
        const t = line ? `${line} ${word}` : word
        if (f.widthOfTextAtSize(t, size) <= width) line = t
        else {
          if (line) out.push(line)
          line = word
        }
      }
      out.push(line)
    }
    return out
  }

  let page = doc.addPage([W, H])
  let y = H - M
  const pageHead = (first: boolean) => {
    if (first) {
      page.drawText(clean(`${job.job_no} ${job.code} ${job.name}`), { x: M, y, size: 15, font: bold, color: navy })
      y -= 18
      page.drawText(clean(`${title} - ${ukDate(today)} - ${rows.length} RFI${rows.length === 1 ? '' : 's'}`), { x: M, y, size: 10, font, color: grey })
      y -= 22
    }
    let x = M
    page.drawRectangle({ x: M - 2, y: y - 4, width: W - 2 * M + 4, height: 16, color: PDFLib.rgb(0.93, 0.95, 0.98) })
    for (const c of cols) {
      page.drawText(c.h, { x, y, size: 8, font: bold, color: navy })
      x += c.w
    }
    y -= 18
  }
  pageHead(true)

  for (const { rfi: r, assignees, manager, receivedFrom, replies } of rows) {
    const cells = [
      String(r.number), r.title, r.trade ?? '', assignees || '-', manager || '-',
      r.due_date ? ukDate(r.due_date) : '-', STATUS_LABELS[r.status], String(daysOpen(r, today)), chaseLabel(r.chase_days),
    ]
    const wrapped = cells.map((t, i) => wrap(t, cols[i].w - 6, 8))
    const q = htmlToText(r.question)
    const qLines = q ? wrap(q, W - 2 * M - 12, 8).slice(0, 12) : []
    const last = replies.at(-1)
    const lastLines = last ? wrap(`Last reply (${last.by}, ${ukDate(last.at.slice(0, 10))}): ${last.text}`, W - 2 * M - 12, 8).slice(0, 4) : []
    const extra = (receivedFrom ? 1 : 0) + qLines.length + lastLines.length
    const height = Math.max(...wrapped.map((w) => w.length)) * 10 + extra * 10 + 8
    if (y - height < M + 14) {
      page = doc.addPage([W, H])
      y = H - M
      pageHead(false)
    }
    let x = M
    wrapped.forEach((lines, i) => {
      lines.forEach((ln, k) => page.drawText(ln, { x, y: y - k * 10, size: 8, font: i === 0 || i === 1 ? bold : font, color: i === 5 && isOverdue(r, today) ? red : PDFLib.rgb(0.1, 0.1, 0.14) }))
      x += cols[i].w
    })
    let yy = y - Math.max(...wrapped.map((w) => w.length)) * 10
    if (receivedFrom) {
      page.drawText(clean(`Received from: ${receivedFrom}`), { x: M + 8, y: yy, size: 8, font, color: grey })
      yy -= 10
    }
    for (const ln of qLines) {
      page.drawText(ln, { x: M + 8, y: yy, size: 8, font, color: PDFLib.rgb(0.2, 0.2, 0.25) })
      yy -= 10
    }
    for (const ln of lastLines) {
      page.drawText(ln, { x: M + 8, y: yy, size: 8, font, color: PDFLib.rgb(0, 0.35, 0.2) })
      yy -= 10
    }
    y -= height
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.4, color: PDFLib.rgb(0.85, 0.85, 0.88) })
  }

  const pages = doc.getPages()
  pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 50, y: 18, size: 8, font, color: grey }))
  downloadBlob(new Blob([(await doc.save()) as BlobPart], { type: 'application/pdf' }), `${fileBase(job, title)}.pdf`)
}
