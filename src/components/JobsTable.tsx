import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, ukDate } from '../lib/format'
import { cached, must } from '../lib/offline'
import { JOB_STATUS_LABELS, type Job, type JobStatus, type Profile } from '../lib/types'
import { loadCompanies } from '../lib/subcontracts'
import Loading from './Loading'

type Filter = JobStatus | 'all'
const FILTERS: Filter[] = ['live', 'tender', 'complete', 'archived', 'all']

export default function JobsTable({ title = 'Jobs' }: { title?: string }) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [voCounts, setVoCounts] = useState<Record<string, number>>({})
  const [clients, setClients] = useState<Record<string, string>>({})
  const [pms, setPms] = useState<Record<string, string>>({}) // job → PM's name(s), from the job's Team card
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
    loadCompanies().then(
      (cs) => setClients(Object.fromEntries(cs.map((c) => [c.id, c.name]))),
      () => {},
    )
    Promise.all([
      cached('job-team-all', () => must<{ job_id: string; profile_id: string; role: string }[]>(supabase.from('job_team').select('job_id, profile_id, role'))),
      cached('profiles', () => must<Profile[]>(supabase.from('profiles').select('*'))),
    ]).then(
      ([team, people]) => {
        const name = new Map(people.map((p) => [p.id, p.full_name && p.full_name !== p.email ? p.full_name : (p.email ?? '')]))
        const out: Record<string, string[]> = {}
        for (const t of team) if (/^(pm|project manager)$/i.test(t.role.trim())) (out[t.job_id] ??= []).push(name.get(t.profile_id) ?? '')
        setPms(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.filter(Boolean).join(', ')])))
      },
      () => {},
    )
  }, [])

  const q = search.trim().toLowerCase()
  const shown = (jobs ?? []).filter((j) => filter === 'all' || j.status === filter).filter((j) => !q || `${j.job_no} ${j.code} ${j.name}`.toLowerCase().includes(q))

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
      {jobs === null && !error && <Loading />}
      {jobs && shown.length === 0 && <p className="muted">{jobs.length === 0 ? 'No jobs yet. Add the first one.' : 'No jobs match.'}</p>}
      {shown.length > 0 && (
        <table className="table stack jobs-table">
          <colgroup>
            <col className="jc-job" />
            <col className="jc-name" />
            <col className="jc-client" />
            <col className="jc-pm" />
            <col className="jc-status" />
            <col className="jc-date" />
            <col className="jc-date" />
            <col className="jc-sum" />
            <col className="jc-vo" />
            <col className="jc-link" />
          </colgroup>
          <thead>
            <tr>
              <th>Job</th>
              <th className="col-grow">Name</th>
              <th>Client</th>
              <th>PM</th>
              <th>Status</th>
              <th>Start on site</th>
              <th>PC date</th>
              <th className="num">Contract sum</th>
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
                <td className={j.client_company_id ? '' : 'stack-hide'} data-label="Client">
                  {j.client_company_id ? clients[j.client_company_id] : ''}
                </td>
                <td className={pms[j.id] ? '' : 'stack-hide'} data-label="PM">
                  {pms[j.id] ?? ''}
                </td>
                <td data-label="Status">
                  <span className={`tag ${j.status}`}>{JOB_STATUS_LABELS[j.status]}</span>
                </td>
                <td className="nowrap" data-label="Start on site">
                  {ukDate(j.start_date)}
                </td>
                <td className="nowrap" data-label="PC date">
                  {ukDate(j.pc_date)}
                </td>
                <td className="num" data-label="Contract sum">
                  {money(j.contract_sum)}
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
