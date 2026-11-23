// The client's O&M manual as one PDF, built in the browser with pdf-lib (nothing is uploaded): front page,
// contents (page numbers and clickable links, from what's actually included), section dividers, description
// of works, project directory, residual risks, the handover document, then the documents by package from
// the files the user chose in the synced SharePoint O&Ms folder. JPG / PNG files become a page each; other
// types are skipped with a warning. Bookmarks (the PDF outline) for every section, package and document:
// pdf-lib has no outline API, so the /Outlines dictionaries are built with its low-level objects.
// Carlito (public/minutes/fonts, as the minutes export) with Helvetica as the fall-back. A4.
import type { PDFDocument, PDFFont, PDFImage, PDFPage, PDFRef } from 'pdf-lib'
import { downloadBlob } from './letter'
import { todayIso, ukDate } from './format'
import { HANDOVER_TABLES, RISK_COLS, buildDirectory, buildGroups, filledRows, groupKeyOf, lineName, type Col, type FileMatch, type OmData, type Row } from './om'
import type { Job } from './types'

type PdfLib = typeof import('pdf-lib')
const W = 595.28
const H = 841.89
const M = 50
const CW = W - M * 2
const NAVY = '#1f1246'
const BLUE = '#007abe'
const INK = '#1d1d24'
const MUTED = '#6b6b78'
const LINE = '#d9d9e0'
const SHADE = '#eef3fa'

const FONT_FILES = ['/minutes/fonts/Carlito-Regular.ttf', '/minutes/fonts/Carlito-Bold.ttf', '/minutes/fonts/Carlito-Italic.ttf']
async function fetchBytes(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}
// Unicode -> what the built-in Helvetica can show (the fall-back only)
const WINANSI_SPECIAL = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
])
function toWinAnsi(str: string) {
  let out = ''
  for (const ch of str) {
    const code = ch.codePointAt(0)!
    if (code === 0x09) out += ' '
    else if ((code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff) || WINANSI_SPECIAL.has(code)) out += ch
    else out += '?'
  }
  return out
}
const rgbOf = (PDFLib: PdfLib, hex: string) => {
  const h = hex.replace('#', '')
  return PDFLib.rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255)
}

interface Fonts {
  regular: PDFFont
  bold: PDFFont
  italic: PDFFont
  clean: (s: string) => string
}
async function embedFonts(doc: PDFDocument, PDFLib: PdfLib): Promise<Fonts> {
  try {
    const [{ default: fontkit }, bytes] = await Promise.all([import('@pdf-lib/fontkit'), Promise.all(FONT_FILES.map(fetchBytes))])
    doc.registerFontkit(fontkit)
    // subset: false, as the minutes export (pdf-lib's subsetter drops glyphs with this font)
    const [regular, bold, italic] = await Promise.all(bytes.map((b) => doc.embedFont(b, { subset: false })))
    return { regular, bold, italic, clean: (s) => s.replace(/\t/g, ' ').replace(/[⚠✓✔]/g, '') }
  } catch (e) {
    console.warn('O&M PDF: falling back to built-in font —', e instanceof Error ? e.message : e)
    const SF = PDFLib.StandardFonts
    const [regular, bold, italic] = await Promise.all([doc.embedFont(SF.Helvetica), doc.embedFont(SF.HelveticaBold), doc.embedFont(SF.HelveticaOblique)])
    return { regular, bold, italic, clean: toWinAnsi }
  }
}

export type Include = { description: boolean; directory: boolean; risks: boolean; handover: boolean; documents: boolean }
export const omPdfFilename = (job: Pick<Job, 'job_no' | 'code'>) => `${job.job_no} ${job.code} O&M manual.pdf`

// a contents / bookmark entry: level 0 section, 1 package, 2 document
interface Entry {
  title: string
  level: 0 | 1 | 2
  page?: PDFPage
}

