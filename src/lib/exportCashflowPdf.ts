// The cashflow as a report (24 Nov), designed like the progress report: a cover, a summary page with status tiles, the key
// points and the S-curve, then numbered sections (1 Forecast by month, 2 By trade, 3 Applications to date, 4 Issued variations
// at risk) and the basis it was built on. One PDF, built in the browser with pdf-lib (nothing is uploaded). Carlito, as the
// progress report, with Helvetica as the fall-back. A4 portrait.
// The same two copies as the Excel (decided 19 Nov): internal adds DBP's applied figure and the margin / contract-sum
// adjustment rows and EP; the client copy shows certified and paid only, with those rows as one "Allowances and adjustments".
import type { PDFFont, PDFPage } from 'pdf-lib'
import type { CashflowExport } from './exportCashflow'
import { todayIso, ukDate } from './format'
import type { CashflowItem } from './cashflow'
import { safeName } from './excel'

const W = 595.28
const H = 841.89
const M = 50
const CW = W - 2 * M
const NAVY = '#1f1246'
const BLUE = '#007abe'
const INK = '#1d1d24'
const MUTED = '#6b6b78'
const LINE = '#d9d9e0'
const SHADE = '#eef3fa'
const AMBER = '#b26a00'
const FONTS = ['/minutes/fonts/Carlito-Regular.ttf', '/minutes/fonts/Carlito-Bold.ttf', '/minutes/fonts/Carlito-Italic.ttf']
const SPECIAL = new Map<number, string>([[0x2013, '-'], [0x2014, '-'], [0x2018, "'"], [0x2019, "'"], [0x201c, '"'], [0x201d, '"'], [0x2026, '...'], [0x2022, '-'], [0x2192, '->'], [0x26a0, '!']])
function winAnsi(s: string) {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || c === 10) out += ch
    else out += c === 9 ? ' ' : (SPECIAL.get(c) ?? '?')
  }
  return out
}

const gbp = (n: number | null | undefined) => {
  if (n == null || Math.abs(n) < 0.5) return n == null ? '' : '-'
  const t = `£${Math.abs(Math.round(n)).toLocaleString('en-GB')}`
  return n < 0 ? `(${t})` : t
}
const short = (n: number) => (Math.abs(n) >= 1e6 ? `£${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}m` : Math.abs(n) >= 1e3 ? `£${Math.round(n / 1e3)}k` : `£${Math.round(n)}`)
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const monthLong = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export interface CashflowPdfArgs extends CashflowExport {
  preparedBy: string
  clientName: string | null
}

