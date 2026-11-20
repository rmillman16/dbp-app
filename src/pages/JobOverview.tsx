import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { money, ukDate } from '../lib/format'
import { useNotifications } from '../lib/notifications'
import { loadJobVariations, projectedValue, type VoWithLines } from '../lib/variations'
import NotificationList from '../components/NotificationList'
import { useJob } from './JobLayout'

export default function JobOverview() {
  const { job } = useJob()
  const { items } = useNotifications()
  const [vos, setVos] = useState<VoWithLines[] | null>(null)

  useEffect(() => {
    loadJobVariations(job).then(setVos, () => setVos([]))
  }, [job])

  const live = vos?.filter((v) => v.vo.status !== 'rejected') ?? []
  const projected = live.reduce((s, v) => s + projectedValue(v.vo, v.build), 0)
  const agreed = live.filter((v) => v.vo.status === 'agreed').reduce((s, v) => s + projectedValue(v.vo, v.build), 0)
  const jobNotes = items.filter((n) => n.job_id === job.id)

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
