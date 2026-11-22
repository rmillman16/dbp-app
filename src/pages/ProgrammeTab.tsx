import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { ukDate, todayIso } from '../lib/format'
import { saveError } from '../lib/offline'
import {
  addTask,
  deleteTask,
  loadProgramme,
  parseProgramme,
  renameSection,
  saveProgramme,
  startBlankProgramme,
  updateProgramme,
  updateTask,
  type Link,
  type LinkType,
  type ParsedProgramme,
  type ProgrammeTask,
  type SavedProgramme,
  type Shutdown,
  type Trade,
} from '../lib/programme'
import { addDays, chartRange, daysBetween, duration, finishFor, moved, nextCode, nextWorkingDay, stretched, tradeColor } from '../lib/programmeEdit'
import { LINK_TYPES, criticalPath, follows, recalendar, reschedule, workingDaysBetween } from '../lib/programmeLinks'
import { GENERATED_FILE } from '../lib/programmeGen'
import { loadPackages } from '../lib/cvr'
import GenerateProgramme from '../components/GenerateProgramme'
import { useJob } from './JobLayout'

type Zoom = 'day' | 'week' | 'month'
type Dates = Pick<ProgrammeTask, 'start_date' | 'finish_date'>
const DAY_W: Record<Zoom, number> = { day: 24, week: 9, month: 3 }
const ROW = 28
const HEAD = 44
const CRITICAL = '#c0392b'
const today = todayIso()
const monthLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
// Timeline's own task IDs (t + 7 letters/numbers) mean nothing to anyone, so aren't shown
const shownCode = (code: string) => (/^t[a-z0-9]{7}$/.test(code) ? '' : code)
const label = (t: ProgrammeTask) => [shownCode(t.code), t.name].filter(Boolean).join(' ')
const withDates = (t: ProgrammeTask, d?: Dates) => (d ? { ...t, ...d } : t)

