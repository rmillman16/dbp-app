import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, todayIso, ukDate } from '../lib/format'
import { cached, must, saveError } from '../lib/offline'
import { useIsAdmin } from '../lib/admin'
import { createQuotation, enquiryRef, fullRef, loadQuotations } from '../lib/quotations'
import { ENQUIRY_STATUS_LABELS, QUOTE_STATUS_LABELS, type Enquiry, type EnquiryStatus, type Quotation } from '../lib/types'
import { ClauseLibrary, Wording } from './Sections'
import ProgrammeEditor from '../components/programme/ProgrammeEditor'
import { loadProgramme, type ProgrammeTask, type SavedProgramme } from '../lib/programme'
import { TenderTracker } from './TenderEnquiry'
import EnquiryHead from '../components/EnquiryHead'
import { AWAITING, loadTracker } from '../lib/tender'

// Estimating (agreed 20 Nov): laid out like Jobs but simpler. A list of enquiries (small
// works, new enquiries, tenders), each with its own quotations; when won, it's set up as
// a job and its quotations move into the job.

const OPEN: EnquiryStatus[] = ['enquiry', 'pricing', 'submitted']

export function loadEnquiry(id: string) {
  return cached(`enquiry:${id}`, () => must<Enquiry>(supabase.from('enquiries').select('*').eq('id', id).single()))
}

// ---------- list ----------
type Filter = 'open' | 'won' | 'lost' | 'all'
const FILTERS: [Filter, string][] = [
  ['open', 'Open'],
  ['won', 'Won'],
  ['lost', 'Lost'],
  ['all', 'All'],
]
const matches = (f: Filter, s: EnquiryStatus) => f === 'all' || (f === 'open' ? OPEN.includes(s) : s === f)

