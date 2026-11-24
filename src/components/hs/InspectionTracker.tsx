// Inspections (24 Nov, scripts 083 / 084): one simple log of the external H&S inspections on the job. Each line is the date, the name of
// the inspector and the report. Behind it is one schedule for the job (how often, who is reminded): the next one falls due that long after
// the last, and the PM is reminded beforehand and chased weekly while it is overdue (database + send-emails). The report is kept in the app
// and filed into the job's synced SharePoint H&S folder (linked once per computer, Edge or Chrome).
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { saveError } from '../../lib/offline'
import { ukDate } from '../../lib/format'
import { chooseFolder, folderAccess, folderSupported, linkedFolderName, unlinkFolder } from '../../lib/orderFolder'
import { FREQUENCIES, STATE_LABEL, deleteReport, loadTrackers, logReport, nextDue, reportUrl, saveTracker, stateOf, todayIso, type Report, type Tracker } from '../../lib/hsTracker'
import type { Job } from '../../lib/types'

type Person = { id: string; full_name: string | null; email: string | null }
const NAME = 'External H&S inspection'
const NO_REMINDERS = 'none'

export default function InspectionTracker({ job, readOnly }: { job: Job; readOnly: boolean }) {
  const [tracker, setTracker] = useState<Tracker | null | undefined>(undefined) // undefined = loading, null = none yet
  const [reports, setReports] = useState<Report[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [folder, setFolder] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // the log-a-report line
  const [date, setDate] = useState(todayIso())
  const [inspector, setInspector] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const supported = folderSupported()

  const reload = () =>
    loadTrackers(job.id).then(
      (d) => {
        setTracker(d.trackers[0] ?? null)
        setReports(d.reports)
      },
      (e: Error) => (setError(e.message), setTracker(null)),
    )
  useEffect(() => {
    reload()
    linkedFolderName(job.id, 'hs').then(setFolder)
    supabase.from('profiles').select('id, full_name, email').order('full_name').then((r) => setPeople((r.data ?? []) as Person[]))
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true
    Promise.all(reports.filter((r) => r.path && !urls[r.id]).map(async (r) => [r.id, await reportUrl(r.path as string).catch(() => '')] as const)).then((pairs) => {
      if (live && pairs.length) setUrls((u) => ({ ...u, ...Object.fromEntries(pairs) }))
    })
    return () => {
      live = false
    }
  }, [reports]) // eslint-disable-line react-hooks/exhaustive-deps

  const mine = tracker ? reports.filter((r) => r.tracker_id === tracker.id) : []
  const sorted = [...mine].sort((a, b) => b.inspected_on.localeCompare(a.inspected_on))
  const state = tracker ? stateOf(tracker, mine) : null
  const due = tracker ? nextDue(tracker, mine) : null

  // the job's schedule: how often, how early to remind, who (made the first time it is set or a report is logged)
  async function schedule(patch: Partial<Omit<Tracker, 'id' | 'job_id' | 'created_at'>>) {
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    try {
      const saved = await saveTracker(job.id, tracker?.id ?? null, tracker ? patch : { name: NAME, frequency_days: 28, first_due: todayIso(), remind_days: 3, active: true, ...patch })
      setTracker(saved)
    } catch (e) {
      setError(saveError(e))
    }
  }
  const freqValue = !tracker ? '28' : !tracker.active ? NO_REMINDERS : tracker.frequency_days == null ? '' : String(tracker.frequency_days)
  const changeFreq = (v: string) => (v === NO_REMINDERS ? schedule({ active: false }) : schedule({ active: true, frequency_days: v ? Number(v) : null }))

  async function log() {
    // the SharePoint folder first, straight from the click: the browser's permission prompt needs one
    const root = file && folder ? await folderAccess(job.id, 'hs') : null
    setError(null)
    setMsg(null)
    if (!date) return setError('Choose the date of the inspection.')
    if (!inspector.trim()) return setError('Give the inspector’s name.')
    if (!file) return setError('Attach the report.')
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      let t = tracker
      if (!t) {
        t = await saveTracker(job.id, null, { name: NAME, frequency_days: 28, first_due: date, remind_days: 3, active: true })
        setTracker(t)
      }
      const rep = await logReport(job.id, t, { inspected_on: date, inspector }, file, root)
      setInspector('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setMsg(
        rep.filed_to
          ? `Logged, and the report is filed in SharePoint: ${rep.filed_to}`
          : folder
            ? 'Logged and kept in the app, but it could not be filed in SharePoint: check the folder link (allow access when the browser asks).'
            : 'Logged and kept in the app. Link the SharePoint H&S folder to file reports there too.',
      )
      await reload()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  return (
    <div className="card hs-form">
      <div className="pane-head">
        <h2>External H&S inspections</h2>
      </div>
      <p className="muted small intro">
        Log each external H&S inspection report as it comes in: the date, the inspector and the report. The app works out when the next one is due and reminds the PM beforehand, and again every week while it is overdue.
      </p>

      {state && (
        <p className={state === 'overdue' ? 'error' : 'muted'}>
          <span className={`hs-chip trk-${state}`}>{STATE_LABEL[state]}</span> {due ? `Next due ${ukDate(due)}.` : 'No further inspection due.'} {sorted[0] ? `Last done ${ukDate(sorted[0].inspected_on)}${sorted[0].inspector ? ` by ${sorted[0].inspector}` : ''}.` : 'None logged yet.'}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}

      {!readOnly && (
        <section className="hs-log">
          <h3 className="sub-head">Log a report</h3>
          <div className="hs-log-row">
            <label>
              Date of the inspection
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Inspector
              <input value={inspector} placeholder="Name (and company)" onChange={(e) => setInspector(e.target.value)} />
            </label>
            <div className="rfi-field">
              <span className="label">The report</span>
              <label className="file-button">
                <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <span className="button">{file ? `📎 ${file.name}` : '+ Attach the report'}</span>
              </label>
            </div>
            <button className="primary" disabled={busy} onClick={log}>
              {busy ? 'Logging…' : 'Log it'}
            </button>
          </div>
          <p className="muted small">{folder ? `The report is kept in the app and filed in ${folder} / ${NAME}.` : 'The report is kept in the app.'}</p>
        </section>
      )}

      <div className="hs-folder">
        <span>
          <strong>SharePoint folder:</strong>{' '}
          {folder ? (
            <>{folder}</>
          ) : supported ? (
            <span className="muted">not linked on this computer: link the job’s H&S folder to file reports there too</span>
          ) : (
            <span className="muted">filing into SharePoint needs Microsoft Edge or Google Chrome on a PC</span>
          )}
        </span>
        {supported && !readOnly && (
          <span className="hs-folder-btns">
            <button
              type="button"
              className="small-button"
              onClick={async () => {
                try {
                  setFolder(await chooseFolder(job.id, 'hs'))
                } catch {
                  /* cancelled */
                }
              }}
            >
              {folder ? 'Change folder' : 'Link the H&S folder'}
            </button>
            {folder && (
              <button type="button" className="link-button small muted" onClick={async () => (await unlinkFolder(job.id, 'hs'), setFolder(null))}>
                Unlink
              </button>
            )}
          </span>
        )}
      </div>

      <h3 className="sub-head">Reports</h3>
      {tracker === undefined && <p className="muted">Loading…</p>}
      {tracker !== undefined && sorted.length === 0 && <p className="muted small">None logged yet.</p>}
      {sorted.length > 0 && (
        <div className="table-scroll">
          <table className="table hs-list">
            <thead>
              <tr>
                <th>Date</th>
                <th>Inspector</th>
                <th>Report</th>
                <th>Filed in SharePoint</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id}>
                  <td>{ukDate(r.inspected_on)}</td>
                  <td>{r.inspector}</td>
                  <td>{r.path ? urls[r.id] ? <a href={urls[r.id]} target="_blank" rel="noreferrer">📎 {r.file_name ?? 'Open'}</a> : '…' : <span className="muted">none</span>}</td>
                  <td className="muted small">{r.filed_to ?? ''}</td>
                  <td>
                    {!readOnly && (
                      <button
                        type="button"
                        className="link-button small muted"
                        aria-label="Remove"
                        onClick={async () => {
                          if (!confirm(`Remove the ${ukDate(r.inspected_on)} report? (A copy filed in SharePoint stays there.)`)) return
                          try {
                            await deleteReport(r)
                            await reload()
                          } catch (e) {
                            setError(saveError(e))
                          }
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="sub-head">Reminders</h3>
      <div className="form-grid">
        <label>
          How often is one due?
          <select value={freqValue} disabled={readOnly || tracker === undefined} onChange={(e) => changeFreq(e.target.value)}>
            {FREQUENCIES.filter(([k]) => k != null).map(([k, l]) => (
              <option key={String(k)} value={k ?? ''}>
                {l}
              </option>
            ))}
            <option value={NO_REMINDERS}>No reminders: just keep the reports</option>
          </select>
        </label>
        <label>
          Remind this many days before
          <input type="number" min={0} disabled={readOnly || tracker === undefined} defaultValue={tracker?.remind_days ?? 3} key={tracker?.id ?? 'new'} onBlur={(e) => Number(e.target.value) !== (tracker?.remind_days ?? 3) && schedule({ remind_days: Number(e.target.value) || 0 })} />
        </label>
        <label>
          Remind
          <select value={tracker?.owner_id ?? ''} disabled={readOnly || tracker === undefined} onChange={(e) => schedule({ owner_id: e.target.value || null })}>
            <option value="">The job’s PMs</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        </label>
        {sorted.length === 0 && (
          <label>
            First one is due
            <input type="date" disabled={readOnly || tracker === undefined} value={tracker?.first_due ?? todayIso()} onChange={(e) => e.target.value && schedule({ first_due: e.target.value })} />
          </label>
        )}
      </div>
    </div>
  )
}
