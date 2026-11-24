import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ukDate, todayIso } from '../lib/format'
import { saveError } from '../lib/offline'
import { useAccess } from '../lib/access'
import { nudgeEmails } from '../lib/notifications'
import { useJob } from './JobLayout'
import { CHASE_OPTIONS, addTrade, chaseLabel } from '../lib/rfis'
import { keyOf, refOf, useRfiContext } from '../lib/rfiContext'
import { htmlToText } from '../lib/richText'
import {
  SUBMITTAL_STATUS,
  TYPES,
  createSubmittal,
  daysOut,
  fillSubmittalTemplate,
  isLate,
  loadSubmittal,
  loadSubmittalTemplates,
  loadSubmittals,
  nextSubmittalNumber,
  revName,
  saveSubmittalTemplate,
  typeLabel,
  type Submittal,
  type SubmittalPerson,
  type SubmittalStatus,
  type SubmittalTemplate,
  type SubmittalType,
} from '../lib/submittals'
import { exportSubmittalsExcel, exportSubmittalsPdf, type SubmittalRow } from '../lib/exportSubmittals'
import RichTextEditor from '../components/RichTextEditor'
import PeoplePicker from '../components/PeoplePicker'
import SuggestInput from '../components/SuggestInput'
import SubmittalTemplates from '../components/SubmittalTemplates'
import Loading from '../components/Loading'

type Filter = 'draft' | 'out' | 'answered' | 'revise' | 'all'
const ANSWERED: SubmittalStatus[] = ['approved', 'approved_noted']

