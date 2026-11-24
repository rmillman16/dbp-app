import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { saveError } from '../lib/offline'
import { ukDate } from '../lib/format'
import { useAccess } from '../lib/access'
import { useJob } from './JobLayout'
import { useRfiContext, type Who } from '../lib/rfiContext'
import PeoplePicker from '../components/PeoplePicker'
import {
  STATE_LABEL,
  addSnagPhoto,
  createSnag,
  deleteSnag,
  loadAssignees,
  loadSnag,
  removeSnagFile,
  snagPhotoUrl,
  snagNo,
  snagRef,
  stateOf,
  sendBackSnag,
  updateSnag,
  type Assignee,
  type Snag,
  type SnagFile,
  type SnagStatus,
} from '../lib/snags'
import Loading from '../components/Loading'
import { supabase } from '../lib/supabase'
import { celebrate } from '../lib/celebrate'

// One snag: the form to make one (on a phone: photo first, then a name and where it is, then who has to put it right) and the
// page for one that exists (change it, add photos, and, when a trade says it is done, check it and complete it or send it back).

// who a snag can be given to: the subcontractors and suppliers on this job, with "+ New person…" for someone not on the list yet
function useAssigneePicker(jobId: string) {
  const ctx = useRfiContext({ kind: 'job', id: jobId })
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const reload = () => loadAssignees(jobId).then(setAssignees, () => setAssignees([]))
  useEffect(() => {
    reload()
  }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps
  const list = assignees.filter((a) => a.type === 'subcontractor' || a.type === 'supplier')
  const whos: Who[] = list.map((a) => ({ key: `d:${a.id}`, label: `${a.name} (${a.company})`, name: `${a.name} (${a.company})`, email: a.email, external: true }))
  return {
    ctx,
    assignees,
    whos,
    onNew: async (p: Parameters<typeof ctx.addPerson>[0]) => {
      const key = await ctx.addPerson(p)
      await reload()
      return key
    },
    byKey: (k: string | null | undefined) => (k ? assignees.find((a) => `d:${a.id}` === k) : undefined),
  }
}

// photos from the phone: the camera straight away, or from the gallery
function PhotoButtons({ onFiles, disabled }: { onFiles: (f: File[]) => void; disabled?: boolean }) {
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
        Add from gallery
      </button>
    </div>
  )
}

// ---------- a new snag ----------
export function SnagNew() {
  const { job } = useJob()
  const navigate = useNavigate()
  const { me } = useAccess()
  const pick = useAssigneePicker(job.id)
  const [title, setTitle] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState<string[]>([])
  const [status, setStatus] = useState<SnagStatus>('incomplete')
  const [photos, setPhotos] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const previews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])
  const titleRef = useRef<HTMLInputElement>(null)

  async function save(another: boolean) {
    setError(null)
    if (!title.trim()) return setError('Give the snag a name.')
    setBusy(true)
    try {
      const a = pick.byKey(assignee[0])
      // offline, it is kept on this device and sent when the signal is back (lib/outbox.ts)
      const s = await createSnag({ job_id: job.id, title, description, location, assignee_id: a?.id ?? null, trade: a?.trade ?? null, status }, photos)
      if (another) {
        // keep the location and assignee: the next snag is usually in the same place
        setSaved(s.number ? `Snag ${s.number} saved.` : 'Saved on this device: it will be sent, and numbered, when you have signal.')
        setTitle('')
        setDescription('')
        setPhotos([])
        setStatus('incomplete')
        titleRef.current?.focus()
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else navigate(`/jobs/${job.id}/snagging`)
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(false)
  }

  return (
    <form
      className="snag-form card"
      onSubmit={(e) => {
        e.preventDefault()
        save(false)
      }}
    >
      <div className="pane-head">
        <h2>New snag</h2>
        <Link to={`/jobs/${job.id}/snagging`} className="small-button button">
          Cancel
        </Link>
      </div>
      {saved && <p className="saved">{saved} Add the next.</p>}
      <p className="muted small">It will be numbered automatically, from 1 on this job. The number can never be changed or reused.</p>

      <div className="rfi-field">
        <span className="label">Photos</span>
        <PhotoButtons onFiles={(f) => setPhotos((l) => [...l, ...f])} disabled={busy} />
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

      <label>
        Name *
        <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Scratch on oak door, flat 4" autoFocus enterKeyHint="next" />
      </label>
      <label>
        Location
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Level 2, Flat 4, hallway" enterKeyHint="next" />
      </label>
      <div className="rfi-field">
        <span className="label">Assigned to</span>
        <PeoplePicker onNew={pick.onNew} companies={pick.ctx.companies} whos={pick.whos} value={assignee} onChange={(v) => setAssignee(v.slice(-1))} placeholder="Which subcontractor puts it right" />
      </div>
      <label>
        Description
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs doing" />
      </label>
      <div className="snag-two">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as SnagStatus)}>
            <option value="incomplete">Incomplete</option>
            <option value="complete">Complete</option>
          </select>
        </label>
        <div className="rfi-field">
          <span className="label">Raised by (approver)</span>
          <div className="snag-fixed">{me?.full_name || me?.email || 'You'}</div>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="snag-save">
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save snag'}
        </button>
        <button type="button" disabled={busy} onClick={() => save(true)}>
          Save and add another
        </button>
      </div>
    </form>
  )
}

