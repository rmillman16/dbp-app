// The progress report as one combined PDF (23 Nov), built in the browser with pdf-lib (nothing is uploaded): cover, contents,
// summary page with status tiles and the key issues, the numbered sections (the numbering closes up when sections are
// switched off), photos, then the appendices: the app's own RFI and submittal reports, and the PDFs / pictures the PM added,
// each behind a divider page. Carlito (as the minutes and O&M exports) with Helvetica as the fall-back. A4.
import type { PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib'
import { todayIso, ukDate } from './format'
import { buildRfisPdf, type RegisterRow } from './exportRfis'
import { buildSubmittalsPdf, type SubmittalRow } from './exportSubmittals'
import { htmlToText } from './richText'
import { countsLine, mergeContent, numbering, reportFileBytes, sectionOn, word, type AutoData, type ProgressReport, type ReportFile } from './progressReports'
import type { Job } from './types'

type PdfLib = typeof import('pdf-lib')
const W = 595.28
const H = 841.89
const M = 50
const CW = W - 2 * M
const NAVY = '#1f1246'
const BLUE = '#007abe'
const INK = '#1d1d24'
const MUTED = '#6b6b78'
const LINE = '#d9d9e0'
const SHADE = '#eef3fa'
const FONTS = ['/minutes/fonts/Carlito-Regular.ttf', '/minutes/fonts/Carlito-Bold.ttf', '/minutes/fonts/Carlito-Italic.ttf']

const SPECIAL = new Map<number, string>([[0x2013, '-'], [0x2014, '-'], [0x2018, "'"], [0x2019, "'"], [0x201c, '"'], [0x201d, '"'], [0x2026, '...'], [0x2022, '-'], [0x20ac, 'EUR'], [0x2192, '->'], [0x2713, ''], [0x26a0, '!']])
function winAnsi(s: string) {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c === 9) out += ' '
    else if ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || c === 10) out += ch
    else out += SPECIAL.get(c) ?? '?'
  }
  return out
}

export interface ReportPdfArgs {
  job: Job
  report: ProgressReport
  auto: AutoData
  files: ReportFile[]
  preparedBy: string
  clientName: string | null
  rfiRows: RegisterRow[] // open RFIs with their replies, for the appended RFI report
  submittalRows: SubmittalRow[]
  onProgress?: (s: string) => void
}

