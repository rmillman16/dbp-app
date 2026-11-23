// Excel export of the Variation Summary and VO sheets, laid out as
// reference/templates/dbp VARIATION SUMMARY AND BUILD UP - TEMPLATE.xlsm.
// Internal copy: totals are live formulas.
import type { Cell, Workbook } from 'exceljs'
import type { Job } from './types'
import type { VoWithLines } from './variations'
import { lineTotal } from './variations'
import { todayIso, ukDate } from './format'
import { addBorder, box, download, excelDate, fill, newWorkbook, placeLogo, ref, safeName, setupPage } from './excel'

const GBP = '_-"£"* #,##0.00_-;-"£"* #,##0.00_-;_-"£"* "-"??_-;_-@_-'
const GBP_PLAIN = '"£"#,##0.00'
const DATE = 'dd/mm/yyyy'
const NUM = '#,##0.00'

// colour key, as on the template's Summary sheet
export const STATUS_FILL: Record<string, string | null> = {
  not_issued: null,
  issued: 'FFFFC000',
  agreed: 'FF92D050',
  rejected: 'FFFF0000',
}
const EDITABLE_FILL = 'FF767171' // template: theme background 2, 50% darker
const TOTAL_FILL = 'FFB4C6E7' // template: theme accent 1, 60% lighter

const dbl = { style: 'double' as const }
const thin = { style: 'thin' as const }

const vosSheetName = (n: number) => `VO ${n}`

// ---------- VO sheet ----------
const VO_WIDTHS = [11, 61.73, 11, 11, 16.27, 13.6]

