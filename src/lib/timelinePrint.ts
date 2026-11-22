// DBP Timeline's print: paginated, true-to-scale A3 landscape pages (reference/timeline-app-2026-11-21.html:
// PRINT section and its print CSS). Built from scratch rather than from the on-screen chart so row height
// stays constant and legible whether a programme has 20 tasks or 120 — long lists simply span more pages
// instead of shrinking. buildPrintPagesHtml is the pure part (strings only, runs in Node);
// printProgramme puts it on the page, prints, and takes it away again.
import type { TLState, TLTask } from './timelineFormat'
import {
  CRITICAL_COLOR,
  addDays,
  addWorkingDays,
  computeCriticalPath,
  darken,
  escapeHtml,
  fmtShort,
  fromISO,
  getRenderList,
  isWeekend,
  taskEndDate,
  tradeResolver,
  weekAnchorMonday,
  weekNumberFor,
  type TLRenderItem,
} from './timelineDates'

export interface PrintOptions {
  logoUrl: string // the DBP logo, e.g. '/dbp-logo.png'
  contractor?: string | null // print only this contractor's tasks
  criticalOnly?: boolean // print only the critical path
  critical?: Set<string> // critical task ids; worked out from the programme if not given
  revision?: string // e.g. 'Rev B'; default 'Not issued'
  status?: string // e.g. 'Committed'; default 'Draft'
  printedBy?: string
  now?: Date // "today" (the Today line and printed date)
  // the original programme (or a revision) drawn under each bar, with the slippage shaded (22 Nov)
  compare?: { label: string; bars: Map<string, { start_date: string; finish_date: string; milestone: boolean }> }
}

// Milestone diamonds at this fraction of the bar height (as in the interactive chart)
const MILESTONE_SCALE = 0.65
const FONT = `Manrope,'Segoe UI',system-ui,sans-serif`

export const PP = {
  mm: 96 / 25.4,
  pageWmm: 420,
  pageHmm: 297,
  marginMm: 10,
  headerPx: 94,
  rulerPx: 46,
  rowPx: 30,
  tableWpx: 480,
  gutterPx: 16,
}
export const pmm = (v: number) => v * PP.mm
export interface PrintMetrics {
  pageW: number
  pageH: number
  margin: number
  usableW: number
  usableH: number
  ganttW: number
  bodyH: number
  rowsPerPage: number
}
export function printMetrics(): PrintMetrics {
  const pageW = pmm(PP.pageWmm),
    pageH = pmm(PP.pageHmm)
  const margin = pmm(PP.marginMm)
  const usableW = pageW - 2 * margin,
    usableH = pageH - 2 * margin
  const ganttW = usableW - PP.tableWpx - PP.gutterPx
  const bodyH = usableH - PP.headerPx - PP.rulerPx
  const rowsPerPage = Math.max(5, Math.floor(bodyH / PP.rowPx))
  return { pageW, pageH, margin, usableW, usableH, ganttW, bodyH, rowsPerPage }
}
type Granularity = 'day' | 'week' | 'month'
const PRINT_GRANULARITIES: { name: Granularity; pxPerDay: number }[] = [
  { name: 'day', pxPerDay: 20 },
  { name: 'week', pxPerDay: 55 / 7 },
  { name: 'month', pxPerDay: 50 / 30.44 },
]
/** the finest ruler (day, then week, then month) that isn't squashed below 70% of its natural size,
 *  scaled so the programme fills the chart width exactly */
export function pickPrintGranularity(spanDays: number, ganttW: number) {
  for (const g of PRINT_GRANULARITIES) {
    const scale = ganttW / (spanDays * g.pxPerDay)
    if (scale >= 0.7) return { ...g, extraScale: scale }
  }
  const last = PRINT_GRANULARITIES[PRINT_GRANULARITIES.length - 1]
  return { ...last, extraScale: Math.max(0.15, ganttW / (spanDays * last.pxPerDay)) }
}
export interface PrintAxis {
  masterStart: Date
  masterEnd: Date
  spanDays: number
  granularity: Granularity
  pxPerDay: number
  dateToX: (d: Date) => number
}