// ---------- one snag ----------
export function SnagDetail() {
  const { job } = useJob()
  const { snagId } = useParams()
  const navigate = useNavigate()
  const { me, isAdmin } = useAccess()
  const pick = useAssigneePicker(job.id)
  const [d, setD] = useState<{ snag: Snag; files: SnagFile[] } | null>(null)
  const [form, setForm] = useState<{ title: string; location: string; description: string; status: SnagStatus; assignee: string[] } | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null) // the reason for sending it back; null = not sending back

  const load = () =>
    loadSnag(snagId!).then(
      (r) => {
        setD(r)
        setForm((f) => f ?? { title: r.snag.title, location: r.snag.location ?? '', description: r.snag.description ?? '', status: r.snag.status, assignee: r.snag.assignee_id ? [`d:${r.snag.assignee_id}`] : [] })
      },
      (e: Error) => setError(e.message),
    )
  useEffect(() => {
    load()
  }, [snagId]) // eslint-disable-line react-hooks/exhaustive-deps
  // the pictures, as short-lived addresses
  useEffect(() => {
    if (!d) return
    let live = true
    Promise.all(d.files.filter((f) => !urls[f.id]).map(async (f) => [f.id, await snagPhotoUrl(f.path).catch(() => '')] as const)).then((pairs) => {
      if (live && pairs.length) setUrls((u) => ({ ...u, ...Object.fromEntries(pairs) }))
    })
    return () => {
      live = false
    }
  }, [d]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !d) return <p className="error">{error}</p>
  if (!d || !form) return <Loading />
  const { snag, files } = d
  const st = stateOf(snag)
  const raisedPhotos = files.filter((f) => f.kind === 'raised')
  const proof = files.filter((f) => f.kind === 'proof')
  // anyone with access to the job's RFIs and submittals can update a snag on site
  const canEdit = true
  const isApprover = me?.id === snag.raised_by

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
  const dirty = form.title !== snag.title || form.location !== (snag.location ?? '') || form.description !== (snag.description ?? '') || form.status !== snag.status || (form.assignee[0] ? form.assignee[0].slice(2) : null) !== snag.assignee_id
  const save = () =>
    run(async () => {
      if (!form.title.trim()) throw new Error('Give the snag a name.')
      const a = pick.byKey(form.assignee[0])
      const next = await updateSnag(snag.id, {
        title: form.title.trim(),
        location: form.location.trim() || null,
        description: form.description.trim() || null,
        status: form.status,
        assignee_id: a?.id ?? null,
        trade: a ? a.trade || snag.trade : null,
      })
      setForm({ title: next.title, location: next.location ?? '', description: next.description ?? '', status: next.status, assignee: next.assignee_id ? [`d:${next.assignee_id}`] : [] })
    }, 'Saved.')
  const photoGrid = (list: SnagFile[], removable: boolean) =>
    list.length > 0 && (
      <div className="snag-thumbs">
        {list.map((f) => (
          <span key={f.id} className="snag-thumb big">
            {urls[f.id] ? (
              <a href={urls[f.id]} target="_blank" rel="noreferrer">
                <img src={urls[f.id]} alt={f.name} />
              </a>
            ) : (
              <span className="muted small">…</span>
            )}
            {removable && (
              <button type="button" aria-label="Remove photo" onClick={() => confirm('Remove this photo?') && run(() => removeSnagFile(f))}>
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
    )

  return (
    <div className="snag-form card">
      <div className="pane-head">
        <div>
          <Link to={`/jobs/${job.id}/snagging`} className="link-button small">
            ← All snags
          </Link>
          <h2>
            Snag {snagNo(snag.number)} <span className={`snag-chip ${st}`}>{STATE_LABEL[st]}</span>
          </h2>
          <span className="muted small">{snagRef(job, snag.number)} · raised {ukDate(snag.created_at.slice(0, 10))}</span>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}

      {/* a trade says it is done: check it */}
      {st === 'check' && (
        <div className="snag-check">
          <strong>{snag.marked_done_by || 'The trade'} says this is done</strong>
          <span className="muted small"> · {snag.marked_done_at ? ukDate(snag.marked_done_at.slice(0, 10)) : ''}</span>
          {snag.done_note && <p>{snag.done_note}</p>}
          {photoGrid(proof, false)}
          <p className="muted small">{isApprover ? 'You raised this, so the check is yours.' : 'Only you or the person who raised it needs to check it.'}</p>
          <div className="snag-save">
            <button className="primary" disabled={busy} onClick={() =>
                run(async () => {
                  await updateSnag(snag.id, { status: 'complete' })
                  setForm((f) => f && { ...f, status: 'complete' })
                  // the last one on the job: a moment worth a cheer
                  const left = await supabase.from('snags').select('id', { count: 'exact', head: true }).eq('job_id', job.id).neq('status', 'complete')
                  if (!left.error && left.count === 0) celebrate('Snag list cleared!', `Every snag on ${job.job_no} ${job.code} is complete.`)
                }, 'Checked: the snag is complete.')
              }
            >
              ✓ Checked: complete
            </button>
            <button disabled={busy} onClick={() => setReason(reason === null ? '' : null)}>
              Not done / not good enough: send back
            </button>
          </div>
          {reason !== null && (
            <div className="snag-sendback">
              <label>
                What needs doing before it can be signed off? The trade sees this.
                <textarea rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Paint is patchy at the left of the door: needs a second coat" />
              </label>
              <div className="snag-save">
                <button
                  className="primary"
                  disabled={busy || !reason.trim()}
                  onClick={() =>
                    run(async () => {
                      await sendBackSnag(snag, reason)
                      setReason(null)
                    }, 'Sent back: it is on the trade’s to do list again, with your reason.')
                  }
                >
                  Send it back
                </button>
                <button disabled={busy} onClick={() => setReason(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {snag.reject_count ? <p className="muted small">Sent back {snag.reject_count} time{snag.reject_count === 1 ? '' : 's'} before.</p> : null}
        </div>
      )}
      {st === 'todo' && !!snag.reject_count && snag.reject_note && (
        <p className="snag-rejected">
          <strong>Sent back{snag.rejected_at ? ` on ${ukDate(snag.rejected_at.slice(0, 10))}` : ''}:</strong> {snag.reject_note}
        </p>
      )}
      {st !== 'check' && proof.length > 0 && (
        <div className="rfi-field">
          <span className="label">Proof from the trade</span>
          {photoGrid(proof, false)}
        </div>
      )}

      <div className="rfi-field">
        <span className="label">Photos</span>
        {photoGrid(raisedPhotos, canEdit)}
        {raisedPhotos.length === 0 && <p className="muted small">No photos yet.</p>}
        <PhotoButtons disabled={busy || !canEdit} onFiles={(list) => run(async () => void (await Promise.all(list.map((f) => addSnagPhoto(snag.id, f, 'raised')))), 'Photo added.')} />
      </div>

      <label>
        Name *
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </label>
      <label>
        Location
        <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
      </label>
      <div className="rfi-field">
        <span className="label">Assigned to</span>
        <PeoplePicker onNew={pick.onNew} companies={pick.ctx.companies} whos={pick.whos} value={form.assignee} onChange={(v) => setForm({ ...form, assignee: v.slice(-1) })} placeholder="Which subcontractor puts it right" />
      </div>
      <label>
        Description
        <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <div className="snag-two">
        <label>
          Status
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SnagStatus })}>
            <option value="incomplete">Incomplete</option>
            <option value="complete">Complete</option>
          </select>
        </label>
        <div className="rfi-field">
          <span className="label">Raised by (approver)</span>
          <div className="snag-fixed">{pick.ctx.profileName(snag.raised_by) || '–'}</div>
        </div>
      </div>
      <div className="snag-save">
        <button className="primary" disabled={busy || !dirty} onClick={save}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {isAdmin && (
          <button disabled={busy} onClick={() => confirm(`Delete snag ${snag.number}? Its number is not reused.`) && run(async () => { await deleteSnag(snag.id); navigate(`/jobs/${job.id}/snagging`) })}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