// returns the row holding the VARIATION TOTAL (the firm price)
function addVoSheet(wb: Workbook, logoId: number, job: Job, { vo, lines, build }: VoWithLines, backLink: boolean): number {
  const ws = wb.addWorksheet(vosSheetName(vo.vo_no), { views: [{ state: 'frozen', ySplit: 10, showGridLines: true }] })
  const bold = { bold: true }

  if (backLink) {
    const a1 = ws.getCell('A1')
    a1.value = { formula: 'HYPERLINK("#Summary!A1","Back To Summary")', result: 'Back To Summary' }
    a1.font = { color: { argb: 'FF0563C1' }, underline: true }
  }
  ws.getCell('A2').value = `${job.job_no} ${job.code} ${job.name}`
  ws.getCell('A2').font = bold
  ws.getCell('A4').value = `VARIATION No: ${vo.vo_no}`
  ws.getCell('A4').font = bold

  // header block
  ws.mergeCells('B6:D6')
  ws.mergeCells('B7:D7')
  ws.mergeCells('A8:D8')
  ws.mergeCells('A9:D9')
  ws.mergeCells('E9:F9')
  const set = (addr: string, value: Cell['value'], extra: Partial<Cell> = {}) => {
    const c = ws.getCell(addr)
    c.value = value
    Object.assign(c, extra)
    return c
  }
  set('A6', 'VO No.', { font: bold })
  set('B6', 'Variation Name:', { font: bold })
  set('E6', 'Date:', { font: bold, alignment: { horizontal: 'right' } })
  set('F6', excelDate(vo.vo_date), { numFmt: DATE })
  set('A7', `VO ${vo.vo_no}`, { font: bold, alignment: { horizontal: 'center' } })
  set('B7', vo.title, { alignment: { wrapText: true, vertical: 'top' } })
  set('E7', 'CAI Number:', { font: bold, alignment: { horizontal: 'right' } })
  set('F7', ref(vo.instruction_ref), { alignment: { horizontal: 'left' } })
  set('A8', 'Variation Description:', { font: bold })
  set('E8', 'Budget:', { font: bold, alignment: { horizontal: 'right' } })
  // budget disappears from the VO sheet once a firm price is in
  set('F8', build.priced ? null : vo.budget_value != null ? Number(vo.budget_value) : null, { numFmt: GBP_PLAIN })
  set('A9', vo.description ?? '', { alignment: { wrapText: true, vertical: 'top' } })
  ws.getRow(9).height = Math.max(30, Math.ceil((vo.description?.length ?? 0) / 100) * 15)
  for (let r = 6; r <= 9; r++) for (let c = 1; c <= 6; c++) box(ws.getCell(r, c))

  // column headings
  ;['Item', 'Description', 'Quantity', 'Unit', 'Rate £', 'Total £'].forEach((t, i) => {
    const c = ws.getCell(10, i + 1)
    c.value = t
    c.font = bold
    c.alignment = { horizontal: 'center' }
    box(c)
  })

  let r = 11
  const bodyStart = r
  let item = 1
  const label = (row: number, text: string, opts: { bold?: boolean; red?: boolean; right?: boolean } = {}) => {
    const c = ws.getCell(row, 2)
    c.value = text
    c.font = { bold: opts.bold, color: opts.red ? { argb: 'FFFF0000' } : undefined }
    if (opts.right) c.alignment = { horizontal: 'right' }
  }
  const money = (row: number, formula: string, result: number, boldTotal = false) => {
    const c = ws.getCell(row, 6)
    c.value = { formula, result }
    c.numFmt = boldTotal ? GBP_PLAIN : GBP
    if (boldTotal) c.font = bold
  }
  const totalRow = (row: number, text: string, formula: string, result: number) => {
    label(row, text, { bold: true, right: true })
    money(row, formula, result, true)
    box(ws.getCell(row, 2))
    box(ws.getCell(row, 6))
  }

  const writeSection = (section: 'omit' | 'add') => {
    const own = lines.filter((l) => l.section === section)
    const omit = section === 'omit'
    r++
    label(r, omit ? 'OMIT' : 'ADD', { bold: true, red: omit })
    r++
    const first = r
    for (const l of own) {
      const sign = omit ? -1 : 1
      ws.getCell(r, 1).value = item++
      ws.getCell(r, 1).alignment = { horizontal: 'center' }
      ws.getCell(r, 2).value = l.description
      ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' }
      ws.getCell(r, 3).value = l.qty ?? 1
      ws.getCell(r, 3).alignment = { horizontal: 'center' }
      ws.getCell(r, 4).value = l.unit ?? ''
      ws.getCell(r, 4).alignment = { horizontal: 'center' }
      ws.getCell(r, 5).value = l.rate ?? 0
      ws.getCell(r, 5).numFmt = GBP
      money(r, `${omit ? '-' : ''}C${r}*E${r}`, sign * lineTotal(l))
      if (omit) for (let c = 1; c <= 6; c++) ws.getCell(r, c).font = { color: { argb: 'FFFF0000' } }
      r++
    }
    if (!own.length) r++ // keep an empty line under the heading
    const subtotal = omit ? build.omitSubtotal : build.addSubtotal
    label(r, omit ? 'Omit sub-total' : 'Add sub-total', { red: omit })
    money(r, own.length ? `SUM(F${first}:F${r - 1})` : '0', subtotal)
    addBorder(ws.getCell(r, 6), { top: thin })
    const at = r
    r++
    return at
  }

  const omitAt = lines.some((l) => l.section === 'omit') ? writeSection('omit') : null
  const addAt = writeSection('add')
  r++
  const subAt = r
  label(r, 'Sub Total', { bold: true })
  money(r, omitAt ? `F${omitAt}+F${addAt}` : `F${addAt}`, build.subtotal)
  r += 2
  const ohpAt = r
  label(r, `OHP @ ${build.ohpPct}%`)
  ws.getCell(r, 3).value = build.ohpPct
  ws.getCell(r, 4).value = '%'
  money(r, `F${subAt}*C${r}/100`, build.ohp)
  r += 2
  const markedAt = r
  totalRow(r, 'MARKED UP SUB- TOTAL', `F${subAt}+F${ohpAt}`, build.markedUp)
  r += 2
  const prelimsAt = r
  label(r, 'Prelims')
  ws.getCell(r, 3).value = build.prelimsPct
  ws.getCell(r, 3).numFmt = '0.00'
  ws.getCell(r, 4).value = '%'
  money(r, `F${markedAt}*C${r}/100`, build.prelims)
  r += 2
  const varSubAt = r
  totalRow(r, 'VARIATION SUB- TOTAL', `F${markedAt}+F${prelimsAt}`, build.total)
  r += 2
  label(r, 'Programme Implications')
  ws.getCell(r, 3).value = Number(vo.programme_days ?? 0)
  ws.getCell(r, 4).value = 'days'
  r += 2
  const totalAt = r
  totalRow(r, 'VARIATION TOTAL', `F${varSubAt}`, build.total)
  r += 2
  label(r, 'Notes')
  if (vo.notes) {
    r++
    ws.getCell(r, 2).value = vo.notes
    ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' }
  }
  const bodyEnd = r + 1

  // centre-align the % / days figures and draw the double side rules down the sheet
  for (let row = bodyStart; row <= bodyEnd; row++) {
    for (const c of [3, 4]) if (ws.getCell(row, c).value != null && !ws.getCell(row, c).alignment) ws.getCell(row, c).alignment = { horizontal: 'center' }
    for (let c = 1; c <= 6; c++) addBorder(ws.getCell(row, c), { left: dbl, right: dbl })
  }
  for (let c = 1; c <= 6; c++) addBorder(ws.getCell(bodyEnd, c), { bottom: dbl })

  const scale = setupPage(ws, VO_WIDTHS, bodyEnd)
  placeLogo(ws, logoId, VO_WIDTHS, scale)
  return totalAt
}

