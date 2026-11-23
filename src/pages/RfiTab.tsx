import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ukDate, todayIso } from '../lib/format'
import { saveError } from '../lib/offline'
import { useAccess } from '../lib/access'
import { useJob } from './JobLayout'
import { CHASE_OPTIONS, STATUS_LABELS, addTrade, chaseLabel, createRfi, daysOpen, fillFromTemplate, isOverdue, loadRfis, nextNumber, saveTemplate, type Rfi, type RfiPerson, type RfiStatus } from '../lib/rfis'
import { keyOf, refOf, useRfiContext } from '../lib/rfiContext'
import { exportRfisExcel, exportRfisPdf } from '../lib/exportRfis'
import { htmlToText } from '../lib/richText'
import RichTextEditor from '../components/RichTextEditor'
import JobRfiTemplates from '../components/JobRfiTemplates'
import PeoplePicker from '../components/PeoplePicker'
import SuggestInput from '../components/SuggestInput'
import { nudgeEmails } from '../lib/notifications'

type Filter = 'open' | 'answered' | 'closed' | 'all'

// Job › RFIs (23 Nov, script 057): the register, with Excel and PDF reports, and the Create RFI form.
export default function RfiTab() {
  const { job } = useJob()
  const navigate = useNavigate()
  const ctx = useRfiContext(job.id)
  const [data, setData] = useState<{ rfis: Rfi[]; people: RfiPerson[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState<Filter>('open')
  const [trade, setTrade] = useState('')
  const [who, setWho] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [tpls, setTpls] = useState(false)
  const { me: meNow } = useAccess()
  const today = todayIso()

  const load = () => loadRfis(job.id).then(setData, (e: Error) => (setError(e.message), setData({ rfis: [], people: [] })))
  useEffect(() => {
    load()
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => (data ? data.rfis.map((r) => ctx.rowFor(r, data.people.filter((p) => p.rfi_id === r.id))) : []), [data, ctx.dir, ctx.profiles]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = rows.filter(({ rfi: r, assignees }) => {
    if (filter === 'open' && r.status !== 'open') return false
    if (filter === 'answered' && r.status !== 'answered') return false
    if (filter === 'closed' && !(r.status === 'closed' || r.status === 'void')) return false
    if (trade && r.trade !== trade) return false
    if (who && !assignees.toLowerCase().includes(who.toLowerCase())) return false
    const needle = q.trim().toLowerCase()
    return !needle || `${r.number} ${r.title} ${htmlToText(r.question)} ${assignees}`.toLowerCase().includes(needle)
  })
  const count = (f: Filter) => rows.filter(({ rfi: r }) => (f === 'all' ? true : f === 'closed' ? r.status === 'closed' || r.status === 'void' : r.status === f)).length
  const overdue = rows.filter(({ rfi: r }) => isOverdue(r, today)).length
  const names = [...new Set(rows.flatMap((r) => r.assignees.split(', ')).filter(Boolean))].sort()
  const tradesUsed = [...new Set(rows.map((r) => r.rfi.trade).filter(Boolean) as string[])].sort()

  async function exportAs(kind: 'xlsx' | 'pdf' | 'unanswered') {
    setBusy(true)
    setError(null)
    try {
      // with replies loaded for the report
      const withReplies = await Promise.all(
        (kind === 'unanswered' ? shownOpen() : shown).map(async (row) => {
          const { loadRfi } = await import('../lib/rfis')
          const d = await loadRfi(row.rfi.id)
          return ctx.rowFor(d.rfi, d.people, d.responses)
        }),
      )
      if (kind === 'xlsx') await exportRfisExcel(job, withReplies, filter === 'all' ? 'RFI register' : `RFI register (${filter})`)
      else if (kind === 'pdf') await exportRfisPdf(job, withReplies, filter === 'all' ? 'RFI register' : `RFI register (${filter})`)
      else await exportRfisPdf(job, withReplies, 'Unanswered RFIs')
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  const shownOpen = () => rows.filter(({ rfi: r }) => r.status === 'open')

  return (
    <section className="card rfi-tab">
      <div className="pane-head">
        <h2>RFIs</h2>
        <span className="button-row">
          <button type="button" className="small-button" disabled={busy || !rows.length} onClick={() => exportAs('xlsx')}>
            Excel
          </button>
          <button type="button" className="small-button" disabled={busy || !rows.length} onClick={() => exportAs('pdf')}>
            PDF report
          </button>
          <button type="button" className="small-button" disabled={busy || !shownOpen().length} onClick={() => exportAs('unanswered')} title="A PDF of every RFI still unanswered">
            Unanswered report (PDF)
          </button>
          <button type="button" className="small-button" onClick={() => setTpls(!tpls)} title="This project's templates: who each kind of RFI goes to">
            Templates
          </button>
          <button type="button" className="primary" onClick={() => setCreating(!creating)}>
            + New RFI
          </button>
        </span>
      </div>
      {error && <p className="error">{error}</p>}
      {tpls && ctx.ready && <JobRfiTemplates jobId={job.id} ctx={ctx} me={meNow?.id ?? null} onClose={() => setTpls(false)} />}
      {creating && ctx.ready && (
        <CreateRfi
          ctx={ctx}
          onCancel={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false)
            nudgeEmails()
            navigate(r.id)
          }}
        />
      )}

      <div className="segmented rfi-filters">
        {(
          [
            ['open', 'Open'],
            ['answered', 'Answered'],
            ['closed', 'Closed'],
            ['all', 'All'],
          ] as [Filter, string][]
        ).map(([f, l]) => (
          <button key={f} type="button" className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {l}
            <span className="seg-count">{count(f)}</span>
          </button>
        ))}
        {overdue > 0 && <span className="late rfi-overdue">⚠ {overdue} overdue</span>}
      </div>
      <div className="contractor-filters app-controls">
        <input type="search" placeholder="Search RFIs…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={trade} onChange={(e) => setTrade(e.target.value)} aria-label="Trade">
          <option value="">All trades</option>
          {tradesUsed.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Assigned to">
          <option value="">Anyone</option>
          {names.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </div>

      {data === null && <p className="muted">Loading…</p>}
      {data && rows.length === 0 && !error && <p className="muted">No RFIs yet. Add one with “+ New RFI”.</p>}
      {data && rows.length > 0 && shown.length === 0 && <p className="muted">None match those filters.</p>}
      {shown.length > 0 && (
        <table className="table stack rfi-table">
          <thead>
            <tr>
              <th>RFI</th>
              <th>Title</th>
              <th>Trade</th>
              <th>Assigned to</th>
              <th>Manager</th>
              <th>Due</th>
              <th>Status</th>
              <th className="num">Open</th>
              <th>Chase</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ rfi: r, assignees, manager }) => (
              <tr key={r.id} className="clickable" onClick={() => navigate(r.id)}>
                <td className="stack-title">
                  <strong>RFI {r.number}</strong>
                </td>
                <td data-label="Title">{r.title}</td>
                <td data-label="Trade">{r.trade ?? ''}</td>
                <td data-label="Assigned to">{assignees || <span className="muted">–</span>}</td>
                <td data-label="Manager">{manager}</td>
                <td data-label="Due" className={isOverdue(r, today) ? 'late' : ''}>
                  {r.due_date ? ukDate(r.due_date) : '–'}
                  {isOverdue(r, today) ? ' ⚠' : ''}
                </td>
                <td data-label="Status">
                  <span className={`q-status rfi-${r.status}`}>{STATUS_LABELS[r.status]}</span>
                </td>
                <td className="num" data-label="Open">
                  {daysOpen(r, today)}d
                </td>
                <td data-label="Chase">{chaseLabel(r.chase_days)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// ---------- Create RFI (the form as the screenshot) ----------
function CreateRfi({ ctx, onCancel, onCreated }: { ctx: ReturnType<typeof useRfiContext>; onCancel: () => void; onCreated: (r: Rfi) => void }) {
  const { job } = useJob()
  const { me } = useAccess()
  const [f, setF] = useState({
    template_id: '',
    number: '',
    status: 'open' as RfiStatus,
    title: '',
    question: '',
    trade: '',
    manager_id: me?.id ?? '',
    due_date: '',
    received_from: '',
    chase_days: 7,
    notify: true,
  })
  const [assignees, setAssignees] = useState<string[]>([])
  const [cc, setCc] = useState<string[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((c) => ({ ...c, [k]: v }))

  useEffect(() => {
    nextNumber(job.id).then((n) => setF((c) => ({ ...c, number: c.number || String(n) })))
  }, [job.id])

  function applyTemplate(id: string) {
    const t = ctx.templates.find((x) => x.id === id)
    if (!t) return set('template_id', '')
    const filled = fillFromTemplate(t, ctx.dir, ctx.team, me?.id ?? null)
    setF((c) => ({
      ...c,
      template_id: id,
      title: filled.title || c.title,
      question: filled.question || c.question,
      trade: filled.trade || c.trade,
      manager_id: filled.managerId ?? c.manager_id,
      due_date: filled.dueDate || c.due_date,
      chase_days: filled.chaseDays,
    }))
    setAssignees(filled.assignees.map(keyOf))
    setCc(filled.cc.map(keyOf))
    setMissing(filled.missing)
  }

  const managers = useMemo(() => {
    const team = new Set(ctx.team.map((m) => m.profile_id))
    return [...ctx.profiles.filter((p) => team.has(p.id)), ...ctx.profiles.filter((p) => !team.has(p.id))]
  }, [ctx.profiles, ctx.team])

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!f.title.trim()) return setError('The title is needed.')
    if (!htmlToText(f.question)) return setError('The question is needed.')
    if (!assignees.length) return setError('Pick at least one assignee.')
    if (!f.manager_id) return setError('Pick the RFI manager.')
    setBusy(true)
    try {
      const r = await createRfi(
        {
          job_id: job.id,
          number: f.number ? Number(f.number) : null,
          title: f.title.trim(),
          question: f.question,
          status: f.status,
          trade: f.trade.trim() || null,
          manager_id: f.manager_id,
          due_date: f.due_date || null,
          received_from: f.received_from || null,
          notify: f.notify,
          chase_days: f.chase_days,
          template_id: f.template_id || null,
          assignees: assignees.map(refOf),
          cc: cc.map(refOf),
        },
        files,
      )
      onCreated(r)
    } catch (x) {
      setError(saveError(x))
      setBusy(false)
    }
  }

  return (
    <form className="rfi-form" onSubmit={save}>
      <h3 className="sub-head">Create RFI</h3>
      <label>
        Template
        <select value={f.template_id} onChange={(e) => applyTemplate(e.target.value)}>
          <option value="">No template</option>
          {ctx.templates.some((t) => t.job_id) && (
            <optgroup label="This project">
              {ctx.templates
                .filter((t) => t.job_id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </optgroup>
          )}
          <optgroup label="Standard (people filled in by role)">
            {ctx.templates
              .filter((t) => !t.job_id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </optgroup>
        </select>
        {assignees.length > 0 && (
          <button
            type="button"
            className="small-button quick-add-btn"
            onClick={async () => {
              const name = prompt('Save these people as a template for this project. Name it:', f.trade ? `${f.trade} RFI` : '')
              if (!name?.trim()) return
              try {
                await saveTemplate({
                  name: name.trim(),
                  job_id: job.id,
                  trade: f.trade.trim() || null,
                  manager_id: f.manager_id || null,
                  assignee_keys: assignees,
                  cc_keys: cc,
                  assignee_roles: [],
                  cc_roles: [],
                  title_prefix: null,
                  question: htmlToText(f.question) || null,
                  due_days: null,
                  chase_days: f.chase_days,
                })
                await ctx.reload()
                setError(null)
              } catch (x) {
                setError(saveError(x))
              }
            }}
          >
            Save these people as a template for this project
          </button>
        )}
        {missing.length > 0 && <span className="hint warn">No one on this job is set as: {missing.join(', ')}. Add them in the Project directory, or pick people below.</span>}
      </label>
      <div className="form-grid">
        <label>
          Number *
          <input type="number" value={f.number} onChange={(e) => set('number', e.target.value)} />
        </label>
        <label>
          Status
          <select value={f.status} onChange={(e) => set('status', e.target.value as RfiStatus)}>
            <option value="open">Open</option>
            <option value="answered">Answered</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label className="span-2">
          Title *
          <input value={f.title} onChange={(e) => set('title', e.target.value)} />
        </label>
        <div className="span-2 rfi-field">
          <span className="label">Question *</span>
          <RichTextEditor value={f.question} onChange={(h) => set('question', h)} placeholder="Enter your question…" />
        </div>
        <div className="span-2 rfi-field">
          <span className="label">Assignees *</span>
          <PeoplePicker whos={ctx.whos} value={assignees} onChange={setAssignees} placeholder="Select at least one assignee" />
        </div>
        <label>
          RFI manager *
          <select value={f.manager_id} onChange={(e) => set('manager_id', e.target.value)}>
            <option value="">Choose…</option>
            {managers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due date
          <input type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} />
        </label>
        <label>
          Received from
          <select value={f.received_from} onChange={(e) => set('received_from', e.target.value)}>
            <option value="">Select received from</option>
            {ctx.dir.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.company}
                {p.role ? ' · ' + p.role : ''})
              </option>
            ))}
          </select>
        </label>
        <label>
          Specification section (trade)
          <SuggestInput
            value={f.trade}
            onChange={(v) => set('trade', v)}
            options={ctx.trades}
            placeholder="Select specification section"
            onAdd={(v) => addTrade(v).then(() => ctx.setTrades((l) => [...l, v.trim()]), () => {})}
          />
        </label>
        <div className="span-2 rfi-field">
          <span className="label">Cc</span>
          <PeoplePicker whos={ctx.whos} value={cc} onChange={setCc} placeholder="Select Cc" />
        </div>
        <label>
          Chase
          <select value={f.chase_days} onChange={(e) => set('chase_days', Number(e.target.value))}>
            {CHASE_OPTIONS.map(([n, l]) => (
              <option key={n} value={n}>
                {l}
              </option>
            ))}
          </select>
          <span className="hint">Unanswered: the RFI manager and assignees are chased this often</span>
        </label>
        <div className="rfi-field">
          <span className="label">Attachments</span>
          <label className="file-button">
            <input type="file" multiple onChange={(e) => (setFiles((l) => [...l, ...(e.target.files ?? [])]), (e.target.value = ''))} />
            <span className="button">+ Add attachments</span>
          </label>
          {files.map((x, i) => (
            <span key={i} className="var-file">
              {x.name}{' '}
              <button type="button" className="small-button" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="form-actions rfi-actions">
        <button className="primary" disabled={busy}>
          {busy ? 'Creating…' : f.notify ? 'Create and send emails' : 'Create RFI'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <label className="rfi-notify" title="DBP people are emailed straight away. Outside assignees are emailed once outside access is switched on; until then it waits for them.">
          <input type="checkbox" checked={f.notify} onChange={(e) => set('notify', e.target.checked)} /> Email notifications
        </label>
      </div>
    </form>
  )
}
