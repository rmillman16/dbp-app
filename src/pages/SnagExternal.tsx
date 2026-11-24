import { useEffect, useRef, useState } from 'react'
import HubBlock from '../components/HubBlock'
import { useLocation } from 'react-router-dom'
import { shrinkImage } from '../lib/image'

// A trades person's snag list (script 070): /s/<private link>. No login, and nothing of the rest of the app. Everything goes through
// the "snag-external" Edge Function, which checks the link and returns only this company's snags on this one job. Made for a phone:
// big buttons, one snag per card, the camera opens straight from "Add photo".
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

async function call<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  if (!url) throw new Error('This page is not set up yet.')
  let r: Response
  try {
    r = await fetch(`${url}/functions/v1/snag-external`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(anon ? { apikey: anon } : {}) }, body: JSON.stringify(body) })
  } catch {
    throw new Error("Couldn't reach the server. Please check your signal and try again.")
  }
  const j = (await r.json().catch(() => null)) as ({ ok: boolean; error?: string } & T) | null
  if (!j) throw new Error(r.status === 404 ? 'This page is not switched on yet.' : 'Something went wrong. Please try again.')
  if (!j.ok) throw new Error(j.error ?? 'Something went wrong. Please try again.')
  return j
}

interface Pic {
  id: string
  name: string
}
interface ExtSnag {
  id: string
  number: number
  ref: string
  title: string
  description: string | null
  location: string | null
  status: 'incomplete' | 'complete'
  marked_done_at: string | null
  done_note: string | null
  photos: Pic[]
  proof: Pic[]
}
interface Data {
  company: string
  job: { name: string; ref: string; address: string; hub_url?: string | null }
  snags: ExtSnag[]
}
type Tab = 'todo' | 'done' | 'complete'
const stateOf = (s: ExtSnag): Tab => (s.status === 'complete' ? 'complete' : s.marked_done_at ? 'done' : 'todo')
const ukDate = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

