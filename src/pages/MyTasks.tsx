// Tasks (renamed from My tasks, 23 Nov): one list of every task for me or set by me (script 052) and my open action
// items from meeting minutes (script 045), filtered by who (All / For me / Set by me) and by job; a box to set a new task
// for myself or any DBP team member (@someone in the line), optionally on a job, with a due date.
// Clicking a task opens its details (TaskPanel, script 053, set up like Microsoft To Do); a minutes action opens its
// meeting. Starred (important) tasks sort first.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import '../minutes.css'
import { supabase } from '../lib/supabase'
import { cached, must } from '../lib/offline'
import { todayIso, ukDate } from '../lib/format'
import { useAccess } from '../lib/access'
import { nudgeEmails, useNotifications } from '../lib/notifications'
import * as M from '../lib/minutes'
import { REPEAT_LABELS, addTask, deleteTask, loadTask, loadTasks, onMyDay, setTaskDone, stepCount, updateTask, type Task } from '../lib/tasks'
import { Mentions, useToast } from '../components/MinutesBits'
import TaskPanel from '../components/TaskPanel'
import type { Profile } from '../lib/types'

type Person = Pick<Profile, 'id' | 'full_name' | 'email'>
const personName = (p: Person | undefined) => (p ? (p.full_name && p.full_name !== p.email ? p.full_name : (p.email ?? '')) : 'Someone')
const dueChip = (due: string | null, done = false) => {
  const point = { done, dueDate: due }
  return due ? <span className={'chip due status-' + M.dueStatus(point)}>{M.dueLabel(point)}</span> : null
}

