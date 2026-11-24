import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { addDaysIso, todayIso, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { REPORT_STATUS, createReport, loadReports, type ProgressReport } from '../lib/progressReports'
import { useJob } from './JobLayout'
import Loading from '../components/Loading'

// Job › Progress reports (23 Nov, script 064): the job's reports, newest first, and the next one due.
export default function ProgressReportsTab() {
  const { job } = useJob()
  const navigate = useNavigate()
  const [reports, setReports] = useState<ProgressReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    loadReports(job.id).then(setReports, (e: Error) => (setError(e.message), setReports([])))
  }, [job.id])

  const days = job.report_frequency_days
  const last = reports?.[0]
  const nextDue = days && days > 0 ? addDaysIso(last?.period_end ?? job.start_date ?? todayIso(), days) : null

  async function make() {
    setError(null)
    setBusy(true)
    try {
      const r = await createReport(job)
      navigate(r.id)
    } catch (e) {
      setError(saveError(e))
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="pane-head">
        <h2>Progress reports</h2>
        <button className="primary" onClick={make} disabled={busy}>
          {busy ? 'Starting…' : `+ New report${last ? ` (${last.report_no + 1})` : ''}`}
        </button>
      </div>
      <p className="muted small">
        Each report starts with what the app already knows (programme, RFIs, submittals, sampling, procurement, variation and EOT status, insurances); you write the narrative, add photos and
        appendices, and it comes out as one combined PDF and an editable Word file.{' '}
        {days && days > 0 ? (
          <>
            Reports are every <strong>{days} days</strong> on this job{nextDue ? <>: the next is due <strong>{ukDate(nextDue)}</strong></> : ''}; the team is reminded on the bell.
          </>
        ) : (
          <>
            No report frequency is set: add one on the job's details (<Link to={`/jobs/${job.id}/edit`}>edit job</Link>) to be reminded when one is due.
          </>
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {reports === null && <Loading />}
      {reports?.length === 0 && !error && <p className="muted">No reports yet. Start the first with “+ New report”.</p>}
      {reports && reports.length > 0 && (
        <table className="table stack">
          <thead>
            <tr>
              <th>Report</th>
              <th>Period</th>
              <th>Status</th>
              <th>Last changed</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => navigate(r.id)}>
                <td className="stack-title">
                  <strong>Report {r.report_no}</strong>
                </td>
                <td data-label="Period">
                  {ukDate(r.period_start)} to {ukDate(r.period_end)}
                </td>
                <td data-label="Status">
                  <span className={`q-status rpt-${r.status}`}>{REPORT_STATUS[r.status]}</span>
                  {r.issued_on ? ` ${ukDate(r.issued_on)}` : ''}
                </td>
                <td data-label="Last changed">{ukDate(r.updated_at.slice(0, 10))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
