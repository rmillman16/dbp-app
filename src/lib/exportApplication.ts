// Excel export of a client application, laid out as
// reference/templates/2611 FISL - Micro - Application 2 R2 - 30.10.2026.xlsx:
//   1. Anticipated Final Account (front sheet), with Client Assessment, previous
//      application and movement columns filled from the app (not copied by hand)
//   2. the priced SoW (tab named after its revision, e.g. "R5") with dbp Application %/£,
//      dbp comments and Client Assessment %/£
//   3. VO Summary with % Claimed, £ Claimed and comments
// Internal copy: totals are live formulas. "Client", never the certifier's name.
import type { Cell, Worksheet } from 'exceljs'
import type { Application, ApplicationLine, Job, SowLine } from './types'
import type { VoWithLines } from './variations'
import type { FrontSheet } from './applications'
import { appName } from './applications'
import { download, excelDate, fill, newWorkbook, placeLogo, ref, safeName, setupPage } from './excel'
import { STATUS_FILL } from './exportVariations'

const ACC = '#,##0.00 ;[Red](#,##0.00)' // front sheet, as the template
const SOW_NUM = '_(* #,##0.00_);[Red]_(* (#,##0.00);[Red]_(* "-"??_);_(@_)'
const PCT = '0%'
const DATE = 'dd/mm/yyyy'
const thin = { style: 'thin' as const }
const double = { style: 'double' as const }

export interface AppDoc {
  job: Job
  app: Application
  sow: SowLine[]
  sowRev: string
  lines: ApplicationLine[]
  vos: VoWithLines[]
  fs: FrontSheet
  fsClient: FrontSheet | null
  fsPrev: FrontSheet | null
  prevName: string | null
}

export async function exportApplication(d: AppDoc) {
  const { wb, logoId } = await newWorkbook()
  const sowName = (d.sowRev || 'SoW').slice(0, 31)
  const afa = wb.addWorksheet('Anticipated Final Account', { views: [{ showGridLines: false }] })
  const sowWs = wb.addWorksheet(sowName, { views: [{ state: 'frozen', ySplit: 5 }] })
  const voWs = wb.addWorksheet('VO Summary', { views: [{ state: 'frozen', ySplit: 11, showGridLines: false }] })

  const sowTotals = buildSow(sowWs, d)
  const voTotals = buildVoSummary(voWs, d)
  buildFrontSheet(afa, d, `'${sowName}'!J${sowTotals.mainRow}`, voTotals)

  for (const [ws, widths, last, orient, titles, onePage] of [
    [afa, AFA_WIDTHS, 52, 'landscape', undefined, true],
    [sowWs, SOW_WIDTHS, sowTotals.lastRow, 'landscape', '5:5', false],
    [voWs, VO_WIDTHS, voTotals.lastRow, 'landscape', '11:11', false],
  ] as const) {
    placeLogo(ws, logoId, [...widths], setupPage(ws, [...widths], last, orient, titles, onePage))
  }

  await download(wb, safeName(`${d.job.job_no} ${d.job.code} - ${d.job.name} - ${appName(d.app)}${d.app.valuation_date ? ` - ${d.app.valuation_date.split('-').reverse().join('.')}` : ''}`) + '.xlsx')
}

// ---------- 1. Anticipated Final Account ----------
const AFA_WIDTHS = [5.45, 20.45, 25.45, 20.45, 5.45, 20.45, 5.45, 22.82, 5.45, 9.09, 20.45, 5.45, 20.45]

