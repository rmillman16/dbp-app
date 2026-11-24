import { useEffect, useMemo, useState } from 'react'
import { formKeys } from '../lib/formKeys'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ukDate, todayIso } from '../lib/format'
import { saveError } from '../lib/offline'
import { useAccess } from '../lib/access'
import { nudgeEmails } from '../lib/notifications'
import { useRfiOwner } from '../lib/rfiOwner'
import {
  CHASE_OPTIONS,
  deleteRfi,
  STATUS_LABELS,
  addResponse,
  addRfiFile,
  addTrade,
  chaseLabel,
  daysOpen,
  isOverdue,
  loadRfi,
  loadRfiVariation,
  raiseVariationFromRfi,
  openRfiFile,
  removeRfiFile,
  setPeople,
  updateRfi,
  type Rfi,
  type RfiFile,
  type RfiPerson,
  type RfiResponse,
  type RfiStatus,
} from '../lib/rfis'
import { keyOf, refOf, useRfiContext } from '../lib/rfiContext'
import { cleanHtml, htmlToText } from '../lib/richText'
import { exportRfisPdf } from '../lib/exportRfis'
import RichTextEditor from '../components/RichTextEditor'
import ExternalAccess from '../components/ExternalAccess'
import PeoplePicker from '../components/PeoplePicker'
import SuggestInput from '../components/SuggestInput'

