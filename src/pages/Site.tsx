import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { addDaysIso, money, todayIso, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { useNotifications } from '../lib/notifications'
import { useAccess } from '../lib/access'
import { NoAccess } from '../components/NoAccess'
import {
  OPEN_STATUSES,
  REQ_STATUS_LABELS,
  addFile,
  fileUrl,
  jobLabel,
  loadRequisition,
  loadRequisitions,
  loadSites,
  me,
  postMessage,
  raiseRequisition,
  removeFile,
  reqRef,
  updateRequisition,
  type ReqFile,
  type ReqKind,
  type ReqMessage,
  type ReqStatus,
  type Requisition,
} from '../lib/requisitions'
import type { Job } from '../lib/types'

// Site (renamed from "Project management", 22 Nov): what site raises and the buyer works. Material
// requisitions now, hire requisitions next. The material and hire buyer's lists (the back ends) show only to
// Operations logins and admins (script 034; the database enforces it too).

function SiteNav() {
  const { can } = useAccess()
  return (
    <>
      <h1>Site</h1>
      {/* the two forms, big (22 Nov: "make the material and hire requisition buttons more prominent") */}
      <div className="req-big">
        <NavLink to="/site/requisitions/new" className="req-big-button">
          <span className="req-big-icon">📦</span>
          <span>
            <strong>Material requisition</strong>
            <small>Request materials to site</small>
          </span>
        </NavLink>
        <span className="req-big-button disabled" title="Coming next">
          <span className="req-big-icon">🏗️</span>
          <span>
            <strong>
              Hire requisition <span className="soon">soon</span>
            </strong>
            <small>Plant and tool hire</small>
          </span>
        </span>
      </div>
      <nav className="pills">
        <NavLink to="/site" end className="pill">
          My requisitions
        </NavLink>
        {can('buyer_material') && (
          <NavLink to="/site/buyer/material" className="pill">
            Material buyer's list
          </NavLink>
        )}
        {can('buyer_hire') && (
          <NavLink to="/site/buyer/hire" className="pill">
            Hire buyer's list
          </NavLink>
        )}
      </nav>
    </>
  )
}

// add files: from the phone's camera straight away (iPhone / Android), or photos and files already on it
function AddFiles({ onFiles, disabled, label = 'Choose files…' }: { onFiles: (files: File[]) => void; disabled?: boolean; label?: string }) {
  const take = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (files.length) onFiles(files)
  }
  return (
    <span className="req-add-files">
      <label className="file-button">
        <input type="file" accept="image/*" capture="environment" disabled={disabled} onChange={(e) => take(e.target)} />
        <span className="button small-button primary">📷 Take photo</span>
      </label>
      <label className="file-button">
        <input type="file" multiple disabled={disabled} onChange={(e) => take(e.target)} />
        <span className="button small-button">{label}</span>
      </label>
    </span>
  )
}

const statusTag = (s: ReqStatus) => <span className={`tag req-${s}`}>{REQ_STATUS_LABELS[s]}</span>

