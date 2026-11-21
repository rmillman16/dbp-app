// The job's schedule of works, in one place (Richard, 21 Nov): imported on the Overview (or from
// any of the tabs that use it) and used everywhere: Valuations (the priced lines), the CVR and the
// Cashflow (the office SoW's cost columns, by package). Swapping it on any tab updates them all.
// A client SoW (no cost columns) updates Valuations only; a CVR breakdown tab (KOSH layout, no
// priced lines) updates the CVR and Cashflow only.
import { useEffect, useState } from 'react'
import { money, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { supabase } from '../lib/supabase'
import { parseSow, type ParsedSow } from '../lib/sowImport'
import { parseBudget, type ParsedBudget } from '../lib/cvrBudget'
import { importBudget, loadPackages } from '../lib/cvr'
import { createApplicationFromImport, importSow, loadApplications, loadCurrentSow } from '../lib/applications'
import type { Job, SowLine, SowRevision } from '../lib/types'
import { useJob } from '../pages/JobLayout'

export default function JobSowCard({ onChanged, note, className = '' }: { onChanged?: () => void; note?: string; className?: string }) {
  const { job, setJob } = useJob()
  const [sow, setSow] = useState<{ rev: SowRevision | null; lines: SowLine[] } | null>(null)
  const [hasApps, setHasApps] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = () => {
    loadCurrentSow(job.id).then(setSow, (e: Error) => setError(e.message))
    loadApplications(job.id).then(
      (a) => setHasApps(a.length > 0),
      () => setHasApps(false),
    )
  }
  useEffect(reload, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const done = async () => {
    setImporting(false)
    const r = await supabase.from('jobs').select('*').eq('id', job.id).single()
    if (!r.error) setJob(r.data as Job)
    reload()
    onChanged?.()
  }

  const rev = sow?.rev
  const items = sow?.lines.filter((l) => l.kind === 'item').length ?? 0
  // the two halves came from different files: say so (it usually means one wasn't re-imported)
  const differ = rev?.file_name && job.cvr_budget_file && rev.file_name !== job.cvr_budget_file
  return (
    <section className={`card ${className}`}>
      <div className="pane-head">
        <h2>Schedule of works</h2>
        {!importing && (
          <button className={rev || job.cvr_budget_file ? '' : 'primary'} onClick={() => setImporting(true)}>
            {rev || job.cvr_budget_file ? 'Swap the SoW…' : 'Import the SoW…'}
          </button>
        )}
      </div>
      <p className="muted small">
        {note ??
          'One SoW for the whole job: Valuations use its priced lines; the CVR and Cashflow use the office SoW’s cost columns. Swapping it here or on any of those tabs updates them all.'}
      </p>
      {error && <p className="error">{error}</p>}
      {!importing && (
        <dl className="details sow-status">
          <dt>Valuations</dt>
          <dd>
            {rev ? (
              <>
                <strong>{rev.revision}</strong> · {items} lines · {money(rev.total)} · {rev.file_name}, {ukDate(rev.imported_at)}
                {job.contract_sum != null && Math.abs(Number(rev.total) - Number(job.contract_sum)) > 0.01 && (
                  <span className="late"> (contract sum {money(job.contract_sum)})</span>
                )}
              </>
            ) : (
              <span className="muted">not imported yet</span>
            )}
          </dd>
          <dt>CVR and Cashflow</dt>
          <dd>
            {job.cvr_budget_file ? (
              <>
                {money(job.cvr_budget_total)} · {job.cvr_budget_file}, {ukDate(job.cvr_budget_imported_at)}
              </>
            ) : (
              <span className="muted">not yet: needs the office SoW (with its cost columns)</span>
            )}
          </dd>
        </dl>
      )}
      {!importing && differ && <p className="warning">Valuations and the CVR / Cashflow are from different files. Import the current office SoW to bring them together.</p>}
      {importing && <SowImport hasApps={hasApps} onDone={done} onCancel={() => setImporting(false)} />}
    </section>
  )
}

// Choose the Excel file, check what was read from each side, then save.
function SowImport({ onDone, onCancel, hasApps }: { onDone: () => void; onCancel: () => void; hasApps: boolean }) {
  const { job } = useJob()
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedSow | null>(null)
  const [sowError, setSowError] = useState<string | null>(null)
  const [budget, setBudget] = useState<ParsedBudget | null>(null)
  const [kind, setKind] = useState<'client' | 'office'>('client')
  const [withApp, setWithApp] = useState(true)
  const [withBudget, setWithBudget] = useState(true)
  const [prevPaid, setPrevPaid] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)

  async function read(f: File) {
    setFile(f)
    setParsed(null)
    setBudget(null)
    setError(null)
    setSowError(null)
    setReading(true)
    try {
      const data = await f.arrayBuffer()
      // the priced lines (Valuations) and the cost columns (CVR, Cashflow), each if it has them
      const [s, b] = await Promise.allSettled([parseSow(data), parseBudget(data)])
      if (s.status === 'fulfilled') setParsed(s.value)
      else setSowError((s.reason as Error).message)
      if (b.status === 'fulfilled') setBudget(b.value)
      setKind(b.status === 'fulfilled' || /office/i.test(f.name) ? 'office' : 'client')
      if (s.status === 'rejected' && b.status === 'rejected') setError((s.reason as Error).message)
    } finally {
      setReading(false)
    }
  }

  async function save() {
    if (!file || (!parsed && !budget)) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      if (parsed) {
        const { rev, lines } = await importSow(job, parsed, file.name, kind)
        if (parsed.app_no && withApp && !hasApps) await createApplicationFromImport(job, rev.id, parsed, lines, Number(prevPaid || 0))
      }
      if (budget && withBudget) await importBudget(job, budget, file.name, await loadPackages(job.id))
      onDone()
    } catch (e) {
      setError(saveError(e))
      setBusy(false)
    }
  }

  const items = parsed?.lines.filter((l) => l.kind === 'item') ?? []
  const appTotal = items.filter((l) => !l.below_line).reduce((s, l) => s + (l.app_pct ?? 0) * (l.total ?? 0), 0)
  const noCost = budget?.queries.filter((q) => q.issue === 'no_cost') ?? []
  const notPriced = budget?.queries.filter((q) => q.issue === 'not_priced') ?? []

  return (
    <div className="import-box">
      <label>
        Excel file (the office SoW, a client SoW, an application workbook, or a CVR breakdown tab)
        <input type="file" accept=".xlsx,.xlsm" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
      </label>
      {reading && <p className="muted small">Reading…</p>}
      {error && <p className="error">{error}</p>}
      {(parsed || budget) && (
        <ul className="check-list">
          <li>
            <strong>Valuations:</strong>{' '}
            {parsed ? (
              <>
                sheet {parsed.sheet}, revision {parsed.revision}, {items.length} lines, total <strong>{money(parsed.total)}</strong>
                {parsed.stated_total != null && Math.abs(parsed.stated_total - parsed.total) > 0.01 && <span className="late"> · the sheet says {money(parsed.stated_total)}</span>}
                {job.contract_sum != null && Math.abs(Number(job.contract_sum) - parsed.total) <= 0.01 && <span className="ok"> ✓ matches the contract sum</span>}
                {job.contract_sum != null && Math.abs(Number(job.contract_sum) - parsed.total) > 0.01 && <span className="late"> · contract sum is {money(job.contract_sum)}</span>}
              </>
            ) : (
              <span className="muted">not changed: no priced SoW lines in this file ({sowError})</span>
            )}
          </li>
          <li>
            <strong>CVR and Cashflow:</strong>{' '}
            {budget ? (
              <label className="check inline">
                <input type="checkbox" checked={withBudget} onChange={(e) => setWithBudget(e.target.checked)} /> update from its cost columns: {budget.packages.length} packages,{' '}
                {money(budget.total)}
                {budget.sow_total != null && Math.abs(budget.sow_total - budget.total) <= 0.01 && <span className="ok"> ✓ equals the SoW total</span>}
                <span className="hint">Typed targets, notes, orders, supplier allocations and cashflow weightings are kept.</span>
              </label>
            ) : (
              <span className="muted">not changed: no cost columns in this file (a client SoW). Import the office SoW for the CVR and Cashflow.</span>
            )}
          </li>
        </ul>
      )}
      {parsed && (
        <label>
          This is the
          <select value={kind} onChange={(e) => setKind(e.target.value as 'client' | 'office')}>
            <option value="client">client SoW</option>
            <option value="office">office SoW</option>
          </select>
        </label>
      )}
      {budget && withBudget && noCost.length + notPriced.length > 0 && (
        <details className="warning">
          <summary>
            Checks on the cost columns: {noCost.length} priced lines with no cost build-up, {notPriced.length} lines with cost that aren't in the price
          </summary>
          <ul className="query-list">
            {[...noCost, ...notPriced].map((q, i) => (
              <li key={i}>
                <span className="muted">{q.ref}</span> {q.description} · <strong>{/^-?\d/.test(q.total) ? money(Number(q.total)) : q.total}</strong>
                {q.cost ? <span className="muted"> (cost {money(q.cost)})</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
      {parsed?.app_no && !hasApps && (
        <div className="import-app">
          <label className="check">
            <span>
              <input type="checkbox" checked={withApp} onChange={(e) => setWithApp(e.target.checked)} /> Also bring in <strong>Application {parsed.app_no}</strong>'s percentages (
              {money(appTotal)} construction)
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
      <div className="form-actions">
        <button className="primary" onClick={save} disabled={(!parsed && !budget) || busy || reading}>
          {busy ? 'Importing…' : 'Import'}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
