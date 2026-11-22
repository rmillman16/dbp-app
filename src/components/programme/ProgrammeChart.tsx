// The task list and Gantt chart, laid out as DBP Timeline's (reference/timeline-app-2026-11-21.html:
// renderTable, buildGroupHeaderRow, renderGantt, decorateBars): the task list on the left (Task, Trade,
// Start, Days, RAG, Prereq, Slip), navy section bands, the chart on the right with "Month · Wk N"
// headings, weekends and shutdowns shaded, RAG markers, critical tasks outlined in red and the links
// drawn. One box scrolls both ways: the task list stays put while the chart scrolls sideways.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProgrammeTask } from '../../lib/programme'
import { finishSlip, type Comparison } from '../../lib/programmeCompare'
import { addDays, daysBetween } from '../../lib/programmeEdit'
import { calendarOf } from '../../lib/programmeLinks'
import {
  CRITICAL_COLOR,
  cycleRag,
  dragTo,
  lengthOf,
  moveSection,
  moveSectionTo,
  moveTaskRow,
  parseUKDate,
  setDuration,
  setStart,
  slip,
  sortByStart,
  toggleCollapse,
  tradeColorOf,
  weekNumber,
  weekOneMonday,
  type Working,
} from '../../lib/programmeOps'

export type Zoom = 'Day' | 'Week' | 'Fortnight' | 'Month'
export const DAY_W: Record<Zoom, number> = { Day: 38, Week: 20, Fortnight: 170 / 14, Month: 4 }
const PAD: Record<Zoom, number> = { Day: 7, Week: 14, Fortnight: 28, Month: 62 }
const ROW = 30 // thinner than Timeline's 48 px (Richard, 22 Nov: "bars too large"), about 60% more tasks on screen
const HEAD = 56 // the two heading rows (32 + 24)
const BAR = 16
const MILESTONE_SCALE = 0.9 // of the (thinner) bar: about Timeline's diamond
const RAG_COLOR = { green: '#2e9914', amber: '#D4920A', red: '#D63030' }
export const DEFAULT_COL_WIDTHS = [200, 90, 74, 40, 36, 36, 54, 50] // Task, Trade, Start, Days, RAG, Prereq, Slip, actions
const COLS = ['Task', 'Trade', 'Start', 'Days', 'RAG', 'Prereq', 'Slip', '']
const sameName = (a?: string | null, b?: string | null) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`)
const mon = (iso: string) => utc(iso).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
const monthLong = (iso: string) => utc(iso).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })
const fmtShort = (iso: string) => utc(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const fmtUKShort = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`
const dd = (iso: string) => iso.slice(8, 10)

type Item = { kind: 'section'; name: string; tasks: ProgrammeTask[]; collapsed: boolean } | { kind: 'task'; t: ProgrammeTask }

// the rows shown (getRenderList): tasks with no section first, then each section's heading and tasks;
// a contractor filter shows only that contractor's tasks (and only the sections they're in)
export function renderList(w: Working, contractor: string) {
  const shown = (t: ProgrammeTask) => !contractor || sameName(t.contractor, contractor)
  const items: Item[] = w.tasks.filter((t) => t.section == null && shown(t)).map((t) => ({ kind: 'task' as const, t }))
  for (const s of w.programme.sections ?? []) {
    const tasks = w.tasks.filter((t) => t.section === s.name && shown(t))
    if (contractor && !tasks.length) continue
    items.push({ kind: 'section', name: s.name, tasks, collapsed: !!s.collapsed })
    if (!s.collapsed) items.push(...tasks.map((t) => ({ kind: 'task' as const, t })))
  }
  return items
}

