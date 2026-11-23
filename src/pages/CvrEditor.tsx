import { MoneyText } from '../components/MoneyInput'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { parseJobCosting } from '../lib/cvrCosts'
import { parseBudget } from '../lib/cvrBudget'
import { type Split, addPackage, computeCvr, countBudgetLines, finaliseCvr, importBudget, linkVo, loadBudgetLines, loadContext, loadCvr, loadCvrs, reopenCvr, replaceCosts, saveAllocation, saveCvr, saveForecast, supplierKey, type CvrContext, type SavedCostLine } from '../lib/cvr'
import { GROUP_LABELS, GROUP_ORDER, byGroupThenName, groupOf, type CvrResult, type Forecast, type Group } from '../lib/cvrCalc'

type PkgOption = { id: string; name: string; group: Group }

// the package list, in groups and alphabetical within each
function PackageOptions({ packages }: { packages: PkgOption[] }) {
  return (
    <>
      {GROUP_ORDER.map((g) => {
        const mine = packages.filter((p) => p.group === g)
        return mine.length ? (
          <optgroup key={g} label={GROUP_LABELS[g]}>
            {mine.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        ) : null
      })}
    </>
  )
}
import type { Cvr } from '../lib/types'
import { useJob } from './JobLayout'

const pct = (n: number) => `${(n * 100).toFixed(2)}%`
const signed = (n: number | null) => (n == null ? '–' : `${n > 0 ? '+' : ''}${money(n)}`)
const num = (v: string) => (v.trim() === '' ? null : Number(v))

export default function CvrEditor() {
  const { job } = useJob()
  const { cvrId } = useParams()
  const navigate = useNavigate()
  const [cvr, setCvr] = useState<Cvr | null>(null)
  const [costs, setCosts] = useState<SavedCostLine[]>([])
  const [file, setFile] = useState<string | null>(null)
  const [forecasts, setForecasts] = useState<Forecast[]>([])
  const [ctx, setCtx] = useState<CvrContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [lineCount, setLineCount] = useState<number | null>(null)

  const reload = async () => {
    try {
      const d = await loadCvr(cvrId!)
      setCvr(d.cvr)
      setCosts(d.costs)
      setFile(d.imp?.file_name ?? null)
      setForecasts(d.forecasts)
      setCtx(await loadContext(job, d.cvr, d.costs, d.forecasts))
      countBudgetLines(job.id).then(setLineCount, () => setLineCount(null))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    reload()
  }, [cvrId, job]) // eslint-disable-line react-hooks/exhaustive-deps

  const final = cvr?.status === 'final'
  // live while a draft; as issued once final
  const result: CvrResult | null = useMemo(() => {
    if (!cvr || !ctx) return null
    if (final && cvr.summary) return cvr.summary
    return computeCvr({ ...ctx.input, forecasts, possibleReduction: Number(cvr.possible_reduction ?? 0) })
  }, [cvr, ctx, forecasts, final])

  if (error && !cvr) return <p className="error">{error}</p>
  if (!cvr || !ctx || !result) return <p className="muted">Loading…</p>

  const run = async (f: () => Promise<unknown>, done?: string) => {
    setError(null)
    setMsg(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    try {
      await f()
      if (done) setMsg(done)
      await reload()
    } catch (e) {
      setError(saveError(e))
    }
  }
  // allocation changes recompute straight away without reloading everything
  const allocate = (code: string, name: string, split: Split) =>
    run(async () => {
      await saveAllocation(job.id, code, name, split)
      setCtx({
        ...ctx,
        input: {
          ...ctx.input,
          allocations: [
            ...ctx.input.allocations.filter((a) => supplierKey(a) !== supplierKey({ supplier_code: code, supplier_name: name })),
            ...split.map((s) => ({ supplier_code: code, supplier_name: name, ...s })),
          ],
        },
      })
    })

  async function exportExcel() {
    setError(null)
    try {
      const { exportCvr } = await import('../lib/exportCvr')
      const [lines, cvrs] = await Promise.all([loadBudgetLines(job.id), loadCvrs(job.id)])
      // the breakdown sheet lists the SoW's items, saved when the office SoW is imported (script 018)
      if (!lines.length)
        return setError("The office SoW's items aren't saved for this job yet, so the second sheet would be empty. Use “Choose the office SoW…” just below, then click Excel again.")
      const previous = cvrs.filter((c) => c.period_end < cvr!.period_end).pop()
      await exportCvr(job, cvr!, result!, costs, { packages: ctx!.packages, lines, previousDate: previous?.period_end ?? null })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // the office SoW again, to save its items for the breakdown sheet (jobs imported before script 018)
  async function importSow(f: File) {
    setError(null)
    try {
      const p = await parseBudget(await f.arrayBuffer())
      if (!confirm(`Save the ${p.lines.length} lines of ${f.name} (${money(p.total)}) for the breakdown sheet? Budgets are updated from it; targets, notes and allocations are kept.`)) return
      await run(() => importBudget(job, p, f.name, ctx!.packages), `${p.lines.length} SoW lines saved. Click Excel to export.`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function replaceReport(f: File) {
    try {
      const p = await parseJobCosting(await f.arrayBuffer())
      if (!confirm(`Replace this CVR's costs with ${f.name} (${p.lines.length} suppliers, ${money(p.total)})? Allocations are kept.`)) return
      await run(() => replaceCosts(job, cvr!, p, f.name), 'Report replaced.')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function finalise() {
    const unallocated = result!.unallocatedCost
    if (unallocated && !confirm(`${money(unallocated)} of cost isn't allocated to a package yet. Finalise anyway?`)) return
    if (!confirm('Finalise this CVR? Its figures are kept as they are now (reopen it to change them).')) return
    run(() => finaliseCvr(cvr!.id, result!), 'Finalised.')
  }

  async function remove() {
    if (!confirm(`Delete the CVR as at ${ukDate(cvr!.period_end)}?`)) return
    const r = await supabase.from('cvrs').delete().eq('id', cvr!.id)
    if (r.error) return setError(saveError(r.error))
    if (cvr!.cost_import_id) await supabase.from('cost_imports').delete().eq('id', cvr!.cost_import_id)
    navigate('..', { relative: 'path' })
  }

  // "Drylining – Logik Ceilings Ltd": the subbie from its linked orders, else the note on the package
  const subbieOf = (id: string, note: string | null) => {
    const ordered = ctx.orders.filter((o) => o.package_id === id).map((o) => o.label.replace(/\s*\(.*\)$/, ''))
    if (ordered.length) return ordered.join(', ')
    return note && !/^(tbc|n\/a|0|dub|multiple|see\b.*)$/i.test(note.trim()) ? note.trim() : ''
  }
  // OH&P isn't somewhere a cost can go; omitted prelims items (DuB management, design) are
  const pkgOptions: PkgOption[] = ctx.packages
    .filter((p) => p.kind !== 'omit' || groupOf(p) === 'prelims')
    .map((p) => {
      const who = subbieOf(p.id, p.supplier_note)
      return { id: p.id, name: `${p.name}${who ? ` – ${who}` : ''}${p.kind === 'omit' ? ' (omitted)' : ''}`, group: groupOf(p) }
    })
    .sort(byGroupThenName)
  // a bespoke package added from the dropdown; returns its id so the cost can go straight to it
  const addBespoke = async (name: string, group: Group) => {
    if (!navigator.onLine) throw new Error(saveError(new Error('offline')))
    const p = await addPackage(job, name, Math.max(0, ...ctx.packages.map((x) => x.sort)) + 1, group)
    setCtx({ ...ctx, packages: [...ctx.packages, p], input: { ...ctx.input, packages: [...ctx.input.packages, { ...p, budget: 0, target: null }] } })
    return p.id
  }
  return (
    <>
      <div className="pane-head">
        <div>
          <Link to=".." relative="path" className="link-button small">
            ← CVRs
          </Link>
          <h2>
            CVR · cost as at {ukDate(cvr.period_end)} <span className={`app-status ${final ? 'paid' : 'draft'}`}>{final ? 'Final' : 'Draft'}</span>
          </h2>
          <p className="muted small">
            {file ?? 'No report'} · prepared {ukDate(cvr.prepared_date)}
          </p>
        </div>
        <div className="form-actions">
          <button className="primary" onClick={exportExcel}>
            Excel
          </button>
          {!final && <button onClick={finalise}>Finalise</button>}
          {final && <button onClick={() => confirm('Reopen this CVR? It will be recalculated from the current budgets, orders and VOs.') && run(() => reopenCvr(cvr.id), 'Reopened.')}>Reopen</button>}
          {!final && (
            <label className="file-button">
              <input type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => (e.target.files?.[0] && replaceReport(e.target.files[0]), (e.target.value = ''))} />
              <span className="button">Replace report…</span>
            </label>
          )}
          {!final && (
            <button className="danger" onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </div>
      {lineCount === 0 && (
        <div className="warning">
          <p>
            <strong>The Excel's second sheet needs the office SoW's items</strong> (each item with its cost and OH&P split out). They're saved when the office SoW is imported, and
            this job's were imported before that was added. Choose the office SoW once (the same file as before); budgets, targets and allocations stay as they are.
          </p>
          <label className="file-button">
            <input type="file" accept=".xlsx,.xlsm" onChange={(e) => (e.target.files?.[0] && importSow(e.target.files[0]), (e.target.value = ''))} />
            <span className="button primary">Choose the office SoW…</span>
          </label>
        </div>
      )}
      {lineCount != null && lineCount > 0 && <p className="muted small">Office SoW: {lineCount} lines saved for the Excel's breakdown sheet.</p>}
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      {result.warnings.length > 0 && (
        <ul className="warning clause-warnings">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <section className="card">
        <div className="stat-row">
          <Stat label="Anticipated final value" value={money(result.value.afv)} />
          <Stat label="Total cost (forecast)" value={money(result.totalCost)} />
          <Stat label="Gross margin" value={`${money(result.margin)}`} sub={`${pct(result.marginPct)} on sales`} bad={result.margin < 0} />
          <Stat label="Tender OH&P" value={money(result.tender.ohp)} sub={pct(result.tender.ohpPct)} />
          <Stat label="Cost to date (iPlicit)" value={money(result.jcTotal)} sub={result.movement != null ? `${signed(result.movement)} this month` : 'first CVR'} />
          {result.certified && <Stat label="Gross certified" value={money(result.certified.gross)} sub={result.certified.label} />}
        </div>
      </section>

      <section className="card">
        <h3>Packages</h3>
        <p className="muted small">Forecast = the larger of target and cost to date, unless you type one (with the reason). Overspends show in red.</p>
        <table className="table stack cvr-table">
          <thead>
            <tr>
              <th>Package</th>
              <th className="num">Target</th>
              <th className="num">Cost to date</th>
              <th className="num">Forecast</th>
              <th className="num">Still to come</th>
              <th className="num">Over target</th>
            </tr>
          </thead>
          <tbody>
            {result.packages.map((p, i) => (
              <Fragment key={p.id}>
              {/* CVRs finalised before groups existed have none: they show as one list */}
              {p.group && p.group !== result.packages[i - 1]?.group && (
                <tr className="group-head">
                  <td colSpan={6}>{GROUP_LABELS[p.group]}</td>
                </tr>
              )}
              <tr className={p.overrun ? 'overrun' : p.kind === 'omit' ? 'omitted' : ''}>
                <td className="stack-title">
                  <strong>{p.name}</strong>
                  <div className="muted small">
                    {p.sourceNote}
                    {p.voCost ? ` + ${money(p.voCost)} agreed VOs` : ''}
                    {p.suppliers.length > 0 && ` · ${p.suppliers.join(', ')}`}
                  </div>
                </td>
                <td className="num" data-label="Target">
                  {p.kind === 'omit' ? <span className="muted">{money(p.budget)} omitted</span> : money(p.target)}
                </td>
                <td className="num" data-label="Cost to date">
                  {money(p.cost)}
                </td>
                <td className="num" data-label="Forecast">
                  {final || p.kind === 'omit' ? (
                    <>
                      {money(p.forecast)}
                      {p.forecastNote && <div className="muted small">{p.forecastNote}</div>}
                    </>
                  ) : (
                    <ForecastInput
                      value={p.forecastTyped ? p.forecast : null}
                      note={p.forecastNote}
                      auto={p.forecast}
                      onSave={(f, note) =>
                        run(async () => {
                          await saveForecast(cvr.id, p.id, f, note)
                          setForecasts([...forecasts.filter((x) => x.package_id !== p.id), ...(f == null ? [] : [{ package_id: p.id, forecast: f, note }])])
                        })
                      }
                    />
                  )}
                </td>
                <td className="num" data-label="Still to come">
                  {money(p.stillToCome)}
                </td>
                <td className={`num ${p.overrun ? 'late' : 'stack-hide'}`} data-label="Over target">
                  {p.overrun ? money(p.overrun) : ''}
                </td>
              </tr>
              </Fragment>
            ))}
            {result.unallocatedVos.map((v) => (
              <tr key={v.label} className="overrun">
                <td className="stack-title">
                  {v.label} <span className="muted small">(agreed VO, no package)</span>
                </td>
                <td className="num" data-label="Target">
                  {money(v.cost)}
                </td>
                <td className="num" data-label="Cost to date">
                  –
                </td>
                <td className="num" data-label="Forecast">
                  {money(v.cost)}
                </td>
                <td className="num" data-label="Still to come">
                  {money(v.cost)}
                </td>
                <td className="stack-hide" />
              </tr>
            ))}
            {result.unallocatedCost !== 0 && (
              <tr className="overrun">
                <td className="stack-title">Costs not yet allocated to a package</td>
                <td className="num" data-label="Target">
                  –
                </td>
                <td className="num" data-label="Cost to date">
                  {money(result.unallocatedCost)}
                </td>
                <td className="num" data-label="Forecast">
                  {money(result.unallocatedCost)}
                </td>
                <td className="num" data-label="Still to come">
                  {money(0)}
                </td>
                <td className="stack-hide" />
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="totals">
              <td>Total</td>
              <td className="num" data-label="Target">
                {money(result.totals.target)}
              </td>
              <td className="num" data-label="Cost to date">
                {money(result.jcTotal)}
              </td>
              <td className="num" data-label="Forecast">
                {money(result.totalCost)}
              </td>
              <td className="num" data-label="Still to come">
                {money(result.totalCost - result.jcTotal)}
              </td>
              <td className={`num ${result.totals.overrun ? 'late' : ''}`} data-label="Over target">
                {result.totals.overrun ? money(result.totals.overrun) : ''}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="card">
        <h3>Costs from iPlicit</h3>
        <p className="muted small">
          Allocate each supplier to the package its costs belong to (remembered for the job). Use "split" when one supplier covers more than one package. Movement is
          this month less last month's CVR.
        </p>
        <table className="table stack cvr-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th className="num">Final total costs</th>
              <th className="num">Movement</th>
              <th>Package</th>
            </tr>
          </thead>
          <tbody>
            {result.suppliers.map((s) => (
              <tr key={s.key} className={s.unallocated && s.total ? 'overrun' : ''}>
                <td className="stack-title">
                  <span className="muted">{s.code}</span> {s.name}
                </td>
                <td className="num" data-label="Final total costs">
                  {money(s.total)}
                </td>
                <td className={`num ${s.movement == null ? 'stack-hide' : ''}`} data-label="Movement">
                  {signed(s.movement)}
                </td>
                <td data-label="Package">
                  {final ? (
                    s.packages.map((p) => `${p.name}${p.amount != null && s.packages.length > 1 ? ` ${money(p.amount)}` : p.share < 1 ? ` ${Math.round(p.share * 100)}%` : ''}`).join(', ') || <span className="late">not allocated</span>
                  ) : (
                    <Allocate packages={pkgOptions} current={s.packages} total={s.total} onSave={(split) => allocate(s.code, s.name, split)} onAdd={addBespoke} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Variations</h3>
        <p className="muted small">Only agreed VOs count (value in the final account, cost in a package's target). Give each agreed VO the package its cost belongs to.</p>
        {ctx.vos.length === 0 && <p className="muted">No VOs on this job.</p>}
        {ctx.vos.length > 0 && (
          <table className="table stack">
            <thead>
              <tr>
                <th>VO</th>
                <th className="num">Value</th>
                <th className="num">Cost (before OH&P)</th>
                <th>Package</th>
              </tr>
            </thead>
            <tbody>
              {ctx.vos.map((v) => (
                <tr key={v.id} className={v.status === 'agreed' ? '' : 'omitted'}>
                  <td className="stack-title">
                    {v.label} {v.status !== 'agreed' && <span className="muted small">(not agreed, not counted)</span>}
                  </td>
                  <td className="num" data-label="Value">
                    {money(v.value)}
                  </td>
                  <td className="num" data-label="Cost">
                    {money(v.cost)}
                  </td>
                  <td data-label="Package">
                    {v.status === 'agreed' && !final ? (
                      <select value={v.package_id ?? ''} onChange={(e) => run(() => linkVo(v.id, e.target.value || null))}>
                        <option value="">Package</option>
                        <PackageOptions packages={pkgOptions} />
                      </select>
                    ) : (
                      ctx.packages.find((p) => p.id === v.package_id)?.name ?? '–'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="two-col">
        <section className="card">
          <h3>Value and margin</h3>
          <dl className="details sums">
            <dt>SoW total</dt>
            <dd>{money(result.value.contractSum)}</dd>
            <dt>Agreed variations</dt>
            <dd>{money(result.value.agreedVos)}</dd>
            <dt>Possible reduction / negotiations</dt>
            <dd>
              {final ? (
                money(result.value.possibleReduction)
              ) : (
                <input
                  type="number"
                  step="0.01"
                  defaultValue={cvr.possible_reduction || ''}
                  placeholder="0 (minus for a reduction)"
                  onBlur={(e) => {
                    const v = Number(e.target.value || 0)
                    if (v !== Number(cvr.possible_reduction)) run(() => saveCvr({ ...cvr, possible_reduction: v }))
                  }}
                />
              )}
            </dd>
            <dt>
              <strong>Anticipated final value</strong>
            </dt>
            <dd>
              <strong>{money(result.value.afv)}</strong>
            </dd>
            <dt>Total cost</dt>
            <dd>{money(result.totalCost)}</dd>
            <dt>
              <strong>Gross margin</strong>
            </dt>
            <dd className={result.margin < 0 ? 'late' : ''}>
              <strong>
                {money(result.margin)} ({pct(result.marginPct)})
              </strong>
            </dd>
          </dl>
        </section>
        <section className="card">
          <h3>Programme and certified</h3>
          <dl className="details sums">
            <dt>Start on site</dt>
            <dd>{ukDate(result.programme.start) || '–'}</dd>
            <dt>Original PC</dt>
            <dd>{ukDate(result.programme.originalPc) || '–'}</dd>
            <dt>Original duration</dt>
            <dd>{result.programme.originalWeeks != null ? `${result.programme.originalWeeks} weeks` : '–'}</dd>
            <dt>PC date (with EOT granted)</dt>
            <dd>{ukDate(result.programme.revisedPc) || '–'}</dd>
            <dt>Weeks delay</dt>
            <dd>{result.programme.weeksDelay ?? '–'}</dd>
            <dt>Gross certified to date</dt>
            <dd>{result.certified ? money(result.certified.gross) : <span className="muted">no assessed application</span>}</dd>
            <dt>Retention held</dt>
            <dd>{result.certified ? money(result.certified.retention) : '–'}</dd>
          </dl>
        </section>
      </div>

      <section className="card">
        <h3>Notes</h3>
        <textarea
          rows={3}
          defaultValue={cvr.notes ?? ''}
          disabled={final}
          onBlur={(e) => (e.target.value || null) !== cvr.notes && run(() => saveCvr({ ...cvr, notes: e.target.value || null }))}
        />
      </section>
    </>
  )
}

function Stat({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <strong className={bad ? 'late' : ''}>{value}</strong>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  )
}

// a typed forecast (with its reason); blank = automatic
function ForecastInput({ value, note, auto, onSave }: { value: number | null; note: string | null; auto: number; onSave: (f: number | null, note: string | null) => void }) {
  const [v, setV] = useState(value == null ? '' : String(value))
  const [n, setN] = useState(note ?? '')
  const dirty = (num(v) ?? null) !== value || (n || null) !== (note || null)
  return (
    <span className="forecast-cell">
      <MoneyText value={v} placeholder={money(auto)} onChange={setV} />
      {v.trim() !== '' && <input value={n} placeholder="why?" onChange={(e) => setN(e.target.value)} />}
      {dirty && (
        <button
          className="small-button"
          onClick={() => {
            if (v.trim() !== '' && !n.trim()) return alert('Say why the forecast differs (e.g. "final account agreed £…").')
            onSave(num(v), v.trim() === '' ? null : n.trim())
          }}
        >
          Save
        </button>
      )}
    </span>
  )
}

const ADD = '__add__'

// one package, or a split by % or £; "+ Add a package…" makes a bespoke one
function Allocate({
  packages,
  current,
  total,
  onSave,
  onAdd,
}: {
  packages: PkgOption[]
  current: { id: string; share: number; amount?: number | null }[]
  total: number // the supplier's cost this month (a £ split must add up to it)
  onSave: (split: Split) => void
  onAdd: (name: string, group: Group) => Promise<string>
}) {
  const [splitting, setSplitting] = useState(current.length > 1)
  // split by % or by £ (agreed 20 Nov); val is the % or the £ for each row
  const [mode, setMode] = useState<'pct' | 'gbp'>(current.some((c) => c.amount != null) ? 'gbp' : 'pct')
  const [rows, setRows] = useState(
    current.length
      ? current.map((c) => ({ id: c.id, val: c.amount != null ? String(c.amount) : String(Math.round(c.share * 10000) / 100) }))
      : [{ id: '', val: '100' }],
  )
  const [adding, setAdding] = useState<number | null>(null) // which row is adding (0 when not splitting)
  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState<Group>('subcontract')
  const [addError, setAddError] = useState<string | null>(null)

  async function add() {
    if (!newName.trim()) return
    setAddError(null)
    try {
      const id = await onAdd(newName.trim(), newGroup)
      if (splitting) setRows(rows.map((x, j) => (j === adding ? { ...x, id } : x)))
      else onSave([{ package_id: id, share: 1 }])
      setAdding(null)
      setNewName('')
    } catch (e) {
      setAddError((e as Error).message)
    }
  }
  const options = (
    <>
      <PackageOptions packages={packages} />
      <option value={ADD}>+ Add a package…</option>
    </>
  )
  const addBox = (
    <span className="target-cell">
      <select value={newGroup} onChange={(e) => setNewGroup(e.target.value as Group)} title="Group">
        {GROUP_ORDER.map((g) => (
          <option key={g} value={g}>
            {GROUP_LABELS[g]}
          </option>
        ))}
      </select>
      <input autoFocus value={newName} placeholder="New package, e.g. Feature staircase" onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
      <button className="small-button" onClick={add} disabled={!newName.trim()}>
        Add
      </button>
      <button className="link-button small" onClick={() => (setAdding(null), setNewName(''))}>
        cancel
      </button>
      {addError && <span className="late small">{addError}</span>}
    </span>
  )

  if (!splitting)
    return adding != null ? (
      addBox
    ) : (
      <span className="target-cell">
        <select
          value={current[0]?.id ?? ''}
          className={current.length ? '' : 'unallocated'}
          onChange={(e) => (e.target.value === ADD ? setAdding(0) : onSave(e.target.value ? [{ package_id: e.target.value, share: 1 }] : []))}
        >
          <option value="">Package</option>
          {options}
        </select>
        <button className="link-button small" onClick={() => setSplitting(true)}>
          split
        </button>
      </span>
    )
  const r2 = (n: number) => Math.round(n * 100) / 100
  const sum = r2(rows.reduce((s, r) => s + Number(r.val || 0), 0))
  const whole = mode === 'pct' ? 100 : r2(total)
  const left = r2(whole - sum)
  const ok = Math.abs(left) <= 0.01 && !rows.some((r) => !r.id)
  const show = (n: number) => (mode === 'pct' ? `${n}%` : money(n))
  // switching converts what's typed, so nothing has to be re-entered
  const switchTo = (m: 'pct' | 'gbp') => {
    if (m === mode) return
    setRows(rows.map((r) => ({ ...r, val: String(m === 'gbp' ? r2((Number(r.val || 0) / 100) * total) : total ? r2((Number(r.val || 0) / total) * 100) : 0) })))
    setMode(m)
  }
  const save = () =>
    onSave(
      rows.map((r) => {
        const v = Number(r.val || 0)
        if (mode === 'pct') return { package_id: r.id, share: v / 100, amount: null }
        const share = total ? Math.min(1, Math.max(0.0001, v / total)) : 1 / rows.length
        return { package_id: r.id, share, amount: r2(v) }
      }),
    )
  return (
    <div className="split">
      <span className="small">
        Split {money(total)} by{' '}
        <span className="segmented">
          <button className={mode === 'pct' ? 'on' : ''} onClick={() => switchTo('pct')}>
            %
          </button>
          <button className={mode === 'gbp' ? 'on' : ''} onClick={() => switchTo('gbp')}>
            £
          </button>
        </span>
      </span>
      {rows.map((r, i) =>
        adding === i ? (
          <span key={i}>{addBox}</span>
        ) : (
          <span key={i} className="target-cell">
            <select value={r.id} onChange={(e) => (e.target.value === ADD ? setAdding(i) : setRows(rows.map((x, j) => (j === i ? { ...x, id: e.target.value } : x))))}>
              <option value="">Package</option>
              {options}
            </select>
            {mode === 'gbp' && '£'}
            <input
              type="number"
              step={mode === 'pct' ? '1' : '0.01'}
              className={mode === 'gbp' ? 'split-gbp' : ''}
              value={r.val}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, val: e.target.value } : x)))}
            />
            {mode === 'pct' && '%'}
          </span>
        ),
      )}
      <span className="small">
        <button className="link-button small" onClick={() => setRows([...rows, { id: '', val: String(Math.max(0, left)) }])}>
          + another package
        </button>{' '}
        <span className={ok ? 'ok' : 'late'}>{Math.abs(left) <= 0.01 ? `${show(sum)} ✓` : left > 0 ? `${show(left)} still to allocate` : `${show(-left)} too much`}</span>{' '}
        <button className="small-button" disabled={!ok} onClick={save}>
          Save split
        </button>{' '}
        <button className="link-button small" onClick={() => setSplitting(false)}>
          cancel
        </button>
      </span>
    </div>
  )
}
