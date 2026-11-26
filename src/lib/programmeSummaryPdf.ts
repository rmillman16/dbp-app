// The summary programme as a PDF snapshot (26 Nov): one button, downloads straight away, nothing is stored.
// Laid out like DBP's own summary programmes: a navy band for each section, then its tasks with start, days and end and a bar in the
// trade's colour, milestones as diamonds, the shutdown shaded and a title block at the foot. The bigger the programme the more
// pages (1 to 4); a programme too big for four pages shows each section's longest tasks and every milestone. Drawn directly
// (pdf-lib) rather than printed, so it is a real file and not the browser's print dialog.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type RGB } from 'pdf-lib'
import type { TLState, TLTask } from './timelineFormat'
import { fromISO, taskEndDate, tradeResolver } from './timelineDates'
import { summarise } from './programmeViews'

const W = 841.89 // A4 landscape, points
const H = 595.28
const M = 28
const ROW = 17
const TOP = 74 // the heading
const HDR = 20 // the column headings and month scale
const FOOT = 50 // the title block
const MAX_PAGES = 4
const COL_START = 44
const COL_DAYS = 30
const COL_END = 44
const TABLE_W = 262 + COL_START + COL_DAYS + COL_END
const NAVY = rgb(0.122, 0.071, 0.275)
const BLUE = rgb(0, 0.478, 0.745)
const GREY = rgb(0.42, 0.44, 0.52)
const LINE = rgb(0.88, 0.89, 0.93)
const PINK = rgb(0.96, 0.87, 0.86)

export type Item = { kind: 'band' | 'task' | 'ms'; label: string; count?: number; start?: Date; end?: Date; days?: number; color?: string }

const safe = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/◆/g, '')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const hex = (h: string): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim())
  if (!m) return BLUE
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}
function fit(font: PDFFont, text: string, size: number, width: number) {
  let t = safe(text)
  if (font.widthOfTextAtSize(t, size) <= width) return t
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > width) t = t.slice(0, -1)
  return t.trimEnd() + '...'
}

const PER_PAGE = Math.floor((H - TOP - HDR - FOOT) / ROW)
const CAPACITY = (pages: number) => pages * PER_PAGE

// every section as a band with its tasks and milestones in date order; if it will not fit four pages, each section keeps its
// longest tasks (at least one) and all its milestones
export function summaryItems(state: TLState): { items: Item[]; trimmed: boolean } {
  const tr = tradeResolver(state)
  const colour = (t: TLTask) => (t.trade ? tr(t.trade).color : BLUE_HEX)
  const sections: { name: string; tasks: TLTask[] }[] = state.groups.map((g) => ({ name: g.name, tasks: state.tasks.filter((t) => t.groupId === g.id) }))
  const loose = state.tasks.filter((t) => !t.groupId || !state.groups.some((g) => g.id === t.groupId))
  if (loose.length) sections.push({ name: state.groups.length ? 'Other works' : 'Programme', tasks: loose })
  const real = sections.filter((s) => s.tasks.length)

  // the start on site and completion dates when the programme has no milestones of its own for them
  const own = new Set(state.tasks.map((t) => t.id))
  const extra = summarise(state, false).tasks.filter((t) => t.groupId === 'key-dates' && !own.has(t.id))
  const keyDates: TLTask[] = extra.map((t) => ({ ...t, trade: '' }))
  if (keyDates.length) real.unshift({ name: 'Key dates', tasks: keyDates })

  const pick = (budget: number | null) => {
    // all of it, or each section's longest few: choose by duration, at least one per section, milestones always
    if (budget === null) return null
    const keep = new Set<TLTask>()
    for (const s of real) {
      s.tasks.filter((t) => t.milestone).forEach((t) => keep.add(t))
      const longest = [...s.tasks].filter((t) => !t.milestone).sort((a, b) => b.duration - a.duration)[0]
      if (longest) keep.add(longest)
    }
    const rest = real.flatMap((s) => s.tasks).filter((t) => !t.milestone && !keep.has(t)).sort((a, b) => b.duration - a.duration)
    for (const t of rest) {
      if (keep.size >= budget) break
      keep.add(t)
    }
    return keep
  }
  const build = (keep: Set<TLTask> | null): Item[] => {
    const out: Item[] = []
    for (const s of real) {
      const ts = s.tasks.filter((t) => !keep || keep.has(t)).sort((a, b) => a.start.localeCompare(b.start))
      if (!ts.length) continue
      out.push({ kind: 'band', label: s.name, count: s.tasks.length })
      for (const t of ts)
        out.push(
          t.milestone
            ? { kind: 'ms', label: t.name || 'Milestone', start: fromISO(t.start), end: fromISO(t.start), color: colour(t) }
            : { kind: 'task', label: t.name || 'Task', start: fromISO(t.start), end: taskEndDate(state, t), days: t.duration, color: colour(t) },
        )
    }
    return out
  }
  const all = build(null)
  if (paginate(all).length <= MAX_PAGES) return { items: all, trimmed: false }
  // too big: show fewer tasks until it fits (the bands carried over a page take room too)
  let budget = CAPACITY(MAX_PAGES) - real.length
  let items = build(pick(budget))
  while (paginate(items).length > MAX_PAGES && budget > real.length) {
    budget -= 2
    items = build(pick(budget))
  }
  return { items, trimmed: true }
}
const BLUE_HEX = '#007ABE'

