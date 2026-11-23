import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, todayIso, ukDate } from '../lib/format'
import { VO_STATUS_LABELS } from '../lib/types'
import { needsAttention, useNotifications } from '../lib/notifications'
import { loadJobVariations, projectedValue, type VoWithLines } from '../lib/variations'
import NotificationList from '../components/NotificationList'
import JobSowCard from '../components/JobSow'
import { downloadValuationCalendar, valuationDates } from '../lib/calendar'
import { useJob } from './JobLayout'
import { completeAction, dueStatus, formatDateSidebar, loadJobActions, meetingPath, plainMentions, projectNameOf, type OpenAction } from '../lib/minutes'
import { useAccess } from '../lib/access'
import JobTeam from '../components/JobTeam'

export default function JobOverview() {
  const { job } = useJob()
  const { attention, items, reload } = useNotifications()
  const { can } = useAccess()
  const navigate = useNavigate()
  // the To do box (22 Nov): requisition questions and answers waiting on me for this job
  const todo = items.filter(
    (n) => n.job_id === job.id && (/^requisition_(query|answer)$/.test(n.kind) || ((n.kind === 'off_hire_due' || n.kind === 'om_due' || n.kind === 'task') && needsAttention(n))),
  )
  const [vos, setVos] = useState<VoWithLines[] | null>(null)
  const [calMsg, setCalMsg] = useState<string | null>(null)
  // and every open action from the job's minutes, whoever owns it (22 Nov, script 045)
  const [actions, setActions] = useState<OpenAction[]>([])
  const [actionErr, setActionErr] = useState<string | null>(null)
  useEffect(() => {
    if (can('job_minutes')) loadJobActions(job.id).then(setActions)
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

  useEffect(() => {
    loadJobVariations(job).then(setVos, () => setVos([]))
  }, [job])

  const live = vos?.filter((v) => v.vo.status !== 'rejected') ?? []
  const projected = live.reduce((s, v) => s + projectedValue(v.vo, v.build), 0)
  const agreed = live.filter((v) => v.vo.status === 'agreed').reduce((s, v) => s + projectedValue(v.vo, v.build), 0)
  // what needs attention now (future valuation reminders etc. stay under the bell's "upcoming")
  const jobNotes = attention.filter((n) => n.job_id === job.id)

  return (
    <div className="overview-grid">
      {/* TODO first and full width: likely the most useful bit (23 Nov) */}
      <section className="card span-all todo-card">
        <h2>TODO</h2>
        {todo.length > 0 && <NotificationList items={todo} />}
        {actions.length > 0 && <MinutesActions actions={actions} onDone={tickAction} />}
        {actionErr && <p className="error">{actionErr}</p>}
        {todo.length === 0 && actions.length === 0 && (
          <p className="muted small">Nothing waiting. Open actions from the job's minutes, requisition questions and off-hire reminders show here.</p>
        )}
      </section>

      {/* space kept for the next two modules, side by side under TODO: RFIs left, Submittals right (23 Nov) */}
      <div className="span-all overview-pair">
        <section className="card coming-card">
          <h2>RFIs</h2>
          <p className="muted small">Coming soon: requests for information, who they're with, response due dates and reminders.</p>
        </section>
        <section className="card coming-card">
          <h2>Submittals</h2>
          <p className="muted small">Coming soon: what's been submitted to the client / design team, who it's with and when a response is due.</p>
        </section>
      </div>

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

      {/* the other modules at a glance */}
      <ModuleCards jobId={job.id} pcDate={job.pc_date} />

      <section className="card">
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
        </dl>
      </section>

      <section className="card">
        <h2>Valuation dates</h2>
        {job.status !== 'live' ? (
          <p className="muted small">Monthly valuation reminders run while the job is Live.</p>
        ) : (
          <>
            <p className="muted small">
              Valuation starts one week before each month end{job.pc_date ? `, to PC (${ukDate(job.pc_date)})` : ', for the next 12 months (no PC date yet)'}. The reminder shows on
              the bell in that last week.
            </p>
            <ul className="date-list">
              {valuationDates(job)
                .slice(0, 3)
                .map((d) => (
                  <li key={d.due}>
                    <strong>{ukDate(d.due)}</strong> <span className="muted">· {d.month}</span>
                  </li>
                ))}
            </ul>
            <button onClick={() => setCalMsg(`${downloadValuationCalendar(job)} appointments downloaded: open the file to add them to Outlook.`)}>
              Add valuation dates to my calendar
            </button>
            {calMsg && <p className="small">{calMsg}</p>}
          </>
        )}
      </section>

      {/* who's on the job: O&M reminders go to them (23 Nov, script 047) */}
      <JobTeam job={job} />

      {/* the job's one SoW (Valuations, CVR and Cashflow all use it) */}
      <JobSowCard compact />

      {jobNotes.length > 0 && (
        <section className="card span-all">
          <h2>Notifications for this job</h2>
          <NotificationList items={jobNotes} />
        </section>
      )}
    </div>
  )
}

// the other modules at a glance (23 Nov): a few counts each, linking to the tab; a part you can't open is left out
function ModuleCards({ jobId, pcDate }: { jobId: string; pcDate: string | null }) {
  const { can } = useAccess()
  const [m, setM] = useState<{
    finish: string | null
    proc: { total: number; ordered: number; late: number } | null
    samples: { total: number; approved: number; waiting: number } | null
    meetings: { count: number; last: string | null } | null
    reqs: { open: number; onHire: number } | null
  } | null>(null)
  useEffect(() => {
    const today = todayIso()
    const get = async <T,>(q: PromiseLike<{ data: T[] | null }>) => (await q).data ?? []
    Promise.all([
      can('job_programme')
        ? get<{ finish_date: string | null }>(supabase.from('programmes').select('finish_date').eq('job_id', jobId).order('imported_at', { ascending: false }).limit(1))
        : [],
      can('job_procurement')
        ? get<{ status: string; latest_order_date: string | null }>(supabase.from('procurement_items').select('status, latest_order_date').eq('job_id', jobId))
        : null,
      can('job_sampling') ? get<{ status: string }>(supabase.from('samples').select('status').eq('job_id', jobId)) : null,
      can('job_minutes')
        ? get<{ meeting_date: string | null }>(supabase.from('meetings').select('meeting_date').eq('job_id', jobId).order('meeting_date', { ascending: false }))
        : null,
      get<{ kind: string; status: string }>(supabase.from('requisitions').select('kind, status').eq('job_id', jobId)),
    ]).then(([prog, proc, samples, meetings, reqs]) => {
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
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])
  if (!m) return null
  const slip = m.finish && pcDate ? Math.round((Date.parse(m.finish) - Date.parse(pcDate)) / 86400000) : null
  return (
    <div className="span-all module-cards">
      {can('job_programme') && (
        <Link to="programme" className="card module-card">
          <h3>Programme</h3>
          {m.finish ? (
            <>
              <strong>Finish {ukDate(m.finish)}</strong>
              {slip != null && (
                <span className={slip > 0 ? 'late small' : 'muted small'}>{slip > 0 ? `⚠ ${slip} days after PC` : slip < 0 ? `${-slip} days before PC` : 'on PC'}</span>
              )}
            </>
          ) : (
            <span className="muted small">No programme yet</span>
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
      <Link to="/site" className="card module-card">
        <h3>Requisitions</h3>
        <strong>{m.reqs?.open ?? 0} open</strong>
        <span className="muted small">{m.reqs?.onHire ?? 0} on hire</span>
      </Link>
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
