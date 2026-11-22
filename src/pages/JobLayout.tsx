import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, ukDate } from '../lib/format'
import { cached, must } from '../lib/offline'
import { JOB_STATUS_LABELS, type Job } from '../lib/types'

// Each module is a tab inside the job; new modules are added here.
const TABS: { to: string; label: string; soon?: boolean }[] = [
  { to: '', label: 'Overview' },
  { to: 'programme', label: 'Programme' },
  { to: 'variations', label: 'Variations' },
  { to: 'quotations', label: 'Quotations' },
  { to: 'applications', label: 'Applications' },
  { to: 'payment-notices', label: 'Payment notices' },
  { to: 'cashflow', label: 'Cashflow' },
  { to: 'procurement', label: 'Procurement' },
  { to: 'sampling', label: 'Sampling' },
  { to: 'eot', label: 'EOT' },
  { to: 'cvr', label: 'CVR' },
  { to: 'om', label: 'O&M', soon: true },
]

export interface JobContext {
  job: Job
  setJob: (j: Job) => void // after a tab saves job fields (e.g. EOT clauses)
}

export function useJob() {
  return useOutletContext<JobContext>()
}

export default function JobLayout() {
  const { id } = useParams()
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  // close the sections dropdown whenever you move to another section
  useEffect(() => setMenuOpen(false), [pathname])

  useEffect(() => {
    cached(`job:${id}`, () => must<Job>(supabase.from('jobs').select('*').eq('id', id).single())).then(
      (data) => setJob(data),
      (e: Error) => setError(e.message),
    )
  }, [id])

  if (error) return <p className="error">{error}</p>
  if (!job) return <p className="muted">Loading…</p>

  // the section you're in: the first part of the address after /jobs/<id>/
  const section = pathname.split('/')[3] ?? ''
  const current = TABS.find((t) => t.to === section) ?? TABS[0]
  const tabs = (cls: string) =>
    TABS.map((t) =>
      t.soon ? (
        <span key={t.label} className={`${cls} disabled`} title="Coming soon">
          {t.label}
          {cls !== 'tab' && <span className="soon">soon</span>}
        </span>
      ) : (
        <NavLink key={t.label} to={t.to} end={t.to === ''} className={cls}>
          {t.label}
        </NavLink>
      ),
    )

  return (
    <>
      {/* one line (22 Nov): status, then the job, then PC, contract sum and SharePoint */}
      <div className="job-head job-head-line">
        <Link to="/jobs" className="job-back" title="All jobs" aria-label="All jobs">
          ←
        </Link>
        <span className={`tag ${job.status}`}>{JOB_STATUS_LABELS[job.status]}</span>
        <h1>
          {job.job_no} {job.code} · {job.name}
        </h1>
        <span className="job-meta muted">
          {job.pc_date && <span>PC {ukDate(job.pc_date)}</span>}
          <span>{money(job.contract_sum) || 'No contract sum'}</span>
          {job.sharepoint_site_url && (
            <a href={job.sharepoint_site_url} target="_blank" rel="noreferrer">
              SharePoint ↗
            </a>
          )}
        </span>
        <Link to={`/jobs/${job.id}/edit`} className="button small-button job-edit">
          Edit job
        </Link>
      </div>

      <nav className="tabs">{tabs('tab')}</nav>

      {/* phones: one bar showing this section, with the job's sections in a ☰ dropdown */}
      <div className="job-menu">
        <button className="job-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="Job sections">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d={menuOpen ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span>{current.label}</span>
          <span className="job-menu-caret" aria-hidden>
            ▾
          </span>
        </button>
        {menuOpen && (
          <>
            <div className="job-menu-scrim" onClick={() => setMenuOpen(false)} />
            <nav className="job-menu-list">{tabs('job-menu-item')}</nav>
          </>
        )}
      </div>

      <Outlet context={{ job, setJob } satisfies JobContext} />
    </>
  )
}
