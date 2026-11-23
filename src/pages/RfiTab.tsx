import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ukDate, todayIso } from '../lib/format'
import { saveError } from '../lib/offline'
import { useAccess } from '../lib/access'
import { ownerKeys, useRfiOwner } from '../lib/rfiOwner'
import { CHASE_OPTIONS, STATUS_LABELS, addTrade, chaseLabel, createRfi, daysOpen, fillFromTemplate, isOverdue, issueRfis, loadRfis, nextNumber, saveTemplate, type Rfi, type RfiPerson, type RfiStatus } from '../lib/rfis'
import { keyOf, refOf, useRfiContext } from '../lib/rfiContext'
import { exportRfisExcel, exportRfisPdf, exportTenderSchedule, tenderScheduleBlob, tenderScheduleName } from '../lib/exportRfis'
import { htmlToText } from '../lib/richText'
import RichTextEditor from '../components/RichTextEditor'
import JobRfiTemplates from '../components/JobRfiTemplates'
import { emlDraft, escHtml } from '../lib/orders'
import { downloadBlob } from '../lib/letter'
import PeoplePicker from '../components/PeoplePicker'
import SuggestInput from '../components/SuggestInput'
import { nudgeEmails } from '../lib/notifications'

type Filter = 'draft' | 'open' | 'answered' | 'closed' | 'all'

