import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
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
  type ParsedProgramme,
  type ProgrammeTask,
  type SavedProgramme,
  type Shutdown,
  type Trade,
} from '../lib/programme'
import { addDays, chartRange, daysBetween, duration, finishFor, moved, nextCode, nextWorkingDay, stretched, tradeColor } from '../lib/programmeEdit'
import { GENERATED_FILE } from '../lib/programmeGen'
import { loadPackages } from '../lib/cvr'
import GenerateProgramme from '../components/GenerateProgramme'
import { useJob } from './JobLayout'

type Zoom = 'day' | 'week' | 'month'
const DAY_W: Record<Zoom, number> = { day: 24, week: 9, month: 3 }
const ROW = 28
const today = todayIso()
const monthLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })

// Job › Programme: the job's programme as a Gantt chart, edited here (Timeline, built into the app
// 21 Nov). Imported from DBP Timeline / P6 / MS Project, made from the SoW, or started blank. The
// cashflow and procurement read it as it's edited.
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

  const run = async (f: () => Promise<unknown>, done?: string) => {
    setError(null)
    setMsg(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    try {
      await f()
      if (done) setMsg(done)
      await reload()
    } catch (e) {
      setError(saveError(e))
    }
  }

  if (error && !loaded) return <p className="error">{error}</p>
  if (!loaded) return <p className="muted">Loading…</p>

  const shutdowns: Shutdown[] = programme?.shutdowns ?? []
  const ownTrades: Trade[] = programme?.trades ?? []
  // a task saved, then the programme's overall dates kept to its tasks
  const saveTask = (id: string, fields: Partial<ProgrammeTask>) =>
    run(async () => {
      setTasks(tasks.map((t) => (t.id === id ? { ...t, ...fields } : t))) // straight away on the chart
      await updateTask(id, fields)
      await keepDates(tasks.map((t) => (t.id === id ? { ...t, ...fields } : t)))
    })
  const keepDates = async (list: ProgrammeTask[]) => {
    if (!programme || !list.length) return
    const start = list.map((t) => t.start_date).sort()[0]
    const finish = list
      .map((t) => t.finish_date)
      .sort()
      .pop()!
    if (start !== programme.start_date || finish !== programme.finish_date) await updateProgramme(programme.id, { start_date: start, finish_date: finish })
  }

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
          <section className="card">
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
                  className="primary"
                  onClick={() => {
                    const last = [...tasks].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).pop()
                    const start = nextWorkingDay(today > (programme.start_date ?? today) ? today : (programme.start_date ?? today), shutdowns)
                    setEditing({
                      code: nextCode(tasks),
                      name: '',
                      section: last?.section ?? null,
                      trade: null,
                      start_date: start,
                      finish_date: finishFor(start, 5, shutdowns),
                      milestone: false,
                    })
                  }}
                >
                  + Add task
                </button>
              </div>
            </div>
            <p className="muted small">
              {tasks.length} activities · {ukDate(programme.start_date)} to {ukDate(programme.finish_date)} ·{' '}
              {programme.file_name === GENERATED_FILE ? 'made from the SoW' : `from ${programme.file_name}`}. Drag a bar to move it, drag its right-hand end to change its length,
              click it (or its name) to edit. Durations are working days (Monday to Friday, less shutdowns). The <Link to="../cashflow">cashflow</Link> and{' '}
              <Link to="../procurement">procurement</Link> work from this programme.
            </p>
            {programme.file_name === GENERATED_FILE && (
              <p className="warning small">A simple programme made from the SoW: edit it here, or import the real one below to replace it.</p>
            )}
            <Gantt
              tasks={tasks}
              shutdowns={shutdowns}
              trades={ownTrades}
              zoom={zoom}
              fallback={programme.start_date ?? today}
              selected={editing?.id ?? null}
              onOpen={(t) => setEditing(t)}
              onChange={(t, fields) => t.id && saveTask(t.id, fields)}
              onRenameSection={(from) => {
                const to = window.prompt('Section name', from ?? '')
                if (to && to.trim() && to.trim() !== from) run(() => renameSection(programme.id, from, to.trim()), 'Section renamed.')
              }}
            />
          </section>
          {editing && (
            <TaskEditor
              task={editing}
              tasks={tasks}
              shutdowns={shutdowns}
              onCancel={() => setEditing(null)}
              onSave={(t) =>
                run(
                  async () => {
                    if (t.id)
                      await updateTask(t.id, { name: t.name, section: t.section, trade: t.trade, start_date: t.start_date, finish_date: t.finish_date, milestone: t.milestone })
                    else await addTask(programme.id, { ...t, sort: Math.max(0, ...tasks.map((x) => x.sort ?? 0)) + 1 })
                    await keepDates(t.id ? tasks.map((x) => (x.id === t.id ? t : x)) : [...tasks, t])
                    setEditing(null)
                  },
                  `${t.name || 'Task'} saved.`,
                )
              }
              onDelete={(t) => t.id && confirm(`Delete "${t.name}"?`) && run(() => deleteTask(t.id!).then(() => setEditing(null)), 'Task deleted.')}
            />
          )}
          <TradesCard tasks={tasks} trades={ownTrades} onSave={(list) => run(() => updateProgramme(programme.id, { trades: list }), 'Trade colours saved.')} />
          <ShutdownsCard shutdowns={shutdowns} onSave={(list) => run(() => updateProgramme(programme.id, { shutdowns: list }), 'Shutdowns saved.')} />
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
            <strong>{pending.p.project_name}</strong>: {pending.p.tasks.length} activities, {ukDate(pending.p.start_date)} to {ukDate(pending.p.finish_date)}
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
  onOpen,
  onChange,
  onRenameSection,
}: {
  tasks: ProgrammeTask[]
  shutdowns: Shutdown[]
  trades: Trade[]
  zoom: Zoom
  fallback: string
  selected: string | null
  onOpen: (t: ProgrammeTask) => void
  onChange: (t: ProgrammeTask, fields: Partial<ProgrammeTask>) => void
  onRenameSection: (from: string | null) => void
}) {
  const dayW = DAY_W[zoom]
  const left = typeof window !== 'undefined' && window.innerWidth < 640 ? 150 : 290
  const { from, days } = useMemo(() => chartRange(tasks, fallback), [tasks, fallback])
  const x = (d: string) => left + daysBetween(from, d) * dayW
  const width = left + days * dayW
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'end'; x0: number; dx: number } | null>(null)
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
  const shown = (t: ProgrammeTask) =>
    drag && drag.id === t.id ? { ...t, ...(drag.mode === 'move' ? moved(t, Math.round(drag.dx / dayW), shutdowns) : stretched(t, Math.round(drag.dx / dayW))) } : t
  const height = 44 + rows.length * ROW

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
          const t = tasks.find((x) => x.id === drag.id)
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
            style={{ left: x(s.start), width: (daysBetween(s.start, s.end) + 1) * dayW, top: 44, height: rows.length * ROW }}
            title={`${s.name}: ${ukDate(s.start)} to ${ukDate(s.end)}`}
          />
        ))}
        {today >= from && <div className="gantt-today" style={{ left: x(today) + dayW / 2, top: 44, height: rows.length * ROW }} title={`Today, ${ukDate(today)}`} />}
        {/* rows */}
        {rows.map((r, i) =>
          r.kind === 'section' ? (
            <div key={`s${i}`} className="gantt-row gantt-section" style={{ top: 44 + i * ROW, width }}>
              <button className="gantt-name" onClick={() => onRenameSection(r.section)} title="Rename this section">
                {r.section ?? 'No section'}
              </button>
            </div>
          ) : (
            <Fragment key={r.t.id ?? r.t.code}>
              {(() => {
                const t = shown(r.t)
                const color = tradeColor(t.trade, trades)
                const bx = x(t.start_date)
                const bw = Math.max(dayW, (daysBetween(t.start_date, t.finish_date) + 1) * dayW)
                const start = (e: React.PointerEvent, mode: 'move' | 'end') => {
                  if (!r.t.id) return
                  e.preventDefault()
                  e.stopPropagation()
                  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
                  setDrag({ id: r.t.id, mode, x0: e.clientX, dx: 0 })
                }
                return (
                  <div className={`gantt-row ${selected === r.t.id ? 'selected' : ''}`} style={{ top: 44 + i * ROW, width }}>
                    <button className="gantt-name" onClick={() => onOpen(r.t)} title={`${t.code} ${t.name}`}>
                      <span className="muted">{t.code}</span> {t.name}
                    </button>
                    {t.milestone ? (
                      <div
                        className="gantt-mile"
                        style={{ left: bx + dayW / 2 - 7, background: color }}
                        onPointerDown={(e) => start(e, 'move')}
                        title={`◆ ${t.name}: ${ukDate(t.start_date)}`}
                      />
                    ) : (
                      <div
                        className="gantt-bar"
                        style={{ left: bx, width: bw, background: color }}
                        onPointerDown={(e) => start(e, 'move')}
                        title={`${t.name}: ${ukDate(t.start_date)} to ${ukDate(t.finish_date)}, ${duration(t, shutdowns)} days`}
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
  // start and duration set the finish (a milestone is one day)
  const withDates = (p: Partial<ProgrammeTask>, d = days): ProgrammeTask => {
    const next = { ...t, ...p }
    const start = nextWorkingDay(next.start_date, shutdowns)
    return { ...next, start_date: start, finish_date: next.milestone ? start : finishFor(start, Number(d) || 1, shutdowns) }
  }
  return (
    <section className="card">
      <h2>{task.id ? `Edit ${task.code}` : `New task ${task.code}`}</h2>
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
          <input type="date" value={t.start_date} onChange={(e) => e.target.value && setT(withDates({ start_date: e.target.value }))} />
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
                if (Number(e.target.value) > 0) setT(withDates({}, e.target.value))
              }}
            />
          </label>
        )}
        <label className="check">
          <span>
            <input type="checkbox" checked={t.milestone} onChange={(e) => setT(withDates({ milestone: e.target.checked }))} /> Milestone ◆
          </span>
        </label>
      </div>
      <p className="small">
        {t.milestone ? `On ${ukDate(t.start_date)}` : `${ukDate(t.start_date)} to ${ukDate(t.finish_date)}: ${duration(t, shutdowns)} working days`}
        {shutdowns.length > 0 && <span className="muted"> (weekends and shutdowns not counted)</span>}
      </p>
      <div className="form-actions">
        <button className="primary" onClick={() => onSave(t)} disabled={!t.name.trim()}>
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
        <p className="muted small">Days the site is shut aren't working days: durations skip them, and they're shaded on the chart.</p>
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
