import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import HubBlock from '../components/HubBlock'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { cleanHtml } from '../lib/richText'
import { ext, extOpenFile, extUpload, getSession, setSession, type ExtAuth, type ExtItem, type ExtListItem } from '../lib/external'

// Outside people's pages (script 061): no login, no Microsoft account, and nothing of the rest of the app. Everything goes
// through the "external" Edge Function. /r/<token> is one item by private link; /external is the email-code page.
const MarkupEditor = lazy(() => import('../components/MarkupEditor')) // loaded only when someone opens a drawing to mark up
const ukDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')
const STATUS: Record<string, string> = { open: 'Open', answered: 'Answered', closed: 'Closed', out: 'Out for review', approved: 'Status A: Approved', approved_noted: 'Status B: Approved with comments', revise: 'Status C: Revise and resubmit', rejected: 'Rejected' }
// how an item stands for the person looking: an answered RFI that DBP has the ball on is "replied", not "answered"
const stateLabel = (state: string | undefined, status: string) =>
  state === 'with_you' ? 'Waiting for you' : state === 'with_dbp' ? 'You have replied: with du Boulay Projects' : state === 'fyi' ? 'For your information' : (STATUS[status] ?? status)
// colour by the date required: red overdue, amber within 3 days, green otherwise; only for what is waiting for them
const dueTone = (due: string | null | undefined, live: boolean) => {
  if (!due || !live) return ''
  const days = Math.floor((new Date(due.slice(0, 10)).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000)
  return days < 0 ? 'overdue' : days <= 3 ? 'due-soon' : ''
}
// what a reviewer chooses for each document
const OUTCOMES: [string, string][] = [
  ['approved', 'Status A: Approved, no comments'],
  ['approved_noted', 'Status B: Approved with comments'],
  ['revise', 'Status C: Revise and resubmit'],
]
const letterRev = (n: number) => String.fromCharCode(64 + n)
// the first issue is the Initial issue; then Rev A, Rev B...; or the Construction issue
const revName = (rev: number, label?: string | null) => label || (rev <= 1 ? 'Initial issue' : `Rev ${letterRev(rev - 1)}`)

export default function ExternalRoutes() {
  return (
    <Routes>
      <Route path="/r/:token" element={<LinkHome />} />
      <Route path="/r/:token/:kind/:id" element={<ByLink />} />
      <Route path="/external" element={<ExternalHome />} />
      <Route path="/external/:kind/:id" element={<BySession />} />
      <Route path="*" element={<Shell><p>This page doesn't exist.</p></Shell>} />
    </Routes>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="ext-page">
      <header className="ext-head">
        <img src="/dbp-logo.png" alt="du Boulay Projects" height={34} />
      </header>
      <main className="ext-main">{children}</main>
      <footer className="ext-foot">du Boulay Projects Limited · This page is private to you. You do not need an account.</footer>
    </div>
  )
}

// a private link opens the whole list for the person it was made for, the item it was sent for first
function LinkHome() {
  const { token } = useParams()
  const [data, setData] = useState<{ items: ExtListItem[]; name: string; focus: { kind: string; id: string } } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    ext<{ items: ExtListItem[]; name: string; focus: { kind: string; id: string } }>({ action: 'list_link', token }).then(setData, (e: Error) => setError(e.message))
  }, [token])
  return (
    <Shell>
      <h1>{data?.name && data.name !== 'You' ? `${data.name.split(' ')[0]}, your RFIs and submittals` : 'Your RFIs and submittals'}</h1>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && data.items.length === 0 && <p>There is nothing addressed to you at the moment.</p>}
      {data && <ItemList items={data.items} to={(i) => `/r/${token}/${i.kind}/${i.id}`} focus={data.focus} />}
    </Shell>
  )
}
function ByLink() {
  const { token, kind, id } = useParams()
  if (kind !== 'rfi' && kind !== 'submittal') return <Shell><p>This page doesn't exist.</p></Shell>
  return (
    <Shell>
      <p>
        <Link to={`/r/${token}`}>← All your RFIs and submittals</Link>
      </p>
      <ItemView auth={{ token: token!, kind, id: id! }} />
    </Shell>
  )
}
function BySession() {
  const { kind, id } = useParams()
  const session = getSession()
  if (!session || (kind !== 'rfi' && kind !== 'submittal')) {
    return (
      <Shell>
        <p>Please <Link to="/external">sign in with your email address</Link> first.</p>
      </Shell>
    )
  }
  return (
    <Shell>
      <p>
        <Link to="/external">← Everything for you</Link>
      </p>
      <ItemView auth={{ session, kind, id: id! }} />
    </Shell>
  )
}

