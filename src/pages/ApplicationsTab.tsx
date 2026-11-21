import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { money, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { parseSow, type ParsedSow } from '../lib/sowImport'
import { parseBudget, type ParsedBudget } from '../lib/cvrBudget'
import { importBudget, loadPackages } from '../lib/cvr'
import { supabase } from '../lib/supabase'
import { appName, createApplication, createApplicationFromImport, importSow, loadApplications, loadCurrentSow } from '../lib/applications'
import { APP_STATUS_LABELS, type Application, type Job, type SowLine, type SowRevision } from '../lib/types'
import { useJob } from './JobLayout'

export default function ApplicationsTab() {
  const { job } = useJob()
  const navigate = useNavigate()
  const [sow, setSow] = useState<{ rev: SowRevision | null; lines: SowLine[] } | null>(null)
  const [apps, setApps] = useState<Application[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)

  const reload = () => {
    loadCurrentSow(job.id).then(setSow, (e: Error) => setError(e.message))
    loadApplications(job.id).then(setApps, (e: Error) => setError(e.message))
  }
  useEffect(reload, [job]) // eslint-disable-line react-hooks/exhaustive-deps

  async function newApplication() {
    if (!sow?.rev || !apps) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      navigate(await createApplication(job, sow.rev.id, apps))
    } catch (e) {
      setError(saveError(e))
      setBusy(false)
    }
  }

  return (
    <>
      <section className="card">
        <div className="pane-head">
          <h2>Priced schedule of works</h2>
          {sow?.rev && !importing && <button onClick={() => setImporting(true)}>Import a new revision</button>}
        </div>
        {sow === null && !error && <p className="muted">Loading…</p>}
        {sow && !sow.rev && !importing && (
          <>
            <p className="muted small intro">
              Applications are priced against the job's SoW. Import it once from Excel: the client or office SoW (e.g. "--sow-R5-client"), or an
              application workbook that contains it.
            </p>
            <button className="primary" onClick={() => setImporting(true)}>
              Import the SoW
            </button>
          </>
        )}
        {sow?.rev && !importing && (
          <p className="small">
            <strong>{sow.rev.revision}</strong> · {sow.lines.filter((l) => l.kind === 'item').length} lines · {money(sow.rev.total)}
            {job.contract_sum != null && Math.abs(Number(sow.rev.total) - Number(job.contract_sum)) > 0.01 && (
              <span className="late"> (contract sum is {money(job.contract_sum)})</span>
            )}{' '}
            · imported {ukDate(sow.rev.imported_at)} from {sow.rev.file_name}
          </p>
        )}
        {importing && (
          <SowImport
            onDone={() => {
              setImporting(false)
              reload()
            }}
            onCancel={() => setImporting(false)}
            hasApps={!!apps?.length}
          />
        )}
      </section>

      <section className="card">
        <div className="pane-head">
          <h2>Applications</h2>
          <button className="primary" onClick={newApplication} disabled={busy || !sow?.rev} title={sow?.rev ? '' : 'Import the SoW first'}>
            + New application
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {apps?.length === 0 && <p className="muted">No applications yet.</p>}
        {apps && apps.length > 0 && (
          <table className="table stack">
            <thead>
              <tr>
                <th>Application</th>
                <th>Valuation date</th>
                <th>Status</th>
                <th className="num">Client certified</th>
                <th className="num">Paid</th>
              </tr>
            </thead>
            <tbody>
              {[...apps].reverse().map((a) => (
                <tr key={a.id} className="clickable" onClick={() => navigate(a.id)}>
                  <td className="stack-title">
                    <strong>{appName(a)}</strong>
                  </td>
                  <td data-label="Valuation date">{ukDate(a.valuation_date)}</td>
                  <td data-label="Status">
                    <span className={`app-status ${a.status}`}>{APP_STATUS_LABELS[a.status]}</span>
                  </td>
                  <td className={`num ${a.client_certified == null ? 'stack-hide' : ''}`} data-label="Client certified">
                    {money(a.client_certified)}
                  </td>
                  <td className={`num ${a.paid_amount == null ? 'stack-hide' : ''}`} data-label="Paid">
                    {money(a.paid_amount)}
                    {a.paid_date && <span className="muted small"> {ukDate(a.paid_date)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

// Choose the Excel file, check what was read, then save it. The office SoW also updates the
// CVR budgets (its cost columns, by package) in the same step (Richard, 21 Nov).
function SowImport({ onDone, onCancel, hasApps }: { onDone: () => void; onCancel: () => void; hasApps: boolean }) {
  const { job, setJob } = useJob()
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedSow | null>(null)
  const [budget, setBudget] = useState<ParsedBudget | null>(null)
  const [kind, setKind] = useState<'client' | 'office'>('client')
  const [withApp, setWithApp] = useState(true)
  const [withBudget, setWithBudget] = useState(true)
  const [prevPaid, setPrevPaid] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function read(f: File) {
    setFile(f)
    setParsed(null)
    setBudget(null)
    setError(null)
    if (/office/i.test(f.name)) setKind('office')
    try {
      const data = await f.arrayBuffer()
      setParsed(await parseSow(data))
      // the cost columns, if it has them (a client SoW doesn't)
      setBudget(await parseBudget(data).catch(() => null))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function save() {
    if (!parsed || !file) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      const { rev, lines } = await importSow(job, parsed, file.name, kind)
      if (parsed.app_no && withApp) await createApplicationFromImport(job, rev.id, parsed, lines, Number(prevPaid || 0))
      if (kind === 'office' && budget && withBudget) {
        await importBudget(job, budget, file.name, await loadPackages(job.id))
        const r = await supabase.from('jobs').select('*').eq('id', job.id).single()
        if (!r.error) setJob(r.data as Job)
      }
      onDone()
    } catch (e) {
      setError(saveError(e))
      setBusy(false)
    }
  }

  const items = parsed?.lines.filter((l) => l.kind === 'item') ?? []
  const appTotal = items.filter((l) => !l.below_line).reduce((s, l) => s + (l.app_pct ?? 0) * (l.total ?? 0), 0)

  return (
    <div className="import-box">
      <label>
        Excel file
        <input type="file" accept=".xlsx,.xlsm" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
      </label>
      {error && <p className="error">{error}</p>}
      {parsed && (
        <>
          <ul className="check-list">
            <li>
              Sheet <strong>{parsed.sheet}</strong>, revision <strong>{parsed.revision}</strong>
            </li>
            <li>
              {parsed.lines.length - items.length} sections, {items.length} lines ({items.filter((l) => l.below_line).length} below the line, not counted)
            </li>
            <li>
              Total (excl. VAT) <strong>{money(parsed.total)}</strong>
              {parsed.stated_total != null && Math.abs(parsed.stated_total - parsed.total) > 0.01 && <span className="late"> · the sheet says {money(parsed.stated_total)}</span>}
              {job.contract_sum != null && Math.abs(Number(job.contract_sum) - parsed.total) > 0.01 && <span className="late"> · contract sum is {money(job.contract_sum)}</span>}
              {job.contract_sum != null && Math.abs(Number(job.contract_sum) - parsed.total) <= 0.01 && <span className="ok"> ✓ matches the contract sum</span>}
            </li>
          </ul>
          <label>
            This is the
            <select value={kind} onChange={(e) => setKind(e.target.value as 'client' | 'office')}>
              <option value="client">client SoW</option>
              <option value="office">office SoW</option>
            </select>
          </label>
          {kind === 'office' &&
            (budget ? (
              <label className="check">
                <span>
                  <input type="checkbox" checked={withBudget} onChange={(e) => setWithBudget(e.target.checked)} /> Also update the <strong>CVR budgets</strong> from it:{' '}
                  {budget.packages.length} packages, {money(budget.total)}
                  {budget.sow_total != null && Math.abs(budget.sow_total - budget.total) <= 0.01 && <span className="ok"> ✓ equals the SoW total</span>}
                  <span className="hint">Typed targets, notes, orders and supplier allocations on the CVR tab are kept.</span>
                </span>
              </label>
            ) : (
              <p className="muted small">No cost columns found in this file, so the CVR budgets aren't changed (import the office SoW with its cost columns for that).</p>
            ))}
          {parsed.app_no && !hasApps && (
            <div className="import-app">
              <label className="check">
                <span>
                  <input type="checkbox" checked={withApp} onChange={(e) => setWithApp(e.target.checked)} /> Also bring in <strong>Application {parsed.app_no}</strong>'s percentages
                  ({money(appTotal)} construction)
                </span>
              </label>
              {withApp && (
                <label>
                  Paid before Application {parsed.app_no} (£)
                  <input type="number" step="0.01" value={prevPaid} onChange={(e) => setPrevPaid(e.target.value)} />
                  <span className="hint">The front sheet's "Less previous paid". VO percentages aren't in this sheet: enter them on the application.</span>
                </label>
              )}
            </div>
          )}
        </>
      )}
      <div className="form-actions">
        <button className="primary" onClick={save} disabled={!parsed || busy}>
          {busy ? 'Importing…' : 'Import'}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
