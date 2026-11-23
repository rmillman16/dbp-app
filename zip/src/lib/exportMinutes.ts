// Minutes exports, as DBP Minutes made them (22 Nov): PDF and Word, same layout, wording and footnote.
// PDF: real text (small, sharp, searchable) with the Carlito font (an open Calibri / Aptos look-alike, in
// public/minutes/fonts with its licence) embedded by pdf-lib. If the font can't be loaded it falls back to the
// PDF's built-in Helvetica rather than failing. Pages are A4.
// Word: a plain .docx with the logo, hanging-indent bullets and @mentions as bold names.
// The "£ cost impact" flag is never exported (in the app only).
import JSZip from 'jszip'
import { downloadBlob } from './letter'
import {
  attendeeById,
  attendeeLabel,
  awayAttendees,
  computeTaskSummary,
  dueWord,
  FOOTNOTE_TEXT,
  formatDateNice,
  mentionRuns,
  presentAttendees,
  slug,
  type Meeting,
} from './minutes'

const LOGO_URL = '/minutes/logo-lockup.png'
const FONT_FILES = {
  regular: '/minutes/fonts/Carlito-Regular.ttf',
  bold: '/minutes/fonts/Carlito-Bold.ttf',
  italic: '/minutes/fonts/Carlito-Italic.ttf',
  boldItalic: '/minutes/fonts/Carlito-BoldItalic.ttf',
}

