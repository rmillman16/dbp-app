import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, ukDate } from '../lib/format'
import { cached, must } from '../lib/offline'
import { JOB_STATUS_LABELS, type Job } from '../lib/types'

// Each module is a tab inside the job; new modules are added here.
const TABS: { to: string; label: string; soon?: boolean }[] = [
  { to: '', label: 'Overview' },
  { to: 'variations', label: 'Variations' },
  { to: 'quotations', label: 'Quotations' },
  { to: 'applications', label: 'Applications' },
  { to: 'payment-notices', label: 'Payment notices', soon: true },
  { to: 'om', label: 'O&M', soon: true },
]

export interface JobContext {
  job: Job
}

export function useJob() {
  return useOutletContext<JobContext>()
}

export default function JobLayout() {
  const { id } = useParams()
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    cached(`job:${id}`, () => must<Job>(supabase.from('jobs').select('*').eq('id', id).single())).then(
      (data) => setJob(data),
      (e: Error) => setError(e.message),
    )
  }, [id])

  if (error) return <p className="error">{error}</p>
  if (!job) return <p className="muted">Loading…</p>

  return (
    <>
      <div className="job-head">
        <div>
          <Link to="/jobs" className="link-button small">
            ← Jobs
          </Link>
          <h1>
            {job.job_no} {job.code} · {job.name}
          </h1>
          <div className="job-meta muted">
            <span className={`tag ${job.status}`}>{JOB_STATUS_LABELS[job.status]}</span>
            <span>Contract sum {money(job.contract_sum) || '–'}</span>
            {job.pc_date && <span>PC {ukDate(job.pc_date)}</span>}
            {job.sharepoint_site_url && (
              <a href={job.sharepoint_site_url} target="_blank" rel="noreferrer">
                SharePoint site ↗
              </a>
            )}
          </div>
        </div>
        <Link to={`/jobs/${job.id}/edit`} className="button">
          Edit job details
        </Link>
      </div>

      <nav className="tabs">
        {TABS.map((t) =>
          t.soon ? (
            <span key={t.label} className="tab disabled" title="Coming soon">
              {t.label}
            </span>
          ) : (
            <NavLink key={t.label} to={t.to} end={t.to === ''} className="tab">
              {t.label}
            </NavLink>
          ),
        )}
      </nav>

      <Outlet context={{ job } satisfies JobContext} />
    </>
  )
}
