import { useEffect, useMemo, useRef, useState } from 'react'
import { saveError } from '../lib/offline'
import { ukDate } from '../lib/format'
import {
  KIND_LABELS,
  STATUS_LABELS,
  addSuggestion,
  addSuggestionPhoto,
  deleteSuggestion,
  loadSuggestions,
  removeSuggestionPhoto,
  suggestionPhotoUrl,
  updateSuggestion,
  type Suggestion,
  type SuggestionFile,
  type SuggestionKind,
  type SuggestionStatus,
} from '../lib/suggestions'
import Loading from './Loading'

// Settings › Suggestions and issues (25 Nov, script 089): admins log something wrong or an idea, with photos (take one, add one, or
// paste a screenshot), and track it through New → Planned → Done / Won't do. Admins only.
type Data = Awaited<ReturnType<typeof loadSuggestions>>
const STATUSES: SuggestionStatus[] = ['new', 'planned', 'done', 'declined']

export default function Suggestions() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState<'open' | 'all'>('open')
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})

  const load = () => loadSuggestions().then(setData, (e: Error) => (setError(e.message), setData({ items: [], files: new Map() })))
  useEffect(() => {
    load()
  }, [])
  // pictures, as short-lived addresses
  useEffect(() => {
    if (!data) return
    const todo = [...data.files.values()].flat().filter((f) => !urls[f.id])
    if (!todo.length) return
    let live = true
    Promise.all(todo.map(async (f) => [f.id, await suggestionPhotoUrl(f.path).catch(() => '')] as const)).then((pairs) => live && setUrls((u) => ({ ...u, ...Object.fromEntries(pairs) })))
    return () => {
      live = false
    }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(f: () => Promise<void>, done?: string) {
    setError(null)
    setMsg(null)
    setBusy(true)
    try {
      await f()
      await load()
      if (done) setMsg(done)
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  const items = data?.items ?? []
  const shown = items.filter((s) => show === 'all' || s.status === 'new' || s.status === 'planned')
  const openCount = items.filter((s) => s.status === 'new' || s.status === 'planned').length

  // the open items as plain text: to paste into an email or a chat to whoever is making the changes
  function copyOpen() {
    const text = items
      .filter((s) => s.status === 'new' || s.status === 'planned')
      .map((s, i) => `${i + 1}. [${KIND_LABELS[s.kind]}${s.page ? ` · ${s.page}` : ''}] ${s.title}${s.details ? `\n   ${s.details.replace(/\n/g, '\n   ')}` : ''}${data?.files.get(s.id)?.length ? `\n   (${data.files.get(s.id)!.length} photo${data.files.get(s.id)!.length === 1 ? '' : 's'} in the app)` : ''}`)
      .join('\n')
    navigator.clipboard.writeText(text || 'Nothing open.').then(() => setMsg('Copied the open items.'), () => setError('Couldn’t copy: your browser blocked it.'))
  }

  return (
    <section className="card" id="suggestions">
      <div className="pane-head">
        <h2>Suggestions and issues</h2>
        <button type="button" className="primary" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Close' : '+ Add'}
        </button>
      </div>
      <p className="muted small">
        Something wrong, or something that would help? Write it here with a photo or screenshot of the problem. Only admins can see this list. {openCount} open.
      </p>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}

      {adding && (
        <AddForm
          busy={busy}
          onSave={(v, photos) =>
            run(async () => {
              await addSuggestion(v, photos)
              setAdding(false)
            }, 'Added.')
          }
        />
      )}

      <div className="toolbar">
        <div className="segmented">
          <button type="button" className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>
            Open
          </button>
          <button type="button" className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>
            All
          </button>
        </div>
        <button type="button" onClick={copyOpen} disabled={!openCount}>
          Copy the open items
        </button>
      </div>

      {!data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <p className="muted">{items.length ? 'Nothing open.' : 'Nothing logged yet.'}</p>
      ) : (
        <ul className="sug-list">
          {shown.map((s) => (
            <Item
              key={s.id}
              s={s}
              files={data.files.get(s.id) ?? []}
              urls={urls}
              open={openId === s.id}
              busy={busy}
              onToggle={() => setOpenId(openId === s.id ? null : s.id)}
              onStatus={(st) => run(() => updateSuggestion(s.id, { status: st }))}
              onNote={(note) => run(() => updateSuggestion(s.id, { note: note.trim() || null }), 'Saved.')}
              onAddPhotos={(list) => run(async () => void (await Promise.all(list.map((f) => addSuggestionPhoto(s.id, f)))), 'Photo added.')}
              onRemovePhoto={(f) => run(() => removeSuggestionPhoto(f))}
              onDelete={() => confirm(`Delete “${s.title}” and its photos?`) && run(() => deleteSuggestion(s.id, data.files.get(s.id) ?? []))}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function Photos({ onFiles, disabled }: { onFiles: (f: File[]) => void; disabled?: boolean }) {
  const cam = useRef<HTMLInputElement>(null)
  const gal = useRef<HTMLInputElement>(null)
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = [...(e.target.files ?? [])]
    e.target.value = ''
    if (list.length) onFiles(list)
  }
  return (
    <div className="snag-photo-btns">
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={take} />
      <input ref={gal} type="file" accept="image/*" multiple hidden onChange={take} />
      <button type="button" className="snag-camera" disabled={disabled} onClick={() => cam.current?.click()}>
        <span aria-hidden>📷</span> Take photo
      </button>
      <button type="button" disabled={disabled} onClick={() => gal.current?.click()}>
        Add from gallery / screenshots
      </button>
    </div>
  )
}

function AddForm({ busy, onSave }: { busy: boolean; onSave: (v: { kind: SuggestionKind; title: string; details: string; page: string }, photos: File[]) => void }) {
  const [kind, setKind] = useState<SuggestionKind>('issue')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [page, setPage] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [err, setErr] = useState<string | null>(null)
  const previews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])
  // a screenshot pasted anywhere in the form (Ctrl+V) is added as a photo
  const paste = (e: React.ClipboardEvent) => {
    const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (imgs.length) {
      e.preventDefault()
      setPhotos((l) => [...l, ...imgs.map((f, i) => (f.name === 'image.png' ? new File([f], `screenshot-${Date.now()}-${i}.png`, { type: f.type }) : f))])
    }
  }
  return (
    <form
      className="sug-form"
      onPaste={paste}
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim()) return setErr('Give it a short title.')
        setErr(null)
        onSave({ kind, title, details, page }, photos)
      }}
    >
      <div className="segmented">
        {(['issue', 'idea'] as SuggestionKind[]).map((k) => (
          <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <label>
        Title *
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Payment notice total is wrong on page 2" />
      </label>
      <label>
        Where in the app
        <input value={page} onChange={(e) => setPage(e.target.value)} placeholder="e.g. Job › Orders › Payment notice" />
      </label>
      <label>
        What happened, or what would help
        <textarea rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="What you did, what you expected, what you saw instead." />
      </label>
      <div className="rfi-field">
        <span className="label">Photos and screenshots (you can also paste one with Ctrl+V)</span>
        <Photos onFiles={(f) => setPhotos((l) => [...l, ...f])} disabled={busy} />
        {photos.length > 0 && (
          <div className="snag-thumbs">
            {photos.map((f, i) => (
              <span key={i} className="snag-thumb">
                <img src={previews[i]} alt={f.name} />
                <button type="button" aria-label="Remove photo" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      {err && <p className="error">{err}</p>}
      <div className="snag-save">
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function Item({
  s,
  files,
  urls,
  open,
  busy,
  onToggle,
  onStatus,
  onNote,
  onAddPhotos,
  onRemovePhoto,
  onDelete,
}: {
  s: Suggestion
  files: SuggestionFile[]
  urls: Record<string, string>
  open: boolean
  busy: boolean
  onToggle: () => void
  onStatus: (st: SuggestionStatus) => void
  onNote: (note: string) => void
  onAddPhotos: (f: File[]) => void
  onRemovePhoto: (f: SuggestionFile) => void
  onDelete: () => void
}) {
  const [note, setNote] = useState(s.note ?? '')
  return (
    <li className={`sug-item ${s.status}`}>
      <button type="button" className="sug-head" onClick={onToggle} aria-expanded={open}>
        <span className={`snag-chip sug-${s.status}`}>{STATUS_LABELS[s.status]}</span>
        <span className="sug-title">
          <strong>{s.title}</strong>
          <span className="muted small">
            {[KIND_LABELS[s.kind], s.page, ukDate(s.created_at.slice(0, 10)), files.length ? `📷 ${files.length}` : ''].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>
      {open && (
        <div className="sug-body">
          {s.details && <p style={{ whiteSpace: 'pre-wrap' }}>{s.details}</p>}
          {files.length > 0 && (
            <div className="snag-thumbs">
              {files.map((f) => (
                <span key={f.id} className="snag-thumb big">
                  {urls[f.id] ? (
                    <a href={urls[f.id]} target="_blank" rel="noreferrer">
                      <img src={urls[f.id]} alt={f.name} />
                    </a>
                  ) : (
                    <span className="muted small">…</span>
                  )}
                  <button type="button" aria-label="Remove photo" onClick={() => confirm('Remove this photo?') && onRemovePhoto(f)}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <Photos onFiles={onAddPhotos} disabled={busy} />
          <div className="segmented">
            {STATUSES.map((st) => (
              <button key={st} type="button" className={s.status === st ? 'on' : ''} disabled={busy} onClick={() => onStatus(st)}>
                {STATUS_LABELS[st]}
              </button>
            ))}
          </div>
          <label>
            Note (what was decided or done)
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (s.note ?? '') && onNote(note)} />
          </label>
          <div className="snag-save">
            <button type="button" disabled={busy} onClick={onDelete}>
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
