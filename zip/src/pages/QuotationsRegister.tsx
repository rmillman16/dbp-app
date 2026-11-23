import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { money, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { QUOTE_STATUS_LABELS, type Quotation } from '../lib/types'
import { createQuotation, fullRef, loadQuotations } from '../lib/quotations'
import { loadJobVariations, type VoWithLines } from '../lib/variations'
import { useJob } from './JobLayout'

export default function QuotationsRegister() {
  const { job } = useJob()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [quotes, setQuotes] = useState<{ q: Quotation; total: number }[] | null>(null)
  const [vos, setVos] = useState<VoWithLines[]>([])
  const [error, setError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(!!params.get('vo'))
  const [voId, setVoId] = useState(params.get('vo') ?? '')
  const [prelimsOwnLine, setPrelimsOwnLine] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadQuotations({ jobId: job.id }).then(setQuotes, (e: Error) => setError(e.message))
    loadJobVariations(job).then(setVos, () => {})
  }, [job])

  async function create(standalone: boolean) {
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    const vo = vos.find((v) => v.vo.id === voId)
    if (!standalone && !vo) return setError('Pick the VO to quote.')
    setBusy(true)
    try {
      const id = await createQuotation({ job }, standalone ? undefined : { vo: vo!, prelimsOwnLine })
      navigate(id)
    } catch (e) {
      setError(saveError(e))
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="pane-head">
        <h2>Quotations</h2>
        <button className="primary" onClick={() => setNewOpen(!newOpen)}>
          + New quotation
        </button>
      </div>

      {newOpen && (
        <div className="new-panel">
          <div className="new-option">
            <strong>From a VO</strong>
            <span className="muted small">Scope from the VO description, pricing from its build-up with OHP and prelims built into the rates.</span>
            <select value={voId} onChange={(e) => setVoId(e.target.value)}>
              <option value="">Choose a VO…</option>
              {vos.map(({ vo, build }) => (
                <option key={vo.id} value={vo.id}>
                  VO {vo.vo_no} – {vo.title}
                  {build.priced ? ` (${money(build.total)})` : ' (not priced)'}
                </option>
              ))}
            </select>
            <label className="check">
              <span>
                <input type="checkbox" checked={prelimsOwnLine} onChange={(e) => setPrelimsOwnLine(e.target.checked)} /> Show prelims as their own line
              </span>
            </label>
            <button className="primary" onClick={() => create(false)} disabled={busy || !voId}>
              Create from VO
            </button>
          </div>
          <div className="new-option">
            <strong>Standalone</strong>
            <span className="muted small">For bespoke or one-off work that isn't a VO. You write the scope and price it line by line.</span>
            <button onClick={() => create(true)} disabled={busy}>
              Create standalone quotation
            </button>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {quotes === null && !error && <p className="muted">Loading…</p>}
      {quotes?.length === 0 && <p className="muted">No quotations yet.</p>}
      {quotes && quotes.length > 0 && (
        <table className="table stack">
          <thead>
            <tr>
              <th>Reference</th>
              <th>VO</th>
              <th>Status</th>
              <th className="num">Total excl. VAT</th>
              <th>Date</th>
              <th>Valid until</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map(({ q, total }) => {
              const vo = vos.find((v) => v.vo.id === q.variation_id)
              return (
                <tr key={q.id} className="clickable" onClick={() => navigate(q.id)}>
                  <td className="stack-title">
                    <strong>{fullRef(job, q)}</strong>
                  </td>
                  <td className={vo ? '' : 'stack-hide'} data-label="VO">
                    {vo ? `VO ${vo.vo.vo_no}` : ''}
                  </td>
                  <td data-label="Status">
                    <span className={`q-status ${q.status}`}>{QUOTE_STATUS_LABELS[q.status]}</span>
                  </td>
                  <td className="num" data-label="Total excl. VAT">
                    {money(total)}
                  </td>
                  <td className="nowrap" data-label="Date">
                    {ukDate(q.issued_date)}
                  </td>
                  <td className="nowrap" data-label="Valid until">
                    {ukDate(q.valid_until)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
