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
import ProgrammeList from '../components/programme/ProgrammeList'
import { loadProgramme } from '../lib/programme'
import { TenderTracker } from './TenderEnquiry'
import EnquiryHead from '../components/EnquiryHead'
import { loadTracker } from '../lib/tender'
import Loading from '../components/Loading'

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
          {enquiries === null && !error && <Loading />}
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

  if (!form) return error ? <p className="error">{error}</p> : <Loading />
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

/// ---------- one enquiry ----------
// Laid out like a job's overview: the tender details, then one row of equal tiles, each a heading with the figure that matters and
// a link to its tab. Programme, Minutes, RFIs, Tender enquiries and Tender return.
export function EnquiryPage() {
  const { enquiryId } = useParams()
  const [e, setE] = useState<Enquiry | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadEnquiry(enquiryId!).then(setE, (err: Error) => setError(err.message))
  }, [enquiryId])

  if (error && !e) return <p className="error">{error}</p>
  if (!e) return <Loading />

  return (
    <>
      <EnquiryHead e={e} />
      <div className="overview-grid">
        <section className="card span-all">
          <div className="pane-head">
            <h2>Tender details</h2>
          </div>
          <dl className="details enq-details">
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
        <EnquiryTiles e={e} />
      </div>
    </>
  )
}