// everything the page builders need that Timeline read from globals
interface PrintCtx {
  state: TLState
  visible: TLTask[]
  criticalSet: Set<string>
  getTrade: (name: string) => { name: string; color: string }
  today: Date
  compare?: PrintOptions['compare']
}

function computePrintAxis(ctx: PrintCtx, m: PrintMetrics): PrintAxis {
  const starts = ctx.visible.map((t) => fromISO(t.start).getTime())
  const ends = ctx.visible.map((t) => taskEndDate(ctx.state, t).getTime())
  const masterStart = addDays(new Date(Math.min(...starts)), -3)
  const masterEnd = addDays(new Date(Math.max(...ends)), 3)
  const spanDays = Math.max(1, Math.round((masterEnd.getTime() - masterStart.getTime()) / 86400000))
  const gran = pickPrintGranularity(spanDays, m.ganttW)
  const pxPerDay = gran.pxPerDay * gran.extraScale
  const dateToX = (d: Date) => ((d.getTime() - masterStart.getTime()) / 86400000) * pxPerDay
  return { masterStart, masterEnd, spanDays, granularity: gran.name, pxPerDay, dateToX }
}
export function svgText(x: number, y: number, text: string, anchor: 'start' | 'middle' | 'end', fill: string, size?: number, weight?: number) {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size || 7}" font-family="${FONT}" font-weight="${weight || 400}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="central">${escapeHtml(text)}</text>`
}
const fmtMon = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short' })

function buildRulerAndGrid(ctx: PrintCtx, axis: PrintAxis, w: number, totalH: number) {
  const { masterStart, masterEnd, dateToX, granularity } = axis
  let out = ''
  // shutdown periods shaded behind the grid, labelled at the top
  ;(ctx.state.shutdowns || []).forEach((p) => {
    if (!p.start || !p.end) return
    const x1 = Math.max(0, dateToX(fromISO(p.start)))
    const x2 = Math.min(w, dateToX(addDays(fromISO(p.end), 1)))
    if (x2 <= x1) return
    out += `<rect x="${x1.toFixed(1)}" y="0" width="${(x2 - x1).toFixed(1)}" height="${totalH}" fill="#f6dcd8"/>`
    if (x2 - x1 > 40) out += svgText((x1 + x2) / 2, PP.rulerPx + 7, p.name || 'Shutdown', 'middle', '#9a4a40', 6.5, 700)
  })
  if (granularity === 'day') {
    let d = new Date(masterStart),
      lastMonth: string | null = null
    while (d <= masterEnd) {
      const x = dateToX(d)
      if (isWeekend(d)) out += `<rect x="${x.toFixed(1)}" y="0" width="${axis.pxPerDay.toFixed(1)}" height="${totalH}" fill="#f4f5fa"/>`
      const mk = d.getFullYear() + '-' + d.getMonth()
      if (mk !== lastMonth) {
        if (x > 4) out += svgText(x + 3, 10, `${fmtMon(d)} ${d.getFullYear()}`, 'start', '#1f1246', 7.5, 700)
        lastMonth = mk
      }
      out += `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${totalH}" stroke="#e3e6f0" stroke-width="0.5"/>`
      out += svgText(x + 2, PP.rulerPx - 8, '' + d.getDate(), 'start', '#7a789a', 6.5)
      d = addDays(d, 1)
    }
  } else if (granularity === 'week') {
    let d = new Date(masterStart)
    while (d.getDay() !== 1) d = addDays(d, -1)
    let lastMonth: string | null = null
    const weekAnchor = weekAnchorMonday(ctx.state)
    while (d <= masterEnd) {
      const x = dateToX(d)
      const mk = d.getFullYear() + '-' + d.getMonth()
      if (mk !== lastMonth) {
        if (x > 4) out += svgText(x + 3, 10, `${fmtMon(d)} ${d.getFullYear()}`, 'start', '#1f1246', 7.5, 700)
        lastMonth = mk
      }
      out += `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${totalH}" stroke="#e3e6f0" stroke-width="0.5"/>`
      const wn = weekNumberFor(d, weekAnchor)
      if (wn !== null) out += svgText(x + 2, 24, `Wk ${wn}`, 'start', '#007abe', 6.5, 700)
      out += svgText(x + 2, PP.rulerPx - 8, `${d.getDate()} ${fmtMon(d)}`, 'start', '#7a789a', 6.5)
      d = addDays(d, 7)
    }
  } else {
    let d = new Date(masterStart.getFullYear(), masterStart.getMonth(), 1)
    let lastYear: number | null = null
    while (d <= masterEnd) {
      const x = dateToX(d)
      if (d.getFullYear() !== lastYear) {
        if (x > 4) out += svgText(x + 3, 10, '' + d.getFullYear(), 'start', '#1f1246', 7.5, 700)
        lastYear = d.getFullYear()
      }
      out += `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${totalH}" stroke="#e3e6f0" stroke-width="0.5"/>`
      out += svgText(x + 3, PP.rulerPx - 8, fmtMon(d), 'start', '#7a789a', 7)
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    }
  }
  const today = new Date(ctx.today)
  today.setHours(0, 0, 0, 0)
  if (today >= masterStart && today <= masterEnd) {
    const x = dateToX(today)
    out += `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${totalH}" stroke="#007abe" stroke-width="1"/>`
    out += svgText(x + 2, PP.rulerPx + 8, 'Today', 'start', '#007abe', 6.5, 700)
  }
  out += `<line x1="0" y1="${PP.rulerPx}" x2="${w}" y2="${PP.rulerPx}" stroke="#c7cbdd" stroke-width="0.75"/>`
  return out
}

