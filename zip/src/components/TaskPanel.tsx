// A task's details, set up like Microsoft To Do (23 Nov, script 053): opened by clicking a task on the Tasks page.
// A panel on the right (full screen on a phone); Escape or ✕ closes it. Everything saves as you go.
// Tick and title, ☆ Important, Steps, Add to My Day, Remind me, Due date, Repeat, Assign to, Job, Files, Note,
// and "Created on … by …" with Delete (whoever set it, or an admin).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { addDaysIso, todayIso, ukDate } from '../lib/format'
import {
  REPEAT_LABELS,
  addTaskFile,
  loadTaskFiles,
  nextMonday,
  onMyDay,
  removeTaskFile,
  taskFileUrl,
  updateTask,
  type Repeat,
  type Step,
  type Task,
  type TaskFile,
  type TaskPatch,
} from '../lib/tasks'
import type { Profile } from '../lib/types'
import { nudgeEmails } from '../lib/notifications'

type Person = Pick<Profile, 'id' | 'full_name' | 'email'>
const personName = (p: Person | undefined) => (p ? (p.full_name && p.full_name !== p.email ? p.full_name : (p.email ?? '')) : 'Someone')
const dayName = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })
const longDate = (iso: string) => `${dayName(iso)} ${ukDate(iso)}`
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2))

