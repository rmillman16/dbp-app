// The quotation (tender return) as a PDF, in the progress report's design language (24 Nov): du Boulay navy headings with a blue
// rule under them (no bands), pale-blue table headers, a running header line and "du Boulay Projects Limited / Page x of y" footer,
// Carlito with Helvetica as the fall-back. Built in the browser with pdf-lib; nothing is uploaded. A4. Same content as the Word file.
import type { PDFFont, PDFPage } from 'pdf-lib'
import { fullRef, quoteTotal } from './quotations'
import { lineTotal } from './variations'
import type { QuoteDoc } from './exportQuotation'
import type { TextGroup } from './types'

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

const SPECIAL = new Map<number, string>([[0x2013, '-'], [0x2014, '-'], [0x2018, "'"], [0x2019, "'"], [0x201c, '"'], [0x201d, '"'], [0x2026, '...'], [0x2022, '-'], [0x20ac, 'EUR'], [0x2192, '->'], [0x25aa, '-']])
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

const num2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const gbp = (n: number) => `£${num2.format(n)}`
const longDate = (iso: string | null) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const plain = (t: string) => t.replace(/\*\*([^*]+)\*\*/g, '$1') // **bold** markers typed in the app

export async function buildQuotationPdf(d: QuoteDoc): Promise<Uint8Array> {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const { job, q } = d
  const project = job?.name ?? q.project_name ?? ''
  const site = (q.site ?? job?.site_address ?? '').replace(/\s*\n\s*/g, ', ')
  const ref = fullRef(d.owner, q)
  const total = quoteTotal(d.lines)
  const hex = (h: string) => {
    const x = h.replace('#', '')
    return rgb(parseInt(x.slice(0, 2), 16) / 255, parseInt(x.slice(2, 4), 16) / 255, parseInt(x.slice(4, 6), 16) / 255)
  }
  doc.setTitle(ref)
  doc.setCreator('DBP app')

  let regular: PDFFont, bold: PDFFont, italic: PDFFont
  let clean = (s: string) => s.replace(/\t/g, ' ')
  try {
    const [{ default: fontkit }, bytes] = await Promise.all([import('@pdf-lib/fontkit'), Promise.all(FONTS.map((u) => fetch(u).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(u))))))])
    doc.registerFontkit(fontkit)
    ;[regular, bold, italic] = await Promise.all(bytes.map((b) => doc.embedFont(new Uint8Array(b), { subset: false })))
  } catch {
    ;[regular, bold, italic] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold), doc.embedFont(StandardFonts.HelveticaOblique)])
    clean = winAnsi
  }
  const fontOf = { regular, bold, italic }

  let page!: PDFPage
  let y = 0
  let first = true
  const header = () => {
    page.drawText(clean(`${ref}`).slice(0, 80), { x: M, y: H - 30, size: 8, font: regular, color: hex(MUTED) })
    const r = 'Quotation'
    page.drawText(r, { x: W - M - regular.widthOfTextAtSize(r, 8), y: H - 30, size: 8, font: regular, color: hex(MUTED) })
    page.drawLine({ start: { x: M, y: H - 36 }, end: { x: W - M, y: H - 36 }, thickness: 0.5, color: hex(LINE) })
  }
  const newPage = () => {
    page = doc.addPage([W, H])
    y = H - 60
    if (!first) header()
    first = false
  }
  const ensure = (h: number) => {
    if (y - h < 60) newPage()
  }
  const wrap = (text: string, width: number, size: number, f: PDFFont) => {
    const out: string[] = []
    for (const para of clean(plain(text)).split('\n')) {
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
  const text = (s: string, o: { size?: number; font?: 'regular' | 'bold' | 'italic'; color?: string; gap?: number } = {}) => {
    if (!s.trim()) return
    const size = o.size ?? 10
    const f = fontOf[o.font ?? 'regular']
    for (const ln of wrap(s, CW, size, f)) {
      ensure(size + 4)
      y -= size + 4
      page.drawText(ln, { x: M, y, size, font: f, color: hex(o.color ?? INK) })
    }
    y -= o.gap ?? 8
  }
  const bullets = (items: string[], numbered: boolean) => {
    items
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((it, i) => {
        const lines = wrap(it, CW - 18, 10, regular)
        ensure(lines.length * 14 + 3)
        y -= 14
        page.drawText(numbered ? `${i + 1}.` : '-', { x: M + 2, y, size: 10, font: bold, color: hex(BLUE) })
        lines.forEach((ln, k) => {
          if (k) y -= 14
          page.drawText(ln, { x: M + 18, y, size: 10, font: regular, color: hex(INK) })
        })
        y -= 3
      })
    y -= 6
  }
  // navy heading with a blue rule under it (as the progress report's sections)
  const h1 = (n: string, title: string) => {
    ensure(90)
    y -= 34
    page.drawText(clean(n ? `${n}  ${title}` : title), { x: M, y, size: 15, font: bold, color: hex(NAVY) })
    page.drawLine({ start: { x: M, y: y - 7 }, end: { x: M + CW, y: y - 7 }, thickness: 1.5, color: hex(BLUE) })
    y -= 12
  }
  const h2 = (title: string) => {
    ensure(60)
    y -= 18
    page.drawText(clean(title), { x: M, y: y - 8, size: 11.5, font: bold, color: hex(NAVY) })
    page.drawLine({ start: { x: M, y: y - 13 }, end: { x: M + 48, y: y - 13 }, thickness: 2, color: hex(BLUE) })
    y -= 24
  }
  const kv = (rows: [string, string][]) => {
    for (const [k, v] of rows.filter(([, v]) => v && v.trim())) {
      const lines = wrap(v, CW - 130, 10, regular)
      ensure(lines.length * 14 + 3)
      y -= 14
      page.drawText(clean(k), { x: M, y, size: 10, font: bold, color: hex(MUTED) })
      lines.forEach((ln, i) => {
        if (i) y -= 14
        page.drawText(ln, { x: M + 130, y, size: 10, font: regular, color: hex(INK) })
      })
      y -= 4
    }
    y -= 8
  }
  const groups = (gs: TextGroup[], def: 'numbered' | 'bullets') => {
    for (const g of gs) {
      if (g.heading) h2(g.heading)
      bullets(g.items, (g.style ?? def) === 'numbered')
    }
  }
  // free text with markers: "# Title" new section, "## Heading", "- item", else paragraph
  const freeText = (src: string, letters = false) => {
    let letter = 0
    let items: string[] = []
    const flush = () => {
      if (items.length) bullets(items, false)
      items = []
    }
    for (const raw of src.split(/\r?\n/)) {
      const line = raw.trimEnd()
      if (line.startsWith('- ')) {
        items.push(line.slice(2))
        continue
      }
      flush()
      if (line.startsWith('## ')) h2(line.slice(3))
      else if (line.startsWith('# ')) {
        const L = String.fromCharCode(65 + letter++)
        h1('', letters ? `Appendix ${L} - ${line.slice(2)}` : line.slice(2))
      } else if (line.trim()) text(line)
    }
    flush()
  }

  // ---------- page 1: logo, title, details ----------
  newPage()
  try {
    const r = await fetch('/dbp-logo.png')
    if (r.ok) {
      const logo = await doc.embedPng(new Uint8Array(await r.arrayBuffer()))
      const s = 150 / logo.width
      page.drawImage(logo, { x: M, y: H - 40 - logo.height * s, width: logo.width * s, height: logo.height * s })
      y = H - 40 - logo.height * s - 30
    }
  } catch {
    /* no logo: carry on */
  }
  page.drawText('Quotation', { x: M, y: y - 26, size: 28, font: bold, color: hex(NAVY) })
  y -= 54
  for (const ln of wrap(q.subject, CW, 15, regular)) {
    page.drawText(ln, { x: M, y, size: 15, font: regular, color: hex(BLUE) })
    y -= 20
  }
  for (const ln of wrap(project, CW, 18, bold)) {
    page.drawText(ln, { x: M, y: y - 4, size: 18, font: bold, color: hex(INK) })
    y -= 22
  }
  if (site) for (const ln of wrap(site, CW, 11, regular)) {
    page.drawText(ln, { x: M, y: y - 4, size: 11, font: regular, color: hex(MUTED) })
    y -= 15
  }
  y -= 16
  kv([
    ['Client', [q.client_name, q.client_contact].filter(Boolean).join(' - ')],
    ['Prepared by', q.prepared_by ?? 'du Boulay Projects'],
    ['Quotation date', longDate(q.issued_date)],
    ['Quotation ref', ref],
    ['Valid until', longDate(q.valid_until)],
  ])
  text(`du Boulay Projects is pleased to submit our quotation of ${gbp(total)} + VAT for ${q.summary?.trim() || 'the works'} set out below.`, { gap: 6 })

  // ---------- 01 scope ----------
  h1('01', 'Scope of works')
  if (q.scope?.trim()) for (const t of q.scope.split(/\r?\n\r?\n/)) text(t.trim())
  groups(q.scope_groups ?? [], 'numbered')

  // ---------- 02 pricing ----------
  h1('02', 'Pricing schedule')
  {
    const ws = [34, 245, 36, 40, 62, 66].map((w) => (w / 483) * CW)
    const xs = ws.reduce<number[]>((a, _w, i) => [...a, i ? a[i - 1] + ws[i - 1] : M], [])
    const right = (t: string, x: number, w: number, yy: number, f: PDFFont, size: number, color = INK) => page.drawText(t, { x: x + w - 4 - f.widthOfTextAtSize(t, size), y: yy, size, font: f, color: hex(color) })
    const mid = (t: string, x: number, w: number, yy: number, f: PDFFont, size: number) => page.drawText(t, { x: x + (w - f.widthOfTextAtSize(t, size)) / 2, y: yy, size, font: f, color: hex(INK) })
    const head = () => {
      ensure(40)
      y -= 6
      page.drawRectangle({ x: M, y: y - 14, width: CW, height: 18, color: hex(SHADE) })
      const yy = y - 9
      mid('Item', xs[0], ws[0], yy, bold, 8.5)
      page.drawText('Description', { x: xs[1] + 3, y: yy, size: 8.5, font: bold, color: hex(NAVY) })
      mid('Qty', xs[2], ws[2], yy, bold, 8.5)
      mid('Unit', xs[3], ws[3], yy, bold, 8.5)
      right('Rate (£)', xs[4], ws[4], yy, bold, 8.5, NAVY)
      right('Total (£)', xs[5], ws[5], yy, bold, 8.5, NAVY)
      y -= 18
    }
    head()
    d.lines.forEach((l, i) => {
      const desc = [l.heading, l.description].filter(Boolean).join(' - ')
      const lines = wrap(desc, ws[1] - 8, 9, regular)
      const h = Math.max(lines.length, 1) * 11 + 8
      if (y - h < 60) {
        newPage()
        head()
      }
      const top = y
      mid(l.item || String(i + 1), xs[0], ws[0], top - 12, regular, 9)
      lines.forEach((ln, k) => page.drawText(ln, { x: xs[1] + 3, y: top - 12 - k * 11, size: 9, font: k === 0 && l.heading ? regular : regular, color: hex(INK) }))
      mid(l.qty == null ? '' : String(l.qty), xs[2], ws[2], top - 12, regular, 9)
      mid(l.unit ?? '', xs[3], ws[3], top - 12, regular, 9)
      right(num2.format(l.rate ?? 0), xs[4], ws[4], top - 12, regular, 9)
      right(num2.format(lineTotal(l)), xs[5], ws[5], top - 12, regular, 9)
      y -= h
      page.drawLine({ start: { x: M, y: y + 1 }, end: { x: M + CW, y: y + 1 }, thickness: 0.4, color: hex(LINE) })
    })
    ensure(34)
    y -= 6
    page.drawRectangle({ x: M, y: y - 20, width: CW, height: 22, color: hex(SHADE) })
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: M + CW, y: y + 2 }, thickness: 1.5, color: hex(BLUE) })
    page.drawText('TOTAL (EXCLUDING VAT)', { x: xs[1] + 3, y: y - 14, size: 10, font: bold, color: hex(NAVY) })
    right(gbp(total), xs[5], ws[5], y - 14, bold, 10.5, NAVY)
    y -= 30
    text('All prices exclude VAT, which will be charged at the prevailing rate.', { font: 'italic', color: MUTED, size: 8.5 })
  }

  // ---------- 03 qualifications ----------
  h1('03', 'Qualifications and exclusions')
  groups(q.qualification_groups ?? [], 'bullets')
  if (d.clauses.length) {
    h2('Additional conditions')
    for (const c of d.clauses) {
      text(c.title, { font: 'bold', color: NAVY, gap: 2 })
      for (const t of c.body.split(/\r?\n/).filter((x) => x.trim())) text(t)
    }
  }

  // ---------- 04 validity and acceptance ----------
  ensure(260)
  h1('04', 'Validity and acceptance')
  text(`This quotation is valid until ${longDate(q.valid_until)}. ${q.validity_note?.trim() ? q.validity_note.trim().replace(/\.?$/, '. ') : ''}After it, prices may need to be reconfirmed.`)
  text(d.acceptanceWording)
  y -= 8
  for (const label of ['Accepted by (name)', 'Company', 'Position', 'Signature', 'Date']) {
    ensure(34)
    y -= 30
    page.drawText(label, { x: M, y: y + 3, size: 10, font: bold, color: hex(NAVY) })
    page.drawLine({ start: { x: M + 140, y }, end: { x: M + CW, y }, thickness: 0.8, color: hex(NAVY) })
  }

  // ---------- appendices and T&Cs ----------
  if (q.appendices?.trim()) {
    newPage()
    freeText(q.appendices, true)
  }
  if (q.include_terms && d.terms.trim()) {
    newPage()
    h1('', 'Terms and conditions')
    freeText(d.terms)
  }

  // ---------- footers ----------
  const all = doc.getPages()
  all.forEach((p, i) => {
    const t = `Page ${i + 1} of ${all.length}`
    p.drawText(t, { x: W - M - regular.widthOfTextAtSize(t, 8), y: 28, size: 8, font: regular, color: hex(MUTED) })
    p.drawText('du Boulay Projects Limited', { x: M, y: 28, size: 8, font: regular, color: hex(MUTED) })
  })
  return doc.save()
}

export async function exportQuotationPdf(d: QuoteDoc) {
  const bytes = await buildQuotationPdf(d)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  a.download = `dbp Quotation - ${fullRef(d.owner, d.q).replace(/[\\/:*?"<>|]/g, '')}.pdf`
  a.click()
  URL.revokeObjectURL(a.href)
}
