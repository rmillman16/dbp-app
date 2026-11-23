import { useEffect, useState, type ReactNode } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { cleanHtml } from '../lib/richText'
import { ext, extOpenFile, extUpload, getSession, setSession, type ExtAuth, type ExtItem, type ExtListItem } from '../lib/external'

// Outside people's pages (script 061): no login, no Microsoft account, and nothing of the rest of the app. Everything goes
// through the "external" Edge Function. /r/<token> is one item by private link; /external is the email-code page.
const ukDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')
const STATUS: Record<string, string> = { open: 'Open', answered: 'Answered', closed: 'Closed', out: 'Out for review', approved: 'Approved', approved_noted: 'Approved as noted', revise: 'Revise and resubmit', rejected: 'Rejected' }
const OUTCOMES: [string, string][] = [
  ['approved', 'Approved'],
  ['approved_noted', 'Approved as noted'],
  ['revise', 'Revise and resubmit'],
  ['rejected', 'Rejected'],
]

export default function ExternalRoutes() {
  return (
    <Routes>
      <Route path="/r/:token" element={<ByLink />} />
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

function ByLink() {
  const { token } = useParams()
  return (
    <Shell>
      <ItemView auth={{ token: token! }} />
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

  const byProject = new Map<string, ExtListItem[]>()
  for (const i of items ?? []) byProject.set(i.project, [...(byProject.get(i.project) ?? []), i])
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
      {[...byProject.entries()].map(([project, list]) => (
        <section key={project} className="card">
          <h2>{project}</h2>
          <ul className="ext-list">
            {list
              .sort((a, b) => Number(b.act) - Number(a.act))
              .map((i) => (
                <li key={i.kind + i.id}>
                  <Link to={`/external/${i.kind}/${i.id}`}>
                    {i.kind === 'rfi' ? 'RFI' : 'Submittal'} {i.number}: {i.title}
                  </Link>
                  <span className={`q-status ext-${i.status}`}>{STATUS[i.status] ?? i.status}</span>
                  {i.act && <strong className="ext-act">Waiting for you{i.due_date ? `, due ${ukDate(i.due_date)}` : ''}</strong>}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </Shell>
  )
}

// ---------- one item ----------
function ItemView({ auth }: { auth: ExtAuth }) {
  const [item, setItem] = useState<ExtItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [outcome, setOutcome] = useState('approved')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const load = () => ext<{ item: ExtItem }>({ action: 'view', ...auth }).then((r) => setItem(r.item), (e: Error) => setError(e.message))
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
      else await ext({ action: 'respond', ...auth, outcome, text, files: uploaded })
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
  const chips = (list: { id: string; name: string }[] | undefined) =>
    (list ?? []).length > 0 && (
      <div className="var-files">
        {list!.map((f) => (
          <button key={f.id} type="button" className="link-button small" onClick={() => open(f.id)}>
            📎 {f.name}
          </button>
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
      <div className="card">
        <p className="muted small">{item.project}</p>
        <h1>
          {rfi ? 'RFI' : 'Submittal'} {item.number}: {item.title}
        </h1>
        <p>
          <span className={`q-status ext-${item.status}`}>{STATUS[item.status] ?? item.status}</span>
          {!rfi && <span className="rfi-kind"> Rev {String.fromCharCode(64 + (item.current_rev ?? 1))}</span>}
          {item.due_date && <span> · {rfi ? 'Reply' : 'Respond'} by <strong>{ukDate(item.due_date)}</strong></span>}
          {item.trade && <span> · {item.trade}</span>}
        </p>
        {item.manager && <p className="muted small">From {item.manager}, du Boulay Projects</p>}
        {item.body && <div className="rte-view" dangerouslySetInnerHTML={{ __html: cleanHtml(item.body) }} />}
        {rfi && chips(item.files)}
      </div>

      {rfi && (item.responses ?? []).length > 0 && (
        <div className="card">
          <h2>Replies</h2>
          <ul className="rfi-thread">
            {item.responses!.map((r) => (
              <li key={r.id} className={'rfi-' + r.kind}>
                <div className="rfi-thread-head">
                  <strong>{r.author}</strong>
                  <span className="rfi-kind">{r.kind === 'follow_up' ? 'Follow-up question' : 'Reply'}</span>
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
                  <strong>Rev {String.fromCharCode(64 + r.rev)}</strong>
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
            <Link to="/external" onClick={() => navigate('/external')}>
              See everything addressed to you
            </Link>
          </p>
        </div>
      )}
      {item.can_act && !done ? (
        <div className="card ext-form">
          <h2>{rfi ? 'Your reply' : 'Your response'}</h2>
          {!rfi && (
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
          )}
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
    </>
  )
}