// Job › RFIs › one RFI: the question, who it's with, replies, files; DBP's RFI manager closes it.
export default function RfiPage() {
  const owner = useRfiOwner()
  const tender = owner.kind === 'enquiry'
  const navigate = useNavigate()
  const { rfiId } = useParams()
  const { me, isAdmin } = useAccess()
  const ctx = useRfiContext(owner)
  const [d, setD] = useState<{ rfi: Rfi; people: RfiPerson[]; responses: RfiResponse[]; files: RfiFile[] } | null>(null)
  const [edit, setEdit] = useState<(Omit<Rfi, 'id'> & { assignees: string[]; cc: string[] }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // new reply
  const [kind, setKind] = useState<'reply' | 'follow_up' | 'note'>('reply')
  // once an RFI has been answered, the natural next step is DBP's reply back to the assignee
  const [kindSet, setKindSet] = useState(false)
  const [by, setBy] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const today = todayIso()

  const load = () => loadRfi(rfiId!).then(setD, (e: Error) => setError(e.message))
  useEffect(() => {
    load()
  }, [rfiId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (d && !kindSet) {
      setKind(d.rfi.status === 'answered' ? 'follow_up' : 'reply')
      setKindSet(true)
    }
  }, [d, kindSet])
  // the variation raised from this RFI, if any (script 062)
  const [vo, setVo] = useState<{ id: string; vo_no: number; title: string; status: string } | null>(null)
  const voId = d?.rfi.variation_id ?? null
  useEffect(() => {
    if (!voId) return setVo(null)
    loadRfiVariation(voId).then(setVo, () => setVo(null))
  }, [voId])

  const assigneeNames = useMemo(() => (d ? d.people.filter((p) => p.role === 'assignee').map(ctx.nameOf).filter(Boolean) : []), [d, ctx.dir, ctx.profiles]) // eslint-disable-line react-hooks/exhaustive-deps
  if (error && !d) return <p className="error">{error}</p>
  if (!d) return <p className="muted">Loading…</p>
  const { rfi, people, responses, files: rfiFiles } = d
  const canClose = isAdmin || me?.id === rfi.manager_id
  const finished = rfi.status === 'closed' || rfi.status === 'void'
  const isDraft = rfi.status === 'draft'

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
  const setStatus = (s: RfiStatus, done: string) => run(async () => void (await updateRfi(rfi.id, { status: s })), done)

  function startEdit() {
    setEdit({
      ...rfi,
      assignees: people.filter((p) => p.role === 'assignee').map(keyOf),
      cc: people.filter((p) => p.role === 'cc').map(keyOf),
    })
  }
  async function saveEdit() {
    if (!edit) return
    if (!edit.due_date) return setError('The "due" date is needed.')
    await run(async () => {
      await updateRfi(rfi.id, {
        title: edit.title.trim() || rfi.title,
        question: cleanHtml(edit.question),
        trade: edit.trade?.trim() || null,
        manager_id: edit.manager_id,
        due_date: edit.due_date || null,
        received_from: edit.received_from || null,
        notify: edit.notify,
        chase_days: edit.chase_days,
      })
      await setPeople(rfi.id, 'assignee', edit.assignees.map(refOf), people)
      await setPeople(rfi.id, 'cc', edit.cc.map(refOf), people)
      setEdit(null)
    }, 'Saved.')
  }
  async function reply() {
    if (!body.replace(/<[^>]*>/g, '').trim() && !files.length) return setError('Write the reply, or attach a file.')
    await run(async () => {
      await addResponse(rfi.id, body, kind, kind === 'reply' && by ? `${by} (recorded by ${me?.full_name ?? 'DBP'})` : (me?.full_name ?? 'DBP'), files)
      // a recorded reply answers it; a follow-up question puts it back to open
      if (kind === 'reply' && rfi.status === 'open') await updateRfi(rfi.id, { status: 'answered' })
      if (kind === 'follow_up' && rfi.status === 'answered') await updateRfi(rfi.id, { status: 'open' })
      setBody('')
      setFiles([])
      setBy('')
    }, kind === 'reply' ? 'Reply recorded: the RFI is now Answered. Review it, then close it.' : kind === 'follow_up' ? 'Reply sent: the RFI is open again, and the assignee has been told.' : 'Note added.')
    nudgeEmails()
  }

  const person = (id: string | null) => ctx.profileName(id)
  // an answered RFI that changes the scope becomes a draft variation carrying the question and the answers
  async function raiseVo() {
    if (!confirm(`Raise a variation from RFI ${rfi.number}? A draft VO is made with the question and the answer(s) in it, and linked to this RFI. You then price it in Variations.`)) return
    await run(async () => {
      const answers = responses.filter((r) => r.kind === 'reply').map((r) => ({ by: r.author_name || person(r.author_id) || 'DBP', text: htmlToText(r.body) }))
      const v = await raiseVariationFromRfi(rfi, answers)
      navigate(`/jobs/${rfi.job_id}/variations/${v.id}`)
    })
  }
  const fileLink = (f: RfiFile) => (
    <span key={f.id} className="var-file">
      <button type="button" className="link-button small" onClick={() => openRfiFile(f.path).catch((e) => setError((e as Error).message))}>
        📎 {f.name}
      </button>
      {!finished && (
        <button type="button" className="small-button" title="Remove" onClick={() => confirm(`Remove ${f.name}?`) && run(() => removeRfiFile(f))}>
          ✕
        </button>
      )}
    </span>
  )

  return (
    <div className="quote-editor rfi-page">
      <div className="sub-bar">
        <div>
          <Link to={owner.base} className="link-button small">
            ← All RFIs
          </Link>
          <h2>
            RFI {rfi.number} · {rfi.title}
          </h2>
          <span className={`q-status rfi-${rfi.status}`}>{STATUS_LABELS[rfi.status]}</span>
          {isOverdue(rfi, today) && <span className="late"> ⚠ overdue</span>}
        </div>
        <div className="button-row">
          <button onClick={() => exportRfisPdf(owner, [ctx.rowFor(rfi, people, responses)], `RFI ${rfi.number}`).catch((e) => setError((e as Error).message))}>PDF</button>
          {!tender && !isDraft && rfi.status !== 'void' && !rfi.variation_id && (
            <button disabled={busy} onClick={raiseVo} title="Make a draft variation from this RFI's question and answer">
              Raise a variation
            </button>
          )}
          {isDraft && (
            <>
              <button
                className="primary"
                disabled={busy}
                onClick={() => confirm(tender ? `Mark RFI ${rfi.number} as issued to the client?` : `Issue RFI ${rfi.number}? The people on it are told and it starts to be chased.`) && setStatus('open', 'Issued.')}
              >
                {tender ? 'Mark as issued' : 'Issue RFI'}
              </button>
              <button
                disabled={busy}
                onClick={() => confirm(`Delete the draft RFI ${rfi.number}?`) && run(async () => { await deleteRfi(rfi.id); navigate(owner.base) })}
              >
                Delete draft
              </button>
            </>
          )}
          {!finished && !isDraft && canClose && (
            <button className="primary" disabled={busy} onClick={() => confirm(`Close RFI ${rfi.number}? It stops being chased.`) && setStatus('closed', 'Closed.')}>
              Close RFI
            </button>
          )}
          {finished && (
            <button disabled={busy} onClick={() => setStatus('open', 'Reopened.')}>
              Reopen
            </button>
          )}
          {!finished && !isDraft && canClose && (
            <button disabled={busy} onClick={() => confirm('Void this RFI (raised in error)?') && setStatus('void', 'Voided.')}>
              Void
            </button>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      {rfi.status === 'answered' && canClose && <p className="pqq-warning">There's a reply. Read it below, then close the RFI, or send a follow-up question if it isn't answered.</p>}

      <section className="card">
        <div className="pane-head">
          <h2>Details</h2>
          {!edit && !finished && (
            <button className="small-button" onClick={startEdit}>
              Edit
            </button>
          )}
        </div>
        {!edit ? (
          <>
            <dl className="rfi-dl">
              <dt>Specification section</dt>
              <dd>{rfi.trade || '–'}</dd>
{!tender && (
<>
              <dt>Assigned to</dt>
              <dd>{assigneeNames.join(', ') || '–'}</dd>
              <dt>Cc</dt>
              <dd>{people.filter((p) => p.role === 'cc').map(ctx.nameOf).join(', ') || '–'}</dd>
</>
)}
              <dt>RFI manager</dt>
              <dd>{person(rfi.manager_id) || '–'}</dd>
{!tender && (
<>
              <dt>Received from</dt>
              <dd>{rfi.received_from ? ctx.dir.find((x) => x.id === rfi.received_from)?.name : '–'}</dd>
</>
)}
              {rfi.variation_id && (
                <>
                  <dt>Variation</dt>
                  <dd>
                    {vo ? (
                      <Link to={`/jobs/${rfi.job_id}/variations/${vo.id}`}>VO {vo.vo_no}: raised from this RFI →</Link>
                    ) : (
                      'Raised from this RFI'
                    )}
                  </dd>
                </>
              )}
              <dt>Due</dt>
              <dd className={isOverdue(rfi, today) ? 'late' : ''}>{rfi.due_date ? ukDate(rfi.due_date) : '–'}</dd>
              <dt>Created</dt>
              <dd>
                {ukDate(rfi.created_at.slice(0, 10))} ({daysOpen(rfi, today)} days{finished ? ' to close' : ' open'})
              </dd>
{!tender && (
<>
              <dt>Chased</dt>
              <dd>
                {chaseLabel(rfi.chase_days)}
                {rfi.last_chased_at ? `, last ${ukDate(rfi.last_chased_at.slice(0, 10))}` : ''}
                {!rfi.notify ? ' · emails off' : ''}
              </dd>
</>
)}
            </dl>
            <h3 className="sub-head">Question</h3>
            <div className="rte-view" dangerouslySetInnerHTML={{ __html: cleanHtml(rfi.question) }} />
            {rfiFiles.filter((f) => !f.response_id).length > 0 && <div className="var-files">{rfiFiles.filter((f) => !f.response_id).map(fileLink)}</div>}
            {!finished && (
              <label className="file-button">
                <input
                  type="file"
                  multiple
                  onChange={(e) => {
                    const list = [...(e.target.files ?? [])]
                    e.target.value = ''
                    if (list.length) run(async () => void (await Promise.all(list.map((f) => addRfiFile(rfi.id, f, null)))), 'Attached.')
                  }}
                />
                <span className="button small-button">+ Attach file</span>
              </label>
            )}
          </>
        ) : (
          <div className="form-grid" {...formKeys}>
            <label className="span-2">
              Title
              <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </label>
            <div className="span-2 rfi-field">
              <span className="label">Question</span>
              <RichTextEditor value={edit.question ?? ''} onChange={(h) => setEdit((c) => (c ? { ...c, question: h } : c))} />
            </div>
{!tender && (
<>
            <div className="span-2 rfi-field">
              <span className="label">Assignees</span>
              <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={ctx.whos} value={edit.assignees} onChange={(v) => setEdit({ ...edit, assignees: v })} placeholder="Select an assignee" />
            </div>
            <div className="span-2 rfi-field">
              <span className="label">Cc</span>
              <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={ctx.whos} value={edit.cc} onChange={(v) => setEdit({ ...edit, cc: v })} placeholder="Select Cc" />
            </div>
</>
)}
            <label>
              RFI manager
              <select value={edit.manager_id ?? ''} onChange={(e) => setEdit({ ...edit, manager_id: e.target.value || null })}>
                <option value="">Choose…</option>
                {ctx.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due date *
              <input type="date" required value={edit.due_date ?? ''} onChange={(e) => setEdit({ ...edit, due_date: e.target.value || null })} />
            </label>
{!tender && (
<>
            <label>
              Received from
              <select value={edit.received_from ?? ''} onChange={(e) => setEdit({ ...edit, received_from: e.target.value || null })}>
                <option value="">None</option>
                {ctx.dir.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.company})
                  </option>
                ))}
              </select>
            </label>
</>
)}
            <label>
              Specification section (trade)
              <SuggestInput value={edit.trade ?? ''} onChange={(v) => setEdit({ ...edit, trade: v })} options={ctx.trades} onAdd={(v) => addTrade(v).then(() => ctx.setTrades((l) => [...l, v.trim()]), () => {})} />
            </label>
{!tender && (
<>
            <label>
              Chase
              <select value={edit.chase_days} onChange={(e) => setEdit({ ...edit, chase_days: Number(e.target.value) })}>
                {CHASE_OPTIONS.map(([n, l]) => (
                  <option key={n} value={n}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="rfi-notify">
              <input type="checkbox" checked={edit.notify} onChange={(e) => setEdit({ ...edit, notify: e.target.checked })} /> Email notifications
            </label>
</>
)}
            <div className="form-actions span-2">
              <button className="primary" disabled={busy} onClick={saveEdit}>
                Save
              </button>
              <button onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      {!isDraft && rfi.status !== 'void' && !tender && (
        <ExternalAccess
          kind="rfi"
          people={people.filter((p) => p.directory_id).map((p) => ({ id: p.id, name: ctx.nameOf(p), role: p.role, email: ctx.dir.find((x) => x.id === p.directory_id)?.email ?? null }))}
          disabled={finished}
        />
      )}

      <section className="card">
        <h2>Replies</h2>
        {responses.length === 0 && <p className="muted small">No replies yet.</p>}
        <ul className="rfi-thread">
          {responses.map((r) => (
            <li key={r.id} className={'rfi-' + r.kind}>
              <div className="rfi-thread-head">
                <strong>{r.author_name || person(r.author_id) || 'DBP'}</strong>
                <span className="rfi-kind">{r.kind === 'reply' ? 'Reply' : r.kind === 'follow_up' ? 'Reply from DBP' : 'Internal note'}</span>
                <small>{ukDate(r.created_at.slice(0, 10))}</small>
              </div>
              <div className="rte-view" dangerouslySetInnerHTML={{ __html: cleanHtml(r.body) }} />
              {rfiFiles.filter((f) => f.response_id === r.id).map(fileLink)}
            </li>
          ))}
        </ul>
        {!finished && !isDraft && (
          <div className="rfi-reply">
            <div className="app-controls reply-kind">
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Type">
                <option value="reply">Record their answer</option>
                <option value="follow_up">Reply to the assignee (the RFI goes back to Open)</option>
                <option value="note">Internal note</option>
              </select>
              {kind === 'reply' && (
                <select value={by} onChange={(e) => setBy(e.target.value)} aria-label="On behalf of">
                  <option value="">From me</option>
                  {assigneeNames.map((n) => (
                    <option key={n} value={n}>
                      On behalf of {n}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <RichTextEditor value={body} onChange={setBody} placeholder={kind === 'reply' ? 'Their answer (outside people will answer through their own link once that is switched on)…' : 'Write here…'} minHeight={90} />
            <div className="app-controls">
              <label className="file-button">
                <input type="file" multiple onChange={(e) => (setFiles((l) => [...l, ...(e.target.files ?? [])]), (e.target.value = ''))} />
                <span className="button">+ Attach</span>
              </label>
              {files.map((x, i) => (
                <span key={i} className="var-file">
                  {x.name}{' '}
                  <button type="button" className="small-button" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </span>
              ))}
              <button className="primary" disabled={busy} onClick={reply}>
                Add
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
