import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { money, ukDate } from '../lib/format'
import { loadDashboard, type DashRow } from '../lib/dashboard'
import { APP_STATUS_LABELS, JOB_STATUS_LABELS, type AppStatus } from '../lib/types'

// Management › the company dashboard (22 Nov): every job in one view: value and margin (latest finalised CVR),
// cash received, programme against PC, overdue items and hire. Click a job to open it.
type Scope = 'live' | 'live_complete'
const pct = (n: number | null) => (n == null ? '–' : `${(n * 100).toFixed(1)}%`)

export default function Dashboard() {
  const navigate = useNavigate()
  const [scope, setScope] = useState<Scope>('live')
  const [rows, setRows] = useState<DashRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRows(null)
    setError(null)
    loadDashboard(scope === 'live' ? ['live'] : ['live', 'complete']).then(setRows, (e: Error) => setError(e.message))
  }, [scope])

  const t = useMemo(() => {
    const r = rows ?? []
    const withCvr = r.filter((x) => x.margin != null && x.value)
    const cvrValue = withCvr.reduce((s, x) => s + (x.value ?? 0), 0)
    const margin = withCvr.reduce((s, x) => s + (x.margin ?? 0), 0)
    return {
      jobs: r.length,
      value: r.reduce((s, x) => s + (x.value ?? 0), 0),
      margin,
      marginPct: cvrValue ? margin / cvrValue : null,
      withCvr: withCvr.length,
      received: r.reduce((s, x) => s + x.received, 0),
      late: r.filter((x) => (x.slipDays ?? 0) > 0).length,
      overdue: r.reduce((s, x) => s + x.overdue, 0),
      onHire: r.reduce((s, x) => s + x.onHire, 0),
      hireSpend: r.reduce((s, x) => s + x.hireSpend, 0),
      hireOverdue: r.reduce((s, x) => s + x.hireOverdue, 0),
    }
  }, [rows])

  return (
    <>
      <h1>Dashboard</h1>
      <div className="toolbar">
        <div className="segmented">
          <button className={scope === 'live' ? 'on' : ''} onClick={() => setScope('live')}>
            Live jobs
          </button>
          <button className={scope === 'live_complete' ? 'on' : ''} onClick={() => setScope('live_complete')}>
            Live and complete
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows && (
        <>
          <div className="dash-tiles">
            <Tile label="Jobs" value={String(t.jobs)} sub={scope === 'live' ? 'live' : 'live and complete'} />
            <Tile label="Value" value={money(t.value)} sub="anticipated final (CVR), else contract sum" />
            <Tile
              label="Margin"
              value={t.withCvr ? money(t.margin) : '–'}
              sub={t.withCvr ? `${pct(t.marginPct)} · from ${t.withCvr} finalised CVR${t.withCvr === 1 ? '' : 's'}` : 'no finalised CVRs yet'}
            />
            <Tile label="Cash received" value={money(t.received)} sub="paid against applications" />
            <Tile label="Programme" value={t.late ? `${t.late} late` : 'On track'} sub="finishing after PC" warn={t.late > 0} />
            <Tile label="Overdue items" value={String(t.overdue)} sub="reminders past their date" warn={t.overdue > 0} />
            <Tile
              label="On hire"
              value={String(t.onHire)}
              sub={`${money(t.hireSpend)} ordered${t.hireOverdue ? ` · ${t.hireOverdue} past end date` : ''}`}
              warn={t.hireOverdue > 0}
            />
          </div>

          <section className="card">
            {rows.length === 0 ? (
              <p className="muted">No jobs to show.</p>
            ) : (
              <div className="table-scroll">
                <table className="table stack dash-table">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th className="num">Value</th>
                      <th className="num">Margin</th>
                      <th className="num">Received</th>
                      <th>Last application</th>
                      <th>Programme finish</th>
                      <th className="num">Overdue</th>
                      <th className="num">Requisitions</th>
                      <th>Hire</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.job.id} className="clickable" onClick={() => navigate(`/jobs/${r.job.id}`)}>
                        <td className="stack-title">
                          <strong>
                            {r.job.job_no} {r.job.code}
                          </strong>{' '}
                          {r.job.name}
                          {scope !== 'live' && <span className={`tag ${r.job.status}`}> {JOB_STATUS_LABELS[r.job.status]}</span>}
                        </td>
                        <td className="num nowrap" data-label="Value">
                          {money(r.value) || '–'}
                          {!r.valueFromCvr && r.value != null && <div className="muted small">contract sum</div>}
                        </td>
                        <td className="num nowrap" data-label="Margin">
                          {r.margin == null ? (
                            <span className="muted">no CVR</span>
                          ) : (
                            <>
                              <span className={r.margin < 0 ? 'late' : ''}>
                                {money(r.margin)} · {pct(r.marginPct)}
                              </span>
                              <div className="muted small">CVR {ukDate(r.cvrDate)}</div>
                            </>
                          )}
                        </td>
                        <td className="num nowrap" data-label="Received">
                          {money(r.received) || '–'}
                        </td>
                        <td className="nowrap" data-label="Last application">
                          {r.lastApp ? (
                            <>
                              App {r.lastApp.no} · {APP_STATUS_LABELS[r.lastApp.status as AppStatus] ?? r.lastApp.status}
                              {r.lastApp.date && <div className="muted small">{ukDate(r.lastApp.date)}</div>}
                            </>
                          ) : (
                            <span className="muted">none</span>
                          )}
                        </td>
                        <td className="nowrap" data-label="Programme finish">
                          {r.forecastFinish ? (
                            <>
                              {ukDate(r.forecastFinish)}
                              {r.slipDays != null && (
                                <div className={`small ${r.slipDays > 0 ? 'late' : 'muted'}`}>
                                  {r.slipDays > 0 ? `⚠ ${r.slipDays} days after PC` : r.slipDays < 0 ? `${-r.slipDays} days before PC` : 'on PC'}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="muted">no programme</span>
                          )}
                        </td>
                        <td className={`num ${r.overdue ? 'late' : 'muted'}`} data-label="Overdue">
                          {r.overdue ? `⚠ ${r.overdue}` : '0'}
                        </td>
                        <td className="num" data-label="Requisitions">
                          {r.openReqs ? `${r.openReqs} open` : <span className="muted">0</span>}
                        </td>
                        <td className="nowrap" data-label="Hire">
                          {r.onHire || r.hireSpend ? (
                            <>
                              {r.onHire} on hire
                              <div className="muted small">{money(r.hireSpend)} ordered</div>
                              {r.hireOverdue > 0 && <div className="late small">⚠ {r.hireOverdue} past end date</div>}
                            </>
                          ) : (
                            <span className="muted">–</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">
              Value and margin come from each job’s latest finalised CVR. Cash received is what’s recorded as paid on applications. Programme finish is the job’s programme against
              its PC date.
            </p>
          </section>
        </>
      )}
    </>
  )
}

// a headline figure: the label and note in text colours; a warning carries ⚠ as well as colour
function Tile({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={`dash-tile ${warn ? 'warn' : ''}`}>
      <span className="dash-tile-label">{label}</span>
      <strong className="dash-tile-value">
        {warn && <span aria-hidden>⚠ </span>}
        {value}
      </strong>
      <span className="dash-tile-sub">{sub}</span>
    </div>
  )
}
