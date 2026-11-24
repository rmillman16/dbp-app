import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { addDaysIso, money, ukDate } from '../lib/format'
import { useAccess, type Section as Part } from '../lib/access'
import { CLIENT_PAYMENT_DAYS, TARGET_MARGIN_PCT, loadDashboard, type Dashboard as Data, type JobRow } from '../lib/dashboard'
import { APP_STATUS_LABELS, ENQUIRY_STATUS_LABELS, JOB_STATUS_LABELS, type AppStatus, type Job, type JobStatus } from '../lib/types'
import Loading from '../components/Loading'

// Management › the company dashboard: the directors' overview (23 Nov; docs/decisions.md "Company dashboard").
// Headline tiles, then Cash · Pipeline · Margin & risk · Programme & delivery, then every job in one table.
// The figures and their definitions are in src/lib/dashboard.ts. Click a row to open the job (or enquiry).
type Scope = 'live' | 'live_complete'
const SCOPES: Record<Scope, JobStatus[]> = { live: ['live'], live_complete: ['live', 'complete'] }
const ALL_STATUSES: JobStatus[] = ['tender', 'live', 'complete', 'archived']
const pct = (n: number | null | undefined) => (n == null ? '–' : `${(n * 100).toFixed(1)}%`)
const sum = <T,>(xs: T[], f: (x: T) => number | null | undefined) => xs.reduce((s, x) => s + (f(x) ?? 0), 0)
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`
const monthName = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleString('en-GB', { month: 'short' })

function JobName({ job, status }: { job: Job; status?: boolean }) {
  return (
    <>
      <strong>
        {job.job_no} {job.code}
      </strong>{' '}
      {job.name}
      {status && <span className={`tag ${job.status}`}> {JOB_STATUS_LABELS[job.status]}</span>}
    </>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { can } = useAccess()
  const [scope, setScope] = useState<Scope>('live')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showValue, setShowValue] = useState(false)

  useEffect(() => {
    loadDashboard().then(setData, (e: Error) => setError(e.message))
  }, [])

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => SCOPES[scope].includes(r.job.status)), [data, scope])
  const today = data?.today ?? ''
  const commercial = can('job_commercial')

  const t = useMemo(() => {
    const withCvr = rows.filter((r) => r.cvr)
    const cvrValue = sum(withCvr, (r) => r.cvr!.afv)
    const net = sum(withCvr, (r) => r.cvr!.margin)
    const jobIds = new Set(rows.map((r) => r.job.id))
    const notices = (data?.notices ?? []).filter((n) => jobIds.has(n.jobId))
    const issued = notices.filter((n) => !n.draft)
    const pipe = data?.pipeline
    const win12 = pipe?.winRate.find((w) => w.months === 12)
    return {
      gross: sum(rows, (r) => r.gross),
      net,
      netPct: cvrValue ? net / cvrValue : null,
      withCvr: withCvr.length,
      noCvr: rows.length - withCvr.length,
      owed: sum(rows, (r) => r.owed),
      owedOverdue: sum(
        rows.filter((r) => r.owedDue && r.owedDue < today),
        (r) => r.owed,
      ),
      retention: sum(rows, (r) => r.retention),
      notices,
      subOwed: sum(issued, (n) => n.due),
      subOverdue: sum(
        issued.filter((n) => n.overdue),
        (n) => n.due,
      ),
      subOverdueCount: issued.filter((n) => n.overdue).length,
      issuedCount: issued.length,
      pipeValue: sum(pipe?.open ?? [], (e) => e.value),
      pipeCount: pipe?.open.length ?? 0,
      win12,
      late: rows.filter((r) => (r.slipDays ?? 0) > 0),
    }
  }, [rows, data, today])

  const go = (path: string) => () => navigate(path)

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
        <span className="muted small">All figures exclude VAT. Pipeline and win rate are company-wide.</span>
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="dash-tiles">
            <Tile label="Jobs" value={String(rows.length)} sub={scope === 'live' ? 'live' : 'live and complete'} />
            {commercial && (
              <Tile
                label="Value"
                value={money(t.gross)}
                sub={`gross · net ${t.withCvr ? `${money(t.net)} (${pct(t.netPct)})` : '–'}${t.noCvr ? ` · ${t.noCvr} with no CVR, not in net` : ''}`}
                onClick={() => setShowValue((s) => !s)}
                open={showValue}
              />
            )}
            {commercial && (
              <Tile
                label="Owed to us"
                value={money(t.owed)}
                sub={`${t.owedOverdue ? `${money(t.owedOverdue)} overdue · ` : ''}${money(t.retention)} retention held`}
                warn={t.owedOverdue > 0}
              />
            )}
            {commercial && (
              <Tile
                label="Owed to subcontractors"
                value={money(t.subOwed)}
                sub={`${t.issuedCount} payment notice${t.issuedCount === 1 ? '' : 's'}${t.subOverdueCount ? ` · ${money(t.subOverdue)} past due date` : ''}`}
                warn={t.subOverdueCount > 0}
              />
            )}
            {can('estimating') && <Tile label="Pipeline" value={money(t.pipeValue)} sub={`${t.pipeCount} open enquir${t.pipeCount === 1 ? 'y' : 'ies'} and tenders`} />}
            {can('estimating') && (
              <Tile
                label="Win rate"
                value={t.win12?.decided ? pct(t.win12.won / t.win12.decided) : '–'}
                sub={t.win12?.decided ? `last 12 months · won ${t.win12.won} of ${t.win12.decided} decided` : 'nothing decided in 12 months'}
              />
            )}
            <Tile label="Late jobs" value={t.late.length ? String(t.late.length) : 'None'} sub="programme finishing after PC" warn={t.late.length > 0} />
          </div>

          {showValue && commercial && <ValueBreakdown rows={data.rows} initial={SCOPES[scope]} onClose={() => setShowValue(false)} />}

          <div className="dash-sections">
            <CashCard rows={rows} t={t} today={today} allowed={commercial} go={go} />
            <PipelineCard data={data} allowed={can('estimating')} go={go} />
            <MarginCard rows={rows} allowed={commercial} eot={can('job_eot')} go={go} />
            <ProgrammeCard rows={rows} today={today} can={can} go={go} />
          </div>

          <JobsTable rows={rows} scope={scope} commercial={commercial} go={go} />
        </>
      )}
    </>
  )
}

type Go = (path: string) => () => void

// a headline figure: the label and note in text colours; a warning carries ⚠ as well as colour
function Tile({ label, value, sub, warn, onClick, open }: { label: string; value: string; sub: string; warn?: boolean; onClick?: () => void; open?: boolean }) {
  const body = (
    <>
      <span className="dash-tile-label">
        {label}
        {onClick && <span className="dash-tile-more">{open ? ' ▴ hide' : ' ▾ how it’s made up'}</span>}
      </span>
      <strong className="dash-tile-value">
        {warn && <span aria-hidden>⚠ </span>}
        {value}
      </strong>
      <span className="dash-tile-sub">{sub}</span>
    </>
  )
  return onClick ? (
    <button type="button" className={`dash-tile dash-tile-button ${open ? 'open' : ''}`} onClick={onClick} aria-expanded={open}>
      {body}
    </button>
  ) : (
    <div className={`dash-tile ${warn ? 'warn' : ''}`}>{body}</div>
  )
}

function Section({ title, children, allowed = true, what }: { title: string; children: ReactNode; allowed?: boolean; what?: string }) {
  return (
    <section className="card dash-card">
      <h2>{title}</h2>
      {allowed ? children : <p className="muted">You can’t open {what ?? 'this part'} (Settings › Access), so it isn’t shown.</p>}
    </section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="muted small">{children}</p>

// ---------- Value: how the gross and net are made up ----------
function ValueBreakdown({ rows: all, initial, onClose }: { rows: JobRow[]; initial: JobStatus[]; onClose: () => void }) {
  const navigate = useNavigate()
  const [on, setOn] = useState<JobStatus[]>(initial)
  const rows = all.filter((r) => on.includes(r.job.status))
  const cvrRows = rows.filter((r) => r.cvr)
  const toggle = (s: JobStatus) => setOn((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]))
  const contract = (r: JobRow) => (r.cvr ? r.cvr.contractSum : r.job.contract_sum)
  const agreed = (r: JobRow) => (r.cvr ? r.cvr.agreedVos : r.vosAgreed)
  const other = (r: JobRow) => r.vosIssued + r.vosNotIssued
  const net = sum(cvrRows, (r) => r.cvr!.margin)
  const cvrValue = sum(cvrRows, (r) => r.cvr!.afv)
  return (
    <section className="card dash-breakdown">
      <div className="pane-head">
        <h2>Value: how it’s made up</h2>
        <button className="small-button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="segmented dash-filter" role="group" aria-label="Show jobs by status">
        {ALL_STATUSES.map((s) => (
          <button key={s} className={on.includes(s) ? 'on' : ''} aria-pressed={on.includes(s)} onClick={() => toggle(s)}>
            {on.includes(s) ? '✓ ' : ''}
            {JOB_STATUS_LABELS[s]} <span className="seg-count">{all.filter((r) => r.job.status === s).length}</span>
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty>No jobs with the statuses ticked.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table stack dash-table">
            <thead>
              <tr>
                <th>Job</th>
                <th className="num">Contract sum</th>
                <th className="num">+ Agreed VOs</th>
                <th className="num">+ Other VOs</th>
                <th className="num">± Possible reduction</th>
                <th className="num">= Gross</th>
                <th className="num">− Total cost</th>
                <th className="num">= Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.job.id} className="clickable" onClick={() => navigate(`/jobs/${r.job.id}/cvr`)}>
                  <td className="stack-title">
                    <JobName job={r.job} status />
                    <div className="muted small">{r.cvr ? `CVR ${ukDate(r.cvr.date)}` : 'no finalised CVR: contract sum + every VO'}</div>
                  </td>
                  <td className="num" data-label="Contract sum">
                    {money(contract(r)) || '–'}
                    {r.cvr && <div className="muted small">SoW total</div>}
                  </td>
                  <td className="num" data-label="+ Agreed VOs">
                    {money(agreed(r))}
                  </td>
                  <td className="num" data-label="+ Other VOs">
                    {r.cvr ? (
                      <span className="muted" title="The CVR counts agreed VOs only">
                        ({money(other(r))} not counted)
                      </span>
                    ) : (
                      money(other(r))
                    )}
                  </td>
                  <td className="num" data-label="± Possible reduction">
                    {r.cvr ? money(r.cvr.possibleReduction) : <span className="muted">–</span>}
                  </td>
                  <td className="num" data-label="= Gross">
                    <strong>{money(r.gross) || '–'}</strong>
                  </td>
                  <td className="num" data-label="− Total cost">
                    {r.cvr ? money(r.cvr.totalCost) : <span className="muted">no CVR</span>}
                  </td>
                  <td className="num" data-label="= Net">
                    {r.cvr ? (
                      <span className={r.cvr.margin < 0 ? 'late' : ''}>
                        {r.cvr.margin < 0 && '⚠ '}
                        {money(r.cvr.margin)} · {pct(r.cvr.marginPct)}
                      </span>
                    ) : (
                      <span className="muted">no CVR</span>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="dash-total">
                <td className="stack-title">Total ({rows.length} jobs)</td>
                <td className="num" data-label="Contract sum">
                  {money(sum(rows, contract))}
                </td>
                <td className="num" data-label="+ Agreed VOs">
                  {money(sum(rows, agreed))}
                </td>
                <td className="num" data-label="+ Other VOs">
                  {money(
                    sum(
                      rows.filter((r) => !r.cvr),
                      other,
                    ),
                  )}
                </td>
                <td className="num" data-label="± Possible reduction">
                  {money(sum(cvrRows, (r) => r.cvr!.possibleReduction))}
                </td>
                <td className="num" data-label="= Gross">
                  {money(sum(rows, (r) => r.gross))}
                </td>
                <td className="num" data-label="− Total cost">
                  {money(sum(cvrRows, (r) => r.cvr!.totalCost))}
                </td>
                <td className="num" data-label="= Net">
                  {cvrRows.length ? `${money(net)} · ${pct(cvrValue ? net / cvrValue : null)}` : '–'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        With a finalised CVR, gross is its anticipated final value (SoW total + agreed VOs ± possible reduction) and net is its margin (gross less total cost); other VOs are shown
        but not counted, as in the CVR. Without one, gross is the contract sum + every VO’s projected value (firm price once priced, else its budget; rejected VOs count nothing),
        and net isn’t known: {rows.length - cvrRows.length} job{rows.length - cvrRows.length === 1 ? ' is' : 's are'} left out of the net total.
      </p>
    </section>
  )
}

// ---------- Cash ----------
function CashCard({
  rows,
  t,
  today,
  allowed,
  go,
}: {
  rows: JobRow[]
  t: { notices: Data['notices']; subOwed: number; subOverdue: number }
  today: string
  allowed: boolean
  go: Go
}) {
  const cash = rows.filter((r) => r.applied != null || r.certifiedGross != null || r.paid)
  const jobOf = new Map(rows.map((r) => [r.job.id, r.job]))
  const drafts = t.notices.filter((n) => n.draft)
  return (
    <Section title="Cash" allowed={allowed} what="the commercial side of jobs">
      <h3>Applications: applied, certified and paid to date</h3>
      {cash.length === 0 ? (
        <Empty>No applications yet.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table stack dash-table">
            <thead>
              <tr>
                <th>Job</th>
                <th className="num">Applied</th>
                <th className="num">Certified</th>
                <th className="num">Paid</th>
                <th className="num">Owed to us</th>
                <th className="num">Retention held</th>
              </tr>
            </thead>
            <tbody>
              {cash.map((r) => {
                const late = !!r.owedDue && r.owedDue < today
                const pcPassed = !!r.job.pc_date && r.job.pc_date < today
                return (
                  <tr key={r.job.id} className="clickable" onClick={go(`/jobs/${r.job.id}/applications`)}>
                    <td className="stack-title">
                      <JobName job={r.job} />
                    </td>
                    <td className="num" data-label="Applied">
                      {r.applied != null ? money(r.applied) : <span className="muted">–</span>}
                    </td>
                    <td className="num" data-label="Certified">
                      {r.certifiedGross != null ? money(r.certifiedGross) : <span className="muted">not yet</span>}
                    </td>
                    <td className="num" data-label="Paid">
                      {money(r.paid)}
                    </td>
                    <td className="num" data-label="Owed to us">
                      <span className={late ? 'late' : ''}>
                        {late && '⚠ '}
                        {money(r.owed)}
                      </span>
                      {r.owedDue && <div className={`small ${late ? 'late' : 'muted'}`}>{late ? `overdue since ${ukDate(r.owedDue)}` : `due ${ukDate(r.owedDue)}`}</div>}
                    </td>
                    <td className="num" data-label="Retention held">
                      {r.retention ? money(r.retention) : <span className="muted">–</span>}
                      {r.retention > 0 && (
                        <div className={`small ${!r.retentionHalved && pcPassed ? 'late' : 'muted'}`}>
                          {r.retentionHalved
                            ? 'half back at PC; rest at end of defects'
                            : r.job.pc_date
                              ? `${pcPassed ? '⚠ ' : ''}half due at PC ${ukDate(r.job.pc_date)}`
                              : 'half due at PC (no PC date)'}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              <tr className="dash-total">
                <td className="stack-title">Total</td>
                <td className="num" data-label="Applied">
                  {money(sum(cash, (r) => r.applied))}
                </td>
                <td className="num" data-label="Certified">
                  {money(sum(cash, (r) => r.certifiedGross))}
                </td>
                <td className="num" data-label="Paid">
                  {money(sum(cash, (r) => r.paid))}
                </td>
                <td className="num" data-label="Owed to us">
                  {money(sum(cash, (r) => r.owed))}
                </td>
                <td className="num" data-label="Retention held">
                  {money(sum(cash, (r) => r.retention))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Applied and certified are gross to date (before retention), from the latest application sent and the latest the client has assessed. Owed to us is the client certified
        total (after retention) less everything paid, due {CLIENT_PAYMENT_DAYS} days after the application went in. The defects period isn’t held in the app, so the second half of
        retention has no date.
      </p>

      <h3>Owed to subcontractors</h3>
      {t.notices.length === 0 ? (
        <Empty>No payment notices waiting to be paid.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table stack dash-table">
            <thead>
              <tr>
                <th>Subcontractor</th>
                <th>Job</th>
                <th>Payment due</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {t.notices.map((n) => {
                const job = jobOf.get(n.jobId)
                return (
                  <tr key={n.noticeId} className="clickable" onClick={go(`/jobs/${n.jobId}/orders/${n.orderId}/${n.noticeId}`)}>
                    <td className="stack-title">
                      <strong>{n.company}</strong> <span className="muted small">Notice {n.noticeNo}</span>
                      {n.draft && <span className="tag"> draft</span>}
                    </td>
                    <td data-label="Job">{job ? `${job.job_no} ${job.code}` : ''}</td>
                    <td className={`nowrap ${n.overdue ? 'late' : ''}`} data-label="Payment due">
                      {n.overdue && '⚠ '}
                      {ukDate(n.paymentDue) || '–'}
                      {n.overdue && <div className="small">past due date</div>}
                    </td>
                    <td className="num" data-label="Amount">
                      {money(n.due)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Issued: {money(t.subOwed)}
        {t.subOverdue ? `, of which ${money(t.subOverdue)} is past its payment due date` : ''}
        {drafts.length ? `. In draft: ${money(sum(drafts, (n) => n.due))} (not in the total)` : ''}. A notice counts until its dbp payment date has passed or a later notice is
        issued on that order.
      </p>
    </Section>
  )
}

// ---------- Pipeline ----------
function PipelineCard({ data, allowed, go }: { data: Data; allowed: boolean; go: Go }) {
  const p = data.pipeline
  const max = Math.max(...p.wonByMonth.map((m) => m.value), 0)
  const wonTotal = sum(p.wonByMonth, (m) => m.value)
  const best = p.wonByMonth.reduce((b, m) => (m.value > b.value ? m : b), p.wonByMonth[0])
  const open = [...p.open].sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'))
  const enquiryRow = (e: (typeof open)[number]) => (
    <tr key={e.id} className="clickable" onClick={go(`/estimating/e/${e.id}`)}>
      <td className="stack-title">
        <strong>{e.ref}</strong> {e.name}
        {e.client && <div className="muted small">{e.client}</div>}
      </td>
      <td data-label="Status">
        <span className={`tag enq-${e.status}`}>{ENQUIRY_STATUS_LABELS[e.status]}</span>
      </td>
      <td className={`nowrap ${e.dueDate && e.dueDate < data.today && e.status !== 'submitted' ? 'late' : ''}`} data-label="Due back">
        {e.dueDate && e.dueDate < data.today && e.status !== 'submitted' && '⚠ '}
        {ukDate(e.dueDate) || '–'}
      </td>
      <td className="num" data-label="Value">
        {e.value != null ? money(e.value) : <span className="muted">not priced</span>}
      </td>
    </tr>
  )
  return (
    <Section title="Pipeline" allowed={allowed} what="Estimating">
      <div className="table-scroll">
        <table className="table stack dash-table">
          <thead>
            <tr>
              <th>Open</th>
              <th className="num">Number</th>
              <th className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {p.byStatus.map((s) => (
              <tr key={s.status}>
                <td className="stack-title">{ENQUIRY_STATUS_LABELS[s.status]}</td>
                <td className="num" data-label="Number">
                  {s.count}
                </td>
                <td className="num" data-label="Value">
                  {money(s.value)}
                </td>
              </tr>
            ))}
            <tr className="dash-total">
              <td className="stack-title">Total open</td>
              <td className="num" data-label="Number">
                {p.open.length}
              </td>
              <td className="num" data-label="Value">
                {money(sum(p.open, (e) => e.value))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>Win rate (won ÷ decided)</h3>
      <p className="dash-winrate">
        {p.winRate.map((w) => (
          <span key={w.months}>
            Last {w.months} months: <strong>{w.decided ? pct(w.won / w.decided) : '–'}</strong>{' '}
            <span className="muted small">
              won {w.won} of {w.decided}
            </span>
          </span>
        ))}
      </p>

      <h3>Won value by month</h3>
      {wonTotal === 0 ? (
        <Empty>Nothing won in the last 12 months.</Empty>
      ) : (
        <>
          <div className="dash-bars" role="img" aria-label={`Won value by month, last 12 months: ${money(wonTotal)} in all`}>
            {p.wonByMonth.map((m) => (
              <div key={m.month} className="dash-bar" title={`${monthName(m.month)} ${m.month.slice(0, 4)}: ${money(m.value)} (${m.count} won)`}>
                {m.value > 0 && <span style={{ height: `${Math.max(2, (m.value / max) * 100)}%` }} />}
              </div>
            ))}
          </div>
          <div className="dash-bar-labels" aria-hidden>
            {p.wonByMonth.map((m) => (
              <span key={m.month}>{monthName(m.month).slice(0, 1)}</span>
            ))}
          </div>
          <p className="muted small">
            {money(wonTotal)} won in 12 months
            {best && best.value > 0 ? `; best month ${monthName(best.month)} ${best.month.slice(0, 4)}, ${money(best.value)}` : ''}. Hover a bar for its month.
          </p>
        </>
      )}

      <h3>Due back this month</h3>
      {p.dueThisMonth.length === 0 ? (
        <Empty>No tenders or quotes due back this month.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table stack dash-table">
            <tbody>{p.dueThisMonth.map(enquiryRow)}</tbody>
          </table>
        </div>
      )}

      <h3>Open enquiries and tenders</h3>
      {open.length === 0 ? (
        <Empty>None open.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table stack dash-table">
            <thead>
              <tr>
                <th>Enquiry</th>
                <th>Status</th>
                <th>Due back</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>{open.slice(0, 10).map(enquiryRow)}</tbody>
          </table>
        </div>
      )}
      {open.length > 10 && (
        <p className="small">
          and {open.length - 10} more in <Link to="/estimating">Estimating</Link>
        </p>
      )}
      <p className="muted small">
        Value is the enquiry’s accepted quotation, else its latest that isn’t rejected or withdrawn. Decided means won or lost: dated by the accepted quotation, else when the
        enquiry was last changed.
      </p>
    </Section>
  )
}

// ---------- Margin & risk ----------
function MarginCard({ rows, allowed, eot, go }: { rows: JobRow[]; allowed: boolean; eot: boolean; go: Go }) {
  const byMargin = rows.filter((r) => r.cvr).sort((a, b) => b.cvr!.marginPct - a.cvr!.marginPct)
  const noCvr = rows.filter((r) => !r.cvr)
  const below = byMargin.filter((r) => r.cvr!.marginPct < TARGET_MARGIN_PCT)
  const atRisk = rows.filter((r) => r.vosUnagreedCount > 0).sort((a, b) => b.vosIssued + b.vosNotIssued - (a.vosIssued + a.vosNotIssued))
  const claims = rows.filter((r) => r.eotOpen.count > 0)
  return (
    <Section title="Margin & risk" allowed={allowed} what="the commercial side of jobs">
      <p className="small">
        Target margin: <strong>{pct(TARGET_MARGIN_PCT)}</strong>.{' '}
        {byMargin.length === 0 ? (
          ''
        ) : below.length ? (
          <span className="late">
            ⚠ {below.length} job{below.length === 1 ? '' : 's'} below it
          </span>
        ) : (
          'Every job with a CVR is at or above it.'
        )}
      </p>
      {byMargin.length === 0 ? (
        <Empty>No finalised CVRs yet.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table stack dash-table">
            <thead>
              <tr>
                <th>Job (best to worst)</th>
                <th className="num">Margin</th>
                <th className="num">Since last CVR</th>
              </tr>
            </thead>
            <tbody>
              {byMargin.map((r) => {
                const c = r.cvr!
                const low = c.marginPct < TARGET_MARGIN_PCT
                const move = r.prevCvr ? c.margin - r.prevCvr.margin : null
                const movePts = r.prevCvr ? (c.marginPct - r.prevCvr.marginPct) * 100 : null
                return (
                  <tr key={r.job.id} className="clickable" onClick={go(`/jobs/${r.job.id}/cvr`)}>
                    <td className="stack-title">
                      <JobName job={r.job} />
                      <div className="muted small">CVR {ukDate(c.date)}</div>
                    </td>
                    <td className={`num ${low ? 'late' : ''}`} data-label="Margin">
                      {low && '⚠ '}
                      {money(c.margin)} · {pct(c.marginPct)}
                      {low && <div className="small">below target</div>}
                    </td>
                    <td className="num" data-label="Since last CVR">
                      {move == null ? (
                        <span className="muted">first CVR</span>
                      ) : (
                        <>
                          <span className={move < 0 ? 'late' : ''}>
                            {move < 0 ? '▼ ' : move > 0 ? '▲ ' : ''}
                            {signed(move)}
                          </span>
                          <div className="muted small">
                            {movePts! >= 0 ? '+' : '−'}
                            {Math.abs(movePts!).toFixed(1)} pts since {ukDate(r.prevCvr!.date)}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {noCvr.length > 0 && <p className="muted small">No finalised CVR: {noCvr.map((r) => `${r.job.job_no} ${r.job.code}`).join(', ')}. Not ranked, not counted as 0.</p>}

      <h3>Unagreed VOs at risk</h3>
      {atRisk.length === 0 ? (
        <Empty>Every VO is agreed or rejected.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table stack dash-table">
            <thead>
              <tr>
                <th>Job</th>
                <th className="num">Issued</th>
                <th className="num">Not issued</th>
                <th className="num">At risk</th>
              </tr>
            </thead>
            <tbody>
              {atRisk.map((r) => (
                <tr key={r.job.id} className="clickable" onClick={go(`/jobs/${r.job.id}/variations`)}>
                  <td className="stack-title">
                    <JobName job={r.job} /> <span className="muted small">{r.vosUnagreedCount} VOs</span>
                  </td>
                  <td className="num" data-label="Issued">
                    {money(r.vosIssued)}
                  </td>
                  <td className="num" data-label="Not issued">
                    {money(r.vosNotIssued)}
                  </td>
                  <td className="num" data-label="At risk">
                    <strong>{money(r.vosIssued + r.vosNotIssued)}</strong>
                  </td>
                </tr>
              ))}
              <tr className="dash-total">
                <td className="stack-title">Total</td>
                <td className="num" data-label="Issued">
                  {money(sum(atRisk, (r) => r.vosIssued))}
                </td>
                <td className="num" data-label="Not issued">
                  {money(sum(atRisk, (r) => r.vosNotIssued))}
                </td>
                <td className="num" data-label="At risk">
                  {money(sum(atRisk, (r) => r.vosIssued + r.vosNotIssued))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <h3>Open EOT claims</h3>
      {!eot ? (
        <Empty>You can’t open Job › EOT, so claims aren’t shown.</Empty>
      ) : claims.length === 0 ? (
        <Empty>No EOT claims waiting for a decision.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table stack dash-table">
            <thead>
              <tr>
                <th>Job</th>
                <th className="num">Claims</th>
                <th className="num">Days claimed</th>
                <th className="num">Prolongation</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((r) => (
                <tr key={r.job.id} className="clickable" onClick={go(`/jobs/${r.job.id}/eot`)}>
                  <td className="stack-title">
                    <JobName job={r.job} />
                  </td>
                  <td className="num" data-label="Claims">
                    {r.eotOpen.count}
                  </td>
                  <td className="num" data-label="Days claimed">
                    {r.eotOpen.days}
                  </td>
                  <td className="num" data-label="Prolongation">
                    {r.eotOpen.prolongation ? money(r.eotOpen.prolongation) : <span className="muted">no weekly rate</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Open claims are draft, notified or claimed (not yet granted or rejected); prolongation is days claimed at the weekly prelims rate. LDs aren’t shown: jobs don’t hold an LD
        rate in the app.
      </p>
    </Section>
  )
}

// ---------- Programme & delivery ----------
function ProgrammeCard({ rows, today, can, go }: { rows: JobRow[]; today: string; can: (s: Part) => boolean; go: Go }) {
  const late = rows.filter((r) => (r.slipDays ?? 0) > 0).sort((a, b) => b.slipDays! - a.slipDays!)
  const horizon = addDaysIso(today, 91)
  const finishing = rows
    .map((r) => ({ r, finish: r.forecastFinish ?? r.job.pc_date }))
    .filter((x) => x.finish && x.finish >= today && x.finish <= horizon)
    .sort((a, b) => a.finish!.localeCompare(b.finish!))
  const om = rows.filter((r) => r.omOverdue > 0).sort((a, b) => b.omOverdue - a.omOverdue)
  const proc = rows.filter((r) => r.procLate > 0).sort((a, b) => b.procLate - a.procLate)
  return (
    <Section title="Programme & delivery">
      <h3>Finishing late against PC</h3>
      {!can('job_programme') ? (
        <Empty>You can’t open Job › Programme, so programme finishes aren’t shown.</Empty>
      ) : late.length === 0 ? (
        <Empty>No job’s programme finishes after its PC date.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table stack dash-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>PC</th>
                <th>Programme finish</th>
                <th className="num">Late</th>
              </tr>
            </thead>
            <tbody>
              {late.map((r) => (
                <tr key={r.job.id} className="clickable" onClick={go(`/jobs/${r.job.id}/programme`)}>
                  <td className="stack-title">
                    <JobName job={r.job} />
                  </td>
                  <td className="nowrap" data-label="PC">
                    {ukDate(r.job.pc_date)}
                    {r.eotGrantedDays > 0 && <div className="muted small">{r.eotGrantedDays} days EOT granted</div>}
                  </td>
                  <td className="nowrap" data-label="Programme finish">
                    {ukDate(r.forecastFinish)}
                  </td>
                  <td className="num late" data-label="Late">
                    ⚠ {r.slipDays} days
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Completing in the next 3 months</h3>
      {finishing.length === 0 ? (
        <Empty>No job finishes before {ukDate(horizon)}.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table stack dash-table">
            <tbody>
              {finishing.map(({ r, finish }) => (
                <tr key={r.job.id} className="clickable" onClick={go(`/jobs/${r.job.id}`)}>
                  <td className="stack-title">
                    <JobName job={r.job} />
                  </td>
                  <td className="nowrap" data-label="Finish">
                    {ukDate(finish)} <span className="muted small">{r.forecastFinish ? 'programme' : 'PC (no programme)'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>O&amp;M documents overdue</h3>
      {!can('job_om') ? (
        <Empty>You can’t open Job › O&amp;M, so O&amp;M items aren’t shown.</Empty>
      ) : om.length === 0 ? (
        <Empty>No outstanding O&amp;M document is past its due date.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table stack dash-table">
            <tbody>
              {om.map((r) => (
                <tr key={r.job.id} className="clickable" onClick={go(`/jobs/${r.job.id}/om`)}>
                  <td className="stack-title">
                    <JobName job={r.job} />
                  </td>
                  <td className="num late" data-label="Overdue">
                    ⚠ {r.omOverdue} overdue
                    <div className="small">oldest due {ukDate(r.omOldestDue)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Procurement past its order-by date</h3>
      {!can('job_procurement') ? (
        <Empty>You can’t open Job › Procurement, so it isn’t shown.</Empty>
      ) : proc.length === 0 ? (
        <Empty>Nothing past its order-by date without an order.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table stack dash-table">
            <tbody>
              {proc.map((r) => (
                <tr key={r.job.id} className="clickable" onClick={go(`/jobs/${r.job.id}/procurement`)}>
                  <td className="stack-title">
                    <JobName job={r.job} />
                  </td>
                  <td className="num late" data-label="Past order-by">
                    ⚠ {r.procLate} item{r.procLate === 1 ? '' : 's'}
                    <div className="small">earliest {ukDate(r.procOldest)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Late is the job’s latest programme finish against its contract PC date. Procurement counts saved schedule rows with an order-by date that has passed and no order placed.
      </p>
    </Section>
  )
}

// ---------- every job ----------
function JobsTable({ rows, scope, commercial, go }: { rows: JobRow[]; scope: Scope; commercial: boolean; go: Go }) {
  return (
    <section className="card">
      <h2>Every job</h2>
      {rows.length === 0 ? (
        <p className="muted">No jobs to show.</p>
      ) : (
        <div className="table-scroll">
          <table className="table stack dash-table">
            <thead>
              <tr>
                <th>Job</th>
                {commercial && <th className="num">Value (gross)</th>}
                {commercial && <th className="num">Net</th>}
                {commercial && <th className="num">Received</th>}
                {commercial && <th>Last application</th>}
                <th>Programme finish</th>
                <th className="num">Overdue</th>
                <th className="num">Requisitions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.job.id} className="clickable" onClick={go(`/jobs/${r.job.id}`)}>
                  <td className="stack-title">
                    <JobName job={r.job} status={scope !== 'live'} />
                  </td>
                  {commercial && (
                    <td className="num nowrap" data-label="Value (gross)">
                      {money(r.gross) || '–'}
                      {!r.cvr && r.gross != null && <div className="muted small">contract sum + VOs</div>}
                    </td>
                  )}
                  {commercial && (
                    <td className="num nowrap" data-label="Net">
                      {r.cvr == null ? (
                        <span className="muted">no CVR</span>
                      ) : (
                        <>
                          <span className={r.cvr.margin < 0 ? 'late' : ''}>
                            {r.cvr.margin < 0 && '⚠ '}
                            {money(r.cvr.margin)} · {pct(r.cvr.marginPct)}
                          </span>
                          <div className="muted small">CVR {ukDate(r.cvr.date)}</div>
                        </>
                      )}
                    </td>
                  )}
                  {commercial && (
                    <td className="num nowrap" data-label="Received">
                      {money(r.paid) || '–'}
                    </td>
                  )}
                  {commercial && (
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
                  )}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Value and net come from each job’s latest finalised CVR (else the contract sum and VOs). Received is what’s recorded as paid on applications. Overdue counts reminders past
        their date. Programme finish is the job’s programme against its PC date.
      </p>
    </section>
  )
}
