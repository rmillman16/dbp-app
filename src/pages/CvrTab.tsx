import { Fragment, useEffect, useState } from 'react'
import { GROUP_LABELS, GROUP_ORDER, byGroupThenName, groupOf, type Group } from '../lib/cvrCalc'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, todayIso, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { parseBudget, type ParsedBudget } from '../lib/cvrBudget'
import { parseJobCosting, type ParsedCosts } from '../lib/cvrCosts'
import { addPackage, createCvr, importBudget, linkOrder, loadCvrs, loadPackages, savePackage } from '../lib/cvr'
import { loadCompanies, loadOrders } from '../lib/subcontracts'
import type { Cvr, CvrPackage, Job } from '../lib/types'
import { useJob } from './JobLayout'

const KIND_LABELS: Record<CvrPackage['kind'], string> = { cost: 'Cost', omit: 'Shown and omitted', ep: 'EP / contingency' }
const num = (v: string) => (v.trim() === '' ? null : Number(v))
const monthEnd = () => {
  const d = new Date()
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).toISOString().slice(0, 10)
}

// Job › CVR: the budgets (cost packages from the office SoW) and the monthly CVRs.
export default function CvrTab() {
  const { job, setJob } = useJob()
  const navigate = useNavigate()
  const [packages, setPackages] = useState<CvrPackage[] | null>(null)
  const [cvrs, setCvrs] = useState<Cvr[]>([])
  const [orders, setOrders] = useState<{ id: string; label: string; package_id: string | null }[]>([])
  const [importing, setImporting] = useState(false)
  const [newCvr, setNewCvr] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = () => {
    loadPackages(job.id).then(setPackages, (e: Error) => setError(e.message))
    loadCvrs(job.id).then(setCvrs, () => {})
    Promise.all([loadOrders(job.id), loadCompanies()]).then(
      ([os, cs]) => setOrders(os.map((o) => ({ id: o.id, package_id: o.package_id, label: `${cs.find((c) => c.id === o.company_id)?.name ?? 'Order'}${o.trade ? ` (${o.trade})` : ''} ${money(o.order_value)}` }))),
      () => {},
    )
  }
  useEffect(reload, [job]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshJob = async () => {
    const r = await supabase.from('jobs').select('*').eq('id', job.id).single()
    if (!r.error) setJob(r.data as Job)
  }

  return (
    <>
      <section className="card">
        <div className="pane-head">
          <h2>CVRs</h2>
          <button className="primary" onClick={() => setNewCvr(true)} disabled={!packages?.length} title={packages?.length ? '' : 'Import the budgets first'}>
            + New CVR
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {newCvr && (
          <NewCvr
            job={job}
            after={cvrs[cvrs.length - 1]?.period_end ?? null}
            onDone={(id) => navigate(id)}
            onCancel={() => setNewCvr(false)}
          />
        )}
        {cvrs.length === 0 && !newCvr && <p className="muted small">No CVRs yet. Each month: run the job costing report in iPlicit, save it as Excel, then + New CVR.</p>}
        {cvrs.length > 0 && (
          <table className="table stack">
            <thead>
              <tr>
                <th>Cost as at</th>
                <th>Status</th>
                <th className="num">Anticipated final value</th>
                <th className="num">Total cost</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {[...cvrs].reverse().map((c) => (
                <tr key={c.id} className="clickable" onClick={() => navigate(c.id)}>
                  <td className="stack-title">
                    <strong>{ukDate(c.period_end)}</strong>
                  </td>
                  <td data-label="Status">{c.status === 'final' ? 'Final' : 'Draft'}</td>
                  <td className="num" data-label="Anticipated final value">
                    {c.summary ? money(c.summary.value.afv) : '–'}
                  </td>
                  <td className="num" data-label="Total cost">
                    {c.summary ? money(c.summary.totalCost) : '–'}
                  </td>
                  <td className="num" data-label="Margin">
                    {c.summary ? `${money(c.summary.margin)} (${(c.summary.marginPct * 100).toFixed(1)}%)` : 'open it to see'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="pane-head">
          <h2>Budgets</h2>
          {!importing && <button onClick={() => setImporting(true)}>{packages?.length ? 'Import a new SoW revision' : 'Import the office SoW'}</button>}
        </div>
        {job.cvr_budget_file && !importing && (
          <p className="small">
            From <strong>{job.cvr_budget_file}</strong> · {money(job.cvr_budget_total)} · imported {ukDate(job.cvr_budget_imported_at)}
            {job.contract_sum != null && job.cvr_budget_total != null && Math.abs(Number(job.contract_sum) - Number(job.cvr_budget_total)) > 1 ? (
              <span className="late"> · contract sum is {money(job.contract_sum)}</span>
            ) : (
              job.contract_sum != null && <span className="ok"> ✓ matches the contract sum</span>
            )}
          </p>
        )}
        {importing && (
          <BudgetImport
            job={job}
            existing={packages ?? []}
            onDone={() => {
              setImporting(false)
              refreshJob()
              reload()
            }}
            onCancel={() => setImporting(false)}
          />
        )}
        {packages && packages.length === 0 && !importing && (
          <p className="muted small">
            The CVR's cost packages and budgets come from the office SoW (--sow--office, or a CVR breakdown tab). Import it once; import again when there's a new revision.
          </p>
        )}
        {packages && packages.length > 0 && <Packages job={job} packages={packages} orders={orders} onSaved={() => (reload(), refreshJob())} />}
      </section>
    </>
  )
}

function BudgetImport({ job, existing, onDone, onCancel }: { job: Job; existing: CvrPackage[]; onDone: () => void; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedBudget | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function read(f: File) {
    setFile(f)
    setParsed(null)
    setError(null)
    try {
      setParsed(await parseBudget(await f.arrayBuffer()))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function save() {
    if (!parsed || !file) return
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      await importBudget(job, parsed, file.name, existing)
      onDone()
    } catch (e) {
      setError(saveError(e))
      setBusy(false)
    }
  }

  const noCost = parsed?.queries.filter((q) => q.issue === 'no_cost') ?? []
  const notPriced = parsed?.queries.filter((q) => q.issue === 'not_priced') ?? []
  const ohp = parsed?.packages.filter((p) => p.kind === 'omit').reduce((s, p) => s + p.budget, 0) ?? 0
  return (
    <div className="import-box">
      <label>
        Office SoW (Excel)
        <input type="file" accept=".xlsx,.xlsm" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
      </label>
      {error && <p className="error">{error}</p>}
      {parsed && (
        <>
          <ul className="check-list">
            <li>
              Sheet <strong>{parsed.sheet}</strong> ({parsed.layout === 'micro' ? 'office SoW layout' : 'CVR breakdown layout'}), <strong>{parsed.packages.length}</strong> packages
            </li>
            <li>
              Packages total <strong>{money(parsed.total)}</strong>
              {parsed.sow_total != null && Math.abs(parsed.sow_total - parsed.total) <= 0.01 ? <span className="ok"> ✓ equals the SoW total</span> : <span className="late"> · SoW total {money(parsed.sow_total)}</span>}
              {job.contract_sum != null && Math.abs(Number(job.contract_sum) - parsed.total) > 1 && <span className="late"> · contract sum is {money(job.contract_sum)}</span>}
            </li>
            <li>
              Shown and omitted (OH&P{parsed.layout === 'breakdown' ? ', DuB management and design' : ''}): {money(ohp)} ({parsed.total ? ((ohp / parsed.total) * 100).toFixed(1) : 0}%)
            </li>
            {existing.length > 0 && <li>Budgets are updated by package name; typed targets, orders and supplier allocations are kept.</li>}
          </ul>
          {noCost.length > 0 && (
            <details className="warning">
              <summary>
                {noCost.length} priced lines have no cost build-up ({money(noCost.reduce((s, q) => s + Number(q.total), 0))}): they change the margin, not a package budget
              </summary>
              <QueryList rows={noCost} />
            </details>
          )}
          {notPriced.length > 0 && (
            <details className="warning">
              <summary>
                {notPriced.length} lines carry cost but aren't in the price (Client Direct, excluded, omitted, options): {money(notPriced.reduce((s, q) => s + q.cost, 0))} left out of the budgets
              </summary>
              <QueryList rows={notPriced} />
            </details>
          )}
          <table className="table stack">
            <thead>
              <tr>
                <th>Package</th>
                <th>Column</th>
                <th>Type</th>
                <th className="num">Budget</th>
              </tr>
            </thead>
            <tbody>
              {parsed.packages.map((p) => (
                <tr key={p.name}>
                  <td className="stack-title">
                    {p.name}
                    {p.supplier_note && <span className="muted small"> · {p.supplier_note}</span>}
                  </td>
                  <td data-label="Column">{p.sow_column}</td>
                  <td data-label="Type">{KIND_LABELS[p.kind]}</td>
                  <td className="num" data-label="Budget">
                    {money(p.budget)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="form-actions">
        <button className="primary" onClick={save} disabled={!parsed || busy}>
          {busy ? 'Importing…' : 'Use these budgets'}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function QueryList({ rows }: { rows: ParsedBudget['queries'] }) {
  return (
    <ul className="query-list">
      {rows.map((q, i) => (
        <li key={i}>
          <span className="muted">{q.ref}</span> {q.description} · <strong>{/^-?\d/.test(q.total) ? money(Number(q.total)) : q.total}</strong>
          {q.cost ? <span className="muted"> (cost {money(q.cost)})</span> : null}
        </li>
      ))}
    </ul>
  )
}

// Each package's type, typed target (with the reason) and the orders placed against it.
function Packages({ job, packages, orders, onSaved }: { job: Job; packages: CvrPackage[]; orders: { id: string; label: string; package_id: string | null }[]; onSaved: () => void }) {
  const [rows, setRows] = useState(packages)
  const [ep, setEp] = useState(String(job.cvr_ep_pct ?? 4))
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  useEffect(() => setRows(packages), [packages])
  const [newGroup, setNewGroup] = useState<Group>('subcontract')
  const changed = rows.filter((r) => {
    const o = packages.find((p) => p.id === r.id)!
    return (
      o.kind !== r.kind ||
      o.target !== r.target ||
      (o.target_note ?? '') !== (r.target_note ?? '') ||
      (o.supplier_note ?? '') !== (r.supplier_note ?? '') ||
      (o.cvr_group ?? null) !== (r.cvr_group ?? null)
    )
  })
  // grouped and alphabetical, as the CVR (by each package's saved group, so rows don't jump while editing)
  const sorted = [...rows].sort((a, b) => byGroupThenName({ group: groupOf(packages.find((p) => p.id === a.id)!), name: a.name }, { group: groupOf(packages.find((p) => p.id === b.id)!), name: b.name }))
  const set = (id: string, k: keyof CvrPackage, v: unknown) => setRows(rows.map((r) => (r.id === id ? { ...r, [k]: v } : r)))

  async function save() {
    setMsg(null)
    if (!navigator.onLine) return setMsg(saveError(new Error('offline')))
    const noReason = changed.find((r) => r.target != null && !r.target_note?.trim())
    if (noReason) return setMsg(`Say why ${noReason.name}'s target differs from its budget (e.g. "Logik order", "Prelims tab").`)
    setBusy(true)
    try {
      for (const r of changed) await savePackage(r)
      if (Number(ep) !== Number(job.cvr_ep_pct ?? 4)) {
        const u = await supabase.from('jobs').update({ cvr_ep_pct: Number(ep) }).eq('id', job.id)
        if (u.error) throw u.error
      }
      setMsg('Saved.')
      onSaved()
    } catch (e) {
      setMsg(saveError(e))
    }
    setBusy(false)
  }

  async function add() {
    if (!newName.trim()) return
    try {
      await addPackage(job, newName.trim(), Math.max(0, ...packages.map((p) => p.sort)) + 1, newGroup)
      setNewName('')
      onSaved()
    } catch (e) {
      setMsg(saveError(e))
    }
  }

  return (
    <>
      <p className="muted small">
        Each package's target is the typed target, else the orders linked to it (order value + instructed variations), else EP at {ep}% of the contract sum, else the
        SoW budget. A typed target needs a reason (as the Prelims tab).
      </p>
      <table className="table stack cvr-packages">
        <thead>
          <tr>
            <th>Package</th>
            <th>Group</th>
            <th>Type</th>
            <th className="num">SoW budget</th>
            <th>Target £ (blank = budget / order)</th>
            <th>Orders</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const mine = orders.filter((o) => o.package_id === p.id)
            const g = groupOf(packages.find((x) => x.id === p.id)!)
            const prev = i ? groupOf(packages.find((x) => x.id === sorted[i - 1].id)!) : null
            return (
              <Fragment key={p.id}>
              {g !== prev && (
                <tr className="group-head">
                  <td colSpan={6}>{GROUP_LABELS[g]}</td>
                </tr>
              )}
              <tr>
                <td className="stack-title">
                  <strong>{p.name}</strong>
                  {p.is_remainder && <div className="muted small">The prelims sections draw on this until you type their own targets.</div>}
                  <input className="inline-note" value={p.supplier_note ?? ''} placeholder="who it's with" onChange={(e) => set(p.id, 'supplier_note', e.target.value || null)} />
                </td>
                <td data-label="Group">
                  <select value={p.cvr_group ?? groupOf(p)} onChange={(e) => set(p.id, 'cvr_group', e.target.value)}>
                    {GROUP_ORDER.map((x) => (
                      <option key={x} value={x}>
                        {GROUP_LABELS[x]}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-label="Type">
                  <select value={p.kind} onChange={(e) => set(p.id, 'kind', e.target.value)}>
                    {(Object.keys(KIND_LABELS) as CvrPackage['kind'][]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num" data-label="SoW budget">
                  {money(p.budget)}
                </td>
                <td data-label="Target">
                  {p.kind === 'omit' ? (
                    <span className="muted">omitted</span>
                  ) : (
                    <span className="target-cell">
                      <input type="number" step="0.01" value={p.target ?? ''} onChange={(e) => set(p.id, 'target', num(e.target.value))} />
                      {p.target != null && <input value={p.target_note ?? ''} placeholder="why?" onChange={(e) => set(p.id, 'target_note', e.target.value || null)} />}
                    </span>
                  )}
                </td>
                <td data-label="Orders">
                  {mine.map((o) => (
                    <div key={o.id} className="small">
                      {o.label}{' '}
                      <button className="link-button small" onClick={() => linkOrder(o.id, null).then(onSaved, (e) => setMsg(saveError(e)))}>
                        unlink
                      </button>
                    </div>
                  ))}
                  {p.kind !== 'omit' && orders.some((o) => !o.package_id) && (
                    <select value="" onChange={(e) => e.target.value && linkOrder(e.target.value, p.id).then(onSaved, (x) => setMsg(saveError(x)))}>
                      <option value="">+ link an order</option>
                      {orders
                        .filter((o) => !o.package_id)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                    </select>
                  )}
                </td>
              </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
      <div className="form-grid three">
        <label>
          EP / contingency, % of contract sum
          <input type="number" step="0.5" value={ep} onChange={(e) => setEp(e.target.value)} />
        </label>
        <label className="span-2">
          Add a package
          <span className="target-cell">
            <select value={newGroup} onChange={(e) => setNewGroup(e.target.value as Group)} title="Group">
              {GROUP_ORDER.map((x) => (
                <option key={x} value={x}>
                  {GROUP_LABELS[x]}
                </option>
              ))}
            </select>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Unforeseen costs" />
            <button onClick={add} disabled={!newName.trim()}>
              Add
            </button>
          </span>
        </label>
      </div>
      {msg && <p className={msg === 'Saved.' ? 'saved' : 'error'}>{msg}</p>}
      <div className="form-actions">
        <button className="primary" onClick={save} disabled={busy || (!changed.length && Number(ep) === Number(job.cvr_ep_pct ?? 4))}>
          Save packages
        </button>
      </div>
    </>
  )
}

function NewCvr({ job, after, onDone, onCancel }: { job: Job; after: string | null; onDone: (id: string) => void; onCancel: () => void }) {
  const [periodEnd, setPeriodEnd] = useState(monthEnd())
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedCosts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function read(f: File) {
    setFile(f)
    setParsed(null)
    setError(null)
    try {
      const p = await parseJobCosting(await f.arrayBuffer())
      setParsed(p)
      if (p.report_date) setPeriodEnd(p.report_date)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function save() {
    if (!parsed || !file) return
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    if (after && periodEnd <= after) return setError(`The last CVR is as at ${ukDate(after)}: this one needs a later date.`)
    setBusy(true)
    try {
      onDone(await createCvr(job, parsed, file.name, periodEnd))
    } catch (e) {
      setError(saveError(e))
      setBusy(false)
    }
  }

  const projectOk = !parsed?.project || parsed.project.replace(/\s/g, '').toLowerCase().includes(String(job.job_no))
  return (
    <div className="import-box">
      <div className="form-grid">
        <label>
          iPlicit job costing report (Excel)
          <input type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        </label>
        <label>
          Cost as at
          <input type="date" value={periodEnd} max={todayIso()} onChange={(e) => setPeriodEnd(e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {parsed && (
        <ul className="check-list">
          <li>
            Project <strong>{parsed.project ?? '?'}</strong>
            {!projectOk && <span className="late"> · this doesn't look like job {job.job_no}</span>}
            {parsed.report_date && <> · prepared {ukDate(parsed.report_date)}</>}
          </li>
          <li>
            {parsed.lines.length} suppliers · Final Total Costs <strong>{money(parsed.total)}</strong>
            {parsed.stated_total != null && <span className={Math.abs(parsed.stated_total - parsed.total) <= Math.max(2, parsed.lines.length) ? 'ok' : 'late'}> (report total {money(parsed.stated_total)})</span>}
          </li>
          {parsed.checks.map((c) => (
            <li key={c} className="late">
              {c}
            </li>
          ))}
        </ul>
      )}
      <div className="form-actions">
        <button className="primary" onClick={save} disabled={!parsed || busy}>
          {busy ? 'Creating…' : 'Create CVR'}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
