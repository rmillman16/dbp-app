import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { money, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { appName, createApplication, loadApplications, loadCurrentSow } from '../lib/applications'
import { APP_STATUS_LABELS, type Application, type SowLine, type SowRevision } from '../lib/types'
import JobSowCard from '../components/JobSow'
import { celebrate } from '../lib/celebrate'
import { useJob } from './JobLayout'

export default function ApplicationsTab() {
  const { job } = useJob()
  const navigate = useNavigate()
  const [sow, setSow] = useState<{ rev: SowRevision | null; lines: SowLine[] } | null>(null)
  const [apps, setApps] = useState<Application[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // the "new application" panel: practical completion (halves retention) and final account
  const [creating, setCreating] = useState(false)
  const [pc, setPc] = useState(false)
  const [finalAcc, setFinalAcc] = useState(false)

  const reload = () => {
    loadCurrentSow(job.id).then(setSow, (e: Error) => setError(e.message))
    loadApplications(job.id).then(setApps, (e: Error) => setError(e.message))
  }
  useEffect(reload, [job]) // eslint-disable-line react-hooks/exhaustive-deps

  const latest = apps && apps.length ? apps[apps.length - 1] : null
  const finalDone = apps?.find((a) => a.final_account) ?? null

  async function newApplication() {
    if (!sow?.rev || !apps) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      navigate(await createApplication(job, sow.rev.id, apps, { practicalCompletion: pc || undefined, finalAccount: finalAcc }))
    } catch (e) {
      setError(saveError(e))
      setBusy(false)
    }
  }

  return (
    <>
      {/* the job's one SoW: applications are priced against it (swapping it updates the CVR and Cashflow too) */}
      <JobSowCard onChanged={reload} />

      <section className="card">
        <div className="pane-head">
          <h2>Applications</h2>
          <button
            className="primary"
            onClick={() => {
              // practical completion already reached on the last application carries on
              setPc(!!latest?.practical_completion)
              setFinalAcc(false)
              setCreating(!creating)
            }}
            disabled={busy || !sow?.rev}
            title={sow?.rev ? '' : 'Import the SoW first'}
          >
            + New application
          </button>
        </div>
        {finalDone && (
          <p className="saved">
            ✓ The final account has been submitted ({appName(finalDone)}): the project is finished off.
          </p>
        )}
        {creating && (
          <div className="app-new">
            <label className="check">
              <span>
                <input
                  type="checkbox"
                  checked={pc}
                  onChange={(e) => {
                    setPc(e.target.checked)
                    if (e.target.checked && !latest?.practical_completion) celebrate('Practical completion achieved!', 'Retention is halved on this application.')
                  }}
                />{' '}
                Practical completion has been achieved (halves the retention on this and later applications)
              </span>
            </label>
            <label className="check">
              <span>
                <input type="checkbox" checked={finalAcc} onChange={(e) => setFinalAcc(e.target.checked)} /> This is the final account (the project is finished off)
              </span>
            </label>
            <p>
              <button className="primary" onClick={newApplication} disabled={busy}>
                {busy ? 'Creating…' : 'Create the application'}
              </button>{' '}
              <button type="button" onClick={() => setCreating(false)} disabled={busy}>
                Cancel
              </button>
            </p>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {apps?.length === 0 && <p className="muted">No applications yet.</p>}
        {apps && apps.length > 0 && (
          <table className="table stack">
            <thead>
              <tr>
                <th>Application</th>
                <th>Valuation date</th>
                <th>Status</th>
                <th className="num">Client certified</th>
                <th className="num">Paid</th>
              </tr>
            </thead>
            <tbody>
              {[...apps].reverse().map((a) => (
                <tr key={a.id} className="clickable" onClick={() => navigate(a.id)}>
                  <td className="stack-title">
                    <strong>{appName(a)}</strong>
                    {a.final_account && <span className="app-status paid"> Final account</span>}
                    {a.practical_completion && <span className="muted small"> · PC reached</span>}
                  </td>
                  <td data-label="Valuation date">{ukDate(a.valuation_date)}</td>
                  <td data-label="Status">
                    <span className={`app-status ${a.status}`}>{APP_STATUS_LABELS[a.status]}</span>
                  </td>
                  <td className={`num ${a.client_certified == null ? 'stack-hide' : ''}`} data-label="Client certified">
                    {money(a.client_certified)}
                  </td>
                  <td className={`num ${a.paid_amount == null ? 'stack-hide' : ''}`} data-label="Paid">
                    {money(a.paid_amount)}
                    {a.paid_date && <span className="muted small"> {ukDate(a.paid_date)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