function buildFrontSheet(ws: Worksheet, d: AppDoc, constructionRef: string, vo: { projectedRef: string; claimedRef: string }) {
  const { job, app, fs, fsClient: cl, fsPrev: pv } = d
  const font = { name: 'Calibri', size: 12 }
  const set = (addr: string, v: Cell['value'], o: Partial<Cell> = {}) => {
    const c = ws.getCell(addr)
    c.value = v
    c.font = { ...font, ...(o.font ?? {}) }
    if (o.numFmt) c.numFmt = o.numFmt
    if (o.alignment) c.alignment = o.alignment
    return c
  }
  const bold = { ...font, bold: true }

  set('B4', 'Contract No.', { font: bold })
  set('C4', `${job.job_no} ${job.code}`)
  set('B5', 'Contract Name.', { font: bold })
  set('C5', job.name)
  set('B6', 'Contract Sum', { font: bold })
  set('C6', fs.contractSum, { numFmt: ACC })
  set('D6', d.sowRev)
  set('B8', 'Payment Notice', { font: bold })
  set('C8', app.app_no, { alignment: { horizontal: 'left' } })
  set('D8', `R${app.revision}`)
  set('B9', 'Date', { font: bold })
  set('C9', excelDate(app.valuation_date), { numFmt: 'dddd d mmmm yyyy', font: bold, alignment: { horizontal: 'left' } })

  set('F12', 'Final Account', { font: bold, alignment: { horizontal: 'right' } })
  if (cl) set('H12', 'Client Assessment', { font: bold, alignment: { horizontal: 'right' } })
  // on the "Final Account" heading row, clear of the logo
  if (pv) {
    set('K11', 'Previous Application', { font: bold, alignment: { horizontal: 'center' } })
    set('K12', d.prevName ?? '', { alignment: { horizontal: 'center' } })
    ws.mergeCells('M11:M12')
    set('M11', 'Movement\nin the Month', { font: bold, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } })
    ws.getRow(11).height = 18
  }

  // [row, label, formula for F, value for F, front-sheet key, bold total, percentage in E]
  type Row = [number, string, string | null, number, keyof FrontSheet, boolean, number | null]
  const rows: Row[] = [
    [14, 'Contract Sum', 'C6', fs.contractSum, 'contractSum', false, null],
    [16, 'Psum Adjustment', null, fs.psum, 'psum', false, null],
    [18, 'Variations', vo.projectedRef, fs.variations, 'variations', false, null],
    [22, 'Anticipated Final Account', 'SUM(F14:F21)', fs.afa, 'afa', true, null],
    [27, 'Construction', constructionRef, fs.construction, 'construction', false, null],
    [28, 'Variations', vo.claimedRef, fs.voClaimed, 'voClaimed', false, null],
    [29, 'Materials on Site', null, fs.mos, 'mos', false, null],
    [30, 'Loss and Expense', null, fs.lossAndExpense, 'lossAndExpense', false, null],
    [31, 'Total Application', 'SUM(F26:F30)', fs.totalApplication, 'totalApplication', true, null],
    [34, 'Less Retention', '-(SUM(F27:F30))*E34', fs.retention, 'retention', false, fs.retentionPct / 100],
    [37, '', 'SUM(F31:F35)', fs.afterRetention, 'afterRetention', false, null],
    [39, 'Less Deposits', null, fs.deposits, 'deposits', false, null],
    [41, 'Total Claimed', 'SUM(F36:F40)', fs.totalClaimed, 'totalClaimed', true, null],
    [43, 'Less Previous Paid', null, fs.lessPrevious, 'lessPrevious', false, null],
    [45, 'Amount Outstanding', 'SUM(F41:F44)', fs.outstanding, 'outstanding', true, null],
    [47, 'VAT', 'F45*E47', fs.vat, 'vat', false, fs.vatPct / 100],
    [49, 'TOTAL OUTSTANDING', 'SUM(F45:F48)', fs.totalOutstanding, 'totalOutstanding', true, null],
  ]
  set('D33', 'Practical Completion', { font: bold })
  set('E33', app.practical_completion ? 'Yes' : 'No')

  for (const [r, label, formula, value, key, isTotal, pct] of rows) {
    if (label) set(`D${r}`, label, { font: isTotal ? bold : font })
    if (pct != null) set(`E${r}`, pct, { numFmt: Number.isInteger(pct * 100) ? '0%' : '0.0%' })
    const f = set(`F${r}`, formula ? { formula, result: value } : value, { numFmt: ACC, font: isTotal ? bold : key === 'lessPrevious' ? { ...font, color: { argb: 'FFFF0000' } } : font })
    if (isTotal) f.border = { top: thin, bottom: double }
    const applicationRow = r >= 27
    if (cl && applicationRow) {
      const h = set(`H${r}`, cl[key], { numFmt: ACC, font: isTotal ? bold : font })
      if (isTotal) h.border = { top: thin, bottom: double }
    }
    if (pv) {
      const k = set(`K${r}`, pv[key], { numFmt: ACC, font: isTotal ? bold : font })
      k.border = { left: thin, right: thin, ...(isTotal ? { top: thin, bottom: double } : {}) }
      if (applicationRow) {
        const m = set(`M${r}`, { formula: `F${r}-K${r}`, result: (fs[key] as number) - (pv[key] as number) }, { numFmt: ACC, font: isTotal ? bold : font })
        m.border = { left: thin, right: thin, ...(isTotal ? { top: thin, bottom: double } : {}) }
      }
    }
  }

  ws.mergeCells('D52:G52')
  set('B52', 'Payment due within 14 days', { font: { ...bold, size: 14 } })
  ws.getRow(52).height = 30
  // the layout's empty spacer rows are kept, but shorter, so the sheet fits one page
  for (let r = 1; r < 52; r++) {
    let empty = true
    ws.getRow(r).eachCell(() => (empty = false))
    ws.getRow(r).height = empty ? (r < 4 ? 14 : 8) : 16.5
  }
}