// Job › Submittals (23 Nov, script 060): the register, with Excel and PDF reports, and the Create form.
export default function SubmittalsTab() {
  const { job } = useJob()
  const owner = useMemo(() => ({ kind: 'job' as const, id: job.id }), [job.id])
  const reportOwner = { ref: `${job.job_no} ${job.code}`, name: job.name }
  const navigate = useNavigate()
  const ctx = useRfiContext(owner)
  const { me } = useAccess()
  const [data, setData] = useState<{ items: Submittal[]; people: SubmittalPerson[]; files: Record<string, number> } | null>(null)
  const [templates, setTemplates] = useState<SubmittalTemplate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [tpls, setTpls] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [trade, setTrade] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const today = todayIso()

  const load = () => loadSubmittals(job.id).then(setData, (e: Error) => (setError(e.message), setData({ items: [], people: [], files: {} })))
  const loadTpl = () => loadSubmittalTemplates(job.id).then(setTemplates)
  useEffect(() => {
    load()
    loadTpl()
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const rowFor = (s: Submittal, people: SubmittalPerson[], revisions: SubmittalRow['revisions'] = []): SubmittalRow => {
    const sb = ctx.dir.find((d) => d.id === s.submitted_by)
    return {
      s,
      submittedBy: sb ? `${sb.name}${sb.company && sb.company !== sb.name ? ` (${sb.company})` : ''}` : '',
      reviewers: people.filter((p) => p.role === 'reviewer').map(ctx.nameOf).filter(Boolean).join(', '),
      cc: people.filter((p) => p.role === 'cc').map(ctx.nameOf).filter(Boolean).join(', '),
      manager: ctx.profileName(s.manager_id),
      revisions,
    }
  }
  const rows = useMemo(() => (data ? data.items.map((s) => rowFor(s, data.people.filter((p) => p.submittal_id === s.id))) : []), [data, ctx.dir, ctx.profiles]) // eslint-disable-line react-hooks/exhaustive-deps
  const inFilter = (s: Submittal, f: Filter) =>
    f === 'all' ? true : f === 'draft' ? s.status === 'draft' : f === 'out' ? s.status === 'out' : f === 'revise' ? s.status === 'revise' || s.status === 'rejected' : ANSWERED.includes(s.status)
  const shown = rows.filter(({ s, submittedBy, reviewers }) => {
    if (!inFilter(s, filter)) return false
    if (trade && s.trade !== trade) return false
    const needle = q.trim().toLowerCase()
    return !needle || `${s.number} ${s.title} ${htmlToText(s.description)} ${submittedBy} ${reviewers}`.toLowerCase().includes(needle)
  })
  const late = rows.filter(({ s }) => isLate(s, today)).length
  const tradesUsed = [...new Set(rows.map((r) => r.s.trade).filter(Boolean) as string[])].sort()

  async function exportAs(kind: 'xlsx' | 'pdf' | 'outstanding') {
    setBusy(true)
    setError(null)
    try {
      const list = kind === 'outstanding' ? rows.filter((r) => r.s.status === 'out') : shown
      const full = await Promise.all(
        list.map(async (r) => {
          const d = await loadSubmittal(r.s.id)
          return rowFor(d.s, d.people, d.revisions)
        }),
      )
      const label = filter === 'all' || kind === 'outstanding' ? '' : ` (${filterLabel(filter)})`
      if (kind === 'xlsx') await exportSubmittalsExcel(reportOwner, full, `Submittal register${label}`)
      else if (kind === 'pdf') await exportSubmittalsPdf(reportOwner, full, `Submittal register${label}`)
      else await exportSubmittalsPdf(reportOwner, full, 'Submittals out for review')
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  const filterLabel = (f: Filter) => ({ draft: 'drafts', out: 'out for review', answered: 'approved', revise: 'to revise', all: 'all' })[f]

  return (
    <section className="card rfi-tab">
      <div className="pane-head">
        <h2>Submittals</h2>
        <span className="button-row">
          <button type="button" className="small-button" disabled={busy || !rows.length} onClick={() => exportAs('xlsx')}>
            Excel
          </button>
          <button type="button" className="small-button" disabled={busy || !rows.length} onClick={() => exportAs('pdf')}>
            PDF report
          </button>
          <button type="button" className="small-button" disabled={busy || !rows.some((r) => r.s.status === 'out')} onClick={() => exportAs('outstanding')} title="A PDF of every submittal still out for review">
            Outstanding report (PDF)
          </button>
          <button type="button" className="small-button" onClick={() => setTpls(!tpls)} title="This project's templates: who each kind of submittal is submitted by and reviewed by">
            Templates
          </button>
          <button type="button" className="primary" onClick={() => setCreating(!creating)}>
            + New submittal
          </button>
        </span>
      </div>
      {error && <p className="error">{error}</p>}
      {tpls && ctx.ready && <SubmittalTemplates jobId={job.id} ctx={ctx} templates={templates} reload={loadTpl} me={me?.id ?? null} onClose={() => setTpls(false)} />}
      {creating && ctx.ready && (
        <CreateSubmittal
          jobId={job.id}
          ctx={ctx}
          templates={templates}
          reloadTemplates={loadTpl}
          onCancel={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false)
            nudgeEmails()
            navigate(s.id)
          }}
        />
      )}

      <div className="segmented rfi-filters">
        {(
          [
            ['draft', 'Drafts'],
            ['out', 'Out for review'],
            ['revise', 'To revise'],
            ['answered', 'Approved'],
            ['all', 'All'],
          ] as [Filter, string][]
        ).map(([f, l]) => (
          <button key={f} type="button" className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {l}
            <span className="seg-count">{rows.filter((r) => inFilter(r.s, f)).length}</span>
          </button>
        ))}
        {late > 0 && <span className="late rfi-overdue">⚠ {late} overdue</span>}
      </div>
      <div className="contractor-filters app-controls">
        <input type="search" placeholder="Search submittals…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={trade} onChange={(e) => setTrade(e.target.value)} aria-label="Trade">
          <option value="">All trades</option>
          {tradesUsed.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>

      {data === null && <Loading />}
      {data && rows.length === 0 && !error && <p className="muted">No submittals yet. Add one with “+ New submittal”.</p>}
      {data && rows.length > 0 && shown.length === 0 && <p className="muted">None match those filters.</p>}
      {shown.length > 0 && (
        <table className="table stack rfi-table">
          <thead>
            <tr>
              <th>No.</th>
              <th>Title</th>
              <th>Type</th>
              <th>Trade</th>
              <th>Submitted by</th>
              <th>Rev</th>
              <th>Return by</th>
              <th>Status</th>
              <th className="num">Out</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ s, submittedBy }) => (
              <tr key={s.id} className="clickable" onClick={() => navigate(s.id)}>
                <td className="stack-title">
                  <strong>S{s.number}</strong>
                </td>
                <td data-label="Title">
                  {s.title}
                  {data?.files[s.id] ? (
                    <span className="attach-badge" title={`${data.files[s.id]} file${data.files[s.id] === 1 ? '' : 's'} attached`}>
                      📎 {data.files[s.id]}
                    </span>
                  ) : (
                    s.status === 'draft' && <span className="attach-badge none" title="Nothing attached yet: it can't be sent out without a document">no attachment</span>
                  )}
                </td>
                <td data-label="Type">{typeLabel(s.type)}</td>
                <td data-label="Trade">{s.trade ?? ''}</td>
                <td data-label="Submitted by">{submittedBy || <span className="muted">–</span>}</td>
                <td data-label="Rev">{revName(s.current_rev, s.rev_label)}</td>
                <td data-label="Return by" className={isLate(s, today) ? 'late' : ''}>
                  {s.due_date ? ukDate(s.due_date) : '–'}
                  {isLate(s, today) ? ' ⚠' : ''}
                </td>
                <td data-label="Status">
                  <span className={`q-status sub-${s.status}`}>{SUBMITTAL_STATUS[s.status]}</span>
                </td>
                <td className="num" data-label="Out">
                  {s.submitted_at ? `${daysOut(s, today)}d` : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// ---------- Create submittal ----------
function CreateSubmittal({
  jobId,
  ctx,
  templates,
  reloadTemplates,
  onCancel,
  onCreated,
}: {
  jobId: string
  ctx: ReturnType<typeof useRfiContext>
  templates: SubmittalTemplate[]
  reloadTemplates: () => void
  onCancel: () => void
  onCreated: (s: Submittal) => void
}) {
  const { me } = useAccess()
  const [f, setF] = useState({
    template_id: '',
    number: '',
    type: 'shop_drawing' as SubmittalType,
    title: '',
    description: '',
    trade: '',
    manager_id: me?.id ?? '',
    due_date: '',
    required_by: '',
    chase_days: 7,
    notify: true,
  })
  const [submitter, setSubmitter] = useState<string[]>([])
  const [reviewers, setReviewers] = useState<string[]>([])
  const [cc, setCc] = useState<string[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((c) => ({ ...c, [k]: v }))
  useEffect(() => {
    nextSubmittalNumber(jobId).then((n) => setF((c) => ({ ...c, number: c.number || String(n) })))
  }, [jobId])
  const outside = ctx.whos.filter((w) => w.external)

  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id)
    if (!t) return set('template_id', '')
    const valid = new Set(ctx.whos.map((w) => w.key))
    const x = fillSubmittalTemplate(t, valid, me?.id ?? null)
    setF((c) => ({ ...c, template_id: id, type: x.type, title: x.title || c.title, trade: x.trade || c.trade, manager_id: x.managerId ?? c.manager_id, due_date: x.dueDate || c.due_date, chase_days: x.chaseDays }))
    setSubmitter(x.submitterKey ? [x.submitterKey] : [])
    setReviewers(x.reviewers)
    setCc(x.cc)
    setNote(x.dropped ? `${x.dropped} ${x.dropped === 1 ? 'person' : 'people'} in that template ${x.dropped === 1 ? 'is' : 'are'} no longer on this job and ${x.dropped === 1 ? 'was' : 'were'} left out.` : null)
  }
  const managers = useMemo(() => {
    const team = new Set(ctx.team.map((m) => m.profile_id))
    return [...ctx.profiles.filter((p) => team.has(p.id)), ...ctx.profiles.filter((p) => !team.has(p.id))]
  }, [ctx.profiles, ctx.team])

  async function save(e: FormEvent | null, out: boolean) {
    e?.preventDefault()
    setError(null)
    if (!f.title.trim()) return setError('The title is needed.')
    if (out && !reviewers.length) return setError('Pick at least one reviewer to send it out for review (or save it as a draft).')
    if (!f.manager_id) return setError('Pick the DBP manager.')
    if (!f.due_date) return setError('The "return by" date is needed.')
    setBusy(true)
    try {
      const s = await createSubmittal(
        {
          job_id: jobId,
          number: f.number ? Number(f.number) : null,
          title: f.title.trim(),
          description: f.description,
          type: f.type,
          trade: f.trade.trim() || null,
          submitted_by: submitter[0] ? submitter[0].slice(2) : null,
          manager_id: f.manager_id,
          due_date: f.due_date || null,
          required_by: null,
          notify: f.notify,
          chase_days: f.chase_days,
          template_id: null,
          reviewers: reviewers.map(refOf),
          cc: cc.map(refOf),
          out,
        },
        files,
      )
      onCreated(s)
    } catch (x) {
      setError(saveError(x))
      setBusy(false)
    }
  }

  return (
    <form className="rfi-form" onSubmit={(e) => save(e, true)}>
      <h3 className="sub-head">Create submittal</h3>
      <label>
        Template
        <select value={f.template_id} onChange={(e) => applyTemplate(e.target.value)}>
          <option value="">No template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {reviewers.length > 0 && (
          <button
            type="button"
            className="small-button quick-add-btn"
            onClick={async () => {
              const name = prompt('Save these people as a template for this project. Name it:', f.trade ? `${f.trade} ${typeLabel(f.type).toLowerCase()}` : '')
              if (!name?.trim()) return
              try {
                await saveSubmittalTemplate({
                  name: name.trim(),
                  job_id: jobId,
                  type: f.type,
                  trade: f.trade.trim() || null,
                  submitter_key: submitter[0] ?? null,
                  reviewer_keys: reviewers,
                  cc_keys: cc,
                  manager_id: f.manager_id || null,
                  chase_days: f.chase_days,
                })
                reloadTemplates()
              } catch (x) {
                setError(saveError(x))
              }
            }}
          >
            Save these people as a template for this project
          </button>
        )}
        {note && <span className="hint warn">{note}</span>}
      </label>
      <div className="form-grid">
        <label>
          Number *
          <input type="number" value={f.number} onChange={(e) => set('number', e.target.value)} />
        </label>
        <label>
          Type
          <select value={f.type} onChange={(e) => set('type', e.target.value as SubmittalType)}>
            {TYPES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Title *
          <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Bar joinery shop drawings" />
        </label>
        <div className="span-2 rfi-field">
          <span className="label">Description</span>
          <RichTextEditor value={f.description} onChange={(h) => set('description', h)} placeholder="What is being submitted, and anything the reviewers need to know…" minHeight={90} />
        </div>
        <label>
          Specification section (trade)
          <SuggestInput value={f.trade} onChange={(v) => set('trade', v)} options={ctx.trades} placeholder="Select specification section" onAdd={(v) => addTrade(v).then(() => ctx.setTrades((l) => [...l, v.trim()]), () => {})} />
        </label>
        <div className="rfi-field">
          <span className="label">Submitted by</span>
          <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={outside} value={submitter} onChange={(v) => setSubmitter(v.slice(-1))} placeholder="Which subcontractor / supplier" />
        </div>
        <div className="span-2 rfi-field">
          <span className="label">Reviewers *</span>
          <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={ctx.whos} value={reviewers} onChange={setReviewers} placeholder="Who reviews it (architect, client, consultant…)" />
        </div>
        <label>
          DBP manager *
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
          Return by *
          <input type="date" required value={f.due_date} onChange={(e) => set('due_date', e.target.value)} />
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
          <span className="hint">Out for review and not answered: the manager and reviewers are chased this often ({chaseLabel(f.chase_days).toLowerCase()})</span>
        </label>
        <div className="rfi-field">
          <span className="label">Attachments (Initial issue)</span>
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
          {busy ? 'Creating…' : f.notify ? 'Send out for review and email' : 'Send out for review'}
        </button>
        <button type="button" disabled={busy} onClick={() => save(null, false)} title="Keep it as a draft: nobody is told or chased until you send it out">
          Save as draft
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <label className="rfi-notify" title="DBP people are emailed straight away. Outside reviewers are emailed once outside access is switched on; until then it waits for them.">
          <input type="checkbox" checked={f.notify} onChange={(e) => set('notify', e.target.checked)} /> Email notifications
        </label>
      </div>
    </form>
  )
}

export { keyOf }
