// The submittal register as Excel and as a PDF report (23 Nov), as for RFIs. Both take the same rows; the "outstanding"
// report is the same with only those still out for review. Excel: the register (filterable) and every revision.
import { todayIso, ukDate } from './format'
import { SUBMITTAL_STATUS, OUTCOMES, daysOut, isLate, revLetter, typeLabel, type Revision, type Submittal } from './submittals'
import { htmlToText } from './richText'
import { downloadBlob } from './letter'
import { download, excelDate, newWorkbook, safeName } from './excel'
import type { ReportOwner } from './exportRfis'

export interface SubmittalRow {
  s: Submittal
  submittedBy: string
  reviewers: string
  cc: string
  manager: string
  revisions: Revision[]
}
const outcomeLabel = (o: string | null) => OUTCOMES.find(([k]) => k === o)?.[1] ?? ''
const fileBase = (o: ReportOwner, title: string) => safeName(`${o.ref} ${title} ${todayIso()}`)

export async function exportSubmittalsExcel(owner: ReportOwner, rows: SubmittalRow[], title = 'Submittal register') {
  const { wb } = await newWorkbook()
  const ws = wb.addWorksheet('Submittals', { views: [{ state: 'frozen', ySplit: 4 }] })
  const cols: [string, number][] = [
    ['No.', 6], ['Title', 38], ['Type', 16], ['Trade', 14], ['Submitted by', 24], ['Reviewers', 28], ['Manager', 18], ['Rev', 6], ['Status', 18],
    ['Submitted', 12], ['Return by', 12], ['Responded', 12], ['Days out', 9], ['Needed on site', 13], ['Latest response', 50],
  ]
  ws.getCell('A1').value = `${owner.ref} ${owner.name}`
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.getCell('A2').value = `${title}, ${ukDate(todayIso())} (${rows.length} submittal${rows.length === 1 ? '' : 's'})`
  cols.forEach(([h, w], i) => {
    ws.getColumn(i + 1).width = w
    const c = ws.getRow(4).getCell(i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F1246' } }
  })
  const today = todayIso()
  const fills: Record<string, string> = { draft: 'FFEDEDED', out: 'FFFFF2CC', approved: 'FFE2F0D9', approved_noted: 'FFE2F0D9', revise: 'FFFCE4D6', rejected: 'FFF8CBAD', void: 'FFEDEDED' }
  rows.forEach(({ s, submittedBy, reviewers, manager, revisions }, i) => {
    const row = ws.getRow(5 + i)
    const iso = (x: string | null) => (x ? excelDate(x.slice(0, 10)) : null)
    const last = [...revisions].reverse().find((r) => r.outcome)
    ;[
      s.number, s.title, typeLabel(s.type), s.trade ?? '', submittedBy, reviewers, manager, revLetter(s.current_rev), SUBMITTAL_STATUS[s.status],
      iso(s.submitted_at), iso(s.due_date), iso(s.responded_at), s.submitted_at ? daysOut(s, today) : null, iso(s.required_by),
      last ? `${outcomeLabel(last.outcome)}${last.response_notes ? ': ' + htmlToText(last.response_notes) : ''}` : '',
    ].forEach((v, k) => {
      const c = row.getCell(k + 1)
      c.value = v as never
      c.alignment = { vertical: 'top', wrapText: k === 1 || k === 4 || k === 5 || k === 14 }
      if ([9, 10, 11, 13].includes(k)) c.numFmt = 'dd/mm/yyyy'
    })
    if (isLate(s, today)) row.getCell(11).font = { color: { argb: 'FFC00000' }, bold: true }
    row.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fills[s.status] } }
  })
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: cols.length } }
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }

  const rs = wb.addWorksheet('Revisions')
  ;['No.', 'Title', 'Rev', 'Submitted', 'Return by', 'Response', 'Responded', 'By', 'Notes'].forEach((h, i) => {
    const c = rs.getRow(1).getCell(i + 1)
    c.value = h
    c.font = { bold: true }
  })
  ;[6, 34, 6, 12, 12, 20, 12, 20, 90].forEach((w, i) => (rs.getColumn(i + 1).width = w))
  let n = 2
  for (const { s, revisions } of rows)
    for (const r of revisions) {
      ;[s.number, s.title, revLetter(r.rev), r.submitted_on ? excelDate(r.submitted_on) : null, r.due_date ? excelDate(r.due_date) : null, outcomeLabel(r.outcome), r.responded_on ? excelDate(r.responded_on) : null, r.responded_by ?? '', htmlToText(r.response_notes)].forEach((x, k) => {
        const c = rs.getRow(n).getCell(k + 1)
        c.value = x as never
        c.alignment = { vertical: 'top', wrapText: k === 8 }
        if (k === 3 || k === 4 || k === 6) c.numFmt = 'dd/mm/yyyy'
      })
      n++
    }
  await download(wb, `${fileBase(owner, title)}.xlsx`)
}

