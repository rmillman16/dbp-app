// CVR to Excel, laid out as the 2609 KOSH CVR summary ("Interim Cost Value Reconciliation"):
// header and tender values, each package with its target, cost to date from iPlicit,
// forecast, still to come and overspend, then value, margin, programme and certified.
// Still to come, over target, totals, anticipated final value and margin are live formulas.
// A second sheet lists the iPlicit costs by supplier with the movement since last month.
import type { Cell, Worksheet } from 'exceljs'
import { download, excelDate, fill, newWorkbook, placeLogo, safeName, setupPage } from './excel'
import type { CvrResult } from './cvrCalc'
import type { SavedCostLine } from './cvr'
import type { Cvr, Job } from './types'

const GBP = '£#,##0.00;[Red]-£#,##0.00'
const GBP_BLANK0 = '£#,##0.00;[Red]-£#,##0.00;""' // blank when nothing (over target, VOs)
const gbp = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const PCT = '0.00%'
const DATE = 'dd/mm/yyyy'
const HEAD = 'FFDCE6F1'
const OMIT = 'FFF2F2F2'

function put(ws: Worksheet, addr: string, v: Cell['value'], o: { bold?: boolean; fmt?: string; size?: number; align?: 'right' | 'center' | 'left'; wrap?: boolean; italic?: boolean } = {}) {
  const c = ws.getCell(addr)
  c.value = v
  c.font = { name: 'Calibri', size: o.size ?? 10, bold: o.bold, italic: o.italic }
  if (o.fmt) c.numFmt = o.fmt
  if (o.align || o.wrap) c.alignment = { horizontal: o.align, vertical: 'top', wrapText: o.wrap }
  return c
}
const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }

export async function exportCvr(job: Job, cvr: Cvr, r: CvrResult, costs: SavedCostLine[]) {
  const { wb, logoId } = await newWorkbook()
  const ws = wb.addWorksheet('CVR', { views: [{ showGridLines: false }] })
  //               A    B   C   D   E   F   G   H   I
  const widths = [34, 34, 14, 13, 14, 14, 14, 13, 30]

  // ---- header (left of the logo) ----
  put(ws, 'A1', 'Interim Cost Value Reconciliation', { bold: true, size: 14 })
  put(ws, 'A3', 'Contract name:', { bold: true })
  put(ws, 'B3', job.name)
  put(ws, 'A4', 'Job no:', { bold: true })
  put(ws, 'B4', `${job.job_no} ${job.code}`)
  put(ws, 'A5', 'Cost as at:', { bold: true })
  put(ws, 'B5', excelDate(cvr.period_end), { fmt: DATE, align: 'left' })
  put(ws, 'A6', 'Date prepared:', { bold: true })
  put(ws, 'B6', excelDate(cvr.prepared_date), { fmt: DATE, align: 'left' })
  put(ws, 'D5', 'Tender values', { bold: true })
  put(ws, 'D6', 'Order value')
  put(ws, 'F6', r.tender.contractSum, { fmt: GBP })
  put(ws, 'D7', "Overh'd & profit")
  put(ws, 'F7', r.tender.ohp, { fmt: GBP })
  put(ws, 'G7', { formula: 'IF(F6=0,0,F7/F6)', result: r.tender.ohpPct }, { fmt: PCT })
  put(ws, 'A7', 'Status:', { bold: true })
  put(ws, 'B7', cvr.status === 'final' ? 'Final' : 'Draft')

  // ---- packages ----
  const H = 9
  const heads = ['Package', 'Target from / supplier', 'Target', 'Agreed VOs (in target)', 'Cost to date (iPlicit)', 'Forecast final cost', 'Still to come', 'Over target', 'Notes']
  heads.forEach((h, i) => {
    const c = put(ws, `${String.fromCharCode(65 + i)}${H}`, h, { bold: true, wrap: true, align: i >= 2 && i <= 7 ? 'right' : undefined })
    fill(c, HEAD)
    c.border = { bottom: thin }
  })
  ws.getRow(H).height = 30
  let row = H + 1
  const first = row
  const line = (name: string, from: string, target: number | null, vo: number | null, cost: number, forecast: number, note: string, omit = false, bad = false) => {
    put(ws, `A${row}`, name, { wrap: true, bold: bad })
    put(ws, `B${row}`, from, { wrap: true, size: 9 })
    put(ws, `C${row}`, target, { fmt: GBP })
    put(ws, `D${row}`, vo || null, { fmt: GBP_BLANK0 })
    put(ws, `E${row}`, cost, { fmt: GBP })
    put(ws, `F${row}`, forecast, { fmt: GBP })
    put(ws, `G${row}`, { formula: `F${row}-E${row}`, result: forecast - cost }, { fmt: GBP })
    put(ws, `H${row}`, omit || target == null ? null : { formula: `IF(F${row}>C${row},F${row}-C${row},0)`, result: Math.max(0, forecast - target) }, { fmt: GBP_BLANK0 })
    put(ws, `I${row}`, note || null, { wrap: true, size: 9 })
    for (let c = 1; c <= 9; c++) ws.getRow(row).getCell(c).border = { bottom: thin }
    if (omit) for (let c = 1; c <= 9; c++) fill(ws.getRow(row).getCell(c), OMIT)
    row++
  }
  for (const p of r.packages) {
    const from = [p.sourceNote, p.suppliers.length ? `Costs: ${p.suppliers.join(', ')}` : '', p.supplierNote ?? ''].filter(Boolean).join(' · ')
    const note = [p.forecastNote, p.overrun ? `Over target by ${gbp(p.overrun)}` : ''].filter(Boolean).join(' · ')
    if (p.kind === 'omit') line(`${p.name} (omitted: ${gbp(p.budget)})`, 'Shown and omitted', 0, null, p.cost, p.forecast, note, true)
    else line(p.name, from, p.target, p.voCost, p.cost, p.forecast, note, false, p.overrun > 0)
  }
  for (const v of r.unallocatedVos) line(v.label, 'Agreed VO, no package', v.cost, v.cost, 0, v.cost, 'Allocate to a package')
  if (r.unallocatedCost) line('Costs not yet allocated to a package', 'iPlicit', null, null, r.unallocatedCost, r.unallocatedCost, 'See the Costs sheet')
  const last = row - 1
  const tot = row
  put(ws, `A${tot}`, 'Total', { bold: true })
  for (const col of ['C', 'D', 'E', 'F', 'G', 'H']) {
    const c = put(ws, `${col}${tot}`, { formula: `SUM(${col}${first}:${col}${last})` }, { fmt: col === 'D' || col === 'H' ? GBP_BLANK0 : GBP, bold: true })
    c.border = { top: thin, bottom: { style: 'double' } }
  }

  // ---- value and margin ----
  row = tot + 2
  const label = (t: string, bold = false) => put(ws, `D${row}`, t, { bold })
  label('Total cost (forecast)', true)
  put(ws, `F${row}`, { formula: `F${tot}`, result: r.totalCost }, { fmt: GBP, bold: true })
  const costRow = row
  row += 2
  label('Contract sum')
  put(ws, `F${row}`, r.value.contractSum, { fmt: GBP })
  const csRow = row++
  label('Agreed variations')
  put(ws, `F${row}`, r.value.agreedVos, { fmt: GBP })
  row++
  label('Possible reduction / negotiations')
  put(ws, `F${row}`, r.value.possibleReduction, { fmt: GBP })
  const prRow = row++
  label('Anticipated final value', true)
  put(ws, `F${row}`, { formula: `SUM(F${csRow}:F${prRow})`, result: r.value.afv }, { fmt: GBP, bold: true })
  const afvRow = row
  row += 2
  label('Gross margin', true)
  put(ws, `F${row}`, { formula: `F${afvRow}-F${costRow}`, result: r.margin }, { fmt: GBP, bold: true })
  const mRow = row++
  label('Gross margin % on sales', true)
  put(ws, `F${row}`, { formula: `IF(F${afvRow}=0,0,F${mRow}/F${afvRow})`, result: r.marginPct }, { fmt: PCT, bold: true })

  // ---- programme and certified (left, alongside) ----
  let p = tot + 2
  const prog = (t: string, v: Cell['value'], fmt?: string) => {
    put(ws, `A${p}`, t)
    put(ws, `B${p}`, v, { fmt, align: 'left' })
    p++
  }
  prog('Start on site', excelDate(r.programme.start), DATE)
  prog('Original PC', excelDate(r.programme.originalPc), DATE)
  prog('Original duration (weeks)', r.programme.originalWeeks)
  prog('PC date (with EOT granted)', excelDate(r.programme.revisedPc), DATE)
  prog('Weeks delay', r.programme.weeksDelay)
  p++
  prog('Gross certified to date', r.certified?.gross ?? 'No assessed application', r.certified ? GBP : undefined)
  prog('Retention held', r.certified?.retention ?? null, GBP)
  if (r.certified) prog('From', r.certified.label)
  const end = Math.max(row, p)
  if (r.warnings.length) {
    put(ws, `A${end + 2}`, 'Checks', { bold: true })
    r.warnings.forEach((w, i) => {
      ws.mergeCells(`A${end + 3 + i}:I${end + 3 + i}`)
      put(ws, `A${end + 3 + i}`, w, { size: 9, italic: true, wrap: true })
    })
  }
  if (cvr.notes) {
    const n = end + 4 + r.warnings.length
    put(ws, `A${n}`, 'Notes', { bold: true })
    ws.mergeCells(`A${n + 1}:I${n + 3}`)
    put(ws, `A${n + 1}`, cvr.notes, { wrap: true })
  }
  const lastRow = ws.rowCount
  placeLogo(ws, logoId, widths, setupPage(ws, widths, lastRow, 'landscape', `${H}:${H}`))

  // ---- costs by supplier ----
  const cs = wb.addWorksheet('Costs', { views: [{ showGridLines: false }] })
  const cw = [10, 36, 30, 12, 12, 12, 12, 13, 13, 13]
  put(cs, 'A1', `iPlicit costs as at ${cvr.period_end.split('-').reverse().join('/')}`, { bold: true, size: 13 })
  const ch = ['Code', 'Supplier', 'Package', 'Invoiced', 'Committed', 'Unposted', 'Provisions', 'Final total costs', 'Last CVR', 'Movement']
  ch.forEach((h, i) => {
    const c = put(cs, `${String.fromCharCode(65 + i)}5`, h, { bold: true, wrap: true, align: i >= 3 ? 'right' : undefined })
    fill(c, HEAD)
  })
  cs.getRow(5).height = 30
  let cr = 6
  for (const l of costs) {
    const s = r.suppliers.find((x) => x.code === l.supplier_code && x.name === l.supplier_name)
    put(cs, `A${cr}`, l.supplier_code)
    put(cs, `B${cr}`, l.supplier_name)
    put(cs, `C${cr}`, s?.packages.map((x) => `${x.name}${x.share < 1 ? ` ${Math.round(x.share * 100)}%` : ''}`).join(', ') || 'not allocated', { size: 9, wrap: true })
    put(cs, `D${cr}`, l.invoiced == null ? null : Number(l.invoiced), { fmt: GBP })
    put(cs, `E${cr}`, l.committed == null ? null : Number(l.committed), { fmt: GBP })
    put(cs, `F${cr}`, l.unposted == null ? null : Number(l.unposted), { fmt: GBP })
    put(cs, `G${cr}`, l.provisions == null ? null : Number(l.provisions), { fmt: GBP })
    put(cs, `H${cr}`, Number(l.total_cost ?? 0), { fmt: GBP })
    put(cs, `I${cr}`, s?.previous ?? null, { fmt: GBP })
    put(cs, `J${cr}`, s?.previous == null ? null : { formula: `H${cr}-I${cr}`, result: s.movement ?? 0 }, { fmt: GBP })
    for (let c = 1; c <= 10; c++) cs.getRow(cr).getCell(c).border = { bottom: thin }
    cr++
  }
  put(cs, `B${cr}`, 'Total', { bold: true })
  for (const col of ['D', 'E', 'F', 'G', 'H', 'I', 'J']) put(cs, `${col}${cr}`, { formula: `SUM(${col}6:${col}${cr - 1})` }, { fmt: GBP, bold: true })
  placeLogo(cs, logoId, cw, setupPage(cs, cw, cr, 'landscape', '5:5'))

  await download(wb, `${safeName(`${job.job_no} ${job.code} - CVR ${cvr.period_end.split('-').reverse().join('.')}`)}.xlsx`)
}