type TaskPageMap = Record<string, number>

function buildBarsForChunk(ctx: PrintCtx, axis: PrintAxis, m: PrintMetrics, chunk: TLRenderItem[], taskPageMap: TaskPageMap, pageIndex: number) {
  const { state, criticalSet } = ctx
  const barH = PP.rowPx * 0.55,
    barY0 = (PP.rowPx - barH) / 2
  let svg = ''
  chunk.forEach((item, i) => {
    const rowTop = PP.rulerPx + i * PP.rowPx
    if (item.type === 'group') {
      svg += `<rect x="0" y="${rowTop}" width="${m.ganttW}" height="${PP.rowPx}" fill="#1f1246"/>`
      svg += svgText(10, rowTop + PP.rowPx / 2, item.group.name + (item.continued ? ' (continued)' : ''), 'start', '#fff', 7.5, 700)
      return
    }
    const t = item.task
    const barY = rowTop + barY0
    const trade = ctx.getTrade(t.trade)
    const x1 = axis.dateToX(fromISO(t.start))
    const x2 = axis.dateToX(taskEndDate(state, t))
    const w = Math.max(2, x2 - x1)
    const isCritical = criticalSet.has(t.id)
    const outlineStroke = isCritical ? CRITICAL_COLOR : darken(trade.color, 25)
    const outlineWidth = isCritical ? 1.6 : 0.6

    if (t.baselineStart) {
      const bx1 = axis.dateToX(fromISO(t.baselineStart))
      const bx2 = axis.dateToX(addWorkingDays(state, fromISO(t.baselineStart), t.baselineDuration))
      svg += `<rect x="${bx1.toFixed(1)}" y="${(barY + barH - 2.5).toFixed(1)}" width="${Math.max(2, bx2 - bx1).toFixed(1)}" height="3.5" fill="none" stroke="#b8bcd0" stroke-width="0.8" stroke-dasharray="2,1.5"/>`
    }

    // the comparison under the bar: grey where it was, red (late) or green (early) between its finish and now
    const was = ctx.compare?.bars.get(t.id)
    if (was) {
      const gy = barY + barH + 0.8
      const gx1 = axis.dateToX(fromISO(was.start_date))
      const gx2 = was.milestone ? gx1 : axis.dateToX(addDays(fromISO(was.finish_date), 1))
      if (was.milestone)
        svg += `<rect x="${(gx1 - 2.2).toFixed(1)}" y="${gy.toFixed(1)}" width="4.4" height="4.4" fill="#fff" stroke="#7a789a" stroke-width="0.8" transform="rotate(45 ${gx1.toFixed(1)} ${(gy + 2.2).toFixed(1)})"/>`
      else
        svg += `<rect x="${gx1.toFixed(1)}" y="${gy.toFixed(1)}" width="${Math.max(2, gx2 - gx1).toFixed(1)}" height="3.6" rx="1" fill="#c9c8d8" stroke="#9aa0bb" stroke-width="0.5"/>`
      const nowEnd = t.milestone ? fromISO(t.start) : addDays(taskEndDate(state, t), 1)
      const wasEnd = was.milestone ? fromISO(was.finish_date) : addDays(fromISO(was.finish_date), 1)
      const a = axis.dateToX(wasEnd)
      const b = axis.dateToX(nowEnd)
      if (Math.abs(b - a) > 0.5) {
        const late = b > a
        svg += `<rect x="${Math.min(a, b).toFixed(1)}" y="${gy.toFixed(1)}" width="${Math.abs(b - a).toFixed(1)}" height="3.6" fill="${late ? '#f4b6b6' : '#bfe3b4'}" stroke="${late ? '#D63030' : '#2e9914'}" stroke-width="0.6"/>`
      }
    }

    let ragDotX: number
    if (t.milestone) {
      const cx = x1,
        cy = barY + barH / 2,
        side = barH * MILESTONE_SCALE
      svg += `<rect x="${(cx - side / 2).toFixed(1)}" y="${(cy - side / 2).toFixed(1)}" width="${side.toFixed(1)}" height="${side.toFixed(1)}" rx="0" fill="${trade.color}" stroke="${outlineStroke}" stroke-width="${outlineWidth}" transform="rotate(45 ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`
      // label to the right of the diamond, or to the left if it would run off the page
      const mTextW = t.name.length * 4.8
      if (cx + side / 2 + 6 + mTextW > m.ganttW - 4 && cx - side / 2 - 6 - mTextW > 0) svg += svgText(cx - side / 2 - 6, cy, t.name, 'end', '#1f1246', 7, 600)
      else svg += svgText(cx + side / 2 + 6, cy, t.name, 'start', '#1f1246', 7, 600)
      ragDotX = cx + side / 1.3
    } else {
      svg += `<rect x="${x1.toFixed(1)}" y="${barY.toFixed(1)}" width="${w.toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${trade.color}" stroke="${outlineStroke}" stroke-width="${outlineWidth}"/>`
      const progW = w * (Math.min(100, t.progress || 0) / 100)
      if (progW > 1) svg += `<rect x="${x1.toFixed(1)}" y="${barY.toFixed(1)}" width="${progW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${darken(trade.color, 45)}"/>`
      const textW = t.name.length * 4.5 // Manrope runs a little wider than Arial
      const roomRight = m.ganttW - (x1 + w + 5) - 4
      const roomLeft = x1 - 5 - 2
      if (textW < w - 6) svg += svgText(x1 + w / 2, barY + barH / 2, t.name, 'middle', '#fff', 7)
      // label sits beside the bar: right by default, left when the right side would be cut off by the page edge
      else if (textW > roomRight && roomLeft > roomRight) svg += svgText(x1 - 5, barY + barH / 2, t.name, 'end', '#1f1246', 7)
      else svg += svgText(x1 + w + 5, barY + barH / 2, t.name, 'start', '#1f1246', 7)
      ragDotX = x1 + w - 1
    }
    // Only flag exceptions: a dot on every bar is just noise when most are green
    if (t.rag === 'amber' || t.rag === 'red') {
      const ragColor = t.rag === 'red' ? '#D63030' : '#D4920A'
      svg += `<circle cx="${ragDotX.toFixed(1)}" cy="${(barY - 1).toFixed(1)}" r="2.3" fill="${ragColor}" stroke="#fff" stroke-width="0.6"/>`
    }

    ;(t.predecessors || []).forEach((p) => {
      if (taskPageMap[p.id] !== pageIndex) return
      const predIdx = chunk.findIndex((ci) => ci.type === 'task' && ci.task.id === p.id)
      if (predIdx < 0) return
      const predItem = chunk[predIdx]
      if (predItem.type !== 'task') return
      const pred = predItem.task
      const px2 = axis.dateToX(taskEndDate(state, pred))
      const predRowTop = PP.rulerPx + predIdx * PP.rowPx
      const py = predRowTop + barY0 + barH / 2
      const py2 = barY + barH / 2
      const midX = px2 + 6
      const arrowCritical = criticalSet.has(t.id) && criticalSet.has(p.id)
      // links that run between sections can stretch down the whole page, so draw them lighter and
      // dashed to keep them from competing with the labels they cross
      const crossSection = (pred.groupId || null) !== (t.groupId || null) && !arrowCritical
      const arrowStroke = arrowCritical ? CRITICAL_COLOR : crossSection ? '#b4b9cf' : '#8a87a8'
      const arrowWidth = arrowCritical ? 1.4 : crossSection ? 0.6 : 0.8
      const dash = crossSection ? ' stroke-dasharray="3,2"' : ''
      svg += `<path d="M${px2.toFixed(1)},${py.toFixed(1)} L${midX.toFixed(1)},${py.toFixed(1)} L${midX.toFixed(1)},${py2.toFixed(1)} L${(x1 - 3).toFixed(1)},${py2.toFixed(1)}" fill="none" stroke="${arrowStroke}" stroke-width="${arrowWidth}"${dash}/>`
      svg += `<polygon points="${(x1 - 3).toFixed(1)},${(py2 - 2).toFixed(1)} ${(x1 - 3).toFixed(1)},${(py2 + 2).toFixed(1)} ${x1.toFixed(1)},${py2.toFixed(1)}" fill="${arrowStroke}"/>`
    })
  })
  return svg
}
function buildPageSVG(ctx: PrintCtx, axis: PrintAxis, m: PrintMetrics, chunk: TLRenderItem[], pageIndex: number, taskPageMap: TaskPageMap) {
  const totalH = PP.rulerPx + chunk.length * PP.rowPx
  const grid = buildRulerAndGrid(ctx, axis, m.ganttW, totalH)
  // faint line under every task row (matches the task table's row borders) so the eye can follow a task across
  let rowLines = ''
  for (let i = 1; i <= chunk.length; i++) {
    const y = PP.rulerPx + i * PP.rowPx - 0.25
    rowLines += `<line x1="0" y1="${y.toFixed(2)}" x2="${m.ganttW}" y2="${y.toFixed(2)}" stroke="#dfe3ee" stroke-width="0.6"/>`
  }
  const bars = buildBarsForChunk(ctx, axis, m, chunk, taskPageMap, pageIndex)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${m.ganttW}" height="${totalH}" viewBox="0 0 ${m.ganttW} ${totalH}" style="display:block">${grid}${rowLines}${bars}</svg>`
}
function buildPrintTable(ctx: PrintCtx, chunk: TLRenderItem[], taskPageMap: TaskPageMap, pageIndex: number) {
  const { state, criticalSet } = ctx
  const rows = chunk
    .map((item) => {
      if (item.type === 'group') {
        const g = item.group
        const n = ctx.visible.filter((t) => t.groupId === g.id).length
        const sub = item.continued ? '(continued)' : `&middot; ${n} task${n === 1 ? '' : 's'}`
        return `<tr style="height:${PP.rowPx}px;background:#1f1246"><td colspan="4" style="color:#fff;font-weight:700;padding-left:6px">${escapeHtml(g.name)} <span style="font-weight:400;color:#c7c3e0;font-size:7pt">${sub}</span></td></tr>`
      }
      const t = item.task
      const crossPagePreds = (t.predecessors || []).filter((p) => taskPageMap[p.id] !== undefined && taskPageMap[p.id] !== pageIndex)
      let contNote = ''
      if (crossPagePreds.length) {
        const fromPages = [...new Set(crossPagePreds.map((p) => taskPageMap[p.id] + 1))]
        contNote = ` <span class="pp-continued">(from p.${fromPages.join(',')})</span>`
      }
      const isCritical = criticalSet.has(t.id)
      return `<tr style="height:${PP.rowPx}px${isCritical ? `;box-shadow:inset 3px 0 0 ${CRITICAL_COLOR}` : ''}">
      <td class="pp-name"${isCritical ? ` style="color:${CRITICAL_COLOR}"` : ''}>${t.milestone ? '&#9670; ' : ''}${escapeHtml(t.name)}${contNote}</td>
      <td>${fmtShort(fromISO(t.start))}</td>
      <td style="text-align:right">${t.milestone ? '&mdash;' : t.duration}</td>
      <td>${fmtShort(taskEndDate(state, t))}</td>
    </tr>`
    })
    .join('')
  return `<table class="pp-table"><thead><tr style="height:${PP.rulerPx}px"><th>Task</th><th>Start</th><th style="text-align:right">Days</th><th>End</th></tr></thead><tbody>${rows}</tbody></table>`
}

