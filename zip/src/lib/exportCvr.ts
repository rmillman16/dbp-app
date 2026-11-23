// CVR to Excel, cell for cell as Richard's 2609 KOSH CVR (20 Nov: "identical, as it runs into
// the wider company CVR"). Two sheets:
// - "CVR_<month yy>": the summary. Header and tender values; every supplier on the iPlicit
//   report (code, name, order value, allowances, expected final, cost from JC, package, last
//   month / this month / movement); then the budgets: OH&P, DuB management and design shown and
//   omitted in pairs, each package drawing its suppliers' costs down (E = −their costs), EP last;
//   then total cost (G + H + I of the totals row), final account, AFV, margin, certified and
//   programme. A package let as one order to one supplier sits on that supplier's row (its
//   order value in D), as on the KOSH sheet. Column I (unused on the KOSH sheet but already in
//   its total cost) carries what a package is over its target, or a typed forecast's
//   difference, so overruns show and reduce the margin (agreed 20 Nov).
// - "CVR <ddmmyy>": the breakdown. Every office SoW item with its cost by package and its OH&P
//   on lines under it, spread into a column per package (OH&P in L, EP in M), with the SoW
//   totals, %, targets, return and who each package is with underneath. The summary's order
//   values link to its target row, and OH&P to its OH&P total, as the KOSH sheet does.
import type { Cell, Worksheet } from 'exceljs'
import { download, excelDate, fill, newWorkbook, safeName } from './excel'
import type { CvrResult, PackageRow, SupplierRow } from './cvrCalc'
import type { SavedBudgetLine, SavedCostLine } from './cvr'
import type { Cvr, CvrPackage, Job } from './types'

// number formats as on the KOSH sheets
const GBP = '"£"#,##0.00_);[Red]("£"#,##0.00)'
const GBP_MOVE = '"£"#,##0.00;[Red]-"£"#,##0.00'
const ACC = '_-"£"* #,##0.00_-;-"£"* #,##0.00_-;_-"£"* "-"??_-;_-@_-'
const NUM = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-'
const PCT = '0.00%'
// its theme colours (Office 2023), as plain colours so they look the same in any Excel
const GREY = 'FFD9D9D9'
const YELLOW = 'FFFFFF00'
const GREEN_LIGHT = 'FFD9F2D0' // OH&P and EP
const GREEN = 'FFB4E5A2' // DuB, omitted
const GREEN_DARK = 'FF8ED973' // "Omit - …"
const BLUE_LIGHT = 'FFDCEAF7' // cost lines
const PURPLE = 'FF7030A0' // provisional sums
const NOTE_BLUE = 'FF0070C0'
// suppliers and the package they draw down share a colour
const PAIRS = ['FFFBE3D6', 'FFCAEEFB', 'FFF2CFEE', 'FFF6C6AD', 'FFD9D9D9', 'FFDCEAF7', 'FFB4E5A2', 'FFF2AA84']

const thin = { style: 'thin' as const }
const gbp = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const r2 = (n: number) => Math.round(n * 100) / 100
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

