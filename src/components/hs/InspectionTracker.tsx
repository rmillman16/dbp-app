// Inspection tracker (24 Nov, script 083): the inspections other parties do on the job. Log each report as it comes in (date, outcome, the
// report itself); the next falls due the frequency after the last and the PM is reminded, then chased weekly while it is overdue.
// The report is kept in the app and filed into the job's synced SharePoint H&S folder (linked once per computer, Edge or Chrome).
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { saveError } from '../../lib/offline'
import { ukDate } from '../../lib/format'
import { chooseFolder, folderAccess, folderSupported, linkedFolderName, unlinkFolder } from '../../lib/orderFolder'
import {
  FREQUENCIES, OUTCOMES, STATE_LABEL, SUGGESTIONS, deleteReport, deleteTracker, freqLabel, loadTrackers, logReport, nextDue, reportUrl, saveTracker, stateOf, todayIso,
  type Outcome, type Report, type Tracker,
} from '../../lib/hsTracker'
import type { Job } from '../../lib/types'

type Person = { id: string; full_name: string | null; email: string | null }
type Form = { name: string; by_party: string; frequency_days: string; first_due: string; remind_days: string; owner_id: string; active: boolean; notes: string }
const blank = (): Form => ({ name: '', by_party: '', frequency_days: '7', first_due: todayIso(), remind_days: '3', owner_id: '', active: true, notes: '' })
const fromRow = (t: Tracker): Form => ({ name: t.name, by_party: t.by_party ?? '', frequency_days: t.frequency_days == null ? '' : String(t.frequency_days), first_due: t.first_due, remind_days: String(t.remind_days), owner_id: t.owner_id ?? '', active: t.active, notes: t.notes ?? '' })

