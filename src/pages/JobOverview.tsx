import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { addDaysIso, money, todayIso, ukDate } from '../lib/format'
import { VO_STATUS_LABELS, type Job } from '../lib/types'
import { useNotifications } from '../lib/notifications'
import { loadJobVariations, projectedValue, type VoWithLines } from '../lib/variations'
import NotificationList from '../components/NotificationList'
import JobSowCard from '../components/JobSow'
import { downloadValuationCalendar, valuationDates } from '../lib/calendar'
import { useJob } from './JobLayout'
import { completeAction, dueStatus, formatDateSidebar, loadJobActions, meetingPath, plainMentions, projectNameOf, type OpenAction } from '../lib/minutes'
import { useAccess } from '../lib/access'
import ProjectDirectory from '../components/ProjectDirectory'
import ProjectChecklist from '../components/ProjectChecklist'

// Job Overview (23 Nov, tidied): Job details top left and TODO taking the rest of that row; the modules at a glance in one row
// of tiles (each opens its tab); the variations; then people (the DBP team and the outside people in one card) and the SoW.
export default function JobOverview() {
  const { job } = useJob()
  const navigate = useNavigate()
  const { can: canSee } = useAccess()
  const [vos, setVos] = useState<VoWithLines[] | null>(null)
  useEffect(() => {
    loadJobVariations(job).then(setVos, () => setVos([]))
  }, [job])

  const live = vos?.filter((v) => v.vo.status !== 'rejected') ?? []
  const projected = live.reduce((s, v) => s + projectedValue(v.vo, v.build), 0)
  const agreed = live.filter((v) => v.vo.status === 'agreed').reduce((s, v) => s + projectedValue(v.vo, v.build), 0)

  return (
    <div className="overview-grid">
      <div className="span-all overview-top">
        <JobDetails job={job} />
        <JobTodo job={job} />
      </div>

      {/* the other modules at a glance: one row of tiles */}
      <ModuleCards job={job} />


      {/* all the VOs */}
      <section className="card span-all">
        <div className="pane-head">
          <h2>Variations</h2>
          <Link to="variations" className="link-button small">
            Open register →
          </Link>
        </div>
        <div className="stat-row">
          <div className="stat">
            <span className="muted small">Projected increase</span>
            <strong>{money(projected)}</strong>
          </div>
          <div className="stat">
            <span className="muted small">Agreed</span>
            <strong>{money(agreed)}</strong>
          </div>
          <div className="stat">
            <span className="muted small">VOs</span>
            <strong>{vos?.length ?? '…'}</strong>
          </div>
          {job.contract_sum != null && (
            <div className="stat">
              <span className="muted small">Anticipated final account</span>
              <strong>{money(Number(job.contract_sum) + projected)}</strong>
            </div>
          )}
        </div>
        {vos && vos.length > 0 && (
          <table className="table stack vo-overview">
            <thead>
              <tr>
                <th>VO</th>
                <th>Title</th>
                <th>Status</th>
                <th>Date</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {[...vos]
                .sort((x, y) => y.vo.vo_no - x.vo.vo_no)
                .map((v) => (
                  <tr key={v.vo.id} className="clickable" onClick={() => navigate(`variations/${v.vo.id}`)}>
                    <td className="stack-title nowrap">
                      <span className={`vo-chip ${v.vo.status}`}>VO {v.vo.vo_no}</span>
                    </td>
                    <td className="stack-sub">{v.vo.title}</td>
                    <td data-label="Status">{VO_STATUS_LABELS[v.vo.status]}</td>
                    <td className="nowrap" data-label="Date">
                      {ukDate(v.vo.vo_date)}
                    </td>
                    <td className="num nowrap" data-label="Value">
                      {money(projectedValue(v.vo, v.build))}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>

      {/* everyone on the job in one card: the DBP team, and the outside people by company */}
      <div className="span-all overview-bottom">
        <ProjectDirectory job={job} />
        <JobSowCard compact />
      </div>

      {/* H&S and compliance checklist: F10 etc (script 076), at the bottom and closed until opened */}
      {canSee('job_checklist') && <ProjectChecklist job={job} />}
    </div>
  )
}

// ---------- Job details (with the valuation dates), top left ----------
function JobDetails({ job }: { job: Job }) {
  const [calMsg, setCalMsg] = useState<string | null>(null)
  return (
    <section className="card job-details-card">
      <h2>Job details</h2>
      <dl className="details">
        <dt>Site address</dt>
        <dd>{job.site_address || '–'}</dd>
        <dt>Form of contract</dt>
        <dd>{job.contract_form || '–'}</dd>
        <dt>Contract sum</dt>
        <dd>{money(job.contract_sum) || '–'}</dd>
        <dt>Start on site</dt>
        <dd>{ukDate(job.start_date) || '–'}</dd>
        <dt>PC date</dt>
        <dd>{ukDate(job.pc_date) || '–'}</dd>
        <dt>OHP / prelims / retention</dt>
        <dd>
          {job.ohp_pct}% / {job.prelims_pct}% / {job.retention_pct}%
        </dd>
        {job.report_frequency_days ? (
          <>
            <dt>Progress report</dt>
            <dd>every {job.report_frequency_days} days</dd>
          </>
        ) : null}
      </dl>
      <h3 className="sub-head">Next valuations</h3>
      {job.status !== 'live' ? (
        <p className="muted small">Monthly valuation reminders run while the job is Live.</p>
      ) : (
        <>
          <ul className="date-list">
            {valuationDates(job)
              .slice(0, 3)
              .map((d) => (
                <li key={d.due}>
                  <strong>{ukDate(d.due)}</strong> <span className="muted">· {d.month}</span>
                </li>
              ))}
          </ul>
          <button type="button" className="small-button" onClick={() => setCalMsg(`${downloadValuationCalendar(job)} appointments downloaded: open the file to add them to Outlook.`)}>
            Add valuation dates to my calendar
          </button>
          {calMsg && <p className="small">{calMsg}</p>}
        </>
      )}
    </section>
  )
}

// ---------- TODO: everything waiting on me for this job, in one list ----------
// This is the bell's notifications for this job and the job's open minutes actions, together (there used to be a TODO box and a
// separate "Notifications for this job" box showing the same list twice). Overdue first, then this week, then later.
function JobTodo({ job }: { job: Job }) {
  const { items, reload, error } = useNotifications()
  const { can } = useAccess()
  const [actions, setActions] = useState<OpenAction[]>([])
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [showLater, setShowLater] = useState(false)
  useEffect(() => {
    if (can('job_minutes')) loadJobActions(job.id).then(setActions, () => setActions([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id])
  async function tickAction(a: OpenAction) {
    setActionErr(null)
    try {
      await completeAction(a.pointId, true)
      setActions((l) => l.filter((x) => x.pointId !== a.pointId))
      reload()
    } catch (e) {
      setActionErr((e as Error).message)
    }
  }
  const today = todayIso()
  const week = addDaysIso(today, 7)
  // minutes actions are listed below with their Done button, so their bell reminders aren't repeated here
  const mine = useMemo(
    () => items.filter((n) => n.job_id === job.id && n.kind !== 'minutes_action').sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')),
    [items, job.id],
  )
  const overdue = mine.filter((n) => n.due_date && n.due_date < today)
  const thisWeek = mine.filter((n) => !n.due_date || (n.due_date >= today && n.due_date <= week))
  const later = mine.filter((n) => n.due_date && n.due_date > week)
  const nothing = overdue.length + thisWeek.length === 0 && actions.length === 0

  return (
    <section className="card todo-card">
      <div className="pane-head">
        <h2>TODO</h2>
        <span className="muted small">
          {overdue.length + thisWeek.length + actions.length} waiting{overdue.length > 0 && <span className="late"> · ⚠ {overdue.length} overdue</span>}
        </span>
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
      {actions.length > 0 && (
        <>
          <h3 className="todo-head">Actions from the minutes ({actions.length})</h3>
          <MinutesActions actions={actions} onDone={tickAction} />
        </>
      )}
      {actionErr && <p className="error">{actionErr}</p>}
      {nothing && <p className="muted small">Nothing waiting on you for this job. Reminders, questions, chasers and open minutes actions show here.</p>}
      {later.length > 0 && (
        <>
          <button type="button" className="link-button small" onClick={() => setShowLater(!showLater)}>
            {showLater ? 'Hide' : 'Show'} later ({later.length})
          </button>
          {showLater && <NotificationList items={later} />}
        </>
      )}
    </section>
  )
}

// ---------- the modules at a glance: one row of tiles, each opens its tab; a part you can't open is left out ----------
function ModuleCards({ job }: { job: Job }) {
  const { can } = useAccess()
  const jobId = job.id
  const [m, setM] = useState<{
    finish: string | null
    proc: { total: number; ordered: number; late: number } | null
    samples: { total: number; approved: number; waiting: number } | null
    meetings: { count: number; last: string | null } | null
    reqs: { open: number; onHire: number } | null
    rfis: { open: number; overdue: number; answered: number; total: number } | null
    subs: { out: number; overdue: number; revise: number; total: number } | null
    reports: { last: number | null; lastEnd: string | null; status: string | null } | null
    snags: { todo: number; check: number; total: number } | null
  } | null>(null)
  useEffect(() => {
    const today = todayIso()
    const get = async <T,>(q: PromiseLike<{ data: T[] | null }>) => (await q).data ?? []
    Promise.all([
      can('job_programme') ? get<{ finish_date: string | null }>(supabase.from('programmes').select('finish_date').eq('job_id', jobId).order('imported_at', { ascending: false }).limit(1)) : [],
      can('job_procurement') ? get<{ status: string; latest_order_date: string | null }>(supabase.from('procurement_items').select('status, latest_order_date').eq('job_id', jobId)) : null,
      can('job_sampling') ? get<{ status: string }>(supabase.from('samples').select('status').eq('job_id', jobId)) : null,
      can('job_minutes') ? get<{ meeting_date: string | null }>(supabase.from('meetings').select('meeting_date').eq('job_id', jobId).order('meeting_date', { ascending: false })) : null,
      get<{ kind: string; status: string }>(supabase.from('requisitions').select('kind, status').eq('job_id', jobId)),
      can('job_rfis') ? get<{ status: string; due_date: string | null }>(supabase.from('rfis').select('status, due_date').eq('job_id', jobId)) : null,
      can('job_rfis') ? get<{ status: string; due_date: string | null }>(supabase.from('submittals').select('status, due_date').eq('job_id', jobId)) : null,
      can('job_progress') ? get<{ report_no: number; period_end: string | null; status: string }>(supabase.from('progress_reports').select('report_no, period_end, status').eq('job_id', jobId).order('report_no', { ascending: false }).limit(1)) : null,
      can('job_snagging') ? get<{ status: string; marked_done_at: string | null }>(supabase.from('snags').select('status, marked_done_at').eq('job_id', jobId)) : null,
    ]).then(([prog, proc, samples, meetings, reqs, rfis, subs, reports, snags]) => {
      const done = ['ordered', 'on_site', 'complete', 'covered', 'nothing_to_order']
      setM({
        finish: (prog as { finish_date: string | null }[])[0]?.finish_date ?? null,
        proc: proc && {
          total: proc.length,
          ordered: proc.filter((p) => done.includes(p.status)).length,
          late: proc.filter((p) => !done.includes(p.status) && p.latest_order_date && p.latest_order_date < today).length,
        },
        samples: samples && {
          total: samples.length,
          approved: samples.filter((x) => x.status === 'approved' || x.status === 'approved_with_comments').length,
          waiting: samples.filter((x) => x.status === 'requested' || x.status === 'submitted').length,
        },
        meetings: meetings && { count: meetings.length, last: meetings[0]?.meeting_date ?? null },
        reqs: {
          open: reqs.filter((r) => ['new', 'query', 'answered'].includes(r.status)).length,
          onHire: reqs.filter((r) => r.kind === 'hire' && ['ordered', 'delivered'].includes(r.status)).length,
        },
        rfis: rfis && {
          open: rfis.filter((r) => r.status === 'open').length,
          overdue: rfis.filter((r) => r.status === 'open' && r.due_date && r.due_date < today).length,
          answered: rfis.filter((r) => r.status === 'answered').length,
          total: rfis.length,
        },
        subs: subs && {
          out: subs.filter((s) => s.status === 'out').length,
          overdue: subs.filter((s) => s.status === 'out' && s.due_date && s.due_date < today).length,
          revise: subs.filter((s) => s.status === 'revise' || s.status === 'rejected').length,
          total: subs.length,
        },
        reports: reports && { last: reports[0]?.report_no ?? null, lastEnd: reports[0]?.period_end ?? null, status: reports[0]?.status ?? null },
        snags: snags && { todo: snags.filter((x) => x.status === 'incomplete' && !x.marked_done_at).length, check: snags.filter((x) => x.status === 'incomplete' && !!x.marked_done_at).length, total: snags.length },
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])
  if (!m) return null
  const slip = m.finish && job.pc_date ? Math.round((Date.parse(m.finish) - Date.parse(job.pc_date)) / 86400000) : null
  const days = job.report_frequency_days
  const nextReport = days && days > 0 ? addDaysIso(m.reports?.lastEnd ?? job.start_date ?? todayIso(), days) : null
  return (
    <div className="span-all module-cards">
      {can('job_programme') && (
        <Link to="programme" className="card module-card">
          <h3>Programme</h3>
          {m.finish ? (
            <>
              <strong>Finish {ukDate(m.finish)}</strong>
              {slip != null && <span className={slip > 0 ? 'late small' : 'muted small'}>{slip > 0 ? `⚠ ${slip} days after PC` : slip < 0 ? `${-slip} days before PC` : 'on PC'}</span>}
            </>
          ) : (
            <span className="muted small">No programme yet</span>
          )}
        </Link>
      )}
      {m.rfis && (
        <Link to="rfis" className="card module-card">
          <h3>RFIs</h3>
          {m.rfis.total === 0 ? (
            <span className="muted small">None yet</span>
          ) : (
            <>
              <strong>{m.rfis.open} open</strong>
              <span className={m.rfis.overdue > 0 ? 'late small' : 'muted small'}>
                {m.rfis.overdue > 0 ? `⚠ ${m.rfis.overdue} overdue · ` : ''}
                {m.rfis.answered} answered, to close
              </span>
            </>
          )}
        </Link>
      )}
      {m.subs && (
        <Link to="submittals" className="card module-card">
          <h3>Submittals</h3>
          {m.subs.total === 0 ? (
            <span className="muted small">None yet</span>
          ) : (
            <>
              <strong>{m.subs.out} out for review</strong>
              <span className={m.subs.overdue > 0 ? 'late small' : 'muted small'}>
                {m.subs.overdue > 0 ? `⚠ ${m.subs.overdue} overdue · ` : ''}
                {m.subs.revise} to revise
              </span>
            </>
          )}
        </Link>
      )}
      {m.proc && (
        <Link to="procurement" className="card module-card">
          <h3>Procurement</h3>
          <strong>
            {m.proc.ordered} of {m.proc.total} ordered
          </strong>
          {m.proc.late > 0 ? <span className="late small">⚠ {m.proc.late} past order-by date</span> : <span className="muted small">nothing past its order-by date</span>}
        </Link>
      )}
      {m.samples && (
        <Link to="sampling" className="card module-card">
          <h3>Sampling</h3>
          <strong>
            {m.samples.approved} of {m.samples.total} approved
          </strong>
          <span className="muted small">{m.samples.waiting} with the designer / awaited</span>
        </Link>
      )}
      {m.meetings && (
        <Link to="minutes" className="card module-card">
          <h3>Minutes</h3>
          <strong>
            {m.meetings.count} meeting{m.meetings.count === 1 ? '' : 's'}
          </strong>
          <span className="muted small">{m.meetings.last ? `last ${ukDate(m.meetings.last)}` : 'none yet'}</span>
        </Link>
      )}
      {m.reports && (
        <Link to="progress" className="card module-card">
          <h3>Progress reports</h3>
          <strong>{m.reports.last ? `Report ${m.reports.last}` : 'None yet'}</strong>
          <span className={nextReport && nextReport < todayIso() ? 'late small' : 'muted small'}>{nextReport ? `next due ${ukDate(nextReport)}` : m.reports.status ? m.reports.status : 'no frequency set'}</span>
        </Link>
      )}
      <Link to="/site" className="card module-card">
        <h3>Requisitions</h3>
        <strong>{m.reqs?.open ?? 0} open</strong>
        <span className="muted small">{m.reqs?.onHire ?? 0} on hire</span>
      </Link>
      {m.snags && (
        <Link to="snagging" className="card module-card">
          <h3>Snagging</h3>
          {m.snags.total === 0 ? (
            <span className="muted small">No snags yet</span>
          ) : (
            <>
              <strong>{m.snags.todo} to do</strong>
              <span className={m.snags.check > 0 ? 'late small' : 'muted small'}>{m.snags.check > 0 ? `${m.snags.check} to check` : `${m.snags.total} in all`}</span>
            </>
          )}
        </Link>
      )}
    </div>
  )
}

// the job's open minutes actions: what, who, when it's due, and the meeting it came from; Done ticks it in the minutes
function MinutesActions({ actions, onDone }: { actions: OpenAction[]; onDone: (a: OpenAction) => void }) {
  return (
    <ul className="notif-list">
      {actions.map((a) => {
        const status = dueStatus({ done: false, dueDate: a.dueDate })
        return (
          <li key={a.pointId} className={'notif ' + (status === 'overdue' ? 'overdue' : status === 'soon' ? 'due_soon' : 'info')}>
            <div className="notif-main">
              <Link to={meetingPath({ id: a.meetingId, jobId: a.jobId, enquiryId: a.enquiryId })}>
                {a.urgent && <strong>Urgent: </strong>}
                {plainMentions(a.text || '(no description)', a.attendees)}
              </Link>
              <div className="muted small">
                {a.ownerName ?? 'Unassigned'} · minutes: {projectNameOf(a)}
                {a.meetingDate ? ', ' + formatDateSidebar(a.meetingDate) : ''}
              </div>
              {a.dueDate && (
                <div className="small">
                  {status === 'overdue' ? 'Overdue · ' : status === 'soon' ? 'Due soon · ' : 'Due '}
                  {ukDate(a.dueDate)}
                </div>
              )}
            </div>
            <div className="notif-actions">
              <button className="small-button" onClick={() => onDone(a)} title="Tick the action done in the minutes">
                Done
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