// ---------- 2. priced SoW ----------
const SOW_WIDTHS = [6.45, 58.36, 1.36, 11.36, 11.36, 13.09, 13, 15.82, 16.45, 16.45, 24.82, 3.36, 15.82, 16.82]

function buildSow(ws: Worksheet, d: AppDoc) {
  const n = d.app.app_no
  const byLine = new Map(d.lines.filter((l) => l.sow_line_id).map((l) => [l.sow_line_id!, l]))
  const site = (d.job.site_address ?? '').split(/[,\n]/).slice(0, 2).join(',').trim()
  ws.getCell('B1').value = `${d.job.name}${site ? `, ${site}` : ''}`
  ws.getCell('B1').font = { bold: true, size: 14 }
  ws.getCell('B4').value = 'ESTIMATE'
  ws.getCell('B4').font = { bold: true, size: 14 }
  ws.getCell('E4').value = 'Rev'
  ws.getCell('F4').value = d.sowRev
  ws.getCell('F4').font = { bold: true }

  const heads = ['#', 'Description', '', 'Quantity', 'Unit', 'Rate', 'Total', 'Section Total', `dbp Application ${n} %`, `dbp Application ${n} £`, 'dbp comments', '', `Client Assessment ${n} %`, `Client Assessment ${n} £`]
  heads.forEach((h, i) => {
    const c = ws.getCell(5, i + 1)
    c.value = h
    if (!h) return
    c.font = { bold: true }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    c.border = { bottom: thin, left: thin, right: thin }
  })
  ws.getRow(5).height = 33.5

  const grid = (r: number, cols: number[]) => cols.forEach((c) => (ws.getCell(r, c).border = { top: thin, bottom: thin, left: thin, right: thin }))
  let r = 7
  let sectionRow = 0
  let sectionStart = 0
  let mainEnd = 0
  const closeSection = (end: number) => {
    if (!sectionRow) return
    const c = ws.getCell(sectionRow, 8)
    c.value = { formula: `SUM(G${sectionStart}:G${end})` } // Excel works it out on opening
    c.numFmt = SOW_NUM
  }
  const mainTotalRow = () => {
    // "Total (excl. VAT)" closes the main schedule
    closeSection(r - 1)
    sectionRow = 0
    mainEnd = r - 1
    ws.getCell(r, 2).value = 'Total (excl. VAT)'
    ws.getCell(r, 2).font = { bold: true }
    for (const [col, letter] of [
      [8, 'G'],
      [10, 'J'],
      [14, 'N'],
    ] as const) {
      const c = ws.getCell(r, col)
      c.value = { formula: `SUM(${letter}7:${letter}${mainEnd})` }
      c.numFmt = SOW_NUM
      c.font = { bold: true }
    }
    grid(r, [1, 2, 4, 5, 6, 7, 8, 9, 10])
    r += 2
    return r - 2
  }

  let mainRow = 0
  for (const l of d.sow) {
    if (l.below_line && !mainRow) mainRow = mainTotalRow()
    if (l.kind === 'section') {
      closeSection(r - 1)
      if (sectionRow) r++
      sectionRow = r
      ws.getCell(r, 1).value = Number(l.item_ref) || l.item_ref
      ws.getCell(r, 2).value = l.description
      ws.getCell(r, 1).font = ws.getCell(r, 2).font = { bold: true }
      grid(r, [1, 2, 4, 5, 6, 7, 8])
      r += 2 // blank row under the heading, as the template
      sectionStart = r
      continue
    }
    const a = byLine.get(l.id)
    ws.getCell(r, 1).value = l.item_ref && /^\d+(\.\d+)?$/.test(l.item_ref) ? Number(l.item_ref) : l.item_ref
    ws.getCell(r, 1).numFmt = '0.00'
    ws.getCell(r, 2).value = l.description
    ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' }
    ws.getCell(r, 4).value = l.qty
    ws.getCell(r, 5).value = l.unit
    ws.getCell(r, 6).value = l.rate
    ws.getCell(r, 7).value = l.total ?? l.total_text
    for (const c of [6, 7]) ws.getCell(r, c).numFmt = SOW_NUM
    for (const c of [4, 5, 6]) ws.getCell(r, c).alignment = { horizontal: 'center', vertical: 'top' }
    if (l.total != null && !l.below_line) {
      if (a?.pct_claimed != null) {
        ws.getCell(r, 9).value = a.pct_claimed
        ws.getCell(r, 10).value = { formula: `I${r}*G${r}`, result: a.amount_claimed ?? 0 }
      }
      if (a?.client_pct != null) {
        ws.getCell(r, 13).value = a.client_pct
        ws.getCell(r, 14).value = { formula: `M${r}*G${r}`, result: a.client_amount ?? 0 }
      }
    }
    ws.getCell(r, 9).numFmt = ws.getCell(r, 13).numFmt = PCT
    ws.getCell(r, 10).numFmt = ws.getCell(r, 14).numFmt = SOW_NUM
    ws.getCell(r, 11).value = a?.comment ?? null
    ws.getCell(r, 11).alignment = { wrapText: true, vertical: 'top' }
    for (const c of [1, 7, 9, 10, 13, 14]) ws.getCell(r, c).alignment = { vertical: 'top' }
    grid(r, [1, 2, 4, 5, 6, 7, 8])
    r++
  }
  if (!mainRow) mainRow = mainTotalRow()
  else {
    closeSection(r - 1)
    r++
    ws.getCell(r, 2).value = 'Total Below the Line Items (excl. VAT)'
    ws.getCell(r, 2).font = { bold: true }
    ws.getCell(r, 8).value = { formula: `SUM(G${mainRow + 2}:G${r - 1})` }
    ws.getCell(r, 8).numFmt = SOW_NUM
    grid(r, [1, 2, 4, 5, 6, 7, 8])
  }
  return { mainRow, lastRow: r }
}

