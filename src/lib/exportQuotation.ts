// Word export of a quotation, matching the 2611 waterproofing quotation (30.10.2026):
// logo top left on page 1, navy QUOTATION banner, details table, opening line,
// numbered section bars (01 Scope, 02 Pricing, 03 Qualifications, 04 Validity &
// acceptance, then appendices), and "du Boulay Projects | Quotation – … Page x of y"
// on every page.
import type { IRunOptions, ParagraphChild, Paragraph as DocParagraph, Table as DocTable, TextRun as DocTextRun } from 'docx'
import type { Job, Quotation, QuotationClause, QuotationLine, TextGroup } from './types'
import { lineTotal } from './variations'
import { fullRef, quoteTotal } from './quotations'

const NAVY = '1F1246'
const BLUE = '007ABE'
const TINT = 'EAF2FA'
const RULE = 'C9DCEC'
const GREY = '6B6B78'
const FONT = 'Aptos'

const MM = 56.6929 // twips per mm
const num2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const gbp = (n: number) => `£${num2.format(n)}`
const longDate = (iso: string | null) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

export interface QuoteDoc {
  job: Job | null // null for Estimating quotations
  owner: Parameters<typeof fullRef>[0] // job or enquiry, for the reference (2611 FISL / E001)
  q: Quotation
  lines: QuotationLine[]
  clauses: QuotationClause[]
  acceptanceWording: string
  terms: string
}

