// Excel export of a subcontract payment notice, laid out as
// reference/templates/2609 Kong Logik Payment Notice 2 (payment notice layout).xlsx:
//   Payment Notice (front page, previous application and movement) · Summary · SOW ·
//   Variations · App N (the subcontractor's application line by line).
// SOW and Variations line 1 = "As per App N"; DuB adjustments are extra lines (agreed 19 Nov).
// Fixes the template's copy errors: headings come from this job and subcontractor.
import type { Cell, Worksheet } from 'exceljs'
import type { Adjustment, Company, Job, Order, PaymentNotice, SubAppLine, SubApplication } from './types'
import type { NoticeTotals } from './subcontracts'
import { lineAmount } from './subcontracts'
import { download, excelDate, newWorkbook, placeLogo, safeName, setupPage } from './excel'

const ACC = '_(* #,##0.00_);[Red]_(* (#,##0.00);[Red]_(* "-"??_);_(@_)'
const NUM = '#,##0.00'
const PCT = '0%'
const DATE = 'dd/mm/yyyy'
const thin = { style: 'thin' as const }
const medium = { style: 'medium' as const }
const double = { style: 'double' as const }

export interface NoticeDoc {
  job: Job
  order: Order
  company: Company
  pn: PaymentNotice
  app: SubApplication
  lines: SubAppLine[]
  adjustments: Adjustment[]
  totals: NoticeTotals
  previousPaidOnPrevious: number // the previous notice's own "previously paid" (its M34)
}

export async function exportPaymentNotice(d: NoticeDoc) {
  const { wb, logoId } = await newWorkbook()
  const n = d.app.app_no
  const appSheet = `App ${n}`
  const front = wb.addWorksheet('Payment Notice', { views: [{ showGridLines: false }] })
  const summary = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] })
  const sow = wb.addWorksheet('SOW', { views: [{ showGridLines: false }] })
  const vars = wb.addWorksheet('Variations', { views: [{ showGridLines: false }] })
  const appWs = wb.addWorksheet(appSheet, { views: [{ showGridLines: false }] })

  const appRows = buildApp(appWs, d)
  const sowTotal = buildBreakdown(sow, d, 'SOW', 'measured', `'${appSheet}'!F${appRows.measured}`, `'${appSheet}'!H${appRows.measured}`, d.totals.previous.measured)
  const varTotal = buildBreakdown(vars, d, 'Variations', 'variations', `'${appSheet}'!F${appRows.variations}`, `'${appSheet}'!H${appRows.variations}`, d.totals.previous.variations)
  const summaryLast = buildSummary(summary, d, sowTotal, varTotal)
  buildFront(front, d)

  for (const [ws, widths, last, orient] of [
    [front, FRONT_W, 40 + Math.max(1, (d.pn.notes ?? '').split('\n').length), 'portrait'],
    [summary, GRID_W, summaryLast, 'landscape'],
    [sow, GRID_W, sowTotal, 'landscape'],
    [vars, GRID_W, varTotal, 'landscape'],
    [appWs, APP_W, appRows.last, 'portrait'],
  ] as const) {
    placeLogo(ws, logoId, [...widths], setupPage(ws, [...widths], last, orient))
  }

  await download(wb, safeName(`${d.job.job_no}_${d.job.code}_${d.company.name}_Payment Notice ${d.pn.notice_no}`) + '.xlsx')
}

const set = (ws: Worksheet, addr: string, v: Cell['value'], o: { bold?: boolean; fmt?: string; size?: number; align?: 'left' | 'center' | 'right'; wrap?: boolean; red?: boolean } = {}) => {
  const c = ws.getCell(addr)
  c.value = v
  c.font = { name: 'Calibri', size: o.size ?? 11, bold: o.bold, color: o.red ? { argb: 'FFFF0000' } : undefined }
  if (o.fmt) c.numFmt = o.fmt
  if (o.align || o.wrap) c.alignment = { horizontal: o.align, vertical: 'middle', wrapText: o.wrap }
  return c
}
const f = (formula: string, result: number) => ({ formula, result })
const subName = (c: Company) => c.name.replace(/\b(ltd|limited)\.?$/i, '').trim()

// ---------- Payment Notice (front page) ----------
// as the template, with the spacer columns tightened so it prints larger
const FRONT_W = [4, 9, 9, 9, 9, 9, 9, 13, 18, 2, 2, 1, 16, 1, 16]

