import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, todayIso, ukDate } from '../lib/format'
import { cached, must, saveError } from '../lib/offline'
import { useIsAdmin } from '../lib/admin'
import { createQuotation, enquiryRef, fullRef, loadQuotations } from '../lib/quotations'
import { ENQUIRY_STATUS_LABELS, QUOTE_STATUS_LABELS, type Enquiry, type EnquiryStatus, type Quotation } from '../lib/types'
import { ClauseLibrary, Wording } from './Sections'

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
    cached('enquiries', () => must<Enquiry[]>(supabase.from('enquiries').select('*').order('enquiry_no', { ascending: false }))).then(setEnquiries, (e: Error) => setError(e.message))
    cached('enquiry-quote-ids', () => must<{ enquiry_id: string }[]>(supabase.from('quotations').select('enquiry_id').not('enquiry_id', 'is', null))).then((rows) => {
      const c: Record<string, number> = {}
      for (const r of rows) c[r.enquiry_id] = (c[r.enquiry_id] ?? 0) + 1
      setQuoteCounts(c)
    }, () => {})
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
        <NavLink to="/estimating/wording" className="pill">
          Standard wording & clauses
        </NavLink>
      </nav>

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
const FIELDS: [keyof Enquiry, string, string?][] = [
  ['client_name', 'Client (company)'],
  ['client_contact', 'Contact name'],
  ['client_email', 'Email', 'email'],
  ['client_phone', 'Phone', 'tel'],
  ['received_date', 'Date received', 'date'],
  ['due_date', 'Quote / tender due', 'date'],
  ['estimator', 'Estimator'],
]

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
        return setError(saveError(ins.error))
      }
      id = ins.data.id
    } else {
      const upd = await supabase.from('enquiries').update(row).eq('id', enquiryId)
      if (upd.error) {
        setBusy(false)
        return setError(saveError(upd.error))
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
      <div className="form-grid">
        <label className="span-2">
          Name
          <input value={form.name ?? ''} placeholder="e.g. Norton Folgate glazing" onChange={(e) => set('name', e.target.value)} required />
        </label>
        <label className="span-2">
          Site address
          <textarea rows={2} value={form.site_address ?? ''} onChange={(e) => set('site_address', e.target.value)} />
        </label>
        {FIELDS.map(([k, label, type]) => (
          <label key={k}>
            {label}
            <input type={type ?? 'text'} value={String(form[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
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
        <label className="span-2">
          Notes
          <textarea rows={3} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
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
      <div className="job-head">
        <div>
          <Link to="/estimating" className="link-button small">
            ← Enquiries
          </Link>
          <h1>
            {enquiryRef(e)} · {e.name}
          </h1>
          <div className="job-meta muted">
            <span className={`tag enq-${e.status}`}>{ENQUIRY_STATUS_LABELS[e.status]}</span>
            {e.client_name && <span>{e.client_name}</span>}
            {e.due_date && <span>Due {ukDate(e.due_date)}</span>}
          </div>
        </div>
        <div className="button-row">
          <Link to={`/estimating/e/${e.id}/edit`} className="button">
            Edit enquiry
          </Link>
          {e.job_id ? (
            <Link to={`/jobs/${e.job_id}`} className="button primary">
              Open the job →
            </Link>
          ) : (
            e.status !== 'lost' && (
              <Link to={`/jobs/new?enquiry=${e.id}`} className="button primary" title="Create the job from this enquiry and move its quotations into it">
                Won: set up as job
              </Link>
            )
          )}
        </div>
      </div>

      <div className="overview-grid">
        <section className="card">
          <h2>Details</h2>
          <dl className="details">
            <dt>Site address</dt>
            <dd>{e.site_address || '–'}</dd>
            <dt>Client</dt>
            <dd>{e.client_name || '–'}</dd>
            <dt>Contact</dt>
            <dd>{e.client_contact || '–'}</dd>
            <dt>Email</dt>
            <dd>{e.client_email ? <a href={`mailto:${e.client_email}`}>{e.client_email}</a> : '–'}</dd>
            <dt>Phone</dt>
            <dd>{e.client_phone ? <a href={`tel:${e.client_phone}`}>{e.client_phone}</a> : '–'}</dd>
            <dt>Received</dt>
            <dd>{ukDate(e.received_date) || '–'}</dd>
            <dt>Due</dt>
            <dd>{ukDate(e.due_date) || '–'}</dd>
            <dt>Estimator</dt>
            <dd>{e.estimator || '–'}</dd>
            {e.notes && (
              <>
                <dt>Notes</dt>
                <dd>{e.notes}</dd>
              </>
            )}
          </dl>
        </section>

        <section className="card">
          <div className="pane-head">
            <h2>Quotations</h2>
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
