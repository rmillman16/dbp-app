import { Fragment, useEffect, useMemo, useState } from 'react'
import { money, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { parseProgramme, saveProgramme, type ParsedProgramme, type ProgrammeTask } from '../lib/programme'
import { addStage, deleteStage, loadCashflow, moveStage, renameStage, saveItem, type CashflowItem } from '../lib/cashflow'
import { SITE, SITE_LABEL, TIMING_LABELS, computeCashflow, suggestTasks, type CashflowResult, type CfStage, type CfWeight, type Timing } from '../lib/cashflowCalc'
import { useJob } from './JobLayout'

type Data = Awaited<ReturnType<typeof loadCashflow>>

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const KIND_NOTE: Record<CashflowItem['kind'], string> = { section: '', prelims: 'Prelims', vo: 'Agreed VO', vo_risk: 'Issued VO · at risk' }

// Job › Cashflow: the client-facing forecast of what we'll apply for each month, from the
// programme (docs/decisions.md "Cashflow: built").
export default function CashflowTab() {
  const { job } = useJob()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const reload = () => loadCashflow(job).then(setData, (e: Error) => setError(e.message))
  useEffect(() => {
    reload()
  }, [job]) // eslint-disable-line react-hooks/exhaustive-deps

  const siteStart = job.start_date ?? data?.programme?.start_date ?? null
  const pc = job.pc_date ?? data?.programme?.finish_date ?? null
  const result = useMemo(
    () => (data ? computeCashflow({ items: data.items, tasks: data.tasks, siteStart, pc, retentionPct: Number(job.retention_pct ?? 0) }) : null),
    [data, siteStart, pc, job.retention_pct],
  )

  if (error && !data) return <p className="error">{error}</p>
  if (!data || !result) return <p className="muted">Loading…</p>

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

  return (
    <>
      <ProgrammeCard data={data} onSave={(p, name) => run(() => saveProgramme(job.id, p, name), `Programme imported: ${p.tasks.length} activities.`)} />
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      <StagesCard
        stages={data.stages}
        onRename={(id, name) => run(() => renameStage(id, name))}
        onAdd={(name) => run(() => addStage(job.id, name, (data.stages[data.stages.length - 1]?.sort ?? 0) + 1))}
        onDelete={(s) => confirm(`Remove the "${s.name}" stage? Any % given to it on a section goes too.`) && run(() => deleteStage(s.id))}
        onMove={(a, b) => run(() => moveStage(a, b))}
      />

      <section className="card">
        <h2>Sections and variations</h2>
        <p className="muted small">
          Each SoW section is linked to its programme activities and paid in stages. Until you set a section's weighting, it's 100% Progress spread across its activities
          (prelims: 10% at start on site, 80% spread to PC, 10% at PC). Agreed VOs are in the forecast; issued VOs are shown separately, at risk.
          {data.sowRevision ? ` Values from the priced SoW ${data.sowRevision.revision}.` : ''}
        </p>
        {!data.sowRevision && <p className="warning">No priced SoW on this job yet: import it on the Applications tab first.</p>}
        <table className="table stack cf-items">
          <thead>
            <tr>
              <th>Section</th>
              <th className="num">Value</th>
              <th>Activities</th>
              <th>Weighting</th>
              <th>Placed</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => {
              const row = result.rows.find((r) => r.key === it.key)!
              return (
                <Fragment key={it.key}>
                  <tr className={`clickable ${open === it.key ? 'selected' : ''} ${it.kind === 'vo_risk' ? 'omitted' : ''}`} onClick={() => setOpen(open === it.key ? null : it.key)}>
                    <td className="stack-title">
                      {it.label}
                      {KIND_NOTE[it.kind] && <span className="muted small"> · {KIND_NOTE[it.kind]}</span>}
                    </td>
                    <td className="num" data-label="Value">
                      {money(it.value)}
                    </td>
                    <td data-label="Activities">{activitiesText(it, data.tasks)}</td>
                    <td data-label="Weighting">
                      {weightingText(it, data.stages)}
                      {it.defaulted && it.weights.length > 0 && <span className="muted small"> (starting weighting)</span>}
                    </td>
                    <td data-label="Placed">
                      {row.unplaced ? (
                        <span className="late" title={row.issues.join('; ')}>
                          {money(row.unplaced)} not placed{row.issues.length ? `: ${row.issues[0]}` : ''}
                        </span>
                      ) : (
                        <span className="ok">✓</span>
                      )}
                    </td>
                  </tr>
                  {open === it.key && (
                    <tr className="editor-row">
                      <td colSpan={5}>
                        <ItemEditor
                          item={it}
                          stages={data.stages}
                          tasks={data.tasks}
                          siteStart={siteStart}
                          pc={pc}
                          onCancel={() => setOpen(null)}
                          onSave={(codes, weights) => run(() => saveItem(job.id, it.key, codes, weights), `${it.label} saved.`).then(() => setOpen(null))}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        <p className="small">
          Sections and agreed VOs: <strong>{money(result.total)}</strong>
          {job.contract_sum != null && <span className="muted"> · contract sum {money(job.contract_sum)}</span>}
          {result.atRiskTotal ? <span className="muted"> · issued VOs at risk {money(result.atRiskTotal)}</span> : null}
        </p>
      </section>

      <Forecast result={result} retentionPct={Number(job.retention_pct ?? 0)} pc={pc} />
    </>
  )
}

function activitiesText(it: CashflowItem, tasks: ProgrammeTask[]) {
  const codes = new Set([...it.tasks, ...it.weights.flatMap((w) => w.task_codes ?? [])])
  if (!codes.size) return <span className="muted">none yet</span>
  const names = [...codes].map((c) => (c === SITE ? SITE_LABEL : (tasks.find((t) => t.code === c)?.code ?? `${c} (gone)`)))
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ')
}

function weightingText(it: CashflowItem, stages: CfStage[]) {
  const ws = it.weights.filter((w) => w.pct)
  if (!ws.length) return <span className="muted">not set</span>
  const short: Record<Timing, string> = { start: 'start', spread: 'spread', end: 'end', date: 'date' }
  return ws.map((w) => `${stages.find((s) => s.id === w.stage_id)?.name ?? '?'} ${Number(w.pct)}% ${short[w.timing]}`).join(' · ')
}

// ---------- programme ----------
function ProgrammeCard({ data, onSave }: { data: Data; onSave: (p: ParsedProgramme, fileName: string) => Promise<void> }) {
  const [pending, setPending] = useState<{ p: ParsedProgramme; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { programme, tasks } = data
  async function read(f: File) {
    setError(null)
    try {
      setPending({ p: await parseProgramme(f), name: f.name })
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const sections = (list: { section: string | null }[]) => [...new Set(list.map((t) => t.section ?? 'No section'))]
  const linkedGone = pending ? data.items.flatMap((i) => [...i.tasks, ...i.weights.flatMap((w) => w.task_codes ?? [])]).filter((c) => c !== SITE && !pending.p.tasks.some((t) => t.code === c)) : []
  return (
    <section className="card">
      <div className="pane-head">
        <h2>Programme</h2>
        <label className="file-button">
          <input type="file" accept=".xer,.xml,.mpp,.json" onChange={(e) => (e.target.files?.[0] && read(e.target.files[0]), (e.target.value = ''))} />
          <span className="button">{programme ? 'Import a new revision…' : 'Import the programme…'}</span>
        </label>
      </div>
      {programme ? (
        <p className="small">
          <strong>{programme.project_name}</strong> · {tasks.length} activities · {ukDate(programme.start_date)} to {ukDate(programme.finish_date)} · from {programme.file_name}, imported{' '}
          {ukDate(programme.imported_at)}
        </p>
      ) : (
        <p className="muted small">
          Import the programme: a P6 .xer from DBP Timeline, or MS Project saved as XML (File › Save As › XML Format; a .mpp itself can't be read in the browser). Import it again whenever it's
          revised: links to activities are kept by their ID.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {pending && (
        <div className="import-box">
          <ul className="check-list">
            <li>
              <strong>{pending.p.project_name}</strong>: {pending.p.tasks.length} activities, {ukDate(pending.p.start_date)} to {ukDate(pending.p.finish_date)}
            </li>
            <li>Sections: {sections(pending.p.tasks).join(' · ')}</li>
            {linkedGone.length > 0 && <li className="late">No longer in it, but linked to a section: {[...new Set(linkedGone)].join(', ')}</li>}
          </ul>
          <div className="form-actions">
            <button className="primary" onClick={() => onSave(pending.p, pending.name).then(() => setPending(null))}>
              Use this programme
            </button>
            <button onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
      {tasks.length > 0 && (
        <details>
          <summary>The activities</summary>
          <table className="table stack">
            <thead>
              <tr>
                <th>Activity</th>
                <th>Trade</th>
                <th>Start</th>
                <th>Finish</th>
              </tr>
            </thead>
            <tbody>
              {sections(tasks).map((s) => (
                <Fragment key={s}>
                  <tr className="group-head">
                    <td colSpan={4}>{s}</td>
                  </tr>
                  {tasks
                    .filter((t) => (t.section ?? 'No section') === s)
                    .map((t) => (
                      <tr key={t.code}>
                        <td className="stack-title">
                          <span className="muted">{t.code}</span> {t.milestone ? '◆ ' : ''}
                          {t.name}
                        </td>
                        <td data-label="Trade">{t.trade}</td>
                        <td data-label="Start">{ukDate(t.start_date)}</td>
                        <td data-label="Finish">{ukDate(t.finish_date)}</td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  )
}

// ---------- stages ----------
function StagesCard({
  stages,
  onRename,
  onAdd,
  onDelete,
  onMove,
}: {
  stages: Data['stages']
  onRename: (id: string, name: string) => void
  onAdd: (name: string) => void
  onDelete: (s: CfStage) => void
  onMove: (a: Data['stages'][number], b: Data['stages'][number]) => void
}) {
  const [names, setNames] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState('')
  useEffect(() => setNames(Object.fromEntries(stages.map((s) => [s.id, s.name]))), [stages])
  return (
    <section className="card">
      <h2>Payment stages</h2>
      <p className="muted small">What each section is paid in, as a guide: rename them, add your own, or remove the ones this job doesn't use.</p>
      <ul className="stage-list">
        {stages.map((s, i) => (
          <li key={s.id}>
            <input
              value={names[s.id] ?? s.name}
              onChange={(e) => setNames({ ...names, [s.id]: e.target.value })}
              onBlur={() => names[s.id]?.trim() && names[s.id].trim() !== s.name && onRename(s.id, names[s.id].trim())}
              aria-label="Stage name"
            />
            <button className="small-button" disabled={i === 0} onClick={() => onMove(s, stages[i - 1])} aria-label="Move up">
              ↑
            </button>
            <button className="small-button" disabled={i === stages.length - 1} onClick={() => onMove(s, stages[i + 1])} aria-label="Move down">
              ↓
            </button>
            <button className="small-button" onClick={() => onDelete(s)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="stage-add">
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="New stage, e.g. Design" aria-label="New stage" />
        <button onClick={() => (adding.trim() && onAdd(adding.trim()), setAdding(''))} disabled={!adding.trim()}>
          + Add stage
        </button>
      </div>
    </section>
  )
}

// ---------- one section's activities and weighting ----------
type Draft = { pct: string; timing: Timing; own: string[] | null; date: string }

function ItemEditor({
  item,
  stages,
  tasks,
  siteStart,
  pc,
  onSave,
  onCancel,
}: {
  item: CashflowItem
  stages: CfStage[]
  tasks: ProgrammeTask[]
  siteStart: string | null
  pc: string | null
  onSave: (codes: string[], weights: CfWeight[] | null) => void
  onCancel: () => void
}) {
  const [codes, setCodes] = useState<string[]>(item.tasks)
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      stages.map((s) => {
        const w = item.weights.find((x) => x.stage_id === s.id)
        return [s.id, { pct: w ? String(Number(w.pct)) : '', timing: w?.timing ?? 'spread', own: w?.task_codes ?? null, date: w?.on_date ?? '' }]
      }),
    ),
  )
  const suggested = useMemo(() => suggestTasks(item.label, tasks), [item.label, tasks])
  const sections = [...new Set(tasks.map((t) => t.section ?? 'No section'))]
  const toggle = (list: string[], c: string) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c])
  const set = (id: string, d: Partial<Draft>) => setDrafts({ ...drafts, [id]: { ...drafts[id], ...d } })
  const weights: CfWeight[] = stages
    .filter((s) => Number(drafts[s.id]?.pct || 0))
    .map((s) => {
      const d = drafts[s.id]
      return { stage_id: s.id, pct: Number(d.pct), timing: d.timing, task_codes: d.own?.length ? d.own : null, on_date: d.timing === 'date' ? d.date || null : null }
    })
  const total = weights.reduce((s, w) => s + w.pct, 0)
  const preview: CashflowResult = computeCashflow({ items: [{ ...item, tasks: codes, weights }], tasks, siteStart, pc, retentionPct: 0 })
  const row = preview.rows[0]
  const site = siteStart && pc ? `${SITE_LABEL} (${ukDate(siteStart)} – ${ukDate(pc)})` : `${SITE_LABEL} (no dates on the job yet)`
  const nameOf = (c: string) => (c === SITE ? SITE_LABEL : `${c} ${tasks.find((t) => t.code === c)?.name ?? '(not in the programme)'}`)

  return (
    <div className="cf-editor">
      <h3>Activities for {item.label}</h3>
      {!tasks.length && <p className="warning">Import the programme first (top of this page).</p>}
      {suggested.length > 0 && (
        <p className="small">
          Suggested from the names: {suggested.join(', ')}{' '}
          <button className="small-button" onClick={() => setCodes([...new Set([...codes, ...suggested])])}>
            Tick the suggested ({suggested.length})
          </button>
        </p>
      )}
      <div className="task-pick">
        <label>
          <input type="checkbox" checked={codes.includes(SITE)} onChange={() => setCodes(toggle(codes, SITE))} /> {site}
        </label>
        {sections.map((s) => (
          <fieldset key={s}>
            <legend>{s}</legend>
            {tasks
              .filter((t) => (t.section ?? 'No section') === s)
              .map((t) => (
                <label key={t.code} className={suggested.includes(t.code) ? 'suggested' : ''}>
                  <input type="checkbox" checked={codes.includes(t.code)} onChange={() => setCodes(toggle(codes, t.code))} />
                  <span>
                    <span className="muted">{t.code}</span> {t.milestone ? '◆ ' : ''}
                    {t.name}
                    <span className="muted small">
                      {' '}
                      · {t.trade ? `${t.trade} · ` : ''}
                      {ukDate(t.start_date)}
                      {t.finish_date !== t.start_date ? ` – ${ukDate(t.finish_date)}` : ''}
                    </span>
                  </span>
                </label>
              ))}
          </fieldset>
        ))}
      </div>

      <h3>Weighting</h3>
      <table className="table stack cf-weights">
        <thead>
          <tr>
            <th>Stage</th>
            <th>%</th>
            <th>When</th>
            <th>Activities</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => {
            const d = drafts[s.id]
            return (
              <tr key={s.id}>
                <td className="stack-title">{s.name}</td>
                <td data-label="%">
                  <input className="pct" type="number" inputMode="decimal" min={0} max={100} step="any" value={d.pct} onChange={(e) => set(s.id, { pct: e.target.value })} placeholder="0" />
                </td>
                <td data-label="When">
                  <select value={d.timing} onChange={(e) => set(s.id, { timing: e.target.value as Timing })}>
                    {(Object.keys(TIMING_LABELS) as Timing[]).map((t) => (
                      <option key={t} value={t}>
                        {TIMING_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  {d.timing === 'date' && <input type="date" value={d.date} onChange={(e) => set(s.id, { date: e.target.value })} />}
                </td>
                <td data-label="Activities">
                  {d.timing === 'date' ? (
                    <span className="muted">–</span>
                  ) : (
                    <>
                      <select value={d.own ? 'choose' : 'linked'} onChange={(e) => set(s.id, { own: e.target.value === 'choose' ? [] : null })}>
                        <option value="linked">all those ticked above</option>
                        <option value="choose">choose…</option>
                      </select>
                      {d.own && (
                        <div className="own-picks">
                          {(codes.length ? codes : []).map((c) => (
                            <label key={c}>
                              <input type="checkbox" checked={d.own!.includes(c)} onChange={() => set(s.id, { own: toggle(d.own!, c) })} /> {nameOf(c)}
                            </label>
                          ))}
                          {!codes.length && <span className="muted small">Tick the section's activities above first.</span>}
                        </div>
                      )}
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className={Math.abs(total - 100) < 0.001 ? 'ok' : 'late'}>
        Total {Math.round(total * 100) / 100}%{Math.abs(total - 100) < 0.001 ? ' ✓' : ': stages must add up to 100%'}
      </p>
      <div className="cf-preview small">
        <strong>Where {money(item.value)} lands:</strong>{' '}
        {preview.months
          .map((m, k) => [m, row.months[k]] as const)
          .filter(([, v]) => v)
          .map(([m, v]) => `${monthLabel(m)} ${money(v)}`)
          .join(' · ') || <span className="muted">nowhere yet</span>}
        {row.unplaced ? <span className="late"> · {money(row.unplaced)} not placed</span> : null}
        {row.issues.length > 0 && <span className="late"> ({row.issues.join('; ')})</span>}
      </div>
      <div className="form-actions">
        <button className="primary" onClick={() => onSave(codes, weights)}>
          Save
        </button>
        <button onClick={onCancel}>Cancel</button>
        {!item.defaulted && (
          <button className="link-button" onClick={() => confirm('Go back to the starting weighting for this section?') && onSave(codes, null)}>
            Back to the starting weighting
          </button>
        )}
      </div>
    </div>
  )
}

// ---------- the forecast ----------
function Forecast({ result, retentionPct, pc }: { result: CashflowResult; retentionPct: number; pc: string | null }) {
  const { monthly } = result
  const notPlaced = result.rows.filter((r) => r.unplaced && r.kind !== 'vo_risk')
  return (
    <section className="card">
      <h2>Forecast</h2>
      <p className="muted small">
        What we'll apply for each month, excl. VAT, valuations at month end. Retention at {retentionPct}%{pc ? `, halved from PC (${ukDate(pc)})` : ''}.
      </p>
      {notPlaced.length > 0 && (
        <details className="warning">
          <summary>
            {money(result.unplaced)} isn't in a month yet ({notPlaced.length} section{notPlaced.length === 1 ? '' : 's'})
          </summary>
          <ul className="query-list">
            {notPlaced.map((r) => (
              <li key={r.key}>
                {r.label} · <strong>{money(r.unplaced)}</strong> <span className="muted">{r.issues.join('; ')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {monthly.length > 0 && <SCurve result={result} />}
      {monthly.length > 0 && (
        <table className="table stack cf-months">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">This month</th>
              <th className="num">Cumulative</th>
              <th className="num">Cum. %</th>
              <th className="num">Retention held</th>
              <th className="num">Payment after retention</th>
              {result.atRiskTotal ? <th className="num">Issued VOs (at risk)</th> : null}
            </tr>
          </thead>
          <tbody>
            {monthly.map((m) => (
              <tr key={m.month}>
                <td className="stack-title">{monthLabel(m.month)}</td>
                <td className="num" data-label="This month">
                  {money(m.value)}
                </td>
                <td className="num" data-label="Cumulative">
                  {money(m.cumulative)}
                </td>
                <td className="num" data-label="Cum. %">
                  {pct(m.cumPct)}
                </td>
                <td className="num" data-label="Retention held">
                  {money(m.retention)}
                </td>
                <td className="num" data-label="Payment after retention">
                  {money(m.netMonth)}
                </td>
                {result.atRiskTotal ? (
                  <td className="num" data-label="Issued VOs (at risk)">
                    {m.atRisk ? money(m.atRisk) : ''}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">{money(monthly.reduce((s, m) => s + m.value, 0))}</td>
              <td colSpan={result.atRiskTotal ? 5 : 4} />
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  )
}

// monthly bars (navy; issued VOs stacked in amber) and the cumulative % line (blue)
function SCurve({ result }: { result: CashflowResult }) {
  const { monthly } = result
  const W = 760
  const H = 260
  const L = 56
  const R = 44
  const T = 14
  const B = 34
  const n = monthly.length
  const bw = (W - L - R) / n
  const max = Math.max(...monthly.map((m) => m.value + m.atRisk), 1)
  const y = (v: number) => T + (H - T - B) * (1 - v / max)
  const yp = (p: number) => T + (H - T - B) * (1 - p)
  const line = monthly.map((m, k) => `${k ? 'L' : 'M'}${(L + bw * (k + 0.5)).toFixed(1)},${yp(m.cumPct).toFixed(1)}`).join(' ')
  const every = Math.ceil(n / 12)
  const k = (v: number) => (v >= 1000 ? `£${Math.round(v / 1000)}k` : `£${Math.round(v)}`)
  return (
    <svg className="cf-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly value and cumulative percentage">
      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
        <g key={p}>
          <line x1={L} x2={W - R} y1={yp(p)} y2={yp(p)} className="grid" />
          <text x={W - R + 6} y={yp(p) + 4} className="axis">
            {p * 100}%
          </text>
          <text x={L - 6} y={yp(p) + 4} className="axis" textAnchor="end">
            {k(max * p)}
          </text>
        </g>
      ))}
      {monthly.map((m, i) => (
        <g key={m.month}>
          <rect x={L + bw * i + bw * 0.15} width={bw * 0.7} y={y(m.value)} height={Math.max(0, H - B - y(m.value))} className="bar">
            <title>{`${monthLabel(m.month)}: ${money(m.value)}`}</title>
          </rect>
          {m.atRisk > 0 && (
            <rect x={L + bw * i + bw * 0.15} width={bw * 0.7} y={y(m.value + m.atRisk)} height={Math.max(0, y(m.value) - y(m.value + m.atRisk))} className="bar risk">
              <title>{`Issued VOs at risk: ${money(m.atRisk)}`}</title>
            </rect>
          )}
          {i % every === 0 && (
            <text x={L + bw * (i + 0.5)} y={H - B + 16} className="axis" textAnchor="middle">
              {monthLabel(m.month)}
            </text>
          )}
        </g>
      ))}
      <path d={line} className="curve" />
    </svg>
  )
}
