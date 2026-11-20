import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { money, ukDate } from '../lib/format'
import { useNotifications } from '../lib/notifications'
import { loadJobVariations, projectedValue, type VoWithLines } from '../lib/variations'
import NotificationList from '../components/NotificationList'
import { downloadValuationCalendar, valuationDates } from '../lib/calendar'
import { useJob } from './JobLayout'

export default function JobOverview() {
  const { job } = useJob()
  const { attention } = useNotifications()
  const [vos, setVos] = useState<VoWithLines[] | null>(null)
  const [calMsg, setCalMsg] = useState<string | null>(null)

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
              Valuation starts one week before each month end{job.pc_date ? `, to PC (${ukDate(job.pc_date)})` : ', for the next 12 months (no PC date yet)'}. The reminder
              shows on the bell in that last week.
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

      <section className="card">
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
        </div>
        {job.contract_sum != null && (
          <p className="muted small">
            Anticipated final account (contract sum + projected variations): <strong>{money(Number(job.contract_sum) + projected)}</strong>
          </p>
        )}
      </section>

      {jobNotes.length > 0 && (
        <section className="card span-all">
          <h2>Notifications for this job</h2>
          <NotificationList items={jobNotes} />
        </section>
      )}
    </div>
  )
}
