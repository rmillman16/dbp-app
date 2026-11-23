import { MoneyText } from '../components/MoneyInput'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, todayIso } from '../lib/format'
import { VO_STATUS_LABELS, type Variation, type VariationLine, type VoSection, type VoStatus } from '../lib/types'
import { buildUp, lineTotal } from '../lib/variations'
import { exportSingleVo } from '../lib/exportVariations'
import { cached, must, saveError } from '../lib/offline'
import { useJob } from './JobLayout'

// Inputs are held as text while editing and converted on save.
interface LineDraft {
  key: number
  section: VoSection
  description: string
  qty: string
  unit: string
  rate: string
}

interface HeaderDraft {
  vo_no: number | null
  title: string
  description: string
  status: VoStatus
  vo_date: string
  budget_value: string
  ohp_pct: string
  prelims_pct: string
  programme_days: string
  instruction_ref: string
  date_issued: string
  date_agreed: string
  notes: string
}

// the saved VO and its lines (from the device's copy when offline)
function loadVo(voId: string) {
  return cached(`vo:${voId}`, async () => ({
    v: await must<Variation>(supabase.from('variations').select('*').eq('id', voId).single()),
    lines: await must<VariationLine[]>(supabase.from('variation_lines').select('*').eq('variation_id', voId).order('sort')),
  }))
}

let nextKey = 1
const s = (v: unknown) => (v == null ? '' : String(v))
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
const textOrNull = (v: string) => (v.trim() === '' ? null : v.trim())

function toLine(d: LineDraft, sort: number): VariationLine {
  const line = { section: d.section, description: d.description.trim(), qty: numOrNull(d.qty), unit: textOrNull(d.unit), rate: numOrNull(d.rate), sort, total: 0 }
  line.total = lineTotal(line)
  return line
}

