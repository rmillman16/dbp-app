import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { addDaysIso, money, todayIso, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { useAccess } from '../lib/access'
import { downloadBlob } from '../lib/letter'
import { enquiryRef } from '../lib/quotations'
import { fileBlob, type Attachment } from '../lib/orders'
import { loadPqqPack, needsPqq, packFor, pqqState, pqqWentOut, STATE_LABELS } from '../lib/pqq'
import type { Company, Enquiry } from '../lib/types'
import {
  AWAITING,
  CHASE_BODY,
  CHASE_SUBJECT,
  DEFAULT_BODY,
  DEFAULT_SUBJECT,
  INVITE_STATUS,
  createPackage,
  deleteInvite,
  deletePackage,
  draftFor,
  loadTracker,
  render,
  statusPatch,
  updateInvite,
  updatePackage,
  valuesFor,
  type InviteStatus,
  type MailValues,
  type TenderInvite,
  type TenderPackage,
} from '../lib/tender'

// ---------- the Enquiry Generator, rebuilt in the app ----------
// Four steps: the job's details, the documents, the email, then who it goes to. It makes one Outlook draft per contractor
// (nothing is sent from here), and records each as a line in the tender tracker.
const MAX_ATTACH = 3 * 1024 * 1024 // a draft with more than this attached is a problem for most contractors' mailboxes

type Contact = { id: string; name: string; role: string | null; email: string | null }
type Co = Company & { contacts: Contact[] }

export default function TenderEnquiry() {
  const { enquiryId } = useParams() // the generator only ever works from inside an enquiry
  const navigate = useNavigate()
  const { me } = useAccess()
  const [step, setStep] = useState(1)
  const [enquiries, setEnquiries] = useState<Enquiry[]>([])
  const [companies, setCompanies] = useState<Co[]>([])
  const [pqq, setPqq] = useState<Awaited<ReturnType<typeof loadPqqPack>>>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ enquiry: enquiryId ?? '', pkg: '', ret: addDaysIso(todayIso(), 14), address: '', main: '', sub: '', summary: '', scope: '', notes: '', link: '', sender: '', phone: '' })
  const [files, setFiles] = useState<File[]>([])
  const [subject, setSubject] = useState(DEFAULT_SUBJECT)
  const [body, setBody] = useState(DEFAULT_BODY)
  const [search, setSearch] = useState('')
  const [tradeOnly, setTradeOnly] = useState(true)
  const [picked, setPicked] = useState<Record<string, string>>({}) // company id -> chosen contact id ('' = the company's own address)
  const [confirmed, setConfirmed] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }))

  useEffect(() => {
    supabase.from('enquiries').select('*').eq('id', enquiryId!).then((r) => {
      const list = (r.data ?? []) as Enquiry[]
      setEnquiries(list)
      const e = list.find((x) => x.id === enquiryId)
      if (e) setF((x) => ({ ...x, address: e.site_address ?? '', ret: x.ret }))
    })
    Promise.all([supabase.from('companies').select('*').order('name'), supabase.from('contacts').select('id, company_id, name, role, email')]).then(([c, k]) => {
      const contacts = (k.data ?? []) as (Contact & { company_id: string })[]
      setCompanies(((c.data ?? []) as Company[]).map((co) => ({ ...co, contacts: contacts.filter((x) => x.company_id === co.id) })))
    })
    loadPqqPack().then(setPqq, () => setPqq([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (me?.full_name && !f.sender) setF((x) => ({ ...x, sender: me.full_name ?? '' }))
  }, [me]) // eslint-disable-line react-hooks/exhaustive-deps

  const enquiry = enquiries.find((e) => e.id === f.enquiry)
  const mail: MailValues = { job: enquiry?.name ?? '', jobno: enquiry ? enquiryRef(enquiry) : '', address: f.address, summary: f.summary, main: f.main, sub: f.sub, link: f.link, scope: f.scope, notes: f.notes, ret: ukDate(f.ret), package: f.pkg, sender: f.sender, phone: f.phone }

  const pkgWords = f.pkg.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  const matchesTrade = (c: Co) => !!c.trade && (pkgWords.length === 0 || pkgWords.some((w) => c.trade!.toLowerCase().includes(w)) || f.pkg.toLowerCase().includes(c.trade.toLowerCase()))
  const q = search.trim().toLowerCase()
  const shown = useMemo(
    () => companies.filter((c) => c.type !== 'client').filter((c) => !tradeOnly || matchesTrade(c) || picked[c.id] !== undefined).filter((c) => !q || `${c.name} ${c.trade ?? ''}`.toLowerCase().includes(q)),
    [companies, tradeOnly, q, f.pkg, picked], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const chosen = companies.filter((c) => picked[c.id] !== undefined)
  const contactOf = (c: Co) => c.contacts.find((k) => k.id === picked[c.id]) ?? null
  const emailOf = (c: Co) => contactOf(c)?.email || c.email || null
  const attachBytes = files.reduce((n, x) => n + x.size, 0)

  const step1Ok = !!f.enquiry && !!f.pkg.trim() && !!f.ret
  function next() {
    setError(null)
    if (step === 1 && !step1Ok) return setError('Pick the enquiry, give the package a name and set the tender return date.')
    if (step === 2 && attachBytes > MAX_ATTACH) return setError('The files you are attaching are over 3 MB in total. Put the large drawings behind the link instead.')
    setStep(step + 1)
  }

  async function createDrafts() {
    if (!enquiry) return
    setBusy(true)
    setError(null)
    try {
      const extra: Attachment[] = files.map((x) => ({ name: x.name, blob: x }))
      const skipped: string[] = []
      const pqqSent: string[] = []
      const invites: Omit<TenderInvite, 'id' | 'package_id'>[] = []
      let n = 0
      for (const c of chosen) {
        const k = contactOf(c)
        const vals = valuesFor(mail, c.name, k?.name.split(' ')[0] ?? '')
        let attachments = [...extra]
        const needs = needsPqq(c) && pqq.length > 0
        if (needs) {
          const docs = packFor(c, pqq)
          const blobs = await Promise.all(docs.map(async (d) => ({ name: d.file_name, blob: await fileBlob(d.path) })))
          const size = [...extra, ...blobs].reduce((s, a) => s + a.blob.size, 0)
          if (size <= MAX_ATTACH) {
            attachments = [...attachments, ...blobs]
            pqqSent.push(c.name)
            await pqqWentOut(c, emailOf(c), docs.map((d) => d.name), null).catch(() => null)
          } else skipped.push(c.name)
        }
        const eml = await draftFor({ to: emailOf(c), subject: render(subject, vals), body: render(body, vals), attachments })
        downloadBlob(eml, `${enquiryRef(enquiry)} ${f.pkg} - ${c.name}.eml`)
        n++
        await new Promise((r) => setTimeout(r, 350)) // browsers drop downloads that arrive all at once
        invites.push({ company_id: c.id, contact_id: k?.id ?? null, name: c.name, email: emailOf(c), status: 'drafted', sent_on: null, chased_count: 0, last_chased_on: null, quote_amount: null, quote_received_on: null, notes: null })
      }
      await createPackage(
        { enquiry_id: enquiry.id, package: f.pkg.trim(), return_date: f.ret, job_address: f.address || null, main_contract: f.main || null, sub_contract: f.sub || null, summary: f.summary || null, scope: f.scope || null, notes: f.notes || null, documents_link: f.link || null, sender_name: f.sender || null, sender_phone: f.phone || null, email_subject: subject, email_body: body },
        invites,
      )
      if (skipped.length) alert(`${n} drafts made. The PQQ pack was left off for ${skipped.join(', ')} because the files together are over 3 MB: send it to them separately from Contractors.`)
      navigate(`/estimating/e/${enquiryId}`)
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  const first = chosen[0]
  const preview = first ? valuesFor(mail, first.name, contactOf(first)?.name.split(' ')[0] ?? '') : valuesFor(mail, '[Company]', '[First name]')
  const STEPS = ['Job details', 'Documents', 'Email', 'Recipients']

  return (
    <div className="tender-gen">
      <Link to={`/estimating/e/${enquiryId}`} className="link-button small">
        ← Back to the enquiry
      </Link>
      <h1>Send tender enquiries{enquiry ? `: ${enquiryRef(enquiry)} ${enquiry.name}` : ''}</h1>
      <ol className="tg-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}>
            <button type="button" disabled={i + 1 > step && !step1Ok} onClick={() => setStep(i + 1)}>
              <span>0{i + 1}</span> {s}
            </button>
          </li>
        ))}
      </ol>
      <p className="muted small">Nothing is sent from here: it makes an Outlook draft for each contractor, for you to check and send.</p>
      {error && <p className="error">{error}</p>}

      {step === 1 && (
        <section className="card tg-form">
          <h2>Job details</h2>
          <div className="span-2 tg-for">
            For enquiry: <strong>{enquiry ? `${enquiryRef(enquiry)} · ${enquiry.name}` : 'Loading…'}</strong>
          </div>
          <label>
            Package * <small className="muted">the trade you are asking them to price</small>
            <input value={f.pkg} onChange={(e) => set('pkg', e.target.value)} placeholder="e.g. Mechanical and electrical" />
          </label>
          <label>
            Tender return date *
            <input type="date" value={f.ret} onChange={(e) => set('ret', e.target.value)} />
          </label>
          <label>
            Job address
            <input value={f.address} onChange={(e) => set('address', e.target.value)} />
          </label>
          <label>
            Main contract
            <input value={f.main} onChange={(e) => set('main', e.target.value)} placeholder="e.g. JCT Design and Build 2016" />
          </label>
          <label>
            Sub-contract
            <input value={f.sub} onChange={(e) => set('sub', e.target.value)} placeholder="e.g. JCT Sub-contract" />
          </label>
          <label className="span-2">
            Project summary
            <textarea rows={3} value={f.summary} onChange={(e) => set('summary', e.target.value)} placeholder="e.g. full refurbishment of a five-storey townhouse" />
          </label>
          <label className="span-2">
            What this package covers
            <textarea rows={3} value={f.scope} onChange={(e) => set('scope', e.target.value)} />
          </label>
          <label className="span-2">
            Tender notes
            <textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
          <label>
            Sender name
            <input value={f.sender} onChange={(e) => set('sender', e.target.value)} />
          </label>
          <label>
            Sender phone
            <input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </label>
        </section>
      )}

      {step === 2 && (
        <section className="card tg-form">
          <h2>The documents</h2>
          <label className="span-2">
            Link to the tender documents (SharePoint or OneDrive)
            <input value={f.link} onChange={(e) => set('link', e.target.value)} placeholder="https://duboulayprojects.sharepoint.com/…" />
            <small className="muted">Check its sharing is set so the contractors can open it ("Anyone with the link" or the people you are sending to). The app can't check that.</small>
          </label>
          <div className="span-2 rfi-field">
            <span className="label">Files to attach to every draft (optional, 3 MB in total)</span>
            <label className="file-button">
              <input type="file" multiple onChange={(e) => (setFiles((l) => [...l, ...(e.target.files ?? [])]), (e.target.value = ''))} />
              <span className="button">+ Add files</span>
            </label>
            {files.map((x, i) => (
              <span key={i} className="var-file">
                {x.name} ({Math.round(x.size / 1024)} KB){' '}
                <button type="button" className="small-button" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            ))}
            {attachBytes > MAX_ATTACH && <span className="error">Over 3 MB: use the link for the large drawings.</span>}
            <span className="hint">Large drawings go behind the link. The PQQ is added automatically for any contractor who isn't yet approved (from Settings › Standard documents).</span>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="card tg-form">
          <div className="pane-head span-2">
            <h2>The email</h2>
            <button
              type="button"
              className="small-button"
              onClick={() => {
                setSubject(DEFAULT_SUBJECT)
                setBody(DEFAULT_BODY)
              }}
            >
              Reset
            </button>
          </div>
          <label className="span-2">
            Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="span-2">
            Email
            <textarea rows={16} value={body} onChange={(e) => setBody(e.target.value)} />
            <small className="muted">
              Placeholders fill in for each contractor: {'{{contact}} {{company}} {{job}} {{jobno}} {{package}} {{return}} {{link}} {{summary}} {{scope}} {{notes}} {{main}} {{sub}} {{address}} {{sender}} {{phone}}'}.
            </small>
          </label>
          <div className="span-2 tg-preview">
            <strong>{render(subject, preview)}</strong>
            <pre>{render(body, preview)}</pre>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="card">
          <h2>Who it goes to</h2>
          <div className="toolbar">
            <input className="search" placeholder="Search contractors" value={search} onChange={(e) => setSearch(e.target.value)} />
            <label className="check">
              <input type="checkbox" checked={tradeOnly} onChange={(e) => setTradeOnly(e.target.checked)} /> Only trades that match "{f.pkg || 'the package'}"
            </label>
            <button type="button" className="small-button" onClick={() => setPicked((p) => ({ ...p, ...Object.fromEntries(shown.map((c) => [c.id, p[c.id] ?? ''])) }))}>
              Pick all shown
            </button>
            <button type="button" className="small-button" onClick={() => setPicked({})}>
              Pick none
            </button>
          </div>
          {shown.length === 0 && <p className="muted">No contractors match. Untick the trade filter to see everyone, or add them under Contractors.</p>}
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Company</th>
                <th>Trade</th>
                <th>Send to</th>
                <th>PQQ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const on = picked[c.id] !== undefined
                return (
                  <tr key={c.id}>
                    <td>
                      <input type="checkbox" checked={on} onChange={(e) => setPicked((p) => (e.target.checked ? { ...p, [c.id]: '' } : Object.fromEntries(Object.entries(p).filter(([k]) => k !== c.id))))} />
                    </td>
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td>{c.trade}</td>
                    <td>
                      <select disabled={!on} value={picked[c.id] ?? ''} onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.value }))}>
                        <option value="">{c.email ? `Office: ${c.email}` : 'No office email'}</option>
                        {c.contacts.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.name}
                            {k.email ? ` (${k.email})` : ' (no email)'}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={`tag ${needsPqq(c) ? 'warn' : 'ok'}`}>{STATE_LABELS[pqqState(c)]}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="muted small">
            {chosen.length} picked.{' '}
            {chosen.filter((c) => !emailOf(c)).length > 0 && <span className="error">No email address for: {chosen.filter((c) => !emailOf(c)).map((c) => c.name).join(', ')} (the draft is made with no recipient).</span>}
            {pqq.length === 0 && ' The PQQ pack is empty: add it in Settings › Standard documents.'}
          </p>
          <div className="tg-confirm">
            <label className="check">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I have checked the email, the documents link, the recipients and the PQQ, and want these drafts made.
            </label>
            <button className="primary" disabled={busy || !chosen.length || !confirmed} onClick={createDrafts}>
              {busy ? 'Making drafts…' : `Create ${chosen.length} Outlook draft${chosen.length === 1 ? '' : 's'}`}
            </button>
            <span className="muted small">Each downloads as an .eml: open it, add anyone to Cc, and send. They are recorded in the tracker as "Draft made".</span>
          </div>
        </section>
      )}

      <div className="button-row tg-nav">
        {step > 1 && <button onClick={() => setStep(step - 1)}>← Back</button>}
        {step < 4 && (
          <button className="primary" onClick={next}>
            Next →
          </button>
        )}
      </div>
    </div>
  )
}

