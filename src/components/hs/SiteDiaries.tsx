// Site diaries (24 Nov, script 081): one a day for the job: weather, who was on site, what was done, delays, instructions, visitors,
// deliveries, plant, and health and safety. Click a day to open or change it.
import { useEffect, useState } from 'react'
import { deleteRow, loadRows, saveRow, WEATHER, type LabourLine, type SiteDiary } from '../../lib/hs'
import { exportDiaries } from '../../lib/exportHs'
import { saveError } from '../../lib/offline'
import { todayIso, ukDate } from '../../lib/format'
import type { Job } from '../../lib/types'
import HsFiles from './HsFiles'

type Form = {
  diary_date: string
  weather: string
  temperature: string
  labour: LabourLine[]
  work_done: string
  delays: string
  instructions: string
  visitors: string
  deliveries: string
  plant: string
  safety: string
  notes: string
}
const blank = (date: string): Form => ({ diary_date: date, weather: '', temperature: '', labour: [{ trade: '', company: '', number: 0 }], work_done: '', delays: '', instructions: '', visitors: '', deliveries: '', plant: '', safety: '', notes: '' })
const fromRow = (r: SiteDiary): Form => ({
  diary_date: r.diary_date,
  weather: r.weather ?? '',
  temperature: r.temperature ?? '',
  labour: r.labour.length ? r.labour : [{ trade: '', company: '', number: 0 }],
  work_done: r.work_done ?? '',
  delays: r.delays ?? '',
  instructions: r.instructions ?? '',
  visitors: r.visitors ?? '',
  deliveries: r.deliveries ?? '',
  plant: r.plant ?? '',
  safety: r.safety ?? '',
  notes: r.notes ?? '',
})
const people = (l: LabourLine[]) => l.reduce((n, x) => n + (Number(x.number) || 0), 0)
const nul = (s: string) => s.trim() || null