function buildFront(ws: Worksheet, d: NoticeDoc) {
  const { pn, app, order, job, company, totals: t } = d
  set(ws, 'B2', 'PAYMENT NOTICE', { bold: true, size: 16 })
  set(ws, 'B4', company.name, { bold: true })
  const addr = [...(company.address ?? '').split(/\n|,/).map((s) => s.trim()).filter(Boolean), company.postcode].filter(Boolean)
  addr.slice(0, 4).forEach((line, i) => set(ws, `B${5 + i}`, line))

  const right: [number, string, Cell['value'], string?][] = [
    [5, 'Date', excelDate(pn.notice_date), DATE],
    [7, 'Project Name', job.name],
    [8, 'Project Number', `${job.job_no} ${job.code}`],
    [9, 'Order No.', order.order_no ?? ''],
    [11, 'Application Number', app.app_no],
    [12, 'Valuation Due Date', excelDate(pn.valuation_date), DATE],
    [14, 'dbp Payment Date', excelDate(pn.dbp_payment_date), DATE],
  ]
  for (const [r, label, v, fmt] of right) {
    set(ws, `H${r}`, label, { bold: true, align: 'right' })
    set(ws, `I${r}`, v, { fmt, align: 'left' })
  }
  set(ws, 'H13', 'Payment Due Date', { bold: true, align: 'right' })
  // payment due = valuation due + 30 days, as a formula like the template (or as entered if it differs)
  const due = excelDate(pn.payment_due_date)
  const standard = pn.valuation_date && pn.payment_due_date && due && excelDate(pn.valuation_date)!.getTime() + 30 * 86400000 === due.getTime()
  set(ws, 'I13', standard ? { formula: 'I12+30', result: due } : due, { fmt: DATE, align: 'left' })

  set(ws, 'M12', 'Previous Application', { bold: true, align: 'center' })
  set(ws, 'M13', `Nr ${pn.notice_no - 1}`, { align: 'center' })
  ws.mergeCells('O12:O13')
  set(ws, 'O12', 'Movement\nin the Month', { bold: true, align: 'center', wrap: true })

  const rows: [number, string, Cell['value'], number][] = [
    [18, 'Measured Works', f(`Summary!L${SUMMARY_SOW_ROW}`, t.dub.measured), t.previous.measured],
    [20, 'Variations', f(`Summary!L${SUMMARY_VAR_ROW}`, t.dub.variations), t.previous.variations],
    [22, 'Materials on Site', t.dub.materials, t.previous.materials],
    [24, 'Loss and Expense', t.dub.lossAndExpense, t.previous.lossAndExpense],
    [26, 'Contra Charges Notified', t.dub.contra, t.previous.contra],
  ]
  const side = (c: Cell) => (c.border = { left: thin, right: thin })
  for (const [r, label, v, prev] of rows) {
    set(ws, `B${r}`, label, { bold: true })
    const i = set(ws, `I${r}`, v, { fmt: NUM })
    i.border = { right: medium }
    side(set(ws, `M${r}`, prev, { fmt: NUM }))
    side(set(ws, `O${r}`, f(`I${r}-M${r}`, (typeof v === 'object' ? (v as { result: number }).result : (v as number)) - prev), { fmt: NUM }))
  }
  const total = (r: number, label: string, i: Cell['value'], m: Cell['value'], o: Cell['value'], bold = false) => {
    if (label) set(ws, `G${r}`, label, { bold: true })
    const ci = set(ws, `I${r}`, i, { fmt: NUM, bold })
    const cm = set(ws, `M${r}`, m, { fmt: NUM, bold })
    const co = set(ws, `O${r}`, o, { fmt: NUM, bold })
    ci.border = bold ? { top: medium, bottom: double, right: medium } : { right: medium }
    for (const c of [cm, co]) c.border = bold ? { top: medium, bottom: double, left: thin, right: thin } : { left: thin, right: thin }
  }
  total(28, '', f('SUM(I17:I26)', t.dub.gross), f('SUM(M17:M26)', t.previous.gross), f('SUM(O17:O26)', t.dub.gross - t.previous.gross), true)
  set(ws, 'H30', t.retentionPct / 100, { fmt: PCT })
  total(30, 'Retention', f('-I28*H30', t.dub.retention), f('-M28*H30', t.previous.retention), f('-O28*H30', t.dub.retention - t.previous.retention))
  total(32, 'Sub Total', f('SUM(I28:I31)', t.dub.subTotal), f('SUM(M28:M31)', t.previous.subTotal), f('SUM(O28:O31)', t.dub.subTotal - t.previous.subTotal))
  total(34, 'Previously Paid', t.dub.previouslyPaid, -d.previousPaidOnPrevious, f('I34-M34', t.dub.previouslyPaid + d.previousPaidOnPrevious))
  total(36, 'Total Due (excl. VAT)', f('SUM(I32:I35)', t.dub.due), f('SUM(M32:M35)', t.previous.subTotal - d.previousPaidOnPrevious), f('SUM(O32:O35)', t.dub.due - (t.previous.subTotal - d.previousPaidOnPrevious)), true)

  ;(pn.notes ?? '').split('\n').filter((s) => s.trim()).forEach((line, i) => set(ws, `B${40 + i}`, line))
}

