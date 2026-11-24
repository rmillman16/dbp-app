import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { cached, must, saveError } from '../lib/offline'
import { ukDate, todayIso } from '../lib/format'
import { useAccess } from '../lib/access'
import { downloadBlob } from '../lib/letter'
import { openFile } from '../lib/orders'
import {
  DOC_KINDS,
  PQQ_LABELS,
  STATE_LABELS,
  addCompanyDoc,
  docExpiry,
  lastSentText,
  PACK_LABELS,
  packOf,
  loadCompanyDocs,
  loadPqqLog,
  logPqqSent,
  pqqEmail,
  pqqState,
  pqqWentOut,
  removeCompanyDoc,
  savePqq,
  stateClass,
  updateCompanyDoc,
  type CompanyDoc,
  type DocKind,
  type PqqLogRow,
  type PqqState,
} from '../lib/pqq'
import ContactsEditor, { loadContacts, type Contact } from '../components/ContactsEditor'
import type { Company, CompanyType, PqqPack, PqqStatus, Profile } from '../lib/types'
import Loading from '../components/Loading'

// The company list: subcontractors, suppliers, clients, consultants. Used for orders and
// payment notices (name and address printed) and the CVR (iPlicit code). From 23 Nov (script 054) it also
// tracks each subcontractor's / supplier's PQQ: status, 12-month validity, documents with expiry dates,
// what was sent to whom and when, and reminders to the person who chases it.
export const COMPANY_TYPES: [CompanyType, string][] = [
  ['subcontractor', 'Subcontractor'],
  ['supplier', 'Supplier'],
  ['client', 'Client'],
  ['consultant', 'Consultant'],
  ['designer', 'Designer'],
  ['other', 'Other'],
]
type Tab = 'subcontractor' | 'supplier' | 'other'
const TABS: [Tab, string][] = [
  ['subcontractor', 'Subcontractors'],
  ['supplier', 'Suppliers'],
  ['other', 'Clients, consultants and others'],
]
const tabOf = (t: CompanyType): Tab => (t === 'subcontractor' ? 'subcontractor' : t === 'supplier' ? 'supplier' : 'other')
const FILTERS: [string, string][] = [
  ['', 'Any PQQ status'],
  ['approved', 'Approved'],
  ['expiring', 'Approved, expiring (30 days)'],
  ['expired', 'Expired'],
  ['sent', 'Sent, waiting'],
  ['received', 'Back, to review'],
  ['not_sent', 'Not sent'],
  ['rejected', 'Rejected'],
  ['not_required', 'Not required'],
]