// Job › Programme: the job's programme as a Gantt chart, edited here (Timeline, built into the app
// 21 Nov). Imported from DBP Timeline / P6 / MS Project, made from the SoW, or started blank. Tasks
// can be linked (finish to start etc.), so a change moves everything that follows it, and the
// critical path is shown. The cashflow and procurement read it as it's edited.
export default function ProgrammeTab() {
  const { job } = useJob()
  const [programme, setProgramme] = useState<SavedProgramme | null>(null)
  const [tasks, setTasks] = useState<ProgrammeTask[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [zoom, setZoom] = useState<Zoom>('week')
  const [editing, setEditing] = useState<ProgrammeTask | null>(null) // a task open in the editor (no id = new)
  const [trades, setTrades] = useState<string[]>([]) // the SoW's, for a programme made from it
  const [showCritical, setShowCritical] = useState(false)
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [linking, setLinking] = useState(false) // link mode: tap the task first, then the one that follows it
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  // full screen: the chart card fills the screen (the browser's own full screen where it has one,
  // e.g. laptops and Android; on an iPhone, which has none for a page, it fills the window)
  const [full, setFull] = useState(false)
  const card = useRef<HTMLElement>(null)
  const toggleFull = () => {
    if (!full) {
      setFull(true)
      card.current?.requestFullscreen?.().catch(() => {})
    } else {
      setFull(false)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }
  useEffect(() => {
    if (!full) return
    const left = () => !document.fullscreenElement && setFull(false) // Esc in the browser's full screen
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    document.addEventListener('fullscreenchange', left)
    document.addEventListener('keydown', esc)
    document.body.classList.add('no-scroll')
    return () => {
      document.removeEventListener('fullscreenchange', left)
      document.removeEventListener('keydown', esc)
      document.body.classList.remove('no-scroll')
    }
  }, [full])

  const reload = () =>
    loadProgramme(job.id).then(
      (p) => {
        setProgramme(p.programme)
        setTasks(p.tasks)
        setLoaded(true)
      },
      (e: Error) => setError(e.message),
    )
  useEffect(() => {
    reload()
    loadPackages(job.id).then(
      (ps) => setTrades(ps.filter((p) => p.kind === 'cost' && Number(p.budget ?? 0) > 0).map((p) => p.name)),
      () => setTrades([]),
    )
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const shutdowns: Shutdown[] = useMemo(() => programme?.shutdowns ?? [], [programme])
  const critical = useMemo(() => criticalPath(tasks, shutdowns), [tasks, shutdowns])

  const run = async (f: () => Promise<unknown>, done?: string) => {
    setError(null)
    setMsg(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    try {
      await f()
      if (done) setMsg(done)
      await reload()
    } catch (e) {
      const m = saveError(e)
      setError(/predecessors/.test(m) ? 'Links between tasks need script 025 run in Supabase first (supabase/README.md). Nothing else has changed.' : m)
      await reload()
    }
  }

  if (error && !loaded) return <p className="error">{error}</p>
  if (!loaded) return <p className="muted">Loading…</p>

  const ownTrades: Trade[] = programme?.trades ?? []
  const keepDates = async (list: ProgrammeTask[]) => {
    if (!programme || !list.length) return
    const start = list.map((t) => t.start_date).sort()[0]
    const finish = list
      .map((t) => t.finish_date)
      .sort()
      .pop()!
    if (start !== programme.start_date || finish !== programme.finish_date) await updateProgramme(programme.id, { start_date: start, finish_date: finish })
  }
  const fieldsOf = (t: ProgrammeTask) => ({
    name: t.name,
    section: t.section,
    trade: t.trade,
    start_date: t.start_date,
    finish_date: t.finish_date,
    milestone: t.milestone,
    ...(t.predecessors !== undefined ? { predecessors: t.predecessors } : {}),
  })
  // tasks changed (saved whole), then everything that follows them moved and saved too
  const commit = (edited: ProgrammeTask[], done: string) => {
    const merged = tasks.map((t) => edited.find((e) => e.code === t.code) ?? t)
    const moves = reschedule(
      merged,
      edited.map((e) => e.code),
      shutdowns,
    )
    const final = merged.map((t) => withDates(t, moves.get(t.code)))
    const editedCodes = new Set(edited.map((e) => e.code))
    const followers = [...moves.keys()].filter((c) => !editedCodes.has(c)).length
    setTasks(final) // straight away on the chart
    return run(
      async () => {
        const save = final.filter((t) => t.id && (editedCodes.has(t.code) || moves.has(t.code)))
        for (let i = 0; i < save.length; i += 10)
          await Promise.all(save.slice(i, i + 10).map((t) => updateTask(t.id!, editedCodes.has(t.code) ? fieldsOf(t) : { start_date: t.start_date, finish_date: t.finish_date })))
        await keepDates(final)
      },
      followers ? `${done} ${followers} following task${followers === 1 ? '' : 's'} moved with it.` : done,
    )
  }

  // a bar dragged: a linked task keeps its links, with the move added to their lag (as Timeline
  // does when a section is shifted)
  const dragged = (t: ProgrammeTask, fields: Partial<ProgrammeTask>) => {
    const next = { ...t, ...fields }
    if (t.predecessors?.length && fields.start_date && fields.start_date !== t.start_date) {
      const n = workingDaysBetween(t.start_date, fields.start_date, shutdowns)
      next.predecessors = t.predecessors.map((l) => ({ ...l, lag: (l.lag || 0) + n }))
    }
    commit([next], `${t.name} moved.`)
  }

  // link mode: the first task tapped, then the task that follows it (tap a linked pair again to
  // unlink them). The follower is then selected, so a run of tasks can be chained.
  const linkTap = (t: ProgrammeTask) => {
    if (!linkFrom) return setLinkFrom(t.code)
    if (linkFrom === t.code) return setLinkFrom(null)
    const first = tasks.find((x) => x.code === linkFrom)
    if (!first) return setLinkFrom(null)
    if (t.predecessors?.some((l) => l.code === linkFrom)) {
      setLinkFrom(null)
      return commit([{ ...t, predecessors: t.predecessors.filter((l) => l.code !== linkFrom) }], `Unlinked ${first.name} → ${t.name}.`)
    }
    if (follows(tasks, first.code, t.code)) return setError(`Can't link these: ${first.name} already follows ${t.name}, so it would go round in a loop.`)
    setLinkFrom(t.code)
    commit([{ ...t, predecessors: [...(t.predecessors ?? []), { code: first.code, type: 'FS', lag: 0 }] }], `Linked: ${t.name} starts after ${first.name} finishes.`)
  }
  const linkFromTask = tasks.find((t) => t.code === linkFrom)

  const editor =
    programme && editing && !linking ? (
      <TaskEditor
        task={editing}
        tasks={tasks}
        shutdowns={shutdowns}
        onCancel={() => setEditing(null)}
        onSave={(t) => {
          if (t.id) return commit([t], `${t.name} saved.`).then(() => setEditing(null))
          // a new task: placed by its links, if it has any
          const placed = withDates(t, reschedule([...tasks, t], [t.code], shutdowns).get(t.code))
          const { predecessors, ...rest } = placed
          return run(async () => {
            await addTask(programme.id, { ...rest, ...(predecessors?.length ? { predecessors } : {}), sort: Math.max(0, ...tasks.map((x) => x.sort ?? 0)) + 1 })
            await keepDates([...tasks, placed])
            setEditing(null)
          }, `${t.name} added.`)
        }}
        onDelete={(t) => {
          if (!t.id || !confirm(`Delete "${t.name}"?`)) return
          // links to it go too; what followed it is then placed by its other links
          const unlinked = tasks
            .filter((x) => x.predecessors?.some((l) => l.code === t.code))
            .map((x) => ({ ...x, predecessors: x.predecessors!.filter((l) => l.code !== t.code) }))
          setEditing(null)
          run(async () => {
            await deleteTask(t.id!)
            for (const x of unlinked) await updateTask(x.id!, { predecessors: x.predecessors })
          }, `${t.name} deleted.`)
        }}
      />
    ) : null

  return (
    <>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      {!programme ? (
        <StartCard
          job={job}
          trades={trades}
          onImport={(p, name) => run(() => saveProgramme(job.id, p, name), `Programme imported: ${p.tasks.length} activities.`)}
          onBlank={(s, pc) => run(() => startBlankProgramme(job.id, job.name, s, pc), 'Programme started.')}
          onGenerated={() => run(async () => {}, 'Simple programme made from the SoW.')}
        />
      ) : (
        <>
          <section className={`card programme-card ${full ? 'programme-full' : ''}`} ref={card}>
            <div className="pane-head">
              <h2>{programme.project_name || 'Programme'}</h2>
              <div className="form-actions">
                <span className="segmented" role="group" aria-label="Zoom">
                  {(['day', 'week', 'month'] as Zoom[]).map((z) => (
                    <button key={z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)}>
                      {z === 'day' ? 'Days' : z === 'week' ? 'Weeks' : 'Months'}
                    </button>
                  ))}
                </span>
                <button
                  className={showCritical ? 'on-critical' : ''}
                  onClick={() => (setShowCritical(!showCritical), setCriticalOnly(false))}
                  aria-pressed={showCritical}
                  title="Tasks that can't slip a day without pushing the finish out"
                >
                  Critical path ({critical.size})
                </button>
                {showCritical && (
                  <label className="check inline">
                    <input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} /> Only critical
                  </label>
                )}
                <button className={linking ? 'primary' : ''} onClick={() => (setLinking(!linking), setLinkFrom(null))} aria-pressed={linking}>
                  {linking ? 'Done linking' : 'Link tasks'}
                </button>
                <button onClick={toggleFull} aria-pressed={full} title={full ? 'Back to the page (Esc)' : 'Fill the screen with the chart'}>
                  {full ? '✕ Exit full screen' : '⛶ Full screen'}
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    const last = [...tasks].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).pop()
                    const start = nextWorkingDay(today > (programme.start_date ?? today) ? today : (programme.start_date ?? today), shutdowns)
                    setLinking(false)
                    setEditing({
                      code: nextCode(tasks),
                      name: '',
                      section: last?.section ?? null,
                      trade: null,
                      start_date: start,
                      finish_date: finishFor(start, 5, shutdowns),
                      milestone: false,
                      predecessors: [],
                    })
                  }}
                >
                  + Add task
                </button>
              </div>
            </div>
            {full && error && <p className="error">{error}</p>}
            {full && msg && <p className="saved">{msg}</p>}
            {linking ? (
              <p className="link-hint small">
                {linkFromTask ? (
                  <>
                    <strong>{linkFromTask.name}</strong> selected. Now tap the task that starts after it finishes (tap a linked task again to unlink it, or {linkFromTask.name}{' '}
                    again to start over).
                  </>
                ) : (
                  <>Tap the task that comes first.</>
                )}{' '}
                For start-to-start, finish-to-finish or a lag, open the task and change its link.
              </p>
            ) : (
              <p className="muted small">
                {tasks.length} activities · {ukDate(programme.start_date)} to {ukDate(programme.finish_date)} ·{' '}
                {programme.file_name === GENERATED_FILE ? 'made from the SoW' : `from ${programme.file_name}`}. Drag a bar to move it, drag its right-hand end to change its length,
                click it (or its name) to edit. Linked tasks move together. Durations are working days (Monday to Friday, less shutdowns). The{' '}
                <RouterLink to="../cashflow">cashflow</RouterLink> and <RouterLink to="../procurement">procurement</RouterLink> work from this programme.
              </p>
            )}
            {programme.file_name === GENERATED_FILE && (
              <p className="warning small">A simple programme made from the SoW: edit it here, or import the real one below to replace it.</p>
            )}
            <Gantt
              tasks={criticalOnly ? tasks.filter((t) => critical.has(t.code)) : tasks}
              shutdowns={shutdowns}
              trades={ownTrades}
              zoom={zoom}
              fallback={programme.start_date ?? today}
              selected={linking ? (linkFrom ?? null) : (editing?.code ?? null)}
              critical={showCritical ? critical : null}
              onOpen={(t) => (linking ? linkTap(t) : setEditing(t))}
              onChange={dragged}
              onRenameSection={(from) => {
                const to = window.prompt('Section name', from ?? '')
                if (to && to.trim() && to.trim() !== from) run(() => renameSection(programme.id, from, to.trim()), 'Section renamed.')
              }}
            />
            {full && editor && <div className="full-editor">{editor}</div>}
          </section>
          {!full && editor}
          <TradesCard tasks={tasks} trades={ownTrades} onSave={(list) => run(() => updateProgramme(programme.id, { trades: list }), 'Trade colours saved.')} />
          <ShutdownsCard
            shutdowns={shutdowns}
            onSave={(list) => {
              // durations are working days, so tasks across a new shutdown finish later (and their followers move)
              const moves = recalendar(tasks, shutdowns, list)
              setTasks(tasks.map((t) => withDates(t, moves.get(t.code))))
              run(
                async () => {
                  await updateProgramme(programme.id, { shutdowns: list })
                  const save = tasks.filter((t) => t.id && moves.has(t.code))
                  for (let i = 0; i < save.length; i += 10) await Promise.all(save.slice(i, i + 10).map((t) => updateTask(t.id!, moves.get(t.code)!)))
                  await keepDates(tasks.map((t) => withDates(t, moves.get(t.code))))
                },
                moves.size ? `Shutdowns saved. ${moves.size} task${moves.size === 1 ? '' : 's'} moved to work around them.` : 'Shutdowns saved.',
              )
            }}
          />
          <section className="card">
            <details className="fold">
              <summary>
                <h2>Import a new revision</h2>
                <span className="muted small">from DBP Timeline (.json / P6 .xer) or MS Project (.xml): replaces this programme</span>
              </summary>
              <ImportBox onImport={(p, name) => run(() => saveProgramme(job.id, p, name), `Programme imported: ${p.tasks.length} activities.`)} />
              {programme.file_name === GENERATED_FILE && (
                <GenerateProgramme job={job} trades={trades} onSaved={() => run(async () => {}, 'Simple programme made again from the SoW.')} />
              )}
            </details>
          </section>
        </>
      )}
    </>
  )
}