export async function buildReportPdf(a: ReportPdfArgs): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const PDFLib: PdfLib = await import('pdf-lib')
  const { PDFDocument, rgb, StandardFonts } = PDFLib
  const doc = await PDFDocument.create()
  const warnings: string[] = [...a.auto.warnings]
  const c = mergeContent(a.report.content)
  const on = a.report.sections
  const num = numbering(on)
  const hex = (h: string) => {
    const x = h.replace('#', '')
    return rgb(parseInt(x.slice(0, 2), 16) / 255, parseInt(x.slice(2, 4), 16) / 255, parseInt(x.slice(4, 6), 16) / 255)
  }
  doc.setTitle(`${a.job.job_no} ${a.job.code} ${a.job.name}: Progress report ${a.report.report_no}`)
  doc.setCreator('DBP app')

  // fonts
  let regular: PDFFont, bold: PDFFont, italic: PDFFont
  let clean = (s: string) => s.replace(/\t/g, ' ')
  try {
    const [{ default: fontkit }, bytes] = await Promise.all([import('@pdf-lib/fontkit'), Promise.all(FONTS.map((u) => fetch(u).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(u))))))])
    doc.registerFontkit(fontkit)
    ;[regular, bold, italic] = await Promise.all(bytes.map((b) => doc.embedFont(new Uint8Array(b), { subset: false })))
    clean = (s) => s.replace(/\t/g, ' ').replace(/[⚠✓✔]/g, '')
  } catch {
    ;[regular, bold, italic] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold), doc.embedFont(StandardFonts.HelveticaOblique)])
    clean = winAnsi
  }
  const fontOf = { regular, bold, italic }

  // ---------- a small layout engine ----------
  const own: PDFPage[] = [] // pages this builder drew on (they get the footer)
  const marks: { label: string; page: PDFPage; level: number }[] = [] // for the contents page
  let page!: PDFPage
  let y = 0
  const header = () => {
    page.drawText(clean(`${a.job.job_no} ${a.job.code} · ${a.job.name}`), { x: M, y: H - 30, size: 8, font: regular, color: hex(MUTED) })
    const r = clean(`Progress report ${a.report.report_no}`)
    page.drawText(r, { x: W - M - regular.widthOfTextAtSize(r, 8), y: H - 30, size: 8, font: regular, color: hex(MUTED) })
    page.drawLine({ start: { x: M, y: H - 36 }, end: { x: W - M, y: H - 36 }, thickness: 0.5, color: hex(LINE) })
  }
  const newPage = (withHeader = true) => {
    page = doc.addPage([W, H])
    own.push(page)
    y = H - 60
    if (withHeader) header()
    return page
  }
  const ensure = (h: number) => {
    if (y - h < 60) newPage()
  }
  const wrap = (text: string, width: number, size: number, f: PDFFont) => {
    const out: string[] = []
    for (const para of clean(text).split('\n')) {
      let line = ''
      for (const w of para.split(' ')) {
        const t = line ? `${line} ${w}` : w
        if (f.widthOfTextAtSize(t, size) <= width) line = t
        else {
          if (line) out.push(line)
          line = w
        }
      }
      out.push(line)
    }
    return out
  }
  const text = (s: string, o: { size?: number; font?: 'regular' | 'bold' | 'italic'; color?: string; indent?: number; gap?: number } = {}) => {
    if (!s.trim()) return
    const size = o.size ?? 10
    const f = fontOf[o.font ?? 'regular']
    const x = M + (o.indent ?? 0)
    for (const ln of wrap(s, CW - (o.indent ?? 0), size, f)) {
      ensure(size + 4)
      y -= size + 3
      page.drawText(ln, { x, y, size, font: f, color: hex(o.color ?? INK) })
    }
    y -= o.gap ?? 4
  }
  const bullets = (items: string[]) => {
    for (const it of items.map((x) => x.trim()).filter(Boolean)) {
      const lines = wrap(it, CW - 16, 10, regular)
      ensure(lines.length * 13 + 2)
      y -= 13
      page.drawText('•'.replace('•', clean('•') || '-'), { x: M + 4, y, size: 10, font: regular, color: hex(NAVY) })
      lines.forEach((ln, i) => {
        if (i) y -= 13
        page.drawText(ln, { x: M + 16, y, size: 10, font: regular, color: hex(INK) })
      })
      y -= 2
    }
    y -= 4
  }
  const h1 = (n: string, title: string) => {
    ensure(70)
    y -= 12
    const label = n ? `${n}  ${title}` : title
    page.drawRectangle({ x: M, y: y - 6, width: CW, height: 22, color: hex(NAVY) })
    page.drawText(clean(label), { x: M + 8, y: y, size: 12.5, font: bold, color: rgb(1, 1, 1) })
    marks.push({ label, page, level: 0 })
    y -= 22
  }
  const h2 = (n: string, title: string) => {
    ensure(46)
    y -= 8
    const label = n ? `${n}  ${title}` : title
    page.drawText(clean(label), { x: M, y: y - 8, size: 11, font: bold, color: hex(BLUE) })
    marks.push({ label, page, level: 1 })
    y -= 18
  }
  const kv = (rows: [string, string][]) => {
    for (const [k, v] of rows.filter(([, v]) => v && v.trim())) {
      const lines = wrap(v, CW - 150, 10, regular)
      ensure(lines.length * 13 + 2)
      y -= 13
      page.drawText(clean(k), { x: M, y, size: 10, font: bold, color: hex(MUTED) })
      lines.forEach((ln, i) => {
        if (i) y -= 13
        page.drawText(ln, { x: M + 150, y, size: 10, font: regular, color: hex(INK) })
      })
      y -= 2
    }
    y -= 4
  }
  const table = (head: string[], rows: string[][], widths: number[]) => {
    if (!rows.length) return
    const tw = widths.reduce((s, w) => s + w, 0)
    const sc = CW / tw
    const ws = widths.map((w) => w * sc)
    const drawHead = () => {
      ensure(30)
      y -= 14
      page.drawRectangle({ x: M, y: y - 4, width: CW, height: 16, color: hex(SHADE) })
      let x = M + 3
      head.forEach((h, i) => {
        page.drawText(clean(h), { x, y, size: 8.5, font: bold, color: hex(NAVY) })
        x += ws[i]
      })
      y -= 4
    }
    drawHead()
    for (const r of rows) {
      const cells = r.map((t, i) => wrap(t, ws[i] - 6, 9, regular))
      const h = Math.max(...cells.map((x) => x.length)) * 11 + 5
      if (y - h < 60) {
        newPage()
        drawHead()
      }
      let x = M + 3
      cells.forEach((lines, i) => {
        lines.forEach((ln, k) => page.drawText(ln, { x, y: y - 11 - k * 11 + 3, size: 9, font: regular, color: hex(INK) }))
        x += ws[i]
      })
      y -= h
      page.drawLine({ start: { x: M, y: y + 1 }, end: { x: M + CW, y: y + 1 }, thickness: 0.4, color: hex(LINE) })
    }
    y -= 8
  }
  const embed = async (bytes: Uint8Array, name: string): Promise<PDFImage | null> => {
    try {
      if (/\.png$/i.test(name)) return await doc.embedPng(bytes)
      if (/\.jpe?g$/i.test(name)) return await doc.embedJpg(bytes)
    } catch {
      /* fall through */
    }
    warnings.push(`${name}: couldn't be read as a picture (only JPG and PNG can go in).`)
    return null
  }

  // ---------- cover ----------
  newPage(false)
  try {
    const r = await fetch('/dbp-logo.png')
    if (r.ok) {
      const logo = await doc.embedPng(new Uint8Array(await r.arrayBuffer()))
      const s = 170 / logo.width
      page.drawImage(logo, { x: M, y: H - 60 - logo.height * s, width: logo.width * s, height: logo.height * s })
    }
  } catch {
    /* no logo: carry on */
  }
  y = H - 300
  page.drawText(clean(`Progress report ${a.report.report_no}`), { x: M, y, size: 30, font: bold, color: hex(NAVY) })
  y -= 34
  page.drawText(clean(`${a.job.job_no} ${a.job.code}`), { x: M, y, size: 15, font: regular, color: hex(BLUE) })
  y -= 26
  for (const ln of wrap(a.job.name, CW, 22, bold)) {
    page.drawText(ln, { x: M, y, size: 22, font: bold, color: hex(INK) })
    y -= 26
  }
  if (a.job.site_address) {
    for (const ln of wrap(a.job.site_address.replace(/\n/g, ', '), CW, 12, regular)) {
      page.drawText(ln, { x: M, y, size: 12, font: regular, color: hex(MUTED) })
      y -= 16
    }
  }
  y -= 40
  const coverRows: [string, string][] = [
    ['Client', a.clientName ?? ''],
    ['Period', `${ukDate(a.report.period_start)} to ${ukDate(a.report.period_end)}`],
    ['Prepared by', a.preparedBy],
    ['Date', ukDate(a.report.issued_on ?? todayIso())],
    ['Status', a.report.status === 'draft' ? 'Draft' : a.report.status === 'approved' ? 'Approved' : 'Issued'],
  ]
  for (const [k, v] of coverRows.filter(([, v]) => v.trim())) {
    page.drawText(clean(k), { x: M, y, size: 11, font: bold, color: hex(MUTED) })
    page.drawText(clean(v), { x: M + 110, y, size: 11, font: regular, color: hex(INK) })
    y -= 20
  }
  page.drawText('du Boulay Projects Limited', { x: M, y: 60, size: 9, font: regular, color: hex(MUTED) })

  // ---------- summary: status tiles and key issues ----------
  newPage()
  h1('', 'Summary')
  const days = (from: string | null, to: string | null) => (from && to ? Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) : null)
  const slip = days(a.auto.programme?.contractCompletion ?? null, a.auto.programme?.estimated ?? null)
  const latestEot = a.auto.eot?.claims.at(-1)
  const tiles: [string, string, string][] = [
    ['Programme', a.auto.programme?.estimated ? `Est. completion ${ukDate(a.auto.programme.estimated)}` : 'Not available', slip == null ? '' : slip > 0 ? `${slip} days after contract completion` : slip < 0 ? `${-slip} days before contract completion` : 'On contract completion'],
    ['Health and safety', c.hs.riddor || c.hs.accidents ? `RIDDOR ${c.hs.riddor || '0'}, accidents ${c.hs.accidents || '0'}` : 'See section', c.hs.score ? `Audit ${c.hs.score}` : ''],
    ['Variations', a.auto.variations ? `${a.auto.variations.total} in all` : 'Not available', a.auto.variations ? countsLine(a.auto.variations.counts) : ''],
    ['Extension of time', latestEot ? `Claim ${latestEot.no}: ${word(latestEot.status)}` : 'No claims', latestEot?.claimed != null ? `${latestEot.claimed} days claimed${latestEot.granted != null ? `, ${latestEot.granted} granted` : ''}` : ''],
    ['RFIs', a.auto.rfis ? `${a.auto.rfis.open} open` : 'Not available', a.auto.rfis ? `${a.auto.rfis.overdue} overdue, ${a.auto.rfis.answered} answered` : ''],
    ['Submittals', a.auto.submittals ? `${a.auto.submittals.out} out for review` : 'Not available', a.auto.submittals ? `${a.auto.submittals.overdue} overdue` : ''],
  ]
  const tw = (CW - 20) / 3
  const ty = y - 10
  tiles.forEach(([t, big, small], i) => {
    const x = M + (i % 3) * (tw + 10)
    const yy = ty - Math.floor(i / 3) * 86
    page.drawRectangle({ x, y: yy - 74, width: tw, height: 74, color: hex(SHADE) })
    page.drawText(clean(t), { x: x + 8, y: yy - 16, size: 9, font: bold, color: hex(MUTED) })
    wrap(big, tw - 16, 11, bold).slice(0, 2).forEach((ln, k) => page.drawText(ln, { x: x + 8, y: yy - 33 - k * 13, size: 11, font: bold, color: hex(NAVY) }))
    wrap(small, tw - 16, 8.5, regular).slice(0, 2).forEach((ln, k) => page.drawText(ln, { x: x + 8, y: yy - 60 - k * 10, size: 8.5, font: regular, color: hex(INK) }))
  })
  y = ty - 2 * 86 - 8
  h2('', 'Key issues')
  const issues = c.keyIssues.filter((x) => x.trim())
  if (issues.length) bullets(issues)
  else text('None recorded for this period.', { color: MUTED })

  // ---------- the numbered sections ----------
  if (sectionOn(on, 'programme')) {
    const n = num.programme
    h1(n, 'Programme and progress')
    h2(`${n}.1`, 'Programme')
    const p = a.auto.programme
    kv([
      ['Programme revision', c.programme.revision],
      ['Commencement', p?.commencement ? ukDate(p.commencement) : ''],
      ['Contract completion', p?.contractCompletion ? ukDate(p.contractCompletion) : ''],
      ['Estimated completion', p?.estimated ? `${ukDate(p.estimated)}${slip == null ? '' : slip > 0 ? ` (${slip} days late)` : slip < 0 ? ` (${-slip} days early)` : ' (on time)'}` : ''],
    ])
    if (p?.now.length) {
      text('Activities in progress this period', { font: 'bold', gap: 2 })
      table(['Ref', 'Activity', 'Start', 'Finish', '%'], p.now.map((t) => [t.code, t.name, ukDate(t.start), ukDate(t.finish), t.progress == null ? '' : `${t.progress}%`]), [40, 250, 62, 62, 36])
    }
    if (p?.milestones.length) {
      text('Milestones ahead', { font: 'bold', gap: 2 })
      table(['Ref', 'Milestone', 'Date'], p.milestones.map((t) => [t.code, t.name, ukDate(t.date)]), [40, 340, 70])
    }
    h2(`${n}.2`, 'Progress this period')
    text(c.programme.progress || 'No commentary this period.', { color: c.programme.progress ? INK : MUTED })
    const photos = a.files.filter((f) => f.kind === 'photo')
    if (photos.length) {
      h2(`${n}.3`, 'Photos')
      for (let i = 0; i < photos.length; i += 2) {
        const pair = photos.slice(i, i + 2)
        const imgs = await Promise.all(pair.map(async (f) => ({ f, img: await embed(await reportFileBytes(f.path), f.file_name) })))
        const cell = (CW - 10) / 2
        let rowH = 0
        const drawn = imgs.filter((x) => x.img).map((x) => {
          const s = Math.min(cell / x.img!.width, 190 / x.img!.height)
          return { ...x, w: x.img!.width * s, h: x.img!.height * s }
        })
        rowH = Math.max(0, ...drawn.map((d) => d.h)) + 26
        ensure(rowH)
        drawn.forEach((d, k) => {
          const x = M + k * (cell + 10)
          page.drawImage(d.img!, { x, y: y - d.h, width: d.w, height: d.h })
          const cap = wrap(d.f.caption || d.f.name, cell, 8, italic)[0] ?? ''
          page.drawText(cap, { x, y: y - d.h - 11, size: 8, font: italic, color: hex(MUTED) })
        })
        y -= rowH
      }
    }
    h2(`${n}.${photos.length ? 4 : 3}`, 'Look-ahead')
    text(c.programme.lookahead || 'No commentary.', { color: c.programme.lookahead ? INK : MUTED })
    if (p?.next.length) {
      text('Starting in the next four weeks', { font: 'bold', gap: 2 })
      table(['Ref', 'Activity', 'Start', 'Finish'], p.next.map((t) => [t.code, t.name, ukDate(t.start), ukDate(t.finish)]), [40, 290, 62, 62])
    }
    if (c.programme.issues.trim()) {
      h2(`${n}.${photos.length ? 5 : 4}`, 'Key issues')
      text(c.programme.issues)
    }
  }

  if (sectionOn(on, 'design')) {
    const n = num.design
    h1(n, 'Design')
    h2(`${n}.1`, 'Submittals summary')
    const s = a.auto.submittals
    if (s) {
      text(`${s.rows.length} submittal${s.rows.length === 1 ? '' : 's'}: ${s.out} out for review (${s.overdue} overdue), ${s.respondedInPeriod} responded to this period.`)
      const out = s.rows.filter((r) => r.status === 'out')
      if (out.length) table(['No.', 'Submittal', 'Trade', 'Return by'], out.map((r) => [`S${r.number}`, r.title, r.trade ?? '', r.due_date ? ukDate(r.due_date) : '']), [34, 280, 90, 62])
    } else text('Not available.', { color: MUTED })
    h2(`${n}.2`, 'Sampling tracker')
    text(a.auto.sampling ? `${a.auto.sampling.total} items: ${countsLine(a.auto.sampling.counts)}.` : 'Not available.', { color: a.auto.sampling ? INK : MUTED })
    h2(`${n}.3`, 'Design queries')
    const q = c.design.queries.split('\n').map((x) => x.replace(/^[-•*]\s*/, ''))
    if (q.some((x) => x.trim())) bullets(q)
    else text('None.', { color: MUTED })
  }

  if (sectionOn(on, 'procurement')) {
    const n = num.procurement
    h1(n, 'Procurement')
    const pr = a.auto.procurement
    if (pr && pr.total) {
      text(`${pr.total} packages: ${countsLine(pr.counts)}.`)
      if (pr.upcoming.length) {
        text('Not yet ordered and needed on site within 10 weeks', { font: 'bold', gap: 2 })
        table(['Package', 'Needed on site', 'Status'], pr.upcoming.map((u) => [u.name, u.onSite ? ukDate(u.onSite) : '', word(u.status)]), [260, 90, 100])
      }
    } else text('No procurement schedule yet.', { color: MUTED })
    text(c.procurement.notes)
  }

  if (sectionOn(on, 'information')) {
    const n = num.information
    h1(n, 'Information required')
    const r = a.auto.rfis
    if (r) {
      text(`${r.rows.length} RFI${r.rows.length === 1 ? '' : 's'}: ${r.open} open (${r.overdue} overdue), ${r.answered} answered and awaiting closure, ${r.closedInPeriod} closed this period.`)
      const open = r.rows.filter((x) => x.status === 'open' || x.status === 'answered')
      if (open.length) table(['No.', 'RFI', 'Trade', 'Due', 'Status'], open.map((x) => [`RFI ${x.number}`, x.title, x.trade ?? '', x.due_date ? ukDate(x.due_date) : '', x.status === 'open' ? 'Open' : 'Answered']), [46, 250, 80, 60, 56])
    } else text('Not available.', { color: MUTED })
    text(c.information.notes)
  }

  if (sectionOn(on, 'contract')) {
    const n = num.contract
    h1(n, 'Contract')
    h2(`${n}.1`, 'Status')
    text(c.contract.status || `${a.job.contract_form ?? 'Contract'}.`, { color: c.contract.status ? INK : MUTED })
    h2(`${n}.2`, 'Insurances')
    if (a.auto.insurances?.length) table(['Cover', 'Insurer', 'Expires'], a.auto.insurances.map((i) => [i.cover, i.insurer ?? '', ukDate(i.end_date)]), [220, 180, 70])
    text(c.contract.insurances)
    h2(`${n}.3`, 'Warranties')
    text(c.contract.warranties || 'None recorded.', { color: c.contract.warranties ? INK : MUTED })
  }

  if (sectionOn(on, 'commercial')) {
    const n = num.commercial
    h1(n, 'Commercial')
    text('Variation and extension of time status only.', { color: MUTED, size: 9 })
    const v = a.auto.variations
    text(v ? `Variations: ${v.total} in all (${countsLine(v.counts)}).` : 'Variations: not available.')
    const e = a.auto.eot
    if (e?.claims.length) {
      text('Extension of time', { font: 'bold', gap: 2 })
      table(['Claim', 'Status', 'Submitted', 'Days claimed', 'Days granted'], e.claims.map((x) => [`EOT ${x.no}`, word(x.status), x.submitted ? ukDate(x.submitted) : '', x.claimed == null ? '' : String(x.claimed), x.granted == null ? '' : String(x.granted)]), [60, 100, 80, 80, 80])
    } else text('Extension of time: no claims.')
    text(c.commercial.notes)
  }

  if (sectionOn(on, 'site')) {
    const n = num.site
    h1(n, 'Site-specific issues')
    const list = c.siteSpecific.filter((s) => s.heading.trim() || s.text.trim())
    if (!list.length) text('None.', { color: MUTED })
    list.forEach((s, i) => {
      h2(`${n}.${i + 1}`, s.heading || 'Issue')
      text(s.text)
    })
  }

  if (sectionOn(on, 'hs')) {
    const n = num.hs
    h1(n, 'Health and safety')
    kv([
      ['Hours worked', c.hs.hours],
      ['Operatives inducted', c.hs.inducted],
      ['RIDDOR reportable', c.hs.riddor],
      ['Accidents', c.hs.accidents],
      ['Near misses', c.hs.nearMisses],
      ['Audits / inspections', c.hs.audits],
      ['Audit score', c.hs.score],
    ])
    text(c.hs.notes)
  }

  // ---------- contents (inserted after the cover) ----------
  const contents = doc.insertPage(1, [W, H])
  own.push(contents)
  let contentsY = H - 120
  {
    contents.drawText('Contents', { x: M, y: H - 80, size: 20, font: bold, color: hex(NAVY) })
    let cy = H - 120
    const pages = doc.getPages()
    for (const m of marks.filter((m) => m.level === 0 || m.level === 1)) {
      const pg = pages.indexOf(m.page) + 1
      const x = M + (m.level ? 18 : 0)
      const f = m.level ? regular : bold
      contents.drawText(clean(m.label), { x, y: cy, size: m.level ? 10 : 11, font: f, color: hex(m.level ? INK : NAVY) })
      const t = String(pg)
      contents.drawText(t, { x: W - M - f.widthOfTextAtSize(t, 10), y: cy, size: 10, font: f, color: hex(MUTED) })
      cy -= m.level ? 15 : 19
      if (cy < 80) break
    }
    contentsY = cy
  }

  // ---------- appendices ----------
  const appendixList: { title: string; build: () => Promise<{ doc?: PDFDocument; image?: PDFImage }> }[] = []
  if (c.autoAppendices.rfis && sectionOn(on, 'information') && a.rfiRows.length)
    appendixList.push({ title: 'RFI report: RFIs still unanswered', build: async () => ({ doc: await PDFDocument.load(await buildRfisPdf({ ref: `${a.job.job_no} ${a.job.code}`, name: a.job.name }, a.rfiRows, 'Unanswered RFIs')) }) })
  if (c.autoAppendices.submittals && sectionOn(on, 'design') && a.submittalRows.length)
    appendixList.push({ title: 'Submittals out for review', build: async () => ({ doc: await PDFDocument.load(await buildSubmittalsPdf({ ref: `${a.job.job_no} ${a.job.code}`, name: a.job.name }, a.submittalRows, 'Submittals out for review')) }) })
  for (const f of a.files.filter((x) => x.kind === 'appendix'))
    appendixList.push({
      title: f.name,
      build: async () => {
        const bytes = await reportFileBytes(f.path)
        if (/\.pdf$/i.test(f.file_name)) return { doc: await PDFDocument.load(bytes, { ignoreEncryption: true }) }
        const img = await embed(bytes, f.file_name)
        return img ? { image: img } : {}
      },
    })
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const toc: { label: string; page: PDFPage }[] = []
  for (let i = 0; i < appendixList.length; i++) {
    const ap = appendixList[i]
    a.onProgress?.(`Adding appendix ${letters[i] ?? i + 1}: ${ap.title}…`)
    try {
      const built = await ap.build()
      if (!built.doc && !built.image) continue
      const d = newPage()
      const label = `Appendix ${letters[i] ?? i + 1}: ${ap.title}`
      d.drawText(clean(`Appendix ${letters[i] ?? i + 1}`), { x: M, y: H / 2 + 20, size: 26, font: bold, color: hex(NAVY) })
      wrap(ap.title, CW, 15, regular).forEach((ln, k) => d.drawText(ln, { x: M, y: H / 2 - 12 - k * 20, size: 15, font: regular, color: hex(INK) }))
      toc.push({ label, page: d })
      if (built.doc) {
        const copied = await doc.copyPages(built.doc, built.doc.getPageIndices())
        copied.forEach((p) => doc.addPage(p))
      } else if (built.image) {
        const p = doc.addPage([W, H])
        const s = Math.min((W - 2 * M) / built.image.width, (H - 2 * M) / built.image.height)
        p.drawImage(built.image, { x: M, y: H - M - built.image.height * s, width: built.image.width * s, height: built.image.height * s })
      }
    } catch (e) {
      warnings.push(`${ap.title}: ${(e as Error).message}`)
    }
  }
  // appendices on the contents page
  if (toc.length) {
    const pages = doc.getPages()
    let cy = contentsY - 10
    contents.drawText('Appendices', { x: M, y: cy, size: 11, font: bold, color: hex(NAVY) })
    cy -= 19
    for (const t of toc) {
      if (cy < 60) break
      contents.drawText(clean(t.label).slice(0, 90), { x: M + 18, y: cy, size: 10, font: regular, color: hex(INK) })
      const s = String(pages.indexOf(t.page) + 1)
      contents.drawText(s, { x: W - M - regular.widthOfTextAtSize(s, 10), y: cy, size: 10, font: regular, color: hex(MUTED) })
      cy -= 15
    }
  }

  // ---------- footers on the pages drawn here ----------
  const all = doc.getPages()
  own.forEach((p) => {
    const i = all.indexOf(p)
    if (i === 0) return // the cover
    const t = `Page ${i + 1} of ${all.length}`
    p.drawText(t, { x: W - M - regular.widthOfTextAtSize(t, 8), y: 28, size: 8, font: regular, color: hex(MUTED) })
    p.drawText('du Boulay Projects Limited', { x: M, y: 28, size: 8, font: regular, color: hex(MUTED) })
  })
  void htmlToText
  return { bytes: await doc.save(), warnings }
}