const sameName = (a: string | null | undefined, b: string | null | undefined) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase()

/** the print-root's contents: the repeating page header and every A3 page (pure; no DOM) */
export function buildPrintPagesHtml(state: TLState, opts: PrintOptions): string {
  const now = opts.now ?? new Date()
  const contractor = (opts.contractor || '').trim()
  const criticalSet = opts.critical ?? computeCriticalPath(state)
  const taskVisible = (t: TLTask) => (!contractor || sameName(t.contractor, contractor)) && (!opts.criticalOnly || criticalSet.has(t.id))
  const filtering = !!contractor || !!opts.criticalOnly
  const visible = state.tasks.filter(taskVisible)
  const ctx: PrintCtx = { state, visible, criticalSet, getTrade: tradeResolver(state), today: now, compare: opts.compare }

  // Document-control details for the title block and header strapline
  const contractorText =
    (contractor ? ` · ${contractor} only` : '') + (opts.criticalOnly ? ' · critical path only' : '') + (opts.compare ? ` · compared with ${opts.compare.label}` : '')
  const revText = opts.revision || 'Not issued'
  const statusText = opts.status || 'Draft'
  const printedOn = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const printedBy = opts.printedBy || ''
  const title = state.projectName || 'Untitled programme'
  const sub = `Construction programme${contractorText} · ${revText} · ${statusText} · printed ${printedOn}`
  const header = `<div class="print-header">
  <div class="ph-left"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(sub)}</p></div>
  <div class="ph-right">
  ${state.clientLogo ? `<img class="ph-client-logo" src="${escapeHtml(state.clientLogo)}" alt="Client logo">` : ''}
  <img src="${escapeHtml(opts.logoUrl)}" alt="du Boulay Projects" class="ph-logo">
  </div>
</div>`
  if (!visible.length) return header + '<div class="tl-print-pages"></div>'

  const m = printMetrics()
  const axis = computePrintAxis(ctx, m)
  const rowsPerPage = m.rowsPerPage
  const renderList = getRenderList(state, { forPrint: true, visible: filtering ? taskVisible : null })
  // Paginate: spread rows evenly over the minimum number of pages (no nearly-empty last page), repeat
  // the section header at the top of a page that starts mid-section, and never leave a section header
  // stranded at the foot of a page.
  const pages: TLRenderItem[][] = []
  // How many pages would plain "fill each page to the brim" need? (A page that starts mid-section loses
  // one row to the repeated section header.)
  let greedyPages = 0
  for (let i = 0; i < renderList.length; greedyPages++) {
    const it = renderList[i]
    const hdr = it.type === 'task' && it.task.groupId ? 1 : 0
    i += Math.max(1, rowsPerPage - hdr)
  }
  const targetPages = Math.max(1, greedyPages)
  let idx = 0
  while (idx < renderList.length) {
    const pagesLeft = Math.max(1, targetPages - pages.length)
    const chunk: TLRenderItem[] = []
    const first = renderList[idx]
    if (first.type === 'task' && first.task.groupId) {
      const g = state.groups.find((x) => x.id === first.task.groupId)
      if (g) chunk.push({ type: 'group', group: g, continued: true })
    }
    const hdr = chunk.length
    // real rows to place on this page: an even share of what's left, never more than fits
    const take = Math.max(1, Math.min(rowsPerPage - hdr, Math.ceil((renderList.length - idx) / pagesLeft)))
    for (let k = 0; k < take && idx < renderList.length; k++) chunk.push(renderList[idx++])
    const last = chunk[chunk.length - 1]
    if (chunk.length > 1 && last.type === 'group' && !last.continued && idx < renderList.length) {
      chunk.pop()
      idx--
    }
    pages.push(chunk)
  }
  const taskPageMap: TaskPageMap = {}
  pages.forEach((chunk, pIdx) =>
    chunk.forEach((item) => {
      if (item.type === 'task') taskPageMap[item.task.id] = pIdx
    }),
  )

  const titleBlock = (pIdx: number) => `<div class="pp-titleblock" style="left:${m.margin}px;right:${m.margin}px">
      <div class="tb-grow"><span>Project</span>${escapeHtml(title)}</div>
      ${contractor ? `<div><span>Contractor</span>${escapeHtml(contractor)}</div>` : ''}
      <div><span>Revision</span>${escapeHtml(revText)}</div>
      <div><span>Status</span>${escapeHtml(statusText)}</div>
      <div><span>Printed</span>${printedOn}</div>
      ${printedBy ? `<div><span>By</span>${escapeHtml(printedBy)}</div>` : ''}
      <div><span>Sheet</span>${pIdx + 1} of ${pages.length}</div>
    </div>`

  let html = ''
  pages.forEach((chunk, pIdx) => {
    const tableHtml = buildPrintTable(ctx, chunk, taskPageMap, pIdx)
    const svgHtml = buildPageSVG(ctx, axis, m, chunk, pIdx, taskPageMap)
    html += `<div class="print-page" style="width:${m.pageW}px;height:${m.pageH}px;padding:${PP.headerPx}px ${m.margin}px ${m.margin}px ${m.margin}px">
      <div class="print-page-body" style="gap:${PP.gutterPx}px">
        <div class="pp-table-wrap" style="width:${PP.tableWpx}px">${tableHtml}</div>
        <div class="pp-gantt-wrap">${svgHtml}</div>
      </div>
      ${titleBlock(pIdx)}
    </div>`
  })
  return header + `<div class="tl-print-pages">${html}</div>`
}