export default function TaskPanel({
  task,
  people,
  jobs,
  me,
  onSaved,
  onTick,
  onDelete,
  onClose,
  toast,
}: {
  task: Task
  people: Person[]
  jobs: { id: string; label: string }[]
  me: Profile | null
  onSaved: (t: Task) => void
  onTick: (t: Task, done: boolean) => void
  onDelete: (t: Task) => void
  onClose: () => void
  toast: (m: string, danger?: boolean) => void
}) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [newStep, setNewStep] = useState('')
  const [menu, setMenu] = useState<'due' | 'remind' | 'repeat' | null>(null)
  const [files, setFiles] = useState<TaskFile[] | null>(null)
  const [uploading, setUploading] = useState(0)
  const latest = useRef(task)
  latest.current = task
  const today = todayIso()
  const steps = task.steps ?? []
  const forMe = task.assigned_to === me?.id
  const canDelete = task.created_by === me?.id || !!me?.is_admin
  const byId = (id: string | null) => people.find((p) => p.id === id)

  // another task opened: start from its own text
  useEffect(() => {
    setTitle(task.title)
    setNotes(task.notes ?? '')
    setNewStep('')
    setMenu(null)
    setFiles(null)
    loadTaskFiles(task.id).then(setFiles, () => setFiles([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  // Escape closes (after saving what's being typed)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (menu) return setMenu(null)
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  function close() {
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    onClose()
  }

  // save as you go: shown straight away, put back if the database says no
  async function save(patch: TaskPatch) {
    const before = latest.current
    onSaved({ ...before, ...patch })
    try {
      onSaved(await updateTask(before.id, patch))
      // given to someone else: email them now rather than at the next run (the bell updates itself)
      if (patch.assigned_to) nudgeEmails()
    } catch (e) {
      onSaved(before)
      toast((e as Error).message, true)
    }
  }

  function saveTitle() {
    const v = title.trim()
    if (!v) {
      toast('A task needs a title: put back as it was.', true)
      return setTitle(task.title)
    }
    if (v !== task.title) save({ title: v })
  }
  function saveNotes() {
    const v = notes.trim() || null
    if (v !== (task.notes ?? null)) save({ notes: v })
  }
  const saveSteps = (s: Step[]) => save({ steps: s })
  function addStep() {
    const v = newStep.trim()
    if (!v) return
    saveSteps([...steps, { id: newId(), title: v, done: false }])
    setNewStep('')
  }
  function moveStep(i: number, by: number) {
    const s = [...steps]
    const [x] = s.splice(i, 1)
    s.splice(i + by, 0, x)
    saveSteps(s)
  }

  function setDue(d: string | null) {
    setMenu(null)
    // no due date, no repeat (as in To Do)
    save(d ? { due_date: d } : { due_date: null, repeat: null })
  }
  function setRemind(d: string | null) {
    setMenu(null)
    if (d && d < today) return toast('Pick today or a later day for the reminder.', true)
    save({ remind_on: d })
  }
  function setRepeat(r: Repeat | null) {
    setMenu(null)
    // a repeating task needs a due date to move on from: today if it has none (as in To Do)
    save(r && !task.due_date ? { repeat: r, due_date: today } : { repeat: r })
  }

  async function attach(list: File[]) {
    setUploading((n) => n + list.length)
    for (const f of list) {
      try {
        const added = await addTaskFile(task.id, f)
        setFiles((l) => [...(l ?? []), added])
      } catch (e) {
        toast(`Couldn’t add ${f.name}: ${(e as Error).message}`, true)
      }
      setUploading((n) => n - 1)
    }
  }
  async function openFile(f: TaskFile) {
    // open the tab first so phones don't block it, then point it at the file
    const w = window.open('', '_blank')
    try {
      const url = await taskFileUrl(f.path)
      if (w) w.location.href = url
      else window.location.href = url
    } catch (e) {
      w?.close()
      toast((e as Error).message, true)
    }
  }
  async function dropFile(f: TaskFile) {
    if (!confirm(`Remove the file “${f.name}”?`)) return
    try {
      await removeTaskFile(f)
      setFiles((l) => (l ?? []).filter((x) => x.id !== f.id))
    } catch (e) {
      toast((e as Error).message, true)
    }
  }
  const pickFiles = (input: HTMLInputElement) => {
    const list = Array.from(input.files ?? [])
    input.value = ''
    if (list.length) attach(list)
  }

  const quickDates = (pick: (d: string) => void, current: string | null | undefined, label: string) => (
    <div className="tp-menu">
      <button type="button" onClick={() => pick(today)}>
        Today <span>{dayName(today)}</span>
      </button>
      <button type="button" onClick={() => pick(addDaysIso(today, 1))}>
        Tomorrow <span>{dayName(addDaysIso(today, 1))}</span>
      </button>
      <button type="button" onClick={() => pick(nextMonday())}>
        Next week <span>{longDate(nextMonday())}</span>
      </button>
      <label className="tp-pick">
        Pick a date
        <input type="date" min={today} defaultValue={current ?? ''} aria-label={label} onChange={(e) => e.target.value && pick(e.target.value)} />
      </label>
    </div>
  )

  return (
    <aside className="task-panel app-controls" role="dialog" aria-label="Task details">
      <div className="tp-top">
        <button type="button" className="tp-close" onClick={close} aria-label="Close" title="Close (Esc)">
          ✕
        </button>
      </div>

      <div className="tp-scroll">
        {/* tick, title, star; then the steps */}
        <section className="tp-card">
          <div className="tp-title-row">
            <button
              type="button"
              className={'tp-tick' + (task.done ? ' on' : '')}
              onClick={() => onTick(task, !task.done)}
              aria-label={task.done ? 'Open again' : 'Mark done'}
              title={task.done ? 'Open again' : 'Mark done'}
            >
              {task.done ? '✓' : ''}
            </button>
            <textarea
              className={'tp-title' + (task.done ? ' done' : '')}
              rows={Math.min(4, Math.max(1, Math.ceil(title.length / 30)))}
              value={title}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())}
              aria-label="Task"
            />
            <button
              type="button"
              className={'tp-star' + (task.important ? ' on' : '')}
              onClick={() => save({ important: !task.important })}
              aria-pressed={!!task.important}
              title={task.important ? 'Important (click to take the star off)' : 'Mark as important'}
            >
              {task.important ? '★' : '☆'}
            </button>
          </div>
          {steps.map((s, i) => (
            <StepRow
              key={s.id}
              step={s}
              first={i === 0}
              last={i === steps.length - 1}
              onChange={(st) => saveSteps(steps.map((x) => (x.id === s.id ? st : x)))}
              onDelete={() => saveSteps(steps.filter((x) => x.id !== s.id))}
              onMove={(by) => moveStep(i, by)}
            />
          ))}
          <div className="tp-step tp-add-step">
            <span className="tp-plus">+</span>
            <input
              value={newStep}
              onChange={(e) => setNewStep(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addStep())}
              onBlur={addStep}
              placeholder={steps.length ? 'Next step' : 'Add step'}
              aria-label="Add step"
            />
          </div>
        </section>

        {/* My Day is the person's own: only for tasks for me */}
        {forMe && (
          <section className="tp-card">
            {onMyDay(task) ? (
              <Line icon="☀" on onClear={() => save({ my_day: null })} clearLabel="Remove from My Day">
                Added to My Day
              </Line>
            ) : (
              <Line icon="☀" onClick={() => save({ my_day: today })}>
                Add to My Day
              </Line>
            )}
          </section>
        )}

        <section className="tp-card">
          <Line
            icon="🔔"
            on={!!task.remind_on}
            onClick={() => setMenu(menu === 'remind' ? null : 'remind')}
            onClear={task.remind_on ? () => setRemind(null) : undefined}
            clearLabel="Remove the reminder"
            sub={task.remind_on ? (forMe ? 'On your bell and by email that day' : `On ${personName(byId(task.assigned_to))}’s bell and by email that day`) : undefined}
          >
            {task.remind_on ? `Remind ${forMe ? 'me' : personName(byId(task.assigned_to))} on ${longDate(task.remind_on)}` : 'Remind me'}
          </Line>
          {menu === 'remind' && quickDates(setRemind, task.remind_on, 'Reminder date')}
          <Line
            icon="📅"
            on={!!task.due_date}
            warn={!!task.due_date && !task.done && task.due_date < today}
            onClick={() => setMenu(menu === 'due' ? null : 'due')}
            onClear={task.due_date ? () => setDue(null) : undefined}
            clearLabel="Remove the due date"
          >
            {task.due_date ? (task.due_date === today ? 'Due today' : `Due ${longDate(task.due_date)}`) : 'Add due date'}
          </Line>
          {menu === 'due' && quickDates(setDue, task.due_date, 'Due date')}
          <Line
            icon="🔁"
            on={!!task.repeat}
            onClick={() => setMenu(menu === 'repeat' ? null : 'repeat')}
            onClear={task.repeat ? () => setRepeat(null) : undefined}
            clearLabel="Stop repeating"
            sub={task.repeat ? 'When it’s done, the next one is set up' : undefined}
          >
            {task.repeat ? REPEAT_LABELS[task.repeat] : 'Repeat'}
          </Line>
          {menu === 'repeat' && (
            <div className="tp-menu">
              {(Object.keys(REPEAT_LABELS) as Repeat[]).map((r) => (
                <button key={r} type="button" className={task.repeat === r ? 'on' : ''} onClick={() => setRepeat(r)}>
                  {REPEAT_LABELS[r]}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="tp-card">
          <label className="tp-field">
            <span className="tp-icon">👤</span>
            <span className="tp-field-main">
              <span className="tp-field-label">Assigned to</span>
              <select
                value={task.assigned_to}
                onChange={(e) => e.target.value !== task.assigned_to && save({ assigned_to: e.target.value, ...(task.my_day ? { my_day: null } : {}) })}
                aria-label="Assigned to"
              >
                {!byId(task.assigned_to) && <option value={task.assigned_to}>Someone</option>}
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === me?.id ? `Me (${personName(p)})` : personName(p)}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="tp-field">
            <span className="tp-icon">🏗</span>
            <span className="tp-field-main">
              <span className="tp-field-label">Job</span>
              <select value={task.job_id ?? ''} onChange={(e) => save({ job_id: e.target.value || null })} aria-label="Job">
                <option value="">No particular job</option>
                {task.job_id && !jobs.some((j) => j.id === task.job_id) && <option value={task.job_id}>A job</option>}
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.label}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </section>

        <section className="tp-card">
          {files?.map((f) => (
            <div key={f.id} className="tp-file">
              <span className="tp-icon">📄</span>
              <button type="button" className="tp-file-name" onClick={() => openFile(f)} title="Open">
                {f.name}
              </button>
              <small>{ukDate(f.created_at)}</small>
              {(f.uploaded_by === me?.id || me?.is_admin) && (
                <button type="button" className="tp-x" onClick={() => dropFile(f)} aria-label={`Remove ${f.name}`} title="Remove the file">
                  ✕
                </button>
              )}
            </div>
          ))}
          <div className="tp-file-buttons">
            <label className="tp-filebtn">
              <input type="file" multiple onChange={(e) => pickFiles(e.target)} />
              <span>📎 Add file</span>
            </label>
            <label className="tp-filebtn">
              <input type="file" accept="image/*" capture="environment" onChange={(e) => pickFiles(e.target)} />
              <span>📷 Take photo</span>
            </label>
            {uploading > 0 && <small>Adding {uploading}…</small>}
          </div>
        </section>

        <section className="tp-card">
          <textarea className="tp-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} placeholder="Add note" aria-label="Note" />
        </section>
      </div>

      <footer className="tp-foot">
        <span>
          Created on {ukDate(task.created_at)}
          {task.created_by ? ` by ${task.created_by === me?.id ? 'you' : personName(byId(task.created_by))}` : ''}
          {task.done && task.done_at ? ` · Done ${ukDate(task.done_at)}` : ''}
        </span>
        {canDelete && (
          <button type="button" className="tp-delete" onClick={() => onDelete(task)} aria-label="Delete task" title="Delete task">
            🗑
          </button>
        )}
      </footer>
    </aside>
  )
}

// one line of the panel: icon, words, and an ✕ to clear it when set
function Line({
  icon,
  children,
  sub,
  on,
  warn,
  onClick,
  onClear,
  clearLabel,
}: {
  icon: string
  children: ReactNode
  sub?: string
  on?: boolean
  warn?: boolean
  onClick?: () => void
  onClear?: () => void
  clearLabel?: string
}) {
  const inner = (
    <>
      <span className="tp-icon">{icon}</span>
      <span>
        {children}
        {sub && <small>{sub}</small>}
      </span>
    </>
  )
  return (
    <div className={'tp-line' + (on ? ' on' : '') + (warn ? ' warn' : '')}>
      {onClick ? (
        <button type="button" className="tp-line-main" onClick={onClick}>
          {inner}
        </button>
      ) : (
        <span className="tp-line-main">{inner}</span>
      )}
      {onClear && (
        <button type="button" className="tp-x" onClick={onClear} aria-label={clearLabel} title={clearLabel}>
          ✕
        </button>
      )}
    </div>
  )
}

function StepRow({
  step,
  first,
  last,
  onChange,
  onDelete,
  onMove,
}: {
  step: Step
  first: boolean
  last: boolean
  onChange: (s: Step) => void
  onDelete: () => void
  onMove: (by: number) => void
}) {
  const [text, setText] = useState(step.title)
  useEffect(() => setText(step.title), [step.title])
  function saveText() {
    const v = text.trim()
    if (!v) return setText(step.title) // blank: keep the old wording (✕ removes a step)
    if (v !== step.title) onChange({ ...step, title: v })
  }
  return (
    <div className={'tp-step' + (step.done ? ' done' : '')}>
      <button
        type="button"
        className={'tp-tick small' + (step.done ? ' on' : '')}
        onClick={() => onChange({ ...step, done: !step.done })}
        aria-label={step.done ? 'Untick step' : 'Tick step'}
      >
        {step.done ? '✓' : ''}
      </button>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={saveText}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="Step"
      />
      <span className="tp-step-tools">
        {!first && (
          <button type="button" className="tp-x" onClick={() => onMove(-1)} aria-label="Move up" title="Move up">
            ↑
          </button>
        )}
        {!last && (
          <button type="button" className="tp-x" onClick={() => onMove(1)} aria-label="Move down" title="Move down">
            ↓
          </button>
        )}
        <button type="button" className="tp-x" onClick={onDelete} aria-label="Delete step" title="Delete step">
          ✕
        </button>
      </span>
    </div>
  )
}