// the five tiles. Each is one heading, one figure and one line under it, and the whole tile opens its tab.
function EnquiryTiles({ e }: { e: Enquiry }) {
  const base = `/estimating/e/${e.id}`
  const won = !!e.job_id
  const jobBase = `/jobs/${e.job_id}`
  type T = {
    prog: { start: string | null; finish: string | null } | null
    meetings: { count: number; last: string | null; name: string | null } | null
    rfis: { total: number; unanswered: number; overdue: number } | null
    tender: { sent: number; returned: number; packages: number } | null
    quotes: { count: number; latest: string | null } | null
  }
  const [t, setT] = useState<T | null>(null)
  useEffect(() => {
    const today = todayIso()
    const rows = async <R,>(q: PromiseLike<{ data: R[] | null }>) => {
      try {
        return (await q).data ?? []
      } catch {
        return []
      }
    }
    Promise.all([
      won ? Promise.resolve(null) : loadProgramme({ enquiryId: e.id }).catch(() => null),
      rows<{ meeting_date: string | null; subtitle: string | null; project: string | null }>(
        supabase.from('meetings').select('meeting_date, subtitle, project').eq(won ? 'job_id' : 'enquiry_id', won ? e.job_id! : e.id).order('meeting_date', { ascending: false }),
      ),
      rows<{ status: string; due_date: string | null }>(supabase.from('rfis').select('status, due_date').eq(won ? 'job_id' : 'enquiry_id', won ? e.job_id! : e.id)),
      won ? Promise.resolve(null) : loadTracker().catch(() => null),
      won ? Promise.resolve([] as Quotation[]) : loadQuotations({ enquiryId: e.id }).catch(() => []),
    ]).then(([p, mt, rf, tr, qs]) => {
      const prog = p && p.programme ? { start: p.programme.start_date ?? null, finish: p.programme.finish_date ?? null } : null
      const pk = tr ? tr.packages.filter((x) => x.enquiry_id === e.id) : []
      const inv = tr ? tr.invites.filter((i) => pk.some((x) => x.id === i.package_id)) : []
      const list = qs as unknown as { q: Quotation; total: number }[]
      setT({
        prog,
        meetings: { count: mt.length, last: mt[0]?.meeting_date ?? null, name: mt[0]?.subtitle || mt[0]?.project || null },
        rfis: { total: rf.length, unanswered: rf.filter((r) => r.status === 'open').length, overdue: rf.filter((r) => r.status === 'open' && r.due_date && r.due_date < today).length },
        tender: { packages: pk.length, sent: inv.filter((i) => i.status !== 'drafted').length, returned: inv.filter((i) => i.quote_amount != null || ['quoted', 'used', 'appointed', 'unsuccessful'].includes(i.status)).length },
        quotes: { count: list.length, latest: list[0]?.q.status ?? null },
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, e.job_id])
  if (!t) return <p className="muted span-all">Loading…</p>
  const weeks = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / (7 * 86400000)))
  const pr = t.prog
  return (
    <div className="span-all module-cards">
      <Link to={won ? `${jobBase}/programme` : `${base}/programme`} className="card module-card">
        <h3>Tender programme</h3>
        {won ? (
          <span className="muted small">Now the job's programme</span>
        ) : !pr || (!pr.start && !pr.finish) ? (
          <span className="muted small">No programme yet</span>
        ) : (
          <>
            <strong>
              {ukDate(pr.start) || '?'} to {ukDate(pr.finish) || '?'}
            </strong>
            <span className="muted small">{pr.start && pr.finish ? `${weeks(pr.start, pr.finish)} weeks` : 'duration not set'}</span>
          </>
        )}
      </Link>
      <Link to={won ? `${jobBase}/minutes` : `${base}/minutes`} className="card module-card">
        <h3>Minutes</h3>
        {t.meetings && t.meetings.count > 0 ? (
          <>
            <strong>{t.meetings.name || 'Latest meeting'}</strong>
            <span className="muted small">{t.meetings.last ? ukDate(t.meetings.last) : 'no date'}</span>
          </>
        ) : (
          <span className="muted small">No meetings yet</span>
        )}
      </Link>
      <Link to={won ? `${jobBase}/rfis` : `${base}/rfis`} className="card module-card">
        <h3>RFIs</h3>
        {t.rfis && t.rfis.total > 0 ? (
          <>
            <strong>
              {t.rfis.total} RFI{t.rfis.total === 1 ? '' : 's'}
            </strong>
            <span className={t.rfis.overdue > 0 ? 'late small' : 'muted small'}>
              {t.rfis.unanswered} unanswered{t.rfis.overdue > 0 ? ` · ⚠ ${t.rfis.overdue} overdue` : ''}
            </span>
          </>
        ) : (
          <span className="muted small">None yet</span>
        )}
      </Link>
      <Link to={`${base}/tender`} className="card module-card">
        <h3>Tender enquiries</h3>
        {won ? (
          <span className="muted small">Closed: the enquiry was won</span>
        ) : t.tender && t.tender.packages > 0 ? (
          <>
            <strong>
              {t.tender.sent} sent · {t.tender.returned} returned
            </strong>
            <span className="muted small">
              {t.tender.packages} package{t.tender.packages === 1 ? '' : 's'}
            </span>
          </>
        ) : (
          <span className="muted small">Nothing sent out yet</span>
        )}
      </Link>
      <Link to={won ? `${jobBase}/quotations` : `${base}/return`} className="card module-card">
        <h3>Tender return</h3>
        {won ? (
          <span className="muted small">Now in the job's Quotations tab</span>
        ) : t.quotes && t.quotes.count > 0 ? (
          <>
            <strong>
              {t.quotes.count} quotation{t.quotes.count === 1 ? '' : 's'}
            </strong>
            <span className="muted small">latest: {t.quotes.latest ? QUOTE_STATUS_LABELS[t.quotes.latest as keyof typeof QUOTE_STATUS_LABELS] : '–'}</span>
          </>
        ) : (
          <span className="muted small">No quotations yet</span>
        )}
      </Link>
    </div>
  )
}

// Estimating › enquiry › Tender return: the quotations we send back to the client for this tender
export function EnquiryReturn() {
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
  if (!e) return <Loading />
  return (
    <>
      <EnquiryHead e={e} />
      <section className="card">
        <div className="pane-head">
          <h2>Tender return</h2>
          {!e.job_id && (
            <button className="primary" onClick={newQuote} disabled={busy}>
              + New quotation
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        {e.job_id && (
          <p className="muted small">
            This enquiry was won; its quotations are now in the job's Quotations tab. <Link to={`/jobs/${e.job_id}/quotations`}>Open them →</Link>
          </p>
        )}
        {quotes?.length === 0 && !e.job_id && <p className="muted">No quotations yet. The quotations you send back to the client for this tender are listed here.</p>}
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
    </>
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
  const [version, setVersion] = useState(0)
  if (error) return <p className="error">{error}</p>
  if (!e) return <Loading />
  return (
    <>
      <EnquiryHead e={e} />
      {!e.job_id && <ProgrammeList owner={owner} onChanged={() => setVersion((v) => v + 1)} />}
      {e.job_id && (
        <p className="muted">
          This enquiry was won; its programme is now the job's. <Link to={`/jobs/${e.job_id}/programme`}>Open it →</Link>
        </p>
      )}
      {!e.job_id && <ProgrammeEditor key={version} owner={owner} ownerName={`${enquiryRef(e)} ${e.name}`} defaults={{ start: null, pc: null }} />}
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
  if (!e) return <Loading />
  return (
    <>
      <EnquiryHead e={e} />
      {e.job_id ? <p className="muted">This enquiry was won and is now a job, so tender enquiries are closed.</p> : <TenderTracker enquiryId={e.id} />}
    </>
  )
}