export async function exportCashflowPdf(a: CashflowPdfArgs) {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
  const { job, items, result, actuals, siteStart, pc, programmeName, copy } = a
  const internal = copy === 'internal'
  const doc = await PDFDocument.create()
  const hex = (h: string) => {
    const x = h.replace('#', '')
    return rgb(parseInt(x.slice(0, 2), 16) / 255, parseInt(x.slice(2, 4), 16) / 255, parseInt(x.slice(4, 6), 16) / 255)
  }
  doc.setTitle(`${job.job_no} ${job.code} ${job.name}: Cashflow forecast`)
  doc.setCreator('DBP app')

  let regular: PDFFont, bold: PDFFont, italic: PDFFont
  let clean = (s: string) => s.replace(/\t/g, ' ')
  try {
    const [{ default: fontkit }, bytes] = await Promise.all([import('@pdf-lib/fontkit'), Promise.all(FONTS.map((u) => fetch(u).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(u))))))])
    doc.registerFontkit(fontkit)
    ;[regular, bold, italic] = await Promise.all(bytes.map((b) => doc.embedFont(new Uint8Array(b), { subset: false })))
    clean = (s) => s.replace(/\t/g, ' ').replace(/[⚠✓✔]/g, '')
  } catch {
    ;[regular, bold, italic] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold), doc.embedFont(StandardFonts.HelveticaOblique)])
    clean = winAnsi
  }
  const fontOf = { regular, bold, italic }

  // ---------- the layout engine (as the progress report's) ----------
  const own: PDFPage[] = []
  let page!: PDFPage
  let y = 0
  const title = `Cashflow forecast${internal ? ' (internal)' : ''}`
  const header = () => {
    page.drawText(clean(`${job.job_no} ${job.code} · ${job.name}`), { x: M, y: H - 30, size: 8, font: regular, color: hex(MUTED) })
    const r = clean(title)
    page.drawText(r, { x: W - M - regular.widthOfTextAtSize(r, 8), y: H - 30, size: 8, font: regular, color: hex(MUTED) })
    page.drawLine({ start: { x: M, y: H - 36 }, end: { x: W - M, y: H - 36 }, thickness: 0.5, color: hex(LINE) })
  }
  const newPage = (withHeader = true) => {
    page = doc.addPage([W, H])
    own.push(page)
    y = H - 60
    if (withHeader) header()
  }
  const ensure = (h: number) => {
    if (y - h < 60) newPage()
  }
  const wrap = (t: string, width: number, size: number, f: PDFFont) => {
    const out: string[] = []
    for (const para of clean(t).split('\n')) {
      let line = ''
      for (const w of para.split(' ')) {
        const x = line ? `${line} ${w}` : w
        if (f.widthOfTextAtSize(x, size) <= width) line = x
        else {
          if (line) out.push(line)
          line = w
        }
      }
      out.push(line)
    }
    return out
  }
  const text = (s: string, o: { size?: number; font?: 'regular' | 'bold' | 'italic'; color?: string; gap?: number } = {}) => {
    if (!s.trim()) return
    const size = o.size ?? 10
    for (const ln of wrap(s, CW, size, fontOf[o.font ?? 'regular'])) {
      ensure(size + 4)
      y -= size + 4
      page.drawText(ln, { x: M, y, size, font: fontOf[o.font ?? 'regular'], color: hex(o.color ?? INK) })
    }
    y -= o.gap ?? 8
  }
  const bullets = (list: string[]) => {
    for (const it of list.filter((x) => x.trim())) {
      const lines = wrap(it, CW - 16, 10, regular)
      ensure(lines.length * 14 + 3)
      y -= 14
      page.drawText('-', { x: M + 4, y, size: 10, font: bold, color: hex(NAVY) })
      lines.forEach((ln, i) => {
        if (i) y -= 14
        page.drawText(ln, { x: M + 16, y, size: 10, font: regular, color: hex(INK) })
      })
      y -= 3
    }
    y -= 8
  }
  const h1 = (n: string, t: string) => {
    ensure(90)
    y -= 34
    page.drawText(clean(n ? `${n}  ${t}` : t), { x: M, y, size: 15, font: bold, color: hex(NAVY) })
    page.drawLine({ start: { x: M, y: y - 7 }, end: { x: M + CW, y: y - 7 }, thickness: 1.5, color: hex(BLUE) })
    y -= 12
  }
  const h2 = (n: string, t: string) => {
    ensure(60)
    y -= 18
    page.drawText(clean(n ? `${n}  ${t}` : t), { x: M, y: y - 8, size: 11.5, font: bold, color: hex(NAVY) })
    page.drawLine({ start: { x: M, y: y - 13 }, end: { x: M + 48, y: y - 13 }, thickness: 2, color: hex(BLUE) })
    y -= 24
  }
  // a table: text left-aligned in the first column, figures right-aligned in the others; bold rows for totals
  const table = (head: string[], rows: { cells: string[]; bold?: boolean; shade?: boolean; color?: string }[], widths: number[]) => {
    if (!rows.length) return
    const sc = CW / widths.reduce((s, w) => s + w, 0)
    const ws = widths.map((w) => w * sc)
    const put = (t: string, i: number, x: number, size: number, f: PDFFont, color: string, yy: number) => {
      const s = clean(t)
      const tx = i === 0 ? x + 3 : x + ws[i] - 4 - f.widthOfTextAtSize(s, size)
      page.drawText(s, { x: tx, y: yy, size, font: f, color: hex(color) })
    }
    const drawHead = () => {
      ensure(30)
      y -= 14
      page.drawRectangle({ x: M, y: y - 4, width: CW, height: 16, color: hex(SHADE) })
      let x = M
      head.forEach((h, i) => {
        put(h, i, x, 8.5, bold, NAVY, y)
        x += ws[i]
      })
      y -= 4
    }
    drawHead()
    for (const r of rows) {
      const rowH = 15
      if (y - rowH < 60) {
        newPage()
        drawHead()
      }
      if (r.shade) page.drawRectangle({ x: M, y: y - rowH + 2, width: CW, height: rowH, color: hex(SHADE) })
      let x = M
      r.cells.forEach((c, i) => {
        // long labels are trimmed to their column
        let t = c
        while (i === 0 && t.length > 3 && (r.bold ? bold : regular).widthOfTextAtSize(clean(t), 9) > ws[0] - 8) t = t.slice(0, -2)
        put(t === c ? c : `${t.trimEnd()}...`, i, x, 9, r.bold ? bold : regular, r.color ?? INK, y - 11)
        x += ws[i]
      })
      y -= rowH
      page.drawLine({ start: { x: M, y: y + 1 }, end: { x: M + CW, y: y + 1 }, thickness: 0.4, color: hex(LINE) })
    }
    y -= 14
  }

  // ---------- the numbers ----------
  const months = [...new Set([...result.months, ...actuals.map((m) => m.month)])].sort()
  const monthly = result.monthly
  const rowOf = new Map(result.rows.map((r) => [r.key, r]))
  const internalOnly = (i: CashflowItem) => i.kind === 'adjust' || /^ep\b|contingency/i.test(i.label)
  const shown = items.filter((i) => i.kind !== 'vo_risk' && (internal || !internalOnly(i)))
  const adjust = items.filter((i) => i.kind !== 'vo_risk' && internalOnly(i))
  const risk = items.filter((i) => i.kind === 'vo_risk')
  const peak = monthly.reduce<(typeof monthly)[number] | null>((p, m) => (!p || m.value > p.value ? m : p), null)
  const heldMax = Math.abs(Math.min(0, ...monthly.map((m) => m.retention)))
  const netTotal = monthly.length ? monthly[monthly.length - 1].netCumulative : 0
  const byA = new Map(actuals.map((x) => [x.month, x]))
  const firstMonth = monthly[0]?.month
  const lastMonth = monthly[monthly.length - 1]?.month

  // ---------- cover ----------
  newPage(false)
  try {
    const r = await fetch('/dbp-logo.png')
    if (r.ok) {
      const logo = await doc.embedPng(new Uint8Array(await r.arrayBuffer()))
      const s = 170 / logo.width
      page.drawImage(logo, { x: M, y: H - 60 - logo.height * s, width: logo.width * s, height: logo.height * s })
    }
  } catch {
    /* no logo: carry on */
  }
  y = H - 300
  page.drawText('Cashflow forecast', { x: M, y, size: 30, font: bold, color: hex(NAVY) })
  y -= 34
  page.drawText(clean(`${job.job_no} ${job.code}`), { x: M, y, size: 15, font: regular, color: hex(BLUE) })
  y -= 26
  for (const ln of wrap(job.name, CW, 22, bold)) {
    page.drawText(ln, { x: M, y, size: 22, font: bold, color: hex(INK) })
    y -= 26
  }
  if (job.site_address) {
    for (const ln of wrap(job.site_address.replace(/\n/g, ', '), CW, 12, regular)) {
      page.drawText(ln, { x: M, y, size: 12, font: regular, color: hex(MUTED) })
      y -= 16
    }
  }
  y -= 40
  const coverRows: [string, string][] = [
    ['Client', a.clientName ?? ''],
    ['Prepared by', a.preparedBy],
    ['Date', ukDate(todayIso())],
    ['Basis', 'Excl. VAT, valuations at month end'],
    ['Copy', internal ? 'Internal: not for the client' : 'Client copy'],
  ]
  for (const [k, v] of coverRows.filter(([, v]) => v.trim())) {
    page.drawText(clean(k), { x: M, y, size: 11, font: bold, color: hex(MUTED) })
    page.drawText(clean(v), { x: M + 110, y, size: 11, font: regular, color: hex(internal && k === 'Copy' ? AMBER : INK) })
    y -= 20
  }
  page.drawText('du Boulay Projects Limited', { x: M, y: 60, size: 9, font: regular, color: hex(MUTED) })

  // ---------- summary: tiles, the S-curve and the key points ----------
  newPage()
  h1('', 'Summary')
  const tiles: [string, string, string][] = [
    ['Forecast total', gbp(result.total), job.contract_sum != null ? `Contract sum ${gbp(Number(job.contract_sum))}` : ''],
    ['Programme', `${siteStart ? ukDate(siteStart) : 'Start not set'} to ${pc ? ukDate(pc) : 'PC not set'}`, programmeName ? `From the programme "${programmeName}"` : 'From the job dates'],
    ['Busiest month', peak ? monthLong(peak.month) : 'Not available', peak ? gbp(peak.value) : ''],
    ['Retention', `${Number(job.retention_pct ?? 0)}%${pc ? ', halved from PC' : ''}`, heldMax ? `Up to ${gbp(heldMax)} held` : ''],
    ['Payment after retention', gbp(netTotal), 'Cumulative, excl. VAT'],
    ['Issued variations at risk', result.atRiskTotal ? gbp(result.atRiskTotal) : 'None', result.atRiskTotal ? 'Not agreed: not in the totals' : ''],
  ]
  const tw = (CW - 20) / 3
  const ty = y - 10
  tiles.forEach(([t, big, small], i) => {
    const x = M + (i % 3) * (tw + 10)
    const yy = ty - Math.floor(i / 3) * 86
    page.drawRectangle({ x, y: yy - 74, width: tw, height: 74, color: hex(SHADE) })
    page.drawText(clean(t), { x: x + 8, y: yy - 16, size: 9, font: bold, color: hex(MUTED) })
    wrap(big, tw - 16, 12, bold).slice(0, 2).forEach((ln, k) => page.drawText(ln, { x: x + 8, y: yy - 34 - k * 14, size: 12, font: bold, color: hex(NAVY) }))
    wrap(small, tw - 16, 8.5, regular).slice(0, 2).forEach((ln, k) => page.drawText(ln, { x: x + 8, y: yy - 62 - k * 10, size: 8.5, font: regular, color: hex(INK) }))
  })
  y = ty - 2 * 86 - 4

  // the S-curve: each month's valuation as a bar, the cumulative as a line, certified to date as dots
  h2('', 'Cumulative valuation')
  const cx = M + 44
  const cw = CW - 52
  const chH = 170
  const top = y - 4
  const base = top - chH
  const maxV = Math.max(result.total + result.atRiskTotal * 0, ...monthly.map((m) => m.cumulative), 1)
  const step = (() => {
    const raw = maxV / 4
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)))
    return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? raw
  })()
  const yOf = (v: number) => base + (v / (step * 4)) * chH
  for (let k = 0; k <= 4; k++) {
    const gy = yOf(step * k)
    page.drawLine({ start: { x: cx, y: gy }, end: { x: cx + cw, y: gy }, thickness: 0.4, color: hex(LINE) })
    const lab = short(step * k)
    page.drawText(lab, { x: cx - 6 - regular.widthOfTextAtSize(lab, 8), y: gy - 3, size: 8, font: regular, color: hex(MUTED) })
  }
  const n = Math.max(monthly.length, 1)
  const slot = cw / n
  monthly.forEach((m, k) => {
    const bh = yOf(Math.max(0, m.value)) - base
    page.drawRectangle({ x: cx + k * slot + slot * 0.2, y: base, width: slot * 0.6, height: bh, color: hex('#cfe3f3') })
  })
  const pts = monthly.map((m, k) => ({ x: cx + k * slot + slot / 2, y: yOf(m.cumulative) }))
  for (let k = 1; k < pts.length; k++) page.drawLine({ start: pts[k - 1], end: pts[k], thickness: 2, color: hex(NAVY) })
  // what has been certified so far (cumulative), where there are applications
  let cert = 0
  let sawCert = false
  monthly.forEach((m, k) => {
    const ac = byA.get(m.month)
    if (ac?.certified != null) {
      cert += ac.certified
      sawCert = true
    }
    if (sawCert && ac?.certified != null) page.drawCircle({ x: cx + k * slot + slot / 2, y: yOf(cert), size: 3.2, color: hex('#d4572a') })
  })
  const every = Math.ceil(n / 12)
  monthly.forEach((m, k) => {
    if (k % every) return
    const lab = monthLabel(m.month)
    page.drawText(lab, { x: cx + k * slot + slot / 2 - regular.widthOfTextAtSize(lab, 7.5) / 2, y: base - 12, size: 7.5, font: regular, color: hex(MUTED) })
  })
  y = base - 22
  text(`Bars: each month's valuation. Line: cumulative.${sawCert ? ' Dots: certified to date.' : ''}`, { size: 8.5, color: MUTED })

  h2('', 'Key points')
  const points: string[] = []
  if (monthly.length) points.push(`${monthly.length} months of valuations, ${monthLong(firstMonth!)} to ${monthLong(lastMonth!)}, forecasting ${gbp(result.total)} excl. VAT.`)
  if (peak) points.push(`The busiest month is ${monthLong(peak.month)}, at ${gbp(peak.value)}.`)
  if (heldMax) points.push(`Retention at ${Number(job.retention_pct ?? 0)}% builds to ${gbp(heldMax)}${pc ? `, then halves at practical completion (${ukDate(pc)})` : ''}.`)
  if (result.atRiskTotal) points.push(`${gbp(result.atRiskTotal)} of issued variations is not yet agreed and is not in these figures.`)
  if (internal && result.unplaced >= 1) points.push(`${gbp(result.unplaced)} is not yet placed in a month.`)
  if (sawCert) points.push(`${gbp(cert)} has been certified to date, from ${actuals.filter((x) => x.certified != null).length} application${actuals.filter((x) => x.certified != null).length === 1 ? '' : 's'}.`)
  bullets(points)

  // ---------- 1 Forecast by month ----------
  h1('1', 'Forecast by month')
  text('What we will apply for each month, excl. VAT, with valuations at month end.', { color: MUTED, size: 9 })
  const hasPast = actuals.length > 0
  const head1 = ['Month', 'Valuation', 'Cumulative', 'Cum. %', 'Retention held', 'Payment after retention']
  const rows1 = monthly.map((m) => ({ cells: [monthLabel(m.month), gbp(m.value), gbp(m.cumulative), `${(m.cumPct * 100).toFixed(1)}%`, gbp(m.retention), gbp(m.netMonth)], shade: false }))
  rows1.push({ cells: ['Total', gbp(result.total), '', '', gbp(monthly[monthly.length - 1]?.retention ?? 0), gbp(netTotal)], shade: true, bold: true } as never)
  table(head1, rows1 as never, [70, 82, 82, 52, 82, 92])

  // ---------- 2 By trade ----------
  h1('2', 'By trade')
  text(internal ? 'Every package, with the months its value falls in. Percentages are of the forecast total.' : 'Each trade, with the months its value falls in. Percentages are of the forecast total.', { color: MUTED, size: 9 })
  const span = (vals: number[]) => {
    const k = vals.map((v, i) => (Math.abs(v) >= 0.5 ? i : -1)).filter((i) => i >= 0)
    return k.length ? (k[0] === k[k.length - 1] ? monthLabel(result.months[k[0]]) : `${monthLabel(result.months[k[0]])} to ${monthLabel(result.months[k[k.length - 1]])}`) : ''
  }
  const tradeRows: { cells: string[]; bold?: boolean; shade?: boolean }[] = []
  let group = ''
  const pct = (v: number) => (result.total ? `${((v / result.total) * 100).toFixed(1)}%` : '')
  for (const it of shown) {
    if (it.group !== group) {
      group = it.group
      tradeRows.push({ cells: [group.toUpperCase(), '', '', ''], bold: true, shade: true })
    }
    const r = rowOf.get(it.key)
    if (!r || (Math.abs(r.value) < 0.5 && !it.parent)) continue
    tradeRows.push({ cells: [`${it.parent ? '   ' : ''}${it.label}`, gbp(r.value), pct(r.value), span(r.months)] })
  }
  if (!internal && adjust.length) {
    const sum = result.months.map((_, k) => adjust.reduce((s, x) => s + (rowOf.get(x.key)?.months[k] ?? 0), 0))
    const v = sum.reduce((s, x) => s + x, 0)
    if (Math.abs(v) >= 0.5) tradeRows.push({ cells: ['Allowances and adjustments', gbp(v), pct(v), span(sum)] })
  }
  tradeRows.push({ cells: ['Total', gbp(result.total), '100%', ''], bold: true, shade: true })
  table(['Trade', 'Value', '% of total', 'Months'], tradeRows, [210, 80, 56, 140])

  // ---------- 3 Applications to date ----------
  let n3 = 2
  if (hasPast) {
    n3++
    h1(String(n3), 'Applications to date')
    text(internal ? 'What was applied for, certified and paid, from the applications (gross, excl. VAT).' : 'What has been certified and paid, from the applications (gross, excl. VAT).', { color: MUTED, size: 9 })
    const head3 = internal ? ['Month', 'Application', 'Applied', 'Certified', 'Paid'] : ['Month', 'Application', 'Certified', 'Paid']
    const rows3 = months
      .filter((m) => byA.has(m))
      .map((m) => {
        const x = byA.get(m)!
        return { cells: internal ? [monthLabel(m), x.label, gbp(x.applied), gbp(x.certified), gbp(x.paid)] : [monthLabel(m), x.label, gbp(x.certified), gbp(x.paid)] }
      })
    table(head3, rows3, internal ? [60, 120, 90, 90, 90] : [70, 150, 110, 110])
  }

  // ---------- Issued variations at risk ----------
  if (risk.length) {
    n3++
    h1(String(n3), 'Issued variations at risk')
    text('Issued but not yet agreed. They are not in the totals above.', { color: MUTED, size: 9 })
    table(
      ['Variation', 'Value', 'Months'],
      risk.map((it) => {
        const r = rowOf.get(it.key)
        return { cells: [it.label, gbp(r?.value ?? 0), r ? span(r.months) : ''] }
      }),
      [260, 90, 140],
    )
  }

  // ---------- the basis ----------
  h1(String(++n3), 'Basis')
  bullets([
    'All figures are excl. VAT, with valuations at month end.',
    siteStart || pc ? `Start on site ${siteStart ? ukDate(siteStart) : 'not set'}, practical completion ${pc ? ukDate(pc) : 'not set'}${programmeName ? ` (from the programme "${programmeName}")` : ''}.` : 'Dates are taken from the job.',
    `Retention at ${Number(job.retention_pct ?? 0)}%${pc ? ', halved from practical completion' : ''}.`,
    'A forecast is a forecast: it moves with the programme and with what is instructed.',
    ...(internal ? [] : ['Allowances and adjustments are shown together as one line.']),
  ])

  // ---------- footers (not on the cover) ----------
  own.forEach((p, i) => {
    if (i === 0) return
    const t = clean(`du Boulay Projects Limited · Page ${i + 1} of ${own.length}`)
    p.drawText(t, { x: W / 2 - regular.widthOfTextAtSize(t, 8) / 2, y: 28, size: 8, font: regular, color: hex(MUTED) })
  })

  const bytes = await doc.save()
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  const d = new Date().toLocaleDateString('en-GB').replace(/\//g, '.')
  link.download = `${safeName(`${job.job_no} ${job.code} - Cashflow report${internal ? ' (internal)' : ''} ${d}`)}.pdf`
  link.click()
  URL.revokeObjectURL(link.href)
}