export default function VariationEditor() {
  const { voId } = useParams()
  const { job } = useJob()
  const isNew = voId === 'new'
  const navigate = useNavigate()
  const [head, setHead] = useState<HeaderDraft | null>(null)
  const [lines, setLines] = useState<LineDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ;(async () => {
      const j = job
      if (isNew) {
        setHead({
          vo_no: null,
          title: '',
          description: '',
          status: 'not_issued',
          vo_date: todayIso(),
          budget_value: '',
          ohp_pct: s(j.ohp_pct),
          prelims_pct: s(j.prelims_pct),
          programme_days: '0',
          instruction_ref: '',
          date_issued: '',
          date_agreed: '',
          notes: '',
        })
        return
      }

      let saved: { v: Variation; lines: VariationLine[] }
      try {
        saved = await loadVo(voId!)
      } catch (e) {
        return setError((e as Error).message)
      }
      const v = saved.v
      setHead({
        vo_no: v.vo_no,
        title: v.title,
        description: s(v.description),
        status: v.status,
        vo_date: s(v.vo_date),
        budget_value: s(v.budget_value),
        ohp_pct: s(v.ohp_pct ?? j.ohp_pct),
        prelims_pct: s(v.prelims_pct ?? j.prelims_pct),
        programme_days: s(v.programme_days ?? 0),
        instruction_ref: s(v.instruction_ref),
        date_issued: s(v.date_issued),
        date_agreed: s(v.date_agreed),
        notes: s(v.notes),
      })
      setLines(
        saved.lines.map((l) => ({
          key: nextKey++,
          section: l.section,
          description: l.description,
          qty: s(l.qty),
          unit: s(l.unit),
          rate: s(l.rate),
        })),
      )
    })()
  }, [job, voId, isNew])

  const built = useMemo(() => {
    if (!head) return null
    return buildUp(
      lines.map((l, i) => toLine(l, i)),
      { ohp_pct: Number(head.ohp_pct || 0), prelims_pct: Number(head.prelims_pct || 0) },
      job,
    )
  }, [lines, head, job])

  function setH<K extends keyof HeaderDraft>(key: K, value: HeaderDraft[K]) {
    setSaved(false)
    setHead((h) => {
      if (!h) return h
      const next = { ...h, [key]: value }
      // stamp the dates the first time a VO is issued / agreed
      if (key === 'status' && value === 'issued' && !h.date_issued) next.date_issued = todayIso()
      if (key === 'status' && value === 'agreed' && !h.date_agreed) next.date_agreed = todayIso()
      return next
    })
  }

  function setLine(key: number, field: keyof LineDraft, value: string) {
    setSaved(false)
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)))
  }

  function addLine(section: VoSection) {
    setSaved(false)
    setLines((ls) => [...ls, { key: nextKey++, section, description: '', qty: '1', unit: 'item', rate: '' }])
  }

  function removeLine(key: number) {
    setSaved(false)
    setLines((ls) => ls.filter((l) => l.key !== key))
  }

  async function save(e?: FormEvent) {
    e?.preventDefault()
    if (!head) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    if (lines.some((l) => !l.description.trim())) return setError('Every line needs a description (or remove the empty line).')
    const fail = (err: { message: string }) => {
      setBusy(false)
      setError(saveError(err))
    }

    const row = {
      job_id: job.id,
      title: head.title.trim(),
      description: textOrNull(head.description),
      status: head.status,
      vo_date: head.vo_date || todayIso(),
      budget_value: numOrNull(head.budget_value),
      ohp_pct: Number(head.ohp_pct),
      prelims_pct: Number(head.prelims_pct),
      programme_days: numOrNull(head.programme_days) ?? 0,
      instruction_ref: textOrNull(head.instruction_ref),
      date_issued: head.date_issued || null,
      date_agreed: head.date_agreed || null,
      notes: textOrNull(head.notes),
    }

    setBusy(true)
    let id = voId
    if (isNew) {
      const max = await supabase.from('variations').select('vo_no').eq('job_id', job.id).order('vo_no', { ascending: false }).limit(1)
      const vo_no = (max.data?.[0]?.vo_no ?? 0) + 1
      if (max.error) return fail(max.error)
      const ins = await supabase.from('variations').insert({ ...row, vo_no }).select('id').single()
      if (ins.error) return fail(ins.error)
      id = ins.data.id
    } else {
      const upd = await supabase.from('variations').update(row).eq('id', id)
      if (upd.error) return fail(upd.error)
      const del = await supabase.from('variation_lines').delete().eq('variation_id', id)
      if (del.error) return fail(del.error)
    }

    // OMIT lines first, then ADD, as on the VO sheet
    const ordered = [...lines.filter((l) => l.section === 'omit'), ...lines.filter((l) => l.section === 'add')]
    if (ordered.length) {
      const ins = await supabase.from('variation_lines').insert(ordered.map((l, i) => ({ ...toLine(l, i), variation_id: id })))
      if (ins.error) return fail(ins.error)
    }
    setBusy(false)
    if (isNew) navigate(`/jobs/${job.id}/variations/${id}`, { replace: true })
    setSaved(true)
  }

  async function exportThis() {
    if (!head || !voId || isNew) return
    try {
      const { v, lines: ls } = await loadVo(voId)
      await exportSingleVo(job, { vo: v, lines: ls, build: buildUp(ls, v, job) })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error && !head) return <p className="error">{error}</p>
  if (!head || !built) return <p className="muted">Loading…</p>

  const section = (sec: VoSection) => (
    <>
      <tr className={`section-row ${sec}`}>
        <td colSpan={6}>
          {sec === 'omit' ? 'OMIT' : 'ADD'}
          <button type="button" className="small-button add-line" onClick={() => addLine(sec)}>
            + Add {sec === 'omit' ? 'omission' : 'line'}
          </button>
        </td>
      </tr>
      {lines
        .filter((l) => l.section === sec)
        .map((l) => (
          <tr key={l.key} className={`line-row ${sec === 'omit' ? 'omit-line' : ''}`}>
            <td className="c-desc">
              <input value={l.description} onChange={(e) => setLine(l.key, 'description', e.target.value)} placeholder="Description" />
            </td>
            <td className="c-qty" data-label="Qty">
              <input type="number" step="any" inputMode="decimal" className="qty" value={l.qty} onChange={(e) => setLine(l.key, 'qty', e.target.value)} />
            </td>
            <td className="c-unit" data-label="Unit">
              <input className="unit" value={l.unit} onChange={(e) => setLine(l.key, 'unit', e.target.value)} />
            </td>
            <td className="c-rate" data-label="Rate £">
              <MoneyText className="rate" value={l.rate} onChange={(v) => setLine(l.key, 'rate', v)} />
            </td>
            <td className="num c-total" data-label="Total">
              {money((sec === 'omit' ? -1 : 1) * lineTotal({ qty: numOrNull(l.qty), rate: numOrNull(l.rate) }))}
            </td>
            <td className="c-del">
              <button type="button" className="small-button" onClick={() => removeLine(l.key)} title="Remove line">
                ✕
              </button>
            </td>
          </tr>
        ))}
      <tr className="subtotal-row">
        <td colSpan={4}>{sec === 'omit' ? 'Omit sub-total' : 'Add sub-total'}</td>
        <td className="num">{money(sec === 'omit' ? built.omitSubtotal : built.addSubtotal)}</td>
        <td />
      </tr>
    </>
  )

  return (
    <form onSubmit={save}>
      <div className="sub-bar">
        <div>
          <Link to={`/jobs/${job.id}/variations`} className="link-button small">
            ← All variations
          </Link>
          <h2>{isNew ? 'New variation' : `VO ${head.vo_no}`}</h2>
        </div>
        <div className="button-row">
          {!isNew && (
            <>
              <button type="button" onClick={exportThis} title="Export the saved version of this VO sheet">
                Export VO sheet
              </button>
              <button type="button" onClick={() => navigate(`/jobs/${job.id}/quotations?vo=${voId}`)} title="Quote this VO to the client (save first)">
                Create quotation
              </button>
            </>
          )}
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {saved && <p className="saved">Saved.</p>}

      <section className="card vo-header">
        <div className="form-grid three">
          <label className="span-2">
            Variation name
            <input value={head.title} onChange={(e) => setH('title', e.target.value)} required placeholder="e.g. Waterproofing to basement" />
          </label>
          <label>
            Status
            <select value={head.status} onChange={(e) => setH('status', e.target.value as VoStatus)} className={`status-select ${head.status}`}>
              {(Object.keys(VO_STATUS_LABELS) as VoStatus[]).map((st) => (
                <option key={st} value={st}>
                  {VO_STATUS_LABELS[st]}
                </option>
              ))}
            </select>
          </label>
          <label className="span-3">
            Variation description
            <textarea rows={3} value={head.description} onChange={(e) => setH('description', e.target.value)} />
          </label>
          <label>
            Date
            <input type="date" value={head.vo_date} onChange={(e) => setH('vo_date', e.target.value)} required />
          </label>
          <label>
            CAI number
            <input value={head.instruction_ref} onChange={(e) => setH('instruction_ref', e.target.value)} />
          </label>
          <label>
            Budget (£)
            <MoneyText value={head.budget_value} onChange={(v) => setH('budget_value', v)} />
            {built.priced && head.budget_value && <span className="hint">Firm price in: budget kept here, left off exports.</span>}
          </label>
          <label>
            Date issued
            <input type="date" value={head.date_issued} onChange={(e) => setH('date_issued', e.target.value)} />
          </label>
          <label>
            Instructed (date agreed)
            <input type="date" value={head.date_agreed} onChange={(e) => setH('date_agreed', e.target.value)} />
          </label>
          <label>
            Programme implications (days)
            <input type="number" step="0.5" value={head.programme_days} onChange={(e) => setH('programme_days', e.target.value)} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Build-up</h2>
        <table className="table buildup">
          <thead>
            <tr>
              <th>Description</th>
              <th>Quantity</th>
              <th>Unit</th>
              <th>Rate £</th>
              <th className="num">Total £</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {section('omit')}
            {section('add')}
            <tr className="total-row">
              <td colSpan={4}>Sub-total</td>
              <td className="num">{money(built.subtotal)}</td>
              <td />
            </tr>
            <tr>
              <td colSpan={3}>OHP</td>
              <td>
                <span className="pct">
                  <input type="number" step="0.01" value={head.ohp_pct} onChange={(e) => setH('ohp_pct', e.target.value)} /> %
                </span>
              </td>
              <td className="num">{money(built.ohp)}</td>
              <td />
            </tr>
            <tr className="total-row">
              <td colSpan={4}>Marked-up sub-total</td>
              <td className="num">{money(built.markedUp)}</td>
              <td />
            </tr>
            <tr>
              <td colSpan={3}>Prelims</td>
              <td>
                <span className="pct">
                  <input type="number" step="0.01" value={head.prelims_pct} onChange={(e) => setH('prelims_pct', e.target.value)} /> %
                </span>
              </td>
              <td className="num">{money(built.prelims)}</td>
              <td />
            </tr>
            <tr className="grand-row">
              <td colSpan={4}>Variation total</td>
              <td className="num">{built.priced ? money(built.total) : <span className="muted">Not priced</span>}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <label>
          Notes
          <textarea rows={3} value={head.notes} onChange={(e) => setH('notes', e.target.value)} />
        </label>
      </section>

      {error && <p className="error">{error}</p>}
      {saved && <p className="saved">Saved.</p>}
      <div className="form-actions">
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