type PdfLib = typeof import('pdf-lib')
const W = 841.89
const H = 595.28
const M = 36
const clean = (s: string) => s.replace(/[•]/g, '-').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/\t/g, ' ').replace(/[^\n\x20-\x7e\xa0-\xff]/g, '?')

export async function exportSubmittalsPdf(owner: ReportOwner, rows: SubmittalRow[], title = 'Submittal register') {
  const PDFLib: PdfLib = await import('pdf-lib')
  const doc = await PDFLib.PDFDocument.create()
  doc.setTitle(`${owner.ref} ${owner.name}: ${title}`)
  doc.setCreator('DBP app')
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica)
  const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold)
  const navy = PDFLib.rgb(0.12, 0.07, 0.27)
  const grey = PDFLib.rgb(0.42, 0.42, 0.47)
  const red = PDFLib.rgb(0.75, 0, 0)
  const today = todayIso()
  const cols = [
    { h: 'No.', w: 28 }, { h: 'Title', w: 170 }, { h: 'Type', w: 66 }, { h: 'Submitted by', w: 100 }, { h: 'Reviewers', w: 120 },
    { h: 'Rev', w: 26 }, { h: 'Return by', w: 60 }, { h: 'Status', w: 96 }, { h: 'Out', w: 34 }, { h: 'Needed', w: 60 },
  ]
  const wrap = (text: string, width: number, size: number) => {
    const out: string[] = []
    for (const para of clean(text).split('\n')) {
      let line = ''
      for (const word of para.split(' ')) {
        const t = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(t, size) <= width) line = t
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
  const head = (first: boolean) => {
    if (first) {
      page.drawText(clean(`${owner.ref} ${owner.name}`), { x: M, y, size: 15, font: bold, color: navy })
      y -= 18
      page.drawText(clean(`${title} - ${ukDate(today)} - ${rows.length} submittal${rows.length === 1 ? '' : 's'}`), { x: M, y, size: 10, font, color: grey })
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
  head(true)
  for (const { s, submittedBy, reviewers, revisions } of rows) {
    const cells = [
      String(s.number), s.title, typeLabel(s.type), submittedBy || '-', reviewers || '-', revLetter(s.current_rev),
      s.due_date ? ukDate(s.due_date) : '-', SUBMITTAL_STATUS[s.status], s.submitted_at ? `${daysOut(s, today)}d` : '-', s.required_by ? ukDate(s.required_by) : '-',
    ]
    const wrapped = cells.map((t, i) => wrap(t, cols[i].w - 6, 8))
    const last = [...revisions].reverse().find((r) => r.outcome)
    const note = last ? wrap(`Latest response (Rev ${revLetter(last.rev)}, ${outcomeLabel(last.outcome)}${last.responded_by ? ', ' + last.responded_by : ''}): ${htmlToText(last.response_notes)}`, W - 2 * M - 12, 8).slice(0, 4) : []
    const height = Math.max(...wrapped.map((w) => w.length)) * 10 + note.length * 10 + 8
    if (y - height < M + 14) {
      page = doc.addPage([W, H])
      y = H - M
      head(false)
    }
    let x = M
    wrapped.forEach((lines, i) => {
      lines.forEach((ln, k) => page.drawText(ln, { x, y: y - k * 10, size: 8, font: i < 2 ? bold : font, color: i === 6 && isLate(s, today) ? red : PDFLib.rgb(0.1, 0.1, 0.14) }))
      x += cols[i].w
    })
    let yy = y - Math.max(...wrapped.map((w) => w.length)) * 10
    for (const ln of note) {
      page.drawText(ln, { x: M + 8, y: yy, size: 8, font, color: PDFLib.rgb(0, 0.35, 0.2) })
      yy -= 10
    }
    y -= height
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.4, color: PDFLib.rgb(0.85, 0.85, 0.88) })
  }
  const pages = doc.getPages()
  pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 50, y: 18, size: 8, font, color: grey }))
  downloadBlob(new Blob([(await doc.save()) as BlobPart], { type: 'application/pdf' }), `${fileBase(owner, title)}.pdf`)
}
