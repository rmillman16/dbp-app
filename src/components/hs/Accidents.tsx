// Accident and incident reports (24 Nov, script 082): the standard report for an accident, near miss, dangerous occurrence, ill health or
// damage on the job. Numbered A001, A002... on each job. Personal details: only people with Job › H&S access can see these.
import { useEffect, useState } from 'react'
import { ACCIDENT_KINDS, PERSON_TYPES, RIDDOR, SEVERITIES, accidentRef, deleteRow, loadRows, saveRow, type AccidentKind, type AccidentReport, type Riddor, type Severity } from '../../lib/hs'
import { exportAccidents } from '../../lib/exportHs'
import { saveError } from '../../lib/offline'
import { useAccess } from '../../lib/access'
import { todayIso, ukDate } from '../../lib/format'
import type { Job } from '../../lib/types'
import HsFiles from './HsFiles'

type Form = {
  incident_on: string; incident_time: string; location: string; kind: AccidentKind
  person_name: string; person_type: string; person_company: string; person_role: string; person_phone: string
  severity: Severity; injury: string; treatment: string; hospital: boolean; days_lost: string
  description: string; witnesses: string; immediate_cause: string; root_cause: string; immediate_action: string
  riddor: Riddor; riddor_ref: string; riddor_on: string
  corrective: string; corrective_owner: string; corrective_due: string; corrective_closed_on: string
  reported_by: string; investigated_by: string; status: 'open' | 'closed'
}
const blank = (by: string): Form => ({
  incident_on: todayIso(), incident_time: '', location: '', kind: 'accident',
  person_name: '', person_type: '', person_company: '', person_role: '', person_phone: '',
  severity: 'none', injury: '', treatment: '', hospital: false, days_lost: '',
  description: '', witnesses: '', immediate_cause: '', root_cause: '', immediate_action: '',
  riddor: 'no', riddor_ref: '', riddor_on: '',
  corrective: '', corrective_owner: '', corrective_due: '', corrective_closed_on: '',
  reported_by: by, investigated_by: '', status: 'open',
})
const s = (v: string | null) => v ?? ''
const fromRow = (r: AccidentReport): Form => ({
  incident_on: r.incident_on, incident_time: s(r.incident_time), location: s(r.location), kind: r.kind,
  person_name: s(r.person_name), person_type: s(r.person_type), person_company: s(r.person_company), person_role: s(r.person_role), person_phone: s(r.person_phone),
  severity: r.severity, injury: s(r.injury), treatment: s(r.treatment), hospital: r.hospital, days_lost: r.days_lost == null ? '' : String(r.days_lost),
  description: s(r.description), witnesses: s(r.witnesses), immediate_cause: s(r.immediate_cause), root_cause: s(r.root_cause), immediate_action: s(r.immediate_action),
  riddor: r.riddor, riddor_ref: s(r.riddor_ref), riddor_on: s(r.riddor_on),
  corrective: s(r.corrective), corrective_owner: s(r.corrective_owner), corrective_due: s(r.corrective_due), corrective_closed_on: s(r.corrective_closed_on),
  reported_by: s(r.reported_by), investigated_by: s(r.investigated_by), status: r.status,
})
const nul = (v: string) => v.trim() || null
const kindLabel = (k: AccidentKind) => ACCIDENT_KINDS.find(([x]) => x === k)?.[1].replace(/ \(.*\)/, '') ?? k
const sevLabel = (k: Severity) => SEVERITIES.find(([x]) => x === k)?.[1] ?? k
const sevClass = (k: Severity) => (k === 'none' || k === 'first_aid' ? 'ok' : k === 'medical' ? 'damaged' : 'rejected')