// ---------- no programme yet: import one, make one from the SoW, or start blank ----------
function StartCard({
  job,
  trades,
  onImport,
  onBlank,
  onGenerated,
}: {
  job: ReturnType<typeof useJob>['job']
  trades: string[]
  onImport: (p: ParsedProgramme, name: string) => void
  onBlank: (start: string, pc: string) => void
  onGenerated: () => void
}) {
  const [start, setStart] = useState(job.start_date ?? '')
  const [pc, setPc] = useState(job.pc_date ?? '')
  return (
    <section className="card">
      <h2>Programme</h2>
      <p className="muted small">No programme on this job yet. Start one in any of these ways; you can edit it here afterwards, and the cashflow and procurement work from it.</p>
      <h3>Import it</h3>
      <ImportBox onImport={onImport} />
      <h3>Make a simple one from the SoW</h3>
      <GenerateProgramme job={job} trades={trades} onSaved={onGenerated} />
      <h3>Start a blank one</h3>
      <div className="form-grid">
        <label>
          Start on site
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          Practical completion
          <input type="date" value={pc} onChange={(e) => setPc(e.target.value)} />
        </label>
      </div>
      <div className="form-actions">
        <button onClick={() => onBlank(start, pc)} disabled={!start || !pc || pc <= start}>
          Start a blank programme
        </button>
      </div>
    </section>
  )
}

