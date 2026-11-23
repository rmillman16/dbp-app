import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { money, todayIso, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { addProcPackage, loadProcurement, rowDates, saveProcItem, saveSplit, type ProcItem, type ProcRow } from '../lib/procurement'
import { STATUS_LABELS, latestOrderDate, type ProcLine, type ProcStatus } from '../lib/procurementCalc'
import { suggestTasks } from '../lib/cashflowCalc'
import type { ProgrammeTask } from '../lib/programme'
import JobSowCard from '../components/JobSow'
import ContractorPicker from '../components/ContractorPicker'
import { GENERATED_FILE } from '../lib/programmeGen'
import { addCompany } from '../lib/subcontracts'
import type { Company } from '../lib/types'
import { useJob } from './JobLayout'

type Data = Awaited<ReturnType<typeof loadProcurement>>
const today = todayIso()
const CONTRACT_STATUSES: ProcStatus[] = ['not_started', 'enquiry_out', 'quotes_in', 'recommended', 'ordered', 'on_site', 'complete']
const VO_STATUSES: ProcStatus[] = ['not_started', 'enquiry_out', 'quotes_in', 'recommended', 'ordered', 'on_site', 'complete', 'covered', 'nothing_to_order']

// Job › Procurement: what needs ordering, from whom and by when (docs/decisions.md "Procurement: built").
export default function ProcurementTab() {
  const { job } = useJob()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [panel, setPanel] = useState<{ key: string; vo: boolean } | null>(null) // the full details, in a side panel
  const [view, setView] = useState<'packages' | 'variations' | 'lines'>('packages')
  const [adding, setAdding] = useState('')
  const [saving, setSaving] = useState(0)

  const reload = () => loadProcurement(job).then(setData, (e: Error) => setError(e.message))
  useEffect(() => {
    reload()
  }, [job]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>

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
  const packageNames = data.contract.map((r) => r.description)

  // a change made in the table: shown straight away and saved (the order date keeps following the lead
  // time and on-site date until one's typed, as in the details)
  const workedOut = (x: ProcRow) => {
    if (x.lead_weeks == null) return null
    const site = rowDates(x, data.tasks, today).onSite
    return site ? latestOrderDate(site, x.lead_weeks, null) : null
  }
  const change = async (r: ProcRow, p: Partial<ProcItem>) => {
    const next: ProcRow = { ...r, ...p }
    if (!('order_date' in p) && (r.order_date == null || r.order_date === workedOut(r))) next.order_date = workedOut(next)
    const list = r.section === 'variation' ? 'variations' : 'contract'
    setData({ ...data, [list]: data[list].map((x) => (x.key === r.key ? next : x)) })
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setSaving((n) => n + 1)
    try {
      await saveProcItem(job.id, next)
      if (!r.id) await reload() // first save: picks up its id
    } catch (e) {
      setError(saveError(e))
      await reload()
    } finally {
      setSaving((n) => n - 1)
    }
  }

  const table = (rows: ProcRow[], vo: boolean) => (
    <div className="proc-scroll">
      <table className="table stack proc-table proc-inline">
        <thead>
          <tr>
            <th>{vo ? 'Variation' : 'Package'}</th>
            <th>Status</th>
            <th>Subcontractor</th>
            <th className="num">{vo ? 'Value' : 'Budget'}</th>
            <th className="num">Order value</th>
            <th className="num">Lead (wks)</th>
            <th>On site</th>
            <th>Order by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, n) => {
            const { onSite, from, orderBy, flag } = rowDates(r, data.tasks, today)
            const programme = rowDates({ ...r, required_on_site: null }, data.tasks, today).onSite
            return (
              <Fragment key={r.key}>
                {!vo && r.group !== rows[n - 1]?.group && (
                  <tr className="group-head">
                    <td colSpan={8}>{r.group}</td>
                  </tr>
                )}
                <tr className={`${flag === 'late' ? 'proc-late' : flag === 'soon' ? 'proc-soon' : ''} ${panel?.key === r.key ? 'selected' : ''}`}>
                  <td className="stack-title">
                    <button
                      className="proc-name"
                      onClick={() => setPanel({ key: r.key, vo })}
                      title="Open its full details: name, order no. and date, programme activities, comments, SoW lines"
                    >
                      {r.label}
                    </button>
                    {r.display_name && !vo && r.display_name !== r.description && <span className="muted small"> · SoW: {r.description}</span>}
                    {r.comments && (
                      <span className="proc-note" title={r.comments}>
                        {' '}
                        💬
                      </span>
                    )}
                  </td>
                  <td data-label="Status">
                    <select className={`proc-status st-${r.status}`} value={r.status} onChange={(e) => change(r, { status: e.target.value as ProcStatus })} aria-label="Status">
                      {(vo ? VO_STATUSES : CONTRACT_STATUSES).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Subcontractor" className="proc-sub">
                    <ContractorPicker
                      companies={data.companies}
                      value={r.company_id}
                      placeholder="Type or choose"
                      onChange={(id) => id !== r.company_id && change(r, { company_id: id })}
                      onAdd={async (name) => {
                        const c = await addCompany(name, 'subcontractor', r.description)
                        setData((d) => (d ? { ...d, companies: [...d.companies, c] } : d))
                        return c
                      }}
                    />
                  </td>
                  <td className="num" data-label={vo ? 'Value' : 'Budget'}>
                    {money(r.budget)}
                  </td>
                  <td className="num" data-label="Order value">
                    <CellNumber value={r.order_value} step="0.01" onCommit={(v) => change(r, { order_value: v })} label="Order value" />
                    {r.order_value != null && r.budget ? (
                      <span className={`small proc-diff ${r.order_value > r.budget ? 'late' : 'ok'}`}>
                        {r.order_value > r.budget ? `+${money(r.order_value - r.budget)}` : `−${money(r.budget - r.order_value)}`}
                      </span>
                    ) : null}
                  </td>
                  <td className="num" data-label="Lead (wks)">
                    <CellNumber value={r.lead_weeks} step="0.5" onCommit={(v) => change(r, { lead_weeks: v })} label="Lead time in weeks, including design" narrow />
                  </td>
                  <td data-label="On site">
                    <input
                      type="date"
                      className={`proc-date ${r.required_on_site ? '' : 'from-programme'}`}
                      value={r.required_on_site ?? onSite ?? ''}
                      onChange={(e) => change(r, { required_on_site: e.target.value && e.target.value !== programme ? e.target.value : null })}
                      title={
                        r.required_on_site
                          ? `Typed: clear it to use the programme${programme ? ` (${ukDate(programme)})` : ''}`
                          : from === 'provisional'
                            ? 'Provisional, from the programme activities matching its name: type a date, or link its activities in the details, to firm it up'
                            : from === 'programme'
                              ? 'From its linked programme activities'
                              : 'No programme date: type one'
                      }
                      aria-label="Required on site"
                    />
                    {!r.required_on_site && from === 'provisional' && <span className="muted small proc-prov">provisional</span>}
                  </td>
                  <td data-label="Order by">
                    {ukDate(orderBy) || <span className="muted">–</span>}
                    {flag === 'late' && <span className="late small"> late</span>}
                    {flag === 'soon' && <span className="soon small"> due soon</span>}
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  const late = [...data.contract, ...data.variations].filter((r) => rowDates(r, data.tasks, today).flag === 'late').length
  const soon = [...data.contract, ...data.variations].filter((r) => rowDates(r, data.tasks, today).flag === 'soon').length
  const exportExcel = async (copy: 'internal' | 'client') => {
    setError(null)
    try {
      const { exportProcurement } = await import('../lib/exportProcurement')
      await exportProcurement({ job, contract: data.contract, variations: data.variations, tasks: data.tasks, companies: data.companies, copy })
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const panelRow = panel ? (panel.vo ? data.variations : data.contract).find((r) => r.key === panel.key) : null
  const splitLines = data.lines.filter((l) => l.split).length

  return (
    <>
      {/* the job's one SoW, small (22 Nov: less clutter) */}
      <JobSowCard compact onChanged={reload} />
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      {(!data.programme || data.programme.file_name === GENERATED_FILE) && (
        <p className="warning small">
          {data.programme
            ? 'On site dates come from the simple programme made from the SoW. '
            : 'No programme on this job yet, so there are no on site dates from it (type them, or '}
          <Link to="../programme">{data.programme ? 'Import or edit the real programme on the Programme tab.' : 'start one on the Programme tab).'}</Link>
        </p>
      )}

      <section className="card">
        <div className="pane-head">
          <div className="proc-tabs segmented" role="tablist">
            <button className={view === 'packages' ? 'on' : ''} onClick={() => setView('packages')} role="tab">
              Packages <span className="seg-count">{data.contract.length}</span>
            </button>
            <button className={view === 'variations' ? 'on' : ''} onClick={() => setView('variations')} role="tab">
              Variations <span className="seg-count">{data.variations.length}</span>
            </button>
            <button className={view === 'lines' ? 'on' : ''} onClick={() => setView('lines')} role="tab" title="Move or split SoW lines between packages">
              SoW lines{splitLines ? <span className="seg-count">{splitLines} moved</span> : null}
            </button>
          </div>
          <span className="proc-flags small">
            {late > 0 && <span className="late">{late} late</span>}
            {soon > 0 && <span className="soon">{soon} due soon</span>}
            {saving > 0 && <span className="muted">Saving…</span>}
          </span>
          <div className="form-actions">
            <button onClick={() => exportExcel('internal')} title="Everything: subcontractors, budgets, order values, dates and comments">
              Excel: internal
            </button>
            <button onClick={() => exportExcel('client')} title="Package, status and lead time only: for the client / progress reports">
              Excel: client
            </button>
          </div>
        </div>
        <details className="proc-how">
          <summary className="muted small">ⓘ How it works</summary>
          <p className="muted small">
            Packages come from the office SoW: each priced package column, with the general columns (Subbie, Labour, Materials) read line by line into their trades. Budgets are
            cost. Change status, subcontractor, order value, lead time and on-site date right in the table: each saves as you go. Click a package's name for the rest (its own name,
            order no. and date, programme activities, comments, SoW lines). On site comes from the programme (provisionally from the activities matching the package, or those you
            link, or a typed date); order by = on site − lead time (including design). Red when it's passed without an order, amber within 2 weeks.
          </p>
        </details>

        {view === 'packages' && (
          <>
            {!data.hasLines && <p className="warning">The office SoW's lines aren't saved for this job yet: import it in Schedule of works above.</p>}
            {data.contract.length > 0 && table(data.contract, false)}
            <div className="stage-add">
              <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a package, e.g. Mirrors" aria-label="New package" />
              <button
                disabled={!adding.trim() || packageNames.some((p) => p.toLowerCase() === adding.trim().toLowerCase())}
                onClick={() => run(() => addProcPackage(job.id, adding.trim()), `${adding.trim()} added: move SoW lines into it under SoW lines.`).then(() => setAdding(''))}
              >
                + Add package
              </button>
            </div>
          </>
        )}
        {view === 'variations' &&
          (data.variations.length ? (
            <>
              <p className="muted small">Issued and agreed VOs, each with what needs ordering: an order of its own, covered by an existing order, or nothing to order.</p>
              {table(data.variations, true)}
            </>
          ) : (
            <p className="muted small">No issued or agreed VOs on this job yet.</p>
          ))}
        {view === 'lines' && (
          <LinesCard
            embedded
            lines={data.lines}
            packages={packageNames}
            labelOf={(p) => data.contract.find((r) => r.description === p)?.label ?? p}
            onSave={(key, rows) => run(() => saveSplit(job.id, key, rows), 'Line saved.')}
          />
        )}
      </section>

      {/* the full details: a side panel, so the table stays put */}
      {panelRow && panel && (
        <div className="proc-panel-wrap" onClick={(e) => e.target === e.currentTarget && setPanel(null)}>
          <aside className="proc-panel" role="dialog" aria-label={panelRow.label}>
            <div className="proc-panel-head">
              <h2>{panelRow.label}</h2>
              <button className="link-button" onClick={() => setPanel(null)} aria-label="Close">
                ✕
              </button>
            </div>
            <ItemEditor
              key={panelRow.key + (panelRow.id ?? '')}
              row={panelRow}
              vo={panel.vo}
              data={data}
              onCancel={() => setPanel(null)}
              onSave={(item) => run(() => saveProcItem(job.id, item), `${panelRow.label} saved.`).then(() => setPanel(null))}
            />
          </aside>
        </div>
      )}
    </>
  )
}

// a number typed into the table: saved when you leave the box or press Enter
function CellNumber({ value, onCommit, step, label, narrow }: { value: number | null; onCommit: (v: number | null) => void; step: string; label: string; narrow?: boolean }) {
  const [v, setV] = useState(value == null ? '' : String(value))
  useEffect(() => setV(value == null ? '' : String(value)), [value])
  const commit = () => {
    const n = v.trim() === '' ? null : Number(v)
    if (n !== value && (n === null || !Number.isNaN(n))) onCommit(n)
  }
  return (
    <input
      className={`proc-num ${narrow ? 'narrow' : ''}`}
      type="number"
      inputMode="decimal"
      step={step}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label={label}
      placeholder="–"
    />
  )
}

// ---------- one package's (or VO's) details ----------
function ItemEditor({ row, vo, data, onSave, onCancel }: { row: ProcRow; vo: boolean; data: Data; onSave: (i: ProcItem) => void; onCancel: () => void }) {
  // the order date worked out (on site − lead time) once a package has both, and kept up to date
  // as either changes until a date is typed in (Richard, 21 Nov)
  const workedOut = (x: ProcItem) => {
    if (x.lead_weeks == null) return null
    const site = rowDates({ ...x, suggested: row.suggested }, data.tasks, today).onSite
    return site ? latestOrderDate(site, x.lead_weeks, null) : null
  }
  // a saved date that's still the worked-out one carries on following the lead time / on-site date
  const [typedDate, setTypedDate] = useState(row.order_date != null && row.order_date !== workedOut(row))
  const [it, setIt] = useState<ProcItem>(() => (row.order_date == null ? { ...row, order_date: workedOut(row) } : row))
  const set = (p: Partial<ProcItem>) => {
    const next = { ...it, ...p }
    if (!typedDate && !('order_date' in p)) next.order_date = workedOut(next)
    setIt(next)
  }
  const n = (v: string) => (v.trim() === '' ? null : Number(v))
  const suggested = useMemo(() => suggestTasks(row.label, data.tasks), [row.label, data.tasks])
  const { onSite, orderBy, flag } = rowDates({ ...it, suggested: row.suggested }, data.tasks, today)
  // what the programme gives without a typed date: its linked activities, else provisional
  const programmeDate = rowDates({ ...it, required_on_site: null, suggested: row.suggested }, data.tasks, today)
  // contractors added from here join the list straight away
  const [added, setAdded] = useState<Company[]>([])
  const companies = [...data.companies, ...added]
  const toggle = (c: string) => set({ timeline_task_refs: it.timeline_task_refs.includes(c) ? it.timeline_task_refs.filter((x) => x !== c) : [...it.timeline_task_refs, c] })
  const sections = [...new Set(data.tasks.map((t) => t.section ?? 'No section'))]

  return (
    <div className="cf-editor">
      <div className="form-grid">
        {/* its own name: what's ordered, e.g. "Electrical (install)", "Tiles (supply)" (21 Nov) */}
        <label className="span-2">
          Name
          <input value={it.display_name ?? ''} onChange={(e) => set({ display_name: e.target.value || null })} placeholder={row.description} />
          <span className="hint">
            {vo ? 'Leave blank for the VO’s own title.' : `e.g. "${row.description} (install)" or "(supply)". Its budget still comes from the SoW's ${row.description}.`}
          </span>
        </label>
        <label>
          Status
          <select value={it.status} onChange={(e) => set({ status: e.target.value as ProcStatus })}>
            {(vo ? VO_STATUSES : CONTRACT_STATUSES).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Subcontractor / supplier
          {/* type to find one, or choose from the list; a new name can be added to the contractor list */}
          <ContractorPicker
            companies={companies}
            value={it.company_id}
            onChange={(id) => set({ company_id: id })}
            onAdd={async (name) => {
              const c = await addCompany(name, 'subcontractor', row.description)
              setAdded([...added, c])
              return c
            }}
          />
        </label>
        {data.orders.length > 0 && (
          <label>
            Or from an order (Orders)
            <select
              value={it.order_id ?? ''}
              onChange={(e) => {
                const o = data.orders.find((x) => x.id === e.target.value)
                if (o?.order_date) setTypedDate(true) // the order's own date stays
                set(
                  o
                    ? { order_id: o.id, company_id: o.company_id, order_value: o.order_value, order_no: o.order_no, ...(o.order_date ? { order_date: o.order_date } : {}) }
                    : { order_id: null },
                )
              }}
            >
              <option value="">–</option>
              {data.orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {data.companies.find((c) => c.id === o.company_id)?.name ?? 'Order'}
                  {o.trade ? ` (${o.trade})` : ''} {o.order_value != null ? money(o.order_value) : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Order value £
          <input type="number" inputMode="decimal" step="0.01" value={it.order_value ?? ''} onChange={(e) => set({ order_value: n(e.target.value) })} />
        </label>
        <label>
          Order no.
          <input value={it.order_no ?? ''} onChange={(e) => set({ order_no: e.target.value || null })} />
        </label>
        <label>
          Order date
          <input
            type="date"
            value={it.order_date ?? ''}
            onChange={(e) => {
              // typed: it stays; cleared: it's worked out again
              const v = e.target.value || null
              setTypedDate(v != null)
              setIt({ ...it, order_date: v ?? workedOut(it) })
            }}
          />
          <span className="hint">
            {typedDate
              ? 'Typed (clear it to work it out from the lead time)'
              : it.order_date
                ? 'Worked out: required on site − lead time. Type a date to change it'
                : 'Fills in once there’s a lead time and a required on site date'}
          </span>
        </label>
        <label>
          Lead time (weeks)
          <input type="number" inputMode="decimal" step="0.5" value={it.lead_weeks ?? ''} onChange={(e) => set({ lead_weeks: n(e.target.value) })} />
          <span className="hint">Including design and approval</span>
        </label>
        <label>
          Required on site
          <input type="date" value={it.required_on_site ?? ''} onChange={(e) => set({ required_on_site: e.target.value || null })} />
          <span className="hint">
            {it.required_on_site
              ? `Typed (clear it to use the programme${programmeDate.onSite ? `: ${ukDate(programmeDate.onSite)}` : ''})`
              : programmeDate.from === 'programme'
                ? `From its linked activities: ${ukDate(programmeDate.onSite)}`
                : programmeDate.from === 'provisional'
                  ? `Provisional, from the programme activities matching its name: ${ukDate(programmeDate.onSite)}. Link its own below, or type a date, to firm it up`
                  : 'No matching programme activities: link some below, or type a date'}
          </span>
        </label>
      </div>
      <p className={`small ${flag === 'late' ? 'late' : ''}`}>
        Order by: <strong>{ukDate(orderBy) || '–'}</strong>
        {orderBy && ` (on site ${ukDate(onSite)} − ${Number(it.lead_weeks ?? 0)} weeks lead time, including design)`}
      </p>

      {data.tasks.length > 0 && (
        <details>
          <summary>
            Programme activities ({it.timeline_task_refs.length} linked){suggested.length ? ` · suggested: ${suggested.join(', ')}` : ''}
          </summary>
          {suggested.length > 0 && (
            <button className="small-button" onClick={() => set({ timeline_task_refs: [...new Set([...it.timeline_task_refs, ...suggested])] })}>
              Tick the suggested ({suggested.length})
            </button>
          )}
          <TaskPick tasks={data.tasks} sections={sections} codes={it.timeline_task_refs} suggested={suggested} onToggle={toggle} />
        </details>
      )}
      <label>
        Comments
        <textarea rows={2} value={it.comments ?? ''} onChange={(e) => set({ comments: e.target.value || null })} />
      </label>
      {row.lines.length > 0 && (
        <details>
          <summary>Its SoW lines ({row.lines.length})</summary>
          <ul className="month-parts">
            {row.lines.map((l) => (
              <li key={l.key}>
                <span>
                  <span className="muted">{l.ref}</span> {l.description}
                </span>
                <span className="num">{money(l.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="form-actions">
        <button className="primary" onClick={() => onSave(it)}>
          Save
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function TaskPick({
  tasks,
  sections,
  codes,
  suggested,
  onToggle,
}: {
  tasks: ProgrammeTask[]
  sections: string[]
  codes: string[]
  suggested: string[]
  onToggle: (c: string) => void
}) {
  return (
    <div className="task-pick">
      {sections.map((s) => (
        <fieldset key={s}>
          <legend>{s}</legend>
          {tasks
            .filter((t) => (t.section ?? 'No section') === s)
            .map((t) => (
              <label key={t.code} className={suggested.includes(t.code) ? 'suggested' : ''}>
                <input type="checkbox" checked={codes.includes(t.code)} onChange={() => onToggle(t.code)} />
                <span>
                  <span className="muted">{t.code}</span> {t.milestone ? '◆ ' : ''}
                  {t.name}
                  <span className="muted small">
                    {' '}
                    · {ukDate(t.start_date)}
                    {t.finish_date !== t.start_date ? ` – ${ukDate(t.finish_date)}` : ''}
                  </span>
                </span>
              </label>
            ))}
        </fieldset>
      ))}
    </div>
  )
}

// ---------- SoW lines into packages: move a line, or split its £ ----------
function LinesCard({
  lines,
  packages,
  labelOf,
  onSave,
  embedded,
}: {
  embedded?: boolean // inside the procurement page's SoW lines view
  lines: ProcLine[]
  packages: string[]
  labelOf: (p: string) => string // a package's own name where it's been renamed
  onSave: (key: string, rows: { package: string; amount: number }[] | null) => Promise<unknown>
}) {
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const f = filter.trim().toLowerCase()
  const shown = lines.filter((l) => !f || `${l.ref ?? ''} ${l.description} ${Object.keys(l.alloc).join(' ')}`.toLowerCase().includes(f))
  const sections = [...new Set(shown.map((l) => l.section))]
  const moved = lines.filter((l) => l.split).length
  const body = (
    <>
      <p className="muted small">
        Each SoW line's cost goes to the packages it's priced in (general columns read from the description). Move a whole line to another package, or split its £ across packages,
        e.g. a bar into mirrors, joinery, metalwork and install when they're separate orders. Add a package under Packages if it isn't listed.
      </p>
      <input className="filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a line or package…" aria-label="Find a line" />
      <div className="proc-lines">
        <table className="table stack">
          <tbody>
            {sections.map((s) => (
              <Fragment key={s}>
                <tr className="group-head">
                  <td colSpan={4}>{s || 'SoW'}</td>
                </tr>
                {shown
                  .filter((l) => l.section === s)
                  .map((l) => (
                    <Fragment key={l.key}>
                      <tr className={l.split ? 'moved' : ''}>
                        <td className="stack-title">
                          <span className="muted">{l.ref}</span> {l.description}
                        </td>
                        <td className="num" data-label="Cost">
                          {money(l.value)}
                        </td>
                        <td data-label="Packages">
                          {Object.entries(l.alloc)
                            .filter(([, v]) => Math.abs(v) >= 0.005)
                            .map(([p, v]) => (Object.keys(l.alloc).length > 1 ? `${labelOf(p)} ${money(v)}` : labelOf(p)))
                            .join(' · ')}
                          {l.split && <span className="muted small"> (changed)</span>}
                        </td>
                        <td>
                          <button className="small-button" onClick={() => setOpen(open === l.key ? null : l.key)}>
                            {open === l.key ? 'Close' : 'Move / split'}
                          </button>
                        </td>
                      </tr>
                      {open === l.key && (
                        <tr className="editor-row">
                          <td colSpan={4}>
                            <SplitEditor line={l} packages={packages} labelOf={labelOf} onSave={(rows) => onSave(l.key, rows).then(() => setOpen(null))} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
  if (embedded) return body
  return (
    <section className="card">
      <details className="fold">
        <summary>
          <h2>SoW lines into packages</h2>
          <span className="muted small">
            {lines.length} lines{moved ? ` · ${moved} moved or split` : ''}
          </span>
        </summary>
        {body}
      </details>
    </section>
  )
}

function SplitEditor({
  line,
  packages,
  labelOf,
  onSave,
}: {
  line: ProcLine
  packages: string[]
  labelOf: (p: string) => string
  onSave: (rows: { package: string; amount: number }[] | null) => void
}) {
  // starts as the line is now (its own split, or the SoW's)
  const [rows, setRows] = useState<{ package: string; amount: string }[]>(() =>
    Object.entries(line.alloc)
      .filter(([, v]) => Math.abs(v) >= 0.005)
      .map(([p, v]) => ({ package: p, amount: String(v) })),
  )
  const total = Math.round(rows.reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100
  const left = Math.round((line.value - total) * 100) / 100
  const options = [...new Set([...packages, ...Object.keys(line.parts)])].sort((a, b) => labelOf(a).localeCompare(labelOf(b), 'en-GB'))
  const set = (k: number, p: Partial<(typeof rows)[number]>) => setRows(rows.map((r, i) => (i === k ? { ...r, ...p } : r)))
  const valid = rows.every((r) => r.package.trim()) && left > -0.005
  return (
    <div className="split">
      <p className="small">
        <strong>{money(line.value)}</strong> across packages. The SoW's own split:{' '}
        {Object.entries(line.parts)
          .map(([p, v]) => `${labelOf(p)} ${money(v)}`)
          .join(' · ')}
      </p>
      {rows.map((r, k) => (
        <div key={k} className="split-row">
          <select value={options.includes(r.package) ? r.package : ''} onChange={(e) => set(k, { package: e.target.value })}>
            <option value="">– package –</option>
            {options.map((p) => (
              <option key={p} value={p}>
                {labelOf(p)}
              </option>
            ))}
          </select>
          <input className="split-gbp" type="number" inputMode="decimal" step="0.01" value={r.amount} onChange={(e) => set(k, { amount: e.target.value })} aria-label="£" />
          <button className="small-button" onClick={() => setRows(rows.filter((_, i) => i !== k))} aria-label="Remove">
            ✕
          </button>
        </div>
      ))}
      <div className="form-actions">
        <button className="small-button" onClick={() => setRows([...rows, { package: '', amount: left > 0 ? String(left) : '' }])}>
          + Another package
        </button>
        {rows.length === 1 && Math.abs(left) >= 0.005 && (
          <button className="small-button" onClick={() => set(0, { amount: String(line.value) })}>
            Move the whole line to it
          </button>
        )}
      </div>
      <p className={left < -0.005 ? 'late small' : 'muted small'}>
        {left < -0.005
          ? `That's ${money(-left)} more than the line: reduce a package.`
          : Math.abs(left) >= 0.005
            ? `${money(left)} left over follows the SoW's own split.`
            : 'All of the line is allocated ✓'}
      </p>
      <div className="form-actions">
        <button
          className="primary"
          disabled={!valid}
          onClick={() => onSave(rows.filter((r) => Number(r.amount || 0)).map((r) => ({ package: r.package, amount: Math.round(Number(r.amount) * 100) / 100 })))}
        >
          Save
        </button>
        {line.split && (
          <button className="link-button" onClick={() => onSave(null)}>
            Back to the SoW's split
          </button>
        )}
      </div>
    </div>
  )
}