// ---------- the email-code page ----------
function ExternalHome() {
  const [session, setS] = useState<string | null>(getSession())
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [items, setItems] = useState<ExtListItem[] | null>(null)
  const [who, setWho] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!session) return
    ext<{ items: ExtListItem[]; email: string }>({ action: 'list', session }).then(
      (r) => (setItems(r.items), setWho(r.email)),
      (e: Error) => (setError(e.message), setSession(null), setS(null)),
    )
  }, [session])

  async function ask() {
    setError(null)
    setBusy(true)
    try {
      await ext({ action: 'request_code', email })
      setStep('code')
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  async function verify() {
    setError(null)
    setBusy(true)
    try {
      const r = await ext<{ session: string }>({ action: 'verify_code', email, code })
      setSession(r.session)
      setS(r.session)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  if (!session)
    return (
      <Shell>
        <h1>Your RFIs and submittals</h1>
        <p>Enter the email address du Boulay Projects uses for you. We'll send you a 6-digit code: no password or account needed.</p>
        {step === 'email' ? (
          <form
            className="ext-form"
            onSubmit={(e) => {
              e.preventDefault()
              ask()
            }}
          >
            <label>
              Your email address
              <input type="email" autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send me a code'}
            </button>
          </form>
        ) : (
          <form
            className="ext-form"
            onSubmit={(e) => {
              e.preventDefault()
              verify()
            }}
          >
            <p>
              If <strong>{email}</strong> is on a du Boulay Projects job, a code is on its way. It works for 10 minutes.
            </p>
            <label>
              6-digit code
              <input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>{' '}
            <button type="button" onClick={() => (setStep('email'), setCode(''), setError(null))}>
              Use a different address
            </button>
          </form>
        )}
      </Shell>
    )

  return (
    <Shell>
      <div className="ext-bar">
        <h1>Your RFIs and submittals</h1>
        <button type="button" onClick={() => (setSession(null), setS(null), setItems(null), setStep('email'), setCode(''))}>
          Sign out
        </button>
      </div>
      <p className="muted small">Signed in as {who}</p>
      {error && <p className="error">{error}</p>}
      {items === null && <p className="muted">Loading…</p>}
      {items && items.length === 0 && <p>There is nothing addressed to you at the moment.</p>}
      {items && <ItemList items={items} to={(i) => `/external/${i.kind}/${i.id}`} />}
    </Shell>
  )
}

// one table: what is waiting for them first, then by date required; rows coloured by that date
function ItemList({ items, to, focus }: { items: ExtListItem[]; to: (i: ExtListItem) => string; focus?: { kind: string; id: string } }) {
  const navigate = useNavigate()
  const waiting = items.filter((i) => i.act).length
  const late = items.filter((i) => dueTone(i.due_date, i.act) === 'overdue').length
  // RFIs and submittals apart, and each split by project (a client or contractor can be on several jobs)
  const sortRows = (a: ExtListItem, b: ExtListItem) => Number(b.act) - Number(a.act) || (a.due_date ?? '9').localeCompare(b.due_date ?? '9') || b.number - a.number
  const sections = (['rfi', 'submittal'] as const)
    .map((kind) => {
      const mine = items.filter((i) => i.kind === kind)
      const projects = [...new Set(mine.map((i) => i.project))]
        .map((p) => ({ project: p, rows: mine.filter((i) => i.project === p).sort(sortRows) }))
        // the project with most waiting for them first
        .sort((a, b) => b.rows.filter((r) => r.act).length - a.rows.filter((r) => r.act).length || a.project.localeCompare(b.project))
      return { kind, label: kind === 'rfi' ? 'RFIs' : 'Submittals', count: mine.length, waiting: mine.filter((i) => i.act).length, projects }
    })
    .filter((s) => s.count > 0)
  return (
    <>
      <p className="ext-summary">
        <strong>{waiting}</strong> waiting for you{late > 0 && <span className="ext-due overdue"> · {late} overdue</span>} · {items.length} in total
      </p>
      {sections.map((sec) => (
        <div key={sec.kind} className="card ext-table-card">
          <h2 className="ext-sec">
            {sec.label} <span className="muted small">{sec.waiting > 0 ? `${sec.waiting} waiting for you · ` : ''}{sec.count} in total</span>
          </h2>
          {sec.projects.map((p) => (
            <div key={p.project} className="ext-table-wrap">
              <h3 className="ext-proj">{p.project}</h3>
              <table className="ext-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Subject</th>
                    <th>Trade</th>
                    <th>Required by</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((i) => {
                    const tone = dueTone(i.due_date, i.act)
                    return (
                      <tr key={i.kind + i.id} className={`ext-row ${tone || (i.act ? '' : 'quiet')}`} onClick={() => navigate(to(i))}>
                        <td className="ext-ref">
                          <Link to={to(i)} onClick={(e) => e.stopPropagation()}>
                            {i.ref ?? `${i.kind === 'rfi' ? 'RFI' : 'Sub'} ${i.number}`}
                          </Link>
                        </td>
                        <td className="ext-subject">
                          <strong>{i.title}</strong>
                          {!!i.files && <span className="attach-badge" title={`${i.files} file${i.files === 1 ? '' : 's'} attached`}>📎 {i.files}</span>}
                          {i.snippet && <span className="ext-snippet">{i.snippet}</span>}
                          {focus && focus.kind === i.kind && focus.id === i.id && <span className="ext-act small">The one you were emailed about</span>}
                        </td>
                        <td>{i.trade ?? ''}</td>
                        <td className={`ext-due ${tone}`}>{i.due_date ? ukDate(i.due_date) + (tone === 'overdue' ? ' (overdue)' : '') : '–'}</td>
                        <td>
                          <span className={`q-status ext-${i.state ?? i.status}`}>{stateLabel(i.state, i.status)}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
      {/* the project hub, large, at the bottom: one for each job on the list */}
      {[...new Map(items.filter((i) => i.hub_url).map((i) => [i.hub_url!, i.project])).entries()].map(([url, project]) => (
        <HubBlock key={url} url={url} project={project} />
      ))}
    </>
  )
}

// ---------- one item ----------
function ItemView({ auth }: { auth: ExtAuth }) {
  const [item, setItem] = useState<ExtItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [outcome, setOutcome] = useState('approved')
  const [perDoc, setPerDoc] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [marking, setMarking] = useState<{ name: string; blob: Blob } | null>(null)
  const navigate = useNavigate()
  const load =() => ext<{ item: ExtItem }>({ action: 'view', ...auth }).then((r) => setItem(r.item), (e: Error) => setError(e.message))
  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!item) return
    setError(null)
    setBusy(true)
    try {
      const uploaded = []
      for (const f of files) uploaded.push(await extUpload(auth, f))
      if (item.kind === 'rfi') await ext({ action: 'reply', ...auth, text, files: uploaded })
      else {
        const cur = (item.revisions ?? []).find((r) => r.rev === item.current_rev)
        const docs = (cur?.files ?? []).filter((f) => f.kind === 'submission')
        if (docs.some((d) => !perDoc[d.id])) throw new Error('Please choose a status (A, B or C) for every document.')
        await ext({ action: 'respond', ...auth, outcome, items: docs.map((d) => ({ file_id: d.id, outcome: perDoc[d.id] })), text, files: uploaded })
      }
      setText('')
      setFiles([])
      setDone(item.kind === 'rfi' ? 'Thank you: your reply has been sent to du Boulay Projects.' : 'Thank you: your response has been sent to du Boulay Projects.')
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  const open = (id: string) => extOpenFile(auth, id).catch((e: Error) => setError(e.message))
  // open a drawing in the mark-up editor (only for what they can still answer)
  async function markUp(f: { id: string; name: string }) {
    setError(null)
    try {
      const r = await ext<{ url: string }>({ action: 'file_url', ...auth, file_id: f.id })
      const res = await fetch(r.url)
      if (!res.ok) throw new Error()
      setMarking({ name: f.name, blob: await res.blob() })
    } catch {
      setError("Couldn't open that file for mark-up. Please try again.")
    }
  }
  const chips = (list: { id: string; name: string; outcome?: string | null }[] | undefined) =>
    (list ?? []).length > 0 && (
      <div className="var-files">
        {list!.map((f) => (
          <span key={f.id} className="var-file">
            <button type="button" className="link-button small" onClick={() => open(f.id)}>
              📎 {f.name}
            </button>
            {f.outcome && <span className={`q-status ext-${f.outcome}`}>{(STATUS[f.outcome] ?? '').split(':')[0]}</span>}
            {item?.can_act && !done && /\.(pdf|png|jpe?g|gif|bmp)$/i.test(f.name) && (
              <button type="button" className="small-button markup-open" onClick={() => markUp(f)} title="Draw lines, arrows, boxes and notes on this drawing">
                ✏ Mark up
              </button>
            )}
          </span>
        ))}
      </div>
    )

  if (error && !item)
    return (
      <div className="card">
        <h1>We couldn't open that</h1>
        <p>{error}</p>
        <p className="muted small">If you were sent a link by du Boulay Projects, ask them for a new one. Or <Link to="/external">sign in with your email address</Link>.</p>
      </div>
    )
  if (!item) return <p className="muted">Loading…</p>
  const rfi = item.kind === 'rfi'

  return (
    <>
      {marking && (
        <Suspense fallback={<p className="muted">Loading the mark-up tool…</p>}>
          <MarkupEditor
            source={marking.blob}
            name={marking.name}
            onClose={() => setMarking(null)}
            onSave={(list) => {
              setFiles((l) => [...l, ...list])
              setMarking(null)
            }}
          />
        </Suspense>
      )}
      <div className="card">
        <p className="muted small">{item.project}</p>

        <h1>
          {rfi ? 'RFI' : 'Submittal'} {item.number}: {item.title}
        </h1>
        {item.ref && <p className="muted small">Reference: <strong>{item.ref}</strong> (quote this if you phone us)</p>}
        <p>
          <span className={`q-status ext-${item.state ?? item.status}`}>{stateLabel(item.state, item.status)}</span>
          {!rfi && <span className="rfi-kind"> {revName(item.current_rev ?? 1, item.rev_label)}</span>}
          {item.due_date && <span> · {rfi ? 'Reply' : 'Respond'} by <strong className={`ext-due ${dueTone(item.due_date, item.state === 'with_you')}`}>{ukDate(item.due_date)}</strong></span>}
          {item.trade && <span> · {item.trade}</span>}
        </p>
        {item.manager && <p className="muted small">From {item.manager}, du Boulay Projects</p>}
        {item.body && <div className="rte-view" dangerouslySetInnerHTML={{ __html: cleanHtml(item.body) }} />}
        {rfi && chips(item.files)}
        {!rfi && (() => {
          const cur = (item.revisions ?? []).find((r) => r.rev === item.current_rev)
          const docs = (cur?.files ?? []).filter((f) => f.kind === 'submission')
          return docs.length > 0 && (
            <div className="ext-docs">
              <span className="label">Documents to review ({revName(item.current_rev ?? 1, item.rev_label)})</span>
              {chips(docs)}
              {item.can_act && !done && <p className="muted small">Give each document a status in the response form below.</p>}
            </div>
          )
        })()}
      </div>

      {rfi && (item.responses ?? []).length > 0 && (
        <div className="card">
          <h2>Replies</h2>
          <ul className="rfi-thread">
            {item.responses!.map((r) => (
              <li key={r.id} className={'rfi-' + r.kind}>
                <div className="rfi-thread-head">
                  <strong>{r.author}</strong>
                  <span className="rfi-kind">{r.kind === 'follow_up' ? 'Reply from du Boulay Projects' : 'Reply'}</span>
                  <small>{ukDate(r.at)}</small>
                </div>
                <div className="rte-view" dangerouslySetInnerHTML={{ __html: cleanHtml(r.body) }} />
                {chips(r.files)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!rfi && (
        <div className="card">
          <h2>Revisions</h2>
          <ul className="rfi-thread">
            {[...(item.revisions ?? [])].reverse().map((r) => (
              <li key={r.id} className={r.outcome ? 'rev-' + r.outcome : ''}>
                <div className="rfi-thread-head">
                  <strong>{revName(r.rev, r.rev_label)}</strong>
                  <span className="rfi-kind">{r.submitted_on ? `Submitted ${ukDate(r.submitted_on)}` : 'Not yet submitted'}</span>
                  {r.outcome && <span className={`q-status ext-${r.outcome}`}>{STATUS[r.outcome]}</span>}
                  {r.responded_by && (
                    <small>
                      {ukDate(r.responded_on)} · {r.responded_by}
                    </small>
                  )}
                </div>
                {r.response_notes && <div className="rte-view" dangerouslySetInnerHTML={{ __html: cleanHtml(r.response_notes) }} />}
                {chips(r.files)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {done && (
        <div className="card">
          <p className="saved">{done}</p>
          <p>
            <Link to={'token' in auth ? `/r/${auth.token}` : '/external'} onClick={() => navigate('token' in auth ? `/r/${auth.token}` : '/external')}>
              See everything addressed to you
            </Link>
          </p>
        </div>
      )}
      {item.can_act && !done ? (
        <div className="card ext-form">
          <h2>{rfi ? 'Your reply' : 'Your response'}</h2>
          {!rfi && (() => {
            const cur = (item.revisions ?? []).find((r) => r.rev === item.current_rev)
            const docs = (cur?.files ?? []).filter((f) => f.kind === 'submission')
            return docs.length > 0 ? (
              <div className="rfi-field">
                <span className="label">Status of each document</span>
                {docs.map((d) => (
                  <div key={d.id} className="doc-status">
                    <span>📎 {d.name}</span>
                    <select value={perDoc[d.id] ?? ''} onChange={(e) => setPerDoc({ ...perDoc, [d.id]: e.target.value })} aria-label={`Status of ${d.name}`}>
                      <option value="">Choose a status…</option>
                      {OUTCOMES.map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <span className="hint">If any document is Status C, the whole submittal comes back as Status C.</span>
              </div>
            ) : (
              <label>
                Outcome
                <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  {OUTCOMES.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            )
          })()}
          <label>
            {rfi ? 'Reply' : 'Comments'}
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={rfi ? 'Type your reply…' : 'Comments and any conditions (needed unless it is simply approved)…'} />
          </label>
          <div className="rfi-field">
            <span className="label">Files (optional)</span>
            <label className="file-button">
              <input type="file" multiple onChange={(e) => (setFiles((l) => [...l, ...(e.target.files ?? [])]), (e.target.value = ''))} />
              <span className="button">+ Add files</span>
            </label>
            {files.map((x, i) => (
              <span key={i} className="var-file">
                {x.name}{' '}
                <button type="button" className="small-button" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            ))}
            <span className="hint">Documents, drawings, pictures or zip files, up to 50 MB each.</span>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy} onClick={send}>
            {busy ? 'Sending…' : rfi ? 'Send reply' : 'Send response'}
          </button>
        </div>
      ) : (
        !done && (
          <p className="muted small">
            {item.you.role === 'cc'
              ? 'This is for your information.'
              : rfi
                ? item.status === 'closed'
                  ? 'This RFI is closed.'
                  : ''
                : item.status !== 'out'
                  ? 'This submittal has been responded to.'
                  : ''}
          </p>
        )
      )}
      {item.hub_url && <HubBlock url={item.hub_url} project={item.project} />}
    </>
  )
}
