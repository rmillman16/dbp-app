// H&S inspections (24 Nov, script 081): a checklist (weekly site inspection, scaffold, fire safety walk, or your own) marked pass / fail /
// not applicable, an overall result, and the actions that come out of it with a date to do them by and a date they were closed.
import { useEffect, useState } from 'react'
import { INSPECTION_RESULTS, INSPECTION_TYPES, actionsOpen, deleteRow, failCount, loadRows, newItems, saveRow, type Inspection, type InspectionItem, type InspectionResult, type Result } from '../../lib/hs'
import { exportInspections } from '../../lib/exportHs'
import { saveError } from '../../lib/offline'
import { useAccess } from '../../lib/access'
import { todayIso, ukDate } from '../../lib/format'
import type { Job } from '../../lib/types'
import HsFiles from './HsFiles'

type Form = { inspected_on: string; kind: string; area: string; inspector: string; items: InspectionItem[]; result: InspectionResult; actions: string; actions_due: string; actions_closed_on: string; notes: string }
const blank = (by: string): Form => ({ inspected_on: todayIso(), kind: 'Weekly site inspection', area: '', inspector: by, items: newItems('Weekly site inspection'), result: 'satisfactory', actions: '', actions_due: '', actions_closed_on: '', notes: '' })
const fromRow = (r: Inspection): Form => ({ inspected_on: r.inspected_on, kind: r.kind, area: r.area ?? '', inspector: r.inspector ?? '', items: r.items, result: r.result, actions: r.actions ?? '', actions_due: r.actions_due ?? '', actions_closed_on: r.actions_closed_on ?? '', notes: r.notes ?? '' })
const nul = (s: string) => s.trim() || null
const resultLabel = (r: InspectionResult) => INSPECTION_RESULTS.find(([k]) => k === r)?.[1] ?? r
const RESULTS: [Result, string][] = [['pass', 'Pass'], ['fail', 'Fail'], ['na', 'N/A']]

