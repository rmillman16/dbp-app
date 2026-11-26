import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { money, todayIso, ukDate } from '../lib/format'
import { VO_STATUS_LABELS, type VoStatus } from '../lib/types'
import { supabase } from '../lib/supabase'
import { useAccess } from '../lib/access'
import { saveError } from '../lib/offline'
import { loadJobVariations, projectedValue, type VoWithLines } from '../lib/variations'
import { exportVariationWorkbook } from '../lib/exportVariations'
import { useJob } from './JobLayout'
import Loading from '../components/Loading'

export default function VariationsRegister() {
  const { job } = useJob()
  const navigate = useNavigate()
  const [vos, setVos] = useState<VoWithLines[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const { can } = useAccess()
  const full = can('job_commercial') // values, editing, deleting; the site team only see the list and each one's status

  // change a variation's status from the list (the dates are stamped the first time, as in the editor)
  async function changeStatus(id: string, status: VoStatus) {
    const cur = vos?.find((v) => v.vo.id === id)?.vo
    if (!cur || cur.status === status) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    const patch: {
      status: VoStatus
      date_issued?: string
      date_agreed?: string
    } = { status }
    if (status === 'issued' && !cur.date_issued) patch.date_issued = todayIso()
    if (status === 'agreed' && !cur.date_agreed) patch.date_agreed = todayIso()
    const r = await supabase.from('variations').update(patch).eq('id', id).select('id')
    if (r.error) return setError(saveError(r.error))
    if (!r.data?.length) return setError('The status was not changed: you may not have access to this job.')
    setVos((all) => all && all.map((v) => (v.vo.id === id ? { ...v, vo: { ...v.vo, ...patch } } : v)))
  }

  // delete a variation made in error: always asks first
  async function remove(id: string) {
    const v = vos?.find((x) => x.vo.id === id)?.vo
    if (!v) return
    if (!window.confirm(`Delete VO ${v.vo_no}: ${v.title}?\n\nThis removes the variation and its build-up lines. It cannot be undone.`)) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    const r = await supabase.from('variations').delete().eq('id', id).select('id')
    if (r.error) return setError(saveError(r.error))
    if (!r.data?.length) return setError('The variation was not deleted: you may not have access, or script 101 has not been run in Supabase yet.')
    setVos((all) => all && all.filter((x) => x.vo.id !== id))
  }

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
          {full && (
            <>
              <button onClick={exportExcel} disabled={exporting || !vos?.length}>
                {exporting ? 'Exporting…' : 'Export to Excel'}
              </button>
              <Link to="new" className="button primary">
                + New VO
              </Link>
            </>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="stat-row">
        {full && (
          <>
            <div className="stat">
              <span className="muted small">Total to date projected increase</span>
              <strong>{money(projected)}</strong>
            </div>
            <div className="stat">
              <span className="muted small">Agreed</span>
              <strong>{money(agreed)}</strong>
            </div>
          </>
        )}
        <div className="stat">
          <span className="muted small">VOs</span>
          <strong>{vos?.length ?? 0}</strong>
        </div>
      </div>

      {vos === null && !error && <Loading />}
      {vos?.length === 0 && <p className="muted">No variations yet.</p>}
      {vos && vos.length > 0 && (
        <table className="table stack">
          <thead>
            <tr>
              <th>VO</th>
              <th>Name</th>
              <th>Date</th>
              <th>Status</th>
              {full && <th className="num">Budget</th>}
              {full && <th className="num">Firm</th>}
              <th>Instructed</th>
              <th>CAI no.</th>
              <th>Notes</th>
              {full && <th />}
            </tr>
          </thead>
          <tbody>
            {vos.map(({ vo, build }) => (
              <tr key={vo.id} className={full ? 'clickable' : ''} onClick={full ? () => navigate(vo.id) : undefined}>
                <td className="nowrap stack-title">
                  <span className={`vo-chip ${vo.status}`}>VO {vo.vo_no}</span>
                </td>
                <td className="stack-sub">{vo.title}</td>
                <td className="nowrap" data-label="Date">
                  {ukDate(vo.vo_date)}
                </td>
                <td data-label="Status" onClick={(e) => e.stopPropagation()}>
                  {full ? (
                    <select
                      className={`status-select ${vo.status}`}
                      value={vo.status}
                      onChange={(e) => changeStatus(vo.id, e.target.value as VoStatus)}
                      aria-label={`Status of VO ${vo.vo_no}`}
                    >
                      {(Object.keys(VO_STATUS_LABELS) as VoStatus[]).map((st) => (
                        <option key={st} value={st}>
                          {VO_STATUS_LABELS[st]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    VO_STATUS_LABELS[vo.status]
                  )}
                </td>
                {full && (
                  <td
                    className={`num ${build.priced ? 'struck' : ''} ${vo.budget_value == null ? 'stack-hide' : ''}`}
                    data-label="Budget"
                    title={build.priced ? 'Not shown on exports once a firm price is in' : ''}
                  >
                    {money(vo.budget_value)}
                  </td>
                )}
                {full && (
                  <td className={`num ${build.priced ? '' : 'stack-hide'}`} data-label="Firm">
                    {build.priced ? money(build.total) : ''}
                  </td>
                )}
                <td className={`nowrap ${vo.date_agreed ? '' : 'stack-hide'}`} data-label="Instructed">
                  {ukDate(vo.date_agreed)}
                </td>
                <td className={vo.instruction_ref ? '' : 'stack-hide'} data-label="CAI no.">
                  {vo.instruction_ref}
                </td>
                <td className={`small ${vo.notes ? '' : 'stack-hide'}`} data-label="Notes">
                  {vo.notes}
                </td>
                {full && (
                  <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="small-button bin-button" title="Delete this variation" aria-label={`Delete VO ${vo.vo_no}`} onClick={() => remove(vo.id)}>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {full && (
        <p className="muted small">
          Colour key: no colour = Not issued · amber = Issued · green = Agreed · red = Rejected. Budgets shown struck through are kept here but left off exports because the VO has
          a firm price.
        </p>
      )}
    </section>
  )
}
