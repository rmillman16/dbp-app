import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, todayIso, ukDate, addDaysIso } from '../lib/format'
import { cached, must, saveError } from '../lib/offline'
import { claimLetter, eventRef, loadEot, noticeLetter, programme, prolongation } from '../lib/eot'
import { loadCompanies } from '../lib/subcontracts'
import { latestRevisions, loadApplications } from '../lib/applications'
import { DELAY_TYPE_LABELS, EOT_STATUS_LABELS, type Company, type DelayEvent, type DelayType, type EotClaim, type EotStatus, type TextTemplate } from '../lib/types'
import { useJob } from './JobLayout'

const num = (v: string) => (v.trim() === '' ? null : Number(v))

export default function EotTab() {
  const { job } = useJob()
  const [events, setEvents] = useState<DelayEvent[] | null>(null)
  const [claims, setClaims] = useState<EotClaim[]>([])
  const [links, setLinks] = useState<{ claim_id: string; event_id: string }[]>([])
  const [client, setClient] = useState<Company | null>(null)
  const [wording, setWording] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [openClaim, setOpenClaim] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const reload = () =>
    loadEot(job.id).then(
      (d) => {
        setEvents(d.events)
        setClaims(d.claims)
        setLinks(d.links)
      },
      (e: Error) => setError(e.message),
    )

  useEffect(() => {
    reload()
    loadCompanies().then((cs) => setClient(cs.find((c) => c.id === job.client_company_id) ?? null), () => {})
    cached('text-templates', () => must<TextTemplate[]>(supabase.from('text_templates').select('*'))).then(
      (ts) => setWording(Object.fromEntries(ts.map((t) => [t.key, t.body]))),
      () => {},
    )
  }, [job]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !events) return <p className="error">{error}</p>
  if (!events) return <p className="muted">Loading…</p>

  const prog = programme(job, events)
  const claimed = new Set(links.map((l) => l.event_id))

  async function saveEvent(e: DelayEvent) {
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    const { id, ...rest } = e
    const r = id.startsWith('new') ? await supabase.from('delay_events').insert({ ...rest, job_id: job.id }) : await supabase.from('delay_events').update(rest).eq('id', id)
    if (r.error) return setError(saveError(r.error))
    setMsg('Saved.')
    setOpen(null)
    reload()
  }

  async function deleteEvent(e: DelayEvent) {
    if (!confirm(`Delete ${eventRef(e)} for good?`)) return
    const r = await supabase.from('delay_events').delete().eq('id', e.id)
    if (r.error) return setError(saveError(r.error))
    setOpen(null)
    reload()
  }

  function addEvent() {
    const no = Math.max(0, ...events!.map((e) => e.event_no ?? 0)) + 1
    const today = todayIso()
    const e: DelayEvent = {
      id: `new${no}`,
      job_id: job.id,
      event_no: no,
      type: 'late_information',
      variation_id: null,
      description: '',
      details: null,
      event_date: today,
      days_claimed: null,
      days_granted: null,
      notice_due: job.eot_notice_days != null ? addDaysIso(today, job.eot_notice_days) : null,
      notice_sent: null,
      status: 'draft',
    }
    setEvents([...events!, e])
    setOpen(e.id)
  }

  async function newClaim() {
    setError(null)
    const r = await supabase
      .from('eot_claims')
      .insert({ job_id: job.id, claim_no: Math.max(0, ...claims.map((c) => c.claim_no)) + 1, weekly_prelims: job.weekly_prelims, status: 'draft' })
      .select('id')
      .single()
    if (r.error) return setError(saveError(r.error))
    await reload()
    setOpenClaim(r.data.id)
  }

  return (
    <>
      <section className="card">
        <h2>Programme</h2>
        <div className="stat-row">
          <div className="stat">
            <span className="muted small">Contract completion</span>
            <strong>{ukDate(prog.contractPc) || '–'}</strong>
          </div>
          <div className="stat">
            <span className="muted small">Days granted</span>
            <strong>{prog.granted}</strong>
          </div>
          <div className="stat">
            <span className="muted small">Revised completion</span>
            <strong>{ukDate(prog.revisedPc) || '–'}</strong>
          </div>
          <div className="stat">
            <span className="muted small">Weeks delay (granted)</span>
            <strong>{prog.weeksDelay}</strong>
          </div>
          <div className="stat">
            <span className="muted small">Days claimed / notified</span>
            <strong>{prog.claimed}</strong>
          </div>
        </div>
        <p className="muted small">
          Notice of delay due {job.eot_notice_days != null ? `${job.eot_notice_days} days after an event` : '(no notice period set)'} · weekly prelims for prolongation{' '}
          {job.weekly_prelims != null ? money(job.weekly_prelims) : '(not set)'} · <Link to={`/jobs/${job.id}/edit`}>set these in the job details</Link>. Wording follows the
          job's contract ({job.contract_form || 'not set'}); check it before sending. Letter wording: Contracts › EOT.
        </p>
      </section>

      <section className="card">
        <div className="pane-head">
          <h2>Delay events</h2>
          <button className="primary" onClick={addEvent}>
            + Delay event
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {msg && <p className="saved">{msg}</p>}
        <p className="muted small">VOs with programme days appear here automatically. Add late information and client / third-party delays yourself.</p>
        {events.length === 0 && <p className="muted">No delay events yet.</p>}
        <ul className="record-list">
          {events.map((e) => (
            <li key={e.id} className={`record ${open === e.id ? 'open' : ''}`}>
              <button className="record-head" onClick={() => setOpen(open === e.id ? null : e.id)}>
                <span className="record-title">
                  {eventRef(e)} · {e.description || 'New delay event'}
                </span>
                <span className="muted small">
                  {DELAY_TYPE_LABELS[e.type]} · {ukDate(e.event_date)} · {e.days_claimed ?? '?'} days claimed
                  {e.days_granted != null && ` · ${e.days_granted} granted`} · <span className={`eot-${e.status}`}>{EOT_STATUS_LABELS[e.status]}</span>
                  {e.notice_due && !e.notice_sent && <span className={e.notice_due < todayIso() ? 'late' : ''}> · notice due {ukDate(e.notice_due)}</span>}
                  {e.notice_sent && ` · notice sent ${ukDate(e.notice_sent)}`}
                  {claimed.has(e.id) && ' · in a claim'}
                </span>
              </button>
              {open === e.id && (
                <EventEditor
                  e={e}
                  onSave={saveEvent}
                  onDelete={e.id.startsWith('new') || e.variation_id ? null : () => deleteEvent(e)}
                  onCancel={() => (e.id.startsWith('new') ? setEvents(events.filter((x) => x.id !== e.id)) : null, setOpen(null))}
                  onLetter={() => noticeLetter(job, client, e, wording.eot_notice_letter ?? null).catch((x: Error) => setError(x.message))}
                  noticeDays={job.eot_notice_days}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="pane-head">
          <h2>EOT claims</h2>
          <button onClick={newClaim}>+ New claim</button>
        </div>
        {claims.length === 0 && <p className="muted small">No claims yet. A claim gathers delay events into one application for an extension of time.</p>}
        <ul className="record-list">
          {claims.map((c) => {
            const mine = events.filter((e) => links.some((l) => l.claim_id === c.id && l.event_id === e.id))
            const granted = mine.reduce((s, e) => s + Number(e.days_granted ?? 0), 0)
            return (
              <li key={c.id} className={`record ${openClaim === c.id ? 'open' : ''}`}>
                <button className="record-head" onClick={() => setOpenClaim(openClaim === c.id ? null : c.id)}>
                  <span className="record-title">EOT Claim {c.claim_no}</span>
                  <span className="muted small">
                    {mine.length} events · {mine.reduce((s, e) => s + Number(e.days_claimed ?? 0), 0)} days claimed · {granted} granted · {EOT_STATUS_LABELS[c.status]}
                    {c.submitted_date && ` · submitted ${ukDate(c.submitted_date)}`}
                  </span>
                </button>
                {openClaim === c.id && (
                  <ClaimEditor
                    claim={c}
                    events={events}
                    inClaim={mine}
                    takenElsewhere={new Set(links.filter((l) => l.claim_id !== c.id).map((l) => l.event_id))}
                    onSaved={() => (setMsg('Claim saved.'), reload())}
                    onLetter={() => claimLetter(job, client, c, mine, events, wording.eot_claim_letter ?? null).catch((x: Error) => setError(x.message))}
                    setError={setError}
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

function EventEditor({
  e: initial,
  onSave,
  onDelete,
  onCancel,
  onLetter,
  noticeDays,
}: {
  e: DelayEvent
  onSave: (e: DelayEvent) => void
  onDelete: (() => void) | null
  onCancel: () => void
  onLetter: () => void
  noticeDays: number | null
}) {
  const [e, setE] = useState(initial)
  const set = <K extends keyof DelayEvent>(k: K, v: DelayEvent[K]) => setE({ ...e, [k]: v })
  const fromVo = !!e.variation_id
  return (
    <div className="record-editor">
      <div className="form-grid three">
        <label className="span-2">
          Event
          <input value={e.description} disabled={fromVo} onChange={(x) => set('description', x.target.value)} placeholder="e.g. Late issue of joinery drawings (RFI 042)" />
          {fromVo && <span className="hint">From the VO; change the VO to change this.</span>}
        </label>
        <label>
          Type
          <select value={e.type} disabled={fromVo} onChange={(x) => set('type', x.target.value as DelayType)}>
            {(Object.keys(DELAY_TYPE_LABELS) as DelayType[]).map((t) => (
              <option key={t} value={t}>
                {DELAY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="span-3">
          Details (in the letters)
          <textarea rows={3} value={e.details ?? ''} onChange={(x) => set('details', x.target.value || null)} />
        </label>
        <label>
          Event date
          <input
            type="date"
            value={e.event_date ?? ''}
            onChange={(x) => {
              const d = x.target.value || null
              setE({ ...e, event_date: d, notice_due: d && noticeDays != null ? addDaysIso(d, noticeDays) : e.notice_due })
            }}
          />
        </label>
        <label>
          Days claimed
          <input type="number" step="0.5" value={e.days_claimed ?? ''} disabled={fromVo} onChange={(x) => set('days_claimed', num(x.target.value))} />
        </label>
        <label>
          Days granted
          <input type="number" step="0.5" value={e.days_granted ?? ''} onChange={(x) => set('days_granted', num(x.target.value))} />
        </label>
        <label>
          Notice due
          <input type="date" value={e.notice_due ?? ''} onChange={(x) => set('notice_due', x.target.value || null)} />
        </label>
        <label>
          Notice sent
          <input type="date" value={e.notice_sent ?? ''} onChange={(x) => set('notice_sent', x.target.value || null)} />
        </label>
        <label>
          Status
          <select value={e.status} onChange={(x) => set('status', x.target.value as EotStatus)}>
            {(Object.keys(EOT_STATUS_LABELS) as EotStatus[]).map((s) => (
              <option key={s} value={s}>
                {EOT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button className="primary" onClick={() => (e.description.trim() ? onSave(e) : alert('Describe the event first.'))}>
          Save
        </button>
        <button onClick={onLetter} disabled={e.id.startsWith('new')} title="Notice of delay on the letterhead (save first)">
          Notice letter (Word)
        </button>
        {!e.notice_sent && !e.id.startsWith('new') && (
          <button onClick={() => onSave({ ...e, notice_sent: todayIso(), status: e.status === 'draft' ? 'notified' : e.status })}>Mark notice sent today</button>
        )}
        <button onClick={onCancel}>Cancel</button>
        {onDelete && (
          <button className="danger" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

function ClaimEditor({
  claim,
  events,
  inClaim,
  takenElsewhere,
  onSaved,
  onLetter,
  setError,
}: {
  claim: EotClaim
  events: DelayEvent[]
  inClaim: DelayEvent[]
  takenElsewhere: Set<string>
  onSaved: () => void
  onLetter: () => void
  setError: (s: string | null) => void
}) {
  const { job } = useJob()
  const [c, setC] = useState(claim)
  const [picked, setPicked] = useState<Set<string>>(new Set(inClaim.map((e) => e.id)))
  const [busy, setBusy] = useState(false)
  const chosen = events.filter((e) => picked.has(e.id))
  const days = chosen.reduce((s, e) => s + Number(e.days_claimed ?? 0), 0)
  const granted = chosen.reduce((s, e) => s + Number(e.days_granted ?? 0), 0)
  const prolong = prolongation(granted, c.weekly_prelims)

  async function save() {
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    const { id, ...rest } = c
    const steps = [
      () => supabase.from('eot_claims').update({ ...rest, days_claimed: days, days_granted: granted }).eq('id', id),
      () => supabase.from('eot_claim_events').delete().eq('claim_id', id),
      () => (picked.size ? supabase.from('eot_claim_events').insert([...picked].map((event_id) => ({ claim_id: id, event_id }))) : null),
      // events in a submitted claim show as claimed
      () => (c.status === 'claimed' && picked.size ? supabase.from('delay_events').update({ status: 'claimed' }).in('id', [...picked]).in('status', ['draft', 'notified']) : null),
    ]
    for (const s of steps) {
      const r = await s()
      if (r && r.error) {
        setBusy(false)
        return setError(saveError(r.error))
      }
    }
    setBusy(false)
    onSaved()
  }

  // agreed prolongation goes into the latest draft client application's loss and expense
  async function toApplication() {
    setError(null)
    const apps = await loadApplications(job.id)
    const latest = latestRevisions(apps).pop()
    if (!latest || latest.status !== 'draft') return setError('No draft client application to add it to: start the next application first (Applications tab).')
    if (!confirm(`Add ${money(prolong)} prolongation to Application ${latest.app_no} R${latest.revision}'s loss and expense?`)) return
    const r = await supabase.from('applications').update({ loss_and_expense: Number(latest.loss_and_expense ?? 0) + prolong }).eq('id', latest.id)
    if (r.error) return setError(saveError(r.error))
    alert(`Added to Application ${latest.app_no} R${latest.revision}.`)
  }

  return (
    <div className="record-editor">
      <h4 className="sub-head">Delay events in this claim</h4>
      <div className="claim-events">
        {events
          .filter((e) => !takenElsewhere.has(e.id) && e.status !== 'rejected')
          .map((e) => (
            <label key={e.id} className="check">
              <span>
                <input
                  type="checkbox"
                  checked={picked.has(e.id)}
                  onChange={(x) => {
                    const p = new Set(picked)
                    if (x.target.checked) p.add(e.id)
                    else p.delete(e.id)
                    setPicked(p)
                  }}
                />{' '}
                {eventRef(e)} {e.description} ({e.days_claimed ?? '?'} days{e.days_granted != null ? `, ${e.days_granted} granted` : ''})
              </span>
            </label>
          ))}
      </div>
      <div className="form-grid three">
        <label>
          Submitted
          <input type="date" value={c.submitted_date ?? ''} onChange={(x) => setC({ ...c, submitted_date: x.target.value || null })} />
        </label>
        <label>
          Status
          <select value={c.status} onChange={(x) => setC({ ...c, status: x.target.value as EotStatus })}>
            {(Object.keys(EOT_STATUS_LABELS) as EotStatus[]).map((s) => (
              <option key={s} value={s}>
                {EOT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Weekly prelims £
          <input type="number" step="any" value={c.weekly_prelims ?? ''} onChange={(x) => setC({ ...c, weekly_prelims: num(x.target.value) })} />
        </label>
        <label className="span-3">
          Notes
          <textarea rows={2} value={c.notes ?? ''} onChange={(x) => setC({ ...c, notes: x.target.value || null })} />
        </label>
      </div>
      <p className="small">
        <strong>{days}</strong> days claimed · <strong>{granted}</strong> granted (enter days granted on each event) · prolongation{' '}
        <strong>{money(prolong)}</strong> ({Math.round((granted / 7) * 10) / 10} weeks × {money(c.weekly_prelims)})
      </p>
      <div className="form-actions">
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save claim'}
        </button>
        <button onClick={onLetter} title="Claim letter on the letterhead, with the table of events (save first)">
          Claim letter (Word)
        </button>
        {prolong > 0 && <button onClick={toApplication}>Add prolongation to application</button>}
      </div>
    </div>
  )
}