// one list (23 Nov): every task for me or set by me (and my open minutes actions), filtered by who and by job
type Who = 'all' | 'mine' | 'set' | 'fyi'
interface Row {
  key: string
  kind: 'task' | 'action'
  text: string
  notes: string | null
  jobId: string | null
  due: string | null
  done: boolean
  doneAt: string | null
  forMe: boolean
  setByMe: boolean
  fyi: boolean // someone else's task that names me with @ (read only)
  forName: string
  fromName: string | null
  important: boolean
  task?: Task
  action?: M.OpenAction
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
  const [who, setWho] = useState<Who>('all')
  const [jobFilter, setJobFilter] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [teamJobs, setTeamJobs] = useState<string[]>([]) // the jobs I'm on the Team of
  const { showToast, toastElement } = useToast()
  // the task open in the detail panel (053); ?task=… from a bell link opens it
  const [params, setParams] = useSearchParams()
  const openId = params.get('task')
  const setOpenId = (id: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (id) n.set('task', id)
        else n.delete('task')
        return n
      },
      { replace: true },
    )

  useEffect(() => {
    M.loadMyActions().then(setActions, () => setActions([]))
    loadTasks().then(setTasks, (e: Error) => {
      setError(e.message)
      setTasks([])
    })
    supabase.auth.getSession().then(({ data }) => {
      const id = data.session?.user.id
      if (id)
        supabase
          .from('job_team')
          .select('job_id')
          .eq('profile_id', id)
          .then(({ data: t }) => setTeamJobs([...new Set((t ?? []).map((x) => x.job_id as string))]))
    })
    cached('profiles', () => must<Person[]>(supabase.from('profiles').select('*').order('full_name'))).then(setPeople, () => {})
    supabase
      .from('jobs')
      .select('id, job_no, code, name')
      .order('job_no', { ascending: false })
      .then(({ data }) => setJobs((data ?? []).map((j) => ({ id: j.id as string, label: `${j.job_no} ${j.code} · ${j.name}` }))))
  }, [])
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const jobLabel = (id: string | null) => (id ? (jobs.find((j) => j.id === id)?.label ?? null) : null)
  const uid = me?.id

  // tasks and minutes actions as one list, overdue first, then by due date, undated last
  const rows: Row[] = useMemo(() => {
    const out: Row[] = (tasks ?? []).map((t) => ({
      key: 't' + t.id,
      kind: 'task',
      text: t.title,
      notes: t.notes,
      jobId: t.job_id,
      due: t.due_date,
      done: t.done,
      doneAt: t.done_at,
      forMe: t.assigned_to === uid,
      setByMe: t.created_by === uid,
      fyi: t.assigned_to !== uid && t.created_by !== uid && !!uid && (t.mentioned ?? []).includes(uid),
      forName: t.assigned_to === uid ? 'Me' : personName(personById.get(t.assigned_to)),
      fromName: t.created_by && t.created_by !== uid ? personName(personById.get(t.created_by)) : null,
      important: !!t.important,
      task: t,
    }))
    for (const a of actions ?? [])
      out.push({
        key: 'a' + a.pointId,
        kind: 'action',
        text: a.text || '(no description)',
        notes: null,
        jobId: a.jobId,
        due: a.dueDate,
        done: false,
        doneAt: null,
        forMe: true,
        setByMe: false,
        fyi: false,
        forName: 'Me',
        fromName: null,
        important: !!a.urgent,
        action: a,
      })
    // open first, then important (the star; urgent minutes actions), then by due date
    return out.sort((x, y) => Number(x.done) - Number(y.done) || Number(y.important) - Number(x.important) || (x.due ?? '9999').localeCompare(y.due ?? '9999'))
  }, [tasks, actions, uid, personById])
  const openTask = (tasks ?? []).find((t) => t.id === openId) ?? null
  const isAdmin = !!me?.is_admin

  // a task opened from a bell link that isn't in the list (e.g. done a while ago): fetch it
  useEffect(() => {
    if (!openId || tasks === null || tasks.some((t) => t.id === openId)) return
    loadTask(openId).then(
      (t) => (t ? setTasks((l) => [...(l ?? []).filter((x) => x.id !== t.id), t]) : (setOpenId(null), showToast('That task has been deleted, or isn’t yours to see.', true))),
      (e: Error) => showToast(e.message, true),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, tasks === null])
  const replaceTask = (t: Task) => setTasks((l) => (l ?? []).map((x) => (x.id === t.id ? t : x)))

  const byWho = (r: Row, w: Who) => w === 'all' || (w === 'mine' ? r.forMe : w === 'set' ? r.setByMe : r.fyi)
  const byJob = (r: Row) => !jobFilter || (jobFilter === 'none' ? !r.jobId : r.jobId === jobFilter)
  const shown = rows.filter((r) => byWho(r, who) && byJob(r) && (showDone || !r.done))
  const count = (w: Who) => rows.filter((r) => byWho(r, w) && byJob(r) && !r.done).length
  // my jobs (on the job's Team) first, then any other job that has tasks here; by job number, newest first
  const jobIds = [...new Set([...teamJobs, ...(rows.map((r) => r.jobId).filter(Boolean) as string[])])].sort(
    (a, b) => jobs.findIndex((j) => j.id === a) - jobs.findIndex((j) => j.id === b),
  )
  const today = todayIso()

  async function completeAction(a: M.OpenAction) {
    try {
      await M.completeAction(a.pointId, true)
      setActions((l) => (l ?? []).filter((x) => x.pointId !== a.pointId))
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
      // a repeating task: the database has set up the next one
      if (done && t.repeat) {
        const fresh = await loadTasks()
        setTasks(fresh)
        const nextId = fresh.find((x) => x.id === t.id)?.repeated_to
        const next = fresh.find((x) => x.id === nextId)
        return showToast(next?.due_date ? `Done. The next one is due ${ukDate(next.due_date)}.` : 'Done. The next one is set up.')
      }
      showToast(done ? 'Marked done.' : 'Opened again.')
    } catch (e) {
      showToast((e as Error).message, true)
    }
  }
  async function toggleStar(t: Task) {
    replaceTask({ ...t, important: !t.important })
    try {
      replaceTask(await updateTask(t.id, { important: !t.important }))
    } catch (e) {
      replaceTask(t)
      showToast((e as Error).message, true)
    }
  }
  async function remove(t: Task) {
    if (!confirm(`Delete the task “${t.title}”?`)) return
    try {
      await deleteTask(t.id)
      setTasks((l) => (l ?? []).filter((x) => x.id !== t.id))
      if (openId === t.id) setOpenId(null)
      reload()
    } catch (e) {
      showToast((e as Error).message, true)
    }
  }

  return (
    <div className={'mint my-tasks' + (openTask ? ' panel-open' : '')}>
      <main className="note">
        <div className="note-inner">
          <h1 className="dash-title">Tasks</h1>
          <p className="dash-sub">
            {tasks === null || actions === null ? 'Loading…' : `${count('mine')} open for ${personName(me ?? undefined)} · ${count('set')} set for others, still open.`}
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

          <div className="task-filters app-controls">
            <div className="segmented">
              {(
                [
                  ['all', 'All mine'],
                  ['mine', 'For me'],
                  ['set', 'Set by me'],
                  ['fyi', 'Mentioned'],
                ] as [Who, string][]
              ).map(([w, label]) => (
                <button key={w} type="button" className={who === w ? 'on' : ''} onClick={() => setWho(w)}>
                  {label}
                  <span className="seg-count">{count(w)}</span>
                </button>
              ))}
            </div>
            <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} aria-label="Job">
              <option value="">All jobs</option>
              <optgroup label="My jobs and jobs with tasks">
                {jobIds.map((id) => (
                  <option key={id} value={id}>
                    {jobLabel(id) ?? 'A job'}
                  </option>
                ))}
              </optgroup>
              {jobs.some((j) => !jobIds.includes(j.id)) && (
                <optgroup label="Other jobs">
                  {jobs
                    .filter((j) => !jobIds.includes(j.id))
                    .map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.label}
                      </option>
                    ))}
                </optgroup>
              )}
              <option value="none">No job</option>
            </select>
            <label className="task-show-done">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done
            </label>
          </div>

          {tasks && actions && shown.length === 0 && <div className="dash-empty">Nothing here. Tasks for you or set by you, and actions from meeting minutes, show here.</div>}
          <div className="dash-list">
            {shown.map((r) => {
              // a minutes action opens its meeting; a task opens its details (053)
              const open = r.action
                ? () => navigate(M.meetingPath({ id: r.action!.meetingId, jobId: r.action!.jobId, enquiryId: r.action!.enquiryId }))
                : () => setOpenId(r.task!.id)
              const t = r.task
              const steps = t ? stepCount(t) : null
              return (
                <div
                  key={r.key}
                  className={'dash-task' + (r.done ? ' task-done' : '') + (t && t.id === openId ? ' task-open' : '')}
                  role={r.action ? 'link' : 'button'}
                  tabIndex={0}
                  onClick={(e) => !(e.target as HTMLElement).closest('button') && open()}
                  onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open()}
                >
                  <div className="task-main">
                    <div className="dash-task-text">{r.action ? <Mentions text={r.text} attendees={r.action.attendees} /> : r.text}</div>
                    {r.notes && <div className="task-notes">{r.notes}</div>}
                    <div className="dash-task-meta">
                      {r.done ? <span className="chip">✓ Done {r.doneAt ? ukDate(r.doneAt.slice(0, 10)) : ''}</span> : dueChip(r.due)}
                      {t && onMyDay(t) && !r.done && <span className="chip">☀ My Day</span>}
                      {steps && <span className="chip">{steps}</span>}
                      {t?.remind_on && !r.done && <span className="chip">🔔 {ukDate(t.remind_on)}</span>}
                      {t?.repeat && <span className="chip">🔁 {REPEAT_LABELS[t.repeat]}</span>}
                      <span className="chip">{r.forMe ? 'For me' : `For ${r.forName}`}</span>
                      {r.fyi && <span className="chip">@ You are mentioned</span>}
                      {r.fromName && <span className="chip">From {r.fromName}</span>}
                      {r.action && (
                        <span className="chip">
                          Minutes: {M.projectNameOf(r.action)}
                          {r.action.meetingDate ? ' · ' + M.formatDateSidebar(r.action.meetingDate) : ''}
                        </span>
                      )}
                      {!r.action && jobLabel(r.jobId) && <span className="chip">{jobLabel(r.jobId)}</span>}
                      {r.action?.urgent && <span className="chip flag-urgent">Urgent</span>}
                      {!r.done && !r.forMe && r.due && r.due < today && <span className="chip">⚠ overdue</span>}
                    </div>
                  </div>
                  <span className="task-buttons app-controls">
                    {t && !r.fyi && (
                      <button
                        type="button"
                        className={'task-star' + (t.important ? ' on' : '')}
                        onClick={() => toggleStar(t)}
                        aria-pressed={!!t.important}
                        aria-label={t.important ? 'Important: take the star off' : 'Mark as important'}
                        title={t.important ? 'Important' : 'Mark as important'}
                      >
                        {t.important ? '★' : '☆'}
                      </button>
                    )}
                    {r.action && !r.action.jobArchived && (
                      <button type="button" className="primary" onClick={() => completeAction(r.action!)}>
                        Complete
                      </button>
                    )}
                    {r.task && r.forMe && !r.done && (
                      <button type="button" className="primary" onClick={() => tick(r.task!, true)}>
                        Done
                      </button>
                    )}
                    {r.task && r.done && (r.forMe || r.setByMe) && (
                      <button type="button" className="link-button" onClick={() => tick(r.task!, false)}>
                        Open again
                      </button>
                    )}
                  </span>
                  <span className="task-del app-controls">
                    {r.task && (r.setByMe || isAdmin) && (
                      <button type="button" className="link-button" onClick={() => remove(r.task!)} aria-label="Delete task" title="Delete task">
                        ✕
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </main>
      {openTask && (
        <TaskPanel
          task={openTask}
          people={people}
          jobs={jobs}
          me={me ?? null}
          onSaved={replaceTask}
          onTick={tick}
          onDelete={remove}
          onClose={() => setOpenId(null)}
          toast={showToast}
        />
      )}
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
  const [err, setErr] = useState<string | null>(null)
  // @someone in the task line (23 Nov): pick a colleague and the task is set for them
  const [at, setAt] = useState<{ q: string; from: number } | null>(null)
  const [atHi, setAtHi] = useState(0)
  const atList = at
    ? people
        .filter((p) => {
          const n = personName(p).toLowerCase()
          return !at.q || n.split(/\s+/).some((w) => w.startsWith(at.q.toLowerCase())) || n.startsWith(at.q.toLowerCase())
        })
        .slice(0, 6)
    : []
  function typed(v: string, caret: number) {
    setTitle(v)
    const m = /(^|\s)@([\w'-]*)$/.exec(v.slice(0, caret))
    setAt(m ? { q: m[2], from: caret - m[2].length - 1 } : null)
    setAtHi(0)
  }
  function pickPerson(p: Person) {
    if (!at) return
    const before = title.slice(0, at.from)
    const after = title.slice(at.from + 1 + at.q.length)
    setTitle(`${before}@${personName(p)} ${after.replace(/^\s+/, '')}`)
    if (p.id !== me) setWho(p.id)
    setAt(null)
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!title.trim()) return setErr('Type what the task is first.')
    // the signed-in person, from the app's own sign-in if the profile hasn't loaded
    const mine = me ?? (await supabase.auth.getSession()).data.session?.user.id ?? null
    if (!mine) return setErr('Your login hasn’t loaded yet: refresh the page and try again.')
    setBusy(true)
    try {
      const t = await addTask({ title: title.trim(), notes: notes.trim() || null, job_id: job || null, assigned_to: who || mine, due_date: due || null })
      onAdded(t)
      setTitle('')
      setNotes('')
      setDue('')
    } catch (x) {
      const m = (x as Error).message
      setErr(m)
      onError(m)
    }
    setBusy(false)
  }
  return (
    <form className="new-task app-controls" onSubmit={submit}>
      <span className="new-task-title">
        <input
          value={title}
          onChange={(e) => typed(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={(e) => {
            if (!at || !atList.length) return
            if (e.key === 'ArrowDown') (e.preventDefault(), setAtHi((h) => Math.min(h + 1, atList.length - 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setAtHi((h) => Math.max(h - 1, 0)))
            else if (e.key === 'Enter' || e.key === 'Tab') (e.preventDefault(), pickPerson(atList[atHi]))
            else if (e.key === 'Escape') (e.preventDefault(), setAt(null))
          }}
          onBlur={() => setTimeout(() => setAt(null), 150)}
          placeholder="New task… type @ to give it to someone, e.g. @Ant chase the electrical O&Ms"
          aria-label="Task"
        />
        {at && atList.length > 0 && (
          <ul className="suggest-list mention-list" role="listbox">
            {atList.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === atHi}
                className={i === atHi ? 'on' : ''}
                onMouseDown={(e) => (e.preventDefault(), pickPerson(p))}
                onMouseEnter={() => setAtHi(i)}
              >
                @{personName(p)}
              </li>
            ))}
          </ul>
        )}
      </span>
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
      <button type="submit" className="primary new-task-add" disabled={busy}>
        {busy ? 'Adding…' : 'Add task'}
      </button>
      <button type="button" className="link-button small" onClick={() => setMore(!more)}>
        {more ? 'Fewer options' : 'Job and notes…'}
      </button>
      {err && <p className="mint-error new-task-err">Couldn’t add the task: {err}</p>}
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
