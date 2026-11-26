import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, todayIso, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { useAccess } from '../lib/access'
import { downloadBlob } from '../lib/letter'
import { enquiryRef } from '../lib/quotations'
import { addTrade, loadTrades } from '../lib/rfis'
import { draftScope, scopePdf, uploadDrawings } from '../lib/tenderScope'
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
  addInvites,
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
import Loading from '../components/Loading'
import SuggestInput from '../components/SuggestInput'
import MoneyInput from '../components/MoneyInput'

// ---------- the Enquiry Generator, rebuilt in the app ----------
// Four steps: the job's details, the documents, the email, then who it goes to. It makes one Outlook draft per contractor
// (nothing is sent from here), and records each as a line in the tender tracker.
const MAX_PQQ = 3 * 1024 * 1024 // the Enquiry Generator's rule: the PQQ must be no larger than 3 MB to attach to a draft
const MAX_ATTACH = 20 * 1024 * 1024 // everything attached to one email: most mailboxes refuse more than about 20 MB

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
  // only what is particular to this package is typed here: everything else comes from the enquiry and from My details
  const [f, setF] = useState({ enquiry: enquiryId ?? '', pkg: '', scope: '', link: '' })
  const [trades, setTrades] = useState<string[]>([])
  const [drawings, setDrawings] = useState<File[]>([])
  const [dragDraw, setDragDraw] = useState(false)
  const [scopeBusy, setScopeBusy] = useState(false)
  const [scopeErr, setScopeErr] = useState<string | null>(null)
  const [attachScope, setAttachScope] = useState(false)
  const uploaded = useRef(new Map<File, string>()) // drawings already in storage
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
    })
    loadTrades().then(setTrades, () => setTrades([]))
    Promise.all([supabase.from('companies').select('*').order('name'), supabase.from('contacts').select('id, company_id, name, role, email')]).then(([c, k]) => {
      const contacts = (k.data ?? []) as (Contact & { company_id: string })[]
      setCompanies(((c.data ?? []) as Company[]).map((co) => ({ ...co, contacts: contacts.filter((x) => x.company_id === co.id) })))
    })
    loadPqqPack().then(setPqq, () => setPqq([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  async function addPackage(name: string) {
    try {
      await addTrade(name)
      setTrades(await loadTrades())
    } catch (e) {
      setError(saveError(e))
    }
  }

  const enquiry = enquiries.find((e) => e.id === f.enquiry)
  // from the enquiry: the job's details; from whoever is using it: the sender
  const sender = me?.full_name ?? ''
  const phone = me?.phone ?? ''
  const ret = enquiry?.due_date ?? ''
  const mail: MailValues = { job: enquiry?.name ?? '', jobno: enquiry ? enquiryRef(enquiry) : '', address: (enquiry?.site_address ?? '').replace(/\s*\n\s*/g, ', '), summary: enquiry?.summary ?? '', main: enquiry?.main_contract ?? '', sub: enquiry?.sub_contract ?? '', link: f.link, scope: attachScope && f.scope.trim() ? 'The scope of works for this package is attached.' : f.scope, notes: enquiry?.notes ?? '', ret: ukDate(ret), package: f.pkg, sender, phone }

  const pkgWords = f.pkg.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  const matchesTrade = (c: Co) => !!c.trade && (pkgWords.length === 0 || pkgWords.some((w) => c.trade!.toLowerCase().includes(w)) || f.pkg.toLowerCase().includes(c.trade.toLowerCase()))
  const q = search.trim().toLowerCase()
  const shown = useMemo(
    () => companies.filter((c) => c.type === 'subcontractor' || c.type === 'supplier').filter((c) => !tradeOnly || matchesTrade(c) || picked[c.id] !== undefined).filter((c) => !q || `${c.name} ${c.trade ?? ''}`.toLowerCase().includes(q)),
    [companies, tradeOnly, q, f.pkg, picked], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const chosen = companies.filter((c) => picked[c.id] !== undefined)
  const contactOf = (c: Co) => c.contacts.find((k) => k.id === picked[c.id]) ?? null
  const emailOf = (c: Co) => contactOf(c)?.email || c.email || null
  const attachBytes = files.reduce((n, x) => n + x.size, 0)

  const step1Ok = !!enquiry && !!f.pkg.trim() && !!ret
  function next() {
    setError(null)
    if (step === 1 && !f.pkg.trim()) return setError('Pick the package.')
    if (step === 1 && !ret) return setError('The enquiry has no tender due date: add it on the enquiry (Edit enquiry), then come back.')
    if (step === 2 && attachBytes > MAX_ATTACH) return setError('The files you are attaching are over 20 MB in total. Put the large drawings behind the link instead.')
    setStep(step + 1)
  }

  const DRAW_OK = /\.(pdf|png|jpe?g|gif|webp)$/i
  function addDrawings(list: File[]) {
    const ok = list.filter((x) => DRAW_OK.test(x.name))
    if (ok.length < list.length) setScopeErr('Only PDF and picture files can be read. Export DWG drawings to PDF first.')
    else setScopeErr(null)
    setDrawings((l) => [...l, ...ok])
  }
  async function makeScope() {
    if (!enquiry) return
    setScopeErr(null)
    if (drawings.reduce((n, x) => n + x.size, 0) > 22 * 1024 * 1024) return setScopeErr('The drawings are over about 22 MB together. Upload just the relevant sheets.')
    setScopeBusy(true)
    try {
      const fresh = drawings.filter((x) => !uploaded.current.has(x))
      const paths = await uploadDrawings(enquiry.id, fresh)
      fresh.forEach((x, i) => uploaded.current.set(x, paths[i]))
      const text = await draftScope({ paths: drawings.map((x) => uploaded.current.get(x)!), package: f.pkg, job: `${enquiryRef(enquiry)} ${enquiry.name}`, address: mail.address, summary: mail.summary, notes: mail.notes, existing: f.scope })
      set('scope', text)
      setAttachScope(true)
    } catch (e) {
      setScopeErr(saveError(e))
    }
    setScopeBusy(false)
  }

  async function createDrafts() {
    if (!enquiry) return
    setBusy(true)
    setError(null)
    try {
      const extra: Attachment[] = files.map((x) => ({ name: x.name, blob: x }))
      if (attachScope && f.scope.trim()) {
        extra.unshift({ name: `Scope of works - ${f.pkg}.pdf`, blob: await scopePdf({ enquiry: `${enquiryRef(enquiry)} · ${enquiry.name}`, address: mail.address, pkg: f.pkg, scope: f.scope, returnBy: ukDate(ret) }) })
      }
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
          const pqqSize = blobs.reduce((s, a) => s + a.blob.size, 0)
          const size = [...extra, ...blobs].reduce((s, a) => s + a.blob.size, 0)
          if (pqqSize <= MAX_PQQ && size <= MAX_ATTACH) {
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
        { enquiry_id: enquiry.id, package: f.pkg.trim(), return_date: ret, job_address: mail.address || null, main_contract: mail.main || null, sub_contract: mail.sub || null, summary: mail.summary || null, scope: f.scope || null, notes: mail.notes || null, documents_link: f.link || null, sender_name: sender || null, sender_phone: phone || null, email_subject: subject, email_body: body },
        invites,
      )
      if (skipped.length) alert(`${n} drafts made. The PQQ pack was left off for ${skipped.join(', ')} because the PQQ is over 3 MB or the email would be too large: send it to them separately from Supply Chain.`)
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
            <button type="button" disabled={i + 1 > step && !step1Ok} onClick={() => (setError(null), setStep(i + 1))}>
              <span>0{i + 1}</span> {s}
            </button>
          </li>
        ))}
      </ol>
      <p className="muted small">Nothing is sent from here: it makes an Outlook draft for each contractor, for you to check and send.</p>
      <Toast message={error} onClose={() => setError(null)} />

      {step === 1 && (
        <div className="tg-cols">
          <section className="card tg-form tg-main">
            <h2>The package</h2>
            <div className="span-2 tg-for">
              For enquiry: <strong>{enquiry ? `${enquiryRef(enquiry)} · ${enquiry.name}` : 'Loading…'}</strong>
            </div>
            <label className="span-2">
              Package * <small className="muted">the trade you are asking them to price</small>
              <SuggestInput value={f.pkg} onChange={(v) => set('pkg', v)} options={trades} placeholder="Search or type a package" limit={30} onAdd={addPackage} />
            </label>
            <p className="span-2 muted small">Next you add the drawings and the scope of works for this package, then check the email and pick who it goes to.</p>
          </section>

          <aside className="tg-side">
            <section className="card tg-from">
              <div className="pane-head">
                <h3 className="sub-head">From the enquiry</h3>
                {enquiry && (
                  <Link to={`/estimating/e/${enquiry.id}/edit`} className="small-button">
                    Edit enquiry
                  </Link>
                )}
              </div>
              <dl className="tg-dl">
                {(
                  [
                    ['Tender due', ret ? ukDate(ret) : '', true],
                    ['Job address', mail.address, false],
                    ['Main contract', mail.main, false],
                    ['Sub-contract', mail.sub, false],
                    ['Project summary', mail.summary, false],
                    ['Tender notes', mail.notes, false],
                  ] as [string, string, boolean][]
                ).map(([k, v, required]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v || <span className={required ? 'error' : 'muted'}>{required ? 'Not set: needed. Add it on the enquiry.' : 'Not set: left out of the email.'}</span>}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="card tg-from">
              <div className="pane-head">
                <h3 className="sub-head">From you (the sender)</h3>
                <Link to="/me" className="small-button">
                  My details
                </Link>
              </div>
              <dl className="tg-dl">
                <div>
                  <dt>Name</dt>
                  <dd>{sender || <span className="muted">Not set: add it in My details.</span>}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{phone || <span className="muted">Not set: add it in My details.</span>}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      )}

      {step === 2 && (
        <div className="tg-stack">
          <section className="card tg-form">
            <h2>Tender documents link</h2>
            <label className="span-2">
              Link to the tender documents (SharePoint or OneDrive)
              <input value={f.link} onChange={(e) => set('link', e.target.value)} placeholder="https://duboulayprojects.sharepoint.com/…" />
              <small className="muted">Check its sharing is set so the contractors can open it ("Anyone with the link" or the people you are sending to). The app can't check that.</small>
            </label>
          </section>

          <section className="card tg-form">
            <h2>Drawings and scope of works</h2>
            <p className="span-2 muted small">
              Drop the drawings for {f.pkg || 'this package'} here (PDFs or pictures, the relevant sheets, up to about 20 MB). The app reads them and drafts a scope of works for you to check and edit. Nothing is sent anywhere else.
            </p>
            <label
              className={'drop-zone span-2' + (dragDraw ? ' dragging' : '')}
              onDragOver={(e) => {
                e.preventDefault()
                setDragDraw(true)
              }}
              onDragLeave={() => setDragDraw(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragDraw(false)
                addDrawings([...e.dataTransfer.files])
              }}
            >
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/gif,image/webp" multiple onChange={(e) => (addDrawings([...(e.target.files ?? [])]), (e.target.value = ''))} />
              Drag the drawings here, or click to choose them
              <span className="muted small"> PDF or picture files. Export DWG drawings to PDF first.</span>
            </label>
            {drawings.length > 0 && (
              <div className="span-2 tg-files">
                {drawings.map((x, i) => (
                  <span key={i} className="var-file">
                    {x.name} ({x.size > 1024 * 1024 ? (x.size / 1024 / 1024).toFixed(1) + ' MB' : Math.round(x.size / 1024) + ' KB'}){' '}
                    <button type="button" className="small-button" onClick={() => setDrawings(drawings.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="span-2 button-row">
              <button type="button" className="primary" disabled={scopeBusy || !drawings.length || !f.pkg} onClick={makeScope} title={!f.pkg ? 'Pick the package first (step 1)' : ''}>
                {scopeBusy ? 'Reading the drawings… this can take a minute or two' : f.scope.trim() ? 'Draft the scope again from the drawings' : 'Draft the scope of works from the drawings'}
              </button>
            </div>
            <Toast message={scopeErr} onClose={() => setScopeErr(null)} />
            <label className="span-2">
              Scope of works {f.scope.trim() && <small className="muted">(a draft: check it against the drawings and edit)</small>}
              <textarea rows={14} value={f.scope} onChange={(e) => set('scope', e.target.value)} placeholder="Draft it from the drawings above, or type it yourself." />
            </label>
            <label className="check span-2">
              <input type="checkbox" checked={attachScope} disabled={!f.scope.trim()} onChange={(e) => setAttachScope(e.target.checked)} /> Attach the scope of works to each email (as a PDF)
            </label>
          </section>

          <section className="card tg-form">
            <h2>Other files to attach</h2>
            <div className="span-2 rfi-field">
              <span className="label">Attached to every draft (optional, 20 MB in total)</span>
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
              {attachBytes > MAX_ATTACH && <span className="error">Over 20 MB: use the link for the large drawings.</span>}
              <span className="hint">Large drawings go behind the link. The PQQ is added automatically for any contractor who isn't yet approved (from Settings › Standard documents), as long as it is no more than 3 MB.</span>
            </div>
          </section>
        </div>
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
            <input className="search" placeholder="Search subcontractors and suppliers" value={search} onChange={(e) => setSearch(e.target.value)} />
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
          {shown.length === 0 && <p className="muted">No subcontractors or suppliers match. Untick the trade filter to see them all, or add them under Supply Chain (as a subcontractor or supplier).</p>}
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
        {step > 1 && <button onClick={() => (setError(null), setStep(step - 1))}>← Back</button>}
        {step < 4 && (
          <button className="primary" onClick={next}>
            Next →
          </button>
        )}
      </div>
    </div>
  )
}

// An error message that never covers the form: a small note pinned to the bottom corner that scrolls if it is long and can be closed.
function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null
  return (
    <div className="tg-toast" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Close">
        ✕
      </button>
    </div>
  )
}

// ---------- an enquiry sent outside the app ----------
// Logs a package that was sent by email, phone or in person without using the generator, so it is chased and priced in the tracker.
function ManualEnquiry({ enquiry, onDone, onCancel }: { enquiry?: Enquiry; onDone: () => void; onCancel: () => void }) {
  const { me } = useAccess()
  const [trades, setTrades] = useState<string[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [pkg, setPkg] = useState('')
  const [sentOn, setSentOn] = useState(todayIso())
  const [ret, setRet] = useState(enquiry?.due_date ?? '')
  const [link, setLink] = useState('')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [others, setOthers] = useState<{ name: string; email: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadTrades().then(setTrades, () => setTrades([]))
    supabase.from('companies').select('*').order('name').then((r) => setCompanies(((r.data ?? []) as Company[]).filter((c) => c.type === 'subcontractor' || c.type === 'supplier')))
  }, [])
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  async function addPkg(name: string) {
    try {
      await addTrade(name)
      setTrades(await loadTrades())
    } catch (e) {
      setError(saveError(e))
    }
  }
  async function save() {
    if (!enquiry) return
    const named = others.filter((o) => o.name.trim())
    if (!pkg.trim()) return setError('Enter the package (the trade you asked them to price).')
    if (!ret) return setError('Enter the date the tenders are due back.')
    if (picked.size + named.length === 0) return setError('Pick at least one contractor, or add one who is not on Supply Chain.')
    setBusy(true)
    setError(null)
    try {
      if (!trades.some((t) => t.toLowerCase() === pkg.trim().toLowerCase())) await addTrade(pkg.trim()).catch(() => null)
      const invites: Omit<TenderInvite, 'id' | 'package_id'>[] = [
        ...companies
          .filter((c) => picked.has(c.id))
          .map((c) => ({ company_id: c.id, contact_id: null, name: c.name, email: c.email ?? null })),
        ...named.map((o) => ({ company_id: null, contact_id: null, name: o.name.trim(), email: o.email.trim() || null })),
      ].map((x) => ({ ...x, status: 'sent' as InviteStatus, sent_on: sentOn || null, chased_count: 0, last_chased_on: null, quote_amount: null, quote_received_on: null, notes: null }))
      await createPackage(
        {
          enquiry_id: enquiry.id,
          package: pkg.trim(),
          return_date: ret,
          job_address: (enquiry.site_address ?? '').replace(/\s*\n\s*/g, ', ') || null,
          main_contract: enquiry.main_contract ?? null,
          sub_contract: enquiry.sub_contract ?? null,
          summary: enquiry.summary ?? null,
          scope: null,
          notes: ['Sent outside the app.', notes.trim()].filter(Boolean).join(' '),
          documents_link: link.trim() || null,
          sender_name: me?.full_name ?? null,
          sender_phone: me?.phone ?? null,
          email_subject: null,
          email_body: null,
        },
        invites,
      )
      onDone()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  return (
    <div className="tt-package tt-manual">
      <h3 className="sub-head">Log an enquiry sent outside the app</h3>
      <p className="muted small">For a package you emailed, phoned or handed over yourself. It goes into the tracker as Sent, so you can chase it and enter their prices like the others.</p>
      <div className="tg-form">
        <label>
          Package *
          <SuggestInput value={pkg} onChange={setPkg} options={trades} placeholder="Search or type a package" limit={30} onAdd={addPkg} />
        </label>
        <label>
          Sent on
          <input type="date" value={sentOn} onChange={(e) => setSentOn(e.target.value)} />
        </label>
        <label>
          Return by *
          <input type="date" value={ret} onChange={(e) => setRet(e.target.value)} />
        </label>
        <label>
          Documents link (optional)
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
        </label>
        <label className="span-2">
          Notes (optional)
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How it was sent, who you spoke to…" />
        </label>
      </div>
      <h4 className="sub-head">Who it went to</h4>
      <SuggestInput
        value={search}
        onChange={(v) => {
          const c = companies.find((x) => x.name.toLowerCase() === v.trim().toLowerCase() && !picked.has(x.id))
          if (c) {
            toggle(c.id)
            setSearch('')
          } else setSearch(v)
        }}
        options={companies.filter((c) => !picked.has(c.id)).map((c) => c.name)}
        placeholder="Search Supply Chain, or type a new name and add it"
        limit={30}
        onAdd={(name) => {
          setOthers((l) => [...l, { name, email: '' }])
          setTimeout(() => setSearch(''), 0)
        }}
      />
      <div className="tt-manual-chosen">
        {companies
          .filter((c) => picked.has(c.id))
          .map((c) => (
            <span key={c.id} className="tt-chip">
              {c.name} {c.trade && <span className="muted small">· {c.trade}</span>}
              <button type="button" aria-label={`Remove ${c.name}`} onClick={() => toggle(c.id)}>
                ✕
              </button>
            </span>
          ))}
      </div>
      {others.map((o, i) => (
        <div key={i} className="tt-manual-other">
          <input placeholder="Company name" value={o.name} onChange={(e) => setOthers(others.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input placeholder="Email (optional)" value={o.email} onChange={(e) => setOthers(others.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
          <span className="muted small nowrap">new, not on Supply Chain</span>
          <button type="button" className="small-button" aria-label="Remove" onClick={() => setOthers(others.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <Toast message={error} onClose={() => setError(null)} />
      <div className="button-row">
        <button className="primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : `Add to the tracker (${picked.size + others.filter((o) => o.name.trim()).length})`}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------- add a contractor to a package already in the tracker ----------
function AddContractor({ pkg, existing, onDone, onCancel }: { pkg: TenderPackage; existing: TenderInvite[]; onDone: () => void; onCancel: () => void }) {
  const [companies, setCompanies] = useState<Company[]>([])
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [others, setOthers] = useState<{ name: string; email: string }[]>([])
  const [sentOn, setSentOn] = useState(todayIso())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.from('companies').select('*').order('name').then((r) => setCompanies(((r.data ?? []) as Company[]).filter((c) => c.type === 'subcontractor' || c.type === 'supplier')))
  }, [])
  const already = new Set(existing.map((i) => i.company_id).filter(Boolean) as string[])
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  async function save() {
    const named = others.filter((o) => o.name.trim())
    if (picked.size + named.length === 0) return setError('Pick at least one contractor, or add one who is not on Supply Chain.')
    setBusy(true)
    setError(null)
    try {
      await addInvites(
        pkg.id,
        [
          ...companies.filter((c) => picked.has(c.id)).map((c) => ({ company_id: c.id, name: c.name, email: c.email ?? null })),
          ...named.map((o) => ({ company_id: null, name: o.name.trim(), email: o.email.trim() || null })),
        ],
        sentOn || null,
      )
      onDone()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }
  return (
    <div className="tt-manual">
      <h4 className="sub-head">Add a contractor to {pkg.package}</h4>
      <p className="muted small">For someone you have sent this package to outside the app. They go in as Sent.</p>
      <div className="tg-form">
        <label>
          Sent on
          <input type="date" value={sentOn} onChange={(e) => setSentOn(e.target.value)} />
        </label>
      </div>
      <SuggestInput
        value={search}
        onChange={(v) => {
          const c = companies.find((x) => x.name.toLowerCase() === v.trim().toLowerCase() && !picked.has(x.id) && !already.has(x.id))
          if (c) {
            toggle(c.id)
            setSearch('')
          } else setSearch(v)
        }}
        options={companies.filter((c) => !picked.has(c.id) && !already.has(c.id)).map((c) => c.name)}
        placeholder="Search Supply Chain, or type a new name and add it"
        limit={30}
        onAdd={(name) => {
          setOthers((l) => [...l, { name, email: '' }])
          setTimeout(() => setSearch(''), 0)
        }}
      />
      <div className="tt-manual-chosen">
        {companies
          .filter((c) => picked.has(c.id))
          .map((c) => (
            <span key={c.id} className="tt-chip">
              {c.name} {c.trade && <span className="muted small">· {c.trade}</span>}
              <button type="button" aria-label={`Remove ${c.name}`} onClick={() => toggle(c.id)}>
                ✕
              </button>
            </span>
          ))}
      </div>
      {others.map((o, i) => (
        <div key={i} className="tt-manual-other">
          <input placeholder="Company name" value={o.name} onChange={(e) => setOthers(others.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input placeholder="Email (optional)" value={o.email} onChange={(e) => setOthers(others.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
          <span className="muted small nowrap">new, not on Supply Chain</span>
          <button type="button" className="small-button" aria-label="Remove" onClick={() => setOthers(others.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <Toast message={error} onClose={() => setError(null)} />
      <div className="button-row">
        <button className="primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : `Add (${picked.size + others.filter((o) => o.name.trim()).length})`}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// their price, shown as £1,000.00; saved when you leave the box
function TenderPrice({ invite, onSave }: { invite: TenderInvite; onSave: (v: number | null) => void }) {
  const draft = useRef<number | null>(invite.quote_amount == null ? null : Number(invite.quote_amount))
  const orig = invite.quote_amount == null ? null : Number(invite.quote_amount)
  return (
    <div
      onBlur={() => {
        if (draft.current !== orig) onSave(draft.current)
      }}
    >
      <MoneyInput className="small-input" value={orig} placeholder="£" onChange={(v) => (draft.current = v)} />
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
  const [manual, setManual] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
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
  const inView = (i: TenderInvite) => (view === 'all' ? true : view === 'waiting' ? i.status === 'drafted' || AWAITING.includes(i.status) : ['quoted', 'used', 'appointed'].includes(i.status))
  const packages = (data?.packages ?? []).filter((p) => !enquiryId || p.enquiry_id === enquiryId).filter((p) => {
    const e = enq[p.enquiry_id]
    const text = `${e ? enquiryRef(e) + ' ' + e.name : ''} ${p.package}`.toLowerCase()
    const mine = data!.invites.filter((i) => i.package_id === p.id)
    return (!q || text.includes(q) || mine.some((i) => i.name.toLowerCase().includes(q))) && (view === 'all' || mine.some(inView))
  })
  const count = (v: View) => (data?.invites ?? []).filter((i) => (v === 'all' ? true : v === 'waiting' ? i.status === 'drafted' || AWAITING.includes(i.status) : ['quoted', 'used', 'appointed'].includes(i.status))).length

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
          <div className="button-row">
            <button type="button" className="button" onClick={() => setManual(true)} title="Record a package you sent by email, phone or in person without using the generator">
              + Log an enquiry sent outside the app
            </button>
            <Link to={`/estimating/e/${enquiryId}/tender/new`} className="button primary">
              + Send tender enquiries
            </Link>
          </div>
        )}
      </div>
      {manual && enquiryId && (
        <ManualEnquiry
          enquiry={enq[enquiryId]}
          onCancel={() => setManual(false)}
          onDone={() => {
            setManual(false)
            setView('all')
            load()
          }}
        />
      )}
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
      {!data && !error && <Loading />}
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
                <strong>{p.package}</strong> <span className="tag">{e ? `${enquiryRef(e)} · ${e.name}` : 'Enquiry'}</span>
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
                <button className="small-button" title="Add another contractor you have sent this package to" onClick={() => setAdding(p.id)}>
                  + Add contractor
                </button>
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
            {adding === p.id && (
              <AddContractor
                pkg={p}
                existing={all}
                onCancel={() => setAdding(null)}
                onDone={() => {
                  setAdding(null)
                  setView('all')
                  load()
                }}
              />
            )}
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
                      <strong>{i.name}</strong>{i.status === 'used' && <span className="tt-used-tag">Price used</span>}
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
                      <TenderPrice key={i.id + (i.quote_amount ?? '')} invite={i} onSave={(v) => run(() => updateInvite(i.id, { quote_amount: v, ...(v != null && i.status !== 'quoted' && !['used', 'appointed', 'unsuccessful'].includes(i.status) ? statusPatch('quoted', i) : {}) }))} />
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
