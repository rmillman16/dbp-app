// Tasks (renamed from My tasks, 23 Nov). Everything given to me: tasks set in the app (script 052) and open action
// items from meeting minutes (script 045), overdue first. Plus a box to set a new task, for myself or any DBP team
// member (optionally on a job, with a due date), and the tasks I've set for others with whether they're done.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import '../minutes.css'
import { supabase } from '../lib/supabase'
import { cached, must } from '../lib/offline'
import { todayIso, ukDate } from '../lib/format'
import { useAccess } from '../lib/access'
import { nudgeEmails, useNotifications } from '../lib/notifications'
import * as M from '../lib/minutes'
import { addTask, deleteTask, loadTasks, setTaskDone, type Task } from '../lib/tasks'
import { Icon, Mentions, useToast } from '../components/MinutesBits'
import type { Profile } from '../lib/types'

type Person = Pick<Profile, 'id' | 'full_name' | 'email'>
const personName = (p: Person | undefined) => (p ? (p.full_name && p.full_name !== p.email ? p.full_name : (p.email ?? '')) : 'Someone')
const dueChip = (due: string | null, done = false) => {
  const point = { done, dueDate: due }
  return due ? <span className={'chip due status-' + M.dueStatus(point)}>{M.dueLabel(point)}</span> : null
}

