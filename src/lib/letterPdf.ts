// DBP letters as PDF (24 Nov): the same Blocks as the Word letters (letter.ts), laid out on the real letterhead: the logo and
// address on the first page, the small logo and "Page x of y" after, the registered-company footer and accreditations. The
// letterhead's pictures are taken from public/templates/letterhead.docx, so there is one letterhead to keep up to date.
// Orders go out as PDF, never Word. Built in the browser with pdf-lib; nothing is uploaded. A4.
import JSZip from 'jszip'
import type { PDFFont, PDFPage, PDFImage } from 'pdf-lib'
import { loadPdfFonts } from './pdfFonts'
import type { Block, Run } from './letter'

const W = 595.28
const H = 841.89
const M = 56.7 // left / right margin, as the Word letterhead (1134 twips)
const CW = W - 2 * M
const TOP = 72 // the body starts here on later pages
const BLUE = '#007abe'
const INK = '#000000'
const LINE_H = 14 // the letterhead's line height (14 pt, "at least")
const SIZE = 11
const TAB = 36 // Word's default tab stop

const SPECIAL = new Map<number, string>([[0x2013, '-'], [0x2014, '-'], [0x2018, "'"], [0x2019, "'"], [0x201c, '"'], [0x201d, '"'], [0x2026, '...'], [0x2022, '-'], [0x20ac, 'EUR'], [0x2192, '->']])
function winAnsi(s: string) {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c === 9 || c === 10) out += ch
    else if ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff)) out += ch
    else out += SPECIAL.get(c) ?? '?'
  }
  return out
}

interface Tok {
  text: string // a word (no spaces) or a tab
  bold: boolean
  underline: boolean
  tab?: boolean
  space?: boolean // a space follows
}
interface Para {
  toks: Tok[]
  before: number
  after: number
  indent: number // pt
  hanging: number // pt
  align: 'left' | 'right' | 'center'
  keepNext: boolean
}
const tw = (n: number | undefined) => ((n ?? 0) / 20) // twips to points