// ---------- Summary / SOW / Variations ----------
// The template's layout, moved down T rows so the logo (top right) sits clear of the headings.
const T = 4
const row = (n: number) => n + T
const GRID_W = [5.45, 58.45, 11.45, 11.45, 13.54, 14.54, 1.82, 13.54, 13.54, 1.18, 13.54, 13.54, 1.45, 13.54, 13.54, 1.2, 13.54, 13.54]

function gridHeads(ws: Worksheet, d: NoticeDoc, title: Cell['value']) {
  const n = d.app.app_no
  const sub = subName(d.company)
  set(ws, `B${row(2)}`, title, { bold: true, size: 12 })
  const pairs: [string, string, string][] = [
    ['H', 'I', `${sub}\nValuation ${n}`],
    ['K', 'L', `DuB Assessment\nValuation ${n}`],
    ['N', 'O', `${sub}\nPrevious Valuation ${n - 1}`],
    ['Q', 'R', 'Movement in the Month'],
  ]
  for (const [a, b, text] of pairs) {
    ws.mergeCells(`${a}${row(2)}:${b}${row(2)}`)
    const c = set(ws, `${a}${row(2)}`, text, { bold: true, align: 'center', wrap: true })
    c.border = { top: medium, left: medium, right: medium, bottom: medium }
  }
  ws.getRow(row(2)).height = 49.5
  const heads = ['Item', 'Description', 'Quantity', 'Unit', 'Rate', 'Total', '', '%\nComplete', 'Amount', '', '%\nComplete', 'Amount', '', '%\nComplete', 'Amount', '', '%\nComplete', 'Amount']
  heads.forEach((h, i) => {
    if (!h) return
    const c = set(ws, `${ws.getColumn(i + 1).letter}${row(3)}`, h, { bold: true, align: 'center', wrap: true })
    c.border = { top: medium, bottom: medium, left: medium, right: medium }
  })
  ws.getRow(row(3)).height = 33
}

// a row's % columns as formulas (H=I/F, K=L/F, N=O/F, Q=R/F) and the movement R=I-O
function pctCols(ws: Worksheet, r: number, vals: { F: number; I: number; L: number; O: number }) {
  const ratio = (a: number) => (vals.F ? a / vals.F : 0)
  set(ws, `H${r}`, f(`IF(F${r}=0,0,I${r}/F${r})`, ratio(vals.I)), { fmt: PCT })
  set(ws, `K${r}`, f(`IF(F${r}=0,0,L${r}/F${r})`, ratio(vals.L)), { fmt: PCT })
  set(ws, `N${r}`, f(`IF(F${r}=0,0,O${r}/F${r})`, ratio(vals.O)), { fmt: PCT })
  set(ws, `R${r}`, f(`I${r}-O${r}`, vals.I - vals.O), { fmt: ACC })
  set(ws, `Q${r}`, f(`IF(F${r}=0,0,R${r}/F${r})`, ratio(vals.I - vals.O)), { fmt: PCT })
}