// ---------- my requisitions (the site manager's view) ----------
export default function Site() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Requisition[] | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    me().then((u) => (u ? loadRequisitions({ mine: u.id }).then(setRows, (e: Error) => setError(e.message)) : setRows([])))
    loadSites().then(setJobs, () => {})
  }, [])
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs])

  return (
    <>
      <SiteNav />
      <section className="card">
        <div className="pane-head">
          <h2>My requisitions</h2>
          <Link to="/site/requisitions/new" className="button primary">
            + Material requisition
          </Link>
        </div>
        {error && <p className="error">{error}</p>}
        {rows === null && !error && <p className="muted">Loading…</p>}
        {rows && rows.length === 0 && <p className="muted">You haven't raised any requisitions yet.</p>}
        {rows && rows.length > 0 && (
          <table className="table stack">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Site</th>
                <th>Element of work</th>
                <th>Required by</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/site/requisitions/${r.id}`)}>
                  <td className="stack-title nowrap">
                    <strong>{reqRef(r)}</strong>
                  </td>
                  <td className="stack-sub">{jobLabel(jobById.get(r.job_id))}</td>
                  <td data-label="Element">{r.element}</td>
                  <td className="nowrap" data-label="Required by">
                    {ukDate(r.required_by)}
                  </td>
                  <td data-label="Status">{statusTag(r.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

// ---------- the form (its own link: /site/requisitions/new) ----------
export function MaterialRequisitionForm() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [form, setForm] = useState({ job_id: params.get('job') ?? '', element: '', details: '', required_by: addDaysIso(todayIso(), 3), notes: '' }) // 22 Nov: 3 days from now unless changed
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadSites().then(setJobs, (e: Error) => setError(e.message))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    if (form.required_by < todayIso()) return setError('The date required by is in the past.')
    setBusy(true)
    try {
      const r = await raiseRequisition(
        { kind: 'material', job_id: form.job_id, element: form.element.trim(), details: form.details.trim(), required_by: form.required_by, notes: form.notes.trim() || null },
        files,
      )
      navigate(`/site/requisitions/${r.id}?sent=1`)
    } catch (err) {
      setError(saveError(err))
      setBusy(false)
    }
  }
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v })

  return (
    <>
      <SiteNav />
      <form className="card form req-form" onSubmit={submit}>
        <h2>Material requisition</h2>
        <p className="muted small intro">Use this form to request materials to site. Your name and email are added for you.</p>
        <div className="form-grid">
          <label className="span-2">
            Site name *
            <select value={form.job_id} onChange={(e) => set('job_id', e.target.value)} required>
              <option value="">{jobs ? 'Choose the site…' : 'Loading…'}</option>
              {(jobs ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  {jobLabel(j)}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            Element of work *
            <input value={form.element} placeholder="e.g. Partitioning" onChange={(e) => set('element', e.target.value)} required />
          </label>
          <label className="span-2">
            Materials required *
            <textarea
              rows={6}
              value={form.details}
              placeholder="Enter as much information as possible (include links): product, size, quantity…"
              onChange={(e) => set('details', e.target.value)}
              required
            />
          </label>
          <label>
            Date required by *
            <input type="date" min={todayIso()} value={form.required_by} onChange={(e) => set('required_by', e.target.value)} required />
          </label>
          <label className="span-2">
            Notes
            <textarea rows={3} value={form.notes} placeholder="Booking systems, time restrictions etc." onChange={(e) => set('notes', e.target.value)} />
          </label>
          <div className="span-2 req-attach">
            <span className="label-text">Attachments</span>
            <AddFiles onFiles={(more) => setFiles([...files, ...more])} />
          </div>
          {files.length > 0 && (
            <ul className="req-files span-2">
              {files.map((f, i) => (
                <li key={i}>
                  {f.name}{' '}
                  <button type="button" className="link-button small" onClick={() => setFiles(files.filter((_, k) => k !== i))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button className="primary" disabled={busy}>
            {busy ? 'Sending…' : 'Submit requisition'}
          </button>
          <Link to="/site" className="button">
            Cancel
          </Link>
        </div>
      </form>
    </>
  )
}

// ---------- the buyer's list (the back end, across all jobs) ----------
type Filter = 'open' | 'query' | 'ordered' | 'delivered' | 'all'
const FILTERS: [Filter, string][] = [
  ['open', 'Open'],
  ['query', 'Awaiting answer'],
  ['ordered', 'Ordered'],
  ['delivered', 'Delivered'],
  ['all', 'All'],
]
const inFilter = (f: Filter, s: ReqStatus) => (f === 'all' ? true : f === 'open' ? OPEN_STATUSES.includes(s) && s !== 'ordered' : s === f)

export function BuyerList() {
  const { kind: kindParam } = useParams()
  const kind: ReqKind = kindParam === 'hire' ? 'hire' : 'material'
  const { can } = useAccess()
  const navigate = useNavigate()
  const [rows, setRows] = useState<Requisition[] | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [jobId, setJobId] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    setRows(null)
    loadRequisitions({ kind }).then(setRows, (e: Error) => setError(e.message))
    loadSites().then(setJobs, () => {})
  }, [kind])
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs])

  async function setStatus(r: Requisition, status: ReqStatus) {
    const before = rows
    setRows((rows ?? []).map((x) => (x.id === r.id ? { ...x, status } : x)))
    try {
      await updateRequisition(r.id, { status })
    } catch (e) {
      setRows(before)
      setError(saveError(e))
    }
  }

  const q = search.trim().toLowerCase()
  const shown = (rows ?? [])
    .filter((r) => inFilter(filter, r.status))
    .filter((r) => !jobId || r.job_id === jobId)
    .filter((r) => !q || `${reqRef(r)} ${r.element} ${r.details} ${r.requester_name ?? ''} ${r.supplier ?? ''}`.toLowerCase().includes(q))
  const today = todayIso()
  const soon = addDaysIso(today, 3)

  if (!can(kind === 'hire' ? 'buyer_hire' : 'buyer_material'))
    return (
      <>
        <SiteNav />
        <NoAccess what={`the ${kind} buyer's list`} />
      </>
    )
  return (
    <>
      <SiteNav />
      <section className="card">
        <div className="pane-head">
          <h2>{kind === 'hire' ? 'Hire' : 'Material'} buyer's list</h2>
        </div>
        {kind === 'hire' && <p className="muted small intro">The hire requisition form is coming next; hire requisitions will be listed here.</p>}
        <div className="toolbar">
          <input className="search" placeholder="Search ref, element, materials, requester or supplier" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">All sites</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {jobLabel(j)}
              </option>
            ))}
          </select>
          <div className="segmented">
            {FILTERS.map(([f, label]) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {label}
                {rows && <span className="seg-count">{rows.filter((r) => inFilter(f, r.status)).length}</span>}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {rows === null && !error && <p className="muted">Loading…</p>}
        {rows && shown.length === 0 && <p className="muted">{rows.length === 0 ? 'No requisitions yet.' : 'None match.'}</p>}
        {shown.length > 0 && (
          <table className="table stack">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Site</th>
                <th>Element of work</th>
                <th>Requested by</th>
                <th>Required by</th>
                <th>Status</th>
                <th>Delivery</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const open = OPEN_STATUSES.includes(r.status) && r.status !== 'ordered'
                const urgent = open && r.required_by <= soon
                return (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/site/requisitions/${r.id}`)}>
                    <td className="stack-title nowrap">
                      <strong>{reqRef(r)}</strong>
                      <div className="muted small">{ukDate(r.created_at.slice(0, 10))}</div>
                    </td>
                    <td className="stack-sub">{jobLabel(jobById.get(r.job_id))}</td>
                    <td data-label="Element">{r.element}</td>
                    <td data-label="Requested by">{r.requester_name}</td>
                    <td className={`nowrap ${urgent ? 'late' : ''}`} data-label="Required by">
                      {ukDate(r.required_by)}
                    </td>
                    <td data-label="Status" onClick={(e) => e.stopPropagation()}>
                      <select className={`req-status req-${r.status}`} value={r.status} onChange={(e) => setStatus(r, e.target.value as ReqStatus)}>
                        {(Object.keys(REQ_STATUS_LABELS) as ReqStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {REQ_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={`nowrap ${r.delivery_date ? '' : 'stack-hide'}`} data-label="Delivery">
                      {ukDate(r.delivery_date)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

// ---------- one requisition: the details, the conversation, and the buyer's order details ----------
export function RequisitionPage() {
  const { reqId } = useParams()
  const { can } = useAccess()
  const [params] = useSearchParams()
  const { reload: reloadBell } = useNotifications()
  const [req, setReq] = useState<Requisition | null>(null)
  const [messages, setMessages] = useState<ReqMessage[]>([])
  const [files, setFiles] = useState<ReqFile[]>([])
  const [job, setJob] = useState<Job | undefined>()
  const [userId, setUserId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [order, setOrder] = useState<Partial<Requisition>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  function load() {
    loadRequisition(reqId!).then(
      ([r, m, f]) => {
        setReq(r)
        setMessages(m)
        setFiles(f)
        setOrder({ supplier: r.supplier, order_value: r.order_value, order_date: r.order_date, delivery_date: r.delivery_date })
      },
      (e: Error) => setError(e.message),
    )
  }
  useEffect(() => {
    load()
    me().then((u) => setUserId(u?.id ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqId])
  useEffect(() => {
    if (req)
      loadSites().then(
        (js) => setJob(js.find((j) => j.id === req.job_id)),
        () => {},
      )
  }, [req])

  if (!req) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>
  const isRequester = userId != null && userId === req.requested_by
  const asBuyer = can(req.kind === 'hire' ? 'buyer_hire' : 'buyer_material')

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!draft.trim() || !req) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      await postMessage(req, draft)
      setDraft('')
      load()
      reloadBell()
    } catch (err) {
      setError(saveError(err))
    }
    setBusy(false)
  }
  async function saveOrder(status?: ReqStatus) {
    if (!req) return
    setError(null)
    setBusy(true)
    try {
      const patch: Partial<Requisition> = {
        supplier: order.supplier?.trim() || null,
        order_value: order.order_value == null || String(order.order_value) === '' ? null : Number(order.order_value),
        order_date: order.order_date || null,
        delivery_date: order.delivery_date || null,
        ...(status ? { status } : {}),
        ...(status === 'ordered' && !order.order_date ? { order_date: todayIso() } : {}),
      }
      await updateRequisition(req.id, patch)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      load()
    } catch (err) {
      setError(saveError(err))
    }
    setBusy(false)
  }
  async function attach(list: File[]) {
    if (!req) return
    setError(null)
    try {
      for (const f of list) await addFile(req, f)
      load()
    } catch (err) {
      setError(saveError(err))
    }
  }
  async function open(f: ReqFile) {
    try {
      window.open(await fileUrl(f.path), '_blank')
    } catch (err) {
      setError(saveError(err))
    }
  }

  const awaitingMe = req.status === 'query' && isRequester
  return (
    <>
      <SiteNav />
      {params.get('sent') && <p className="notice">Requisition {reqRef(req)} sent to the buyer. Any questions will come to your bell.</p>}
      <section className="card">
        <div className="pane-head">
          <h2>
            {reqRef(req)} · {req.element}
          </h2>
          <Link to={asBuyer && !isRequester ? `/site/buyer/${req.kind}` : '/site'} className="link-button">
            Back
          </Link>
        </div>
        <dl className="req-details">
          <dt>Site</dt>
          <dd>{job ? <Link to={`/jobs/${job.id}`}>{jobLabel(job)}</Link> : '—'}</dd>
          <dt>Status</dt>
          <dd>{statusTag(req.status)}</dd>
          <dt>Required by</dt>
          <dd>{ukDate(req.required_by)}</dd>
          <dt>Requested by</dt>
          <dd>
            {req.requester_name}
            {req.requester_email && (
              <>
                {' · '}
                <a href={`mailto:${req.requester_email}?subject=${encodeURIComponent(`${reqRef(req)} ${req.element}`)}`}>{req.requester_email}</a>
              </>
            )}{' '}
            <span className="muted small">on {ukDate(req.created_at.slice(0, 10))}</span>
          </dd>
          <dt>Materials required</dt>
          <dd className="pre">{linkify(req.details)}</dd>
          {req.notes && (
            <>
              <dt>Notes</dt>
              <dd className="pre">{linkify(req.notes)}</dd>
            </>
          )}
          {req.delivery_date && !asBuyer && (
            <>
              <dt>Delivery</dt>
              <dd>{ukDate(req.delivery_date)}</dd>
            </>
          )}
          <dt>Attachments</dt>
          <dd>
            {files.length === 0 && <span className="muted">None</span>}
            <ul className="req-files">
              {files.map((f) => (
                <li key={f.id}>
                  <button className="link-button" onClick={() => open(f)}>
                    {f.name}
                  </button>{' '}
                  <button className="link-button small muted" onClick={() => confirm(`Remove ${f.name}?`) && removeFile(f).then(load, (e: Error) => setError(saveError(e)))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <AddFiles onFiles={attach} label="+ Add file" />
          </dd>
        </dl>
      </section>

      <section className={`card ${awaitingMe ? 'req-awaiting' : ''}`}>
        <h2>Questions and answers</h2>
        {awaitingMe && <p className="notice">The buyer has a question: reply below.</p>}
        {messages.length === 0 && <p className="muted small">{asBuyer ? 'Ask the requester anything you need to know before ordering.' : 'No questions from the buyer yet.'}</p>}
        <ul className="req-chat">
          {messages.map((m) => {
            const fromRequester = m.author_id === req.requested_by
            return (
              <li key={m.id} className={fromRequester ? 'from-site' : 'from-buyer'}>
                <div className="muted small">
                  {m.author_name ?? 'Someone'} · {fromRequester ? 'requester' : 'buyer'} · {ukDate(m.created_at.slice(0, 10))} {m.created_at.slice(11, 16)}
                </div>
                <div className="pre">{linkify(m.body)}</div>
              </li>
            )
          })}
        </ul>
        <form onSubmit={send} className="req-reply">
          <textarea rows={3} value={draft} placeholder={isRequester ? 'Your answer…' : 'Your question for the requester…'} onChange={(e) => setDraft(e.target.value)} />
          <button className="primary" disabled={busy || !draft.trim()}>
            {isRequester ? 'Send answer' : 'Ask requester'}
          </button>
        </form>
      </section>

      {asBuyer && (
        <section className="card">
          <h2>Order</h2>
          <div className="form-grid">
            <label>
              Status
              <select value={req.status} onChange={(e) => saveOrder(e.target.value as ReqStatus)} disabled={busy}>
                {(Object.keys(REQ_STATUS_LABELS) as ReqStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {REQ_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Supplier
              <input value={order.supplier ?? ''} onChange={(e) => setOrder({ ...order, supplier: e.target.value })} />
              {/* typed, not a list (22 Nov) */}
            </label>
            <label>
              Order value (£)
              <input
                type="number"
                step="0.01"
                value={order.order_value ?? ''}
                onChange={(e) => setOrder({ ...order, order_value: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </label>
            <label>
              Order date
              <input type="date" value={order.order_date ?? ''} onChange={(e) => setOrder({ ...order, order_date: e.target.value })} />
            </label>
            <label>
              Delivery date
              <input type="date" value={order.delivery_date ?? ''} onChange={(e) => setOrder({ ...order, delivery_date: e.target.value })} />
            </label>
          </div>
          {req.order_value != null && <p className="muted small">Ordered value {money(req.order_value)}</p>}
          <div className="form-actions">
            <button className="primary" disabled={busy} onClick={() => saveOrder()}>
              {saved ? 'Saved ✓' : 'Save'}
            </button>
            {OPEN_STATUSES.includes(req.status) && req.status !== 'ordered' && (
              <button disabled={busy} onClick={() => saveOrder('ordered')}>
                Save and mark ordered
              </button>
            )}
            {req.status === 'ordered' && (
              <button disabled={busy} onClick={() => saveOrder('delivered')}>
                Mark delivered
              </button>
            )}
          </div>
        </section>
      )}
      {error && <p className="error">{error}</p>}
    </>
  )
}

// links in what site typed open in a new tab ("include links")
function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part.length > 60 ? part.slice(0, 57) + '…' : part}
      </a>
    ) : (
      part
    ),
  )
}
