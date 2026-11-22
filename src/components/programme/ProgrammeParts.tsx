// The Programme tab's task form, menus and dialogs, as DBP Timeline's (reference/timeline-app-
// 2026-11-21.html: the task modal, the section / shutdown / shift / legend / export menus, duplicate and
// delete section, commit and history).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Link, LinkType, ProgrammeTask, Shutdown } from '../../lib/programme'
import { addDays, finishFor, nextWorkingDay } from '../../lib/programmeEdit'
import { calendarOf, follows } from '../../lib/programmeLinks'
import { CRITICAL_COLOR, lengthOf, nextCopyName, suggestedXmasShutdowns, type Working } from '../../lib/programmeOps'

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`)
const fmtShort = (iso: string) => utc(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

// ---------- a dialog (Timeline's modal) ----------
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="tl-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tl-modal" style={wide ? { maxWidth: 780 } : undefined} role="dialog" aria-label={title}>
        <div className="tl-modal-header">
          <h2>{title}</h2>
          <button className="tl-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="tl-modal-body">{children}</div>
        {footer && <div className="tl-modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

// ---------- the task form (openTaskModal / saveTaskFromModal) ----------
export function TaskModal({
  w,
  task,
  isNew,
  contractors,
  onSave,
  onClose,
  onDelete,
  onDuplicate,
}: {
  w: Working
  task: ProgrammeTask
  isNew: boolean
  contractors: string[]
  onSave: (t: ProgrammeTask) => void
  onClose: () => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const sd = w.programme.shutdowns ?? []
  const [t, setT] = useState<ProgrammeTask>(task)
  const [days, setDays] = useState(String(task.milestone ? 5 : lengthOf(task, sd)))
  const [sections, setSections] = useState((w.programme.sections ?? []).map((s) => s.name))
  const [trades, setTrades] = useState((w.programme.trades ?? []).map((x) => x.name))
  const links = t.predecessors ?? []
  const others = w.tasks.filter((x) => x.code !== t.code)
  const canFollow = others.filter((x) => !follows(w.tasks, x.code, t.code))
  const setLink = (i: number, p: Partial<Link>) => setT({ ...t, predecessors: links.map((l, k) => (k === i ? { ...l, ...p } : l)) })
  const save = () => {
    if (!t.name.trim()) return alert('Please enter a task name.')
    const start = t.skeleton ? t.start_date : nextWorkingDay(t.start_date, sd)
    const n = Math.max(1, parseInt(days) || 1)
    onSave({ ...t, name: t.name.trim(), contractor: t.contractor?.trim() || null, start_date: start, finish_date: t.milestone ? start : finishFor(start, n, calendarOf(t, sd)) })
  }
  // Ctrl + Enter saves from anywhere in the form
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        saveRef.current()
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  return (
    <Modal
      title={isNew ? (t.milestone ? 'Add milestone' : 'Add task') : 'Edit task'}
      onClose={onClose}
      footer={
        <>
          <div className="tl-row-gap">
            {!isNew && (
              <>
                <button className="tl-btn tl-danger" onClick={onDelete}>
                  Delete task
                </button>
                <button className="tl-btn" onClick={onDuplicate} title="Make a copy of this task straight after it">
                  Duplicate
                </button>
              </>
            )}
          </div>
          <div className="tl-row-gap">
            <button className="tl-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="tl-btn tl-btn-primary" onClick={save} title="Ctrl+Enter">
              Save task
            </button>
          </div>
        </>
      }
    >
      <div className="tl-field">
        <label>Task name</label>
        <input
          type="text"
          value={t.name}
          onChange={(e) => setT({ ...t, name: e.target.value })}
          placeholder="e.g. First fix M&E"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </div>
      <div className="tl-field-row">
        <div className="tl-field">
          <label>Section</label>
          <select
            value={t.section ?? ''}
            onChange={(e) => {
              if (e.target.value !== '__new__') return setT({ ...t, section: e.target.value || null })
              const name = prompt('Section name (e.g. Precon, Construction, Close-out):')?.trim()
              if (name) {
                if (!sections.includes(name)) setSections([...sections, name])
                setT({ ...t, section: name })
              }
            }}
          >
            <option value="">(No section)</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="__new__">+ Add new section…</option>
          </select>
        </div>
        <div className="tl-field">
          <label>Trade / package</label>
          <select
            value={t.trade ?? ''}
            onChange={(e) => {
              if (e.target.value !== '__new__') return setT({ ...t, trade: e.target.value || null })
              const name = prompt('New trade / package name:')?.trim()
              if (name) {
                if (!trades.includes(name)) setTrades([...trades, name])
                setT({ ...t, trade: name })
              }
            }}
          >
            <option value="">(None)</option>
            {[...new Set([...trades, ...(t.trade ? [t.trade] : [])])].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="__new__">+ Add new trade…</option>
          </select>
        </div>
      </div>
      <div className="tl-field">
        <label>Contractor</label>
        <input
          type="text"
          list="tl-contractors"
          autoComplete="off"
          value={t.contractor ?? ''}
          onChange={(e) => setT({ ...t, contractor: e.target.value })}
          placeholder="e.g. Sparky Ltd (optional)"
        />
        <datalist id="tl-contractors">
          {contractors.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <div className="tl-field-row">
        <div className="tl-field">
          <label>Start date</label>
          <input type="date" value={t.start_date} onChange={(e) => e.target.value && setT({ ...t, start_date: e.target.value })} />
          {links.length > 0 && <div className="tl-hint">Linked: a new start date becomes extra lag on its links.</div>}
        </div>
        {!t.milestone && (
          <div className="tl-field">
            <label>Duration (working days)</label>
            <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
        )}
      </div>
      <div className="tl-field tl-check">
        <input type="checkbox" id="tl-ms" checked={t.milestone} onChange={(e) => setT({ ...t, milestone: e.target.checked })} />
        <label htmlFor="tl-ms">This is a milestone (renders as a diamond, not a bar)</label>
      </div>
      <div className="tl-field tl-check">
        <input type="checkbox" id="tl-sk" checked={!!t.skeleton} onChange={(e) => setT({ ...t, skeleton: e.target.checked })} />
        <label htmlFor="tl-sk">Skeleton crew: keeps working through shutdown periods (e.g. Christmas)</label>
      </div>
      <div className="tl-field">
        <label>RAG status</label>
        <div className="tl-seg-radio">
          {(['green', 'amber', 'red'] as const).map((r) => (
            <button key={r} type="button" className={`rag-l-${r} ${(t.rag ?? 'green') === r ? 'active' : ''}`} onClick={() => setT({ ...t, rag: r })}>
              {r === 'green' ? 'Green' : r === 'amber' ? 'Amber' : 'Red'}
            </button>
          ))}
        </div>
      </div>
      <div className="tl-field">
        <label>Predecessors</label>
        {links.map((l, i) => (
          <div key={i} className="tl-pred-row">
            <select className="pred-task" value={l.code} onChange={(e) => setLink(i, { code: e.target.value })}>
              {canFollow
                .filter((x) => x.code === l.code || !links.some((y) => y.code === x.code))
                .map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.name}
                  </option>
                ))}
            </select>
            <select className="pred-type" value={l.type} onChange={(e) => setLink(i, { type: e.target.value as LinkType })}>
              <option value="FS">FS</option>
              <option value="SS">SS</option>
              <option value="FF">FF</option>
            </select>
            <input className="pred-lag" type="number" value={l.lag} title="Lag (working days)" onChange={(e) => setLink(i, { lag: parseInt(e.target.value) || 0 })} />
            <button className="tl-icon" title="Remove" onClick={() => setT({ ...t, predecessors: links.filter((_, k) => k !== i) })}>
              ✕
            </button>
          </div>
        ))}
        <button
          className="tl-btn tl-btn-sm"
          onClick={() => {
            const avail = canFollow.filter((x) => !links.some((l) => l.code === x.code))
            if (!avail.length) return alert('No other tasks yet to depend on.')
            // the task just above it is the likeliest
            const i = w.tasks.findIndex((x) => x.code === t.code)
            const above = (i < 0 ? avail : avail.filter((x) => w.tasks.indexOf(x) < i)).pop()
            setT({ ...t, predecessors: [...links, { code: (above ?? avail[0]).code, type: 'FS', lag: 0 }] })
          }}
        >
          + Add predecessor
        </button>
        <div className="tl-hint">FS = finish–start, SS = start–start, FF = finish–finish. Lag/lead in working days (can be negative).</div>
      </div>
      <div className="tl-field tl-check">
        <input type="checkbox" id="tl-pq" checked={!!t.prereq_confirmed} onChange={(e) => setT({ ...t, prereq_confirmed: e.target.checked })} />
        <label htmlFor="tl-pq">Prerequisite / dependency confirmed</label>
      </div>
      <div className="tl-field">
        <label>
          Prerequisite note <span className="tl-light">(optional)</span>
        </label>
        <textarea
          value={t.prereq_note ?? ''}
          onChange={(e) => setT({ ...t, prereq_note: e.target.value })}
          placeholder="e.g. Needs 3D model from subcontractor before this can be priced/started"
        />
      </div>
      {!isNew && task.baseline_start && (
        <div className="tl-field">
          <label>Baseline</label>
          <div className="tl-baseline-note">
            Baselined at {fmtShort(task.baseline_start)}, {task.baseline_duration} working day{task.baseline_duration === 1 ? '' : 's'}. Read-only. Use "Set baseline" in the
            toolbar to baseline tasks added since.
          </div>
        </div>
      )}
    </Modal>
  )
}

// ---------- a menu under a toolbar button ----------
export function Popover({ open, onClose, children, align = 'left', width }: { open: boolean; onClose: () => void; children: ReactNode; align?: 'left' | 'right'; width?: number }) {
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !(e.target as Element).closest('.tl-pop-wrap') && onClose()
    const t = setTimeout(() => document.addEventListener('pointerdown', close), 0)
    return () => (clearTimeout(t), document.removeEventListener('pointerdown', close))
  }, [open, onClose])
  if (!open) return null
  return (
    <div className={`tl-popover ${align}`} style={width ? { width } : undefined}>
      {children}
    </div>
  )
}

// renderShutdownPopover: the shutdowns, Christmas offered when the programme runs over it
export function ShutdownMenu({ w, onChange }: { w: Working; onChange: (list: Shutdown[]) => void }) {
  const list = w.programme.shutdowns ?? []
  const sugg = suggestedXmasShutdowns(w)
  const edit = (i: number, p: Partial<Shutdown>) => {
    const next = list.map((s, k) => {
      if (k !== i) return s
      const n = { ...s, ...p }
      if (n.start && n.end && n.end < n.start) return p.start ? { ...n, end: n.start } : { ...n, start: n.end }
      return n
    })
    onChange(next)
  }
  return (
    <>
      <div className="tl-legend-title">Shutdown periods</div>
      <div className="tl-help">No work on these dates. Tasks roll over them and later tasks move out. Tick “Skeleton crew” on a task to keep it working through.</div>
      {list.map((p, i) => (
        <div key={i} className="tl-shutdown-row">
          <input type="text" value={p.name} placeholder="Name" onChange={(e) => edit(i, { name: e.target.value })} style={{ width: 130 }} />
          <input type="date" value={p.start} onChange={(e) => e.target.value && edit(i, { start: e.target.value })} />
          <span>to</span>
          <input type="date" value={p.end} onChange={(e) => e.target.value && edit(i, { end: e.target.value })} />
          <button className="tl-icon" title="Remove" onClick={() => onChange(list.filter((_, k) => k !== i))}>
            ✕
          </button>
        </div>
      ))}
      {!list.length && <div className="tl-help">None set.</div>}
      {sugg.map((s) => (
        <div key={s.year} className="tl-shutdown-suggest">
          Programme runs over Christmas {s.year}.
          <button className="tl-btn tl-btn-sm tl-btn-primary" onClick={() => onChange([...list, { name: `Christmas ${s.year}`, start: s.start, end: s.end }])}>
            Add {fmtShort(s.start)} – {fmtShort(s.end)}
          </button>
        </div>
      ))}
      <div style={{ marginTop: 10 }}>
        <button
          className="tl-btn tl-btn-sm"
          onClick={() => {
            const s = sugg[0]
            const base = s ? s.start : nextWorkingDay(w.programme.project_start || new Date().toISOString().slice(0, 10))
            onChange([...list, { name: s ? `Christmas ${s.year}` : 'Shutdown', start: base, end: s ? s.end : addDays(base, 11) }])
          }}
        >
          + Add period
        </button>
      </div>
    </>
  )
}

// renderShiftPopover: the whole programme by calendar days, or a section by working days
export function ShiftMenu({ w, onShift }: { w: Working; onShift: (scope: string | null | undefined, days: number) => void }) {
  const [scope, setScope] = useState<string>('') // '' whole programme, '__ungrouped__', or a section
  const [n, setN] = useState('7')
  const go = (sign: 1 | -1) => {
    const d = Math.round(Math.abs(parseFloat(n)) || 0)
    if (d) onShift(scope === '' ? undefined : scope === '__ungrouped__' ? null : scope, d * sign)
  }
  return (
    <>
      <div className="tl-legend-title">Shift schedule</div>
      <div className="tl-help">
        Move tasks forward or back in time. The whole programme shifts by calendar days, carrying the programme start and Wk 1 with it. A single section shifts by working days and
        carries its dependants (and any later section chained off it) along too.
      </div>
      <div className="tl-shutdown-row">
        <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ width: 200 }}>
          <option value="">Whole programme</option>
          {(w.programme.sections ?? []).map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
          {w.tasks.some((t) => t.section == null) && <option value="__ungrouped__">Ungrouped tasks</option>}
        </select>
      </div>
      <div className="tl-shutdown-row">
        <input type="number" value={n} min={1} step={1} onChange={(e) => setN(e.target.value)} style={{ width: 70 }} />
        <span>{scope ? 'working days' : 'calendar days'}</span>
        <button className="tl-btn tl-btn-sm" onClick={() => go(-1)}>
          ◀ Back
        </button>
        <button className="tl-btn tl-btn-sm tl-btn-primary" onClick={() => go(1)}>
          Forward ▶
        </button>
      </div>
    </>
  )
}

// toggleLegend: trade colours (changeable), RAG, symbols; brand colours / tone down
export function LegendMenu({ w, onColor, onBrand, onToneDown }: { w: Working; onColor: (name: string, color: string) => void; onBrand: () => void; onToneDown: () => void }) {
  return (
    <>
      <div className="tl-legend-title">Trade / package</div>
      {(w.programme.trades ?? []).map((t) => (
        <label key={t.name} className="tl-legend-item">
          <input type="color" className="tl-legend-color" value={t.color} onChange={(e) => onColor(t.name, e.target.value)} title={`Change ${t.name} colour`} />
          {t.name}
        </label>
      ))}
      <div className="tl-legend-title">RAG status</div>
      <div className="tl-legend-item">
        <span className="rag-dot rag-green" /> On track
      </div>
      <div className="tl-legend-item">
        <span className="rag-dot rag-amber" /> At risk
      </div>
      <div className="tl-legend-item">
        <span className="rag-dot rag-red" /> Off track
      </div>
      <div className="tl-legend-title">Symbols</div>
      <div className="tl-legend-item">◆ Milestone</div>
      <div className="tl-legend-item">
        <span style={{ display: 'inline-block', width: 11, height: 11, border: `2.2px solid ${CRITICAL_COLOR}`, borderRadius: 2 }} /> Critical path (zero float)
      </div>
      <div className="tl-legend-item">
        <span style={{ display: 'inline-block', width: 22, height: 11, background: '#f6dcd8' }} /> Shutdown
      </div>
      <div className="tl-legend-foot">
        <button className="tl-btn tl-btn-sm" onClick={onBrand} title="Recolour every trade from the du Boulay brand palette (blues, black and slate)">
          Brand colours
        </button>
        <button className="tl-btn tl-btn-sm" onClick={onToneDown} title="Reduce the saturation of every trade colour a little, keeping each hue">
          Tone down
        </button>
      </div>
    </>
  )
}

// openDuplicateSectionModal
export function DuplicateSectionDialog({
  name,
  count,
  onClose,
  onDuplicate,
}: {
  name: string
  count: number
  onClose: () => void
  onDuplicate: (o: { copies: number; offset: number; firstName: string; mode: 'starts' | 'finishes'; link: boolean }) => void
}) {
  const [copies, setCopies] = useState('1')
  const [firstName, setFirstName] = useState(nextCopyName(name, 1))
  const [mode, setMode] = useState<'starts' | 'finishes'>('starts')
  const [offset, setOffset] = useState('5')
  const [link, setLink] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Modal
      title={`Duplicate section: ${name}`}
      onClose={onClose}
      footer={
        <>
          <span />
          <div className="tl-row-gap">
            <button className="tl-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="tl-btn tl-btn-primary"
              onClick={() => {
                const c = parseInt(copies, 10)
                if (!(c >= 1 && c <= 60)) return setErr('Enter between 1 and 60 copies.')
                if (!firstName.trim()) return setErr('Give the first copy a name.')
                onDuplicate({ copies: c, offset: Math.max(0, parseInt(offset, 10) || 0), firstName: firstName.trim(), mode, link })
              }}
            >
              Duplicate
            </button>
          </div>
        </>
      }
    >
      <p className="tl-p">
        Copies all {count} task{count === 1 ? '' : 's'} in <b>{name}</b>, with the links between them. Links to tasks outside the section (e.g. “Frame complete”) are kept on every
        copy.
      </p>
      <div className="tl-field-row">
        <div className="tl-field">
          <label>Number of copies</label>
          <input type="number" min={1} max={60} value={copies} onChange={(e) => setCopies(e.target.value)} />
        </div>
        <div className="tl-field">
          <label>Name of first copy (later copies count on)</label>
          <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
      </div>
      <div className="tl-field-row">
        <div className="tl-field">
          <label>Each copy starts…</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'starts' | 'finishes')}>
            <option value="starts">N working days after the previous one starts (staggered)</option>
            <option value="finishes">N working days after the previous one finishes (back to back)</option>
          </select>
        </div>
        <div className="tl-field">
          <label>N (working days)</label>
          <input type="number" min={0} value={offset} onChange={(e) => setOffset(e.target.value)} />
        </div>
      </div>
      <div className="tl-field tl-check">
        <input type="checkbox" id="tl-dl" checked={link} onChange={(e) => setLink(e.target.checked)} />
        <label htmlFor="tl-dl">Link the copies together, so each follows the one before and they stay in step when dates move</label>
      </div>
      {err && <div className="tl-err">{err}</div>}
    </Modal>
  )
}

// deleteGroup: heading only, or heading and tasks
export function DeleteSectionDialog({ name, count, onClose, onDelete }: { name: string; count: number; onClose: () => void; onDelete: (mode: 'header' | 'all') => void }) {
  return (
    <Modal
      title={`Delete section: ${name}`}
      onClose={onClose}
      footer={
        <>
          <button className="tl-btn" onClick={onClose}>
            Cancel
          </button>
          <div className="tl-row-gap">
            <button className="tl-btn tl-two-line" onClick={() => onDelete('header')}>
              Delete header only
              <span>
                keep the {count} task{count === 1 ? '' : 's'}, ungrouped
              </span>
            </button>
            <button className="tl-btn tl-danger" onClick={() => onDelete('all')}>
              Delete header and {count} task{count === 1 ? '' : 's'}
            </button>
          </div>
        </>
      }
    >
      <p className="tl-p">
        This section has{' '}
        <b>
          {count} task{count === 1 ? '' : 's'}
        </b>
        . What should happen to {count === 1 ? 'it' : 'them'}?
      </p>
      <p className="tl-p tl-light">You can undo either option straight afterwards with Ctrl+Z or the Undo button.</p>
    </Modal>
  )
}