export async function letterPdf(blocks: Block[], title = 'Letter'): Promise<Uint8Array> {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  doc.setCreator('DBP app')
  const hex = (h: string) => {
    const x = h.replace('#', '')
    return rgb(parseInt(x.slice(0, 2), 16) / 255, parseInt(x.slice(2, 4), 16) / 255, parseInt(x.slice(4, 6), 16) / 255)
  }

  // ---- fonts: Aptos when its files are in public/fonts, else Carlito, else Helvetica ----
  let regular: PDFFont, bold: PDFFont
  let clean = (s: string) => s
  try {
    const [{ default: fontkit }, bytes] = await Promise.all([import('@pdf-lib/fontkit'), loadPdfFonts()])
    doc.registerFontkit(fontkit)
    ;[regular, bold] = await Promise.all(bytes.slice(0, 2).map((b) => doc.embedFont(new Uint8Array(b), { subset: false })))
  } catch {
    ;[regular, bold] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)])
    clean = winAnsi
  }

  // ---- the letterhead's pictures, from the Word template ----
  const pics: Record<string, PDFImage | undefined> = {}
  try {
    const zip = await JSZip.loadAsync(await (await fetch('/templates/letterhead.docx')).arrayBuffer())
    const want: Record<string, string> = { small: 'image1.png', address: 'image3.png', logo: 'image5.png', badges: 'image7.png', strip: 'image8.png' }
    for (const [k, f] of Object.entries(want)) {
      const file = zip.file(`word/media/${f}`)
      if (file) pics[k] = await doc.embedPng(await file.async('uint8array'))
    }
  } catch {
    /* no letterhead pictures: the letter is still made */
  }

  let page!: PDFPage
  let pageNo = 0
  let y = 0
  const bottom = () => (pageNo === 1 ? 124 : 72) // the first page's footer (company details and badges) is taller
  const newPage = () => {
    page = doc.addPage([W, H])
    pageNo++
    if (pageNo === 1) {
      const logo = pics.logo
      if (logo) page.drawImage(logo, { x: M, y: H - 42.5 - 42.5, width: 171.1, height: 42.5 })
      const a = pics.address
      if (a) page.drawImage(a, { x: W - M - 131.4, y: H - 42.5 - 93.5, width: 131.4, height: 93.5 })
      const b = pics.badges
      if (b) page.drawImage(b, { x: 445.3, y: H - 728.5 - 75.7, width: 121.0, height: 75.7 })
      const s = pics.strip
      if (s) page.drawImage(s, { x: M, y: H - 799.3, width: 361.2, height: 19.96 })
      page.drawText(clean('Directors: DCH du Boulay, LR Brownlie, AJ Killeen, CS Gregory and KM Bialek'), { x: M, y: H - 772, size: 9, font: regular, color: hex(BLUE) })
    } else {
      const sm = pics.small
      if (sm) page.drawImage(sm, { x: M, y: H - 42.5 - 29.8, width: 120, height: 29.8 })
    }
    y = H - TOP
  }

  // ---- paragraphs ----
  const toksOf = (runs: Run[]): Tok[] => {
    const out: Tok[] = []
    for (const r of runs) {
      r.text.split('\t').forEach((part, ti) => {
        if (ti) out.push({ text: '\t', bold: !!r.bold, underline: false, tab: true })
        const words = clean(part).split(' ')
        words.forEach((w, i) => {
          if (w === '' && words.length > 1) return
          out.push({ text: w, bold: !!r.bold, underline: !!r.underline, space: i < words.length - 1 })
        })
      })
    }
    return out
  }
  const paraOf = (runs: Run[], o: { before?: number; after?: number; align?: 'left' | 'right' | 'center'; indent?: number; hanging?: number; keepNext?: boolean }): Para => ({
    toks: toksOf(runs),
    before: tw(o.before),
    after: o.after == null ? 8 : tw(o.after),
    indent: tw(o.indent),
    hanging: tw(o.hanging),
    align: o.align ?? 'left',
    keepNext: !!o.keepNext,
  })
  const fontOf = (t: Tok) => (t.bold ? bold : regular)
  const widthOf = (t: Tok) => (t.tab ? 0 : fontOf(t).widthOfTextAtSize(t.text, SIZE))
  const spaceW = regular.widthOfTextAtSize(' ', SIZE)

  interface Piece { x: number; tok: Tok }
  // break a paragraph into lines of positioned words
  function lay(p: Para): Piece[][] {
    const lines: Piece[][] = []
    let line: Piece[] = []
    let x = p.indent - p.hanging // first line starts here (relative to the margin)
    const right = CW
    for (const t of p.toks) {
      if (t.tab) {
        // a tab goes to the indent when there is a hanging indent, else to the next default stop
        const stop = p.hanging && x < p.indent ? p.indent : (Math.floor(x / TAB) + 1) * TAB
        x = stop
        continue
      }
      const w = widthOf(t)
      if (x + w > right && line.length) {
        lines.push(line)
        line = []
        x = p.indent
      }
      line.push({ x, tok: t })
      x += w + (t.space ? spaceW : 0)
    }
    lines.push(line)
    return lines
  }
  const heightOf = (p: Para, n: number) => p.before + n * LINE_H + p.after
  const ensure = (h: number) => {
    if (y - h < bottom()) newPage()
  }
  function drawPara(p: Para, lines: Piece[][]) {
    y -= p.before
    for (const ln of lines) {
      y -= LINE_H
      let shift = 0
      if (p.align !== 'left' && ln.length) {
        const last = ln[ln.length - 1]
        const used = last.x + widthOf(last.tok) - ln[0].x
        shift = p.align === 'right' ? CW - (ln[0].x + used) : (CW - used) / 2 - ln[0].x
      }
      for (const pc of ln) {
        if (!pc.tok.text) continue
        const x = M + pc.x + shift
        page.drawText(pc.tok.text, { x, y: y + 3.5, size: SIZE, font: fontOf(pc.tok), color: hex(INK) })
        if (pc.tok.underline) {
          const w = widthOf(pc.tok) + (pc.tok.space ? spaceW : 0)
          page.drawLine({ start: { x, y: y + 2 }, end: { x: x + w, y: y + 2 }, thickness: 0.6, color: hex(INK) })
        }
      }
    }
    y -= p.after
  }

  // ---- tables: the two-column order summary, or a head row + rows ----
  function drawTable(t: { head: string[]; rows: string[][]; widths: number[]; right?: number[]; boldLast?: boolean }) {
    const mm = CW / t.widths.reduce((s, w) => s + w, 0)
    const ws = t.widths.map((w) => w * mm)
    const xs = ws.reduce<number[]>((a, _w, i) => [...a, i ? a[i - 1] + ws[i - 1] : M], [])
    const showHead = t.head.some((h) => h.trim())
    const wrap = (text: string, width: number, f: PDFFont) => {
      const out: string[] = []
      for (const para of clean(text).split('\n')) {
        let line = ''
        for (const w of para.split(' ')) {
          const tt = line ? `${line} ${w}` : w
          if (f.widthOfTextAtSize(tt, SIZE) <= width || !line) line = tt
          else {
            out.push(line)
            line = w
          }
        }
        out.push(line)
      }
      return out
    }
    const row = (cells: string[], isBold: boolean, shade: boolean) => {
      const laid = cells.map((c, i) => wrap(c, ws[i] - 8, isBold ? bold : regular))
      const h = Math.max(...laid.map((l) => l.length)) * LINE_H + 6
      ensure(h)
      const top = y
      if (shade) page.drawRectangle({ x: M, y: top - h, width: CW, height: h, color: hex('#eaf2fa') })
      laid.forEach((lines, i) =>
        lines.forEach((ln, k) => {
          const f = isBold ? bold : regular
          const x = t.right?.includes(i) ? xs[i] + ws[i] - 4 - f.widthOfTextAtSize(ln, SIZE) : xs[i] + 4
          page.drawText(ln, { x, y: top - 3 - (k + 1) * LINE_H + 3.5, size: SIZE, font: f, color: hex(INK) })
        }),
      )
      y -= h
      page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.5, color: hex('#bfbfbf') })
    }
    page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.5, color: hex('#bfbfbf') })
    if (showHead) row(t.head, true, true)
    t.rows.forEach((r, i) => row(r, !!t.boldLast && i === t.rows.length - 1, false))
    y -= 6
  }

  // ---- run the blocks, keeping "keepNext" paragraphs with the one that follows ----
  newPage()
  const flat: ({ table: Extract<Block, { table: unknown }>['table'] } | { para: Para })[] = []
  for (const b of blocks) {
    if ('table' in b) flat.push({ table: b.table })
    else if (typeof b.p === 'string') {
      // a line break in plain text is a new line with no gap between (as the Word letter)
      const lines = b.p.split('\n')
      lines.forEach((line, i) =>
        flat.push({ para: paraOf([{ text: line, bold: b.bold, underline: b.underline }], { ...b, before: i === 0 ? b.before : 0, after: i === lines.length - 1 ? b.after : 0 }) }),
      )
    } else flat.push({ para: paraOf(b.p, b) })
  }
  for (let i = 0; i < flat.length; i++) {
    const item = flat[i]
    if ('table' in item) {
      drawTable(item.table)
      continue
    }
    const p = item.para
    const lines = lay(p)
    // this paragraph and the ones chained to it by keepNext must fit together
    let need = heightOf(p, lines.length)
    let j = i
    let cur = p
    while (cur.keepNext && j + 1 < flat.length) {
      const nx = flat[j + 1]
      if ('table' in nx) {
        need += 3 * LINE_H
        break
      }
      need += heightOf(nx.para, lay(nx.para).length)
      cur = nx.para
      j++
    }
    if (pageNo === 1 && y === H - TOP) {
      /* the very first paragraph: never push it off the page */
    } else ensure(need)
    drawPara(p, lines)
  }

  // ---- "Page x of y" on the pages after the first ----
  const all = doc.getPages()
  all.forEach((pg, i) => {
    if (i === 0) return
    const t = `Page ${i + 1} of ${all.length}`
    pg.drawText(t, { x: W - M - regular.widthOfTextAtSize(t, 9), y: H - 800, size: 9, font: regular, color: hex(INK) })
  })
  return doc.save()
}

export const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: 'application/pdf' })
