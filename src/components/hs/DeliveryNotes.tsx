// Delivery notes (24 Nov, script 081): what arrived on site, from whom, who received it and what condition it was in, with a photo of
// the supplier's note. Click one to open or change it.
import { useEffect, useState } from 'react'
import { CONDITIONS, deleteRow, loadRows, saveRow, type Condition, type DeliveryNote } from '../../lib/hs'
import { exportDeliveries } from '../../lib/exportHs'
import { saveError } from '../../lib/offline'
import { useAccess } from '../../lib/access'
import { todayIso, ukDate } from '../../lib/format'
import type { Job } from '../../lib/types'
import HsFiles from './HsFiles'
import Loading from '../Loading'

type Form = { delivered_on: string; supplier: string; note_ref: string; order_ref: string; description: string; quantity: string; received_by: string; condition: Condition; notes: string }
const blank = (by: string): Form => ({ delivered_on: todayIso(), supplier: '', note_ref: '', order_ref: '', description: '', quantity: '', received_by: by, condition: 'ok', notes: '' })
const fromRow = (r: DeliveryNote): Form => ({ delivered_on: r.delivered_on, supplier: r.supplier, note_ref: r.note_ref ?? '', order_ref: r.order_ref ?? '', description: r.description ?? '', quantity: r.quantity ?? '', received_by: r.received_by ?? '', condition: r.condition, notes: r.notes ?? '' })
const nul = (s: string) => s.trim() || null
const condLabel = (c: Condition) => CONDITIONS.find(([k]) => k === c)?.[1] ?? c

export default function DeliveryNotes({ job, readOnly }: { job: Job; readOnly: boolean }) {
  const { me } = useAccess()
  const [rows, setRows] = useState<DeliveryNote[] | null>(null)
  const [open, setOpen] = useState<{ id: string | null; form: Form } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')

  const reload = () => loadRows<DeliveryNote>('delivery_notes', job.id).then(setRows, (e: Error) => (setError(e.message), setRows([])))
  useEffect(() => {
    reload()
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Form>) => setOpen((o) => o && { ...o, form: { ...o.form, ...patch } })

  async function save() {
    if (!open) return
    const f = open.form
    setError(null)
    setMsg(null)
    if (!f.supplier.trim()) return setError('Who was it delivered by? Give the supplier.')
    if (!f.delivered_on) return setError('Choose the date.')
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      const saved = await saveRow<DeliveryNote>('delivery_notes', job.id, open.id, {
        delivered_on: f.delivered_on,
        supplier: f.supplier.trim(),
        note_ref: nul(f.note_ref),
        order_ref: nul(f.order_ref),
        description: nul(f.description),
        quantity: nul(f.quantity),
        received_by: nul(f.received_by),
        condition: f.condition,
        notes: nul(f.notes),
      })
      setOpen({ id: saved.id, form: fromRow(saved) })
      setMsg('Saved. Add a photo of the delivery note below.')
      await reload()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }
  async function remove() {
    if (!open?.id || !confirm('Delete this delivery note? This can’t be undone.')) return
    setBusy(true)
    try {
      await deleteRow('delivery_notes', open.id, 'delivery')
      setOpen(null)
      await reload()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  if (open) {
    const f = open.form
    return (
      <div className="card hs-form">
        <div className="pane-head">
          <h2>{open.id ? `Delivery: ${f.supplier} ${ukDate(f.delivered_on)}` : 'New delivery note'}</h2>
          <button type="button" className="small-button" onClick={() => (setOpen(null), setError(null), setMsg(null))}>
            ← All deliveries
          </button>
        </div>
        {msg && <p className="saved">{msg}</p>}
        {error && <p className="error">{error}</p>}
        <div className="form-grid">
          <label>
            Date delivered *
            <input type="date" value={f.delivered_on} disabled={readOnly} onChange={(e) => set({ delivered_on: e.target.value })} />
          </label>
          <label>
            Supplier *
            <input value={f.supplier} disabled={readOnly} onChange={(e) => set({ supplier: e.target.value })} />
          </label>
          <label>
            Supplier’s delivery note no.
            <input value={f.note_ref} disabled={readOnly} onChange={(e) => set({ note_ref: e.target.value })} />
          </label>
          <label>
            Our order / PO number
            <input value={f.order_ref} disabled={readOnly} onChange={(e) => set({ order_ref: e.target.value })} />
          </label>
          <label className="span-2">
            What was delivered
            <textarea rows={3} value={f.description} disabled={readOnly} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <label>
            Quantity
            <input value={f.quantity} disabled={readOnly} placeholder="e.g. 24 sheets, 3 pallets" onChange={(e) => set({ quantity: e.target.value })} />
          </label>
          <label>
            Received by
            <input value={f.received_by} disabled={readOnly} onChange={(e) => set({ received_by: e.target.value })} />
          </label>
          <label>
            Condition
            <select value={f.condition} disabled={readOnly} onChange={(e) => set({ condition: e.target.value as Condition })}>
              {CONDITIONS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            Notes {f.condition !== 'ok' && <span className="hint warn">(say what is wrong, and what you did about it)</span>}
            <textarea rows={2} value={f.notes} disabled={readOnly} onChange={(e) => set({ notes: e.target.value })} />
          </label>
        </div>
        {open.id ? <HsFiles jobId={job.id} kind="delivery" recordId={open.id} readOnly={readOnly} /> : <p className="muted small">Save first, then you can add a photo of the delivery note.</p>}
        {!readOnly && (
          <div className="form-actions">
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save delivery note'}
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

  const shown = (rows ?? []).filter((r) => !q.trim() || [r.supplier, r.note_ref, r.order_ref, r.description, r.received_by].join(' ').toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="card">
      <div className="pane-head">
        <h2>Delivery notes</h2>
        <div className="head-actions">
          <input type="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search delivery notes" />
          {shown.length > 0 && (
            <button type="button" className="small-button" onClick={() => exportDeliveries(job, shown)}>
              Export Excel
            </button>
          )}
          {!readOnly && (
            <button type="button" className="primary" onClick={() => (setMsg(null), setError(null), setOpen({ id: null, form: blank(me?.full_name ?? '') }))}>
              + New delivery
            </button>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {rows === null && <Loading />}
      {rows && rows.length === 0 && !error && <p className="muted">No deliveries logged yet.</p>}
      {rows && rows.length > 0 && (
        <div className="table-scroll">
          <table className="table hs-list">
            <thead>
              <tr>
                <th>Date</th>
                <th>Supplier</th>
                <th>Note no.</th>
                <th>Order</th>
                <th>Delivered</th>
                <th>Received by</th>
                <th>Condition</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => (setMsg(null), setError(null), setOpen({ id: r.id, form: fromRow(r) }))}>
                  <td>{ukDate(r.delivered_on)}</td>
                  <td>{r.supplier}</td>
                  <td>{r.note_ref}</td>
                  <td>{r.order_ref}</td>
                  <td className="hs-clip">{[r.description, r.quantity].filter(Boolean).join(' · ')}</td>
                  <td>{r.received_by}</td>
                  <td>
                    <span className={`hs-chip ${r.condition}`}>{condLabel(r.condition)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
