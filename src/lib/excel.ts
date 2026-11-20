// Shared Excel export helpers: A4 page set-up, the logo rule, downloads.
import type { Border, Borders, Cell, Workbook, Worksheet } from 'exceljs'

// ---------- logo: 60 × 15 mm, top right of the printed page ----------
// Each sheet prints at a fixed scale worked out from its column widths; the
// picture is sized to cancel that scale so it always prints 60 × 15 mm.
const MM_TO_PX = 96 / 25.4
const EMU_PER_PX = 9525
// A4 with 10 mm margins leaves 190 mm (portrait) / 277 mm (landscape), but printers lose
// some of it (the office Canon fits ~182 mm of 190), so plan for 10 mm less.
const PRINT_WIDTH_MM = { portrait: 180, landscape: 267 }
const MARGIN_IN = 10 / 25.4

// Calibri 11: about 7 px per character unit plus cell padding (measured in Excel).
function colPx(width: number) {
  return width * 7 + 4
}

// onePage: also shrink to fit the page height (single-page sheets such as front sheets)
export function setupPage(ws: Worksheet, widths: number[], lastRow: number, orientation: 'portrait' | 'landscape' = 'portrait', titleRows?: string, onePage = false) {
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  // a pixel more per column than measured, so the scale never spills onto a second page
  const sheetMm = widths.reduce((s, w) => s + colPx(w) + 1, 0) / MM_TO_PX
  let scale = Math.min(100, Math.floor((PRINT_WIDTH_MM[orientation] / sheetMm) * 100))
  if (onePage) {
    let heightPt = 0
    for (let r = 1; r <= lastRow; r++) heightPt += ws.getRow(r).height ?? 16
    const printHeightMm = (orientation === 'portrait' ? 297 : 210) - 30 // margins and printer loss
    scale = Math.min(scale, Math.floor((printHeightMm / ((heightPt * 25.4) / 72)) * 100))
  }
  const lastCol = ws.getColumn(widths.length).letter
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation,
    scale,
    fitToPage: false,
    printArea: `A1:${lastCol}${lastRow}`,
    ...(titleRows ? { printTitlesRow: titleRows } : {}),
    margins: { left: MARGIN_IN, right: MARGIN_IN, top: MARGIN_IN, bottom: MARGIN_IN, header: 0, footer: 0 },
  }
  return scale
}

export function placeLogo(ws: Worksheet, logoId: number, widths: number[], scale: number) {
  const w = (60 * MM_TO_PX * 100) / scale
  const h = (15 * MM_TO_PX * 100) / scale
  const pxWidths = widths.map(colPx)
  let left = pxWidths.reduce((s, x) => s + x, 0) - w - 4 // keep just inside the print area
  let col = 0
  while (col < pxWidths.length - 1 && left >= pxWidths[col]) left -= pxWidths[col++]
  ws.addImage(logoId, {
    tl: { nativeCol: col, nativeColOff: Math.round(Math.max(0, left) * EMU_PER_PX), nativeRow: 0, nativeRowOff: 0 } as never,
    ext: { width: w, height: h },
    editAs: 'oneCell',
  })
}

async function logoBase64() {
  const res = await fetch('/dbp-logo.png')
  const bytes = new Uint8Array(await res.arrayBuffer())
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

// ---------- small helpers ----------
export function excelDate(iso: string | null) {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function box(cell: Cell, side: Partial<Border> = { style: 'double' }) {
  cell.border = { top: side, bottom: side, left: side, right: side }
}

export function addBorder(cell: Cell, b: Partial<Borders>) {
  cell.border = { ...cell.border, ...b }
}

export function fill(cell: Cell, argb: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

// CAI refs are usually plain numbers; store those as numbers so Excel doesn't flag "number stored as text"
export function ref(v: string | null) {
  if (!v) return ''
  return /^\d+$/.test(v) ? Number(v) : v
}

export function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]/g, '').trim()
}

export async function download(wb: Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function newWorkbook() {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'du Boulay Projects'
  wb.calcProperties.fullCalcOnLoad = true
  const logoId = wb.addImage({ base64: await logoBase64(), extension: 'png' })
  return { wb, logoId }
}