// Job › RFIs (23 Nov, script 057): the register, with Excel and PDF reports, and the Create RFI form.
export default function RfiTab() {
  const owner = useRfiOwner()
  const navigate = useNavigate()
  const ctx = useRfiContext(owner)
  const [data, setData] = useState<{ rfis: Rfi[]; people: RfiPerson[]; files: Record<string, number> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const tender = owner.kind === 'enquiry' // tender RFIs: drafted, then issued to the client together as one Excel schedule
  const [filter, setFilter] = useState<Filter>(tender ? 'draft' : 'all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [trade, setTrade] = useState('')
  const [who, setWho] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [tpls, setTpls] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const { me: meNow } = useAccess()
  const today = todayIso()

  const load = () => loadRfis(owner).then(setData, (e: Error) => (setError(e.message), setData({ rfis: [], people: [], files: {} })))
  useEffect(() => {
    load()
  }, [owner.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => (data ? data.rfis.map((r) => ctx.rowFor(r, data.people.filter((p) => p.rfi_id === r.id))) : []), [data, ctx.dir, ctx.profiles]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = rows.filter(({ rfi: r, assignees }) => {
    if (filter === 'draft' && r.status !== 'draft') return false
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
      if (kind === 'xlsx') await exportRfisExcel(owner, withReplies, filter === 'all' ? 'RFI register' : `RFI register (${filter})`)
      else if (kind === 'pdf') await exportRfisPdf(owner, withReplies, filter === 'all' ? 'RFI register' : `RFI register (${filter})`)
      else await exportRfisPdf(owner, withReplies, 'Unanswered RFIs')
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  const shownOpen = () => rows.filter(({ rfi: r }) => r.status === 'open')
  const drafts = rows.filter(({ rfi: r }) => r.status === 'draft')
  // the queries going out: the ticked drafts, or every draft if none are ticked
  const toIssue = () => (picked.size ? drafts.filter((d) => picked.has(d.rfi.id)) : drafts)

  async function scheduleExcel() {
    const list = toIssue()
    if (!list.length) return setError('There are no draft queries to put in a schedule.')
    setBusy(true)
    setError(null)
    try {
      await exportTenderSchedule(owner, list)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  // the schedule as an Outlook draft to the client with the Excel attached; then the drafts are marked issued
  async function emailToClient() {
    const list = toIssue()
    if (!list.length) return setError('There are no draft queries to send.')
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      const blob = await tenderScheduleBlob(owner, list)
      const c = owner.client
      const greeting = c?.contact ? `Dear ${escHtml(c.contact.split(' ')[0])},` : 'Dear Sir or Madam,'
      const html = [
        `<p>${greeting}</p>`,
        `<p>Please find attached our schedule of tender queries for <b>${escHtml(owner.name)}</b> (${list.length} quer${list.length === 1 ? 'y' : 'ies'}).</p>`,
        '<p>Please complete the Response column and return the schedule to us, so we can finalise our tender.</p>',
        '<p>Kind regards,</p>',
        `<p>${escHtml(meNow?.full_name ?? '')}${meNow?.job_title ? '<br>' + escHtml(meNow.job_title) : ''}<br>du Boulay Projects Limited</p>`,
      ].join('')
      const eml = await emlDraft({ to: c?.email ? [c.email] : [], subject: `${owner.ref} ${owner.name}: tender queries`, html, attachments: [{ name: tenderScheduleName(owner), blob }] })
      downloadBlob(eml, `${owner.ref} tender queries email.eml`)
      if (confirm(`Downloaded the email: open it and it opens in Outlook with the schedule attached${c?.email ? '' : ' (there is no client email on the enquiry: add it in Outlook)'}.\n\nMark these ${list.length} quer${list.length === 1 ? 'y' : 'ies'} as issued to the client?`)) {
        await issueRfis(list.map((x) => x.rfi.id))
        setPicked(new Set())
        await load()
        setMsg(`${list.length} quer${list.length === 1 ? 'y' : 'ies'} marked as issued. They now show under Out to the client.`)
      }
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

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
          {!tender && (
            <>
              <button type="button" className="small-button" disabled={busy || !shownOpen().length} onClick={() => exportAs('unanswered')} title="A PDF of every RFI still unanswered">
                Unanswered report (PDF)
              </button>
              <button type="button" className="small-button" onClick={() => setTpls(!tpls)} title="This project's templates: who each kind of RFI goes to">
                Templates
              </button>
            </>
          )}
          {tender && (
            <>
              <button type="button" className="small-button" disabled={busy || !drafts.length} onClick={scheduleExcel} title="The draft queries as an Excel schedule for the client">
                Excel schedule
              </button>
              <button type="button" className="primary" disabled={busy || !drafts.length} onClick={emailToClient} title="An Outlook draft to the client with the Excel schedule attached">
                Email schedule to client…
              </button>
            </>
          )}
          <button type="button" className="primary" onClick={() => setCreating(!creating)}>
            + New RFI
          </button>
        </span>
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      {tender && drafts.length > 0 && filter === 'draft' && (
        <p className="muted small">
          Draft your queries here, then <strong>Email schedule to client</strong> sends them all as one Excel ({owner.client?.email ? `to ${owner.client.email}` : 'no client email on the enquiry yet'}). Tick some to send only those; otherwise every draft goes.
        </p>
      )}
      {tpls && ctx.ready && <JobRfiTemplates owner={owner} ctx={ctx} me={meNow?.id ?? null} onClose={() => setTpls(false)} />}
      {creating && tender && (
        <CreateTenderRfi
          onCancel={() => setCreating(false)}
          onSaved={(more) => {
            if (!more) setCreating(false)
            load()
          }}
        />
      )}
      {creating && !tender && ctx.ready && (
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
            ...(tender ? ([['draft', 'Drafts']] as [Filter, string][]) : []),
            ['open', tender ? 'Out to the client' : 'Open'],
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
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Assigned to" hidden={tender}>
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
              {tender && (
                <th>
                  <input
                    type="checkbox"
                    aria-label="Tick all drafts"
                    checked={drafts.length > 0 && picked.size === drafts.length}
                    onChange={(e) => setPicked(e.target.checked ? new Set(drafts.map((d) => d.rfi.id)) : new Set())}
                  />
                </th>
              )}
              <th>RFI</th>
              <th>Title</th>
              <th>Trade</th>
              {!tender && <th>Assigned to</th>}
              {!tender && <th>Manager</th>}
              <th>{tender ? 'Response needed by' : 'Due'}</th>
              <th>Status</th>
              {!tender && <th className="num">Open</th>}
              {!tender && <th>Chase</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ rfi: r, assignees, manager }) => (
              <tr key={r.id} className="clickable" onClick={() => navigate(r.id)}>
                {tender && (
                  <td onClick={(e) => e.stopPropagation()}>
                    {r.status === 'draft' && (
                      <input
                        type="checkbox"
                        aria-label={`Tick RFI ${r.number}`}
                        checked={picked.has(r.id)}
                        onChange={(e) => setPicked((s) => (e.target.checked ? new Set([...s, r.id]) : new Set([...s].filter((x) => x !== r.id))))}
                      />
                    )}
                  </td>
                )}
                <td className="stack-title">
                  <strong>RFI {r.number}</strong>
                </td>
                <td data-label="Title">
                  {r.title}
                  {!!data?.files[r.id] && (
                    <span className="attach-badge" title={`${data.files[r.id]} file${data.files[r.id] === 1 ? '' : 's'} attached`}>
                      📎 {data.files[r.id]}
                    </span>
                  )}
                </td>
                <td data-label="Trade">{r.trade ?? ''}</td>
                {!tender && <td data-label="Assigned to">{assignees || <span className="muted">–</span>}</td>}
                {!tender && <td data-label="Manager">{manager}</td>}
                <td data-label="Due" className={isOverdue(r, today) ? 'late' : ''}>
                  {r.due_date ? ukDate(r.due_date) : '–'}
                  {isOverdue(r, today) ? ' ⚠' : ''}
                </td>
                <td data-label="Status">
                  <span className={`q-status rfi-${r.status}`}>{STATUS_LABELS[r.status]}</span>
                </td>
                {!tender && (
                  <td className="num" data-label="Open">
                    {daysOpen(r, today)}d
                  </td>
                )}
                {!tender && <td data-label="Chase">{chaseLabel(r.chase_days)}</td>}
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
  const owner = useRfiOwner()
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
    nextNumber(owner).then((n) => setF((c) => ({ ...c, number: c.number || String(n) })))
  }, [owner.id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  async function save(e: FormEvent | null, asDraft = false) {
    e?.preventDefault()
    setError(null)
    if (!f.title.trim()) return setError('The title is needed.')
    if (!htmlToText(f.question)) return setError('The question is needed.')
    if (!asDraft && !assignees.length) return setError('Pick at least one assignee (or save it as a draft).')
    if (!f.manager_id) return setError('Pick the RFI manager.')
    if (!asDraft && !f.due_date) return setError('Set a "reply by" date (or save it as a draft).')
    setBusy(true)
    try {
      const r = await createRfi(
        {
          ...ownerKeys(owner),
          number: f.number ? Number(f.number) : null,
          title: f.title.trim(),
          question: f.question,
          status: asDraft ? 'draft' : f.status,
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
    <form className="rfi-form" onSubmit={(e) => save(e)}>
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
                  ...ownerKeys(owner),
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
        {missing.length > 0 && <span className="hint warn">No one on this {owner.kind === 'job' ? 'job' : 'enquiry'} is set as: {missing.join(', ')}. Add them in the Project directory, or pick people below.</span>}
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
          <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={ctx.whos} value={assignees} onChange={setAssignees} placeholder="Select at least one assignee" />
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
          <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={ctx.whos} value={cc} onChange={setCc} placeholder="Select Cc" />
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
        <button type="button" disabled={busy} onClick={() => save(null, true)} title="Keep it as a draft: nobody is told or chased until you issue it">
          Save as draft
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

// ---------- a tender query: just the question (they all go to the client, together, as one Excel schedule) ----------
function CreateTenderRfi({ onCancel, onSaved }: { onCancel: () => void; onSaved: (more: boolean) => void }) {
  const owner = useRfiOwner()
  const { me } = useAccess()
  const ctx = useRfiContext(owner)
  const [f, setF] = useState({ number: '', title: '', question: '', trade: '', due_date: '' })
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(0) // new editor for "save and add another"
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((c) => ({ ...c, [k]: v }))
  useEffect(() => {
    nextNumber(owner).then((n) => setF((c) => ({ ...c, number: c.number || String(n) })))
  }, [owner.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(more: boolean) {
    setError(null)
    if (!f.title.trim()) return setError('Give the query a subject.')
    if (!htmlToText(f.question)) return setError('Write the query.')
    setBusy(true)
    try {
      await createRfi(
        {
          ...ownerKeys(owner),
          number: f.number ? Number(f.number) : null,
          title: f.title.trim(),
          question: f.question,
          status: 'draft',
          trade: f.trade.trim() || null,
          manager_id: me?.id ?? null,
          due_date: f.due_date || null,
          received_from: null,
          notify: false,
          chase_days: 0,
          template_id: null,
          assignees: [],
          cc: [],
        },
        files,
      )
      if (more) {
        setF({ number: String((Number(f.number) || 0) + 1), title: '', question: '', trade: f.trade, due_date: f.due_date })
        setFiles([])
        setKey((k) => k + 1)
      }
      onSaved(more)
    } catch (x) {
      setError(saveError(x))
    }
    setBusy(false)
  }

  return (
    <div className="rfi-form">
      <h3 className="sub-head">New tender query (draft)</h3>
      <div className="form-grid">
        <label>
          No.
          <input type="number" value={f.number} onChange={(e) => set('number', e.target.value)} />
        </label>
        <label>
          Specification section (trade)
          <SuggestInput value={f.trade} onChange={(v) => set('trade', v)} options={ctx.trades} placeholder="e.g. Mechanical" onAdd={(v) => addTrade(v).then(() => ctx.setTrades((l) => [...l, v.trim()]), () => {})} />
        </label>
        <label className="span-2">
          Subject *
          <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Ceiling void depth at level 2" />
        </label>
        <div className="span-2 rfi-field">
          <span className="label">Query *</span>
          <RichTextEditor key={key} value={f.question} onChange={(h) => set('question', h)} placeholder="Write the query for the client…" />
        </div>
        <label>
          Response needed by
          <input type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} />
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
      <div className="form-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => save(false)}>
          {busy ? 'Saving…' : 'Save draft'}
        </button>
        <button type="button" disabled={busy} onClick={() => save(true)}>
          Save and add another
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
