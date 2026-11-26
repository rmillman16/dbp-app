// The summary programme as a PDF snapshot (26 Nov): one button, downloads straight away, nothing is stored.
// Each section is one bar (first start to last finish) with the key dates (milestones) above; the bigger the programme, the more
// it shows: a small job is one page of sections and key dates, a big one runs to as many as four pages with the main tasks listed
// under each section. Drawn directly (pdf-lib) rather than printed, so it is a real file, not the browser's print dialog.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import type { TLState, TLTask } from './timelineFormat'
import { fromISO, taskEndDate } from './timelineDates'
import { summarise } from './programmeViews'

const W = 841.89 // A4 landscape, points
const H = 595.28
const M = 28
const LABEL_W = 230
const ROW = 17
const AXIS_H = 30
const FIRST_TOP = 78 // room for the heading on the first page
const NEXT_TOP = 46
const FOOT = 26
const MAX_PAGES = 4
const BLUE = rgb(0, 0.478, 0.745)
const NAVY = rgb(0.122, 0.071, 0.275)
const GREY = rgb(0.42, 0.44, 0.52)
const LINE = rgb(0.86, 0.87, 0.91)

type Row = { kind: 'ms' | 'sec' | 'task'; label: string; start: Date; end: Date }

// the standard PDF fonts hold Latin-1 only: keep what they can show
const safe = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
const ukShort = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fit(font: PDFFont, text: string, size: number, width: number) {
  let t = safe(text)
  if (font.widthOfTextAtSize(t, size) <= width) return t
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > width) t = t.slice(0, -1)
  return t.trimEnd() + '...'
}

// the rows: key dates, then each section as a bar with (when there is room) its longest tasks beneath
export function summaryRows(state: TLState, perSection: number): Row[] {
  const s = summarise(state, false)
  const rows: Row[] = s.tasks.filter((t) => t.groupId === 'key-dates').map((t) => ({ kind: 'ms' as const, label: t.name || 'Milestone', start: fromISO(t.start), end: fromISO(t.start) }))
  const work = state.tasks.filter((t) => !t.milestone)
  const buckets: { name: string; tasks: TLTask[] }[] = state.groups.map((g) => ({ name: g.name, tasks: work.filter((t) => t.groupId === g.id) }))
  const loose = work.filter((t) => !t.groupId || !state.groups.some((g) => g.id === t.groupId))
  if (loose.length) buckets.push({ name: state.groups.length ? 'Other works' : 'Works', tasks: loose })
  for (const b of buckets.filter((x) => x.tasks.length)) {
    const ends = b.tasks.map((t) => taskEndDate(state, t))
    rows.push({ kind: 'sec', label: b.name, start: fromISO(b.tasks.map((t) => t.start).sort()[0]), end: new Date(Math.max(...ends.map((d) => d.getTime()))) })
    if (perSection > 0 && b.tasks.length > 1) {
      const top = [...b.tasks].sort((a, c) => c.duration - a.duration).slice(0, perSection).sort((a, c) => a.start.localeCompare(c.start))
      for (const t of top) rows.push({ kind: 'task', label: t.name, start: fromISO(t.start), end: taskEndDate(state, t) })
    }
  }
  return rows
}

// how much to show: the bigger the programme the more pages (1 to 4), and as many main tasks per section as fit
export function planSummary(state: TLState) {
  const work = state.tasks.filter((t) => !t.milestone).length
  const perPage = (n: number) => Math.floor((H - (n === 1 ? FIRST_TOP : NEXT_TOP) - AXIS_H - FOOT) / ROW)
  const capacity = (pages: number) => perPage(1) + (pages - 1) * perPage(2)
  const wanted = Math.min(MAX_PAGES, Math.max(1, Math.ceil(work / 40)))
  for (let pages = wanted; pages <= MAX_PAGES; pages++) {
    for (const k of [3, 2, 1, 0]) {
      const rows = summaryRows(state, k)
      if (rows.length <= capacity(pages)) return { rows, pages: Math.max(1, Math.ceil((rows.length - perPage(1)) / perPage(2)) + 1) }
    }
  }
  const rows = summaryRows(state, 0).slice(0, capacity(MAX_PAGES))
  return { rows, pages: MAX_PAGES }
}