export default function Accidents({ job, readOnly }: { job: Job; readOnly: boolean }) {
  const { me, isAdmin } = useAccess()
  const [rows, setRows] = useState<AccidentReport[] | null>(null)
  const [open, setOpen] = useState<{ id: string | null; number: number | null; form: Form } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = () => loadRows<AccidentReport>('accident_reports', job.id).then(setRows, (e: Error) => (setError(e.message), setRows([])))
  useEffect(() => {
    reload()
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Form>) => setOpen((o) => o && { ...o, form: { ...o.form, ...patch } })
  const injured = (f: Form) => f.kind === 'accident' || f.kind === 'ill_health'

  async function save() {
    if (!open) return
    const f = open.form
    setError(null)
    setMsg(null)
    if (!f.incident_on) return setError('Choose the date it happened.')
    if (!f.description.trim()) return setError('Say what happened.')
    if (injured(f) && !f.person_name.trim()) return setError('Who was hurt or affected? Give their name.')
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      const saved = await saveRow<AccidentReport>('accident_reports', job.id, open.id, {
        incident_on: f.incident_on, incident_time: nul(f.incident_time), location: nul(f.location), kind: f.kind,
        person_name: nul(f.person_name), person_type: f.person_type || null, person_company: nul(f.person_company), person_role: nul(f.person_role), person_phone: nul(f.person_phone),
        severity: f.severity, injury: nul(f.injury), treatment: nul(f.treatment), hospital: f.hospital, days_lost: f.days_lost.trim() ? Number(f.days_lost) : null,
        description: nul(f.description), witnesses: nul(f.witnesses), immediate_cause: nul(f.immediate_cause), root_cause: nul(f.root_cause), immediate_action: nul(f.immediate_action),
        riddor: f.riddor, riddor_ref: nul(f.riddor_ref), riddor_on: f.riddor_on || null,
        corrective: nul(f.corrective), corrective_owner: nul(f.corrective_owner), corrective_due: f.corrective_due || null, corrective_closed_on: f.corrective_closed_on || null,
        reported_by: nul(f.reported_by), investigated_by: nul(f.investigated_by), status: f.status,
      })
      setOpen({ id: saved.id, number: saved.number, form: fromRow(saved) })
      setMsg(`Saved as ${accidentRef(saved.number)}. You can add photos below.`)
      await reload()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }
  async function remove() {
    if (!open?.id || !confirm('Delete this accident report? It is a legal record: only do this if it was raised by mistake. This can’t be undone.')) return
    setBusy(true)
    try {
      await deleteRow('accident_reports', open.id, 'accident')
      setOpen(null)
      await reload()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  if (open) {
    const f = open.form
    const ro = readOnly
    return (
      <div className="card hs-form">
        <div className="pane-head">
          <h2>{open.number ? `${accidentRef(open.number)}: ${kindLabel(f.kind)}, ${ukDate(f.incident_on)}` : 'New accident / incident report'}</h2>
          <button type="button" className="small-button" onClick={() => (setOpen(null), setError(null), setMsg(null))}>
            ← All reports
          </button>
        </div>
        {msg && <p className="saved">{msg}</p>}
        {error && <p className="error">{error}</p>}
        {(f.riddor !== 'no' || f.severity === 'major' || f.severity === 'fatal' || f.severity === 'lost_time') && (
          <p className="hs-riddor">
            <strong>RIDDOR:</strong> deaths, specified (major) injuries and dangerous occurrences must be reported to the HSE without delay, and injuries keeping someone off work for over 7 days within 15 days. Record the HSE reference below once reported.
          </p>
        )}

        <h3 className="sub-head">What and where</h3>
        <div className="form-grid">
          <label>
            Type *
            <select value={f.kind} disabled={ro} onChange={(e) => set({ kind: e.target.value as AccidentKind })}>
              {ACCIDENT_KINDS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date *
            <input type="date" value={f.incident_on} disabled={ro} onChange={(e) => set({ incident_on: e.target.value })} />
          </label>
          <label>
            Time
            <input value={f.incident_time} disabled={ro} placeholder="e.g. 14:30" onChange={(e) => set({ incident_time: e.target.value })} />
          </label>
          <label>
            Where on site
            <input value={f.location} disabled={ro} onChange={(e) => set({ location: e.target.value })} />
          </label>
          <label className="span-2">
            What happened *
            <textarea rows={4} value={f.description} disabled={ro} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <label className="span-2">
            Witnesses (names and companies)
            <textarea rows={2} value={f.witnesses} disabled={ro} onChange={(e) => set({ witnesses: e.target.value })} />
          </label>
        </div>

        <h3 className="sub-head">The person {injured(f) ? '' : <span className="muted small">(if anyone was involved)</span>}</h3>
        <div className="form-grid">
          <label>
            Name {injured(f) ? '*' : ''}
            <input value={f.person_name} disabled={ro} onChange={(e) => set({ person_name: e.target.value })} />
          </label>
          <label>
            Who they are
            <select value={f.person_type} disabled={ro} onChange={(e) => set({ person_type: e.target.value })}>
              <option value="">Choose…</option>
              {PERSON_TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Employer / company
            <input value={f.person_company} disabled={ro} onChange={(e) => set({ person_company: e.target.value })} />
          </label>
          <label>
            Trade / occupation
            <input value={f.person_role} disabled={ro} onChange={(e) => set({ person_role: e.target.value })} />
          </label>
          <label>
            Phone
            <input type="tel" value={f.person_phone} disabled={ro} onChange={(e) => set({ person_phone: e.target.value })} />
          </label>
        </div>

        <h3 className="sub-head">Injury and treatment</h3>
        <div className="form-grid">
          <label>
            How serious
            <select value={f.severity} disabled={ro} onChange={(e) => set({ severity: e.target.value as Severity })}>
              {SEVERITIES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Days off work (if known)
            <input type="number" min={0} value={f.days_lost} disabled={ro} onChange={(e) => set({ days_lost: e.target.value })} />
          </label>
          <label className="span-2">
            Injury: what and which part of the body
            <textarea rows={2} value={f.injury} disabled={ro} onChange={(e) => set({ injury: e.target.value })} />
          </label>
          <label className="span-2">
            Treatment given, and by whom (first aider)
            <textarea rows={2} value={f.treatment} disabled={ro} onChange={(e) => set({ treatment: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={f.hospital} disabled={ro} onChange={(e) => set({ hospital: e.target.checked })} /> Taken to hospital
          </label>
        </div>

        <h3 className="sub-head">Causes and what was done</h3>
        <div className="form-grid">
          <label className="span-2">
            Immediate action taken (made safe, area closed, work stopped…)
            <textarea rows={2} value={f.immediate_action} disabled={ro} onChange={(e) => set({ immediate_action: e.target.value })} />
          </label>
          <label>
            Immediate cause
            <textarea rows={2} value={f.immediate_cause} disabled={ro} onChange={(e) => set({ immediate_cause: e.target.value })} />
          </label>
          <label>
            Root cause (why it could happen)
            <textarea rows={2} value={f.root_cause} disabled={ro} onChange={(e) => set({ root_cause: e.target.value })} />
          </label>
        </div>

        <h3 className="sub-head">RIDDOR</h3>
        <div className="form-grid">
          <label>
            Reportable to the HSE?
            <select value={f.riddor} disabled={ro} onChange={(e) => set({ riddor: e.target.value as Riddor })}>
              {RIDDOR.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date reported
            <input type="date" value={f.riddor_on} disabled={ro} onChange={(e) => set({ riddor_on: e.target.value })} />
          </label>
          <label>
            HSE reference
            <input value={f.riddor_ref} disabled={ro} onChange={(e) => set({ riddor_ref: e.target.value })} />
          </label>
        </div>

        <h3 className="sub-head">Stopping it happening again</h3>
        <div className="form-grid">
          <label className="span-2">
            Corrective actions
            <textarea rows={3} value={f.corrective} disabled={ro} onChange={(e) => set({ corrective: e.target.value })} />
          </label>
          <label>
            Who is doing it
            <input value={f.corrective_owner} disabled={ro} onChange={(e) => set({ corrective_owner: e.target.value })} />
          </label>
          <label>
            Do by
            <input type="date" value={f.corrective_due} disabled={ro} onChange={(e) => set({ corrective_due: e.target.value })} />
          </label>
          <label>
            Done on
            <input type="date" value={f.corrective_closed_on} disabled={ro} onChange={(e) => set({ corrective_closed_on: e.target.value })} />
          </label>
          <span />
          <label>
            Reported by
            <input value={f.reported_by} disabled={ro} onChange={(e) => set({ reported_by: e.target.value })} />
          </label>
          <label>
            Investigated by
            <input value={f.investigated_by} disabled={ro} onChange={(e) => set({ investigated_by: e.target.value })} />
          </label>
          <label>
            Report status
            <select value={f.status} disabled={ro} onChange={(e) => set({ status: e.target.value as 'open' | 'closed' })}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        </div>

        {open.id ? <HsFiles jobId={job.id} kind="accident" recordId={open.id} readOnly={ro} /> : <p className="muted small">Save the report first, then you can add photos (the scene, the injury, the equipment).</p>}
        {!ro && (
          <div className="form-actions">
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save report'}
            </button>
            {open.id && isAdmin && (
              <button type="button" className="link-button danger" disabled={busy} onClick={remove}>
                Delete (admin)
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  const today = todayIso()
  const openReports = (rows ?? []).filter((r) => r.status === 'open').length
  const riddorOpen = (rows ?? []).filter((r) => r.riddor === 'check').length
  return (
    <div className="card">
      <div className="pane-head">
        <h2>Accidents and incidents</h2>
        <div className="head-actions">
          {rows && rows.length > 0 && (
            <button type="button" className="small-button" onClick={() => exportAccidents(job, rows)}>
              Export Excel
            </button>
          )}
          {!readOnly && (
            <button type="button" className="primary" onClick={() => (setMsg(null), setError(null), setOpen({ id: null, number: null, form: blank(me?.full_name ?? '') }))}>
              + Report an accident / incident
            </button>
          )}
        </div>
      </div>
      {rows && rows.length > 0 && (
        <p className="muted">
          {rows.length} on this job, {openReports} open{riddorOpen ? `, ${riddorOpen} RIDDOR to check` : ''}.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {rows === null && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && !error && <p className="muted">No reports. Good. If something happens, report it here the same day.</p>}
      {rows && rows.length > 0 && (
        <div className="table-scroll">
          <table className="table hs-list">
            <thead>
              <tr>
                <th>No.</th>
                <th>Date</th>
                <th>Type</th>
                <th>Person</th>
                <th>Seriousness</th>
                <th>RIDDOR</th>
                <th>Actions</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const late = !!r.corrective?.trim() && !r.corrective_closed_on && !!r.corrective_due && r.corrective_due < today
                return (
                  <tr key={r.id} className="clickable" onClick={() => (setMsg(null), setError(null), setOpen({ id: r.id, number: r.number, form: fromRow(r) }))}>
                    <td>{accidentRef(r.number)}</td>
                    <td>{ukDate(r.incident_on)}</td>
                    <td>{kindLabel(r.kind)}</td>
                    <td>{[r.person_name, r.person_company].filter(Boolean).join(', ')}</td>
                    <td>
                      <span className={`hs-chip ${sevClass(r.severity)}`}>{sevLabel(r.severity)}</span>
                    </td>
                    <td>{r.riddor === 'yes' ? (r.riddor_on ? `Reported ${ukDate(r.riddor_on)}` : 'Reportable') : r.riddor === 'check' ? 'To check' : ''}</td>
                    <td className={late ? 'hs-late' : ''}>{!r.corrective?.trim() ? '' : r.corrective_closed_on ? 'Done' : r.corrective_due ? `Due ${ukDate(r.corrective_due)}${late ? ' (past)' : ''}` : 'Open'}</td>
                    <td>{r.status === 'open' ? 'Open' : 'Closed'}</td>
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