function ImportBox({ onImport }: { onImport: (p: ParsedProgramme, name: string) => void }) {
  const [pending, setPending] = useState<{ p: ParsedProgramme; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const links = pending ? pending.p.tasks.reduce((n, t) => n + (t.predecessors?.length ?? 0), 0) : 0
  return (
    <div className="import-box">
      <label className="file-button">
        <input
          type="file"
          accept=".xer,.xml,.mpp,.json"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            setError(null)
            try {
              setPending({ p: await parseProgramme(f), name: f.name })
            } catch (err) {
              setError((err as Error).message)
            }
          }}
        />
        <span className="button">Choose the programme file…</span>
      </label>
      {error && <p className="error">{error}</p>}
      {pending && (
        <>
          <p className="small">
            <strong>{pending.p.project_name}</strong>: {pending.p.tasks.length} activities{links ? `, ${links} links` : ''}, {ukDate(pending.p.start_date)} to{' '}
            {ukDate(pending.p.finish_date)}
            {pending.p.shutdowns?.length ? ` · shutdowns: ${pending.p.shutdowns.map((s) => s.name).join(', ')}` : ''}
          </p>
          <div className="form-actions">
            <button className="primary" onClick={() => (onImport(pending.p, pending.name), setPending(null))}>
              Use this programme
            </button>
            <button onClick={() => setPending(null)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}

// ---------- the Gantt chart ----------
function Gantt({
  tasks,
  shutdowns,
  trades,
  zoom,
  fallback,
  selected,
  critical,
  onOpen,
  onChange,
  onRenameSection,
}: {
  tasks: ProgrammeTask[]
  shutdowns: Shutdown[]
  trades: Trade[]
  zoom: Zoom
  fallback: string
  selected: string | null // a task code
  critical: Set<string> | null // shown when set
  onOpen: (t: ProgrammeTask) => void
  onChange: (t: ProgrammeTask, fields: Partial<ProgrammeTask>) => void
  onRenameSection: (from: string | null) => void
}) {
  const dayW = DAY_W[zoom]
  const left = typeof window !== 'undefined' && window.innerWidth < 640 ? 150 : 290
  const { from, days } = useMemo(() => chartRange(tasks, fallback), [tasks, fallback])
  const x = (d: string) => left + daysBetween(from, d) * dayW
  const width = left + days * dayW
  const [drag, setDrag] = useState<{ code: string; mode: 'move' | 'end'; x0: number; dx: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // sections in the programme's order, their tasks in order
  const rows = useMemo(() => {
    const order: (string | null)[] = []
    const sorted = [...tasks].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.start_date.localeCompare(b.start_date))
    for (const t of sorted) if (!order.includes(t.section)) order.push(t.section)
    return order.flatMap((s) => [{ kind: 'section' as const, section: s }, ...sorted.filter((t) => t.section === s).map((t) => ({ kind: 'task' as const, t }))])
  }, [tasks])

  // scroll to today (or the start) once
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = Math.max(0, x(today > from ? today : from) - left - 120)
  }, [zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  // the month and week headings
  const months: { label: string; x: number; w: number }[] = []
  const weeks: { label: string; x: number }[] = []
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i)
    if (i === 0 || d.endsWith('-01')) months.push({ label: monthLabel(d), x: left + i * dayW, w: 0 })
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 1) weeks.push({ label: d.slice(8, 10), x: left + i * dayW })
  }
  months.forEach((m, i) => (m.w = (months[i + 1]?.x ?? width) - m.x))
  // a bar while it's dragged (just this one: what follows it moves when it's dropped)
  const shown = (t: ProgrammeTask) =>
    drag && drag.code === t.code ? { ...t, ...(drag.mode === 'move' ? moved(t, Math.round(drag.dx / dayW), shutdowns) : stretched(t, Math.round(drag.dx / dayW))) } : t
  const height = HEAD + rows.length * ROW

  // where each task's bar is, for the link arrows
  const at = new Map<string, { row: number; x1: number; x2: number }>()
  rows.forEach((r, i) => {
    if (r.kind !== 'task') return
    const t = shown(r.t)
    const bx = x(t.start_date)
    at.set(
      t.code,
      t.milestone ? { row: i, x1: bx + dayW / 2 - 7, x2: bx + dayW / 2 + 7 } : { row: i, x1: bx, x2: bx + Math.max(dayW, (daysBetween(t.start_date, t.finish_date) + 1) * dayW) },
    )
  })
  const arrows: { key: string; d: string; hot: boolean }[] = []
  for (const r of rows) {
    if (r.kind !== 'task') continue
    for (const l of r.t.predecessors ?? []) {
      const a = at.get(l.code)
      const b = at.get(r.t.code)
      if (!a || !b) continue
      const y1 = HEAD + a.row * ROW + ROW / 2
      const y2 = HEAD + b.row * ROW + ROW / 2
      const fromX = l.type === 'SS' ? a.x1 : a.x2
      const out = l.type === 'SS' ? fromX - 6 : fromX + 6
      let d: string
      if (l.type === 'FF') d = `M${fromX} ${y1}H${Math.max(out, b.x2 + 6)}V${y2}H${b.x2}`
      else if (b.x1 - 6 >= out) d = `M${fromX} ${y1}H${out}V${y2}H${b.x1}`
      else {
        const mid = y2 + (y2 > y1 ? -ROW / 2 : ROW / 2)
        d = `M${fromX} ${y1}H${out}V${mid}H${b.x1 - 6}V${y2}H${b.x1}`
      }
      arrows.push({ key: `${l.code}>${r.t.code}`, d, hot: !!critical && critical.has(l.code) && critical.has(r.t.code) })
    }
  }

  return (
    <div className="gantt-scroll" ref={scroller}>
      <div
        className="gantt"
        style={{
          width,
          height,
          ['--left' as string]: `${left}px`,
          backgroundSize: `${7 * dayW}px 100%`,
          backgroundPosition: `${left}px 0`,
          backgroundImage: zoom === 'month' ? 'none' : `linear-gradient(to right, transparent 0 ${5 * dayW}px, rgba(31,18,70,0.05) ${5 * dayW}px ${7 * dayW}px)`,
        }}
        onPointerMove={(e) => drag && setDrag({ ...drag, dx: e.clientX - drag.x0 })}
        onPointerUp={() => {
          if (!drag) return
          const t = tasks.find((x) => x.code === drag.code)
          const n = Math.round(drag.dx / dayW)
          if (t && Math.abs(drag.dx) < 4) onOpen(t)
          else if (t && n) onChange(t, drag.mode === 'move' ? moved(t, n, shutdowns) : stretched(t, n))
          setDrag(null)
        }}
      >
        {/* headings */}
        <div className="gantt-head" style={{ width }}>
          <div className="gantt-corner">Task</div>
          {months.map((m) => (
            <div key={m.x} className="gantt-month" style={{ left: m.x, width: m.w }}>
              {m.w > 30 ? m.label : ''}
            </div>
          ))}
          {zoom !== 'month' &&
            weeks.map((w) => (
              <div key={w.x} className="gantt-week" style={{ left: w.x }}>
                {w.label}
              </div>
            ))}
        </div>
        {/* shutdowns and today */}
        {shutdowns.map((s, i) => (
          <div
            key={i}
            className="gantt-shut"
            style={{ left: x(s.start), width: (daysBetween(s.start, s.end) + 1) * dayW, top: HEAD, height: rows.length * ROW }}
            title={`${s.name}: ${ukDate(s.start)} to ${ukDate(s.end)}`}
          />
        ))}
        {today >= from && <div className="gantt-today" style={{ left: x(today) + dayW / 2, top: HEAD, height: rows.length * ROW }} title={`Today, ${ukDate(today)}`} />}
        {/* links */}
        {arrows.length > 0 && (
          <svg className="gantt-links" width={width} height={height} aria-hidden="true">
            <defs>
              <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L8 4L0 8z" fill="#8a87a8" />
              </marker>
              <marker id="gantt-arrow-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L8 4L0 8z" fill={CRITICAL} />
              </marker>
            </defs>
            {arrows.map((a) => (
              <path key={a.key} d={a.d} className={a.hot ? 'hot' : ''} markerEnd={`url(#gantt-arrow${a.hot ? '-hot' : ''})`} />
            ))}
          </svg>
        )}
        {/* rows */}
        {rows.map((r, i) =>
          r.kind === 'section' ? (
            <div key={`s${i}`} className="gantt-row gantt-section" style={{ top: HEAD + i * ROW, width }}>
              <button className="gantt-name" onClick={() => onRenameSection(r.section)} title="Rename this section">
                {r.section ?? 'No section'}
              </button>
            </div>
          ) : (
            <Fragment key={r.t.code}>
              {(() => {
                const t = shown(r.t)
                const isCritical = !!critical && critical.has(t.code)
                const color = isCritical ? CRITICAL : tradeColor(t.trade, trades)
                const dim = !!critical && !isCritical
                const bx = x(t.start_date)
                const bw = Math.max(dayW, (daysBetween(t.start_date, t.finish_date) + 1) * dayW)
                const start = (e: React.PointerEvent, mode: 'move' | 'end') => {
                  if (!r.t.id) return
                  e.preventDefault()
                  e.stopPropagation()
                  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
                  setDrag({ code: r.t.code, mode, x0: e.clientX, dx: 0 })
                }
                const links = t.predecessors?.length ? ` · follows ${t.predecessors.length}` : ''
                return (
                  <div className={`gantt-row ${selected === r.t.code ? 'selected' : ''} ${dim ? 'dim' : ''}`} style={{ top: HEAD + i * ROW, width }}>
                    <button className="gantt-name" onClick={() => onOpen(r.t)} title={label(t)}>
                      {shownCode(t.code) && <span className="muted">{shownCode(t.code)}</span>} {t.name}
                    </button>
                    {t.milestone ? (
                      <div
                        className="gantt-mile"
                        style={{ left: bx + dayW / 2 - 7, background: color }}
                        onPointerDown={(e) => start(e, 'move')}
                        title={`◆ ${t.name}: ${ukDate(t.start_date)}${links}`}
                      />
                    ) : (
                      <div
                        className="gantt-bar"
                        style={{ left: bx, width: bw, background: color }}
                        onPointerDown={(e) => start(e, 'move')}
                        title={`${t.name}: ${ukDate(t.start_date)} to ${ukDate(t.finish_date)}, ${duration(t, shutdowns)} days${links}`}
                      >
                        {bw > 70 && <span>{t.name}</span>}
                        <div className="gantt-handle" onPointerDown={(e) => start(e, 'end')} title="Drag to change its length" />
                      </div>
                    )}
                    {!t.milestone && bw <= 70 && (
                      <span className="gantt-after" style={{ left: bx + bw + 4 }}>
                        {t.name}
                      </span>
                    )}
                  </div>
                )
              })()}
            </Fragment>
          ),
        )}
      </div>
    </div>
  )
}

