import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ukDate, todayIso } from '../lib/format'
import { saveError } from '../lib/offline'
import { useAccess } from '../lib/access'
import { nudgeEmails } from '../lib/notifications'
import { useJob } from './JobLayout'
import { CHASE_OPTIONS, addTrade, chaseLabel } from '../lib/rfis'
import { keyOf, refOf, useRfiContext } from '../lib/rfiContext'
import { cleanHtml } from '../lib/richText'
import {
  OUTCOMES,
  SUBMITTAL_STATUS,
  TYPES,
  addFile,
  daysOut,
  deleteSubmittal,
  isFinal,
  isLate,
  loadSubmittal,
  newRevision,
  openFile,
  recordResponse,
  removeFile,
  revName,
  worstOutcome,
  setSubmittalPeople,
  submitForReview,
  typeLabel,
  updateSubmittal,
  type Outcome,
  type Revision,
  type Submittal,
  type SubmittalFile,
  type SubmittalPerson,
  type SubmittalType,
} from '../lib/submittals'
import { exportSubmittalsPdf } from '../lib/exportSubmittals'
import RichTextEditor from '../components/RichTextEditor'
import ExternalAccess from '../components/ExternalAccess'
import PeoplePicker from '../components/PeoplePicker'
import SuggestInput from '../components/SuggestInput'
import Loading from '../components/Loading'

