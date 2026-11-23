import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { addDaysIso, todayIso } from '../lib/format'
import { useNotifications } from '../lib/notifications'
import NotificationList from '../components/NotificationList'
import { useAccess } from '../lib/access'
import { ADMIN_LIST_NAME } from '../lib/requisitions'

// Home = "My day" (23 Nov): quick actions for what this person does most, then one TODO list of everything
// waiting on them (bell reminders and minutes tasks), overdue first. The jobs list lives under Jobs.
export default function Home() {
  const { me } = useAccess()
  const first = (me?.full_name && me.full_name !== me.email ? me.full_name : '').split(' ')[0]
  const hour = new Date().getHours()
  return (
    <>
      <h1>
        {hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}
        {first ? `, ${first}` : ''}
      </h1>
      <QuickActions />
      <MyTodo />
    </>
  )
}

// ---------- quick actions: only what this person can open (Settings › Access) ----------
function QuickActions() {
  const { can } = useAccess()
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<{ id: string; label: string }[]>([])
  const [meetingJob, setMeetingJob] = useState('')
  useEffect(() => {
    if (!can('job_minutes')) return
    // my jobs first (on the job's Team), then the other live jobs
    ;(async () => {
      const { data: s } = await supabase.auth.getSession()
      const uid = s.session?.user.id
      const [team, live] = await Promise.all([
        uid ? supabase.from('job_team').select('job_id').eq('profile_id', uid) : Promise.resolve({ data: [] as { job_id: string }[] }),
        supabase.from('jobs').select('id, job_no, code, name').eq('status', 'live').order('job_no', { ascending: false }),
      ])
      const mine = new Set((team.data ?? []).map((t) => t.job_id))
      const all = (live.data ?? []).map((j) => ({ id: j.id as string, label: `${j.job_no} ${j.code} · ${j.name}`, mine: mine.has(j.id as string) }))
      setJobs([...all.filter((j) => j.mine), ...all.filter((j) => !j.mine)])
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const actions: { to: string; icon: string; label: string; sub: string; show: boolean }[] = [
    { to: '/site/requisitions/new', icon: '📦', label: 'Material requisition', sub: 'Request materials to site', show: can('site') },
    { to: '/site/requisitions/hire/new', icon: '🏗️', label: 'Hire requisition', sub: 'Plant and tool hire', show: can('site') },
    { to: '/site/buyer/material', icon: '🧾', label: ADMIN_LIST_NAME.material, sub: 'Every material requisition', show: can('buyer_material') },
    { to: '/site/buyer/hire', icon: '🧾', label: ADMIN_LIST_NAME.hire, sub: 'Every hire requisition', show: can('buyer_hire') },
    { to: '/estimating/new', icon: '✏️', label: 'New enquiry', sub: 'Small works, enquiry or tender', show: can('estimating') },
    { to: '/jobs/new', icon: '➕', label: 'New job', sub: 'Set up a won job', show: can('jobs') },
    { to: '/tasks', icon: '✅', label: 'Tasks', sub: 'Set a task, or see yours', show: true },
    { to: '/dashboard', icon: '📊', label: 'Dashboard', sub: 'Every job at a glance', show: can('dashboard') },
  ]
  return (
    <div className="quick-actions">
      {actions
        .filter((a) => a.show)
        .map((a) => (
          <Link key={a.to} to={a.to} className="quick-action">
            <span className="quick-icon" aria-hidden>
              {a.icon}
            </span>
            <span>
              <strong>{a.label}</strong>
              <small>{a.sub}</small>
            </span>
          </Link>
        ))}
      {can('job_minutes') && (
        <div className="quick-action quick-meeting">
          <span className="quick-icon" aria-hidden>
            🗒️
          </span>
          <span>
            <strong>New meeting</strong>
            <select
              value={meetingJob}
              aria-label="Which job is the meeting for?"
              onChange={(e) => {
                setMeetingJob(e.target.value)
                if (e.target.value) navigate(`/jobs/${e.target.value}/minutes`)
              }}
            >
              <option value="">Choose the job…</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </select>
          </span>
        </div>
      )}
    </div>
  )
}

// ---------- my TODO: everything on my bell (reminders and minutes tasks), overdue first ----------
function MyTodo() {
  const { items, error } = useNotifications()
  const [showLater, setShowLater] = useState(false)
  const today = todayIso()
  const week = addDaysIso(today, 7)
  const { overdue, thisWeek, later } = useMemo(() => {
    const byDue = [...items].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    return {
      overdue: byDue.filter((n) => n.due_date && n.due_date < today),
      // due within the week, or not dated (news and questions waiting on me)
      thisWeek: byDue.filter((n) => !n.due_date || (n.due_date >= today && n.due_date <= week)),
      later: byDue.filter((n) => n.due_date && n.due_date > week),
    }
  }, [items, today, week])
  const nothing = overdue.length + thisWeek.length === 0

  return (
    <section className="card my-todo">
      <div className="pane-head">
        <h2>My TODO</h2>
        <Link to="/tasks" className="link-button small">
          Tasks →
        </Link>
      </div>
      {error && <p className="error">{error}</p>}
      {overdue.length > 0 && (
        <>
          <h3 className="todo-head overdue">⚠ Overdue ({overdue.length})</h3>
          <NotificationList items={overdue} />
        </>
      )}
      {thisWeek.length > 0 && (
        <>
          <h3 className="todo-head">This week ({thisWeek.length})</h3>
          <NotificationList items={thisWeek} />
        </>
      )}
      {nothing && <p className="muted">Nothing waiting on you this week.</p>}
      {later.length > 0 && (
        <>
          <button className="link-button small" onClick={() => setShowLater(!showLater)}>
            {showLater ? 'Hide' : 'Show'} later ({later.length})
          </button>
          {showLater && <NotificationList items={later} />}
        </>
      )}
    </section>
  )
}