// ── PRINT CSS ─────────────────────────────────────────────────────────────
// Timeline's print rules, scoped to the print root so they can't touch the app. On screen the root is
// hidden; in print it is the only thing shown, on A3 landscape sheets with no browser margin (the
// pages carry Timeline's own 10mm margin and the fixed header repeats on every sheet).
export const PRINT_ROOT_ID = 'tl-print-root'
const R = '#' + PRINT_ROOT_ID
export const PRINT_CSS = `
${R}{display:none;--navy:#1f1246;--ink:#1f1246;--ink-mid:#3a3660;--ink-light:#7a789a;--border:#d8dce8;--border-light:#eceef5;--ft:${FONT};--fb:${FONT};font-family:var(--fb);color:var(--ink);background:#fff}
${R} *,${R} *::before,${R} *::after{box-sizing:border-box;margin:0;padding:0}
${R} .print-header{display:none;background:#fff;border-bottom:1.5px solid var(--border);padding:29px;align-items:center;justify-content:space-between;width:100%}
${R} .print-header .ph-left{flex:1;min-width:0;overflow:hidden}
${R} .print-header .ph-left h1{font-family:var(--ft);font-size:13pt;line-height:1.2;font-weight:700;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${R} .print-header .ph-left p{font-family:var(--fb);font-size:8pt;line-height:1.3;color:var(--ink-light);text-transform:uppercase;letter-spacing:.07em;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${R} .print-header .ph-right{display:flex;align-items:center;gap:29px;flex-shrink:0}
${R} .print-header .ph-logo{height:36px;width:auto;display:block}
${R} .print-header .ph-client-logo{height:36px;width:auto;max-width:170px;object-fit:contain}
${R} .print-page{position:relative;overflow:hidden;background:#fff;box-sizing:border-box}
${R} .print-page + .print-page{break-before:page;page-break-before:always}
${R} .print-page-body{display:flex}
${R} .pp-table-wrap{flex-shrink:0}
${R} .pp-table{width:100%;border-collapse:collapse}
${R} .pp-table th{text-align:left;vertical-align:bottom;font-family:var(--fb);font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-light);padding:2px 5px 4px;border-bottom:1px solid var(--border)}
${R} .pp-table td{font-family:var(--fb);font-size:8pt;color:var(--ink-mid);padding:0 5px;vertical-align:middle;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;border-bottom:1px solid var(--border-light)}
${R} .pp-table td.pp-name{font-weight:600;color:var(--ink)}
${R} .pp-table .pp-continued{font-weight:400;color:var(--ink-light);font-size:7pt}
${R} .pp-gantt-wrap{flex:1;min-width:0;overflow:hidden}
${R} .pp-titleblock{position:absolute;bottom:5px;display:flex;border:1px solid #9aa0bb;font-family:var(--fb);font-size:8pt;color:var(--ink);background:#fff}
${R} .pp-titleblock>div{padding:2px 12px 3px;border-left:1px solid #9aa0bb;white-space:nowrap}
${R} .pp-titleblock>div:first-child{border-left:none}
${R} .pp-titleblock .tb-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
${R} .pp-titleblock span{display:block;font-size:6pt;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-light)}
@page{size:A3 landscape;margin:0}
@media print{
  html,body{height:auto!important;min-height:0!important;overflow:visible!important;background:#fff!important;margin:0!important;padding:0!important;display:block!important}
  body>*:not(${R}){display:none!important}
  ${R}{display:block!important}
  ${R},${R} *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  ${R} .print-header{display:flex!important;position:fixed;top:0;left:0;right:0;z-index:1;height:94px;padding:29px;box-sizing:border-box}
}
`