export async function buildOmPdf(job: Job, data: OmData, include: Include, matches: FileMatch[], onProgress: (s: string) => void = () => {}) {
  const PDFLib = await import('pdf-lib')
  const doc = await PDFLib.PDFDocument.create()
  doc.setTitle(`${job.job_no} ${job.code} ${job.name}: Operation and maintenance manual`)
  doc.setAuthor(data.settings?.legal_name ?? 'du Boulay Projects')
  doc.setCreator('DBP app')
  const fonts = await embedFonts(doc, PDFLib)
  const warnings: string[] = []
  const groups = buildGroups(data)
  const today = todayIso()

  // ---------- the files: read and checked first, so the contents is exact ----------
  type Loaded = { m: FileMatch; pdf?: PDFDocument; img?: PDFImage }
  const loaded: Loaded[] = []
  let n = 0
  for (const m of include.documents ? matches : []) {
    if (m.skip) {
      if (m.kind === 'other') warnings.push(`${m.file.name}: skipped (only PDF, JPG and PNG files can go in).`)
      continue
    }
    onProgress(`Reading ${++n} of ${matches.filter((x) => !x.skip).length}: ${m.file.name}`)
    try {
      const bytes = new Uint8Array(await m.file.arrayBuffer())
      if (m.kind === 'pdf') {
        const pdf = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
        if (pdf.isEncrypted) warnings.push(`${m.file.name}: it's password-protected, so its pages may come out blank. Save an unprotected copy if so.`)
        if (!pdf.getPageCount()) throw new Error('it has no pages')
        loaded.push({ m, pdf })
      } else {
        const img = /\.png$/i.test(m.file.name) || m.file.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
        loaded.push({ m, img })
      }
    } catch (e) {
      warnings.push(`${m.file.name}: couldn't be read (${(e as Error).message}), so it was left out.`)
    }
  }

  // ---------- what goes in ----------
  const oj = data.omJob
  const description = (oj.description ?? '').trim()
  const risks = filledRows(oj.risks)
  const handover = HANDOVER_TABLES.map((t) => ({ ...t, rows: filledRows(oj.handover[t.key]) })).filter((t) => t.rows.length)
  const directory = buildDirectory(job, data)
  const byLine = new Map<string, Loaded[]>()
  for (const l of loaded) if (l.m.lineId) byLine.set(l.m.lineId, [...(byLine.get(l.m.lineId) ?? []), l])
  const docGroups = groups
    .map((g) => ({ g, lines: data.lines.filter((l) => groupKeyOf(l) === g.key && byLine.has(l.id)).sort((a, b) => a.sort - b.sort) }))
    .filter((x) => x.lines.length)
  const others = loaded.filter((l) => !l.m.lineId || !data.lines.some((x) => x.id === l.m.lineId))
  const sections = {
    description: include.description && !!description,
    directory: include.directory && directory.length > 0,
    risks: include.risks && risks.length > 0,
    handover: include.handover && handover.length > 0,
    documents: include.documents && (docGroups.length > 0 || others.length > 0),
  }
  const entries: Entry[] = []
  const sec = {
    description: 'Description of works',
    directory: 'Project directory',
    risks: 'Residual risks register',
    handover: 'Project handover document',
    documents: 'O&M documents',
  }
  const entry = (title: string, level: Entry['level']) => {
    const e: Entry = { title, level }
    entries.push(e)
    return e
  }
  // planned in order; each gets its page as it's laid out
  const plan = {
    description: sections.description ? entry(sec.description, 0) : null,
    directory: sections.directory ? entry(sec.directory, 0) : null,
    risks: sections.risks ? entry(sec.risks, 0) : null,
    handover: sections.handover ? entry(sec.handover, 0) : null,
    documents: sections.documents ? entry(sec.documents, 0) : null,
    groups: docGroups.map((x) => ({
      ...x,
      e: entry(`${x.g.title}${x.g.subtitle && x.g.kind !== 'job' ? ` (${x.g.subtitle.replace(/^\d+ · /, '').replace(/ · client direct$/, ', client direct')})` : ''}`, 1),
      docs: x.lines.map((l) => ({ l, e: entry(lineName(l, data.docTypes), 2) })),
    })),
    others: others.length ? { e: entry('Other documents', 1), docs: others.map((o) => ({ o, e: entry(o.m.file.name.replace(/\.[a-z0-9]{2,4}$/i, ''), 2) })) } : null,
  }
  if (!entries.length) throw new Error('There’s nothing to put in the manual yet: type the file sections, or choose the documents.')

  // ---------- drawing helpers ----------
  const generated = new Set<PDFPage>() // pages made here (footer and page number); imported pages are left as they are
  let page: PDFPage = doc.addPage([W, H])
  let y = M
  const newPage = () => {
    page = doc.addPage([W, H])
    generated.add(page)
    y = M
    return page
  }
  const ensure = (h: number) => {
    if (y + h > H - M - 20) newPage()
  }
  const text = (s: string, x: number, yTop: number, size: number, font: PDFFont = fonts.regular, color = INK, p: PDFPage = page) => {
    const t = fonts.clean(s)
    if (t) p.drawText(t, { x, y: H - yTop - size * 0.8, size, font, color: rgbOf(PDFLib, color) })
  }
  const width = (s: string, size: number, font: PDFFont = fonts.regular) => font.widthOfTextAtSize(fonts.clean(s), size)
  const wrap = (s: string, size: number, maxW: number, font: PDFFont = fonts.regular) => {
    const out: string[] = []
    for (const para of String(s ?? '').split(/\r?\n/)) {
      let line = ''
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const test = line ? `${line} ${w}` : w
        if (line && width(test, size, font) > maxW) {
          out.push(line)
          line = w
        } else line = test
        // a single word wider than the column (a long email or link): broken up
        while (width(line, size, font) > maxW && line.length > 1) {
          let cut = line.length - 1
          while (cut > 1 && width(line.slice(0, cut), size, font) > maxW) cut--
          out.push(line.slice(0, cut))
          line = line.slice(cut)
        }
      }
      out.push(line)
    }
    return out
  }
  const para = (s: string, o: { size?: number; font?: PDFFont; color?: string; after?: number; indent?: number; lh?: number } = {}) => {
    const size = o.size ?? 10.5
    const lh = size * (o.lh ?? 1.4)
    for (const ln of wrap(s, size, CW - (o.indent ?? 0), o.font)) {
      ensure(lh)
      text(ln, M + (o.indent ?? 0), y, size, o.font, o.color)
      y += lh
    }
    y += o.after ?? 6
  }
  const rule = (color = LINE, thick = 1) => page.drawRectangle({ x: M, y: H - y - thick, width: CW, height: thick, color: rgbOf(PDFLib, color) })
  const heading = (s: string, size = 16) => {
    ensure(size * 2 + 20)
    text(s, M, y, size, fonts.bold, NAVY)
    y += size * 1.35
    rule(BLUE, 1.5)
    y += 12
  }
  const subHeading = (s: string) => {
    ensure(60)
    y += 6
    text(s, M, y, 12, fonts.bold, NAVY)
    y += 20
  }
  // a table: header shaded, rows wrapped, header repeated on a new page
  const table = (cols: Col[], rows: Row[]) => {
    const total = cols.reduce((s, c) => s + c.w, 0)
    const ws = cols.map((c) => (c.w / total) * CW)
    const size = 9
    const lh = size * 1.3
    const pad = 4
    const header = () => {
      const hh = Math.max(...cols.map((c, i) => wrap(c.label, size, ws[i] - pad * 2, fonts.bold).length)) * lh + pad * 2
      ensure(hh + 30)
      page.drawRectangle({ x: M, y: H - y - hh, width: CW, height: hh, color: rgbOf(PDFLib, SHADE) })
      let x = M
      cols.forEach((c, i) => {
        wrap(c.label, size, ws[i] - pad * 2, fonts.bold).forEach((ln, k) => text(ln, x + pad, y + pad + k * lh, size, fonts.bold, NAVY))
        x += ws[i]
      })
      y += hh
    }
    header()
    for (const r of rows) {
      const cells = cols.map((c, i) => wrap(c.type === 'date' ? ukDate(r[c.k]) : (r[c.k] ?? ''), size, ws[i] - pad * 2))
      const rh = Math.max(1, ...cells.map((c) => c.length)) * lh + pad * 2
      if (y + rh > H - M - 20) {
        newPage()
        header()
      }
      let x = M
      cells.forEach((c, i) => {
        c.forEach((ln, k) => text(ln, x + pad, y + pad + k * lh, size))
        x += ws[i]
      })
      y += rh
      rule()
    }
    y += 10
  }
  // a section divider: its own page
  const divider = (e: Entry | null, kicker: string, lines: string[] = []) => {
    if (!e) return
    newPage()
    e.page = page
    page.drawRectangle({ x: 0, y: H * 0.42, width: 14, height: H * 0.2, color: rgbOf(PDFLib, BLUE) })
    text(kicker.toUpperCase(), M, H * 0.38, 11, fonts.bold, MUTED)
    let yy = H * 0.38 + 20
    for (const ln of wrap(e.title, e.level ? 24 : 30, CW, fonts.bold)) {
      text(ln, M, yy, e.level ? 24 : 30, fonts.bold, NAVY)
      yy += (e.level ? 24 : 30) * 1.2
    }
    yy += 10
    for (const ln of lines.flatMap((l) => wrap(l, 11, CW))) {
      if (yy > H - M - 30) break
      text(ln, M, yy, 11, fonts.regular, INK)
      yy += 16
    }
  }

  // ---------- front page ----------
  onProgress('Laying out the manual…')
  const logo = await fetchBytes('/dbp-logo.png')
    .then((b) => doc.embedPng(b))
    .catch(() => null)
  if (logo) {
    const lw = 200
    const lhh = (logo.height / logo.width) * lw
    page.drawImage(logo, { x: M, y: H - M - lhh, width: lw, height: lhh })
  }
  y = H * 0.36
  page.drawRectangle({ x: M, y: H - y + 18, width: 90, height: 4, color: rgbOf(PDFLib, BLUE) }) // a short accent above the title
  text('Operation & Maintenance Manual', M, y, 28, fonts.bold, NAVY)
  y += 48
  for (const ln of wrap(job.name, 22, CW, fonts.bold)) {
    text(ln, M, y, 22, fonts.bold, INK)
    y += 28
  }
  text(`${job.job_no} ${job.code}`, M, y, 13, fonts.regular, MUTED)
  y += 30
  if (job.site_address) {
    for (const ln of wrap(job.site_address, 12, CW)) {
      text(ln, M, y, 12)
      y += 17
    }
    y += 8
  }
  if (job.pc_date) text(`Practical completion: ${ukDate(job.pc_date)}`, M, y, 12, fonts.bold)
  let fy = H - M - 70
  text(`Prepared by ${data.settings?.legal_name ?? 'du Boulay Projects'}`, M, fy, 10.5, fonts.bold, NAVY)
  fy += 15
  for (const ln of [data.settings?.address, [data.settings?.phone, data.settings?.email, data.settings?.website].filter(Boolean).join(' · ')].filter(Boolean) as string[]) {
    text(ln, M, fy, 9.5, fonts.regular, MUTED)
    fy += 13
  }
  text(`Issued ${ukDate(today)}`, M, fy + 4, 9.5, fonts.regular, MUTED)
  const cover = page

  // ---------- contents: pages kept for it now, filled in once every page is known ----------
  const ROW = 17
  const firstCap = Math.floor((H - M * 2 - 20 - 60) / ROW) - 2
  const nextCap = Math.floor((H - M * 2 - 20) / ROW) - 1
  const indexCount = entries.length <= firstCap ? 1 : 1 + Math.ceil((entries.length - firstCap) / nextCap)
  const indexPages: PDFPage[] = []
  for (let i = 0; i < indexCount; i++) indexPages.push(newPage())

  // ---------- the typed sections ----------
  if (plan.description) {
    divider(plan.description, 'Section')
    newPage()
    heading(sec.description)
    for (const p of description.split(/\n\s*\n/)) para(p.trim(), { after: 8 })
  }
  if (plan.directory) {
    divider(plan.directory, 'Section')
    newPage()
    heading(sec.directory)
    table(
      [
        { k: 'role', label: 'Role', w: 2 },
        { k: 'company', label: 'Company', w: 3 },
        { k: 'contact', label: 'Contact', w: 2.4 },
        { k: 'phone', label: 'Phone', w: 1.8 },
        { k: 'email', label: 'Email', w: 3 },
      ],
      directory.map((d) => ({ role: d.role, company: [d.company, d.address].filter(Boolean).join('\n'), contact: d.contact, phone: d.phone, email: d.email })),
    )
  }
  if (plan.risks) {
    divider(plan.risks, 'Section')
    newPage()
    heading(sec.risks)
    para('Significant risks remaining in the finished works that the building’s users and maintainers need to know about, and how they are controlled.', {
      size: 9.5,
      color: MUTED,
      after: 10,
    })
    table(RISK_COLS, risks)
  }
  if (plan.handover) {
    divider(plan.handover, 'Section')
    newPage()
    heading(sec.handover)
    for (const t of handover) {
      subHeading(t.title)
      table(t.cols, t.rows)
    }
  }

  // ---------- the documents, by package ----------
  const place = async (l: Loaded, caption: string) => {
    if (l.pdf) {
      const copied = await doc.copyPages(l.pdf, l.pdf.getPageIndices())
      copied.forEach((p) => doc.addPage(p))
      return copied[0]
    }
    const img = l.img!
    const p = newPage()
    text(caption, M, M - 20, 9, fonts.italic, MUTED)
    const s = Math.min(CW / img.width, (H - M * 2 - 30) / img.height, 1.5)
    p.drawImage(img, { x: (W - img.width * s) / 2, y: H - M - 10 - img.height * s, width: img.width * s, height: img.height * s })
    return p
  }
  if (plan.documents) {
    divider(plan.documents, 'Section', ['The documents provided by each package, in order. Use the bookmarks or the contents to go to a package or document.'])
    for (const pg of plan.groups) {
      divider(
        pg.e,
        pg.g.kind === 'job' ? 'Project' : 'Package',
        pg.docs.map((d) => `•  ${d.e.title}`),
      )
      for (const d of pg.docs) {
        onProgress(`Adding ${d.e.title}…`)
        for (const [i, l] of (byLine.get(d.l.id) ?? []).entries()) {
          const first = await place(l, d.e.title)
          if (i === 0) d.e.page = first
        }
      }
    }
    if (plan.others) {
      divider(
        plan.others.e,
        'Other',
        plan.others.docs.map((d) => `•  ${d.e.title}`),
      )
      for (const d of plan.others.docs) d.e.page = await place(d.o, d.e.title)
    }
  }

  // ---------- page numbers ----------
  const pages = doc.getPages()
  const numberOf = (p: PDFPage) => pages.indexOf(p) + 1
  const ref = `${job.job_no} ${job.code} ${job.name} · Operation & Maintenance Manual`
  for (const p of pages) {
    if (p === cover || !generated.has(p)) continue
    p.drawRectangle({ x: M, y: M - 6, width: CW, height: 0.6, color: rgbOf(PDFLib, LINE) })
    p.drawText(fonts.clean(ref.length > 95 ? ref.slice(0, 94) + '…' : ref), { x: M, y: M - 20, size: 8, font: fonts.regular, color: rgbOf(PDFLib, MUTED) })
    const num = `Page ${numberOf(p)} of ${pages.length}`
    p.drawText(num, { x: W - M - width(num, 8), y: M - 20, size: 8, font: fonts.regular, color: rgbOf(PDFLib, MUTED) })
  }

  // ---------- contents ----------
  const ctx = doc.context
  const destOf = (p: PDFPage) => ctx.obj([p.ref, 'XYZ', null, null, null])
  const listed = entries.filter((e) => e.page)
  let ip = 0
  page = indexPages[0]
  y = M
  heading('Contents', 20)
  text('Page numbers are the PDF’s own. Click an entry to go to it.', M, y - 6, 9, fonts.italic, MUTED)
  y += 14
  for (const e of listed) {
    if (y + ROW > H - M - 20) {
      page = indexPages[++ip] ?? page
      y = M
    }
    const indent = e.level * 16
    const size = e.level === 0 ? 12 : e.level === 1 ? 10.5 : 10
    const font = e.level === 2 ? fonts.regular : fonts.bold
    if (e.level === 0 && y > M + 40) y += 4
    const num = String(numberOf(e.page!))
    const numW = width(num, size, font)
    const maxT = CW - indent - numW - 24
    let t = e.title
    while (t.length > 3 && width(t, size, font) > maxT) t = t.slice(0, -2)
    if (t !== e.title) t = t.replace(/.$/, '…')
    text(t, M + indent, y, size, font, e.level === 0 ? NAVY : INK)
    text(num, W - M - numW, y, size, font, e.level === 0 ? NAVY : INK)
    // dotted leader
    const from = M + indent + width(t, size, font) + 6
    const to = W - M - numW - 6
    for (let x = from; x < to; x += 4) page.drawCircle({ x, y: H - y - size * 0.7, size: 0.5, color: rgbOf(PDFLib, MUTED) })
    // the whole line is a link to its page
    const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [M + indent - 2, H - y - ROW + 4, W - M + 2, H - y + 2], Border: [0, 0, 0], Dest: destOf(e.page!) }))
    page.node.addAnnot(link)
    y += ROW
  }

  // ---------- bookmarks (the PDF outline) ----------
  type Node = { title: string; page: PDFPage; open: boolean; children: Node[] }
  const tree: Node[] = [
    { title: 'Front page', page: cover, open: false, children: [] },
    { title: 'Contents', page: indexPages[0], open: false, children: [] },
  ]
  for (const e of listed) {
    const node: Node = { title: e.title, page: e.page!, open: e.level === 0, children: [] }
    if (e.level === 0) tree.push(node)
    else if (e.level === 1) (tree[tree.length - 1]?.children ?? tree).push(node)
    else {
      const top = tree[tree.length - 1]
      const parent = top?.children[top.children.length - 1] ?? top
      ;(parent?.children ?? tree).push(node)
    }
  }
  addOutline(doc, PDFLib, tree)
  doc.catalog.set(PDFLib.PDFName.of('PageMode'), PDFLib.PDFName.of('UseOutlines'))

  onProgress('Saving…')
  const bytes = await doc.save()
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename: omPdfFilename(job), warnings, pages: pages.length }
}