export default function Estimating() {
  const { tab } = useParams()
  const readOnly = !useIsAdmin()
  const navigate = useNavigate()
  const [enquiries, setEnquiries] = useState<Enquiry[] | null>(null)
  const [quoteCounts, setQuoteCounts] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (tab) return
    cached('enquiries', () => must<Enquiry[]>(supabase.from('enquiries').select('*').order('enquiry_no', { ascending: false }))).then(setEnquiries, (e: Error) =>
      setError(e.message),
    )
    cached('enquiry-quote-ids', () => must<{ enquiry_id: string }[]>(supabase.from('quotations').select('enquiry_id').not('enquiry_id', 'is', null))).then(
      (rows) => {
        const c: Record<string, number> = {}
        for (const r of rows) c[r.enquiry_id] = (c[r.enquiry_id] ?? 0) + 1
        setQuoteCounts(c)
      },
      () => {},
    )
  }, [tab])

  const q = search.trim().toLowerCase()
  const shown = (enquiries ?? []).filter((e) => matches(filter, e.status)).filter((e) => !q || `${enquiryRef(e)} ${e.name} ${e.client_name ?? ''}`.toLowerCase().includes(q))
  const today = todayIso()

  return (
    <>
      <h1>Estimating</h1>
      <nav className="pills">
        <NavLink to="/estimating" end className="pill">
          Enquiries
        </NavLink>
        <NavLink to="/estimating/tracker" className="pill">
          Tender tracker
        </NavLink>
        <NavLink to="/estimating/wording" className="pill">
          Standard wording & clauses
        </NavLink>
      </nav>

      {tab === 'tracker' && <TenderTracker />}

      {!tab && (
        <section className="card">
          <div className="pane-head">
            <h2>Enquiries</h2>
            <Link to="/estimating/new" className="button primary">
              + New enquiry
            </Link>
          </div>
          <div className="toolbar">
            <input className="search" placeholder="Search enquiry no., name or client" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="segmented">
              {FILTERS.map(([f, label]) => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {label}
                  {enquiries && <span className="seg-count">{enquiries.filter((e) => matches(f, e.status)).length}</span>}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          {enquiries === null && !error && <p className="muted">Loading…</p>}
          {enquiries && shown.length === 0 && <p className="muted">{enquiries.length === 0 ? 'No enquiries yet. Add the first one.' : 'No enquiries match.'}</p>}
          {shown.length > 0 && (
            <table className="table stack">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Name</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th className="num">Quotes</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => {
                  const late = e.due_date && e.due_date < today && OPEN.includes(e.status)
                  return (
                    <tr key={e.id} className="clickable" onClick={() => navigate(`/estimating/e/${e.id}`)}>
                      <td className="stack-title nowrap">
                        <strong>{enquiryRef(e)}</strong>
                      </td>
                      <td className="stack-sub">{e.name}</td>
                      <td className={e.client_name ? '' : 'stack-hide'} data-label="Client">
                        {e.client_name}
                      </td>
                      <td data-label="Status">
                        <span className={`tag enq-${e.status}`}>{ENQUIRY_STATUS_LABELS[e.status]}</span>
                      </td>
                      <td className={`nowrap ${late ? 'late' : ''} ${e.due_date ? '' : 'stack-hide'}`} data-label="Due">
                        {ukDate(e.due_date)}
                      </td>
                      <td className="num" data-label="Quotes">
                        {quoteCounts[e.id] ?? 0}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'wording' && (
        <section className="card">
          <h3 className="sub-head">Quotation wording</h3>
          <p className="muted small intro">Standard wording on every quotation (jobs and estimating). Changes apply to quotations exported after saving.</p>
          <Wording category="Quotations" empty="No quotation wording yet." readOnly={readOnly} />
          <h3 className="sub-head">Clause library</h3>
          <ClauseLibrary readOnly={readOnly} />
        </section>
      )}
    </>
  )
}

// ---------- new / edit ----------
// the contract details come from script 068
const needs068 = (e: { message: string }) => (/main_contract|sub_contract|summary|schema cache/i.test(e.message) ? 'Run script 068 in Supabase first (it adds the main contract, sub-contract and project summary).' : null)

export function EnquiryForm() {
  const { enquiryId } = useParams()
  const isNew = !enquiryId
  const navigate = useNavigate()
  const [form, setForm] = useState<Partial<Enquiry> | null>(isNew ? { status: 'enquiry', received_date: todayIso() } : null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isNew) loadEnquiry(enquiryId!).then(setForm, (e: Error) => setError(e.message))
  }, [enquiryId, isNew])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    const row = {
      name: (form.name ?? '').trim(),
      site_address: form.site_address?.trim() || null,
      client_name: form.client_name?.trim() || null,
      client_contact: form.client_contact?.trim() || null,
      client_email: form.client_email?.trim() || null,
      client_phone: form.client_phone?.trim() || null,
      received_date: form.received_date || null,
      due_date: form.due_date || null,
      status: form.status ?? 'enquiry',
      estimator: form.estimator?.trim() || null,
      notes: form.notes?.trim() || null,
      main_contract: form.main_contract?.trim() || null,
      sub_contract: form.sub_contract?.trim() || null,
      summary: form.summary?.trim() || null,
    }
    setBusy(true)
    let id = enquiryId
    if (isNew) {
      const max = await supabase.from('enquiries').select('enquiry_no').order('enquiry_no', { ascending: false }).limit(1)
      const { data: s } = await supabase.auth.getSession()
      const ins = await supabase
        .from('enquiries')
        .insert({ ...row, enquiry_no: (max.data?.[0]?.enquiry_no ?? 0) + 1, created_by: s.session?.user.id })
        .select('id')
        .single()
      if (ins.error) {
        setBusy(false)
        return setError(needs068(ins.error) ?? saveError(ins.error))
      }
      id = ins.data.id
    } else {
      const upd = await supabase.from('enquiries').update(row).eq('id', enquiryId)
      if (upd.error) {
        setBusy(false)
        return setError(needs068(upd.error) ?? saveError(upd.error))
      }
    }
    navigate(`/estimating/e/${id}`)
  }

  if (!form) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>
  const set = (k: keyof Enquiry, v: string) => setForm({ ...form, [k]: v })

  return (
    <form className="card form" onSubmit={save}>
      <div className="pane-head">
        <h2>{isNew ? 'New enquiry' : `${enquiryRef(form as Enquiry)} · ${form.name}`}</h2>
        <Link to={isNew ? '/estimating' : `/estimating/e/${enquiryId}`} className="link-button">
          Back
        </Link>
      </div>
      <h3 className="sub-head">The enquiry</h3>
      <div className="form-grid">
        <label className="span-2">
          Name
          <input value={form.name ?? ''} placeholder="e.g. Norton Folgate glazing" onChange={(e) => set('name', e.target.value)} required />
        </label>
        <label>
          Status
          <select value={form.status} onChange={(e) => set('status', e.target.value)}>
            {(Object.keys(ENQUIRY_STATUS_LABELS) as EnquiryStatus[]).map((s) => (
              <option key={s} value={s}>
                {ENQUIRY_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estimator
          <input value={form.estimator ?? ''} onChange={(e) => set('estimator', e.target.value)} />
        </label>
        <label>
          Date received
          <input type="date" value={form.received_date ?? ''} onChange={(e) => set('received_date', e.target.value)} />
        </label>
        <label>
          Quote / tender due
          <input type="date" value={form.due_date ?? ''} onChange={(e) => set('due_date', e.target.value)} />
        </label>
      </div>

      <h3 className="sub-head">The job and contract</h3>
      <p className="muted small">These go into the tender emails to contractors.</p>
      <div className="form-grid">
        <label className="span-2">
          Site address
          <textarea rows={2} value={form.site_address ?? ''} onChange={(e) => set('site_address', e.target.value)} />
        </label>
        <label>
          Main contract
          <input value={form.main_contract ?? ''} placeholder="e.g. JCT Design and Build 2016" onChange={(e) => set('main_contract', e.target.value)} />
        </label>
        <label>
          Sub-contract
          <input value={form.sub_contract ?? ''} placeholder="e.g. JCT Sub-contract" onChange={(e) => set('sub_contract', e.target.value)} />
        </label>
        <label className="span-2">
          Project summary
          <textarea rows={3} value={form.summary ?? ''} placeholder="e.g. full refurbishment of a five-storey townhouse" onChange={(e) => set('summary', e.target.value)} />
        </label>
        <label className="span-2">
          Notes (tender notes)
          <textarea rows={3} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>

      <h3 className="sub-head">Client</h3>
      <div className="form-grid">
        <label>
          Client (company)
          <input value={form.client_name ?? ''} onChange={(e) => set('client_name', e.target.value)} />
        </label>
        <label>
          Contact name
          <input value={form.client_contact ?? ''} onChange={(e) => set('client_contact', e.target.value)} />
        </label>
        <label>
          Email
          <input type="email" value={form.client_email ?? ''} onChange={(e) => set('client_email', e.target.value)} />
        </label>
        <label>
          Phone
          <input type="tel" value={form.client_phone ?? ''} onChange={(e) => set('client_phone', e.target.value)} />
        </label>
      </div>      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : isNew ? 'Add enquiry' : 'Save changes'}
        </button>
        <Link to={isNew ? '/estimating' : `/estimating/e/${enquiryId}`} className="button">
          Cancel
        </Link>
      </div>
    </form>
  )
}

// ---------- one enquiry ----------
export function EnquiryPage() {
  const { enquiryId } = useParams()
  const navigate = useNavigate()
  const [e, setE] = useState<Enquiry | null>(null)
  const [quotes, setQuotes] = useState<{ q: Quotation; total: number }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadEnquiry(enquiryId!).then(setE, (err: Error) => setError(err.message))
    loadQuotations({ enquiryId: enquiryId! }).then(setQuotes, () => setQuotes([]))
  }, [enquiryId])

  async function newQuote() {
    if (!e) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      navigate(`/estimating/q/${await createQuotation({ enquiry: e })}`)
    } catch (err) {
      setError(saveError(err))
      setBusy(false)
    }
  }

  if (error && !e) return <p className="error">{error}</p>
  if (!e) return <p className="muted">Loading…</p>

  return (
    <>
      <EnquiryHead e={e} />

      <div className="enq-layout">
        <div className="enq-modules">
          <section className="card">
            <div className="pane-head">
              <h2>Tender Details</h2>
              <Link to={`/estimating/e/${e.id}/edit`} className="button">
                Edit
              </Link>
            </div>
            <dl className="details">
              <dt>Site address</dt>
              <dd>{e.site_address || '–'}</dd>
              <dt>Client</dt>
              <dd>{e.client_name || '–'}</dd>
              <dt>Contact</dt>
              <dd>
                {e.client_contact || '–'}
                {e.client_email && (
                  <>
                    {' · '}
                    <a href={`mailto:${e.client_email}`}>{e.client_email}</a>
                  </>
                )}
                {e.client_phone && (
                  <>
                    {' · '}
                    <a href={`tel:${e.client_phone}`}>{e.client_phone}</a>
                  </>
                )}
              </dd>
              <dt>Received / due</dt>
              <dd>
                {ukDate(e.received_date) || '–'} / {ukDate(e.due_date) || '–'}
              </dd>
              <dt>Estimator</dt>
              <dd>{e.estimator || '–'}</dd>
              {(e.main_contract || e.sub_contract) && (
                <>
                  <dt>Contract</dt>
                  <dd>{[e.main_contract, e.sub_contract].filter(Boolean).join(' / ')}</dd>
                </>
              )}
              {e.notes && (
                <>
                  <dt>Notes</dt>
                  <dd>{e.notes}</dd>
                </>
              )}
            </dl>
          </section>

          <EnquiryProgrammeCard e={e} />

          {/* tender meetings (23 Nov, script 046): the same Minutes screen as a job's; they move to the job when it's won */}
          <section className="card">
            <div className="pane-head">
              <h2>Minutes</h2>
              {e.job_id ? (
                <Link to={`/jobs/${e.job_id}/minutes`} className="button">
                  Open the job's minutes →
                </Link>
              ) : (
                <Link to={`/estimating/e/${e.id}/minutes`} className="button primary">
                  Open minutes
                </Link>
              )}
            </div>
            <p className="muted small">
              {e.job_id
                ? "This enquiry was won; its meetings are now in the job's Minutes tab."
                : "Tender meetings, with actions on the owners' bells. They move to the job when the enquiry is won."}
            </p>
          </section>

          {/* tender RFIs (23 Nov, script 059): they move to the job when it's won */}
          <EnquiryRfiCard e={e} />

          {/* tender enquiries to contractors (script 067) */}
          {!e.job_id && <EnquiryTenderCard e={e} />}
        </div>

        <section className="card enq-quotes">
          <div className="pane-head">
            <h2>Upstream Quotations</h2>
            {!e.job_id && (
              <button className="primary" onClick={newQuote} disabled={busy}>
                + New quotation
              </button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
          {e.job_id && <p className="muted small">This enquiry was won; its quotations are now in the job's Quotations tab.</p>}
          {quotes?.length === 0 && !e.job_id && <p className="muted">No quotations yet.</p>}
          {quotes && quotes.length > 0 && (
            <ul className="quote-list">
              {quotes.map(({ q, total }) => (
                <li key={q.id}>
                  <Link to={`/estimating/q/${q.id}`}>{fullRef(e, q)}</Link>
                  <span className="muted small">
                    <span className={`q-status ${q.status}`}>{QUOTE_STATUS_LABELS[q.status]}</span> {money(total)} + VAT · {ukDate(q.issued_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}

// tender enquiries to contractors at a glance (script 067)
function EnquiryTenderCard({ e }: { e: Enquiry }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof loadTracker>> | null | 'none'>(null)
  useEffect(() => {
    loadTracker().then(setD, () => setD('none'))
  }, [e.id])
  const pk = d && d !== 'none' ? d.packages.filter((p) => p.enquiry_id === e.id) : []
  const inv = d && d !== 'none' ? d.invites.filter((i) => pk.some((p) => p.id === i.package_id)) : []
  return (
    <section className="card">
      <div className="pane-head">
        <h2>Tender enquiries</h2>
        <Link to={`/estimating/e/${e.id}/tender`} className="button primary">
          Open tender enquiries
        </Link>
      </div>
      {d === null ? (
        <p className="muted small">Loading…</p>
      ) : d === 'none' ? (
        <p className="muted small">Send packages out to subcontractors and suppliers for pricing, and follow their replies. Needs script 067.</p>
      ) : pk.length === 0 ? (
        <p className="muted small">Nothing sent out yet. Send a package to subcontractors and suppliers for pricing, then follow their replies here.</p>
      ) : (
        <p>
          <strong>{pk.length}</strong> package{pk.length === 1 ? '' : 's'} · <strong>{inv.length}</strong> invited · <strong>{inv.filter((i) => AWAITING.includes(i.status) || i.status === 'drafted').length}</strong> waiting ·{' '}
          <strong>{inv.filter((i) => i.quote_amount != null).length}</strong> quote{inv.filter((i) => i.quote_amount != null).length === 1 ? '' : 's'} in
        </p>
      )}
    </section>
  )
}
// tender RFIs at a glance (23 Nov, script 059)
function EnquiryRfiCard({ e }: { e: Enquiry }) {
  const [rows, setRows] = useState<{ status: string; due_date: string | null }[] | null>(null)
  useEffect(() => {
    if (e.job_id) return
    supabase
      .from('rfis')
      .select('status, due_date')
      .eq('enquiry_id', e.id)
      .then(({ data, error }) => setRows(error ? null : ((data ?? []) as { status: string; due_date: string | null }[])))
  }, [e.id, e.job_id])
  const today = todayIso()
  const open = (rows ?? []).filter((r) => r.status === 'open')
  const late = open.filter((r) => r.due_date && r.due_date < today).length
  const answered = (rows ?? []).filter((r) => r.status === 'answered').length
  return (
    <section className="card">
      <div className="pane-head">
        <h2>RFIs</h2>
        {e.job_id ? (
          <Link to={`/jobs/${e.job_id}/rfis`} className="button">
            Open the job's RFIs →
          </Link>
        ) : (
          <Link to={`/estimating/e/${e.id}/rfis`} className="button primary">
            Open RFIs
          </Link>
        )}
      </div>
      {e.job_id ? (
        <p className="muted small">This enquiry was won; its RFIs are now in the job's RFIs tab.</p>
      ) : rows === null ? (
        <p className="muted small">Tender queries to the client and design team. RFIs on estimates need script 059 run in Supabase first.</p>
      ) : rows.length === 0 ? (
        <p className="muted small">No tender RFIs yet. Draft your queries, then send them to the client as one Excel schedule. They move to the job when the enquiry is won.</p>
      ) : (
        <p>
          <strong>{(rows ?? []).filter((r) => r.status === 'draft').length}</strong> draft · <strong>{open.length}</strong> out to the client{late > 0 && <span className="late"> · ⚠ {late} overdue</span>} · <strong>{answered}</strong> answered, to close · {rows.length} in all
        </p>
      )}
    </section>
  )
}

// Estimating › enquiry › Programme (Richard, 22 Nov: "estimates and tenders often need a programme
// too"). The same programme editor as a job's; when the enquiry is won it becomes the job's programme.
function EnquiryProgrammeCard({ e }: { e: Enquiry }) {
  const [p, setP] = useState<{ programme: SavedProgramme | null; tasks: ProgrammeTask[] } | null | 'none'>(null)
  useEffect(() => {
    if (e.job_id) return
    loadProgramme({ enquiryId: e.id }).then(setP, () => setP('none'))
  }, [e.id, e.job_id])
  if (e.job_id) return null
  const prog = p && p !== 'none' ? p.programme : null
  return (
    <section className="card">
      <div className="pane-head">
        <h2>Tender programme</h2>
        <Link to={`/estimating/e/${e.id}/programme`} className="button primary">
          {prog ? 'Open tender programme' : 'Start a tender programme'}
        </Link>
      </div>
      {p === null ? (
        <p className="muted small">Loading…</p>
      ) : prog ? (
        <p className="small">
          {prog.project_name}: {p !== 'none' && p.tasks.length} tasks, {ukDate(prog.start_date)} to {ukDate(prog.finish_date)}. It becomes the job's programme when the enquiry is
          won.
        </p>
      ) : (
        <p className="muted small">The tender programme: start from a previous job's programme, import one, or start blank. It moves to the job when the enquiry is won.</p>
      )}
    </section>
  )
}

export function EnquiryProgramme() {
  const { enquiryId } = useParams()
  const [e, setE] = useState<Enquiry | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadEnquiry(enquiryId!).then(setE, (err: Error) => setError(err.message))
  }, [enquiryId])
  const owner = useMemo(() => ({ enquiryId: enquiryId! }), [enquiryId])
  if (error) return <p className="error">{error}</p>
  if (!e) return <p className="muted">Loading…</p>
  return (
    <>
      <EnquiryHead e={e} />
      {e.job_id && (
        <p className="muted">
          This enquiry was won; its programme is now the job's. <Link to={`/jobs/${e.job_id}/programme`}>Open it →</Link>
        </p>
      )}
      {!e.job_id && <ProgrammeEditor owner={owner} ownerName={`${enquiryRef(e)} ${e.name}`} defaults={{ start: null, pc: null }} />}
    </>
  )
}

// Estimating › enquiry › Tender enquiries (script 067): the packages sent to subcontractors and suppliers, and where each has got to
export function EnquiryTender() {
  const { enquiryId } = useParams()
  const [e, setE] = useState<Enquiry | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadEnquiry(enquiryId!).then(setE, (err: Error) => setError(err.message))
  }, [enquiryId])
  if (error) return <p className="error">{error}</p>
  if (!e) return <p className="muted">Loading…</p>
  return (
    <>
      <EnquiryHead e={e} />
      {e.job_id ? <p className="muted">This enquiry was won and is now a job, so tender enquiries are closed.</p> : <TenderTracker enquiryId={e.id} />}
    </>
  )
}
