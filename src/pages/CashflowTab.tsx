import { Fragment, useEffect, useMemo, useState } from 'react'
import { money, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { parseProgramme, saveProgramme, type ParsedProgramme, type ProgrammeTask } from '../lib/programme'
import { addStage, deleteStage, loadCashflow, moveStage, renameStage, saveItem, saveTrade, type CashflowItem, type TradeChoice } from '../lib/cashflow'
import { SITE, SITE_LABEL, TIMING_LABELS, computeCashflow, siteDates, suggestTasks, type CashflowResult, type CfStage, type CfWeight, type Timing } from '../lib/cashflowCalc'
import { useJob } from './JobLayout'

type Data = Awaited<ReturnType<typeof loadCashflow>>

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const KIND_NOTE: Record<CashflowItem['kind'], string> = {
  package: '',
  prelims: '',
  adjust: '',
  vo: 'Agreed',
  vo_risk: 'Issued · at risk',
}

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

  // the programme's own Start on site / PC milestones first, then the job's dates
  const dates = siteDates(data?.tasks ?? [], { start: job.start_date, pc: job.pc_date })
  const siteStart = dates.start
  const pc = dates.pc
  const result = useMemo(
    () =>
      data
        ? computeCashflow({
            items: data.items,
            tasks: data.tasks,
            siteStart,
            pc,
            retentionPct: Number(job.retention_pct ?? 0),
          })
        : null,
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
      {data.choices.length > 0 && (
        <TradesCard
          choices={data.choices}
          trades={data.trades}
          onChoose={(c, trade) => run(() => saveTrade(c.id, trade))}
          onConfirmAll={() => run(() => Promise.all(data.choices.filter((c) => c.suggested).map((c) => saveTrade(c.id, c.trade))), 'Trades confirmed.')}
        />
      )}

      <section className="card">
        <h2>Trades and variations</h2>
        <p className="muted small">
          Weighted by trade (the CVR's packages: joinery, metalwork, stone, labour, materials…), each valued at its cost plus its share of OH&P, so together they make up the price.
          Every pound is placed: until you set a trade, it's spread across the activities that match its name (else start on site to PC); prelims 10% at start on site, 80% spread,
          10% at PC. Click a trade to choose its activities and weight its stages by % or £; its SoW line items are listed there, and any one line can have its own weighting.
          Agreed VOs are in the forecast; issued VOs are shown separately, at risk.
        </p>
        {!data.items.some((i) => i.kind === 'package' || i.kind === 'prelims') && (
          <p className="warning">No packages yet: import the office SoW on the CVR tab (Budgets) first. The cashflow uses the same packages.</p>
        )}
        {data.items.length > 0 && !data.fromLines && (
          <p className="warning">
            The office SoW's lines aren't saved for this job, so OH&P can't be shared across the packages: it's spread in line with everything else. Re-import the office SoW on the
            CVR tab to share it out.
          </p>
        )}
        <table className="table stack cf-items">
          <thead>
            <tr>
              <th>Trade</th>
              <th className="num">Value</th>
              <th>Activities</th>
              <th>Weighting</th>
              <th>Placed</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it, n) => {
              const row = result.rows.find((r) => r.key === it.key)!
              const adjust = it.kind === 'adjust'
              // a line of this trade being given its own weighting for the first time
              const newLine = it.lines?.find((l) => l.itemKey === open && !l.own)
              const editor = (item: CashflowItem, label: string) => (
                <tr className="editor-row">
                  <td colSpan={5}>
                    <ItemEditor
                      item={item}
                      stages={data.stages}
                      tasks={data.tasks}
                      siteStart={siteStart}
                      pc={pc}
                      onCancel={() => setOpen(item.parent ?? null)}
                      onOpenLine={setOpen}
                      onSave={(codes, weights) => run(() => saveItem(job.id, item.key, codes, weights), `${label} saved.`).then(() => setOpen(null))}
                    />
                  </td>
                </tr>
              )
              return (
                <Fragment key={it.key}>
                  {it.group !== data.items[n - 1]?.group && (
                    <tr className="group-head">
                      <td colSpan={5}>{it.group}</td>
                    </tr>
                  )}
                  <tr
                    className={`${adjust ? '' : 'clickable'} ${open === it.key ? 'selected' : ''} ${it.kind === 'vo_risk' ? 'omitted' : ''} ${it.parent ? 'child' : ''}`}
                    onClick={() => !adjust && setOpen(open === it.key ? null : it.key)}
                  >
                    <td className="stack-title">
                      {it.parent && <span className="muted">↳ </span>}
                      {it.label}
                      {KIND_NOTE[it.kind] && <span className="muted small"> · {KIND_NOTE[it.kind]}</span>}
                      {it.parent && <span className="muted small"> · own weighting</span>}
                      {it.sources && it.sources.length > 1 && <span className="muted small"> · incl. {it.sources.filter((s) => s !== it.key.slice(4)).join(', ')}</span>}
                      {it.lines?.some((l) => l.own) && <span className="muted small"> · less the lines below</span>}
                    </td>
                    <td className="num" data-label="Value">
                      {money(it.value)}
                    </td>
                    <td data-label="Activities">
                      {adjust ? <span className="muted">–</span> : activitiesText(it, data.tasks)}
                      {it.suggested && <span className="muted small"> (suggested)</span>}
                    </td>
                    <td data-label="Weighting">
                      {adjust ? <span className="muted">in line with everything else</span> : weightingText(it, data.stages)}
                      {!adjust && it.defaulted && it.weights.length > 0 && <span className="muted small"> (starting weighting)</span>}
                    </td>
                    <td data-label="Placed">
                      {row.unplaced ? (
                        <span className="late" title={row.issues.join('; ')}>
                          {money(row.unplaced)} not placed
                          {row.issues.length ? `: ${row.issues[0]}` : ''}
                        </span>
                      ) : (
                        <span className="ok">✓</span>
                      )}
                    </td>
                  </tr>
                  {open === it.key && editor(it, it.label)}
                  {newLine &&
                    editor(
                      {
                        key: newLine.itemKey,
                        label: `${newLine.ref ? `${newLine.ref} ` : ''}${newLine.description}`,
                        kind: 'package',
                        value: newLine.value,
                        tasks: it.tasks,
                        // it starts as the trade's weighting (by %, as a £ split is the trade's own value)
                        weights: it.weights.map((w) => ({ ...w, amount: null, pct: w.amount != null && it.value ? (Number(w.amount) / it.value) * 100 : w.pct })),
                        group: it.group,
                        defaulted: true,
                        suggested: false,
                        parent: it.key,
                      },
                      `${newLine.ref ?? newLine.description}`,
                    )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        <p className="small">
          In the forecast: <strong>{money(result.total)}</strong>
          {data.sowTotal ? <span className="muted"> · office SoW {money(data.sowTotal)}</span> : null}
          {job.contract_sum != null && <span className="muted"> · contract sum {money(job.contract_sum)}</span>}
          {result.atRiskTotal ? <span className="muted"> · issued VOs at risk {money(result.atRiskTotal)}</span> : null}
          {result.unplaced ? <span className="late"> · {money(result.unplaced)} not placed</span> : <span className="ok"> · all placed ✓</span>}
        </p>
      </section>

      <Forecast result={result} retentionPct={Number(job.retention_pct ?? 0)} siteStart={siteStart} pc={pc} />
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
  const ws = it.weights.filter((w) => w.pct || w.amount)
  if (!ws.length) return <span className="muted">not set</span>
  const short: Record<Timing, string> = {
    start: 'start',
    spread: 'spread',
    end: 'end',
    date: 'date',
  }
  return ws.map((w) => `${stages.find((s) => s.id === w.stage_id)?.name ?? '?'} ${w.amount != null ? money(w.amount) : `${Number(w.pct)}%`} ${short[w.timing]}`).join(' · ')
}

// ---------- programme ----------
function ProgrammeCard({ data, onSave }: { data: Data; onSave: (p: ParsedProgramme, fileName: string) => Promise<void> }) {
  const [pending, setPending] = useState<{
    p: ParsedProgramme
    name: string
  } | null>(null)
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
  const linkedGone = pending
    ? data.items.flatMap((i) => [...i.tasks, ...i.weights.flatMap((w) => w.task_codes ?? [])]).filter((c) => c !== SITE && !pending.p.tasks.some((t) => t.code === c))
    : []
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
          <strong>{programme.project_name}</strong> · {tasks.length} activities · {ukDate(programme.start_date)} to {ukDate(programme.finish_date)} · from {programme.file_name},
          imported {ukDate(programme.imported_at)}
        </p>
      ) : (
        <p className="muted small">
          Import the programme: a P6 .xer from DBP Timeline, or MS Project saved as XML (File › Save As › XML Format; a .mpp itself can't be read in the browser). Import it again
          whenever it's revised: links to activities are kept by their ID.
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
      {/* closed by default: set once per job, then out of the way */}
      <details className="fold">
        <summary>
          <h2>Payment stages</h2>
          <span className="muted small">{stages.map((s) => s.name).join(' · ')}</span>
        </summary>
        <p className="muted small">What each package is paid in, as a guide: rename them, add your own, or remove the ones this job doesn't use.</p>
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
      </details>
    </section>
  )
}

// ---------- packages into trades ----------
// The CVR's "Subbie – 9 Electrical installation" style packages (the Micro SoW's one Subbie column
// split by section) each go into a trade, suggested and confirmed once per job (Richard, 21 Nov).
function TradesCard({
  choices,
  trades,
  onChoose,
  onConfirmAll,
}: {
  choices: TradeChoice[]
  trades: string[]
  onChoose: (c: TradeChoice, trade: string | null) => void
  onConfirmAll: () => void
}) {
  const unconfirmed = choices.filter((c) => c.suggested).length
  return (
    <section className="card">
      <details className="fold" open={unconfirmed > 0}>
        <summary>
          <h2>Subcontract items into trades</h2>
          <span className={unconfirmed ? 'late small' : 'muted small'}>{unconfirmed ? `${unconfirmed} suggested, not yet confirmed` : `${choices.length} placed in trades`}</span>
        </summary>
        <p className="muted small">
          The CVR keeps the SoW's subcontract items by SoW section; the cashflow weights them with the trade they belong to. Check each one goes into the right trade (or keep it as
          a row of its own).
        </p>
        <table className="table stack">
          <tbody>
            {choices.map((c) => (
              <tr key={c.id}>
                <td className="stack-title">{c.name}</td>
                <td className="num" data-label="Value">
                  {money(c.value)}
                </td>
                <td data-label="Goes into">
                  <select value={c.trade === c.name ? '' : c.trade} onChange={(e) => onChoose(c, e.target.value)}>
                    <option value="">its own row</option>
                    {trades
                      .filter((t) => t !== c.name)
                      .map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                  </select>
                  {c.suggested && <span className="muted small"> suggested</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {unconfirmed > 0 && (
          <div className="form-actions">
            <button className="primary" onClick={onConfirmAll}>
              Confirm the suggestions
            </button>
          </div>
        )}
      </details>
    </section>
  )
}

// ---------- one trade's (or line's) activities and weighting ----------
type Draft = {
  pct: string
  timing: Timing
  own: string[] | null
  date: string
}

function ItemEditor({
  item,
  stages,
  tasks,
  siteStart,
  pc,
  onSave,
  onCancel,
  onOpenLine,
}: {
  item: CashflowItem
  stages: CfStage[]
  tasks: ProgrammeTask[]
  siteStart: string | null
  pc: string | null
  onSave: (codes: string[], weights: CfWeight[] | null) => void
  onCancel: () => void
  onOpenLine: (key: string) => void
}) {
  const [codes, setCodes] = useState<string[]>(item.tasks)
  // weighted by % of the value, or by £ (Richard, 20 Nov); "pct" holds whichever is typed
  const [mode, setMode] = useState<'pct' | 'gbp'>(item.weights.some((w) => w.amount != null) ? 'gbp' : 'pct')
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      stages.map((s) => {
        const w = item.weights.find((x) => x.stage_id === s.id)
        const typed = w ? (w.amount != null ? Number(w.amount) : Number(w.pct)) : null
        return [
          s.id,
          {
            pct: typed ? String(typed) : '',
            timing: w?.timing ?? 'spread',
            own: w?.task_codes ?? null,
            date: w?.on_date ?? '',
          },
        ]
      }),
    ),
  )
  // switching converts what's typed, so the split stays the same
  const switchMode = (to: 'pct' | 'gbp') => {
    if (to === mode) return
    const conv = (v: string) => {
      const n = Number(v || 0)
      if (!n) return ''
      const out = to === 'gbp' ? (item.value * n) / 100 : item.value ? (n / item.value) * 100 : 0
      return String(Math.round(out * (to === 'gbp' ? 100 : 10000)) / (to === 'gbp' ? 100 : 10000))
    }
    setDrafts(Object.fromEntries(Object.entries(drafts).map(([k, d]) => [k, { ...d, pct: conv(d.pct) }])))
    setMode(to)
  }
  const suggested = useMemo(() => suggestTasks(item.label, tasks), [item.label, tasks])
  const sections = [...new Set(tasks.map((t) => t.section ?? 'No section'))]
  const toggle = (list: string[], c: string) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c])
  const set = (id: string, d: Partial<Draft>) => setDrafts({ ...drafts, [id]: { ...drafts[id], ...d } })
  const weights: CfWeight[] = stages
    .filter((s) => Number(drafts[s.id]?.pct || 0))
    .map((s) => {
      const d = drafts[s.id]
      const n = Number(d.pct)
      return {
        stage_id: s.id,
        pct: mode === 'gbp' ? (item.value ? Math.round((n / item.value) * 1e6) / 1e4 : 0) : n,
        amount: mode === 'gbp' ? Math.round(n * 100) / 100 : null,
        timing: d.timing,
        task_codes: d.own?.length ? d.own : null,
        on_date: d.timing === 'date' ? d.date || null : null,
      }
    })
  const total = Math.round(weights.reduce((s, w) => s + (mode === 'gbp' ? Number(w.amount) : w.pct), 0) * 100) / 100
  const whole = mode === 'gbp' ? Math.abs(total - item.value) < 0.005 : Math.abs(total - 100) < 0.001
  const datesMissing = weights.some((w) => w.timing === 'date' && !w.on_date)
  const preview: CashflowResult = computeCashflow({
    items: [{ ...item, tasks: codes, weights }],
    tasks,
    siteStart,
    pc,
    retentionPct: 0,
  })
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

      <div className="cf-weight-head">
        <h3>Weighting</h3>
        <span className="segmented" role="group" aria-label="Weight by">
          <button className={mode === 'pct' ? 'on' : ''} onClick={() => switchMode('pct')}>
            %
          </button>
          <button className={mode === 'gbp' ? 'on' : ''} onClick={() => switchMode('gbp')}>
            £
          </button>
        </span>
      </div>
      <table className="table stack cf-weights">
        <thead>
          <tr>
            <th>Stage</th>
            <th>{mode === 'gbp' ? '£' : '%'}</th>
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
                <td data-label={mode === 'gbp' ? '£' : '%'}>
                  <input
                    className={mode === 'gbp' ? 'gbp' : 'pct'}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={d.pct}
                    onChange={(e) => set(s.id, { pct: e.target.value })}
                    placeholder="0"
                    aria-label={`${s.name} ${mode === 'gbp' ? '£' : '%'}`}
                  />
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
                      <select
                        value={d.own ? 'choose' : 'linked'}
                        onChange={(e) =>
                          set(s.id, {
                            own: e.target.value === 'choose' ? [] : null,
                          })
                        }
                      >
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
      <p className={whole ? 'ok' : 'late'}>
        {mode === 'gbp' ? (
          <>
            Total {money(total)} of {money(item.value)}
            {whole ? ' ✓' : `: ${money(Math.abs(item.value - total))} ${total < item.value ? 'still to allocate' : 'too much'}`}
          </>
        ) : (
          <>
            Total {total}%{whole ? ' ✓' : `: ${Math.round(Math.abs(100 - total) * 100) / 100}% ${total < 100 ? 'still to allocate' : 'too much'} (stages must add up to 100%)`}
          </>
        )}
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
        <button
          className="primary"
          onClick={() => onSave(codes, weights)}
          disabled={!whole || datesMissing}
          title={!whole ? 'Every pound must be allocated: the stages must come to the whole value' : datesMissing ? 'Give each stage on a date its date' : ''}
        >
          Save
        </button>
        <button onClick={onCancel}>Cancel</button>
        {!item.defaulted && !item.parent && (
          <button className="link-button" onClick={() => confirm('Go back to the starting weighting for this trade?') && onSave(codes, null)}>
            Back to the starting weighting
          </button>
        )}
        {item.parent && !item.defaulted && (
          <button className="link-button" onClick={() => confirm('Let this line follow its trade again?') && onSave(codes, null)}>
            Follow the trade again
          </button>
        )}
      </div>
      {item.lines && item.lines.length > 0 && (
        <details className="cf-lines">
          <summary>
            Its SoW line items ({item.lines.length}): all follow this weighting unless given their own
            {item.lines.some((l) => l.own) && <span className="muted"> · {item.lines.filter((l) => l.own).length} with their own</span>}
          </summary>
          <table className="table stack">
            <tbody>
              {item.lines.map((l) => (
                <tr key={l.itemKey}>
                  <td className="stack-title">
                    <span className="muted">{l.ref}</span> {l.description}
                  </td>
                  <td className="num" data-label="Value">
                    {money(l.value)}
                  </td>
                  <td data-label="Weighting">
                    {l.own ? (
                      <button className="small-button" onClick={() => onOpenLine(l.itemKey)}>
                        Own weighting: edit
                      </button>
                    ) : (
                      <button className="small-button" onClick={() => onOpenLine(l.itemKey)}>
                        Give it its own weighting
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}

// ---------- the forecast ----------
function Forecast({ result, retentionPct, siteStart, pc }: { result: CashflowResult; retentionPct: number; siteStart: string | null; pc: string | null }) {
  const { monthly } = result
  const notPlaced = result.rows.filter((r) => r.unplaced && r.kind !== 'vo_risk')
  const [shown, setShown] = useState<string | null>(null) // the month opened to see what makes it up
  return (
    <section className="card">
      <h2>Forecast</h2>
      <p className="muted small">
        What we'll apply for each month, excl. VAT, valuations at month end. Start on site {ukDate(siteStart) || 'not set'}, PC {ukDate(pc) || 'not set'} (from the programme's
        milestones, else the job's dates). Retention at {retentionPct}%{pc ? ', halved from PC' : ''}. Click a month to see what makes it up.
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
            {monthly.map((m, k) => (
              <Fragment key={m.month}>
                <tr className={`clickable ${shown === m.month ? 'selected' : ''}`} onClick={() => setShown(shown === m.month ? null : m.month)}>
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
                {shown === m.month && (
                  <tr className="editor-row">
                    <td colSpan={result.atRiskTotal ? 7 : 6}>
                      <strong>What makes up {monthLabel(m.month)}</strong>
                      <ul className="month-parts">
                        {result.rows
                          .filter((r) => r.months[k])
                          .sort((a, b) => Math.abs(b.months[k]) - Math.abs(a.months[k]))
                          .map((r) => (
                            <li key={r.key}>
                              <span>
                                {r.label}
                                {r.kind === 'vo_risk' && <span className="muted"> (at risk)</span>}
                              </span>
                              <span className="num">
                                {money(r.months[k])} <span className="muted small">({r.value ? `${Math.round((r.months[k] / r.value) * 1000) / 10}% of it` : ''})</span>
                              </span>
                            </li>
                          ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
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