export default function SnagExternal() {
  const token = useLocation().pathname.split('/')[2] ?? ''
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('todo')
  const load = () => call<Data>({ action: 'list', token }).then(setData, (e: Error) => setError(e.message))
  useEffect(() => {
    load()
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const n = (t: Tab) => data?.snags.filter((s) => stateOf(s) === t).length ?? 0
  const shown = (data?.snags ?? []).filter((s) => stateOf(s) === tab)

  return (
    <div className="ext-page snag-ext">
      <header className="ext-head">
        <img src="/dbp-logo.png" alt="du Boulay Projects" height={34} />
      </header>
      <main className="ext-main">
        {error && (
          <div className="card">
            <h1>We couldn't open that</h1>
            <p>{error}</p>
          </div>
        )}
        {!data && !error && <p className="muted">Loading…</p>}
        {data && (
          <>
            <h1>{data.company}: your snags</h1>
            <p className="muted">
              {data.job.ref} {data.job.name}
              {data.job.address ? ` · ${data.job.address.replace(/\n/g, ', ')}` : ''}
            </p>

            <div className="snag-tabs" role="tablist">
              {([
                ['todo', 'To do'],
                ['done', 'Done'],
                ['complete', 'Complete'],
              ] as [Tab, string][]).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={`snag-tab ${k} ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
                  <strong>{n(k)}</strong> {l}
                </button>
              ))}
            </div>
            {tab === 'done' && <p className="muted small">You have said these are done. du Boulay Projects will check them.</p>}
            {shown.length === 0 && <p className="card">{tab === 'todo' ? (n('done') + n('complete') ? 'Nothing left to do. Thank you.' : 'Nothing has been given to you yet.') : 'None here.'}</p>}
            {shown.map((s) => (
              <SnagCard key={s.id} s={s} token={token} onChange={load} />
            ))}
            {data.job.hub_url && <HubBlock url={data.job.hub_url} project={`${data.job.ref} ${data.job.name}`} />}
          </>
        )}
      </main>
      <footer className="ext-foot">du Boulay Projects Limited · This page is private to you. You do not need an account.</footer>
    </div>
  )
}

function SnagCard({ s, token, onChange }: { s: ExtSnag; token: string; onChange: () => void }) {
  const st = stateOf(s)
  const [open, setOpen] = useState(false) // the "mark as done" panel
  const [pics, setPics] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [urls, setUrls] = useState<Record<string, string> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cam = useRef<HTMLInputElement>(null)
  const gal = useRef<HTMLInputElement>(null)

  async function showPhotos() {
    const all = [...s.photos, ...s.proof]
    const m: Record<string, string> = {}
    await Promise.all(all.map(async (p) => (m[p.id] = (await call<{ url: string }>({ action: 'file_url', token, file_id: p.id }).catch(() => ({ url: '' }))).url)))
    setUrls(m)
  }
  async function done() {
    setError(null)
    setBusy(true)
    try {
      const uploaded: { path: string; name: string }[] = []
      for (const f of pics) {
        const small = await shrinkImage(f)
        const r = await call<{ path: string; url: string }>({ action: 'upload_url', token, snag_id: s.id, filename: small.name })
        const form = new FormData()
        form.append('cacheControl', '3600')
        form.append('', small)
        const up = await fetch(r.url, { method: 'PUT', body: form, headers: { 'x-upsert': 'false' } })
        if (!up.ok) throw new Error("A photo couldn't be uploaded. Please try again.")
        uploaded.push({ path: r.path, name: small.name })
      }
      await call({ action: 'mark_done', token, snag_id: s.id, note, files: uploaded })
      setOpen(false)
      setPics([])
      setNote('')
      onChange()
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  async function undo() {
    setBusy(true)
    setError(null)
    try {
      await call({ action: 'undo', token, snag_id: s.id })
      onChange()
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = [...(e.target.files ?? [])]
    e.target.value = ''
    setPics((l) => [...l, ...list])
  }

  return (
    <article className={`card snag-ext-card ${st}`}>
      <div className="snag-ext-head">
        <span className="snag-no">{s.number}</span>
        <div>
          <h2>{s.title}</h2>
          {s.location && <p className="snag-loc">📍 {s.location}</p>}
        </div>
      </div>
      {s.description && <p>{s.description}</p>}
      {(s.photos.length > 0 || s.proof.length > 0) &&
        (urls ? (
          <div className="snag-thumbs">
            {[...s.photos, ...s.proof].map((p) => (
              <span key={p.id} className="snag-thumb big">
                {urls[p.id] ? (
                  <a href={urls[p.id]} target="_blank" rel="noreferrer">
                    <img src={urls[p.id]} alt={p.name} />
                  </a>
                ) : null}
              </span>
            ))}
          </div>
        ) : (
          <button type="button" className="snag-show" onClick={showPhotos}>
            📷 Show {s.photos.length + s.proof.length} photo{s.photos.length + s.proof.length === 1 ? '' : 's'}
          </button>
        ))}

      {st === 'todo' && !open && (
        <button className="snag-done-btn" onClick={() => setOpen(true)}>
          ✓ Mark as done
        </button>
      )}
      {st === 'todo' && open && (
        <div className="snag-done-panel">
          <p>
            <strong>Add a photo of the finished work</strong>
            <span className="muted small"> (optional, but it helps us check it)</span>
          </p>
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={take} />
          <input ref={gal} type="file" accept="image/*" multiple hidden onChange={take} />
          <div className="snag-photo-btns">
            <button type="button" className="snag-camera" onClick={() => cam.current?.click()}>
              📷 Take photo
            </button>
            <button type="button" onClick={() => gal.current?.click()}>
              From gallery
            </button>
          </div>
          {pics.length > 0 && (
            <div className="snag-picks">
              {pics.map((f, i) => (
                <span key={i}>
                  <img src={URL.createObjectURL(f)} alt={f.name} />
                  <button type="button" aria-label="Remove this photo" onClick={() => setPics((l) => l.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note (optional)" />
          {error && <p className="error">{error}</p>}
          <div className="snag-save">
            <button className="primary" disabled={busy} onClick={done}>
              {busy ? 'Sending…' : pics.length ? Confirm: it is done ( photo) : 'Confirm: it is done, no photo'}
            </button>
            <button disabled={busy} onClick={() => (setOpen(false), setPics([]), setError(null))}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {st === 'done' && (
        <div className="snag-waiting">
          <p>
            ✓ You marked this as done{s.marked_done_at ? ` on ${ukDate(s.marked_done_at)}` : ''}. It is waiting to be checked.
          </p>
          {s.done_note && <p className="muted small">Your note: {s.done_note}</p>}
          {error && <p className="error">{error}</p>}
          <button disabled={busy} onClick={undo}>
            I marked the wrong one: undo
          </button>
        </div>
      )}
      {st === 'complete' && <p className="snag-complete">✓ Checked and complete{s.marked_done_at ? '' : ''}.</p>}
    </article>
  )
}