function buildBreakdown(ws: Worksheet, d: NoticeDoc, title: 'SOW' | 'Variations', block: 'measured' | 'variations', valueRef: string, claimedRef: string, previous: number) {
  gridHeads(ws, d, { formula: `Summary!B${row(2)}` })
  set(ws, `B${row(5)}`, title, { bold: true })
  const own = d.lines.filter((l) => l.block === block)
  const value = own.reduce((s, l) => s + Number(l.value ?? 0), 0)
  const claimed = own.reduce((s, l) => s + lineAmount(l), 0)
  const r7 = row(7)
  set(ws, `A${r7}`, 1)
  set(ws, `B${r7}`, `As per App ${d.app.app_no}`)
  set(ws, `C${r7}`, 1)
  set(ws, `D${r7}`, 'item')
  set(ws, `E${r7}`, f(valueRef, value), { fmt: ACC })
  set(ws, `F${r7}`, f(`C${r7}*E${r7}`, value), { fmt: ACC })
  set(ws, `I${r7}`, f(claimedRef, claimed), { fmt: ACC })
  set(ws, `L${r7}`, f(`I${r7}`, claimed), { fmt: ACC })
  set(ws, `O${r7}`, previous, { fmt: ACC })
  pctCols(ws, r7, { F: value, I: claimed, L: claimed, O: previous })

  // DuB adjustments: extra lines that change the DuB assessment only
  let r = r7 + 1
  for (const a of d.adjustments.filter((x) => x.block === block)) {
    set(ws, `B${r}`, a.description, { wrap: true })
    set(ws, `L${r}`, Number(a.amount), { fmt: ACC })
    r++
  }
  r++
  set(ws, `B${r}`, 'Balancing')
  const tot = r + 3
  set(ws, `D${tot}`, 'TOTAL TO SUMMARY', { bold: true })
  for (const col of ['F', 'I', 'L', 'O', 'R']) {
    const c = set(ws, `${col}${tot}`, { formula: `SUM(${col}${row(5)}:${col}${tot - 1})` }, { fmt: ACC, bold: true })
    c.border = { top: medium, bottom: medium, left: medium, right: medium }
  }
  for (let rr = row(5); rr < tot; rr++) for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'H', 'I', 'K', 'L', 'N', 'O', 'Q', 'R']) ws.getCell(`${col}${rr}`).border = { left: medium, right: medium }
  return tot
}

// Summary rows (after the offset), used by the Payment Notice page's formulas
const SUMMARY_SOW_ROW = row(7)
const SUMMARY_VAR_ROW = row(8)

function buildSummary(ws: Worksheet, d: NoticeDoc, sowTotal: number, varTotal: number) {
  const { job, totals: t } = d
  const site = (job.site_address ?? '').split(/,|\n/)[0]?.trim()
  gridHeads(ws, d, `${job.name}${site ? `, ${site}` : ''}`)
  set(ws, `B${row(5)}`, 'Summary', { bold: true })
  const rows: [number, string, string, { F: number; I: number; L: number; O: number }][] = [
    [SUMMARY_SOW_ROW, 'SOW', 'SOW', { F: t.theirs.measuredValue, I: t.theirs.measured, L: t.dub.measured, O: t.previous.measured }],
    [SUMMARY_VAR_ROW, 'Variations', 'Variations', { F: t.theirs.variationsValue, I: t.theirs.variations, L: t.dub.variations, O: t.previous.variations }],
  ]
  rows.forEach(([r, label, sheet, v], i) => {
    const tot = sheet === 'SOW' ? sowTotal : varTotal
    set(ws, `A${r}`, i + 1)
    set(ws, `B${r}`, label)
    set(ws, `F${r}`, f(`${sheet}!F${tot}`, v.F), { fmt: ACC })
    set(ws, `I${r}`, f(`${sheet}!I${tot}`, v.I), { fmt: ACC })
    set(ws, `L${r}`, f(`${sheet}!L${tot}`, v.L), { fmt: ACC })
    set(ws, `O${r}`, f(`${sheet}!O${tot}`, v.O), { fmt: ACC })
    pctCols(ws, r, v)
  })
  const box = (c: Cell, bold = true) => {
    c.border = { top: medium, bottom: medium, left: medium, right: medium }
    if (bold) c.font = { name: 'Calibri', size: 11, bold: true }
  }
  const [r12, r16, r18, r20, r22] = [12, 16, 18, 20, 22].map(row)
  for (const col of ['F', 'I', 'L', 'O', 'R']) box(set(ws, `${col}${r12}`, { formula: `SUM(${col}${row(5)}:${col}${row(11)})` }, { fmt: ACC }))
  set(ws, `E${r16}`, 'Retention', { bold: true })
  set(ws, `F${r16}`, t.retentionPct / 100, { fmt: PCT })
  for (const col of ['I', 'L', 'O']) box(set(ws, `${col}${r16}`, { formula: `-${col}${r12}*$F$${r16}` }, { fmt: ACC }), false)
  set(ws, `E${r18}`, 'Sub Total', { bold: true })
  for (const col of ['I', 'L', 'O']) box(set(ws, `${col}${r18}`, { formula: `SUM(${col}${r12}:${col}${r18 - 1})` }, { fmt: ACC }), false)
  set(ws, `E${r20}`, 'Previously Paid', { bold: true })
  box(set(ws, `I${r20}`, f("'Payment Notice'!I34", t.dub.previouslyPaid), { fmt: ACC }), false)
  box(set(ws, `L${r20}`, f("'Payment Notice'!I34", t.dub.previouslyPaid), { fmt: ACC }), false)
  box(set(ws, `O${r20}`, -d.previousPaidOnPrevious, { fmt: ACC }), false)
  set(ws, `E${r22}`, 'Total Due (excl. VAT)', { bold: true })
  for (const col of ['I', 'L', 'O']) box(set(ws, `${col}${r22}`, { formula: `SUM(${col}${r18}:${col}${r22 - 1})` }, { fmt: ACC }))
  return r22
}