// ---------- 3. VO Summary ----------
const VO_WIDTHS = [6.82, 1.36, 9.63, 52.82, 11.09, 11, 13.45, 12.09, 13.82, 41.63, 11.45, 12.36, 35.36]

function buildVoSummary(ws: Worksheet, d: AppDoc) {
  const byVo = new Map(d.lines.filter((l) => l.variation_id).map((l) => [l.variation_id!, l]))
  ws.getCell('C2').value = 'dbp - Variation Summary And Build Up'
  ws.getCell('C2').font = { bold: true, size: 14 }
  ws.getCell('C4').value = 'Site:'
  ws.getCell('D4').value = `${d.job.job_no} ${d.job.code} ${d.job.name}`
  ws.getCell('C6').value = 'Date:'
  ws.getCell('D6').value = excelDate(d.app.valuation_date)
  ws.getCell('D6').numFmt = DATE
  ws.getCell('D6').alignment = { horizontal: 'left' }

  const heads = ['VO No.', 'Name', 'Date', 'Budget', 'Firm', 'Instructed', 'CAI number', 'Notes', '% Claimed', '£ Claimed', 'Comments']
  heads.forEach((h, i) => {
    const c = ws.getCell(11, i + 3)
    c.value = h
    c.font = { bold: true }
    c.border = { top: thin, bottom: thin, left: thin, right: thin }
  })

  const counted: string[] = []
  let r = 12
  for (const { vo, build } of d.vos) {
    const a = byVo.get(vo.id)
    const row = ws.getRow(r)
    row.getCell(3).value = `VO ${vo.vo_no}`
    row.getCell(3).alignment = { horizontal: 'center' }
    const colour = STATUS_FILL[vo.status]
    if (colour) fill(row.getCell(3), colour)
    row.getCell(4).value = vo.title
    row.getCell(5).value = excelDate(vo.vo_date)
    row.getCell(5).numFmt = DATE
    // budget disappears once a firm price is in
    row.getCell(6).value = build.priced || vo.budget_value == null ? null : Number(vo.budget_value)
    row.getCell(7).value = build.priced ? Math.round(build.total * 100) / 100 : null
    row.getCell(8).value = excelDate(vo.date_agreed)
    row.getCell(8).numFmt = DATE
    if (vo.date_agreed) fill(row.getCell(8), STATUS_FILL.agreed!)
    row.getCell(9).value = ref(vo.instruction_ref)
    row.getCell(10).value = vo.notes ?? ''
    if (a?.pct_claimed != null && build.priced) {
      row.getCell(11).value = a.pct_claimed
      row.getCell(12).value = { formula: `K${r}*G${r}`, result: a.amount_claimed ?? 0 }
    }
    row.getCell(13).value = a?.comment ?? ''
    for (const c of [6, 7, 12]) row.getCell(c).numFmt = '#,##0.00'
    row.getCell(11).numFmt = PCT
    for (let c = 3; c <= 13; c++) row.getCell(c).border = { top: thin, bottom: thin, left: thin, right: thin }
    if (vo.status !== 'rejected') {
      if (build.priced) counted.push(`G${r}`)
      else if (vo.budget_value != null) counted.push(`F${r}`)
    }
    r++
  }
  const last = r - 1
  ws.getCell(r, 11).value = 'Total Claimed'
  ws.getCell(r, 11).font = { bold: true }
  ws.getCell(r, 12).value = { formula: d.vos.length ? `SUM(L12:L${last})` : '0', result: d.fs.voClaimed }
  ws.getCell(r, 12).numFmt = '#,##0.00'
  ws.getCell(r, 12).font = { bold: true }

  // firm where priced, budget until then; rejected VOs left out (as the Variations export)
  ws.getCell('C9').value = 'Total To Date Projected Increase'
  ws.getCell('C9').font = { bold: true }
  ws.getCell('G9').value = { formula: counted.length ? counted.join('+') : '0', result: d.fs.variations }
  ws.getCell('G9').numFmt = '#,##0.00'
  ws.getCell('G9').font = { bold: true }
  ws.getCell('G10').value = '↑'
  ws.getCell('G10').alignment = { horizontal: 'center' }

  return { projectedRef: "'VO Summary'!G9", claimedRef: `'VO Summary'!L${r}`, lastRow: r }
}