export async function exportQuotationWord(d: QuoteDoc) {
  const x = await import('docx')
  const { AlignmentType, BorderStyle, Document, Footer, Header, HeightRule, ImageRun, LevelFormat, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TabStopType, TextRun, VerticalAlign, WidthType, TableLayoutType } = x

  const { job, q } = d
  const project = job?.name ?? q.project_name ?? ''
  const site = q.site ?? job?.site_address ?? ''
  const siteOneLine = site.replace(/\s*\n\s*/g, ', ')
  const total = quoteTotal(d.lines)

  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const noBorders = { top: none, bottom: none, left: none, right: none }
  const run = (text: string, o: Partial<IRunOptions> = {}) => new TextRun({ text, font: FONT, size: 19, color: '222222', ...o })
  const para = (children: ParagraphChild[], o: Record<string, unknown> = {}) => new Paragraph({ children, spacing: { after: 120, line: 276 }, ...o })

  // **bold** inside text, as typed in the app
  const rich = (text: string, o: Partial<IRunOptions> = {}): DocTextRun[] =>
    text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((t) => (t.startsWith('**') ? run(t.slice(2, -2), { ...o, bold: true, color: NAVY }) : run(t, o)))

  // ---------- building blocks ----------
  // the progress report's heading: navy text with a blue rule under it (no band)
  const sectionBar = (no: string, title: string, keepNext = false) =>
    new Paragraph({
      keepNext,
      spacing: { before: 120, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 3 } },
      children: [run(no ? `${no}  ${title}` : title, { bold: true, color: NAVY, size: 30 })],
    })
  const gap = (after = 160, keepNext = false) => new Paragraph({ children: [], spacing: { after }, keepNext })
  const subHeading = (text: string) =>
    new Paragraph({
      children: [run(text, { bold: true, color: BLUE, size: 21 })],
      spacing: { before: 200, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 2 } },
    })
  let listInstance = 0
  const list = (items: string[], style: 'numbered' | 'bullets') => {
    const instance = ++listInstance
    return items
      .filter((t) => t.trim())
      .map((t) => new Paragraph({ children: rich(t.trim()), numbering: { reference: style, level: 0, instance }, spacing: { after: 60, line: 264 } }))
  }
  const groups = (gs: TextGroup[], defaultStyle: 'numbered' | 'bullets') =>
    gs.flatMap((g) => [...(g.heading ? [subHeading(g.heading)] : []), ...list(g.items, g.style ?? defaultStyle)])

  // Free text with simple markers, used for appendices and T&Cs:
  //   "# Title" → new appendix section bar, "## Heading" → sub-heading, "- item" → bullet, else paragraph
  const freeText = (text: string, appendixLetters = false) => {
    const out: (DocParagraph | DocTable)[] = []
    let letter = 0
    let bullets: string[] = []
    const flush = () => {
      if (bullets.length) out.push(...list(bullets, 'bullets'))
      bullets = []
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trimEnd()
      if (line.startsWith('- ')) {
        bullets.push(line.slice(2))
        continue
      }
      flush()
      if (line.startsWith('## ')) out.push(subHeading(line.slice(3)))
      else if (line.startsWith('# ')) {
        const L = String.fromCharCode(65 + letter++)
        out.push(gap(120), sectionBar(appendixLetters ? L : '', appendixLetters ? `Appendix ${L} — ${line.slice(2)}` : line.slice(2)), gap(120))
      } else if (line.trim()) out.push(para(rich(line)))
    }
    flush()
    return out
  }

  // ---------- page 1 ----------
  const logo = new Uint8Array(await (await fetch('/dbp-logo.png')).arrayBuffer())
  // title block as the progress report's cover: big navy title, blue subject, ink project name, grey address
  const banner = [
    new Paragraph({ children: [run('Quotation', { bold: true, color: NAVY, size: 56 })], spacing: { before: 120, after: 80 } }),
    new Paragraph({ children: [run(q.subject, { color: BLUE, size: 30 })], spacing: { after: 100 } }),
    new Paragraph({ children: [run(project, { bold: true, color: '1D1D24', size: 36 })], spacing: { after: 60 } }),
    ...(siteOneLine ? [new Paragraph({ children: [run(siteOneLine, { color: GREY, size: 22 })], spacing: { after: 60 } })] : []),
  ]

  const detailRows: [string, string][] = [
    ['Project', project],
    ...(q.client_name ? ([['Client', [q.client_name, q.client_contact].filter(Boolean).join(' · ')]] as [string, string][]) : []),
    ['Site address', siteOneLine],
    ['Prepared by', q.prepared_by ?? 'du Boulay Projects'],
    ['Quotation date', longDate(q.issued_date)],
    ['Quotation ref', fullRef(d.owner, q)],
    ['Valid until', longDate(q.valid_until)],
  ]
  const rowBorder = { style: BorderStyle.SINGLE, size: 4, color: RULE }
  const details = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [Math.round(50 * MM), Math.round(120 * MM)],
    layout: TableLayoutType.FIXED,
    rows: detailRows.map(
      ([k, v]) =>
        new TableRow({
          children: [
            new TableCell({ shading: { type: ShadingType.CLEAR, fill: TINT, color: 'auto' }, borders: { ...noBorders, top: rowBorder, bottom: rowBorder }, margins: { top: 90, bottom: 90, left: 200 }, children: [new Paragraph({ children: [run(k, { bold: true, color: NAVY })] })] }),
            new TableCell({ borders: { ...noBorders, top: rowBorder, bottom: rowBorder }, margins: { top: 90, bottom: 90, left: 200 }, children: [new Paragraph({ children: [run(v)] })] }),
          ],
        }),
    ),
  })

  const opening = para([
    run('du Boulay Projects is pleased to submit our quotation of '),
    run(`${gbp(total)} + VAT`, { bold: true, color: NAVY }),
    run(` for ${q.summary?.trim() || 'the works'} set out below.`),
  ])

  // ---------- 02 pricing ----------
  const cell = (children: DocParagraph[], o: Record<string, unknown> = {}) =>
    new TableCell({ borders: { ...noBorders, bottom: rowBorder }, margins: { top: 90, bottom: 90, left: 120, right: 120 }, verticalAlign: VerticalAlign.CENTER, children, ...o })
  const p = (text: string, align: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT, o: Partial<IRunOptions> = {}) => new Paragraph({ alignment: align, children: [run(text, o)] })
  const head = (text: string, align: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT) =>
    new TableCell({ shading: { type: ShadingType.CLEAR, fill: TINT, color: 'auto' }, borders: noBorders, margins: { top: 90, bottom: 90, left: 120, right: 120 }, children: [p(text, align, { bold: true, color: NAVY })] })
  const W = [15, 85, 13, 17, 24, 26].map((w) => Math.round(w * MM)) // item, description, qty, unit, rate, total (mm)
  const pricing = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: W,
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ tableHeader: true, children: [head('Item', AlignmentType.CENTER), head('Description'), head('Qty', AlignmentType.CENTER), head('Unit', AlignmentType.CENTER), head('Rate (£)', AlignmentType.RIGHT), head('Total (£)', AlignmentType.RIGHT)] }),
      ...d.lines.map((l, i) => {
        const shade = i % 2 ? { shading: { type: ShadingType.CLEAR, fill: 'F5F8FC', color: 'auto' } } : {}
        const desc = [
          ...(l.heading ? [run(l.heading, { bold: true, color: NAVY })] : []),
          ...(l.heading && l.description ? [run(' — ')] : []),
          ...rich(l.description),
        ]
        return new TableRow({
          cantSplit: true,
          children: [
            cell([p(l.item || String(i + 1), AlignmentType.CENTER)], shade),
            cell([new Paragraph({ children: desc })], shade),
            cell([p(l.qty == null ? '' : String(l.qty), AlignmentType.CENTER)], shade),
            cell([p(l.unit ?? '', AlignmentType.CENTER)], shade),
            cell([p(num2.format(l.rate ?? 0), AlignmentType.RIGHT)], shade),
            cell([p(num2.format(lineTotal(l)), AlignmentType.RIGHT)], shade),
          ],
        })
      }),
      new TableRow({
        children: [
          new TableCell({ columnSpan: 5, shading: { type: ShadingType.CLEAR, fill: TINT, color: 'auto' }, borders: { ...noBorders, top: { style: BorderStyle.SINGLE, size: 12, color: BLUE } }, margins: { top: 110, bottom: 110, right: 160 }, children: [p('TOTAL (EXCLUDING VAT)', AlignmentType.RIGHT, { bold: true, color: NAVY })] }),
          new TableCell({ shading: { type: ShadingType.CLEAR, fill: TINT, color: 'auto' }, borders: { ...noBorders, top: { style: BorderStyle.SINGLE, size: 12, color: BLUE } }, margins: { top: 110, bottom: 110, right: 120 }, children: [p(gbp(total), AlignmentType.RIGHT, { bold: true, color: NAVY })] }),
        ],
      }),
    ],
  })

  // ---------- 04 validity & acceptance (kept together on one page) ----------
  const signRow = (label: string, last: boolean) =>
    new TableRow({
      cantSplit: true,
      height: { value: Math.round(12 * MM), rule: HeightRule.ATLEAST },
      children: [
        new TableCell({ borders: noBorders, verticalAlign: VerticalAlign.BOTTOM, children: [new Paragraph({ keepNext: !last, children: [run(label, { bold: true, color: NAVY })] })] }),
        new TableCell({ borders: { ...noBorders, bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY } }, children: [new Paragraph({ keepNext: !last, children: [] })] }),
      ],
    })
  const signOff = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [Math.round(50 * MM), Math.round(120 * MM)],
    layout: TableLayoutType.FIXED,
    rows: ['Accepted by (name)', 'Company', 'Position', 'Signature', 'Date'].map((l, i, all) => signRow(l, i === all.length - 1)),
  })

  // ---------- assemble ----------
  const body: (DocParagraph | DocTable)[] = [
    ...banner,
    gap(200),
    details,
    gap(240),
    opening,
    gap(120),
    sectionBar('01', 'Scope of works'),
    gap(120),
    ...(q.scope?.trim() ? q.scope.split(/\r?\n\r?\n/).map((t) => para(rich(t.trim()))) : []),
    ...groups(q.scope_groups ?? [], 'numbered'),
    gap(240),
    sectionBar('02', 'Pricing schedule'),
    gap(160),
    pricing,
    para([run('All prices exclude VAT, which will be charged at the prevailing rate.', { italics: true, color: GREY, size: 18 })], { spacing: { before: 80, after: 120 } }),
    gap(120),
    sectionBar('03', 'Qualifications & exclusions'),
    gap(80),
    ...groups(q.qualification_groups ?? [], 'bullets'),
    ...(d.clauses.length ? [subHeading('Additional conditions'), ...d.clauses.flatMap((c) => [para([run(c.title, { bold: true, color: NAVY })], { spacing: { after: 40 } }), ...c.body.split(/\r?\n/).filter((t) => t.trim()).map((t) => para(rich(t)))])] : []),
    gap(240, true),
    sectionBar('04', 'Validity & acceptance', true),
    gap(160, true),
    para(
      [
        run('This quotation is valid until '),
        run(longDate(q.valid_until), { bold: true, color: NAVY }),
        run(`. ${q.validity_note?.trim() ? q.validity_note.trim().replace(/\.?$/, '. ') : ''}After it, prices may need to be reconfirmed.`),
      ],
      { keepNext: true },
    ),
    para(rich(d.acceptanceWording), { keepNext: true }),
    gap(200, true),
    signOff,
  ]
  if (q.appendices?.trim()) body.push(new Paragraph({ children: [], pageBreakBefore: true }), ...freeText(q.appendices, true))
  if (q.include_terms && d.terms.trim()) body.push(new Paragraph({ children: [], pageBreakBefore: true }), sectionBar('', 'Terms and conditions'), gap(120), ...freeText(d.terms))

  const footer = () => new Footer({
    children: [
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 6 } },
        tabStops: [{ type: TabStopType.RIGHT, position: Math.round(170 * MM) }],
        children: [
          run('du Boulay Projects Limited', { color: GREY, size: 16 }),
          run(`   |   Quotation – ${project}`, { color: GREY, size: 16 }),
          new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: GREY }),
        ],
      }),
    ],
  })

  const doc = new Document({
    creator: 'du Boulay Projects',
    title: fullRef(d.owner, q),
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    numbering: {
      config: [
        { reference: 'numbered', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { run: { bold: true, color: BLUE, font: FONT }, paragraph: { indent: { left: 400, hanging: 400 } } } }] },
        { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '▪', alignment: AlignmentType.LEFT, style: { run: { color: BLUE, font: FONT }, paragraph: { indent: { left: 400, hanging: 400 } } } }] },
      ],
    },
    sections: [
      {
        properties: {
          titlePage: true,
          page: { size: { width: Math.round(210 * MM), height: Math.round(297 * MM) }, margin: { top: Math.round(18 * MM), bottom: Math.round(20 * MM), left: Math.round(20 * MM), right: Math.round(20 * MM), header: Math.round(10 * MM), footer: Math.round(10 * MM) } },
        },
        headers: {
          // logo top left on page 1 only, 60 × 15 mm (letterhead artwork)
          first: new Header({ children: [new Paragraph({ children: [new ImageRun({ type: 'png', data: logo, transformation: { width: 227, height: 57 } })], spacing: { after: 200 } })] }),
          default: new Header({ children: [new Paragraph({ children: [] })] }),
        },
        footers: { first: footer(), default: footer() },
        children: body,
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `dbp Quotation - ${fullRef(d.owner, q).replace(/[\\/:*?"<>|]/g, '')}.docx`
  a.click()
  URL.revokeObjectURL(a.href)
}
