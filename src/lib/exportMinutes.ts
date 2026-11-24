// Minutes exports (22 Nov, restyled 24 Nov in the progress report's design language: navy headings with a blue rule, a shaded
// details panel, shaded task-summary bands, "du Boulay Projects Limited" and Page x of y at the foot). PDF and Word share the layout,
// wording and footnote. The project hub link (the job's one SharePoint link for outside people, script 078) closes every issue.
// PDF: real text with Aptos if its files are in public/fonts (see pdfFonts.ts), else Carlito (an open Calibri look-alike, in
// public/minutes/fonts); if neither loads it falls back to the PDF's built-in Helvetica. Pages are A4.
// Word: built with the docx library, in Aptos.
// The "£ cost impact" flag is never exported (in the app only).
import { downloadBlob } from './letter'
import { addPdfLink, HUB_LABEL } from './pdfLink'
import {
  apologyAttendees,
  attendeeById,
  attendeeLabel,
  awayAttendees,
  computeTaskSummary,
  dueWord,
  FOOTNOTE_TEXT,
  formatDateNice,
  mentionRuns,
  numberPoints,
  presentAttendees,
  revLetter,
  slug,
  type Meeting,
} from './minutes'

// "MEETING MINUTES · MEETING 12 · REV A": the number and the revision (once issued) are what people quote
const kicker = (m: Meeting) => ['MEETING MINUTES', m.no ? `MEETING ${m.no}` : '', m.rev ? `REV ${revLetter(m.rev)}` : ''].filter(Boolean).join('  ·  ')
const refsLine = (p: { refs?: { label: string }[] }) => (p.refs?.length ? 'Re: ' + p.refs.map((r) => r.label).join(', ') : '')

const LOGO_URL = '/minutes/logo-lockup.png'
const FONT_FILES = {
  regular: '/minutes/fonts/Carlito-Regular.ttf',
  bold: '/minutes/fonts/Carlito-Bold.ttf',
  italic: '/minutes/fonts/Carlito-Italic.ttf',
  boldItalic: '/minutes/fonts/Carlito-BoldItalic.ttf',
}
// DBP's standard font, if its files have been put in public/fonts (Aptos is a Microsoft font, so it can't ship with the app)
const APTOS_FILES = { regular: '/fonts/Aptos-Regular.ttf', bold: '/fonts/Aptos-Bold.ttf', italic: '/fonts/Aptos-Italic.ttf', boldItalic: '/fonts/Aptos-BoldItalic.ttf' }

// the design language shared with the progress report
const NAVY = '#1f1246'
const BLUE = '#007abe'
const SHADE = '#eef3fa'
const INK = '#1d1d24'
const MUTED = '#6b6b78'
const LINE = '#d9d9e0'