async function fetchBytes(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

export const minutesFilename = (m: Meeting, ext: 'pdf' | 'docx') => `${slug(m.project)}-${m.date}.${ext}`

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

function layoutPdf(doc: import('pdf-lib').PDFDocument, PDFLib: PdfLib, fonts: Fonts, logo: import('pdf-lib').PDFImage | null, meeting: Meeting) {
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
    const color = o.color || '#14202D'
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
  const rule = (color = '#CFDBE8', after = 8) => {
    ensureSpace(3)
    const c = hexToRgb01(color)
    const thickness = 1.4
    curPage.drawRectangle({ x: margin, y: pageH - cursorY - thickness, width: contentW, height: thickness, color: PDFLib.rgb(c.r, c.g, c.b) })
    cursorY += after
  }
  // headings (points marked as headings, and TASK SUMMARY) share one look, with a hairline under
  const sectionHeading = (text: string, o: { before?: number; ruleAfter?: number } = {}) => {
    para(text.toUpperCase(), { size: 13, bold: true, color: '#1E3A5F', tracking: 0.6, before: o.before, after: 6 })
    rule('#CFDBE8', o.ruleAfter || 10)
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
    const color = o.color || '#14202D'
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

  para(meeting.project || 'Untitled project', { size: 20, bold: true, after: 2 })
  if (meeting.subtitle) para(meeting.subtitle, { size: 12, italic: true, color: '#48586B', after: 4 })
  const attendeeNames = presentAttendees(meeting).map(attendeeLabel).join(', ')
  const awayNames = awayAttendees(meeting).map(attendeeLabel).join(', ')
  para(formatDateNice(meeting.date) + (attendeeNames ? '   ·   Attendees: ' + attendeeNames : ''), { size: 10.5, color: '#48586B', after: awayNames ? 1 : 6 })
  if (awayNames) para('Also referenced (not in attendance): ' + awayNames, { size: 9.5, italic: true, color: '#6B7B8C', after: 6 })
  rule('#1E3A5F', 14)

  meeting.points.forEach((p, idx) => {
    if (p.type === 'heading') return sectionHeading(p.text || '', { before: idx === 0 ? 0 : 16 })
    const owner = attendeeById(meeting, p.ownerId)
    const metaBits: string[] = []
    if (p.urgent) metaBits.push('URGENT')
    if (owner) metaBits.push('Owner: ' + owner.name)
    if (p.dueDate) metaBits.push(dueWord(p) + formatDateNice(p.dueDate))
    const textColor = p.done ? '#8B97A6' : p.urgent ? '#B3261E' : '#14202D'
    const hasMeta = metaBits.length > 0
    const hasUpdates = p.updates.length > 0
    bulletPara(mentionRuns(p.text || '', meeting.attendees), { bullet: '–', size: 11.5, bold: !!p.urgent, color: textColor, after: hasMeta || hasUpdates ? 2 : 11 })
    if (hasMeta) para(metaBits.join('  ·  '), { size: 9.5, italic: true, color: '#48586B', indent: 13, after: hasUpdates ? 2 : 11 })
    p.updates.forEach((u, i) => {
      para(formatDateNice(u.date) + ': ' + u.text, { size: 9, italic: true, color: '#6B7B8C', indent: 13, after: i === p.updates.length - 1 ? 11 : 3 })
    })
  })

  const summary = computeTaskSummary(meeting)
  if (summary.length) {
    rule('#1E3A5F', 10)
    sectionHeading('Task summary', {})
    summary.forEach((g) => {
      para(g.owner ? g.owner.name : 'Unassigned', { size: 11, bold: true, after: 5 })
      g.items.forEach((p) => {
        const due = p.dueDate ? '   (' + dueWord(p) + formatDateNice(p.dueDate) + ')' : ''
        const runs = mentionRuns(p.text || '(no description)', meeting.attendees).concat(due ? [{ text: due, bold: false }] : [])
        bulletPara(runs, { bullet: '–', size: 10.5, color: p.done ? '#8B97A6' : '#14202D', indent: 8, after: 7 })
      })
    })
  }

  rule('#CFDBE8', 8)
  para(FOOTNOTE_TEXT, { size: 8.5, italic: true, color: '#6B7B8C', after: 0 })
}

let fontBytes: Promise<Record<keyof typeof FONT_FILES, Uint8Array>> | null = null
function loadFontBytes() {
  if (!fontBytes) {
    fontBytes = Promise.all([fetchBytes(FONT_FILES.regular), fetchBytes(FONT_FILES.bold), fetchBytes(FONT_FILES.italic), fetchBytes(FONT_FILES.boldItalic)])
      .then(([regular, bold, italic, boldItalic]) => ({ regular, bold, italic, boldItalic }))
      .catch((e) => {
        fontBytes = null // try again next time rather than remembering the failure
        throw e
      })
  }
  return fontBytes
}

async function buildPdf(meeting: Meeting, withCarlito: boolean): Promise<Blob> {
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
  layoutPdf(doc, PDFLib, fonts, logo, meeting)
  const bytes = await doc.save()
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}

export async function exportMinutesPdf(meeting: Meeting): Promise<string> {
  const filename = minutesFilename(meeting, 'pdf')
  const blob = await buildPdf(meeting, true).catch((e) => {
    console.warn('PDF export: falling back to built-in font —', e instanceof Error ? e.message : e)
    return buildPdf(meeting, false)
  })
  downloadBlob(blob, filename)
  return filename
}

// =====================================================================
// Word (.docx)
// =====================================================================
const xmlEscape = (str: string) => str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
const docxParagraph = (runsXml: string, pPr = '') => '<w:p>' + pPr + runsXml + '</w:p>'
type RunOpts = { bold?: boolean; italic?: boolean; color?: string; size?: number }
function docxRun(text: string, o: RunOpts = {}) {
  let rPr = '<w:rPr>'
  if (o.bold) rPr += '<w:b/>'
  if (o.italic) rPr += '<w:i/>'
  if (o.color) rPr += '<w:color w:val="' + o.color + '"/>'
  if (o.size) rPr += '<w:sz w:val="' + o.size + '"/>'
  rPr += '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr>'
  return '<w:r>' + rPr + '<w:t xml:space="preserve">' + xmlEscape(text) + '</w:t></w:r>'
}
// @mentions as their own bold run, the @ dropped
const mentionDocxRuns = (text: string, meeting: Meeting, base: RunOpts) =>
  mentionRuns(text, meeting.attendees)
    .map((seg) => docxRun(seg.text, { bold: base.bold || seg.bold, italic: base.italic, color: base.color, size: base.size }))
    .join('')

// logo in EMU (914400 per inch): the lockup is 1590 × 400 px, shown about 1.67 in wide
const LOGO_EMU_W = 1524000
const LOGO_EMU_H = 383397
function logoParagraph() {
  return (
    '<w:p><w:pPr><w:spacing w:after="200"/></w:pPr><w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    '<wp:extent cx="' +
    LOGO_EMU_W +
    '" cy="' +
    LOGO_EMU_H +
    '"/>' +
    '<wp:docPr id="1" name="DBP logo"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="1" name="DBP logo"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdLogo" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' +
    LOGO_EMU_W +
    '" cy="' +
    LOGO_EMU_H +
    '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
  )
}

function buildDocxXml(meeting: Meeting, withLogo: boolean) {
  let body = ''
  if (withLogo) body += logoParagraph()
  body += docxParagraph(docxRun(meeting.project || 'Untitled project', { bold: true, size: 44 }))
  if (meeting.subtitle) body += docxParagraph(docxRun(meeting.subtitle, { italic: true, size: 24, color: '5B6B7C' }))
  body += docxParagraph(docxRun(formatDateNice(meeting.date), { size: 20, color: '5B6B7C' }), '<w:pPr><w:spacing w:after="80"/></w:pPr>')
  const attendeeNames = presentAttendees(meeting).map(attendeeLabel).join(', ')
  const awayNames = awayAttendees(meeting).map(attendeeLabel).join(', ')
  if (attendeeNames) {
    body += docxParagraph(
      docxRun('Attendees: ', { bold: true, size: 20, color: '1E3A5F' }) + docxRun(attendeeNames, { size: 20, color: '2C3B4C' }),
      '<w:pPr><w:spacing w:after="' + (awayNames ? '40' : '240') + '"/></w:pPr>',
    )
  }
  if (awayNames) {
    body += docxParagraph(docxRun('Also referenced (not in attendance): ' + awayNames, { italic: true, size: 18, color: '5B6B7C' }), '<w:pPr><w:spacing w:after="240"/></w:pPr>')
  }

  meeting.points.forEach((p) => {
    if (p.type === 'heading') {
      body += docxParagraph(docxRun((p.text || '').toUpperCase(), { bold: true, size: 22, color: '1E3A5F' }), '<w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>')
      return
    }
    const owner = attendeeById(meeting, p.ownerId)
    const metaBits: string[] = []
    if (p.urgent) metaBits.push('URGENT')
    if (owner) metaBits.push('Owner: ' + owner.name)
    if (p.dueDate) metaBits.push(dueWord(p) + formatDateNice(p.dueDate))
    const textColor = p.urgent ? 'B3261E' : undefined
    let runs = docxRun('•  ', { size: 22, bold: !!p.urgent, color: textColor }) + mentionDocxRuns(p.text || '', meeting, { size: 22, bold: !!p.urgent, color: textColor })
    if (metaBits.length) runs += docxRun('   (' + metaBits.join('  ·  ') + ')', { size: 18, italic: true, color: '5B6B7C' })
    const hasUpdates = p.updates.length > 0
    // a real hanging indent: wrapped lines line up under the text, not the bullet
    body += docxParagraph(runs, '<w:pPr><w:spacing w:after="' + (hasUpdates ? '40' : '220') + '"/><w:ind w:left="260" w:hanging="260"/></w:pPr>')
    p.updates.forEach((u, i) => {
      body += docxParagraph(
        docxRun(formatDateNice(u.date) + ': ' + u.text, { size: 18, italic: true, color: '6B7B8C' }),
        '<w:pPr><w:spacing w:after="' + (i === p.updates.length - 1 ? '220' : '40') + '"/><w:ind w:left="260"/></w:pPr>',
      )
    })
  })

  const summary = computeTaskSummary(meeting)
  if (summary.length) {
    body += docxParagraph(
      docxRun('TASK SUMMARY', { bold: true, size: 22, color: '1E3A5F' }),
      '<w:pPr><w:spacing w:before="320" w:after="100"/><w:pBdr><w:top w:val="single" w:sz="12" w:color="1E3A5F"/></w:pBdr></w:pPr>',
    )
    summary.forEach((g) => {
      body += docxParagraph(docxRun(g.owner ? g.owner.name : 'Unassigned', { bold: true, size: 21 }), '<w:pPr><w:spacing w:before="120" w:after="60"/></w:pPr>')
      g.items.forEach((p) => {
        const due = p.dueDate ? '   (' + dueWord(p) + formatDateNice(p.dueDate) + ')' : ''
        let runs2 = docxRun('•  ', { size: 20 }) + mentionDocxRuns(p.text || '(no description)', meeting, { size: 20 })
        if (due) runs2 += docxRun(due, { size: 20 })
        body += docxParagraph(runs2, '<w:pPr><w:spacing w:after="110"/><w:ind w:left="420" w:hanging="260"/></w:pPr>')
      })
    })
  }
  body += docxParagraph(
    docxRun(FOOTNOTE_TEXT, { italic: true, size: 18, color: '8B97A6' }),
    '<w:pPr><w:spacing w:before="320" w:after="40"/><w:pBdr><w:top w:val="single" w:sz="4" w:color="CFDBE8"/></w:pBdr></w:pPr>',
  )

  // A4, 1 inch margins
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' +
    body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>'
  )
}

export async function buildMinutesDocx(meeting: Meeting): Promise<Blob> {
  const logo = await fetchBytes(LOGO_URL).catch(() => null)
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  )
  zip.file('word/document.xml', buildDocxXml(meeting, !!logo))
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      (logo ? '<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>' : '') +
      '</Relationships>',
  )
  if (logo) zip.file('word/media/logo.png', logo)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

export async function exportMinutesDocx(meeting: Meeting): Promise<string> {
  const filename = minutesFilename(meeting, 'docx')
  downloadBlob(await buildMinutesDocx(meeting), filename)
  return filename
}