export default function SiteDiaries({ job, readOnly }: { job: Job; readOnly: boolean }) {
  const [rows, setRows] = useState<SiteDiary[] | null>(null)
  const [open, setOpen] = useState<{ id: string | null; form: Form } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = () => loadRows<SiteDiary>('site_diaries', job.id).then(setRows, (e: Error) => (setError(e.message), setRows([])))
  useEffect(() => {
    reload()
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function start() {
    const today = todayIso()
    const have = rows?.find((r) => r.diary_date === today)
    setMsg(have ? "Today's diary already exists: opened." : null)
    setOpen(have ? { id: have.id, form: fromRow(have) } : { id: null, form: blank(today) })
  }
  const set = (patch: Partial<Form>) => setOpen((o) => o && { ...o, form: { ...o.form, ...patch } })
  const setLine = (i: number, patch: Partial<LabourLine>) => set({ labour: open!.form.labour.map((l, j) => (j === i ? { ...l, ...patch } : l)) })

  async function save() {
    if (!open) return
    const f = open.form
    setError(null)
    setMsg(null)
    if (!f.diary_date) return setError('Choose the date.')
    if (!open.id && rows?.some((r) => r.diary_date === f.diary_date)) return setError('There is already a diary for that date: open it from the list.')
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      const saved = await saveRow<SiteDiary>('site_diaries', job.id, open.id, {
        diary_date: f.diary_date,
        weather: nul(f.weather),
        temperature: nul(f.temperature),
        labour: f.labour.filter((l) => l.trade.trim() || l.company.trim() || l.number),
        work_done: nul(f.work_done),
        delays: nul(f.delays),
        instructions: nul(f.instructions),
        visitors: nul(f.visitors),
        deliveries: nul(f.deliveries),
        plant: nul(f.plant),
        safety: nul(f.safety),
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
    if (!open?.id || !confirm(`Delete the diary for ${ukDate(open.form.diary_date)}? This can't be undone.`)) return
    setBusy(true)
    try {
      await deleteRow('site_diaries', open.id, 'diary')
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
          <h2>{open.id ? `Site diary: ${ukDate(f.diary_date)}` : 'New site diary'}</h2>
          <button type="button" className="small-button" onClick={() => (setOpen(null), setError(null), setMsg(null))}>
            ← All diaries
          </button>
        </div>
        {msg && <p className="saved">{msg}</p>}
        {error && <p className="error">{error}</p>}
        <div className="form-grid">
          <label>
            Date *
            <input type="date" value={f.diary_date} disabled={!!open.id || readOnly} onChange={(e) => set({ diary_date: e.target.value })} />
          </label>
          <label>
            Weather
            <input list="hs-weather" value={f.weather} disabled={readOnly} onChange={(e) => set({ weather: e.target.value })} />
            <datalist id="hs-weather">
              {WEATHER.map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
          </label>
          <label>
            Temperature
            <input value={f.temperature} disabled={readOnly} placeholder="e.g. 8°C" onChange={(e) => set({ temperature: e.target.value })} />
          </label>
        </div>

        <h3 className="sub-head">Who was on site ({people(f.labour)})</h3>
        <table className="table hs-labour">
          <thead>
            <tr>
              <th>Trade</th>
              <th>Company</th>
              <th className="num">Number</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {f.labour.map((l, i) => (
              <tr key={i}>
                <td>
                  <input value={l.trade} disabled={readOnly} onChange={(e) => setLine(i, { trade: e.target.value })} placeholder="e.g. Joinery" />
                </td>
                <td>
                  <input value={l.company} disabled={readOnly} onChange={(e) => setLine(i, { company: e.target.value })} />
                </td>
                <td className="num">
                  <input type="number" min={0} value={l.number || ''} disabled={readOnly} onChange={(e) => setLine(i, { number: Number(e.target.value) || 0 })} />
                </td>
                <td>
                  {!readOnly && f.labour.length > 1 && (
                    <button type="button" className="link-button small muted" aria-label="Remove" onClick={() => set({ labour: f.labour.filter((_, j) => j !== i) })}>
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!readOnly && (
          <button type="button" className="link-button small" onClick={() => set({ labour: [...f.labour, { trade: '', company: '', number: 0 }] })}>
            + Add a trade
          </button>
        )}

        <div className="form-grid">
          <label className="span-2">
            Work done today
            <textarea rows={4} value={f.work_done} disabled={readOnly} onChange={(e) => set({ work_done: e.target.value })} />
          </label>
          <label className="span-2">
            Delays and why
            <textarea rows={2} value={f.delays} disabled={readOnly} onChange={(e) => set({ delays: e.target.value })} />
          </label>
          <label className="span-2">
            Instructions received (and from whom)
            <textarea rows={2} value={f.instructions} disabled={readOnly} onChange={(e) => set({ instructions: e.target.value })} />
          </label>
          <label>
            Visitors
            <textarea rows={2} value={f.visitors} disabled={readOnly} onChange={(e) => set({ visitors: e.target.value })} />
          </label>
          <label>
            Deliveries (the delivery notes have the detail)
            <textarea rows={2} value={f.deliveries} disabled={readOnly} onChange={(e) => set({ deliveries: e.target.value })} />
          </label>
          <label>
            Plant and equipment on site
            <textarea rows={2} value={f.plant} disabled={readOnly} onChange={(e) => set({ plant: e.target.value })} />
          </label>
          <label>
            Health and safety (toolbox talks, accidents, near misses, observations)
            <textarea rows={2} value={f.safety} disabled={readOnly} onChange={(e) => set({ safety: e.target.value })} />
          </label>
          <label className="span-2">
            Other notes
            <textarea rows={2} value={f.notes} disabled={readOnly} onChange={(e) => set({ notes: e.target.value })} />
          </label>
        </div>
        {open.id ? <HsFiles jobId={job.id} kind="diary" recordId={open.id} readOnly={readOnly} /> : <p className="muted small">Save the diary first, then you can add photos.</p>}
        {!readOnly && (
          <div className="form-actions">
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save diary'}
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

  return (
    <div className="card">
      <div className="pane-head">
        <h2>Site diaries</h2>
        <div className="head-actions">
          {rows && rows.length > 0 && (
            <button type="button" className="small-button" onClick={() => exportDiaries(job, rows)}>
              Export Excel
            </button>
          )}
          {!readOnly && (
            <button type="button" className="primary" onClick={start}>
              + Today's diary
            </button>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {rows === null && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && !error && <p className="muted">No diaries yet. Start today's: one a day for the job.</p>}
      {rows && rows.length > 0 && (
        <div className="table-scroll">
          <table className="table hs-list">
            <thead>
              <tr>
                <th>Date</th>
                <th>Weather</th>
                <th className="num">On site</th>
                <th>Work done</th>
                <th>Delays</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => (setMsg(null), setError(null), setOpen({ id: r.id, form: fromRow(r) }))}>
                  <td>{ukDate(r.diary_date)}</td>
                  <td>{[r.weather, r.temperature].filter(Boolean).join(', ')}</td>
                  <td className="num">{people(r.labour) || ''}</td>
                  <td className="hs-clip">{r.work_done}</td>
                  <td className="hs-clip">{r.delays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