export async function summaryProgrammePdf(state: TLState, o: { title: string; subtitle?: string; revision?: string; logoUrl?: string }): Promise<Blob> {
  const { rows } = planSummary(state)
  if (!rows.length) throw new Error('There are no tasks to summarise yet.')
  const doc = await PDFDocument.create()
  const reg = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let logo: PDFImage | null = null
  if (o.logoUrl) {
    try {
      const res = await fetch(o.logoUrl)
      if (res.ok) logo = await doc.embedPng(await res.arrayBuffer())
    } catch {
      logo = null
    }
  }

  // the time scale: first start to last finish, in months
  const t0 = new Date(Math.min(...rows.map((r) => r.start.getTime())))
  const t1 = new Date(Math.max(...rows.map((r) => r.end.getTime())))
  const from = new Date(t0.getFullYear(), t0.getMonth(), 1)
  const to = new Date(t1.getFullYear(), t1.getMonth() + 1, 1)
  const gx = M + LABEL_W
  const gw = W - M - gx
  const span = to.getTime() - from.getTime()
  const xOf = (d: Date) => gx + ((d.getTime() - from.getTime()) / span) * gw
  const months: Date[] = []
  for (let d = new Date(from); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d)
  const labelEvery = gw / months.length < 30 ? 3 : 1
  const today = new Date()

  // pages
  const per1 = Math.floor((H - FIRST_TOP - AXIS_H - FOOT) / ROW)
  const perN = Math.floor((H - NEXT_TOP - AXIS_H - FOOT) / ROW)
  const chunks: Row[][] = [rows.slice(0, per1)]
  for (let i = per1; i < rows.length; i += perN) chunks.push(rows.slice(i, i + perN))
  const total = chunks.length

  chunks.forEach((chunk, pi) => {
    const page: PDFPage = doc.addPage([W, H])
    const top = pi === 0 ? FIRST_TOP : NEXT_TOP
    // heading
    if (pi === 0) {
      page.drawText(safe(o.title), { x: M, y: H - 38, size: 18, font: bold, color: NAVY })
      const sub = [o.subtitle, o.revision].filter(Boolean).join('  |  ')
      if (sub) page.drawText(fit(reg, sub, 10, W - 2 * M - 120), { x: M, y: H - 54, size: 10, font: reg, color: GREY })
      if (logo) {
        const h = 30
        const w = (logo.width / logo.height) * h
        page.drawImage(logo, { x: W - M - w, y: H - 24 - h, width: w, height: h })
      }
    } else {
      page.drawText(fit(bold, o.title, 11, W - 2 * M - 100), { x: M, y: H - 30, size: 11, font: bold, color: NAVY })
    }
    // axis and grid
    const axisY = H - top
    page.drawRectangle({ x: gx, y: axisY - AXIS_H + 4, width: gw, height: AXIS_H - 4, color: rgb(0.95, 0.96, 0.98) })
    months.forEach((m, i) => {
      const x = xOf(m)
      page.drawLine({ start: { x, y: axisY + 4 }, end: { x, y: FOOT + 6 }, thickness: 0.4, color: LINE })
      if (i % labelEvery === 0) {
        page.drawText(MONTHS[m.getMonth()], { x: x + 2, y: axisY - 12, size: 7.5, font: reg, color: GREY })
        if (m.getMonth() === 0 || i === 0) page.drawText(String(m.getFullYear()), { x: x + 2, y: axisY - 23, size: 7.5, font: bold, color: NAVY })
      }
    })
    // rows
    chunk.forEach((r, i) => {
      const y = axisY - AXIS_H - (i + 1) * ROW + 4
      if (r.kind === 'sec') page.drawRectangle({ x: M, y: y - 3, width: W - 2 * M, height: ROW, color: rgb(0.95, 0.97, 0.99) })
      const indent = r.kind === 'task' ? 12 : 0
      const font = r.kind === 'task' ? reg : bold
      const size = r.kind === 'task' ? 7.5 : 8.5
      const dates = r.kind === 'ms' ? ukShort(r.start) : `${ukShort(r.start)} - ${ukShort(r.end)}`
      const dw = reg.widthOfTextAtSize(dates, 7)
      page.drawText(fit(font, r.label, size, LABEL_W - indent - dw - 12), { x: M + 2 + indent, y: y + 1, size, font, color: r.kind === 'task' ? GREY : NAVY })
      page.drawText(dates, { x: M + LABEL_W - dw - 6, y: y + 1, size: 7, font: reg, color: GREY })
      if (r.kind === 'ms') {
        const cx = xOf(r.start)
        const cy = y + 4
        page.drawSvgPath(`M 0 -5 L 5 0 L 0 5 L -5 0 Z`, { x: cx, y: cy, color: NAVY, scale: 1 })
      } else {
        const x = xOf(r.start)
        const w = Math.max(3, xOf(r.end) - x)
        page.drawRectangle({ x, y: y - 1, width: w, height: r.kind === 'sec' ? 9 : 6, color: r.kind === 'sec' ? BLUE : rgb(0.61, 0.78, 0.89) })
      }
    })
    // today
    if (today >= from && today <= to) {
      const x = xOf(today)
      page.drawLine({ start: { x, y: axisY + 4 }, end: { x, y: FOOT + 6 }, thickness: 0.8, color: rgb(0.75, 0.22, 0.17) })
    }
    // footer
    page.drawText(`Snapshot taken ${ukShort(today)} from the live programme. Dates may change.`, { x: M, y: 14, size: 7.5, font: reg, color: GREY })
    const pn = `Page ${pi + 1} of ${total}`
    page.drawText(pn, { x: W - M - reg.widthOfTextAtSize(pn, 7.5), y: 14, size: 7.5, font: reg, color: GREY })
  })

  const bytes = await doc.save()
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}