type Opts = { font?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; color?: string; fmt?: string; align?: 'left' | 'center' | 'right'; wrap?: boolean; bg?: string }
function put(ws: Worksheet, addr: string, v: Cell['value'], o: Opts = {}) {
  const c = ws.getCell(addr)
  c.value = v
  c.font = { name: o.font ?? 'Arial', size: o.size ?? 12, bold: o.bold, italic: o.italic, underline: o.underline, color: o.color ? { argb: o.color } : undefined }
  if (o.fmt) c.numFmt = o.fmt
  c.alignment = { horizontal: o.align, vertical: 'middle', wrapText: o.wrap }
  if (o.bg) fill(c, o.bg)
  return c
}
const f = (formula: string, result?: number | string | null) => ({ formula, result: result ?? undefined }) as Cell['value']
const border = (c: Cell, b: Partial<Record<'top' | 'bottom' | 'left' | 'right', { style: 'thin' | 'medium' | 'double' }>>) => (c.border = { ...c.border, ...b })
// "1.01" → 1.01 (shown 0.00), like the KOSH item numbers
const refValue = (s: string | null) => (s && /^\d+(\.\d+)?$/.test(s) ? Number(s) : s)
const colNo = (s: string | null) => {
  const m = /^([A-Z]{1,3})\b/.exec(s ?? '')
  return m ? m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) : 1e6
}
const isOhp = (name: string) => /^(oh&p|ohp|overh)/i.test(name)
const isProv = (name: string) => /provision|prov sum/i.test(name)
const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`
// a package's order value / target before agreed VOs (which go in "Allowances / Variations").
// A prelims section's is what it draws from the lump, so the lump and its sections still add
// up to the prelims budget.
const base = (p: PackageRow) => r2((p.source === 'drawdown' ? p.forecast : p.target) - p.voCost)
// "DuB Management" → "Management", for "Omit - Management"
const omitName = (name: string) => name.replace(/^(dub|du boulay)\s+/i, '')

export interface CvrExportExtra {
  packages: CvrPackage[] // the job's packages (their SoW columns give the breakdown's order)
  lines: SavedBudgetLine[] // the office SoW's lines (script 018)
  previousDate: string | null // last CVR's "cost as at"
}

export async function exportCvr(job: Job, cvr: Cvr, r: CvrResult, costs: SavedCostLine[], x: CvrExportExtra) {
  const { wb } = await newWorkbook()
  const prepared = cvr.prepared_date ?? cvr.period_end
  const [py, pm] = cvr.period_end.split('-').map(Number)
  const sumName = `CVR_${MONTHS[pm - 1]} ${String(py).slice(2)}`
  const bdName = `CVR ${prepared.slice(8, 10)}${prepared.slice(5, 7)}${prepared.slice(2, 4)}`
  const ws = wb.addWorksheet(sumName)
  const bd = wb.addWorksheet(bdName)

  // ================= the breakdown's columns: OH&P, EP, omitted, prelims, then SoW order =================
  const byName = new Map(x.packages.map((p) => [p.name, p]))
  const rowOf = new Map(r.packages.map((p) => [p.name, p]))
  const sowCol = (name: string) => colNo(byName.get(name)?.sow_column ?? null)
  const names = new Set<string>([...r.packages.map((p) => p.name), ...x.lines.flatMap((l) => Object.keys(l.amounts ?? {}))])
  if (![...names].some(isOhp)) names.add('OH&P')
  const rank = (n: string) => {
    const p = rowOf.get(n)
    if (isOhp(n)) return 0
    if (p?.kind === 'ep') return 1
    if (p?.kind === 'omit') return 2
    if (p?.group === 'prelims') return byName.get(n)?.is_remainder ? 3 : 4
    return p ? 5 : 6
  }
  const columns = [...names].sort((a, b) => rank(a) - rank(b) || sowCol(a) - sowCol(b) || a.localeCompare(b, 'en-GB', { numeric: true, sensitivity: 'base' }))
  const FIRST = 12 // L
  const colOf = new Map(columns.map((n, i) => [n, FIRST + i]))
  const letter = (c: number) => bd.getColumn(c).letter
  const lastPkgCol = FIRST + columns.length - 1
  const spacer = lastPkgCol + 1
  const checkCol = lastPkgCol + 2
  const L = (n: string) => letter(colOf.get(n)!)
  const colFill = (n: string) => (isOhp(n) || rowOf.get(n)?.kind === 'ep' ? GREEN_LIGHT : rowOf.get(n)?.kind === 'omit' ? GREEN : isProv(n) ? PURPLE : undefined)

  // ================= breakdown sheet =================
  const BF = 'Aptos Narrow'
  const bput = (addr: string, v: Cell['value'], o: Opts = {}) => put(bd, addr, v, { font: BF, size: 11, ...o })
  const bwidths = [12.63, 12.63, 6.63, 50.63, 5.63, 5.63, 12.63, 12.63, 5.63, 5.63, 12.63, ...columns.map(() => 12.63), 5.63, 12.63]
  bwidths.forEach((w, i) => (bd.getColumn(i + 1).width = w))
  bd.views = [{ state: 'frozen', xSplit: 8, ySplit: 7, zoomScale: 90 }]
  // package names over rows 2–4 ("Timber Floor / Supply", "DUB / Management")
  for (const n of columns) {
    const parts = /^(dub|du boulay)\s+/i.test(n)
      ? ['DUB', omitName(n)]
      : / [–/-] /.test(n)
        ? n.split(/ [–/-] /)
        : n.split(' ').length > 1 && n.length > 12
          ? [n.split(' ')[0], n.split(' ').slice(1).join(' ')]
          : [n]
    const three = parts.length > 3 ? [...parts.slice(0, 2), parts.slice(2).join(' / ')] : parts
    const c = colOf.get(n)!
    const bg = colFill(n)
    for (let k = 0; k < 3; k++) bput(`${letter(c)}${2 + k}`, three[k] ?? null, { bold: true, align: 'center', bg, color: bg === PURPLE ? 'FFFFFFFF' : undefined })
  }
  for (let c = 1; c <= checkCol; c++) border(bd.getRow(7).getCell(c), { bottom: thin })
  for (let rr = 2; rr <= 7; rr++) border(bd.getRow(rr).getCell(10), { left: thin })

  let row = 9
  const firstData = row
  if (!x.lines.length) {
    bput(`D${row}`, 'The office SoW lines aren’t in the app yet: re-import the office SoW on the CVR tab (after script 018) to list every item here.', { italic: true, color: 'FFFF0000', wrap: true })
    bd.getRow(row).height = 30
    row += 2
  }
  const sectionRows: number[] = []
  const lines = x.lines
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const at = row
    const amounts = Object.entries(l.amounts ?? {}).map(([n, v]) => [n, Number(v)] as const)
    if (l.kind === 'section') {
      sectionRows.push(at)
      bput(`D${at}`, l.description, { bold: true, wrap: true })
      if (l.ref) bput(`C${at}`, refValue(l.ref), { fmt: '0.00', align: 'center' })
      // a one-row section that carries money itself (KOSH's "Balancing")
      if (amounts.length && l.total != null) {
        bput(`B${at}`, f(`H${at}`, Number(l.total)), { fmt: NUM })
        bput(`H${at}`, Number(l.total), { fmt: NUM })
      }
    } else if (l.kind === 'item') {
      let end = i
      while (lines[end + 1]?.kind === 'line') end++
      const nLines = end - i
      bput(`C${at}`, refValue(l.ref), { fmt: '0.00', align: 'center' })
      bput(`D${at}`, l.description, { wrap: true })
      if (nLines || amounts.length) bput(`B${at}`, f(`SUM(H${at}:H${at + nLines})`, l.total), { fmt: NUM })
      else if (l.total != null) bput(`B${at}`, Number(l.total), { fmt: NUM })
      if (l.shown) bput(`H${at}`, l.shown, { align: 'right' })
    } else {
      const ohp = amounts.length === 1 && isOhp(amounts[0][0])
      const prov = amounts.length === 1 && isProv(amounts[0][0])
      const bg = ohp ? GREEN_LIGHT : prov ? PURPLE : BLUE_LIGHT
      const o: Opts = { bg, color: prov ? 'FFFFFFFF' : undefined }
      for (const col of ['B', 'C', 'I']) bput(`${col}${at}`, null, o)
      bput(`D${at}`, l.description, { ...o, wrap: true })
      bput(`E${at}`, l.qty == null ? null : Number(l.qty), { ...o, align: 'center' })
      bput(`F${at}`, l.unit, { ...o, align: 'center' })
      bput(`G${at}`, l.rate == null ? null : Number(l.rate), { ...o, fmt: NUM })
      const total = l.total == null ? null : Number(l.total)
      const byRate = total != null && l.qty != null && l.rate != null && Math.abs(Number(l.qty) * Number(l.rate) - total) < 0.01
      bput(`H${at}`, l.shown ? l.shown : byRate ? f(`E${at}*G${at}`, total) : total, { ...o, fmt: NUM, align: l.shown ? 'right' : undefined })
    }
    if (l.kind !== 'section' || amounts.length) {
      const single = amounts.length === 1 && l.kind !== 'item' && l.total != null && Math.abs(amounts[0][1] - Number(l.total)) < 0.005
      for (const [n, v] of amounts) {
        const c = colOf.get(n)!
        const bg = colFill(n)
        bput(`${letter(c)}${at}`, single ? f(`H${at}`, v) : v, { fmt: NUM, bg, color: bg === PURPLE ? 'FFFFFFFF' : undefined })
      }
      bput(`${letter(checkCol)}${at}`, f(`SUM(L${at}:${letter(spacer)}${at})`), { fmt: NUM })
    }
    if (l.note) bput(`K${at}`, l.note, { italic: true, color: NOTE_BLUE, bg: YELLOW })
    row++
  }
  const lastData = Math.max(firstData, row - 1)
  // each section's total in A: its items' totals in B, down to the next section
  sectionRows.forEach((s, k) => {
    const end = (sectionRows[k + 1] ?? row) - 1
    bput(`A${s}`, f(`SUM(B${s}:B${end})`), { fmt: NUM, bold: true })
  })
  // the package columns keep their colour down the sheet, as on the KOSH tab
  for (const n of columns) {
    const bg = colFill(n)
    if (!bg) continue
    const c = colOf.get(n)!
    for (let rr = 5; rr <= lastData; rr++) {
      const cell = bd.getRow(rr).getCell(c)
      if (!cell.fill || (cell.fill as { pattern?: string }).pattern !== 'solid') fill(cell, bg)
    }
  }
  for (let rr = 8; rr <= lastData; rr++) border(bd.getRow(rr).getCell(10), { left: thin })

  // totals, %, targets, return and who each package is with (rows 1433–1441 on the KOSH tab)
  const T = lastData + 2
  const pkgRange = (rr: number) => `L${rr}:${letter(lastPkgCol)}${rr}`
  bput(`A${T}`, f(`SUM(A${firstData}:A${T - 1})`), { fmt: NUM, bold: true })
  bput(`H${T}`, f(`SUM(H${firstData}:H${T - 1})`), { fmt: NUM, bold: true })
  bput(`K${T}`, f(`SUM(${pkgRange(T)})`), { fmt: NUM, bold: true })
  bput(`${letter(checkCol)}${T}`, f(`SUM(${letter(checkCol)}${firstData}:${letter(checkCol)}${T - 1})`), { fmt: NUM, bold: true })
  const target = (n: string) => {
    const p = rowOf.get(n)
    return !p || p.kind === 'omit' ? 0 : base(p)
  }
  const TGT = T + 3
  const RET = T + 5
  const WITH = T + 8
  for (const n of columns) {
    const c = letter(colOf.get(n)!)
    bput(`${c}${T}`, f(`SUM(${c}${firstData}:${c}${T - 1})`), { fmt: NUM, bold: true })
    bput(`${c}${T + 1}`, f(`IF($H$${T}=0,0,${c}${T}/$H$${T})`), { fmt: PCT })
    bput(`${c}${TGT}`, target(n), { fmt: NUM, bg: YELLOW })
    bput(`${c}${RET}`, f(`IF(${c}${T}=0,0,(${c}${T}-${c}${TGT})/${c}${T})`), { fmt: PCT })
    const p = rowOf.get(n)
    bput(`${c}${WITH}`, p ? p.supplierNote || p.suppliers.join(', ') || null : null, { size: 10, align: 'center', wrap: true })
  }
  bput(`J${TGT}`, 'Target', { align: 'right', bold: true })
  bput(`K${TGT}`, f(`SUM(${pkgRange(TGT)})`), { fmt: NUM, bold: true })
  bput(`J${RET}`, 'Return £', { align: 'right' })
  bput(`K${RET}`, f(`K${T}-K${TGT}`), { fmt: NUM })
  bput(`J${RET + 1}`, 'Return %', { align: 'right' })
  bput(`K${RET + 1}`, f(`IF(K${T}=0,0,K${RET}/K${T})`), { fmt: PCT })
  bput(`J${WITH}`, 'With', { align: 'right' })
  bd.pageSetup = { paperSize: 9, orientation: 'portrait', printArea: `A1:${letter(checkCol)}${WITH}`, printTitlesRow: '2:7', margins: { left: 0.39, right: 0.39, top: 0.39, bottom: 0.2, header: 0.2, footer: 0.2 } }

  // ================= summary sheet =================
  const widths = [3, 25.63, 40.63, 20.63, 20.63, 20.63, 20.63, 22.63, 22.63, 3, 3, 70.27, 15.63, 15.63, 15.63, 10.27]
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  const link = (cell: string) => `${quoteSheet(bdName)}!${cell}`

  // ---- header (rows 1–11) ----
  put(ws, 'B2', 'Interim Cost Value Reconciliation', { size: 16, bold: true, underline: true })
  ws.getRow(2).height = 20.25
  const h2 = put(ws, 'H2', 'Date prepared', { align: 'left' })
  const i2 = put(ws, 'I2', excelDate(prepared), { bold: true, fmt: 'd-mmm-yy', align: 'left', bg: GREY })
  for (const c of [h2, i2]) border(c, { top: thin, bottom: thin, left: thin, right: thin })
  ws.mergeCells('G4:I4')
  put(ws, 'G4', 'Tender Values', { align: 'center' })
  for (const [addr, label, v, o] of [
    ['5', 'Contract Name:', job.name, {}],
    ['6', 'Job No:', `${job.job_no} ${job.code}`, {}],
  ] as const) {
    const b = put(ws, `B${addr}`, label, { size: 14, bold: true, align: 'left', ...o })
    const c = put(ws, `C${addr}`, v, { size: 14, bold: true, align: 'left', bg: GREY })
    for (const x2 of [b, c]) border(x2, { top: thin, bottom: thin, left: thin, right: thin })
    ws.getRow(Number(addr)).height = 20.25
  }
  put(ws, 'G5', 'Order Value', { align: 'left' })
  put(ws, 'H5', r.tender.contractSum, { fmt: ACC, bg: YELLOW })
  put(ws, 'G6', "Overh'd & Profit", { align: 'left' })
  const ohpName = columns.find(isOhp)!
  put(ws, 'H6', f(link(`${L(ohpName)}${T}`), r.tender.ohp), { fmt: ACC, bg: GREY })
  put(ws, 'I6', f('IF(H5=0,0,H6/H5)', r.tender.ohpPct), { fmt: PCT, align: 'center' })
  // tender values box
  for (const a of ['G4', 'H4', 'I4']) border(ws.getCell(a), { top: thin })
  for (const a of ['G6', 'H6', 'I6']) border(ws.getCell(a), { bottom: thin })
  for (const a of ['G4', 'G5', 'G6']) border(ws.getCell(a), { left: thin })
  for (const a of ['I4', 'I5', 'I6']) border(ws.getCell(a), { right: thin })
  put(ws, 'H9', 'Total Costs', { bold: true, align: 'center' })
  const b10 = put(ws, 'B10', 'Sterling Cost', { bold: true })
  border(b10, { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'medium' } })
  put(ws, 'B11', 'Cost as at', { bold: true })
  put(ws, 'C11', excelDate(cvr.period_end), { bold: true, fmt: 'd-mmm-yy', align: 'left', bg: YELLOW })
  put(ws, 'G11', 'Jobcost Report', { bold: true, align: 'right' })
  for (const rr of [10, 11]) ws.getRow(rr).height = 20.25
  put(ws, 'M13', 'To Match the PDF sheet', { font: 'Aptos Narrow', size: 11, italic: true, color: 'FFFF0000', align: 'center', bg: YELLOW })

  // ---- column headings (row 14) ----
  const H = 14
  ws.getRow(H).height = 31
  ;(
    [
      ['B', 'Subcontract'],
      ['C', 'Name / Company'],
      ['D', 'Order Value'],
      ['E', 'Allowances / Variations'],
      ['F', 'Expected Final costs'],
      ['G', 'Included in cost from JC'],
      ['I', 'Over target'],
    ] as const
  ).forEach(([c, t]) => put(ws, `${c}${H}`, t, { align: 'center', wrap: true }))
  put(ws, `M${H}`, excelDate(x.previousDate), { fmt: 'mmm-yy', align: 'center' })
  put(ws, `N${H}`, excelDate(cvr.period_end), { fmt: 'mmm-yy', align: 'center' })
  put(ws, `O${H}`, 'Movement', { align: 'center' })

  // ---- which supplier draws down which package ----
  const allocTo = new Map<string, SupplierRow[]>()
  for (const s of r.suppliers) for (const p of s.packages) allocTo.set(p.id, [...(allocTo.get(p.id) ?? []), s])
  // a package let as one order, wholly to one supplier: on that supplier's row
  const letOf = new Map<string, PackageRow>()
  for (const p of r.packages) {
    const sup = allocTo.get(p.id) ?? []
    const s = sup[0]
    if (p.source === 'order' && p.kind === 'cost' && sup.length === 1 && s.packages.length === 1 && s.packages[0].amount == null && s.packages[0].share >= 0.9999) letOf.set(s.key, p)
  }
  const letIds = new Set([...letOf.values()].map((p) => p.id))
  const colour = new Map<string, string>()
  for (const p of r.packages) if (!letIds.has(p.id) && p.kind !== 'omit' && allocTo.get(p.id)?.length) colour.set(p.id, PAIRS[colour.size % PAIRS.length])

  const rowFmt: Opts = { fmt: GBP }
  const moneyRow = (at: number, d: Cell['value'], e: Cell['value'], g: number, i: number | null, bg?: string) => {
    put(ws, `D${at}`, d, { ...rowFmt, bg })
    put(ws, `E${at}`, e, { ...rowFmt, bg })
    put(ws, `F${at}`, f(`SUM(D${at}:E${at})`), rowFmt)
    put(ws, `G${at}`, g, rowFmt)
    put(ws, `H${at}`, f(`F${at}-G${at}`), rowFmt)
    put(ws, `I${at}`, i ? i : null, rowFmt)
  }
  const note = (at: number, t: string | null, o: Opts = {}) => put(ws, `L${at}`, t || null, { size: 10, color: NOTE_BLUE, align: 'left', ...o })

  // ---- suppliers on the iPlicit report ----
  row = H + 3
  const first = H + 1
  const supplierRow = new Map<string, number>()
  const costByKey = new Map(costs.map((c) => [`${c.supplier_code.trim()}|${c.supplier_name.trim()}`, c]))
  for (const s of r.suppliers) {
    const at = row++
    supplierRow.set(s.key, at)
    const let1 = letOf.get(s.key)
    const bg = let1 ? undefined : s.packages.length === 1 ? colour.get(s.packages[0].id) : undefined
    put(ws, `B${at}`, refValue(s.code) || null, { align: 'left', bg })
    put(ws, `C${at}`, s.name, { bg })
    if (let1) {
      const over = r2(let1.forecast - let1.target)
      moneyRow(at, f(link(`${L(let1.name)}${TGT}`), base(let1)), let1.voCost, s.total, over)
      note(at, [let1.name, let1.sourceNote, let1.forecastNote, over > 0.005 && !let1.forecastTyped ? `Over target by ${gbp(over)}` : ''].filter(Boolean).join(' · '))
    } else {
      moneyRow(at, 0, s.total, s.total, null, bg)
      const pk = s.packages.map((p) => `${p.name}${p.amount != null ? ` (${gbp(p.amount)})` : p.share < 0.9999 ? ` (${Math.round(p.share * 100)}%)` : ''}`).join(', ')
      if (pk) note(at, pk + (Math.abs(s.unallocated) >= 0.005 ? ` · ${gbp(s.unallocated)} not allocated` : ''), { bg })
      else note(at, 'Not allocated to a package', { color: 'FFFF0000' })
    }
    put(ws, `M${at}`, s.previous, { fmt: GBP_MOVE })
    put(ws, `N${at}`, s.total, { fmt: GBP_MOVE })
    put(ws, `O${at}`, f(`M${at}-N${at}`, s.previous == null ? null : r2(s.previous - s.total)), { fmt: GBP_MOVE })
    const why = costByKey.get(s.key)?.explanation
    if (why) put(ws, `P${at}`, why, { font: 'Aptos Narrow', size: 11, italic: true, color: 'FFFF0000', align: 'left' })
  }
  row++
  for (const c of ['M', 'N', 'O']) put(ws, `${c}${row}`, f(`SUM(${c}${first}:${c}${row - 1})`), { fmt: GBP_MOVE, bold: true })
  row++

  // ---- placeholders kept from the KOSH sheet ----
  const zero = (label: string | null, o: Opts = {}) => {
    const at = row++
    if (label) put(ws, `C${at}`, label, o)
    moneyRow(at, 0, 0, 0, null)
  }
  zero('Deposit Payments', { bold: true, italic: true, underline: true })
  zero(null)
  zero(null)
  zero('Unforeseen Costs')

  // ---- OH&P, DuB management and design: shown, then omitted ----
  const omits = r.packages.filter((p) => p.kind === 'omit').sort((a, b) => Number(isOhp(b.name)) - Number(isOhp(a.name)) || sowCol(a.name) - sowCol(b.name))
  for (const p of omits) {
    const at = row++
    put(ws, `C${at}`, p.name)
    moneyRow(at, f(link(`${L(p.name)}${T}`), p.budget), 0, 0, null)
    if (p.cost) note(at, `${gbp(p.cost)} of cost allocated here: it still counts in the cost`)
    const om = row++
    put(ws, `C${om}`, `Omit - ${omitName(p.name)}`, { color: 'FFFFFFFF', bg: GREEN_DARK })
    moneyRow(om, f(`-D${at}`, -p.budget), 0, 0, null)
    put(ws, `D${om}`, f(`-D${at}`, -p.budget), { ...rowFmt, color: 'FFFFFFFF', bg: GREEN_DARK })
  }

  // ---- each package drawing its suppliers' costs down, in the breakdown's order, EP last ----
  const pkgs = r.packages
    .filter((p) => p.kind !== 'omit' && !letIds.has(p.id))
    .sort((a, b) => Number(a.kind === 'ep') - Number(b.kind === 'ep') || columns.indexOf(a.name) - columns.indexOf(b.name))
  for (const p of pkgs) {
    const at = row++
    const bg = colour.get(p.id)
    const sup = allocTo.get(p.id) ?? []
    const parts = sup.map((s) => {
      const a = s.packages.find((x2) => x2.id === p.id)!
      const sr = supplierRow.get(s.key)!
      return a.amount != null ? String(r2(a.amount)) : a.share >= 0.9999 ? `E${sr}` : `E${sr}*${a.share}`
    })
    const draw = parts.length ? `-(${parts.join('+')})` : ''
    const e = p.voCost ? f(`${p.voCost}${draw}`, r2(p.voCost - p.cost)) : parts.length ? f(draw, -p.cost) : 0
    const over = r2(p.forecast - base(p) - p.voCost)
    put(ws, `C${at}`, p.kind === 'ep' ? 'EP / Contingency' : p.name, { bg: isProv(p.name) ? PURPLE : bg, color: isProv(p.name) ? 'FFFFFFFF' : undefined })
    moneyRow(at, f(link(`${L(p.name)}${TGT}`), base(p)), e, 0, Math.abs(over) >= 0.005 ? over : null, isProv(p.name) ? PURPLE : bg)
    if (isProv(p.name)) for (const c of ['D', 'E']) ws.getCell(`${c}${at}`).font = { name: 'Arial', size: 12, color: { argb: 'FFFFFFFF' } }
    const who = sup.map((s) => s.name)
    note(
      at,
      [
        who.length ? `See - ${who.join(', ')} above` : p.supplierNote,
        p.source === 'budget' || p.source === 'drawdown' ? '' : p.sourceNote,
        p.voCost ? `incl. ${gbp(p.voCost)} agreed VOs` : '',
        p.forecastNote,
        over > 0.005 && !p.forecastTyped ? `Over target by ${gbp(over)}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      { bg },
    )
  }
  for (const v of r.unallocatedVos) {
    const at = row++
    put(ws, `C${at}`, v.label)
    moneyRow(at, 0, v.cost, 0, null)
    note(at, 'Agreed VO not given a package')
  }

  // ---- totals ----
  row++
  const tot = row
  for (const c of ['D', 'E', 'F', 'G', 'H', 'I']) put(ws, `${c}${tot}`, f(`SUM(${c}${first}:${c}${tot - 1})`), rowFmt)
  put(ws, `H11`, f(`G${tot}`, r.jcTotal), { bold: true, fmt: '"£"#,##0.00', bg: GREY })
  const tc = tot + 2
  ws.getRow(tc).height = 20.5
  put(ws, `H${tc}`, 'Total Cost', { size: 16, bold: true, align: 'right' })
  border(put(ws, `I${tc}`, f(`SUM(G${tot}:I${tot})`, r.totalCost), { size: 16, bold: true, fmt: '"£"#,##0.00' }), { bottom: { style: 'double' } })

  const big = (at: number, label: string) => {
    ws.getRow(at).height = 20.25
    put(ws, `B${at}`, label, { size: 16, bold: true, align: 'left' })
  }
  const fa = tot + 6
  big(fa, 'Final account projected')
  put(ws, `H${fa}`, r.value.agreedVos ? f(`H5+${r.value.agreedVos}`, r.value.contractSum + r.value.agreedVos) : f('H5', r.value.contractSum), { size: 16, bold: true, fmt: ACC })
  if (r.value.agreedVos) note(fa, `SoW total plus ${gbp(r.value.agreedVos)} agreed variations`)
  big(fa + 1, 'Possible reduction / negotiations')
  put(ws, `H${fa + 1}`, r.value.possibleReduction, { size: 16, fmt: ACC, bg: GREY })
  const afv = tot + 9
  big(afv, 'Anticipated Final Value')
  put(ws, `I${afv}`, f(`H${fa}+H${fa + 1}`, r.value.afv), { size: 16, bold: true, fmt: ACC })
  big(tot + 11, 'Gross margin')
  put(ws, `I${tot + 11}`, f(`I${afv}-I${tc}`, r.margin), { size: 16, bold: true, fmt: ACC })
  big(tot + 13, 'Gross margin % on sales')
  put(ws, `I${tot + 13}`, f(`IF(I${afv}=0,0,I${tot + 11}/I${afv})`, r.marginPct), { size: 16, bold: true, fmt: PCT })
  if (cvr.notes) note(tot + 3, cvr.notes, { wrap: true })

  // ---- certified, retention, PC (inside the box) and the programme (below it) ----
  const pc = tot + 16
  const prog = tot + 21
  for (const at of [pc, pc + 1]) ws.getRow(at).height = 20.25
  put(ws, `B${pc}`, 'Practical Completion due on', { align: 'left' })
  put(ws, `D${pc}`, f(`D${prog + 4}`), { bold: true, fmt: 'd-mmm-yy', align: 'center', bg: GREY })
  put(ws, `H${pc}`, 'Gross Certified / invoiced to date', { bold: true, align: 'right' })
  put(ws, `I${pc}`, r.certified?.gross ?? 0, { bold: true, fmt: GBP_MOVE, bg: GREY })
  note(pc, r.certified?.label ?? 'No application assessed by the client yet')
  put(ws, `B${pc + 1}`, 'Defects Liability period', { align: 'left' })
  put(ws, `D${pc + 1}`, null, { bold: true, align: 'center', bg: GREY })
  put(ws, `H${pc + 1}`, 'Retention held from gross invoiced', { bold: true, align: 'right' })
  put(ws, `I${pc + 1}`, r.certified ? -r.certified.retention : 0, { bold: true, fmt: GBP_MOVE, bg: GREY })
  note(pc + 1, `${Number(job.retention_pct ?? 0)}% retention`)
  const progRow = (at: number, v: Cell['value'], label: string, fmt: string) => {
    put(ws, `D${at}`, v, { fmt, align: 'center', bg: 'FFCAEEFB' })
    put(ws, `E${at}`, label, { align: 'left', bg: 'FFCAEEFB' })
  }
  progRow(prog, excelDate(r.programme.start), 'Start On Site', 'dd/mm/yy;@')
  progRow(prog + 1, excelDate(r.programme.originalPc), 'Original PC', 'dd/mm/yy;@')
  progRow(prog + 2, f(`IF(OR(D${prog}="",D${prog + 1}=""),"",(D${prog + 1}-D${prog})/7)`, r.programme.originalWeeks), 'Original Duration', '0.00')
  progRow(prog + 4, excelDate(r.programme.revisedPc ?? r.programme.originalPc), 'PC date', 'dd/mm/yy;@')
  progRow(prog + 5, f(`IF(OR(D${prog + 1}="",D${prog + 4}=""),"",(D${prog + 4}-D${prog + 1})/7)`, r.programme.weeksDelay), 'Weeks Delay', '0.00')

  // ---- the two boxes: header A1:J7, body A8:J(end) ----
  const end = pc + 2
  for (let c = 1; c <= 10; c++) {
    border(ws.getRow(1).getCell(c), { top: thin })
    border(ws.getRow(7).getCell(c), { bottom: thin })
    border(ws.getRow(8).getCell(c), { top: thin })
    border(ws.getRow(tot + 5).getCell(c), { top: thin })
    border(ws.getRow(end).getCell(c), { bottom: thin })
  }
  for (let rr = 1; rr <= end; rr++) {
    border(ws.getRow(rr).getCell(1), { left: thin })
    border(ws.getRow(rr).getCell(10), { right: thin })
  }
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    printArea: `A1:J${end + 1}`,
    margins: { left: 0.39, right: 0.39, top: 0.59, bottom: 0.2, header: 0.2, footer: 0.2 },
  }

  await download(wb, `${safeName(`${job.job_no} ${job.code} - CVR ${cvr.period_end.split('-').reverse().join('.')}`)}.xlsx`)
}