export default function Inspections({ job, readOnly }: { job: Job; readOnly: boolean }) {
  const { me } = useAccess()
  const [rows, setRows] = useState<Inspection[] | null>(null)
  const [open, setOpen] = useState<{ id: string | null; form: Form } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [onlyOpen, setOnlyOpen] = useState(false)

  const reload = () => loadRows<Inspection>('hs_inspections', job.id).then(setRows, (e: Error) => (setError(e.message), setRows([])))
  useEffect(() => {
    reload()
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Form>) => setOpen((o) => o && { ...o, form: { ...o.form, ...patch } })
  const setItem = (i: number, patch: Partial<InspectionItem>) => set({ items: open!.form.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  // changing the type of a new inspection loads that type's checklist
  const changeKind = (kind: string) => set({ kind, ...(open && !open.id ? { items: newItems(kind) } : {}) })
  // marking something as failed suggests the overall result
  const mark = (i: number, result: Result) => {
    const items = open!.form.items.map((x, j) => (j === i ? { ...x, result: x.result === result ? null : result } : x))
    const fails = items.filter((x) => x.result === 'fail').length
    set({ items, result: fails && open!.form.result === 'satisfactory' ? 'actions' : !fails && open!.form.result === 'actions' && !open!.form.actions.trim() ? 'satisfactory' : open!.form.result })
  }

  async function save() {
    if (!open) return
    const f = open.form
    setError(null)
    setMsg(null)
    if (!f.inspected_on) return setError('Choose the date.')
    if (!f.kind.trim()) return setError('Choose the type of inspection.')
    if (f.items.some((x) => x.result === 'fail' && !x.note.trim() && !f.actions.trim())) return setError('Something failed: say what is wrong in its note, or what has to be done under Actions.')
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      const saved = await saveRow<Inspection>('hs_inspections', job.id, open.id, {
        inspected_on: f.inspected_on,
        kind: f.kind.trim(),
        area: nul(f.area),
        inspector: nul(f.inspector),
        items: f.items.filter((x) => x.q.trim()),
        result: f.result,
        actions: nul(f.actions),
        actions_due: f.actions_due || null,
        actions_closed_on: f.actions_closed_on || null,
        notes: nul(f.notes),
      })
      setOpen({ id: saved.id, form: fromRow(saved) })
      setMsg('Saved. You can add photos below.')
      await reload()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }
  async function remove() {
    if (!open?.id || !confirm('Delete this inspection? This can’t be undone.')) return
    setBusy(true)
    try {
      await deleteRow('hs_inspections', open.id, 'inspection')
      setOpen(null)
      await reload()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  if (open) {
    const f = open.form
    const fails = f.items.filter((x) => x.result === 'fail').length
    return (
      <div className="card hs-form">
        <div className="pane-head">
          <h2>{open.id ? `${f.kind}: ${ukDate(f.inspected_on)}` : 'New H&S inspection'}</h2>
          <button type="button" className="small-button" onClick={() => (setOpen(null), setError(null), setMsg(null))}>
            ← All inspections
          </button>
        </div>
        {msg && <p className="saved">{msg}</p>}
        {error && <p className="error">{error}</p>}
        <div className="form-grid">
          <label>
            Type *
            <select value={Object.keys(INSPECTION_TYPES).includes(f.kind) ? f.kind : 'Other'} disabled={readOnly} onChange={(e) => changeKind(e.target.value)}>
              {Object.keys(INSPECTION_TYPES).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Date *
            <input type="date" value={f.inspected_on} disabled={readOnly} onChange={(e) => set({ inspected_on: e.target.value })} />
          </label>
          <label>
            Area / location
            <input value={f.area} disabled={readOnly} placeholder="e.g. Whole site, Level 2" onChange={(e) => set({ area: e.target.value })} />
          </label>
          <label>
            Inspector
            <input value={f.inspector} disabled={readOnly} onChange={(e) => set({ inspector: e.target.value })} />
          </label>
        </div>

        <h3 className="sub-head">Checklist {fails > 0 && <span className="hs-chip rejected">{fails} failed</span>}</h3>
        <ul className="hs-checklist">
          {f.items.map((it, i) => (
            <li key={i} className={it.result ?? ''}>
              <div className="hs-q">
                {INSPECTION_TYPES[f.kind]?.includes(it.q) ? <span>{it.q}</span> : <input className="hs-own-q" value={it.q} disabled={readOnly} placeholder="Your own item" onChange={(e) => setItem(i, { q: e.target.value })} />}
                <span className="hs-seg" role="group" aria-label={it.q}>
                  {RESULTS.map(([r, l]) => (
                    <button key={r} type="button" disabled={readOnly} className={`${r} ${it.result === r ? 'on' : ''}`} aria-pressed={it.result === r} onClick={() => mark(i, r)}>
                      {l}
                    </button>
                  ))}
                </span>
              </div>
              {(it.result === 'fail' || it.note) && <input className="hs-note" value={it.note} disabled={readOnly} placeholder={it.result === 'fail' ? 'What is wrong?' : 'Note'} onChange={(e) => setItem(i, { note: e.target.value })} />}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <button type="button" className="link-button small" onClick={() => set({ items: [...f.items, { q: '', result: null, note: '' }] })}>
            + Add an item
          </button>
        )}


        <div className="form-grid">
          <label>
            Overall result
            <select value={f.result} disabled={readOnly} onChange={(e) => set({ result: e.target.value as InspectionResult })}>
              {INSPECTION_RESULTS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <span />
          <label className="span-2">
            Actions: what has to be done
            <textarea rows={3} value={f.actions} disabled={readOnly} onChange={(e) => set({ actions: e.target.value })} />
          </label>
          <label>
            Actions to be done by
            <input type="date" value={f.actions_due} disabled={readOnly} onChange={(e) => set({ actions_due: e.target.value })} />
          </label>
          <label>
            Actions closed on
            <input type="date" value={f.actions_closed_on} disabled={readOnly} onChange={(e) => set({ actions_closed_on: e.target.value })} />
          </label>
          <label className="span-2">
            Notes
            <textarea rows={2} value={f.notes} disabled={readOnly} onChange={(e) => set({ notes: e.target.value })} />
          </label>
        </div>
        {open.id ? <HsFiles jobId={job.id} kind="inspection" recordId={open.id} readOnly={readOnly} /> : <p className="muted small">Save the inspection first, then you can add photos.</p>}
        {!readOnly && (
          <div className="form-actions">
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save inspection'}
            </button>
            {open.id && (
              <button type="button" className="link-button danger" disabled={busy} onClick={remove}>
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  const today = todayIso()
  const openCount = (rows ?? []).filter(actionsOpen).length
  const lateCount = (rows ?? []).filter((r) => actionsOpen(r) && r.actions_due && r.actions_due < today).length
  const shown = (rows ?? []).filter((r) => !onlyOpen || actionsOpen(r))
  return (
    <div className="card">
      <div className="pane-head">
        <h2>H&S inspections</h2>
        <div className="head-actions">
          {openCount > 0 && (
            <label className="check small">
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Open actions only
            </label>
          )}
          {shown.length > 0 && (
            <button type="button" className="small-button" onClick={() => exportInspections(job, shown)}>
              Export Excel
            </button>
          )}
          {!readOnly && (
            <button type="button" className="primary" onClick={() => (setMsg(null), setError(null), setOpen({ id: null, form: blank(me?.full_name ?? '') }))}>
              + New inspection
            </button>
          )}
        </div>
      </div>
      {openCount > 0 && (
        <p className={lateCount ? 'error' : 'muted'}>
          {openCount} inspection{openCount === 1 ? '' : 's'} with actions still open{lateCount ? `, ${lateCount} past the date` : ''}.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {rows === null && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && !error && <p className="muted">No inspections yet.</p>}
      {rows && rows.length > 0 && (
        <div className="table-scroll">
          <table className="table hs-list">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Area</th>
                <th>Inspector</th>
                <th>Result</th>
                <th className="num">Failed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const late = actionsOpen(r) && r.actions_due && r.actions_due < today
                return (
                  <tr key={r.id} className="clickable" onClick={() => (setMsg(null), setError(null), setOpen({ id: r.id, form: fromRow(r) }))}>
                    <td>{ukDate(r.inspected_on)}</td>
                    <td>{r.kind}</td>
                    <td>{r.area}</td>
                    <td>{r.inspector}</td>
                    <td>
                      <span className={`hs-chip ${r.result}`}>{resultLabel(r.result)}</span>
                    </td>
                    <td className="num">{failCount(r) || ''}</td>
                    <td className={late ? 'hs-late' : ''}>{!r.actions?.trim() ? '' : r.actions_closed_on ? `Closed ${ukDate(r.actions_closed_on)}` : `Open${r.actions_due ? `, due ${ukDate(r.actions_due)}${late ? ' (past)' : ''}` : ''}`}</td>
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