export default function Contractors() {
  const { can } = useAccess()
  const [params, setParams] = useSearchParams()
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [people, setPeople] = useState<Profile[]>([])
  const [docs, setDocs] = useState<CompanyDoc[]>([])
  const [lastSent, setLastSent] = useState<Map<string, string>>(new Map())
  const [tab, setTab] = useState<Tab>('subcontractor')
  const [filter, setFilter] = useState('')
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(params.get('company'))
  const [adding, setAdding] = useState(false)
  const today = todayIso()

  const load = useCallback(() => {
    supabase
      .from('companies')
      .select('*')
      .order('name')
      .then(({ data, error }) => (error ? setError(error.message) : setCompanies(data as Company[])))
    loadCompanyDocs().then(setDocs, () => {})
    supabase
      .from('pqq_log')
      .select('company_id, sent_at')
      .order('sent_at', { ascending: false })
      .then(({ data }) => {
        const m = new Map<string, string>()
        for (const r of data ?? []) if (!m.has(r.company_id as string)) m.set(r.company_id as string, r.sent_at as string)
        setLastSent(m)
      })
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    cached('profiles', () => must<Profile[]>(supabase.from('profiles').select('*').order('full_name'))).then(setPeople, () => {})
  }, [])

  // a company opened from a link (an order, the bell): show its tab
  useEffect(() => {
    const c = companies?.find((x) => x.id === params.get('company'))
    if (c) {
      setTab(tabOf(c.type))
      setOpenId(c.id)
    }
  }, [companies, params])

  const docsBy = useMemo(() => {
    const m = new Map<string, CompanyDoc[]>()
    for (const d of docs) m.set(d.company_id, [...(m.get(d.company_id) ?? []), d])
    return m
  }, [docs])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (companies ?? []).filter((c) => {
      if (tabOf(c.type) !== tab) return false
      if (tab !== 'other' && filter && pqqState(c, today) !== (filter as PqqState)) return false
      return !needle || [c.name, c.trade, c.postcode].some((x) => (x ?? '').toLowerCase().includes(needle))
    })
  }, [companies, tab, filter, q, today])
  const counts = useMemo(() => {
    const m: Record<Tab, number> = { subcontractor: 0, supplier: 0, other: 0 }
    for (const c of companies ?? []) m[tabOf(c.type)]++
    return m
  }, [companies])
  const hasPqq = (companies ?? []).some((c) => c.pqq_status !== undefined)
  const personName = (id: string | null | undefined) => people.find((p) => p.id === id)?.full_name ?? ''

  function replace(c: Company) {
    setCompanies((cs) => (cs ?? []).map((x) => (x.id === c.id ? c : x)))
  }
  function open(id: string | null) {
    setOpenId(id)
    const p = new URLSearchParams(params)
    if (id) p.set('company', id)
    else p.delete('company')
    setParams(p, { replace: true })
  }

  if (!can('contractors')) return null
  return (
    <>
      <div className="pane-head">
        <h1>Supply Chain</h1>
        <button className="primary" onClick={() => setAdding(!adding)}>
          + Add company
        </button>
      </div>
      <section className="card">
        <p className="muted small intro">
          Subcontractors and suppliers, with their pre-qualification (PQQ): approved for 12 months, their insurances and accreditations with expiry dates, and what was sent to
          whom and when. Whoever is set to chase a PQQ gets a reminder on the bell when one is due. The name and address are what print on orders and payment notices.
        </p>
        {!hasPqq && companies && <p className="pqq-warning">PQQ tracking needs script 054 run in Supabase first (supabase/README.md).</p>}
        <div className="segmented contractor-tabs">
          {TABS.map(([t, label]) => (
            <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => (setTab(t), setFilter(''))}>
              {label}
              <span className="seg-count">{counts[t]}</span>
            </button>
          ))}
        </div>
        <div className="contractor-filters app-controls">
          <input type="search" placeholder="Search name, trade or postcode…" value={q} onChange={(e) => setQ(e.target.value)} />
          {tab !== 'other' && hasPqq && (
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="PQQ status">
              {FILTERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                  {v && companies ? ` (${companies.filter((c) => tabOf(c.type) === tab && pqqState(c, today) === v).length})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        {adding && (
          <CompanyForm
            company={null}
            tab={tab}
            people={people}
            onSaved={(c) => {
              setCompanies((cs) => [...(cs ?? []), c].sort((a, b) => a.name.localeCompare(b.name)))
              setAdding(false)
              setTab(tabOf(c.type))
              open(c.id)
            }}
            onCancel={() => setAdding(false)}
          />
        )}
        {companies === null && !error && <Loading />}
        {companies && shown.length === 0 && <p className="muted">Nobody here{filter || q ? ' matching that' : ' yet'}.</p>}
        <ul className="company-list">
          {shown.map((c) => {
            const s = pqqState(c, today)
            const mine = docsBy.get(c.id) ?? []
            const badDocs = mine.filter((d) => docExpiry(d, today) && docExpiry(d, today) !== 'ok')
            const isOpen = openId === c.id
            return (
              <li key={c.id} className={isOpen ? 'open' : ''}>
                <button type="button" className="company-row" onClick={() => open(isOpen ? null : c.id)} aria-expanded={isOpen}>
                  <span className="company-name">
                    <strong>{c.name}</strong>
                    <small>{[COMPANY_TYPES.find(([v]) => v === c.type)?.[1], c.trade, c.postcode].filter(Boolean).join(' · ')}</small>
                  </span>
                  {tab !== 'other' && c.pqq_status !== undefined && (
                    <span className="company-pqq">
                      <span className={`pqq-chip ${stateClass(s)}`}>{STATE_LABELS[s]}</span>
                      <small>
                        {c.pqq_status === 'approved' && c.pqq_expires_on
                          ? `until ${ukDate(c.pqq_expires_on)}`
                          : c.pqq_status === 'sent' && c.pqq_sent_on
                            ? `sent ${ukDate(c.pqq_sent_on)}`
                            : ''}
                        {badDocs.length ? ` · ${badDocs.length} document${badDocs.length === 1 ? '' : 's'} expiring` : ''}
                      </small>
                      <small>{lastSent.get(c.id) ? `last sent ${ukDate(lastSent.get(c.id)!.slice(0, 10))}` : ''}</small>
                      {c.pqq_owner && <small>chase: {personName(c.pqq_owner).split(' ')[0]}</small>}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <CompanyDetail
                    company={c}
                    people={people}
                    isPqq={tab !== 'other' && c.pqq_status !== undefined}
                    onChanged={(x) => {
                      replace(x)
                      load()
                    }}
                    onDeleted={() => {
                      setCompanies((cs) => (cs ?? []).filter((x) => x.id !== c.id))
                      open(null)
                    }}
                    onLogged={load}
                  />
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}

// ---------- the company's own details ----------
function CompanyForm({ company, tab, people, onSaved, onCancel }: { company: Company | null; tab: Tab; people: Profile[]; onSaved: (c: Company) => void; onCancel: () => void }) {
  const [f, setF] = useState({
    name: company?.name ?? '',
    type: (company?.type ?? (tab === 'other' ? 'client' : tab)) as CompanyType,
    trade: company?.trade ?? '',
    address: company?.address ?? '',
    postcode: company?.postcode ?? '',
    email: company?.email ?? '',
    phone: company?.phone ?? '',
    iplicit_code: company?.iplicit_code ?? '',
    notes: company?.notes ?? '',
    pqq_owner: company?.pqq_owner ?? '',
    pqq_pack: company?.pqq_pack ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })

  async function save() {
    setError(null)
    if (!f.name.trim()) return setError('The company name is needed.')
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    const row: Record<string, unknown> = {
      name: f.name.trim(),
      type: f.type,
      trade: f.trade.trim() || null,
      address: f.address.trim() || null,
      postcode: f.postcode.trim() || null,
      email: f.email.trim() || null,
      phone: f.phone.trim() || null,
      iplicit_code: f.iplicit_code.trim() || null,
      notes: f.notes.trim() || null,
    }
    if (company?.pqq_status !== undefined || (!company && f.pqq_owner)) row.pqq_owner = f.pqq_owner || null
    if (company?.pqq_status !== undefined) row.pqq_pack = f.pqq_pack || null
    const r = company ? await supabase.from('companies').update(row).eq('id', company.id).select('*').single() : await supabase.from('companies').insert(row).select('*').single()
    setBusy(false)
    if (r.error) return setError(saveError(r.error))
    onSaved(r.data as Company)
  }

  const input = (k: keyof typeof f, label: string, hint?: string, wide = false) => (
    <label className={wide ? 'span-2' : ''}>
      {label}
      <input value={f[k]} onChange={(e) => set(k, e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
  return (
    <div className="company-form">
      <div className="form-grid">
        {input('name', 'Company name', 'Full legal name, as it should print, e.g. Lumen Fit Out Ltd', true)}
        <label>
          Type
          <select value={f.type} onChange={(e) => set('type', e.target.value)}>
            {COMPANY_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {input('trade', 'Trade', 'e.g. Electrical, Mechanical, Joinery')}
        <label className="span-2">
          Address (one line per line, without the postcode)
          <textarea rows={3} value={f.address} onChange={(e) => set('address', e.target.value)} />
        </label>
        {input('postcode', 'Postcode')}
        {input('email', 'Office email', 'Orders and PQQs are addressed here unless a contact is chosen')}
        {input('phone', 'Phone')}
        {input('iplicit_code', 'iPlicit supplier code')}
        <label>
          PQQ chased by
          <select value={f.pqq_owner} onChange={(e) => set('pqq_owner', e.target.value)}>
            <option value="">Admins</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
          <span className="hint">Who gets the reminders to chase this company's PQQ and documents</span>
        </label>
        <label>
          PQQ / account form
          <select value={f.pqq_pack} onChange={(e) => set('pqq_pack', e.target.value)}>
            <option value="">By type ({PACK_LABELS[packOf({ type: f.type, pqq_pack: null })]})</option>
            {(Object.keys(PACK_LABELS) as PqqPack[]).map((p) => (
              <option key={p} value={p}>
                {PACK_LABELS[p]}
              </option>
            ))}
          </select>
          <span className="hint">Which form is emailed to them. Choose PQQ B for a sole trader.</span>
        </label>
        <label className="span-2">
          Notes
          <textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : company ? 'Save' : 'Add company'}
        </button>
        {!company && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

function CompanyDetail({
  company,
  people,
  isPqq,
  onChanged,
  onDeleted,
  onLogged,
}: {
  company: Company
  people: Profile[]
  isPqq: boolean
  onChanged: (c: Company) => void
  onDeleted: () => void
  onLogged: () => void
}) {
  const { isAdmin } = useAccess()
  const [error, setError] = useState<string | null>(null)
  async function remove() {
    if (!confirm(`Delete ${company.name}? Their contacts go too. (Not possible once an order uses them.)`)) return
    const r = await supabase.from('companies').delete().eq('id', company.id)
    if (r.error) return setError(/foreign key|violates/i.test(r.error.message) ? `${company.name} is used by an order or the procurement schedule, so can't be deleted.` : r.error.message)
    onDeleted()
  }
  return (
    <div className="company-detail">
      {isPqq && <PqqPanel company={company} people={people} onChanged={onChanged} onLogged={onLogged} />}
      <h3 className="sub-head">Details</h3>
      <CompanyForm company={company} tab="other" people={people} onSaved={onChanged} onCancel={() => {}} />
      <h3 className="sub-head">Contacts</h3>
      <ContactsEditor companyId={company.id} />
      {error && <p className="error">{error}</p>}
      {isAdmin && (
        <p>
          <button type="button" className="link-button small" onClick={remove}>
            Delete this company
          </button>
        </p>
      )}
    </div>
  )
}

// ---------- PQQ: status, documents with expiry dates, what was sent ----------
function PqqPanel({ company: c, people, onChanged, onLogged }: { company: Company; people: Profile[]; onChanged: (c: Company) => void; onLogged: () => void }) {
  const { me } = useAccess()
  const [docs, setDocs] = useState<CompanyDoc[] | null>(null)
  const [log, setLog] = useState<PqqLogRow[] | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nd, setNd] = useState<{ kind: DocKind; name: string; expires_on: string }>({ kind: 'insurance_pl', name: '', expires_on: '' })
  const [file, setFile] = useState<File | null>(null)
  const [to, setTo] = useState('')
  const state = pqqState(c)
  const today = todayIso()

  useEffect(() => {
    loadCompanyDocs(c.id).then(setDocs, (e: Error) => (setDocs([]), setError(e.message)))
    loadPqqLog(c.id).then(setLog, () => setLog([]))
    loadContacts(c.id).then(
      (cs) => {
        setContacts(cs)
        setTo(cs.find((x) => x.email)?.id ?? '')
      },
      () => {},
    )
  }, [c.id])

  async function run(f: () => Promise<void>) {
    setError(null)
    setMsg(null)
    setBusy(true)
    try {
      await f()
    } catch (e) {
      setError(saveError(e))
    } finally {
      setBusy(false)
    }
  }
  const setStatus = (s: PqqStatus) =>
    run(async () => {
      // moving a status resets what no longer applies, so the dates and reminders follow
      const patch =
        s === 'sent'
          ? { pqq_status: s, pqq_sent_on: todayIso(), pqq_received_on: null, pqq_approved_on: null, pqq_expires_on: null }
          : s === 'received'
            ? { pqq_status: s, pqq_received_on: todayIso(), pqq_approved_on: null, pqq_expires_on: null }
            : s === 'approved'
              ? { pqq_status: s, pqq_approved_on: todayIso(), pqq_expires_on: null }
              : { pqq_status: s, pqq_approved_on: null, pqq_expires_on: null }
      onChanged(await savePqq(c.id, patch))
    })
  const recipient = contacts.find((x) => x.id === to) ?? null

  async function makeEmail() {
    await run(async () => {
      const { eml, documents } = await pqqEmail(c, { name: recipient?.name ?? null, email: recipient?.email || c.email }, me?.full_name ?? null)
      downloadBlob(eml, `PQQ - ${c.name}.eml`)
      const updated = await pqqWentOut(c, recipient?.email || c.email || null, documents, null)
      onChanged(updated)
      setLog(await loadPqqLog(c.id))
      onLogged()
      setMsg(`Downloaded "PQQ - ${c.name}.eml": open it and it opens in Outlook as a new email with the PQQ pack attached, ready to check and send. Logged, and marked Sent.`)
    })
  }

  return (
    <div className="pqq-panel">
      <h3 className="sub-head">
        PQQ <span className={`pqq-chip ${stateClass(state)}`}>{STATE_LABELS[state]}</span>
      </h3>
      <div className="pqq-status app-controls">
        <label>
          Status
          <select value={c.pqq_status} onChange={(e) => setStatus(e.target.value as PqqStatus)} disabled={busy}>
            {(Object.keys(PQQ_LABELS) as PqqStatus[]).map((s) => (
              <option key={s} value={s}>
                {PQQ_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {c.pqq_status === 'sent' && (
          <label>
            Sent on
            <input type="date" value={c.pqq_sent_on ?? ''} onChange={(e) => run(async () => onChanged(await savePqq(c.id, { pqq_sent_on: e.target.value || null })))} />
          </label>
        )}
        {c.pqq_status === 'approved' && (
          <>
            <label>
              Approved on
              <input
                type="date"
                value={c.pqq_approved_on ?? ''}
                onChange={(e) => run(async () => onChanged(await savePqq(c.id, { pqq_approved_on: e.target.value || null, pqq_expires_on: null })))}
              />
            </label>
            <label>
              Valid until
              <input type="date" value={c.pqq_expires_on ?? ''} onChange={(e) => run(async () => onChanged(await savePqq(c.id, { pqq_expires_on: e.target.value || null })))} />
            </label>
          </>
        )}
      </div>
      <p className="muted small">
        {state === 'approved' || state === 'expiring'
          ? `Approved for 12 months${c.pqq_expires_on ? `, until ${ukDate(c.pqq_expires_on)}` : ''}. A reminder goes to whoever chases it 30 days before.`
          : state === 'expired'
            ? 'The 12 months have run out: send a new PQQ.'
            : state === 'sent'
              ? 'Sent and waiting: a reminder to chase goes on the bell 14 days after it was sent.'
              : state === 'received'
                ? 'Back from them: review it, then mark it Approved or Rejected.'
                : 'Orders to this company take the PQQ pack with them until it is approved.'}
      </p>
      <div className="pqq-send app-controls">
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Send to">
          <option value="">{c.email ? `The company (${c.email})` : 'The company (no email on file)'}</option>
          {contacts.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {x.email ? ` <${x.email}>` : ' (no email)'}
            </option>
          ))}
        </select>
        <button type="button" className="primary" onClick={makeEmail} disabled={busy}>
          Email the PQQ pack (Outlook draft)
        </button>
        <span className="muted small">{lastSentText(log ?? [])}</span>
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}

      <h4 className="sub-head">Documents and expiry dates</h4>
      {docs === null ? (
        <p className="muted small">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="muted small">None yet: add their insurances and accreditations (and their completed PQQ) with the date each runs out. A reminder goes to whoever chases it 30 days before.</p>
      ) : (
        <table className="table stack pqq-docs">
          <thead>
            <tr>
              <th>Document</th>
              <th>Type</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => {
              const e = docExpiry(d, today)
              return (
                <tr key={d.id}>
                  <td data-label="Document">
                    {d.path ? (
                      <button type="button" className="link-button" onClick={() => openFile(d.path!).catch((x) => setError((x as Error).message))}>
                        {d.name}
                      </button>
                    ) : (
                      d.name
                    )}
                  </td>
                  <td data-label="Type">{DOC_KINDS.find(([k]) => k === d.kind)?.[1]}</td>
                  <td data-label="Expires" className={e === 'expired' ? 'late' : e === 'expiring' ? 'soon' : ''}>
                    <input
                      type="date"
                      value={d.expires_on ?? ''}
                      onChange={(ev) =>
                        run(async () => {
                          await updateCompanyDoc(d.id, { expires_on: ev.target.value || null })
                          setDocs(await loadCompanyDocs(c.id))
                        })
                      }
                    />
                    {e === 'expired' && <small> expired</small>}
                    {e === 'expiring' && <small> within 30 days</small>}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="small-button"
                      title="Remove"
                      onClick={() =>
                        confirm(`Remove ${d.name}?`) &&
                        run(async () => {
                          await removeCompanyDoc(d)
                          setDocs((l) => (l ?? []).filter((x) => x.id !== d.id))
                        })
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="pqq-newdoc app-controls">
        <select
          value={nd.kind}
          onChange={(e) => setNd({ ...nd, kind: e.target.value as DocKind, name: nd.name || '' })}
          aria-label="Type of document"
        >
          {DOC_KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input value={nd.name} placeholder="Name (optional)" onChange={(e) => setNd({ ...nd, name: e.target.value })} />
        <label className="inline-date">
          Expires <input type="date" value={nd.expires_on} onChange={(e) => setNd({ ...nd, expires_on: e.target.value })} />
        </label>
        <label className="file-button">
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="button">{file ? file.name : 'Choose file (optional)…'}</span>
        </label>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const d = await addCompanyDoc(c.id, { kind: nd.kind, name: nd.name, expires_on: nd.expires_on || null }, file)
              setDocs((l) => [...(l ?? []), d])
              setNd({ ...nd, name: '', expires_on: '' })
              setFile(null)
            })
          }
        >
          + Add document
        </button>
      </div>

      <h4 className="sub-head">Sent</h4>
      {log === null ? (
        <p className="muted small">Loading…</p>
      ) : log.length === 0 ? (
        <p className="muted small">Nothing sent yet. The PQQ pack and orders emailed from the app are logged here.</p>
      ) : (
        <ul className="pqq-log">
          {log.map((l) => (
            <li key={l.id}>
              <strong>{ukDate(l.sent_at.slice(0, 10))}</strong> {l.via === 'order' ? 'Order email' : l.via === 'pqq' ? 'PQQ pack' : 'Reminder'}
              {l.sent_to ? ` to ${l.sent_to}` : ''}
              {l.sent_by ? ` (${people.find((p) => p.id === l.sent_by)?.full_name ?? 'someone'})` : ''}
              {l.documents.length ? <small>: {l.documents.join(', ')}</small> : null}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="link-button small"
        onClick={() =>
          run(async () => {
            const note = prompt('What did you send or say? (e.g. "Chased by phone")')
            if (!note) return
            await logPqqSent({ company_id: c.id, via: 'reminder', sent_to: null, documents: [], note })
            setLog(await loadPqqLog(c.id))
            onLogged()
          })
        }
      >
        + Note a chase
      </button>
      {log && log.some((l) => l.note) && (
        <ul className="pqq-log">
          {log
            .filter((l) => l.note)
            .map((l) => (
              <li key={l.id}>
                <strong>{ukDate(l.sent_at.slice(0, 10))}</strong> {l.note}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