// ---------- the tender tracker ----------
type View = 'waiting' | 'quoted' | 'all'
// enquiryId: inside an enquiry (where tender enquiries are sent from); without it, the overview of all enquiries on the Estimating tab
export function TenderTracker({ enquiryId }: { enquiryId?: string }) {
  const navigate = useNavigate()
  const [data, setData] = useState<{ packages: TenderPackage[]; invites: TenderInvite[] } | null>(null)
  const [enq, setEnq] = useState<Record<string, Enquiry>>({})
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('waiting')
  const [search, setSearch] = useState('')
  const today = todayIso()

  const load = () => loadTracker().then(setData, (e: Error) => setError(e.message))
  useEffect(() => {
    load()
    supabase.from('enquiries').select('*').then((r) => setEnq(Object.fromEntries(((r.data ?? []) as Enquiry[]).map((e) => [e.id, e]))))
  }, [])
  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(saveError(e))
    }
  }

  const q = search.trim().toLowerCase()
  const inView = (i: TenderInvite) => (view === 'all' ? true : view === 'waiting' ? i.status === 'drafted' || AWAITING.includes(i.status) : ['quoted', 'appointed'].includes(i.status))
  const packages = (data?.packages ?? []).filter((p) => !enquiryId || p.enquiry_id === enquiryId).filter((p) => {
    const e = enq[p.enquiry_id]
    const text = `${e ? enquiryRef(e) + ' ' + e.name : ''} ${p.package}`.toLowerCase()
    const mine = data!.invites.filter((i) => i.package_id === p.id)
    return (!q || text.includes(q) || mine.some((i) => i.name.toLowerCase().includes(q))) && (view === 'all' || mine.some(inView))
  })
  const count = (v: View) => (data?.invites ?? []).filter((i) => (v === 'all' ? true : v === 'waiting' ? i.status === 'drafted' || AWAITING.includes(i.status) : ['quoted', 'appointed'].includes(i.status))).length

  async function chase(p: TenderPackage, i: TenderInvite) {
    const e = enq[p.enquiry_id]
    const mail: MailValues = { job: e?.name ?? '', jobno: e ? enquiryRef(e) : '', address: p.job_address ?? '', summary: p.summary ?? '', main: p.main_contract ?? '', sub: p.sub_contract ?? '', link: p.documents_link ?? '', scope: p.scope ?? '', notes: p.notes ?? '', ret: ukDate(p.return_date), package: p.package, sender: p.sender_name ?? '', phone: p.sender_phone ?? '' }
    const vals = valuesFor(mail, i.name, '', i.sent_on ? ukDate(i.sent_on) : 'earlier')
    const eml = await draftFor({ to: i.email, subject: render(CHASE_SUBJECT, vals), body: render(CHASE_BODY, vals), attachments: [] })
    downloadBlob(eml, `Chase - ${p.package} - ${i.name}.eml`)
    await run(() => updateInvite(i.id, { chased_count: i.chased_count + 1, last_chased_on: today, ...(i.status === 'drafted' ? statusPatch('sent', i) : {}) }))
  }

  return (
    <section className={'card' + (enquiryId ? ' tt-wide' : '')}>
      <div className="pane-head">
        <h2>{enquiryId ? 'Tender enquiries to contractors' : 'Tender tracker'}</h2>
        {enquiryId && (
          <Link to={`/estimating/e/${enquiryId}/tender/new`} className="button primary">
            + Send tender enquiries
          </Link>
        )}
      </div>
      <p className="muted small">
        {enquiryId
          ? 'Each package you send out for pricing, and where each contractor has got to. Change a status as replies come in, chase from here, and enter their price when it arrives.'
          : 'Every package sent out for pricing, across all enquiries. Tender enquiries are sent from inside an enquiry: open it and use "Send tender enquiries".'}
      </p>
      <div className="toolbar">
        <input className="search" placeholder="Search enquiry, package or contractor" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="segmented">
          {(
            [
              ['waiting', 'Waiting on them'],
              ['quoted', 'Quotes in'],
              ['all', 'All'],
            ] as [View, string][]
          ).map(([v, l]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {l}
              <span className="seg-count">{count(v)}</span>
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && packages.length === 0 && <p className="muted">{data.packages.length === 0 || (enquiryId && !data.packages.some((p) => p.enquiry_id === enquiryId)) ? 'Nothing sent out yet.' : 'Nothing matches.'}</p>}
      {packages.map((p) => {
        const e = enq[p.enquiry_id]
        const all = data!.invites.filter((i) => i.package_id === p.id)
        const rows = all.filter(inView).filter((i) => !q || i.name.toLowerCase().includes(q) || `${e?.name ?? ''} ${p.package}`.toLowerCase().includes(q))
        const waiting = all.filter((i) => AWAITING.includes(i.status)).length
        const quotes = all.filter((i) => i.quote_amount != null)
        const late = p.return_date < today && waiting > 0
        const low = quotes.length ? Math.min(...quotes.map((i) => Number(i.quote_amount))) : null
        return (
          <div key={p.id} className="tt-package">
            <div className="tt-head">
              <div>
                <strong>{e ? `${enquiryRef(e)} · ${e.name}` : 'Enquiry'}</strong> <span className="tag">{p.package}</span>
                <div className="muted small">
                  Return by <span className={late ? 'late' : ''}>{ukDate(p.return_date)}{late ? ' (past)' : ''}</span> · {all.length} invited · {waiting} waiting · {quotes.length} quote{quotes.length === 1 ? '' : 's'} in
                  {low != null && ` · lowest ${money(low)}`}
                </div>
              </div>
              <div className="button-row">
                {all.some((i) => i.status === 'drafted') && (
                  <button className="small-button" title="Once you have sent the drafts" onClick={() => run(() => Promise.all(all.filter((i) => i.status === 'drafted').map((i) => updateInvite(i.id, statusPatch('sent', i)))))}>
                    Mark all drafts as sent
                  </button>
                )}
                <input type="date" className="small-input" title="Tender return date" value={p.return_date} onChange={(ev) => ev.target.value && run(() => updatePackage(p.id, { return_date: ev.target.value }))} />
                {e && (
                  <button className="small-button" onClick={() => navigate(`/estimating/e/${e.id}`)}>
                    Open enquiry
                  </button>
                )}
                <button className="small-button" onClick={() => confirm(`Delete the ${p.package} package and its ${all.length} lines from the tracker?`) && run(() => deletePackage(p.id))}>
                  Delete
                </button>
              </div>
            </div>
            <table className="table tt-table">
              <thead>
                <tr>
                  <th>Contractor</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th>Chased</th>
                  <th>Their price</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className={`tt-${i.status}`}>
                    <td>
                      <strong>{i.name}</strong>
                      <div className="muted small">{i.email ?? 'no email'}</div>
                    </td>
                    <td>
                      <select value={i.status} onChange={(ev) => run(() => updateInvite(i.id, statusPatch(ev.target.value as InviteStatus, i)))}>
                        {INVITE_STATUS.map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="nowrap">{ukDate(i.sent_on) || '–'}</td>
                    <td className="nowrap">{i.chased_count ? `${i.chased_count}× · ${ukDate(i.last_chased_on)}` : '–'}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="small-input"
                        defaultValue={i.quote_amount ?? ''}
                        key={i.id + (i.quote_amount ?? '')}
                        placeholder="£"
                        onBlur={(ev) => {
                          const v = ev.target.value === '' ? null : Number(ev.target.value)
                          if (v !== i.quote_amount) run(() => updateInvite(i.id, { quote_amount: v, ...(v != null && i.status !== 'quoted' && !['appointed', 'unsuccessful'].includes(i.status) ? statusPatch('quoted', i) : {}) }))
                        }}
                      />
                    </td>
                    <td>
                      <input defaultValue={i.notes ?? ''} key={i.id + (i.notes ?? '')} onBlur={(ev) => ev.target.value !== (i.notes ?? '') && run(() => updateInvite(i.id, { notes: ev.target.value || null }))} />
                    </td>
                    <td className="nowrap">
                      {(i.status === 'drafted' || AWAITING.includes(i.status)) && (
                        <button className="small-button" title="Make a reminder draft and count it as chased" onClick={() => chase(p, i).catch((er) => setError(saveError(er)))}>
                          Chase
                        </button>
                      )}{' '}
                      <button className="small-button" title="Remove" onClick={() => confirm(`Remove ${i.name} from this package?`) && run(() => deleteInvite(i.id))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </section>
  )
}