// ---------- App N: the subcontractor's application, line by line ----------
const APP_W = [8, 60, 7, 7, 8, 13, 9, 13, 36]
const A = 2 // rows moved down, clear of the logo

function buildApp(ws: Worksheet, d: NoticeDoc) {
  const { app, job, company } = d
  set(ws, `B${2 + A}`, company.name, { bold: true, size: 12 })
  set(ws, `C${2 + A}`, `APPLICATION FOR PAYMENT No. ${app.app_no}`, { bold: true })
  set(ws, `C${3 + A}`, 'ISSUED')
  set(ws, `F${3 + A}`, excelDate(app.app_date), { fmt: DATE, align: 'right' })
  set(ws, `B${4 + A}`, job.name)
  set(ws, `C${4 + A}`, 'MEASURED TO')
  set(ws, `F${4 + A}`, excelDate(app.app_date), { fmt: DATE, align: 'right' })
  ;['', 'Description', 'quant', 'unit', 'rate', 'total', '% done', 'total', 'DuB notes'].forEach((h, i) => {
    const addr = `${ws.getColumn(i + 1).letter}${5 + A}`
    if (h) set(ws, addr, h, { bold: true, align: i >= 4 && i <= 7 ? 'right' : undefined })
    ws.getCell(addr).border = { bottom: thin }
  })

  let r = 7 + A
  const section = (block: 'measured' | 'materials' | 'variations', title: string, totalLabel: string | null) => {
    const own = d.lines.filter((l) => l.block === block)
    set(ws, `B${r}`, title, { bold: true })
    r++
    const first = r
    if (!own.length) {
      set(ws, `B${r}`, 'none claimed')
      r += 2
      return null
    }
    let heading: string | null = title // their own section headings, if any
    for (const l of own) {
      if (l.heading && l.heading !== heading) {
        if (heading !== title) r++
        heading = l.heading
        set(ws, `B${r}`, heading, { bold: true })
        r++
      }
      set(ws, `A${r}`, l.item_ref ?? '')
      set(ws, `B${r}`, l.description ?? '', { wrap: true })
      set(ws, `D${r}`, 'sum')
      set(ws, `F${r}`, l.value, { fmt: NUM })
      // effective % (what was actually claimed), so H = F × G reproduces their figure
      const amount = lineAmount(l)
      const eff = l.value ? amount / Number(l.value) : l.pct
      set(ws, `G${r}`, eff, { fmt: PCT })
      set(ws, `H${r}`, f(`IF(ISNUMBER(F${r}),F${r}*N(G${r}),0)`, amount), { fmt: NUM })
      const stated = l.pct != null && eff != null && Math.abs(l.pct - eff) > 0.0005 ? `Stated ${Math.round(l.pct * 1000) / 10}%. ` : ''
      set(ws, `I${r}`, `${stated}${l.note ?? ''}`.trim() || null, { wrap: true })
      r++
    }
    if (!totalLabel) {
      r++
      return null
    }
    r++
    set(ws, `B${r}`, totalLabel, { bold: true })
    for (const col of ['F', 'H']) {
      const c = set(ws, `${col}${r}`, { formula: `SUM(${col}${first}:${col}${r - 1})` }, { fmt: NUM, bold: true })
      c.border = { top: thin, bottom: double }
    }
    const at = r
    r += 2
    return at
  }
  const measured = section('measured', 'Contract works', 'TOTAL') ?? r
  section('materials', 'Materials on site', null)
  const variations = section('variations', 'Variations', 'VARIATIONS TOTAL') ?? r
  return { measured, variations, last: r }
}