export default function InspectionTracker({ job, readOnly }: { job: Job; readOnly: boolean }) {
  const [data, setData] = useState<{ trackers: Tracker[]; reports: Report[] } | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<{ id: string | null; form: Form } | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const supported = folderSupported()

  const reload = () => loadTrackers(job.id).then(setData, (e: Error) => (setError(e.message), setData({ trackers: [], reports: [] })))
  useEffect(() => {
    reload()
    linkedFolderName(job.id, 'hs').then(setFolder)
    supabase.from('profiles').select('id, full_name, email').order('full_name').then((r) => setPeople((r.data ?? []) as Person[]))
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayIso()
  const trackers = data?.trackers ?? []
  const reports = data?.reports ?? []
  const of = (t: Tracker) => reports.filter((r) => r.tracker_id === t.id)
  const counts = { overdue: 0, soon: 0 }
  for (const t of trackers) {
    const s = stateOf(t, of(t), today)
    if (s === 'overdue') counts.overdue++
    else if (s === 'soon') counts.soon++
  }

  const folderBar = (
    <div className="hs-folder">
      <span>
        <strong>SharePoint folder:</strong>{' '}
        {folder ? (
          <>
            {folder} <span className="muted small">(reports are filed here, in a folder for each inspection)</span>
          </>
        ) : supported ? (
          <span className="muted">not linked on this computer: reports are kept in the app only</span>
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
  )

  if (open) {
    const t = open.id ? trackers.find((x) => x.id === open.id) : undefined
    return (
      <TrackerPage
        job={job}
        tracker={t ?? null}
        form={open.form}
        setForm={(f) => setOpen({ id: open.id, form: f })}
        reports={t ? of(t) : []}
        people={people}
        readOnly={readOnly}
        folder={folder}
        folderBar={folderBar}
        onBack={() => setOpen(null)}
        onSaved={async (saved) => {
          await reload()
          setOpen({ id: saved.id, form: fromRow(saved) })
        }}
        onChanged={reload}
        onDeleted={async () => {
          setOpen(null)
          await reload()
        }}
      />
    )
  }

  return (
    <div className="card">
      <div className="pane-head">
        <h2>Inspection tracker</h2>
        {!readOnly && (
          <button type="button" className="primary" onClick={() => setOpen({ id: null, form: blank() })}>
            + Add an inspection
          </button>
        )}
      </div>
      <p className="muted small intro">
        The inspections other people do on this job: the scaffolder, the lifting-equipment examiner, the fire alarm engineer, the H&S consultant. Log each report when it comes in. The next one falls due the frequency after the last, and the PM is reminded beforehand and chased every week while it is overdue.
      </p>
      {folderBar}
      {error && <p className="error">{error}</p>}
      {(counts.overdue > 0 || counts.soon > 0) && (
        <p className={counts.overdue ? 'error' : 'muted'}>
          {counts.overdue ? `${counts.overdue} overdue` : ''}
          {counts.overdue && counts.soon ? ', ' : ''}
          {counts.soon ? `${counts.soon} due soon` : ''}.
        </p>
      )}
      {data === null && <p className="muted">Loading…</p>}
      {data && trackers.length === 0 && !error && <p className="muted">Nothing tracked yet. Add the inspections that other parties have to do on this job.</p>}
      {trackers.length > 0 && (
        <div className="table-scroll">
          <table className="table hs-list">
            <thead>
              <tr>
                <th>Inspection</th>
                <th>Done by</th>
                <th>How often</th>
                <th>Last done</th>
                <th>Next due</th>
                <th>Status</th>
                <th>Latest report</th>
              </tr>
            </thead>
            <tbody>
              {trackers.map((t) => {
                const rs = of(t)
                const latest = rs[0]
                const s = stateOf(t, rs, today)
                const due = nextDue(t, rs)
                return (
                  <tr key={t.id} className="clickable" onClick={() => setOpen({ id: t.id, form: fromRow(t) })}>
                    <td>{t.name}</td>
                    <td>{t.by_party}</td>
                    <td>{freqLabel(t.frequency_days)}</td>
                    <td>{latest ? ukDate(latest.inspected_on) : <span className="muted">never</span>}</td>
                    <td className={s === 'overdue' ? 'hs-late' : ''}>{due ? ukDate(due) : '–'}</td>
                    <td>
                      <span className={`hs-chip trk-${s}`}>{STATE_LABEL[s]}</span>
                    </td>
                    <td>{latest ? (latest.file_name ? <span title={latest.file_name}>📎 {OUTCOMES.find(([k]) => k === latest.outcome)?.[1]}</span> : OUTCOMES.find(([k]) => k === latest.outcome)?.[1]) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TrackerPage({
  job, tracker, form, setForm, reports, people, readOnly, folder, folderBar, onBack, onSaved, onChanged, onDeleted,
}: {
  job: Job
  tracker: Tracker | null
  form: Form
  setForm: (f: Form) => void
  reports: Report[]
  people: Person[]
  readOnly: boolean
  folder: string | null
  folderBar: React.ReactNode
  onBack: () => void
  onSaved: (t: Tracker) => Promise<void>
  onChanged: () => Promise<unknown>
  onDeleted: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch })
  // the log-a-report form
  const [date, setDate] = useState(todayIso())
  const [outcome, setOutcome] = useState<Outcome>('satisfactory')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    let live = true
    Promise.all(reports.filter((r) => r.path && !urls[r.id]).map(async (r) => [r.id, await reportUrl(r.path as string).catch(() => '')] as const)).then((pairs) => {
      if (live && pairs.length) setUrls((u) => ({ ...u, ...Object.fromEntries(pairs) }))
    })
    return () => {
      live = false
    }
  }, [reports]) // eslint-disable-line react-hooks/exhaustive-deps

  const suggestion = (name: string) => SUGGESTIONS.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())
  const changeName = (name: string) => {
    const s = !tracker ? suggestion(name) : undefined
    set({ name, ...(s ? { frequency_days: s.days == null ? '' : String(s.days), by_party: form.by_party || s.by } : {}) })
  }

  async function save() {
    setError(null)
    setMsg(null)
    if (!form.name.trim()) return setError('Name the inspection.')
    if (!form.first_due) return setError('When is the first one due?')
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      const saved = await saveTracker(job.id, tracker?.id ?? null, {
        name: form.name.trim(),
        by_party: form.by_party.trim() || null,
        frequency_days: form.frequency_days ? Number(form.frequency_days) : null,
        first_due: form.first_due,
        remind_days: Number(form.remind_days) || 0,
        owner_id: form.owner_id || null,
        active: form.active,
        notes: form.notes.trim() || null,
      })
      setMsg('Saved.')
      await onSaved(saved)
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }
  async function log() {
    if (!tracker) return
    // the SharePoint folder first, straight from the click: the browser's permission prompt needs one
    const root = file && folder ? await folderAccess(job.id, 'hs') : null
    setError(null)
    setMsg(null)
    if (!date) return setError('Choose the date of the inspection.')
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      const rep = await logReport(job.id, tracker, { inspected_on: date, outcome, note }, file, root)
      setNote('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setMsg(file ? (rep.filed_to ? `Logged, and the report is filed in SharePoint: ${rep.filed_to}` : folder ? 'Logged and kept in the app, but it could not be filed in SharePoint: check the folder link (allow access when the browser asks).' : 'Logged and kept in the app. Link the SharePoint H&S folder to file reports there too.') : 'Logged.')
      await onChanged()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  const sorted = [...reports].sort((a, b) => b.inspected_on.localeCompare(a.inspected_on))
  const due = tracker ? nextDue(tracker, reports) : null
  const state = tracker ? stateOf(tracker, reports) : null
  return (
    <div className="card hs-form">
      <div className="pane-head">
        <h2>{tracker ? tracker.name : 'Add an inspection'}</h2>
        <button type="button" className="small-button" onClick={onBack}>
          ← All inspections
        </button>
      </div>
      {msg && <p className="saved">{msg}</p>}
      {error && <p className="error">{error}</p>}
      {tracker && state && (
        <p className={state === 'overdue' ? 'error' : 'muted'}>
          <span className={`hs-chip trk-${state}`}>{STATE_LABEL[state]}</span> {due ? `Next due ${ukDate(due)}.` : 'Nothing further due.'} {sorted[0] ? `Last done ${ukDate(sorted[0].inspected_on)}.` : 'Not done yet.'}
        </p>
      )}

      {tracker && !readOnly && (
        <section className="hs-log">
          <h3 className="sub-head">Log a report that has come in</h3>
          {folderBar}
          <div className="form-grid">
            <label>
              Date of the inspection *
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Outcome
              <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
                {OUTCOMES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              Note (anything that needs doing)
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="span-2 rfi-field">
              <span className="label">The report</span>
              <label className="file-button">
                <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <span className="button">{file ? `📎 ${file.name}` : '+ Choose the report (PDF, Word, photo…)'}</span>
              </label>
              <span className="hint">
                {folder ? `It is kept in the app and filed in ${folder} / ${tracker.name}.` : 'It is kept in the app. Link the SharePoint H&S folder (above) to file it there too.'}
              </span>
            </div>
          </div>
          <div className="form-actions">
            <button className="primary" disabled={busy} onClick={log}>
              {busy ? 'Logging…' : 'Log this report'}
            </button>
          </div>
        </section>
      )}

      {tracker && (
        <>
          <h3 className="sub-head">Reports</h3>
          {sorted.length === 0 ? (
            <p className="muted small">No reports logged yet.</p>
          ) : (
            <table className="table hs-list">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Outcome</th>
                  <th>Note</th>
                  <th>Report</th>
                  <th>Filed in SharePoint</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <td>{ukDate(r.inspected_on)}</td>
                    <td>
                      <span className={`hs-chip ${r.outcome === 'satisfactory' ? 'ok' : r.outcome === 'actions' ? 'damaged' : 'rejected'}`}>{OUTCOMES.find(([k]) => k === r.outcome)?.[1]}</span>
                    </td>
                    <td>{r.note}</td>
                    <td>{r.path ? urls[r.id] ? <a href={urls[r.id]} target="_blank" rel="noreferrer">{r.file_name ?? 'Open'}</a> : '…' : <span className="muted">none</span>}</td>
                    <td className="muted small">{r.filed_to ?? ''}</td>
                    <td>
                      {!readOnly && (
                        <button
                          type="button"
                          className="link-button small muted"
                          onClick={async () => {
                            if (!confirm(`Remove the ${ukDate(r.inspected_on)} report? (A copy filed in SharePoint stays there.)`)) return
                            try {
                              await deleteReport(r)
                              await onChanged()
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
          )}
        </>
      )}

      <h3 className="sub-head">{tracker ? 'Settings' : 'About the inspection'}</h3>
      <div className="form-grid">
        <label className="span-2">
          Inspection *
          <input list="hs-trk-names" value={form.name} disabled={readOnly} placeholder="e.g. Scaffold inspection" onChange={(e) => changeName(e.target.value)} />
          <datalist id="hs-trk-names">
            {SUGGESTIONS.map((s) => (
              <option key={s.name} value={s.name} />
            ))}
          </datalist>
        </label>
        <label>
          Done by (company or person)
          <input value={form.by_party} disabled={readOnly} onChange={(e) => set({ by_party: e.target.value })} />
        </label>
        <label>
          How often
          <select value={form.frequency_days} disabled={readOnly} onChange={(e) => set({ frequency_days: e.target.value })}>
            {FREQUENCIES.map(([k, l]) => (
              <option key={String(k)} value={k ?? ''}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          {tracker ? 'First one was due' : 'First one is due'}
          <input type="date" value={form.first_due} disabled={readOnly} onChange={(e) => set({ first_due: e.target.value })} />
        </label>
        <label>
          Remind this many days before
          <input type="number" min={0} value={form.remind_days} disabled={readOnly} onChange={(e) => set({ remind_days: e.target.value })} />
        </label>
        <label>
          Remind
          <select value={form.owner_id} disabled={readOnly} onChange={(e) => set({ owner_id: e.target.value })}>
            <option value="">The job’s PMs</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.active} disabled={readOnly} onChange={(e) => set({ active: e.target.checked })} /> Active (untick to pause the reminders)
        </label>
        <label className="span-2">
          Notes
          <textarea rows={2} value={form.notes} disabled={readOnly} onChange={(e) => set({ notes: e.target.value })} />
        </label>
      </div>
      {!readOnly && (
        <div className="form-actions">
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : tracker ? 'Save settings' : 'Add this inspection'}
          </button>
          {tracker && (
            <button
              type="button"
              className="link-button danger"
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Delete "${tracker.name}" and its ${reports.length} logged report${reports.length === 1 ? '' : 's'}? Copies filed in SharePoint stay there.`)) return
                setBusy(true)
                try {
                  await deleteTracker(tracker, reports)
                  await onDeleted()
                } catch (e) {
                  setError(saveError(e))
                  setBusy(false)
                }
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  )
}