export default function MyTasks() {
  const { me } = useAccess()
  const { reload } = useNotifications()
  const navigate = useNavigate()
  const [actions, setActions] = useState<M.OpenAction[] | null>(null)
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [jobs, setJobs] = useState<{ id: string; label: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const { showToast, toastElement } = useToast()

  useEffect(() => {
    M.loadMyActions().then(setActions, () => setActions([]))
    loadTasks().then(setTasks, (e: Error) => {
      setError(e.message)
      setTasks([])
    })
    cached('profiles', () => must<Person[]>(supabase.from('profiles').select('*').order('full_name'))).then(setPeople, () => {})
    supabase
      .from('jobs')
      .select('id, job_no, code, name')
      .in('status', ['live', 'tender'])
      .order('job_no', { ascending: false })
      .then(({ data }) => setJobs((data ?? []).map((j) => ({ id: j.id as string, label: `${j.job_no} ${j.code} · ${j.name}` }))))
  }, [])
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const jobLabel = (id: string | null) => (id ? (jobs.find((j) => j.id === id)?.label ?? null) : null)

  async function completeAction(t: M.OpenAction) {
    try {
      await M.completeAction(t.pointId, true)
      setActions((l) => (l ?? []).filter((x) => x.pointId !== t.pointId))
      reload()
      showToast('Marked complete.')
    } catch (e) {
      showToast((e as Error).message, true)
    }
  }
  async function tick(t: Task, done: boolean) {
    try {
      await setTaskDone(t.id, done)
      setTasks((l) => (l ?? []).map((x) => (x.id === t.id ? { ...x, done, done_at: done ? new Date().toISOString() : null } : x)))
      reload()
      nudgeEmails()
      showToast(done ? 'Marked done.' : 'Opened again.')
    } catch (e) {
      showToast((e as Error).message, true)
    }
  }
  async function remove(t: Task) {
    if (!confirm(`Delete the task “${t.title}”?`)) return
    try {
      await deleteTask(t.id)
      setTasks((l) => (l ?? []).filter((x) => x.id !== t.id))
      reload()
    } catch (e) {
      showToast((e as Error).message, true)
    }
  }

  const uid = me?.id
  const mineOpen = (tasks ?? []).filter((t) => t.assigned_to === uid && !t.done)
  const setForOthers = (tasks ?? []).filter((t) => t.created_by === uid && t.assigned_to !== uid)
  const today = todayIso()
  const openCount = mineOpen.length + (actions?.length ?? 0)

  return (
    <div className="mint my-tasks">
      <main className="note">
        <div className="note-inner">
          <h1 className="dash-title">Tasks</h1>
          <p className="dash-sub">
            {tasks === null || actions === null
              ? 'Loading…'
              : `${openCount} open task${openCount === 1 ? '' : 's'} for ${personName(me ?? undefined)}, across all jobs and estimates.`}
          </p>
          {error && <p className="mint-error">{error}</p>}

          <NewTask
            people={people}
            jobs={jobs}
            me={uid ?? null}
            onAdded={(t) => {
              setTasks((l) => [...(l ?? []), t])
              reload()
              nudgeEmails()
              showToast(t.assigned_to === uid ? 'Task added.' : `Task set for ${personName(personById.get(t.assigned_to))}.`)
            }}
            onError={(m) => showToast(m, true)}
          />

          <h2 className="task-section">For me</h2>
          {tasks && actions && openCount === 0 && <div className="dash-empty">Nothing outstanding. Tasks set for you, and actions from meeting minutes, show here.</div>}
          <div className="dash-list">
            {mineOpen.map((t) => (
              <div key={t.id} className="dash-task">
                <div className="dash-task-text">{t.title}</div>
                {t.notes && <div className="task-notes">{t.notes}</div>}
                <div className="dash-task-meta">
                  {dueChip(t.due_date)}
                  {jobLabel(t.job_id) && <span className="chip">{jobLabel(t.job_id)}</span>}
                  {t.created_by && t.created_by !== uid && <span className="chip">From {personName(personById.get(t.created_by))}</span>}
                </div>
                <button className="btn-complete" type="button" aria-label="Mark done" onClick={() => tick(t, true)}>
                  {Icon.check()}
                  Done
                </button>
              </div>
            ))}
            {(actions ?? []).map((t) => {
              const open = () => navigate(M.meetingPath({ id: t.meetingId, jobId: t.jobId, enquiryId: t.enquiryId }))
              return (
                <div
                  key={t.pointId}
                  className="dash-task"
                  role="link"
                  tabIndex={0}
                  onClick={(e) => !(e.target as HTMLElement).closest('.btn-complete') && open()}
                  onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open()}
                >
                  <div className="dash-task-text">
                    <Mentions text={t.text || '(no description)'} attendees={t.attendees} />
                  </div>
                  <div className="dash-task-meta">
                    {dueChip(t.dueDate)}
                    {t.urgent && <span className="chip flag-urgent">Urgent</span>}
                    <span className="chip">
                      Minutes: {M.projectNameOf(t)}
                      {t.meetingDate ? ' · ' + M.formatDateSidebar(t.meetingDate) : ''}
                    </span>
                  </div>
                  {!t.jobArchived && (
                    <button className="btn-complete" type="button" aria-label="Mark complete" onClick={() => completeAction(t)}>
                      {Icon.check()}
                      Complete
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {setForOthers.length > 0 && (
            <>
              <h2 className="task-section">Set for others</h2>
              <div className="dash-list">
                {setForOthers.map((t) => (
                  <div key={t.id} className={'dash-task' + (t.done ? ' task-done' : '')}>
                    <div className="dash-task-text">{t.title}</div>
                    {t.notes && <div className="task-notes">{t.notes}</div>}
                    <div className="dash-task-meta">
                      <span className="chip">For {personName(personById.get(t.assigned_to))}</span>
                      {t.done ? <span className="chip">✓ Done {t.done_at ? ukDate(t.done_at.slice(0, 10)) : ''}</span> : dueChip(t.due_date)}
                      {jobLabel(t.job_id) && <span className="chip">{jobLabel(t.job_id)}</span>}
                      {!t.done && t.due_date && t.due_date < today && <span className="chip">⚠ overdue</span>}
                    </div>
                    <span className="task-buttons">
                      {t.done && (
                        <button className="link-button small" onClick={() => tick(t, false)}>
                          Open again
                        </button>
                      )}
                      <button className="link-button small" onClick={() => remove(t)} aria-label="Delete task">
                        ✕
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
      {toastElement}
    </div>
  )
}

// a new task: what, for whom (me or any DBP team member), when, and which job (optional)
function NewTask({
  people,
  jobs,
  me,
  onAdded,
  onError,
}: {
  people: Person[]
  jobs: { id: string; label: string }[]
  me: string | null
  onAdded: (t: Task) => void
  onError: (m: string) => void
}) {
  const [title, setTitle] = useState('')
  const [who, setWho] = useState('')
  const [due, setDue] = useState('')
  const [job, setJob] = useState('')
  const [notes, setNotes] = useState('')
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !me) return
    setBusy(true)
    try {
      const t = await addTask({ title: title.trim(), notes: notes.trim() || null, job_id: job || null, assigned_to: who || me, due_date: due || null })
      onAdded(t)
      setTitle('')
      setNotes('')
      setDue('')
    } catch (err) {
      onError((err as Error).message)
    }
    setBusy(false)
  }
  return (
    <form className="new-task" onSubmit={submit}>
      <input className="new-task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task… e.g. Chase the electrical O&Ms" aria-label="Task" />
      <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="For whom">
        <option value="">For me</option>
        {people
          .filter((p) => p.id !== me)
          .map((p) => (
            <option key={p.id} value={p.id}>
              For {personName(p)}
            </option>
          ))}
      </select>
      <input type="date" value={due} min={todayIso()} onChange={(e) => setDue(e.target.value)} aria-label="Due date" title="Due date (optional)" />
      <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>
        {busy ? 'Adding…' : 'Add task'}
      </button>
      <button type="button" className="link-button small" onClick={() => setMore(!more)}>
        {more ? 'Fewer options' : 'Job and notes…'}
      </button>
      {more && (
        <div className="new-task-more">
          <select value={job} onChange={(e) => setJob(e.target.value)} aria-label="Job (optional)">
            <option value="">No particular job</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </select>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
        </div>
      )}
    </form>
  )
}