// ---------- Summary sheet ----------
const SUMMARY_WIDTHS = [6.86, 1.4, 9.6, 52.73, 10.73, 9.6, 11, 12.27, 13.73, 41.6]

function addSummarySheet(wb: Workbook, logoId: number, job: Job, vos: VoWithLines[], totalRows: Map<string, number>) {
  const ws = wb.getWorksheet('Summary')!
  const bold = { bold: true }

  ws.getCell('D1').value = `${job.job_no} ${job.code} ${job.name}`
  ws.getCell('D1').font = { bold: true, size: 12 }
  ws.getCell('D3').value = 'VARIATION SUMMARY'
  ws.getCell('D3').font = bold
  ws.getCell('D5').value = `Dated: ${ukDate(todayIso())}`
  ws.getCell('D5').font = bold

  // colour key: in F–G rather than the template's H–I, which sit under the logo
  ws.getCell('F1').value = 'Colour Key'
  ws.getCell('F1').font = bold
  ws.getCell('F2').value = 'No colour'
  box(ws.getCell('F2'), thin)
  const key: [string | null, string][] = [
    [null, 'Not issued'],
    [STATUS_FILL.issued, 'Issued'],
    [STATUS_FILL.agreed, 'Agreed'],
    [STATUS_FILL.rejected, 'Rejected'],
    [EDITABLE_FILL, 'Editable fields'],
  ]
  key.forEach(([colour, text], i) => {
    ws.getCell(`G${i + 2}`).value = text
    if (colour) fill(ws.getCell(`F${i + 2}`), colour)
  })

  // headings
  const heads = ['VO No.', 'Name', 'Date', 'Budget', 'Firm', 'Instructed', 'CAI number', 'Notes']
  heads.forEach((t, i) => {
    const c = ws.getCell(9, i + 3)
    c.value = t
    c.font = bold
    c.border = { top: thin, bottom: thin, left: thin, right: thin }
  })
  fill(ws.getCell('H9'), EDITABLE_FILL)
  fill(ws.getCell('J9'), EDITABLE_FILL)

  // one row per VO
  const counted: string[] = [] // cells that add up to the projected increase
  vos.forEach(({ vo, build }, i) => {
    const r = 10 + i
    const name = vosSheetName(vo.vo_no)
    const link = ws.getCell(r, 1)
    link.value = { formula: `HYPERLINK("#'${name}'!A1","Link")`, result: 'Link' }
    link.font = { color: { argb: 'FF0563C1' }, underline: true }

    const row = ws.getRow(r)
    row.getCell(3).value = name
    row.getCell(3).alignment = { horizontal: 'center' }
    row.getCell(4).value = vo.title
    row.getCell(4).alignment = { wrapText: true, vertical: 'top' }
    row.getCell(5).value = excelDate(vo.vo_date)
    row.getCell(5).numFmt = DATE
    // budget disappears once a firm price is in
    row.getCell(6).value = build.priced || vo.budget_value == null ? null : Number(vo.budget_value)
    row.getCell(6).numFmt = NUM
    if (build.priced) row.getCell(7).value = { formula: `'${name}'!F${totalRows.get(vo.id)}`, result: build.total }
    row.getCell(7).numFmt = NUM
    row.getCell(8).value = excelDate(vo.date_agreed)
    row.getCell(8).numFmt = DATE
    if (vo.date_agreed) fill(row.getCell(8), STATUS_FILL.agreed!)
    row.getCell(9).value = ref(vo.instruction_ref)
    row.getCell(9).alignment = { horizontal: 'center' }
    row.getCell(10).value = vo.notes ?? ''
    row.getCell(10).alignment = { wrapText: true, vertical: 'top' }
    for (let c = 1; c <= 10; c++) row.getCell(c).alignment = { ...row.getCell(c).alignment, vertical: 'top' }
    for (let c = 3; c <= 10; c++) row.getCell(c).border = { top: thin, bottom: thin, left: thin, right: thin }
    const colour = STATUS_FILL[vo.status]
    if (colour) fill(row.getCell(3), colour)

    if (vo.status !== 'rejected') {
      if (build.priced) counted.push(`G${r}`)
      else if (vo.budget_value != null) counted.push(`F${r}`)
    }
  })

  // firm price where priced, budget until then; rejected VOs left out
  const projected = vos.reduce((s, { vo, build }) => {
    if (vo.status === 'rejected') return s
    return s + (build.priced ? build.total : Number(vo.budget_value ?? 0))
  }, 0)
  ws.getCell('D7').value = 'Total To Date Projected Increase'
  ws.getCell('D7').font = bold
  ws.getCell('G7').value = { formula: counted.length ? counted.join('+') : '0', result: projected }
  ws.getCell('G7').numFmt = NUM
  ws.getCell('G7').font = bold
  for (const a of ['D7', 'E7', 'F7', 'G7']) {
    fill(ws.getCell(a), TOTAL_FILL)
    box(ws.getCell(a), thin)
  }
  ws.getCell('G8').value = '↑'
  ws.getCell('G8').alignment = { horizontal: 'center' }

  const lastRow = Math.max(10, 9 + vos.length)
  const scale = setupPage(ws, SUMMARY_WIDTHS, lastRow)
  placeLogo(ws, logoId, SUMMARY_WIDTHS, scale)
}

// ---------- public ----------
export async function exportVariationWorkbook(job: Job, vos: VoWithLines[]) {
  const { wb, logoId } = await newWorkbook()
  wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 9, showGridLines: false }] })
  const totalRows = new Map<string, number>()
  for (const v of vos) totalRows.set(v.vo.id, addVoSheet(wb, logoId, job, v, true))
  addSummarySheet(wb, logoId, job, vos, totalRows)
  await download(wb, `${job.job_no} ${job.code} - VARIATION SUMMARY AND BUILD UP.xlsx`)
}

export async function exportSingleVo(job: Job, v: VoWithLines) {
  const { wb, logoId } = await newWorkbook()
  addVoSheet(wb, logoId, job, v, false)
  await download(wb, safeName(`${job.job_no} ${job.code} - VO ${v.vo.vo_no} - ${v.vo.title}`) + '.xlsx')
}