// Job › Submittals › one submittal: details, the revisions (what was submitted, the response, files), and the actions.
export default function SubmittalPage() {
  const { job } = useJob()
  const { submittalId } = useParams()
  const navigate = useNavigate()
  const { me, isAdmin } = useAccess()
  const owner = useMemo(() => ({ kind: 'job' as const, id: job.id }), [job.id])
  const ctx = useRfiContext(owner)
  const [d, setD] = useState<{ s: Submittal; people: SubmittalPerson[]; revisions: Revision[]; files: SubmittalFile[] } | null>(null)
  const [edit, setEdit] = useState<(Omit<Submittal, 'id'> & { submitter: string[]; reviewers: string[]; cc: string[] }) | null>(null)
  const [responding, setResponding] = useState(false)
  const [resp, setResp] = useState<{ outcome: Outcome; by: string; on: string; notes: string; perFile: Record<string, Outcome> }>({ outcome: 'approved', by: '', on: todayIso(), notes: '', perFile: {} })
  const [respFiles, setRespFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const today = todayIso()

  const load = () => loadSubmittal(submittalId!).then(setD, (e: Error) => setError(e.message))
  useEffect(() => {
    load()
  }, [submittalId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !d) return <p className="error">{error}</p>
  if (!d) return <Loading />
  const { s, people, revisions, files } = d
  const cur = revisions.find((r) => r.rev === s.current_rev)
  const curName = revName(s.current_rev, cur?.rev_label ?? s.rev_label)
  // the documents of the revision now out: each gets its own status from the reviewer
  const curDocs = cur ? files.filter((f) => f.revision_id === cur.id && f.kind === 'submission') : []
  const reviewers = people.filter((p) => p.role === 'reviewer')
  const sb = ctx.dir.find((x) => x.id === s.submitted_by)
  const isDraft = s.status === 'draft'
  const canManage = isAdmin || me?.id === s.manager_id || me?.id === s.created_by
  const outsideNames = reviewers.map(ctx.nameOf).filter(Boolean)

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

  function startEdit() {
    setEdit({ ...s, submitter: s.submitted_by ? [`d:${s.submitted_by}`] : [], reviewers: reviewers.map(keyOf), cc: people.filter((p) => p.role === 'cc').map(keyOf) })
  }
  async function saveEdit() {
    if (!edit) return
    if (!edit.due_date) return setError('The "return by" date is needed.')
    await run(async () => {
      await updateSubmittal(s.id, {
        title: edit.title.trim() || s.title,
        description: cleanHtml(edit.description),
        type: edit.type,
        trade: edit.trade?.trim() || null,
        submitted_by: edit.submitter[0] ? edit.submitter[0].slice(2) : null,
        manager_id: edit.manager_id,
        due_date: edit.due_date || null,
        required_by: edit.required_by || null,
        notify: edit.notify,
        chase_days: edit.chase_days,
      })
      await setSubmittalPeople(s.id, 'reviewer', edit.reviewers.map(refOf), people)
      await setSubmittalPeople(s.id, 'cc', edit.cc.map(refOf), people)
      setEdit(null)
    }, 'Saved.')
  }
  async function sendOut() {
    if (!cur) return
    if (!reviewers.length) return setError('Add at least one reviewer first (Edit).')
    if (!s.due_date) return setError('Set a "return by" date first (Edit): reviewers need to know when you need it back.')
    if (!files.some((f) => f.revision_id === cur.id && f.kind === 'submission')) return setError('Attach the submittal document (drawing, data sheet, sample details…) to this revision first: the reviewers have nothing to review without it.')
    if (!confirm(`Send Submittal ${s.number} (${curName}) out for review? The reviewers are told and it starts to be chased.`)) return
    await run(async () => {
      await submitForReview(s.id, cur.id, s.due_date)
    }, 'Out for review.')
    nudgeEmails()
  }
  async function saveResponse() {
    if (!cur) return
    await run(async () => {
      // with documents on the revision, each needs a status and the submittal takes the worst of them
      if (curDocs.length && curDocs.some((f) => !resp.perFile[f.id])) throw new Error('Choose a status (A, B or C) for every document.')
      const outcome = curDocs.length ? worstOutcome(curDocs.map((f) => resp.perFile[f.id])) : resp.outcome
      await recordResponse(s, cur.id, { ...resp, outcome }, respFiles)
      setResponding(false)
      setRespFiles([])
      setResp({ outcome: 'approved', by: '', on: todayIso(), notes: '', perFile: {} })
    }, 'Response recorded.')
    nudgeEmails()
  }
  const fileChip = (f: SubmittalFile, canRemove: boolean) => (
    <span key={f.id} className="var-file">
      <button type="button" className="link-button small" onClick={() => openFile(f.path).catch((e) => setError((e as Error).message))}>
        📎 {f.name}
      </button>
      {canRemove && (
        <button type="button" className="small-button" title="Remove" onClick={() => confirm(`Remove ${f.name}?`) && run(() => removeFile(f))}>
          ✕
        </button>
      )}
    </span>
  )

  return (
    <div className="quote-editor rfi-page">
      <div className="sub-bar">
        <div>
          <Link to={`/jobs/${job.id}/submittals`} className="link-button small">
            ← All submittals
          </Link>
          <h2>
            Submittal {s.number} · {s.title}
          </h2>
          <span className={`q-status sub-${s.status}`}>{SUBMITTAL_STATUS[s.status]}</span> <span className="rfi-kind">{curName}</span>
          {isLate(s, today) && <span className="late"> ⚠ overdue</span>}
        </div>
        <div className="button-row">
          <button
            onClick={() => exportSubmittalsPdf({ ref: `${job.job_no} ${job.code}`, name: job.name }, [{ s, submittedBy: sb?.name ?? '', reviewers: outsideNames.join(', '), cc: '', manager: ctx.profileName(s.manager_id), revisions }], `Submittal ${s.number}`).catch((e) => setError((e as Error).message))}
          >
            PDF
          </button>
          {isDraft && (
            <>
              <button className="primary" disabled={busy} onClick={sendOut}>
                Send out for review
              </button>
              {revisions.length <= 1 && (
                <button disabled={busy} onClick={() => confirm(`Delete the draft Submittal ${s.number}?`) && run(async () => { await deleteSubmittal(s.id); navigate(`/jobs/${job.id}/submittals`) })}>
                  Delete draft
                </button>
              )}
            </>
          )}
          {s.status === 'out' && (
            <button className="primary" disabled={busy} onClick={() => setResponding(!responding)}>
              Record response
            </button>
          )}
          {(s.status === 'revise' || s.status === 'rejected') && (
            <button className="primary" disabled={busy} onClick={() => run(async () => void (await newRevision(s, 'resubmit')), 'Resubmission started: add the revised files, then send it out.')}>
              Resubmit (next revision)
            </button>
          )}
          {s.status === 'approved_noted' && (
            <button className="primary" disabled={busy} onClick={() => run(async () => void (await newRevision(s, 'construction')), 'Construction issue started: add the final drawings with the comments picked up, then send it out.')}>
              Issue for construction
            </button>
          )}
          {s.status !== 'void' && !isDraft && canManage && (
            <button disabled={busy} onClick={() => confirm('Void this submittal (raised in error)?') && run(async () => void (await updateSubmittal(s.id, { status: 'void' })), 'Voided.')}>
              Void
            </button>
          )}
          {s.status === 'void' && (
            <button disabled={busy} onClick={() => run(async () => void (await updateSubmittal(s.id, { status: 'draft' })), 'Reopened as a draft.')}>
              Reopen
            </button>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      {isFinal(s.status) && <p className="pqq-warning">Approved{s.status === 'approved_noted' ? ' as noted: read the notes below before ordering or fabricating' : ''}.</p>}
      {(s.status === 'revise' || s.status === 'rejected') && <p className="pqq-warning">{s.status === 'rejected' ? 'Rejected' : 'Revise and resubmit'}: read the response below, then start the next revision.</p>}

      {responding && (
        <section className="card">
          <h2>Record the reviewers' response ({curName})</h2>
          <div className="form-grid">
            {curDocs.length === 0 && (
              <label>
                Outcome
                <select value={resp.outcome} onChange={(e) => setResp({ ...resp, outcome: e.target.value as Outcome })}>
                  {OUTCOMES.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {curDocs.length > 0 && (
              <div className="span-2 rfi-field">
                <span className="label">Status of each document (the submittal takes the worst)</span>
                {curDocs.map((f) => (
                  <div key={f.id} className="doc-status">
                    <span>📎 {f.name}</span>
                    <select value={resp.perFile[f.id] ?? ''} onChange={(e) => setResp({ ...resp, perFile: { ...resp.perFile, [f.id]: e.target.value as Outcome } })} aria-label={`Status of ${f.name}`}>
                      <option value="">Choose…</option>
                      {OUTCOMES.map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
            <label>
              From
              <input value={resp.by} onChange={(e) => setResp({ ...resp, by: e.target.value })} list="resp-by" placeholder="Who responded" />
              <datalist id="resp-by">
                {outsideNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>
            <label>
              Date of response
              <input type="date" value={resp.on} onChange={(e) => setResp({ ...resp, on: e.target.value })} />
            </label>
            <div className="rfi-field">
              <span className="label">Their marked-up files</span>
              <label className="file-button">
                <input type="file" multiple onChange={(e) => (setRespFiles((l) => [...l, ...(e.target.files ?? [])]), (e.target.value = ''))} />
                <span className="button">+ Attach</span>
              </label>
              {respFiles.map((x, i) => (
                <span key={i} className="var-file">
                  {x.name}{' '}
                  <button type="button" className="small-button" onClick={() => setRespFiles(respFiles.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="span-2 rfi-field">
              <span className="label">Their comments</span>
              <RichTextEditor value={resp.notes} onChange={(h) => setResp({ ...resp, notes: h })} placeholder="Comments and conditions…" minHeight={90} />
            </div>
            <div className="form-actions span-2">
              <button className="primary" disabled={busy} onClick={saveResponse}>
                Save response
              </button>
              <button onClick={() => setResponding(false)}>Cancel</button>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="pane-head">
          <h2>Details</h2>
          {!edit && s.status !== 'void' && (
            <button className="small-button" onClick={startEdit}>
              Edit
            </button>
          )}
        </div>
        {!edit ? (
          <>
            <dl className="rfi-dl">
              <dt>Type</dt>
              <dd>{typeLabel(s.type)}</dd>
              <dt>Specification section</dt>
              <dd>{s.trade || '–'}</dd>
              <dt>Submitted by</dt>
              <dd>{sb ? `${sb.name}${sb.company && sb.company !== sb.name ? ` (${sb.company})` : ''}` : '–'}</dd>
              <dt>Reviewers</dt>
              <dd>{outsideNames.join(', ') || '–'}</dd>
              <dt>Cc</dt>
              <dd>{people.filter((p) => p.role === 'cc').map(ctx.nameOf).join(', ') || '–'}</dd>
              <dt>DBP manager</dt>
              <dd>{ctx.profileName(s.manager_id) || '–'}</dd>
              <dt>Return by</dt>
              <dd className={isLate(s, today) ? 'late' : ''}>{s.due_date ? ukDate(s.due_date) : '–'}</dd>
              {s.submitted_at && (
                <>
                  <dt>Out for review</dt>
                  <dd>
                    since {ukDate(s.submitted_at.slice(0, 10))} ({daysOut(s, today)} days{s.status === 'out' ? '' : ' to respond'})
                  </dd>
                </>
              )}
              <dt>Chased</dt>
              <dd>
                {chaseLabel(s.chase_days)}
                {s.last_chased_at ? `, last ${ukDate(s.last_chased_at.slice(0, 10))}` : ''}
                {!s.notify ? ' · emails off' : ''}
              </dd>
            </dl>
            {s.description && <div className="rte-view" dangerouslySetInnerHTML={{ __html: cleanHtml(s.description) }} />}
          </>
        ) : (
          <div className="form-grid">
            <label className="span-2">
              Title
              <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </label>
            <div className="span-2 rfi-field">
              <span className="label">Description</span>
              <RichTextEditor value={edit.description ?? ''} onChange={(h) => setEdit((c) => (c ? { ...c, description: h } : c))} minHeight={90} />
            </div>
            <label>
              Type
              <select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value as SubmittalType })}>
                {TYPES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Specification section (trade)
              <SuggestInput value={edit.trade ?? ''} onChange={(v) => setEdit({ ...edit, trade: v })} options={ctx.trades} onAdd={(v) => addTrade(v).then(() => ctx.setTrades((l) => [...l, v.trim()]), () => {})} />
            </label>
            <div className="rfi-field">
              <span className="label">Submitted by</span>
              <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={ctx.whos.filter((w) => w.external)} value={edit.submitter} onChange={(v) => setEdit({ ...edit, submitter: v.slice(-1) })} placeholder="Which subcontractor / supplier" />
            </div>
            <label>
              DBP manager
              <select value={edit.manager_id ?? ''} onChange={(e) => setEdit({ ...edit, manager_id: e.target.value || null })}>
                <option value="">Choose…</option>
                {ctx.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </label>
            <div className="span-2 rfi-field">
              <span className="label">Reviewers</span>
              <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={ctx.whos} value={edit.reviewers} onChange={(v) => setEdit({ ...edit, reviewers: v })} placeholder="Who reviews it" />
            </div>
            <div className="span-2 rfi-field">
              <span className="label">Cc</span>
              <PeoplePicker onNew={ctx.addPerson} companies={ctx.companies} whos={ctx.whos} value={edit.cc} onChange={(v) => setEdit({ ...edit, cc: v })} placeholder="Select Cc" />
            </div>
            <label>
              Return by *
              <input type="date" required value={edit.due_date ?? ''} onChange={(e) => setEdit({ ...edit, due_date: e.target.value || null })} />
            </label>
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
            <div className="form-actions span-2">
              <button className="primary" disabled={busy} onClick={saveEdit}>
                Save
              </button>
              <button onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      {!isDraft && s.status !== 'void' && (
        <ExternalAccess
          kind="submittal"
          people={people.filter((p) => p.directory_id).map((p) => ({ id: p.id, name: ctx.nameOf(p), role: p.role, email: ctx.dir.find((x) => x.id === p.directory_id)?.email ?? null }))}
        />
      )}

      <section className="card">
        <h2>Revisions</h2>
        <ul className="rfi-thread">
          {[...revisions].reverse().map((r) => {
            const mine = files.filter((f) => f.revision_id === r.id)
            const isCur = r.rev === s.current_rev
            return (
              <li key={r.id} className={r.outcome ? 'rev-' + r.outcome : ''}>
                <div className="rfi-thread-head">
                  <strong>{revName(r.rev, r.rev_label)}</strong>
                  <span className="rfi-kind">{r.submitted_on ? `Submitted ${ukDate(r.submitted_on)}` : 'Not yet submitted'}</span>
                  {r.due_date && <small>return by {ukDate(r.due_date)}</small>}
                  {r.outcome && <span className={`q-status sub-${r.outcome}`}>{OUTCOMES.find(([k]) => k === r.outcome)?.[1]}</span>}
                  {r.responded_on && (
                    <small>
                      {ukDate(r.responded_on)}
                      {r.responded_by ? ` · ${r.responded_by}` : ''}
                    </small>
                  )}
                </div>
                {r.response_notes && <div className="rte-view" dangerouslySetInnerHTML={{ __html: cleanHtml(r.response_notes) }} />}
                <div className="var-files">
                  {mine.filter((f) => f.kind === 'submission').map((f) => (
                    <span key={f.id} className="doc-chip">
                      {fileChip(f, isCur && (isDraft || s.status === 'out'))}
                      {f.outcome && <span className={`q-status sub-${f.outcome}`}>{(OUTCOMES.find(([k]) => k === f.outcome)?.[1] ?? '').split(':')[0]}</span>}
                    </span>
                  ))}
                  {mine.filter((f) => f.kind === 'response').map((f) => fileChip(f, false))}
                  {isCur && (isDraft || s.status === 'out') && (
                    <label className="file-button">
                      <input
                        type="file"
                        multiple
                        onChange={(e) => {
                          const list = [...(e.target.files ?? [])]
                          e.target.value = ''
                          if (list.length) run(async () => void (await Promise.all(list.map((f) => addFile(s.id, r.id, f, 'submission')))), 'Attached.')
                        }}
                      />
                      <span className="button small-button">+ Attach to {revName(r.rev, r.rev_label)}</span>
                    </label>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
