import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom'
import { useAccess, type Section } from '../lib/access'
import { NoAccess } from '../components/NoAccess'
import ReadOnlyArea from '../components/ReadOnlyArea'
import { saveError } from '../lib/offline'
import { supabase } from '../lib/supabase'
import { money, ukDate } from '../lib/format'
import { cached, must } from '../lib/offline'
import { JOB_STATUS_LABELS, type Job } from '../lib/types'

// Each module is a tab inside the job; new modules are added here.
const TABS: { to: string; label: string; soon?: boolean; section?: Section }[] = [
  { to: '', label: 'Overview' },
  { to: 'programme', label: 'Programme', section: 'job_programme' },
  { to: 'minutes', label: 'Minutes', section: 'job_minutes' },
  { to: 'variations', label: 'Variations', section: 'job_commercial' },
  { to: 'quotations', label: 'Quotations', section: 'job_commercial' },
  { to: 'applications', label: 'Applications', section: 'job_commercial' },
  { to: 'orders', label: 'Orders', section: 'job_commercial' },
  { to: 'cashflow', label: 'Cashflow', section: 'job_commercial' },
  { to: 'procurement', label: 'Procurement', section: 'job_procurement' },
  { to: 'sampling', label: 'Sampling', section: 'job_sampling' },
  { to: 'eot', label: 'EOT', section: 'job_eot' },
  { to: 'cvr', label: 'CVR', section: 'job_commercial' },
  { to: 'submittals', label: 'Submittals', section: 'job_rfis' },
  { to: 'rfis', label: 'RFIs', section: 'job_rfis' },
  { to: 'om', label: 'O&M', section: 'job_om' },
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
  const { can, isAdmin } = useAccess()
  const [archiveErr, setArchiveErr] = useState<string | null>(null)

  // close the sections dropdown whenever you move to another section
  useEffect(() => setMenuOpen(false), [pathname])

  useEffect(() => {
    cached(`job:${id}`, () => must<Job>(supabase.from('jobs').select('*').eq('id', id).single())).then(
      (data) => setJob(data),
      (e: Error) => setError(e.message),
    )
  }, [id])

  // archiving (22 Nov, script 042): admins only; an archived job is read-only and its reminders keep running
  async function setArchived(on: boolean) {
    if (!job) return
    const msg = on
      ? `Archive ${job.job_no} ${job.code}? It becomes read-only for everyone and leaves the live lists. Its defects and retention reminders keep running. An admin can unarchive it.`
      : `Unarchive ${job.job_no} ${job.code}? It goes back to Complete and can be changed again.`
    if (!confirm(msg)) return
    setArchiveErr(null)
    const r = await supabase
      .from('jobs')
      .update({ status: on ? 'archived' : 'complete' })
      .eq('id', job.id)
      .select('*')
      .single()
    if (r.error) setArchiveErr(saveError(r.error))
    else setJob(r.data as Job)
  }

  if (error) return <p className="error">{error}</p>
  if (!job) return <p className="muted">Loading…</p>

  // the section you're in: the first part of the address after /jobs/<id>/
  const section = pathname.split('/')[3] ?? ''
  const current = TABS.find((t) => t.to === section) ?? TABS[0]
  const tabs = (cls: string) =>
    TABS.filter((t) => !t.section || can(t.section)).map((t) =>
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
        {job.status !== 'archived' && (
          <Link to={`/jobs/${job.id}/edit`} className="button small-button job-edit">
            Edit job
          </Link>
        )}
        {isAdmin && (
          <button className="small-button job-archive" onClick={() => setArchived(job.status !== 'archived')}>
            {job.status === 'archived' ? 'Unarchive' : 'Archive'}
          </button>
        )}
      </div>
      {job.status === 'archived' && (
        <p className="archived-banner">
          <strong>Archived:</strong> read-only. Defects and retention reminders keep running.
          {isAdmin ? ' Unarchive it (above) to make changes.' : ' Ask an admin if something needs changing.'}
        </p>
      )}
      {archiveErr && <p className="error">{archiveErr}</p>}

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

      {current.section && !can(current.section) ? (
        <NoAccess what={`${current.label} on jobs`} />
      ) : (
        <ReadOnlyArea on={job.status === 'archived'}>
          <Outlet context={{ job, setJob } satisfies JobContext} />
        </ReadOnlyArea>
      )}
    </>
  )
}