export default function ProgrammeChart({
  w,
  zoom,
  critical,
  critOnly,
  contractor,
  linking,
  linkFrom,
  selected,
  compact,
  colWidths,
  todayTick,
  onColWidths,
  onApply,
  onOpen,
  onLink,
  onRenameSection,
  onDuplicateSection,
  onDeleteSection,
  onInsertSectionBefore,
  onAddFirst,
  compare,
}: {
  w: Working
  zoom: Zoom
  critical: Set<string>
  critOnly: boolean
  contractor: string
  linking: boolean
  linkFrom: string | null
  selected: string | null
  compact: boolean // a phone: just the task names
  colWidths: number[]
  todayTick: number // scroll to today when this changes
  onColWidths: (w: number[]) => void
  onApply: (next: Working, undo?: string) => void
  onOpen: (code: string) => void
  onLink: (code: string) => void
  onRenameSection: (name: string) => void
  onDuplicateSection: (name: string) => void
  onDeleteSection: (name: string) => void
  onInsertSectionBefore: (code: string) => void
  onAddFirst: () => void
  compare?: Comparison | null // the original programme (or a revision) drawn under the bars
}) {
  const sd = w.programme.shutdowns ?? []
  const today = new Date().toISOString().slice(0, 10)
  const items = useMemo(() => renderList(w, contractor), [w, contractor])
  const visibleTasks = items.flatMap((i) => (i.kind === 'task' ? [i.t] : i.tasks))
  const widths = compact ? [140, 0, 0, 0, 36, 0, 0, 0] : colWidths
  const left = widths.reduce((a, b) => a + b, 0)
  const dayW = DAY_W[zoom]

  // the chart's dates: whole weeks from a Monday, with room either side
  const { from, days } = useMemo(() => {
    const all = visibleTasks.length ? visibleTasks : w.tasks
    const start = all.map((t) => t.start_date).sort()[0] ?? w.programme.project_start ?? today
    const end =
      all
        .map((t) => t.finish_date)
        .sort()
        .pop() ?? addDays(start, 90)
    let f = addDays(start, -PAD[zoom])
    if (zoom === 'Month') f = `${f.slice(0, 7)}-01`
    while (zoom !== 'Month' && utc(f).getUTCDay() !== 1) f = addDays(f, -1)
    return { from: f, days: daysBetween(f, addDays(end, PAD[zoom] * 2)) + 1 }
  }, [visibleTasks, w.tasks, w.programme.project_start, zoom, today])
  const chartW = Math.ceil(days * dayW)
  const width = left + chartW
  const height = HEAD + Math.max(items.length, 1) * ROW
  const x = (d: string) => left + daysBetween(from, d) * dayW
  const scroller = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)

  // headings: columns by zoom; the top row shows the month, and Wk N where the week changes
  const monday = weekOneMonday(w)
  const columns = useMemo(() => {
    const out: { x: number; w: number; lower: string; upper: string; thick: boolean }[] = []
    let d = from
    let prev: string | null = null
    const end = addDays(from, days)
    while (d < end) {
      const next = zoom === 'Day' ? addDays(d, 1) : zoom === 'Week' ? addDays(d, 7) : zoom === 'Fortnight' ? addDays(d, 14) : addDays(`${d.slice(0, 7)}-01`, 32).slice(0, 7) + '-01'
      const last = addDays(next, -1)
      let lower: string
      if (zoom === 'Day') lower = dd(d)
      else if (zoom === 'Week') lower = `${dd(d)}${!prev || mon(prev) !== mon(d) ? ` ${mon(d)}` : ''} - ${dd(last)}${mon(last) !== mon(d) ? ` ${mon(last)}` : ''}`
      else if (zoom === 'Fortnight')
        lower = mon(last) === mon(d) ? `${Number(dd(d))} - ${Number(dd(last))} ${mon(d)}` : `${Number(dd(d))} ${mon(d)} - ${Number(dd(last))} ${mon(last)}`
      else lower = monthLong(d)
      let upper = ''
      if (zoom === 'Month') upper = !prev || prev.slice(0, 4) !== d.slice(0, 4) ? d.slice(0, 4) : ''
      else {
        const monthChanged = !prev || prev.slice(0, 7) !== d.slice(0, 7)
        const wn = weekNumber(d, monday)
        const weekChanged = wn !== null && (!prev || wn !== weekNumber(prev, monday))
        upper = [monthChanged ? monthLong(d) : '', weekChanged && (zoom !== 'Day' || utc(d).getUTCDay() === 1 || !prev) ? `Wk ${wn}` : ''].filter(Boolean).join(' · ')
      }
      out.push({ x: x(d), w: daysBetween(d, next) * dayW, lower, upper, thick: d.endsWith('-01') || (zoom === 'Week' && !!prev && prev.slice(0, 7) !== d.slice(0, 7)) })
      prev = d
      d = next
    }
    return out
  }, [from, days, zoom, dayW, monday]) // eslint-disable-line react-hooks/exhaustive-deps

  // scroll to today (or the first task)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const target = visibleTasks.length && today < visibleTasks.map((t) => t.start_date).sort()[0] ? visibleTasks.map((t) => t.start_date).sort()[0] : today
    el.scrollLeft = Math.max(0, x(target) - left - 140)
  }, [zoom, todayTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // ----- dragging a bar (move) or its right-hand end (length) -----
  const [drag, setDrag] = useState<{ code: string; mode: 'move' | 'end'; x0: number; dx: number } | null>(null)
  const shown = (t: ProgrammeTask): ProgrammeTask => {
    if (!drag || drag.code !== t.code) return t
    const n = Math.round(drag.dx / dayW)
    if (drag.mode === 'move') {
      const len = lengthOf(t, sd)
      const s = addDays(t.start_date, n)
      return { ...t, start_date: s, finish_date: t.milestone ? s : addDays(s, daysBetween(t.start_date, t.finish_date)), ...(len ? {} : {}) }
    }
    const f = addDays(t.finish_date, n)
    return { ...t, finish_date: f < t.start_date ? t.start_date : f }
  }
  const startDrag = (e: React.PointerEvent, code: string, mode: 'move' | 'end') => {
    e.preventDefault()
    e.stopPropagation()
    capture(e)
    setDrag({ code, mode, x0: e.clientX, dx: 0 })
  }
  const endDrag = () => {
    if (!drag) return
    const t = w.tasks.find((x) => x.code === drag.code)
    const n = Math.round(drag.dx / dayW)
    setDrag(null)
    if (!t) return
    if (Math.abs(drag.dx) < 4) return linking ? onLink(t.code) : onOpen(t.code)
    if (!n) return
    onApply(dragTo(w, t.code, drag.mode === 'move' ? { start_date: addDays(t.start_date, n) } : { finish_date: addDays(t.finish_date, n) }), `move ${t.name}`)
  }

  // ----- dragging a row in the task list (tasks and sections) -----
  const [rowDrag, setRowDrag] = useState<{ kind: 'task' | 'section'; key: string; y0: number; moved: boolean; target: number | null } | null>(null)
  const rowAt = (clientY: number) => {
    const top = inner.current?.getBoundingClientRect().top ?? 0
    return Math.max(0, Math.min(items.length, Math.round((clientY - top - HEAD) / ROW)))
  }
  const startRowDrag = (e: React.PointerEvent, kind: 'task' | 'section', key: string, grip: boolean) => {
    if ((e.target as Element).closest('button, input, select, a, .td-editable')) return
    if (e.pointerType !== 'mouse' && !grip) return // on a touch screen, rows move by their grip, so the list still scrolls
    e.preventDefault()
    capture(e)
    setRowDrag({ kind, key, y0: e.clientY, moved: false, target: null })
  }
  const moveRowDrag = (e: React.PointerEvent) => {
    if (!rowDrag) return
    const moved = rowDrag.moved || Math.abs(e.clientY - rowDrag.y0) > 4
    let target = moved ? rowAt(e.clientY) : null
    if (target !== null && rowDrag.kind === 'section') {
      // sections drop only before another section, or at the end
      while (target < items.length && items[target].kind !== 'section') target++
    }
    setRowDrag({ ...rowDrag, moved, target })
  }
  const endRowDrag = () => {
    if (!rowDrag) return
    const { kind, key, moved, target } = rowDrag
    setRowDrag(null)
    if (!moved) {
      if (kind === 'task') return linking ? onLink(key) : onOpen(key)
      return
    }
    const before = target === null || target >= items.length ? null : items[target]
    if (kind === 'task') onApply(moveTaskRow(w, key, !before ? null : before.kind === 'section' ? { section: before.name } : { code: before.t.code }), 'move a task')
    else onApply(moveSectionTo(w, key, before && before.kind === 'section' ? before.name : null), 'move a section')
  }

  // ----- typing in a start or a duration -----
  const [cell, setCell] = useState<{ code: string; field: 'start' | 'days'; value: string } | null>(null)
  const commitCell = () => {
    if (!cell) return
    const t = w.tasks.find((x) => x.code === cell.code)
    setCell(null)
    if (!t) return
    if (cell.field === 'start') {
      const iso = parseUKDate(cell.value, Number(t.start_date.slice(0, 4)), w.programme.project_start ?? null)
      if (iso && iso !== t.start_date) onApply(setStart(w, t.code, iso), `change ${t.name}'s start`)
    } else {
      const n = Math.max(1, parseInt(cell.value) || 0)
      if (n && n !== lengthOf(t, sd)) onApply(setDuration(w, t.code, n), `change ${t.name}'s days`)
    }
  }

  // ----- column widths (initColumnResize) -----
  const resize = (e: React.PointerEvent, i: number) => {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const a = colWidths[i]
    const b = colWidths[i + 1]
    const move = (ev: PointerEvent) => {
      const dx = Math.max(28 - a, Math.min(b - 28, ev.clientX - x0))
      onColWidths(colWidths.map((v, k) => (k === i ? a + dx : k === i + 1 ? b - dx : v)))
    }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.body.classList.remove('tl-col-resizing')
    }
    document.body.classList.add('tl-col-resizing')
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }
  const [sortDir, setSortDir] = useState<1 | -1 | 0>(0)

  // ----- where each bar is, for the links -----
  const at = new Map<string, { row: number; x1: number; x2: number }>()
  items.forEach((it, i) => {
    if (it.kind !== 'task') return
    const t = shown(it.t)
    const bx = x(t.start_date)
    const side = (BAR * MILESTONE_SCALE) / 1.4142
    at.set(
      t.code,
      t.milestone
        ? { row: i, x1: bx + dayW / 2 - side * 0.71, x2: bx + dayW / 2 + side * 0.71 }
        : { row: i, x1: bx, x2: bx + Math.max(dayW, (daysBetween(t.start_date, t.finish_date) + 1) * dayW) },
    )
  })
  const arrows: { key: string; d: string; hot: boolean }[] = []
  for (const it of items) {
    if (it.kind !== 'task') continue
    for (const l of it.t.predecessors ?? []) {
      const a = at.get(l.code)
      const b = at.get(it.t.code)
      if (!a || !b) continue
      const y1 = HEAD + a.row * ROW + ROW / 2
      const y2 = HEAD + b.row * ROW + ROW / 2
      const fromX = l.type === 'SS' ? a.x1 : a.x2
      const out = l.type === 'SS' ? fromX - 8 : fromX + 12
      let d: string
      if (l.type === 'FF') d = `M${fromX} ${y1}H${Math.max(out, b.x2 + 10)}V${y2}H${b.x2}`
      else if (b.x1 - 6 >= out) d = `M${fromX} ${y1}H${out}V${y2}H${b.x1}`
      else {
        const mid = y2 + (y2 > y1 ? -ROW / 2 : ROW / 2)
        d = `M${fromX} ${y1}H${out}V${mid}H${b.x1 - 8}V${y2}H${b.x1}`
      }
      arrows.push({ key: `${l.code}>${it.t.code}`, d, hot: critical.has(l.code) && critical.has(it.t.code) })
    }
  }

  const sectionSummary = (tasks: ProgrammeTask[]) => {
    if (!tasks.length) return 'No tasks yet'
    const min = tasks.map((t) => t.start_date).sort()[0]
    const max = tasks
      .map((t) => t.finish_date)
      .sort()
      .pop()!
    return `${tasks.length} task${tasks.length === 1 ? '' : 's'} · ${fmtShort(min)} – ${fmtShort(max)}`
  }
  const sectionIndex = (name: string) => (w.programme.sections ?? []).findIndex((s) => s.name === name)
  const grid = widths
    .filter((v) => v > 0)
    .map((v) => `${v}px`)
    .join(' ') // only the columns shown

  if (!w.tasks.length && !(w.programme.sections ?? []).length)
    return (
      <div className="tl-empty">
        No tasks yet.
        <div>
          <button className="tl-btn tl-btn-primary" onClick={onAddFirst}>
            + Add your first task
          </button>
        </div>
      </div>
    )

  return (
    <div className={`tl-scroll ${critOnly ? 'crit-only' : ''} ${linking ? 'link-mode' : ''}`} ref={scroller}>
      <div
        className="tl-inner"
        ref={inner}
        style={{ width, height, ['--left' as string]: `${left}px` }}
        onPointerMove={(e) => {
          if (drag) setDrag({ ...drag, dx: e.clientX - drag.x0 })
          else if (rowDrag) moveRowDrag(e)
        }}
        onPointerUp={() => (drag ? endDrag() : endRowDrag())}
        onPointerCancel={() => (setDrag(null), setRowDrag(null))}
      >
        {/* weekends and shutdowns */}
        {zoom !== 'Month' && (
          <div
            className="tl-weekends"
            style={{
              left,
              width: chartW,
              top: HEAD,
              height: height - HEAD,
              backgroundSize: `${7 * dayW}px 100%`,
              backgroundImage: `linear-gradient(to right, transparent 0 ${5 * dayW}px, var(--tl-weekend) ${5 * dayW}px ${7 * dayW}px)`,
            }}
          />
        )}
        {columns.map((c) => (
          <div key={`g${c.x}`} className={`tl-vline ${c.thick ? 'thick' : ''}`} style={{ left: c.x, top: HEAD, height: height - HEAD }} />
        ))}
        {sd.map((s, i) => (
          <div
            key={`s${i}`}
            className="tl-shutdown"
            style={{ left: x(s.start), width: (daysBetween(s.start, s.end) + 1) * dayW, top: HEAD, height: height - HEAD }}
            title={`${s.name}: ${fmtShort(s.start)} – ${fmtShort(s.end)}`}
          />
        ))}
        {today >= from && <div className="tl-today" style={{ left: x(today) + dayW / 2, top: HEAD - 6, height: height - HEAD + 6 }} title={`Today, ${fmtUKShort(today)}`} />}

        {/* headings */}
        <div className="tl-head" style={{ width, height: HEAD }}>
          <div className="tl-head-cols" style={{ width: left, gridTemplateColumns: grid }}>
            {COLS.map((label, i) =>
              widths[i] ? (
                <div key={i} className={`tl-th ${i === 3 ? 'num' : ''}`}>
                  {label}
                  {i === 2 && (
                    <button
                      className={`tl-sort ${sortDir ? 'active' : ''}`}
                      title="Sort tasks by start date (within each section)"
                      onClick={() => {
                        const dir = sortDir === 1 ? -1 : 1
                        setSortDir(dir)
                        onApply(sortByStart(w, dir), 'sort by start')
                      }}
                    >
                      {sortDir === 1 ? '↑' : sortDir === -1 ? '↓' : '⇅'}
                    </button>
                  )}
                  {!compact && i < COLS.length - 1 && <span className="tl-col-resize" onPointerDown={(e) => resize(e, i)} />}
                </div>
              ) : null,
            )}
          </div>
          {columns.map((c, i) => (
            <Fragment2 key={`h${i}`}>
              {c.upper && (
                <div className="tl-upper" style={{ left: c.x }}>
                  {c.upper}
                </div>
              )}
              <div className={`tl-lower ${c.thick ? 'thick' : ''}`} style={{ left: c.x, width: c.w }}>
                {c.w > 26 ? c.lower : ''}
              </div>
            </Fragment2>
          ))}
        </div>

        {/* links */}
        {arrows.length > 0 && (
          <svg className="tl-links" width={width} height={height} aria-hidden="true">
            <defs>
              <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L8 4L0 8z" fill="#8a87a8" />
              </marker>
              <marker id="tl-arrow-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L8 4L0 8z" fill={CRITICAL_COLOR} />
              </marker>
            </defs>
            {arrows.map((a) => (
              <path key={a.key} d={a.d} className={a.hot ? 'is-critical' : ''} markerEnd={`url(#tl-arrow${a.hot ? '-hot' : ''})`} />
            ))}
          </svg>
        )}

        {/* rows */}
        {items.map((it, i) => {
          const top = HEAD + i * ROW
          if (it.kind === 'section') {
            const idx = sectionIndex(it.name)
            return (
              <div key={`sec:${it.name}`} className={`tl-row tl-group ${rowDrag?.key === it.name ? 'row-dragging' : ''}`} style={{ top, width }}>
                <div className="tl-cells tl-group-cell" style={{ width: left }} onPointerDown={(e) => startRowDrag(e, 'section', it.name, false)}>
                  <button className="tl-icon" title={it.collapsed ? 'Expand section' : 'Collapse section'} onClick={() => onApply(toggleCollapse(w, it.name))}>
                    {it.collapsed ? '▸' : '▾'}
                  </button>
                  <span className="tl-group-name" title="Click to rename" onClick={() => onRenameSection(it.name)}>
                    {it.name}
                  </span>
                  {!compact && <span className="tl-group-summary">{sectionSummary(it.tasks)}</span>}
                  {!compact && (
                    <>
                      <button
                        className="tl-icon tl-group-action"
                        title="Move section up"
                        disabled={idx <= 0}
                        onClick={() => onApply(moveSection(w, it.name, -1), 'move a section')}
                      >
                        ▲
                      </button>
                      <button
                        className="tl-icon"
                        title="Move section down"
                        disabled={idx >= (w.programme.sections ?? []).length - 1}
                        onClick={() => onApply(moveSection(w, it.name, 1), 'move a section')}
                      >
                        ▼
                      </button>
                      <button className="tl-icon" title="Duplicate section (e.g. for repeating floors)" onClick={() => onDuplicateSection(it.name)}>
                        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
                          <rect x="7" y="7" width="10" height="10" rx="1.5" />
                          <path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7" />
                        </svg>
                      </button>
                      <button className="tl-icon" title="Delete section" onClick={() => onDeleteSection(it.name)}>
                        ✕
                      </button>
                    </>
                  )}
                  <span
                    className="tl-grip tl-group-action"
                    title="Drag to move the section"
                    onPointerDown={(e) => (e.stopPropagation(), startRowDrag(e, 'section', it.name, true))}
                  >
                    ⋮⋮
                  </span>
                </div>
                <div className="tl-band" style={{ left, width: chartW }}>
                  <span>{it.name}</span>
                </div>
              </div>
            )
          }
          const t = shown(it.t)
          const isCrit = critical.has(t.code)
          const color = tradeColorOf(w, t.trade)
          const bx = x(t.start_date)
          const bw = Math.max(dayW, (daysBetween(t.start_date, t.finish_date) + 1) * dayW)
          const s = slip(it.t)
          const was = compare?.bars.get(t.code)
          const cs = compare ? finishSlip(it.t, was, sd) : null
          const barTop = compare ? 4 : (ROW - BAR) / 2
          const barH = compare ? 14 : BAR
          const midY = barTop + barH / 2
          const len = lengthOf(it.t, sd)
          const side = (BAR * MILESTONE_SCALE) / 1.4142
          const labelInside = !t.milestone && bw > t.name.length * 6 + 16
          return (
            <div
              key={t.code}
              className={`tl-row ${selected === t.code ? 'selected' : ''} ${isCrit ? 'critical-path' : ''} ${linkFrom === t.code ? 'link-source' : ''} ${rowDrag?.key === t.code ? 'row-dragging' : ''}`}
              style={{ top, width }}
            >
              <div className="tl-cells" style={{ width: left, gridTemplateColumns: grid }} onPointerDown={(e) => startRowDrag(e, 'task', t.code, false)}>
                <div className="td-name" title={t.name}>
                  {t.milestone && <span className="ms-flag">◆</span>}
                  {t.name}
                </div>
                {widths[1] > 0 && (
                  <div>
                    <span className="trade-chip" title={[t.trade, t.contractor].filter(Boolean).join(' · ')}>
                      <span className="trade-swatch" style={{ background: color }} />
                      {t.trade}
                      {t.contractor && <span className="muted"> · {t.contractor}</span>}
                    </span>
                  </div>
                )}
                {widths[2] > 0 && (
                  <div className="td-editable" title="Click to edit" onClick={() => setCell({ code: t.code, field: 'start', value: fmtUKShort(it.t.start_date) })}>
                    {cell?.code === t.code && cell.field === 'start' ? (
                      <input
                        className="inline-edit"
                        autoFocus
                        value={cell.value}
                        placeholder="DD/MM/YY"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setCell({ ...cell, value: e.target.value })}
                        onKeyDown={(e) => (e.key === 'Enter' ? commitCell() : e.key === 'Escape' ? setCell(null) : undefined)}
                        onBlur={commitCell}
                      />
                    ) : (
                      fmtShort(it.t.start_date)
                    )}
                  </div>
                )}
                {widths[3] > 0 && (
                  <div
                    className={`num ${t.milestone ? '' : 'td-editable'}`}
                    title={t.milestone ? '' : 'Click to edit'}
                    onClick={() => !t.milestone && setCell({ code: t.code, field: 'days', value: String(len) })}
                  >
                    {cell?.code === t.code && cell.field === 'days' ? (
                      <input
                        className="inline-edit num"
                        type="number"
                        min={1}
                        autoFocus
                        value={cell.value}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setCell({ ...cell, value: e.target.value })}
                        onKeyDown={(e) => (e.key === 'Enter' ? commitCell() : e.key === 'Escape' ? setCell(null) : undefined)}
                        onBlur={commitCell}
                      />
                    ) : t.milestone ? (
                      '—'
                    ) : (
                      len
                    )}
                  </div>
                )}
                {widths[4] > 0 && (
                  <div>
                    <button className={`rag-dot rag-${t.rag ?? 'green'}`} title="Click to change RAG status" onClick={() => onApply(cycleRag(w, t.code))} />
                  </div>
                )}
                {widths[5] > 0 && (
                  <div>
                    <Prereq t={t} />
                  </div>
                )}
                {widths[6] > 0 && (
                  <div>
                    {compare ? (
                      !cs ? (
                        <span className="slip-badge slip-new" title={`Not in ${compare.label}`}>
                          new
                        </span>
                      ) : cs.days > 0 ? (
                        <span className="slip-badge slip-behind" title={`Finishes ${cs.working} working days later than in ${compare.label}`}>
                          +{cs.days}d
                        </span>
                      ) : cs.days < 0 ? (
                        <span className="slip-badge slip-ahead" title={`Finishes ${-cs.working} working days earlier than in ${compare.label}`}>
                          {cs.days}d
                        </span>
                      ) : (
                        <span className="slip-badge slip-none">on time</span>
                      )
                    ) : s === null ? (
                      <span className="slip-badge slip-none">—</span>
                    ) : s > 0 ? (
                      <span className="slip-badge slip-behind">+{s}d</span>
                    ) : s < 0 ? (
                      <span className="slip-badge slip-ahead">{s}d</span>
                    ) : (
                      <span className="slip-badge slip-none">on track</span>
                    )}
                  </div>
                )}
                {widths[7] > 0 && (
                  <div className="tl-actions">
                    <button className="tl-icon insert-section-btn" title="Insert a section break above this task" onClick={() => onInsertSectionBefore(t.code)}>
                      ＋
                    </button>
                    <span className="tl-grip" title="Drag to reorder" onPointerDown={(e) => (e.stopPropagation(), startRowDrag(e, 'task', t.code, true))}>
                      ⋮⋮
                    </span>
                  </div>
                )}
              </div>
              {/* the bar */}
              {t.milestone ? (
                <>
                  <div
                    className={`tl-mile ${isCrit ? 'is-critical' : ''}`}
                    style={{ left: bx + dayW / 2 - side / 2, top: midY - side / 2, width: side, height: side, background: color }}
                    onPointerDown={(e) => startDrag(e, t.code, 'move')}
                    title={`◆ ${t.name}: ${fmtShort(t.start_date)}`}
                  />
                  <span className="tl-bar-label after" style={{ left: bx + dayW / 2 + (BAR * MILESTONE_SCALE) / 2 + 6, lineHeight: `${midY * 2}px` }}>
                    {t.name}
                  </span>
                  <span
                    className="tl-rag-marker"
                    style={{ left: bx + dayW / 2 + (BAR * MILESTONE_SCALE) / 2 - 2, top: midY - BAR / 2 - 2, background: RAG_COLOR[t.rag ?? 'green'] }}
                  />
                </>
              ) : (
                <>
                  <div
                    className={`tl-bar ${isCrit ? 'is-critical' : ''}`}
                    style={{ left: bx, width: bw, top: barTop, height: barH, background: color }}
                    onPointerDown={(e) => startDrag(e, t.code, 'move')}
                    title={`${t.name}: ${fmtShort(t.start_date)} – ${fmtShort(t.finish_date)}, ${lengthOf(t, sd)} working days${t.skeleton ? ' (skeleton crew)' : ''}`}
                  >
                    {(t.progress ?? 0) > 0 && <div className="tl-progress" style={{ width: `${Math.min(100, t.progress ?? 0)}%` }} />}
                    {labelInside && (
                      <span className="tl-bar-label inside" style={{ lineHeight: `${barH}px` }}>
                        {t.name}
                      </span>
                    )}
                    <div className="tl-handle" onPointerDown={(e) => startDrag(e, t.code, 'end')} title="Drag to change its length" />
                  </div>
                  {!labelInside && (
                    <span className="tl-bar-label after" style={{ left: bx + bw + 6, lineHeight: `${midY * 2}px` }}>
                      {t.name}
                    </span>
                  )}
                  <span className="tl-rag-marker" style={{ left: bx + bw - 6, top: barTop - 2, background: RAG_COLOR[t.rag ?? 'green'] }} />
                </>
              )}
              {was && (
                <>
                  {was.milestone ? (
                    <span className="tl-ghost-mile" style={{ left: x(was.start_date) + dayW / 2 - 4, top: 19 }} title={`${compare!.label}: ${fmtShort(was.start_date)}`} />
                  ) : (
                    <span
                      className="tl-ghost"
                      style={{ left: x(was.start_date), width: Math.max(dayW, (daysBetween(was.start_date, was.finish_date) + 1) * dayW), top: 21 }}
                      title={`${compare!.label}: ${fmtShort(was.start_date)} – ${fmtShort(was.finish_date)}`}
                    />
                  )}
                  {t.finish_date !== was.finish_date && (
                    <span
                      className={`tl-slip-strip ${t.finish_date > was.finish_date ? 'late' : 'early'}`}
                      style={{
                        left: x(t.finish_date < was.finish_date ? t.finish_date : was.finish_date) + (was.milestone || t.milestone ? dayW / 2 : dayW),
                        width: Math.abs(daysBetween(was.finish_date, t.finish_date)) * dayW,
                        top: 21,
                      }}
                      title={cs ? `${cs.days > 0 ? '+' : ''}${cs.days} days (${cs.working > 0 ? '+' : ''}${cs.working} working days) against ${compare!.label}` : ''}
                    />
                  )}
                </>
              )}
              {t.skeleton && !t.milestone && calendarOf(t, sd).length === 0 && sd.length > 0 && (
                <span className="tl-skeleton" style={{ left: bx - 14 }} title="Skeleton crew: works through shutdowns" />
              )}
            </div>
          )
        })}
        {rowDrag?.moved && rowDrag.target !== null && <div className="tl-drop-line" style={{ top: HEAD + rowDrag.target * ROW - 1, width: left }} />}
      </div>
    </div>
  )
}

// pointer capture keeps a drag going outside the bar; harmless if the browser refuses
function capture(e: React.PointerEvent) {
  try {
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  } catch {
    /* not capturable */
  }
}

function Fragment2({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

// the prerequisite icon: a green tick once confirmed, an amber ! until then (with the note as its tip)
function Prereq({ t }: { t: ProgrammeTask }) {
  return t.prereq_confirmed ? (
    <svg className="prereq-icon" viewBox="0 0 20 20" fill="none">
      <title>Prerequisite confirmed</title>
      <circle cx="10" cy="10" r="9" fill="#e8f5e2" stroke="#a8d898" />
      <path d="M6 10l3 3 5-6" stroke="#1e7a10" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg className="prereq-icon" viewBox="0 0 20 20" fill="none">
      <title>{t.prereq_note ? `Not confirmed: ${t.prereq_note}` : 'Prerequisite not yet confirmed'}</title>
      <circle cx="10" cy="10" r="9" fill="#fdf3dc" stroke="#e8cc88" />
      <path d="M10 6v4.5" stroke="#7a5000" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="13.2" r="1" fill="#7a5000" />
    </svg>
  )
}
