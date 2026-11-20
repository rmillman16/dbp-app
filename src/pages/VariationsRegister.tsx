import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { money, ukDate } from '../lib/format'
import { VO_STATUS_LABELS } from '../lib/types'
import { loadJobVariations, projectedValue, type VoWithLines } from '../lib/variations'
import { exportVariationWorkbook } from '../lib/exportVariations'
import { useJob } from './JobLayout'

export default function VariationsRegister() {
  const { job } = useJob()
  const navigate = useNavigate()
  const [vos, setVos] = useState<VoWithLines[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    loadJobVariations(job).then(setVos, (e: Error) => setError(e.message))
  }, [job])

  async function exportExcel() {
    if (!vos) return
    setExporting(true)
    try {
      await exportVariationWorkbook(job, vos)
    } catch (e) {
      setError((e as Error).message)
    }
    setExporting(false)
  }

  const live = vos?.filter((v) => v.vo.status !== 'rejected') ?? []
  const projected = live.reduce((s, v) => s + projectedValue(v.vo, v.build), 0)
  const agreed = live.filter((v) => v.vo.status === 'agreed').reduce((s, v) => s + projectedValue(v.vo, v.build), 0)

  return (
    <section className="card">
      <div className="pane-head">
        <h2>Variations</h2>
        <div className="button-row">
          <button onClick={exportExcel} disabled={exporting || !vos?.length}>
            {exporting ? 'Exporting…' : 'Export to Excel'}
          </button>
          <Link to="new" className="button primary">
            + New VO
          </Link>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="stat-row">
        <div className="stat">
          <span className="muted small">Total to date projected increase</span>
          <strong>{money(projected)}</strong>
        </div>
        <div className="stat">
          <span className="muted small">Agreed</span>
          <strong>{money(agreed)}</strong>
        </div>
        <div className="stat">
          <span className="muted small">VOs</span>
          <strong>{vos?.length ?? 0}</strong>
        </div>
      </div>

      {vos === null && !error && <p className="muted">Loading…</p>}
      {vos?.length === 0 && <p className="muted">No variations yet.</p>}
      {vos && vos.length > 0 && (
        <table className="table stack">
          <thead>
            <tr>
              <th>VO</th>
              <th>Name</th>
              <th>Date</th>
              <th>Status</th>
              <th className="num">Budget</th>
              <th className="num">Firm</th>
              <th>Instructed</th>
              <th>CAI no.</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {vos.map(({ vo, build }) => (
              <tr key={vo.id} className="clickable" onClick={() => navigate(vo.id)}>
                <td className="nowrap stack-title">
                  <span className={`vo-chip ${vo.status}`}>VO {vo.vo_no}</span>
                </td>
                <td className="stack-sub">{vo.title}</td>
                <td className="nowrap" data-label="Date">
                  {ukDate(vo.vo_date)}
                </td>
                <td data-label="Status">{VO_STATUS_LABELS[vo.status]}</td>
                <td
                  className={`num ${build.priced ? 'struck' : ''} ${vo.budget_value == null ? 'stack-hide' : ''}`}
                  data-label="Budget"
                  title={build.priced ? 'Not shown on exports once a firm price is in' : ''}
                >
                  {money(vo.budget_value)}
                </td>
                <td className={`num ${build.priced ? '' : 'stack-hide'}`} data-label="Firm">
                  {build.priced ? money(build.total) : ''}
                </td>
                <td className={`nowrap ${vo.date_agreed ? '' : 'stack-hide'}`} data-label="Instructed">
                  {ukDate(vo.date_agreed)}
                </td>
                <td className={vo.instruction_ref ? '' : 'stack-hide'} data-label="CAI no.">
                  {vo.instruction_ref}
                </td>
                <td className={`small ${vo.notes ? '' : 'stack-hide'}`} data-label="Notes">
                  {vo.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">
        Colour key: no colour = Not issued · amber = Issued · green = Agreed · red = Rejected. Budgets shown struck through
        are kept here but left off exports because the VO has a firm price.
      </p>
    </section>
  )
}