async function fetchBytes(url: string) {
  const res = await fetch(url)
  // the dev server answers a missing file with the app's page, so check it really is a font
  if (!res.ok || /html/i.test(res.headers.get('content-type') ?? '')) throw new Error(`Couldn't load ${url} (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

export const minutesFilename = (m: Meeting, ext: 'pdf' | 'docx') => `${slug(m.project)}${m.no ? `-meeting-${m.no}` : ''}-${m.date}${m.rev ? `-rev-${revLetter(m.rev).toLowerCase()}` : ''}.${ext}`

// =====================================================================
// PDF
// =====================================================================
// Unicode -> WinAnsi (what the built-in Helvetica can show); anything else becomes "?" in the fallback
const WINANSI_SPECIAL = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
])
function toWinAnsi(str: string) {
  let out = ''
  for (const ch of str) {
    const code = ch.codePointAt(0)!
    if (code === 0x0a || code === 0x0d || code === 0x09) out += ' '
    else if ((code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff) || WINANSI_SPECIAL.has(code)) out += ch
    else out += '?'
  }
  return out
}

type PdfLib = typeof import('pdf-lib')
type PdfFont = import('pdf-lib').PDFFont

function hexToRgb01(hex: string) {
  const h = hex.replace('#', '')
  return { r: parseInt(h.substring(0, 2), 16) / 255, g: parseInt(h.substring(2, 4), 16) / 255, b: parseInt(h.substring(4, 6), 16) / 255 }
}

interface Fonts {
  regular: PdfFont
  bold: PdfFont
  italic: PdfFont
  boldItalic: PdfFont
  clean: (s: string) => string
}

interface PendingLink {
  page: import('pdf-lib').PDFPage
  url: string
  x: number
  y: number
  w: number
  h: number
}

function layoutPdf(doc: import('pdf-lib').PDFDocument, PDFLib: PdfLib, fonts: Fonts, logo: import('pdf-lib').PDFImage | null, meeting: Meeting, hubUrl: string | null) {
  const links: PendingLink[] = []
  const pageW = 595.28
  const pageH = 841.89
  const margin = 54
  const contentW = pageW - margin * 2
  let curPage = doc.addPage([pageW, pageH])
  let cursorY = margin

  const newPage = () => {
    curPage = doc.addPage([pageW, pageH])
    cursorY = margin
  }
  const ensureSpace = (h: number) => {
    if (cursorY + h > pageH - margin) newPage()
  }
  const fontFor = (bold?: boolean, italic?: boolean) => (bold && italic ? fonts.boldItalic : bold ? fonts.bold : italic ? fonts.italic : fonts.regular)
  const measure = (text: string, bold: boolean | undefined, italic: boolean | undefined, size: number) => fontFor(bold, italic).widthOfTextAtSize(fonts.clean(text), size)
  const drawText = (x: number, yTop: number, text: string, bold: boolean | undefined, italic: boolean | undefined, size: number, color: string) => {
    if (!text) return
    const c = hexToRgb01(color)
    curPage.drawText(fonts.clean(text), { x, y: pageH - yTop, size, font: fontFor(bold, italic), color: PDFLib.rgb(c.r, c.g, c.b) })
  }
  // pdf-lib has no letter-spacing, so tracked text (section headings) goes one character at a time
  const drawTrackedText = (x: number, yTop: number, text: string, bold: boolean | undefined, italic: boolean | undefined, size: number, color: string, tracking: number) => {
    let cx = x
    for (const ch of text) {
      drawText(cx, yTop, ch, bold, italic, size, color)
      cx += measure(ch, bold, italic, size) + tracking
    }
  }
  const wrapLines = (text: string, bold: boolean | undefined, italic: boolean | undefined, size: number, maxWidth: number) => {
    const words = text.split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let line = ''
    words.forEach((w) => {
      const test = line ? line + ' ' + w : w
      if (line && measure(test, bold, italic, size) > maxWidth) {
        lines.push(line)
        line = w
      } else line = test
    })
    if (line) lines.push(line)
    return lines.length ? lines : ['']
  }
  type ParaOpts = { size?: number; lh?: number; indent?: number; color?: string; tracking?: number; bold?: boolean; italic?: boolean; before?: number; after?: number }
  const para = (text: string, o: ParaOpts = {}) => {
    if (!text) {
      cursorY += o.after || 0
      return
    }
    if (o.before) {
      ensureSpace(o.before)
      cursorY += o.before
    }
    const size = o.size || 11
    const lineHeight = size * (o.lh || 1.45)
    const indent = o.indent || 0
    const color = o.color || INK
    const tracking = o.tracking || 0
    // tracked text is wider than its untracked measure: allow for the worst case so it never overflows
    const maxWidth = contentW - indent - (tracking ? tracking * text.length : 0)
    wrapLines(text, o.bold, o.italic, size, maxWidth).forEach((ln) => {
      ensureSpace(lineHeight)
      if (tracking) drawTrackedText(margin + indent, cursorY + size * 0.83, ln, o.bold, o.italic, size, color, tracking)
      else drawText(margin + indent, cursorY + size * 0.83, ln, o.bold, o.italic, size, color)
      cursorY += lineHeight
    })
    cursorY += o.after || 0
  }
  const rule = (color = LINE, after = 8, thickness = 1.4) => {
    ensureSpace(3)
    const c = hexToRgb01(color)
    curPage.drawRectangle({ x: margin, y: pageH - cursorY - thickness, width: contentW, height: thickness, color: PDFLib.rgb(c.r, c.g, c.b) })
    cursorY += after
  }
  // headings (points marked as headings, and TASK SUMMARY) share one look, with a hairline under
  const sectionHeading = (text: string, o: { before?: number; ruleAfter?: number } = {}) => {
    para(text.toUpperCase(), { size: 13, bold: true, color: NAVY, tracking: 0.6, before: o.before, after: 6 })
    rule(BLUE, o.ruleAfter || 10, 1.2)
  }
  type Word = { text: string; bold: boolean; isSpace: boolean }
  // words measured in their own weight, so a bold @mention sits inline and still wraps
  const wrapRuns = (runs: { text: string; bold: boolean }[], base: { size: number; bold?: boolean; italic?: boolean }, maxWidth: number) => {
    const words: Word[] = []
    runs.forEach((run) =>
      run.text.split(/(\s+)/).forEach((part) => {
        if (part !== '') words.push({ text: part, bold: !!base.bold || run.bold, isSpace: /^\s+$/.test(part) })
      }),
    )
    const lines: Word[][] = [[]]
    let curWidth = 0
    words.forEach((w) => {
      const wWidth = measure(w.text, w.bold, base.italic, base.size)
      if (w.isSpace) {
        if (lines[lines.length - 1].length && curWidth + wWidth <= maxWidth) {
          lines[lines.length - 1].push(w)
          curWidth += wWidth
        }
        return
      }
      if (curWidth + wWidth > maxWidth && lines[lines.length - 1].length) {
        lines.push([])
        curWidth = 0
      }
      lines[lines.length - 1].push(w)
      curWidth += wWidth
    })
    lines.forEach((line) => {
      while (line.length && line[line.length - 1].isSpace) line.pop()
    })
    return lines.filter((l) => l.length).length ? lines : [[]]
  }
  // a hanging-indent bullet: every wrapped line lines up under the text, not the bullet
  const bulletPara = (runs: { text: string; bold: boolean }[], o: ParaOpts & { bullet?: string; bulletGutter?: number } = {}) => {
    if (!runs.length || (runs.length === 1 && !runs[0].text)) {
      cursorY += o.after || 0
      return
    }
    const size = o.size || 11
    const lineHeight = size * (o.lh || 1.45)
    const indent = o.indent || 0
    const gutter = o.bullet ? o.bulletGutter || 13 : 0
    const color = o.color || INK
    wrapRuns(runs, { size, bold: o.bold, italic: o.italic }, contentW - indent - gutter).forEach((line, i) => {
      ensureSpace(lineHeight)
      if (o.bullet && i === 0) drawText(margin + indent, cursorY + size * 0.83, o.bullet, o.bold, false, size, color)
      let x = margin + indent + gutter
      line.forEach((w) => {
        drawText(x, cursorY + size * 0.83, w.text, w.bold, o.italic, size, color)
        x += measure(w.text, w.bold, o.italic, size)
      })
      cursorY += lineHeight
    })
    cursorY += o.after || 0
  }

  if (logo) {
    const targetHPt = 26
    const logoWPt = logo.width * (targetHPt / logo.height)
    ensureSpace(targetHPt + 10)
    curPage.drawImage(logo, { x: margin, y: pageH - cursorY - targetHPt, width: logoWPt, height: targetHPt })
    cursorY += targetHPt + 16
  }

  para(kicker(meeting), { size: 9.5, bold: true, color: BLUE, tracking: 1.2, after: 3 })
  para(meeting.project || 'Untitled project', { size: 22, bold: true, color: NAVY, after: 2 })
  if (meeting.subtitle) para(meeting.subtitle, { size: 12, italic: true, color: MUTED, after: 4 })
  rule(BLUE, 10, 1.6)
  // a shaded panel with a blue edge: the date and who was there
  const attendeeNames = presentAttendees(meeting).map(attendeeLabel).join(', ')
  const awayNames = awayAttendees(meeting).map(attendeeLabel).join(', ')
  const apologyNames = apologyAttendees(meeting).map(attendeeLabel).join(', ')
  const panelLines: { t: string; bold?: boolean; italic?: boolean; size: number; color: string }[] = [{ t: formatDateNice(meeting.date), bold: true, size: 11, color: NAVY }]
  if (attendeeNames) wrapLines('Attendees: ' + attendeeNames, false, false, 10, contentW - 28).forEach((t) => panelLines.push({ t, size: 10, color: INK }))
  if (apologyNames) wrapLines('Apologies: ' + apologyNames, false, false, 10, contentW - 28).forEach((t) => panelLines.push({ t, size: 10, color: INK }))
  if (awayNames) wrapLines('Also referenced (not in attendance): ' + awayNames, false, true, 9, contentW - 28).forEach((t) => panelLines.push({ t, italic: true, size: 9, color: MUTED }))
  const panelH = panelLines.reduce((h, l) => h + l.size * 1.45, 0) + 16
  ensureSpace(panelH + 14)
  {
    const sc = hexToRgb01(SHADE)
    const bc = hexToRgb01(BLUE)
    curPage.drawRectangle({ x: margin, y: pageH - cursorY - panelH, width: contentW, height: panelH, color: PDFLib.rgb(sc.r, sc.g, sc.b) })
    curPage.drawRectangle({ x: margin, y: pageH - cursorY - panelH, width: 3, height: panelH, color: PDFLib.rgb(bc.r, bc.g, bc.b) })
    let py = cursorY + 8
    panelLines.forEach((l) => {
      drawText(margin + 14, py + l.size * 0.83, l.t, l.bold, l.italic, l.size, l.color)
      py += l.size * 1.45
    })
    cursorY += panelH + 16
  }

  const nums = numberPoints(meeting.points)
  meeting.points.forEach((p, idx) => {
    if (p.type === 'heading') return sectionHeading(`${nums.get(p.id)}  ${p.text || ''}`, { before: idx === 0 ? 0 : 16 })
    const owner = attendeeById(meeting, p.ownerId)
    const metaBits: string[] = []
    if (p.urgent) metaBits.push('URGENT')
    if (owner) metaBits.push('Owner: ' + owner.name)
    if (p.dueDate) metaBits.push(dueWord(p) + formatDateNice(p.dueDate))
    if (refsLine(p)) metaBits.push(refsLine(p))
    const textColor = p.done ? '#8B97A6' : p.urgent ? '#B3261E' : INK
    const hasMeta = metaBits.length > 0
    const hasUpdates = p.updates.length > 0
    // the item number (4.3) stands where the bullet was, so a point can be quoted as "4.3"
    bulletPara(mentionRuns(p.text || '', meeting.attendees), { bullet: nums.get(p.id) ?? '–', bulletGutter: 28, size: 11.5, bold: !!p.urgent, color: textColor, after: hasMeta || hasUpdates ? 2 : 11 })
    if (hasMeta) para(metaBits.join('  ·  '), { size: 9.5, italic: true, color: MUTED, indent: 28, after: hasUpdates ? 2 : 11 })
    p.updates.forEach((u, i) => {
      para(formatDateNice(u.date) + ': ' + u.text, { size: 9, italic: true, color: '#6B7B8C', indent: 28, after: i === p.updates.length - 1 ? 11 : 3 })
    })
  })

  const summary = computeTaskSummary(meeting)
  if (summary.length) {
    sectionHeading('Task summary', { before: 14 })
    summary.forEach((g) => {
      // each person's actions under a shaded band with navy text, as the progress report's table headers
      ensureSpace(34)
      const sc = hexToRgb01(SHADE)
      curPage.drawRectangle({ x: margin, y: pageH - cursorY - 19, width: contentW, height: 19, color: PDFLib.rgb(sc.r, sc.g, sc.b) })
      drawText(margin + 8, cursorY + 13.5, g.owner ? g.owner.name : 'Unassigned', true, false, 10.5, NAVY)
      cursorY += 25
      g.items.forEach((p) => {
        const due = p.dueDate ? '   (' + dueWord(p) + formatDateNice(p.dueDate) + ')' : ''
        const runs = mentionRuns(p.text || '(no description)', meeting.attendees).concat(due ? [{ text: due, bold: false }] : [])
        bulletPara(runs, { bullet: nums.get(p.id) ?? '–', bulletGutter: 28, size: 10.5, color: p.done ? '#8B97A6' : '#14202D', indent: 8, after: 7 })
      })
    })
  }

  // the project hub: the job's one SharePoint link, at the foot of every issue
  if (hubUrl) {
    cursorY += 8
    ensureSpace(34)
    const sc = hexToRgb01(SHADE)
    const bc = hexToRgb01(BLUE)
    curPage.drawRectangle({ x: margin, y: pageH - cursorY - 28, width: contentW, height: 28, color: PDFLib.rgb(sc.r, sc.g, sc.b) })
    curPage.drawRectangle({ x: margin, y: pageH - cursorY - 28, width: 3, height: 28, color: PDFLib.rgb(bc.r, bc.g, bc.b) })
    const w = measure(HUB_LABEL, true, false, 10.5)
    drawText(margin + 14, cursorY + 18, HUB_LABEL, true, false, 10.5, BLUE)
    curPage.drawRectangle({ x: margin + 14, y: pageH - cursorY - 20.5, width: w, height: 0.7, color: PDFLib.rgb(bc.r, bc.g, bc.b) })
    links.push({ page: curPage, url: hubUrl, x: margin + 14, y: pageH - cursorY - 22, w, h: 14 })
    cursorY += 40
  } else cursorY += 4
  rule(LINE, 8)
  para(FOOTNOTE_TEXT, { size: 8.5, italic: true, color: '#6B7B8C', after: 0 })
  return links
}


type FontSet = Record<keyof typeof FONT_FILES, Uint8Array>
let fontBytes: Promise<FontSet> | null = null
// Aptos if its files are there, else Carlito (the Bold Italic file is optional for Aptos: bold stands in)
function loadFontBytes() {
  if (!fontBytes) {
    const carlito = () => Promise.all([fetchBytes(FONT_FILES.regular), fetchBytes(FONT_FILES.bold), fetchBytes(FONT_FILES.italic), fetchBytes(FONT_FILES.boldItalic)]).then(([regular, bold, italic, boldItalic]) => ({ regular, bold, italic, boldItalic }))
    const aptos = async () => {
      const [regular, bold, italic] = await Promise.all([fetchBytes(APTOS_FILES.regular), fetchBytes(APTOS_FILES.bold), fetchBytes(APTOS_FILES.italic)])
      const boldItalic = await fetchBytes(APTOS_FILES.boldItalic).catch(() => bold)
      return { regular, bold, italic, boldItalic }
    }
    fontBytes = aptos()
      .catch(carlito)
      .catch((e) => {
        fontBytes = null // try again next time rather than remembering the failure
        throw e
      })
  }
  return fontBytes
}

async function buildPdf(meeting: Meeting, withCarlito: boolean, hubUrl: string | null): Promise<Blob> {
  const PDFLib = await import('pdf-lib')
  const doc = await PDFLib.PDFDocument.create()
  doc.setTitle(`${meeting.project || 'Untitled project'} – ${formatDateNice(meeting.date)}`)
  let fonts: Fonts
  if (withCarlito) {
    const [{ default: fontkit }, bytes] = await Promise.all([import('@pdf-lib/fontkit'), loadFontBytes()])
    doc.registerFontkit(fontkit)
    // subset: false, as DBP Minutes found pdf-lib's subsetter drops glyphs with this font (the files are already
    // a small Latin-only build)
    const [regular, bold, italic, boldItalic] = await Promise.all([
      doc.embedFont(bytes.regular, { subset: false }),
      doc.embedFont(bytes.bold, { subset: false }),
      doc.embedFont(bytes.italic, { subset: false }),
      doc.embedFont(bytes.boldItalic, { subset: false }),
    ])
    fonts = { regular, bold, italic, boldItalic, clean: (s) => s.replace(/[\r\n\t]/g, ' ') }
  } else {
    const SF = PDFLib.StandardFonts
    const [regular, bold, italic, boldItalic] = await Promise.all([
      doc.embedFont(SF.Helvetica),
      doc.embedFont(SF.HelveticaBold),
      doc.embedFont(SF.HelveticaOblique),
      doc.embedFont(SF.HelveticaBoldOblique),
    ])
    fonts = { regular, bold, italic, boldItalic, clean: toWinAnsi }
  }
  const logo = await fetchBytes(LOGO_URL)
    .then((b) => doc.embedPng(b))
    .catch(() => null)
  const links = layoutPdf(doc, PDFLib, fonts, logo, meeting, hubUrl)
  for (const l of links) await addPdfLink(doc, l.page, l.url, l.x, l.y, l.w, l.h)
  // the foot of every page, as the progress report: du Boulay Projects Limited, Page x of y
  const pages = doc.getPages()
  const mc = hexToRgb01(MUTED)
  pages.forEach((p, i) => {
    const t = fonts.clean(`du Boulay Projects Limited  ·  Page ${i + 1} of ${pages.length}`)
    p.drawText(t, { x: p.getWidth() / 2 - fonts.regular.widthOfTextAtSize(t, 8) / 2, y: 24, size: 8, font: fonts.regular, color: PDFLib.rgb(mc.r, mc.g, mc.b) })
  })
  const bytes = await doc.save()
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}

// the minutes as a PDF file in memory (also what is emailed out)
export async function buildMinutesPdf(meeting: Meeting, hubUrl: string | null = null): Promise<Blob> {
  return buildPdf(meeting, true, hubUrl).catch((e) => {
    console.warn('PDF export: falling back to built-in font —', e instanceof Error ? e.message : e)
    return buildPdf(meeting, false, hubUrl)
  })
}

export async function exportMinutesPdf(meeting: Meeting, hubUrl: string | null = null): Promise<string> {
  const filename = minutesFilename(meeting, 'pdf')
  downloadBlob(await buildMinutesPdf(meeting, hubUrl), filename)
  return filename
}

// =====================================================================
// Word (.docx), built with the docx library
// =====================================================================
const hexNo = (c: string) => c.replace('#', '').toUpperCase()

export async function buildMinutesDocx(meeting: Meeting, hubUrl: string | null = null): Promise<Blob> {
  const { AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, ImageRun, PageNumber, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TabStopType, TextRun, WidthType } = await import('docx')
  const FONT = 'Aptos'
  const N = hexNo(NAVY)
  const B = hexNo(BLUE)
  const S = hexNo(SHADE)
  const M = hexNo(MUTED)
  const I = hexNo(INK)
  const logo = await fetchBytes(LOGO_URL).catch(() => null)
  const run = (text: string, o: { bold?: boolean; italics?: boolean; color?: string; size?: number } = {}) => new TextRun({ text, font: FONT, bold: o.bold, italics: o.italics, color: o.color ?? I, size: o.size ?? 21 })
  const mentions = (text: string, o: { bold?: boolean; italics?: boolean; color?: string; size?: number }) => mentionRuns(text, meeting.attendees).map((seg) => run(seg.text, { ...o, bold: o.bold || seg.bold }))
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const kids: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []

  if (logo) kids.push(new Paragraph({ spacing: { after: 240 }, children: [new ImageRun({ type: 'png', data: logo, transformation: { width: 160, height: 40 } })] }))
  kids.push(new Paragraph({ spacing: { after: 40 }, children: [run(kicker(meeting), { bold: true, color: B, size: 18 })] }))
  kids.push(new Paragraph({ spacing: { after: 60 }, children: [run(meeting.project || 'Untitled project', { bold: true, color: N, size: 44 })] }))
  if (meeting.subtitle) kids.push(new Paragraph({ spacing: { after: 80 }, children: [run(meeting.subtitle, { italics: true, color: M, size: 24 })] }))
  kids.push(new Paragraph({ spacing: { after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: B, space: 4 } }, children: [] }))

  // the shaded details panel with a blue edge
  const attendeeNames = presentAttendees(meeting).map(attendeeLabel).join(', ')
  const awayNames = awayAttendees(meeting).map(attendeeLabel).join(', ')
  const panel: InstanceType<typeof Paragraph>[] = [new Paragraph({ spacing: { after: 40 }, children: [run(formatDateNice(meeting.date), { bold: true, color: N, size: 22 })] })]
  if (attendeeNames) panel.push(new Paragraph({ spacing: { after: 40 }, children: [run('Attendees: ', { bold: true, color: N, size: 20 }), run(attendeeNames, { size: 20 })] }))
  const apologyNames = apologyAttendees(meeting).map(attendeeLabel).join(', ')
  if (apologyNames) panel.push(new Paragraph({ spacing: { after: 40 }, children: [run('Apologies: ', { bold: true, color: N, size: 20 }), run(apologyNames, { size: 20 })] }))
  if (awayNames) panel.push(new Paragraph({ spacing: { after: 40 }, children: [run('Also referenced (not in attendance): ' + awayNames, { italics: true, color: M, size: 18 })] }))
  kids.push(
    new Table({
      width: { size: 9026, type: WidthType.DXA },
      columnWidths: [9026],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 9026, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: S, color: 'auto' },
              margins: { top: 100, bottom: 80, left: 200, right: 160 },
              borders: { top: none, bottom: none, right: none, left: { style: BorderStyle.SINGLE, size: 24, color: B } },
              children: panel,
            }),
          ],
        }),
      ],
    }),
  )
  kids.push(new Paragraph({ spacing: { after: 120 }, children: [] }))

  const nums = numberPoints(meeting.points)
  meeting.points.forEach((p) => {
    if (p.type === 'heading') {
      kids.push(new Paragraph({ keepNext: true, spacing: { before: 320, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: B, space: 3 } }, children: [run(`${nums.get(p.id)}  ${(p.text || '').toUpperCase()}`, { bold: true, color: N, size: 24 })] }))
      return
    }
    const owner = attendeeById(meeting, p.ownerId)
    const metaBits: string[] = []
    if (p.urgent) metaBits.push('URGENT')
    if (owner) metaBits.push('Owner: ' + owner.name)
    if (p.dueDate) metaBits.push(dueWord(p) + formatDateNice(p.dueDate))
    if (refsLine(p)) metaBits.push(refsLine(p))
    const color = p.done ? '8B97A6' : p.urgent ? 'B3261E' : I
    // the item number (4.3) stands where the bullet was; a tab lines the text up under itself
    const runs = [run((nums.get(p.id) ?? '•') + '\t', { bold: true, color: p.urgent ? color : N }), ...mentions(p.text || '', { bold: !!p.urgent, color })]
    if (metaBits.length) runs.push(run('   (' + metaBits.join('  ·  ') + ')', { italics: true, color: M, size: 18 }))
    const hasUpdates = p.updates.length > 0
    // a real hanging indent: wrapped lines line up under the text, not the number
    kids.push(new Paragraph({ spacing: { after: hasUpdates ? 40 : 200 }, indent: { left: 560, hanging: 560 }, tabStops: [{ type: TabStopType.LEFT, position: 560 }], children: runs }))
    p.updates.forEach((u, i) => {
      kids.push(new Paragraph({ spacing: { after: i === p.updates.length - 1 ? 200 : 40 }, indent: { left: 560 }, children: [run(formatDateNice(u.date) + ': ' + u.text, { italics: true, color: M, size: 18 })] }))
    })
  })

  const summary = computeTaskSummary(meeting)
  if (summary.length) {
    kids.push(new Paragraph({ keepNext: true, spacing: { before: 360, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: B, space: 3 } }, children: [run('TASK SUMMARY', { bold: true, color: N, size: 24 })] }))
    // a table: the header shaded with navy text, as the progress report
    const widths = [2100, 5626, 1300]
    const cell = (t: string, w: number, o: { head?: boolean; bold?: boolean; italics?: boolean; color?: string } = {}) =>
      new TableCell({
        width: { size: w, type: WidthType.DXA },
        shading: o.head ? { type: ShadingType.CLEAR, fill: S, color: 'auto' } : undefined,
        margins: { top: 70, bottom: 70, left: 100, right: 100 },
        borders: { top: none, left: none, right: none, bottom: { style: BorderStyle.SINGLE, size: 4, color: hexNo(LINE) } },
        children: [new Paragraph({ children: o.head ? [run(t, { bold: true, color: N, size: 19 })] : [run(t, { bold: o.bold, italics: o.italics, color: o.color, size: 20 })] })],
      })
    const rows = [new TableRow({ tableHeader: true, children: [cell('Owner', widths[0], { head: true }), cell('Action', widths[1], { head: true }), cell('Due', widths[2], { head: true })] })]
    summary.forEach((g) =>
      g.items.forEach((p, i) =>
        rows.push(
          new TableRow({
            cantSplit: true,
            children: [
              cell(i === 0 ? (g.owner ? g.owner.name : 'Unassigned') : '', widths[0], { bold: true, color: N }),
              new TableCell({
                width: { size: widths[1], type: WidthType.DXA },
                margins: { top: 70, bottom: 70, left: 100, right: 100 },
                borders: { top: none, left: none, right: none, bottom: { style: BorderStyle.SINGLE, size: 4, color: hexNo(LINE) } },
                children: [new Paragraph({ children: [run((nums.get(p.id) ?? '') + '  ', { bold: true, color: N, size: 20 }), ...mentions(p.text || '(no description)', { size: 20, color: p.done ? '8B97A6' : I })] })],
              }),
              cell(p.dueDate ? dueWord(p) + formatDateNice(p.dueDate) : '', widths[2], { color: M }),
            ],
          }),
        ),
      ),
    )
    kids.push(new Table({ width: { size: 9026, type: WidthType.DXA }, columnWidths: widths, rows }))
  }

  // the project hub, then the footnote
  if (hubUrl) {
    kids.push(
      new Paragraph({
        spacing: { before: 360, after: 120 },
        shading: { type: ShadingType.CLEAR, fill: S, color: 'auto' },
        border: { left: { style: BorderStyle.SINGLE, size: 24, color: B, space: 8 } },
        indent: { left: 160 },
        children: [new ExternalHyperlink({ link: hubUrl, children: [new TextRun({ text: HUB_LABEL, font: FONT, bold: true, color: B, size: 21, underline: {} })] })],
      }),
    )
  }
  kids.push(new Paragraph({ spacing: { before: hubUrl ? 120 : 360, after: 40 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: hexNo(LINE), space: 6 } }, children: [run(FOOTNOTE_TEXT, { italics: true, color: '8B97A6', size: 18 })] }))

  const doc = new Document({
    creator: 'du Boulay Projects',
    title: `${meeting.project || 'Untitled project'} – ${formatDateNice(meeting.date)}`,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1440, right: 1440 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                border: { top: { style: BorderStyle.SINGLE, size: 8, color: B, space: 6 } },
                tabStops: [{ type: TabStopType.RIGHT, position: 9026 }],
                alignment: AlignmentType.LEFT,
                children: [run('du Boulay Projects Limited', { color: M, size: 16 }), new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: M })],
              }),
            ],
          }),
        },
        children: kids,
      },
    ],
  })
  return Packer.toBlob(doc)
}

export async function exportMinutesDocx(meeting: Meeting, hubUrl: string | null = null): Promise<string> {
  const filename = minutesFilename(meeting, 'docx')
  downloadBlob(await buildMinutesDocx(meeting, hubUrl), filename)
  return filename
}