// the rows on each page; a section carried over the page gets its band again, and a band is never left alone at the foot
export function paginate(items: Item[]): Item[][] {
  const pages: Item[][] = [[]]
  let band: Item | null = null
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const cur = pages[pages.length - 1]
    const cap = PER_PAGE
    if (it.kind === 'band') band = it
    // no room: a new page (a band needs room for its first row too)
    if (cur.length >= cap || (it.kind === 'band' && cur.length >= cap - 1)) {
      pages.push([])
      if (it.kind !== 'band' && band) pages[pages.length - 1].push({ ...band, label: `${band.label} (continued)`, count: undefined })
    }
    pages[pages.length - 1].push(it)
  }
  return pages
}

export interface SummaryOptions {
  title: string // the project
  revision?: string
  status?: string
  by?: string
  logoUrl?: string
}

export async function summaryProgrammePdf(state: TLState, o: SummaryOptions): Promise<Blob> {
  const { items } = summaryItems(state)
  const dated = items.filter((i) => i.start)
  if (!dated.length) throw new Error('There are no tasks to summarise yet.')
  const pages = paginate(items).slice(0, MAX_PAGES)
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
  const today = new Date()
  const printed = `${today.getDate()} ${LONG[today.getMonth()]} ${today.getFullYear()}`
  const rev = o.revision || 'Draft'
  const status = o.status || 'Draft'

  // the time scale: the first start to the last finish, in whole months
  const t0 = new Date(Math.min(...dated.map((r) => r.start!.getTime())))
  const t1 = new Date(Math.max(...dated.map((r) => r.end!.getTime())))
  const from = new Date(t0.getFullYear(), t0.getMonth(), 1)
  const to = new Date(t1.getFullYear(), t1.getMonth() + 1, 1)
  const gx = M + TABLE_W + 6
  const gw = W - M - gx
  const span = to.getTime() - from.getTime()
  const xOf = (d: Date) => gx + ((Math.min(Math.max(d.getTime(), from.getTime()), to.getTime()) - from.getTime()) / span) * gw
  const months: Date[] = []
  for (let d = new Date(from); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d)
  const labelEvery = gw / months.length < 24 ? 3 : 1
  const startYear = t0.getFullYear()
  const dstr = (d: Date) => `${d.getDate()} ${SHORT[d.getMonth()]}${d.getFullYear() !== startYear ? ' ' + String(d.getFullYear()).slice(-2) : ''}`
  const shut = (state.shutdowns ?? []).map((s) => ({ a: fromISO(s.start), b: new Date(fromISO(s.end).getTime() + 86400000) })).filter((s) => s.b > from && s.a < to)

  pages.forEach((rows, pi) => {
    const page = doc.addPage([W, H])
    // heading
    page.drawText(fit(bold, o.title, 15, W - 2 * M - 180), { x: M, y: H - 36, size: 15, font: bold, color: NAVY })
    const sub = `CONSTRUCTION PROGRAMME  ·  ${rev.toUpperCase()}  ·  ${status.toUpperCase()}  ·  PRINTED ${printed.toUpperCase()}`
    page.drawText(fit(reg, sub, 7.5, W - 2 * M - 180), { x: M, y: H - 50, size: 7.5, font: reg, color: GREY })
    if (logo) {
      const h = 30
      const w = (logo.width / logo.height) * h
      page.drawImage(logo, { x: W - M - w, y: H - 14 - h, width: w, height: h })
    }
    page.drawLine({ start: { x: 0, y: H - 62 }, end: { x: W, y: H - 62 }, thickness: 0.5, color: LINE })

    const axisY = H - TOP // the column headings sit between here and the first row
    const firstY = axisY - HDR
    const lastY = FOOT + 6
    // shutdown shading, month lines and the scale
    for (const s of shut) {
      const x = xOf(s.a)
      page.drawRectangle({ x, y: lastY, width: Math.max(1, xOf(s.b) - x), height: axisY - lastY, color: PINK })
    }
    months.forEach((m, i) => {
      const x = xOf(m)
      page.drawLine({ start: { x, y: axisY - 2 }, end: { x, y: lastY }, thickness: 0.4, color: LINE })
      if (i % labelEvery === 0) page.drawText(SHORT[m.getMonth()], { x: x + 2, y: axisY - 14, size: 6.5, font: reg, color: GREY })
      if (m.getMonth() === 0 || i === 0) page.drawText(String(m.getFullYear()), { x: x + 2, y: axisY - 5, size: 6.5, font: bold, color: NAVY })
    })
    for (const [txt, x, right] of [
      ['TASK', M + 2, false],
      ['START', M + 262, false],
      ['DAYS', M + 262 + COL_START + COL_DAYS - 4, true],
      ['END', M + 262 + COL_START + COL_DAYS + 4, false],
    ] as [string, number, boolean][])
      page.drawText(txt, { x: right ? x - bold.widthOfTextAtSize(txt, 6.5) : x, y: axisY - 14, size: 6.5, font: bold, color: GREY })

    // rows
    rows.forEach((r, i) => {
      const top = firstY - i * ROW
      const y = top - ROW + 5 // text baseline
      if (r.kind === 'band') {
        page.drawRectangle({ x: M, y: top - ROW, width: W - 2 * M, height: ROW, color: NAVY })
        const name = fit(bold, r.label, 8.5, TABLE_W - 70)
        page.drawText(name, { x: M + 5, y, size: 8.5, font: bold, color: rgb(1, 1, 1) })
        if (r.count)
          page.drawText(`${r.count} task${r.count === 1 ? '' : 's'}`, { x: M + 5 + bold.widthOfTextAtSize(name, 8.5) + 5, y, size: 7, font: reg, color: rgb(0.72, 0.74, 0.86) })
        return
      }
      page.drawLine({ start: { x: M, y: top - ROW }, end: { x: W - M, y: top - ROW }, thickness: 0.4, color: LINE })
      const ms = r.kind === 'ms'
      page.drawText(fit(reg, r.label, 8, 262 - 6 - (ms ? 9 : 0)), { x: M + 2 + (ms ? 9 : 0), y, size: 8, font: reg, color: NAVY })
      if (ms) page.drawSvgPath('M 0 -3.2 L 3.2 0 L 0 3.2 L -3.2 0 Z', { x: M + 6, y: y + 3, color: NAVY, scale: 1 })
      page.drawText(dstr(r.start!), { x: M + 262, y, size: 8, font: reg, color: NAVY })
      if (!ms) {
        const dd = String(r.days ?? '')
        page.drawText(dd, { x: M + 262 + COL_START + COL_DAYS - 4 - reg.widthOfTextAtSize(dd, 8), y, size: 8, font: reg, color: NAVY })
      } else page.drawText('-', { x: M + 262 + COL_START + COL_DAYS - 10, y, size: 8, font: reg, color: GREY })
      page.drawText(dstr(r.end!), { x: M + 262 + COL_START + COL_DAYS + 4, y, size: 8, font: reg, color: NAVY })
      const c = hex(r.color ?? BLUE_HEX)
      if (ms) page.drawSvgPath('M 0 -4.5 L 4.5 0 L 0 4.5 L -4.5 0 Z', { x: xOf(r.start!), y: y + 3, color: c, scale: 1 })
      else {
        const x = xOf(r.start!)
        page.drawRectangle({ x, y: top - ROW + 3.5, width: Math.max(2.5, xOf(r.end!) - x), height: ROW - 7, color: c })
      }
    })
    // today
    if (today >= from && today <= to) {
      const x = xOf(today)
      page.drawLine({ start: { x, y: axisY - 2 }, end: { x, y: lastY }, thickness: 0.9, color: BLUE })
      const lw = reg.widthOfTextAtSize('Today', 6)
      page.drawRectangle({ x: x - lw / 2 - 2, y: lastY - 9, width: lw + 4, height: 9, color: BLUE })
      page.drawText('Today', { x: x - lw / 2, y: lastY - 7, size: 6, font: reg, color: rgb(1, 1, 1) })
    }

    // the title block
    const bx = M
    const bw = W - 2 * M
    const by = 10
    const bh = 26
    page.drawRectangle({ x: bx, y: by, width: bw, height: bh, borderColor: rgb(0.65, 0.67, 0.8), borderWidth: 0.6 })
    const cells: [string, string, number][] = [
      ['PROJECT', o.title, 0.4],
      ['REVISION', rev, 0.1],
      ['STATUS', status, 0.07],
      ['PRINTED', printed, 0.13],
      ['BY', o.by ?? '', 0.2],
      ['SHEET', `${pi + 1} of ${pages.length}`, 0.07],
    ]
    let cx = bx
    cells.forEach(([k, v, share], i) => {
      const cw = bw * share
      if (i > 0) page.drawLine({ start: { x: cx, y: by }, end: { x: cx, y: by + bh }, thickness: 0.6, color: rgb(0.65, 0.67, 0.8) })
      page.drawText(k, { x: cx + 5, y: by + bh - 9, size: 5.5, font: reg, color: GREY })
      page.drawText(fit(reg, v, 8, cw - 10), { x: cx + 5, y: by + 6, size: 8, font: reg, color: NAVY })
      cx += cw
    })
  })

  const bytes = await doc.save()
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}