// /Outlines → items with /Title /Parent /Prev /Next /First /Last /Count /Dest [page /XYZ null null null]
type OutlineNode = { title: string; page: PDFPage; open: boolean; children: OutlineNode[] }
function addOutline(doc: PDFDocument, PDFLib: PdfLib, nodes: OutlineNode[]) {
  const { PDFDict, PDFName, PDFHexString, PDFNumber } = PDFLib
  const ctx = doc.context
  const shown = (n: OutlineNode): number => (n.open ? n.children.reduce((s, c) => s + 1 + shown(c), 0) : 0)
  const build = (list: OutlineNode[], parent: PDFRef): PDFRef[] => {
    const refs = list.map(() => ctx.nextRef())
    list.forEach((n, i) => {
      const d = PDFDict.withContext(ctx)
      d.set(PDFName.of('Title'), PDFHexString.fromText(n.title))
      d.set(PDFName.of('Parent'), parent)
      if (i > 0) d.set(PDFName.of('Prev'), refs[i - 1])
      if (i < list.length - 1) d.set(PDFName.of('Next'), refs[i + 1])
      const kids = build(n.children, refs[i])
      if (kids.length) {
        d.set(PDFName.of('First'), kids[0])
        d.set(PDFName.of('Last'), kids[kids.length - 1])
        // open: how many show; closed: minus how many would show when opened
        d.set(PDFName.of('Count'), PDFNumber.of(n.open ? shown(n) : -n.children.length))
      }
      d.set(PDFName.of('Dest'), ctx.obj([n.page.ref, 'XYZ', null, null, null]))
      ctx.assign(refs[i], d)
    })
    return refs
  }
  const root = ctx.nextRef()
  const top = build(nodes, root)
  const r = PDFDict.withContext(ctx)
  r.set(PDFName.of('Type'), PDFName.of('Outlines'))
  if (top.length) {
    r.set(PDFName.of('First'), top[0])
    r.set(PDFName.of('Last'), top[top.length - 1])
  }
  r.set(PDFName.of('Count'), PDFNumber.of(nodes.reduce((s, n) => s + 1 + shown(n), 0)))
  ctx.assign(root, r)
  doc.catalog.set(PDFName.of('Outlines'), root)
}

export async function downloadOmPdf(...args: Parameters<typeof buildOmPdf>) {
  const r = await buildOmPdf(...args)
  downloadBlob(r.blob, r.filename)
  return r
}
