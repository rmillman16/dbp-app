import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, ukDate } from '../lib/format'
import { cached, must } from '../lib/offline'
import { JOB_STATUS_LABELS, type Job, type JobStatus } from '../lib/types'

type Filter = JobStatus | 'all'
const FILTERS: Filter[] = ['live', 'tender', 'complete', 'all']

export default function JobsTable({ title = 'Jobs' }: { title?: string }) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [voCounts, setVoCounts] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('live')
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    cached('jobs', () => must(supabase.from('jobs').select('*').order('job_no', { ascending: false }))).then(
      (data) => setJobs(data as Job[]),
      (e: Error) => setError(e.message),
    )
    cached('vo-job-ids', () => must(supabase.from('variations').select('job_id'))).then(
      (data) => {
        const counts: Record<string, number> = {}
        for (const r of data as { job_id: string }[]) counts[r.job_id] = (counts[r.job_id] ?? 0) + 1
        setVoCounts(counts)
      },
      () => {},
    )
  }, [])

  const q = search.trim().toLowerCase()
  const shown = (jobs ?? [])
    .filter((j) => filter === 'all' || j.status === filter)
    .filter((j) => !q || `${j.job_no} ${j.code} ${j.name}`.toLowerCase().includes(q))

  return (
    <section className="card">
      <div className="pane-head">
        <h2>{title}</h2>
        <Link to="/jobs/new" className="button primary">
          + Add job
        </Link>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search job no., code or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="segmented">
          {FILTERS.map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : JOB_STATUS_LABELS[f]}
              {jobs && <span className="seg-count">{f === 'all' ? jobs.length : jobs.filter((j) => j.status === f).length}</span>}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {jobs === null && !error && <p className="muted">Loading…</p>}
      {jobs && shown.length === 0 && <p className="muted">{jobs.length === 0 ? 'No jobs yet. Add the first one.' : 'No jobs match.'}</p>}
      {shown.length > 0 && (
        <table className="table stack">
          <thead>
            <tr>
              <th>Job</th>
              <th>Name</th>
              <th>Status</th>
              <th className="num">Contract sum</th>
              <th>PC date</th>
              <th className="num">VOs</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((j) => (
              <tr key={j.id} className="clickable" onClick={() => navigate(`/jobs/${j.id}`)}>
                <td className="nowrap stack-title">
                  <strong>
                    {j.job_no} {j.code}
                  </strong>
                </td>
                <td className="stack-sub">{j.name}</td>
                <td data-label="Status">
                  <span className={`tag ${j.status}`}>{JOB_STATUS_LABELS[j.status]}</span>
                </td>
                <td className="num" data-label="Contract sum">
                  {money(j.contract_sum)}
                </td>
                <td className="nowrap" data-label="PC date">
                  {ukDate(j.pc_date)}
                </td>
                <td className="num" data-label="VOs">
                  {voCounts[j.id] ?? 0}
                </td>
                <td className="nowrap">
                  {j.sharepoint_site_url && (
                    <a href={j.sharepoint_site_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      SharePoint ↗
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