// ── PRINT ─────────────────────────────────────────────────────────────────
let teardownCurrent: (() => void) | null = null

/** remove the print root and its stylesheet (Timeline's teardownPrintPages); safe to call any time */
export function teardownPrintPages() {
  teardownCurrent?.()
}

/** builds the pages, prints them, and removes them again afterwards. Resolves once the print dialog has
 *  been opened (after the logos have loaded, so they appear on the sheets). */
export async function printProgramme(state: TLState, opts: PrintOptions): Promise<void> {
  teardownPrintPages()
  const style = document.createElement('style')
  style.id = PRINT_ROOT_ID + '-style'
  style.textContent = PRINT_CSS
  const root = document.createElement('div')
  root.id = PRINT_ROOT_ID
  root.innerHTML = buildPrintPagesHtml(state, opts)
  document.head.appendChild(style)
  document.body.appendChild(root)

  let fallback = 0
  const teardown = () => {
    root.remove()
    style.remove()
    window.removeEventListener('afterprint', teardown)
    window.removeEventListener('focus', onFocus)
    clearTimeout(fallback)
    if (teardownCurrent === teardown) teardownCurrent = null
  }
  // browsers whose print() returns before the dialog closes: tidy up when the window gets focus back
  const onFocus = () => setTimeout(teardown, 500)
  teardownCurrent = teardown
  window.addEventListener('afterprint', teardown)

  // wait (briefly) for the logos so they aren't missing from the printout
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.race([Promise.all(imgs.map((img) => img.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, 3000))])
  if (teardownCurrent !== teardown) return // superseded or torn down meanwhile

  window.print()
  if (teardownCurrent !== teardown) return // afterprint already fired
  window.addEventListener('focus', onFocus, { once: true })
  fallback = window.setTimeout(teardown, 5 * 60 * 1000) // never leave it stuck
}