// ---------- one task ----------
function TaskEditor({
  task,
  tasks,
  shutdowns,
  onSave,
  onCancel,
  onDelete,
}: {
  task: ProgrammeTask
  tasks: ProgrammeTask[]
  shutdowns: Shutdown[]
  onSave: (t: ProgrammeTask) => void
  onCancel: () => void
  onDelete: (t: ProgrammeTask) => void
}) {
  const [t, setT] = useState(task)
  const [days, setDays] = useState(String(duration(task, shutdowns) || 5))
  useEffect(() => {
    setT(task)
    setDays(String(duration(task, shutdowns) || 5))
  }, [task]) // eslint-disable-line react-hooks/exhaustive-deps
  const sections = [...new Set(tasks.map((x) => x.section).filter((s): s is string => !!s))]
  const trades = [...new Set(tasks.map((x) => x.trade).filter((s): s is string => !!s))]
  const links = t.predecessors ?? []
  // start and duration set the finish (a milestone is one day)
  const dated = (p: Partial<ProgrammeTask>, d = days): ProgrammeTask => {
    const next = { ...t, ...p }
    const start = nextWorkingDay(next.start_date, shutdowns)
    return { ...next, start_date: start, finish_date: next.milestone ? start : finishFor(start, Number(d) || 1, shutdowns) }
  }
  // with links, the start is where they put it
  const others = tasks.filter((x) => x.code !== t.code)
  const placed = links.length ? withDates(t, reschedule([...others, t], [t.code], shutdowns).get(t.code)) : t
  // tasks it can follow: not itself, and not one that already follows it (a loop)
  const canFollow = others.filter((x) => !follows(tasks, x.code, t.code))
  const followedBy = others.filter((x) => x.predecessors?.some((l) => l.code === t.code))
  const setLink = (i: number, p: Partial<Link>) => setT({ ...t, predecessors: links.map((l, k) => (k === i ? { ...l, ...p } : l)) })
  return (
    <section className="card">
      <h2>{task.id ? `Edit ${label(task)}` : `New task ${task.code}`}</h2>
      <div className="form-grid">
        <label className="span-2">
          Task
          <input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="e.g. Joinery installation" autoFocus />
        </label>
        <label>
          Section
          <input list="prog-sections" value={t.section ?? ''} onChange={(e) => setT({ ...t, section: e.target.value || null })} placeholder="e.g. Ground floor" />
          <datalist id="prog-sections">
            {sections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <span className="hint">Type a new name for a new section</span>
        </label>
        <label>
          Trade
          <input list="prog-trades" value={t.trade ?? ''} onChange={(e) => setT({ ...t, trade: e.target.value || null })} placeholder="e.g. Joinery & Fit-out" />
          <datalist id="prog-trades">
            {trades.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label>
          Start
          <input type="date" value={placed.start_date} disabled={links.length > 0} onChange={(e) => e.target.value && setT(dated({ start_date: e.target.value }))} />
          {links.length > 0 && <span className="hint">Set by its links: add a lag to move it</span>}
        </label>
        {!t.milestone && (
          <label>
            Duration (working days)
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={days}
              onChange={(e) => {
                setDays(e.target.value)
                if (Number(e.target.value) > 0) setT(dated({}, e.target.value))
              }}
            />
          </label>
        )}
        <label className="check">
          <span>
            <input type="checkbox" checked={t.milestone} onChange={(e) => setT(dated({ milestone: e.target.checked }))} /> Milestone ◆
          </span>
        </label>
      </div>
      <p className="small">
        {placed.milestone ? `On ${ukDate(placed.start_date)}` : `${ukDate(placed.start_date)} to ${ukDate(placed.finish_date)}: ${duration(placed, shutdowns)} working days`}
        {shutdowns.length > 0 && <span className="muted"> (weekends and shutdowns not counted)</span>}
      </p>

      <h3>Follows</h3>
      {links.length === 0 && <p className="muted small">Not linked: it stays where it's put. Link it to the task it follows and it moves when that task does.</p>}
      {links.map((l, i) => (
        <div key={i} className="link-row">
          <select value={l.code} onChange={(e) => setLink(i, { code: e.target.value })} aria-label="Task it follows">
            {canFollow
              .filter((x) => x.code === l.code || !links.some((y) => y.code === x.code))
              .map((x) => (
                <option key={x.code} value={x.code}>
                  {label(x)}
                </option>
              ))}
          </select>
          <select value={l.type} onChange={(e) => setLink(i, { type: e.target.value as LinkType })} aria-label="How it follows">
            {LINK_TYPES.map((k) => (
              <option key={k.type} value={k.type}>
                {k.label}
              </option>
            ))}
          </select>
          <label className="lag">
            Lag
            <input
              type="number"
              step={1}
              inputMode="numeric"
              value={l.lag}
              onChange={(e) => setLink(i, { lag: Math.round(Number(e.target.value) || 0) })}
              title="Working days between them (negative to overlap)"
            />
            days
          </label>
          <button className="small-button" onClick={() => setT({ ...t, predecessors: links.filter((_, k) => k !== i) })} aria-label="Remove this link">
            ✕
          </button>
        </div>
      ))}
      {canFollow.some((x) => !links.some((l) => l.code === x.code)) && (
        <button
          className="small-button"
          onClick={() => {
            // the task just above it is the likeliest
            const sorted = [...canFollow].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
            const above = sorted.filter((x) => (x.sort ?? 0) < (t.sort ?? Infinity) && !links.some((l) => l.code === x.code)).pop()
            const pick = above ?? sorted.find((x) => !links.some((l) => l.code === x.code))!
            setT({ ...t, predecessors: [...links, { code: pick.code, type: 'FS', lag: 0 }] })
          }}
        >
          + Follows another task
        </button>
      )}
      {followedBy.length > 0 && <p className="muted small">Followed by: {followedBy.map(label).join(' · ')}. They move when this does.</p>}

      <div className="form-actions">
        <button className="primary" onClick={() => onSave(placed)} disabled={!t.name.trim()}>
          Save
        </button>
        <button onClick={onCancel}>Cancel</button>
        {task.id && (
          <button className="danger" onClick={() => onDelete(task)}>
            Delete
          </button>
        )}
      </div>
    </section>
  )
}

// ---------- trade colours ----------
function TradesCard({ tasks, trades, onSave }: { tasks: ProgrammeTask[]; trades: Trade[]; onSave: (list: Trade[]) => void }) {
  const used = [...new Set(tasks.map((t) => t.trade).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'en-GB'))
  const [colors, setColors] = useState<Record<string, string>>({})
  useEffect(() => setColors(Object.fromEntries(used.map((n) => [n, tradeColor(n, trades)]))), [tasks, trades]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!used.length) return null
  return (
    <section className="card">
      <details className="fold">
        <summary>
          <h2>Trades</h2>
          <span className="muted small">{used.length} trades, coloured on the chart</span>
        </summary>
        <ul className="trade-list">
          {used.map((n) => (
            <li key={n}>
              <input type="color" value={colors[n] ?? '#7d8597'} onChange={(e) => setColors({ ...colors, [n]: e.target.value })} aria-label={`${n} colour`} />
              <span>{n}</span>
            </li>
          ))}
        </ul>
        <div className="form-actions">
          <button className="primary" onClick={() => onSave(used.map((n) => ({ name: n, color: colors[n] })))}>
            Save colours
          </button>
        </div>
      </details>
    </section>
  )
}

// ---------- shutdowns ----------
function ShutdownsCard({ shutdowns, onSave }: { shutdowns: Shutdown[]; onSave: (list: Shutdown[]) => void }) {
  const [list, setList] = useState<Shutdown[]>(shutdowns)
  useEffect(() => setList(shutdowns), [shutdowns])
  const set = (i: number, p: Partial<Shutdown>) => setList(list.map((s, k) => (k === i ? { ...s, ...p } : s)))
  return (
    <section className="card">
      <details className="fold">
        <summary>
          <h2>Shutdowns</h2>
          <span className="muted small">{shutdowns.length ? shutdowns.map((s) => s.name).join(' · ') : 'none (e.g. Christmas)'}</span>
        </summary>
        <p className="muted small">
          Days the site is shut aren't working days: durations skip them, and they're shaded on the chart. Saving moves any task that runs into one (and what follows it).
        </p>
        {list.map((s, i) => (
          <div key={i} className="split-row">
            <input value={s.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="e.g. Christmas" aria-label="Name" />
            <input type="date" value={s.start} onChange={(e) => set(i, { start: e.target.value })} aria-label="From" />
            <input type="date" value={s.end} onChange={(e) => set(i, { end: e.target.value })} aria-label="To" />
            <button className="small-button" onClick={() => setList(list.filter((_, k) => k !== i))} aria-label="Remove">
              ✕
            </button>
          </div>
        ))}
        <div className="form-actions">
          <button className="small-button" onClick={() => setList([...list, { name: 'Christmas', start: '', end: '' }])}>
            + Add a shutdown
          </button>
          <button className="primary" disabled={list.some((s) => !s.name.trim() || !s.start || !s.end || s.end < s.start)} onClick={() => onSave(list)}>
            Save shutdowns
          </button>
        </div>
      </details>
    </section>
  )
}
