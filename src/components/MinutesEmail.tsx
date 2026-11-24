// Email the minutes out (24 Nov): a check of who it goes to before anything is sent. The minutes go as the PDF, from DBP's mailbox
// (the send-minutes Edge Function), with you as reply-to and copied in, and the job's project hub link at the foot of the email.
// Tick everyone, just some people, or a whole group (everyone at a company, all the subcontractors, all the suppliers...).
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildMinutesPdf, minutesFilename } from '../lib/exportMinutes'
import { formatDateNice, issueMinutes, revLetter, type Meeting } from '../lib/minutes'
import type { Company, CompanyType } from '../lib/types'

interface Recipient {
  key: string // the lower-case email address
  name: string
  email: string
  group: string // "Attendees" or the company's name
  sub: string // their role on the project
  type: CompanyType | 'attendee'
}

const TYPE_WORD: Record<string, string> = { subcontractor: 'subcontractors', supplier: 'suppliers', consultant: 'consultants', designer: 'designers', client: 'client team' }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function loadRecipients(m: Meeting): Promise<Recipient[]> {
  const out = new Map<string, Recipient>()
  for (const a of m.attendees) {
    const e = (a.email ?? '').trim()
    if (EMAIL.test(e) && !out.has(e.toLowerCase())) out.set(e.toLowerCase(), { key: e.toLowerCase(), name: a.name, email: e, group: 'Attendees', sub: a.company ?? (a.present ? 'At the meeting' : 'Referenced only'), type: 'attendee' })
  }
  const owner = m.jobId ? ['job_id', m.jobId] : m.enquiryId ? ['enquiry_id', m.enquiryId] : null
  if (owner) {
    const [dir, cos, cts] = await Promise.all([
      supabase.from('job_directory').select('id, company_id, contact_id, role').eq(owner[0], owner[1]),
      supabase.from('companies').select('id, name, type, email'),
      supabase.from('contacts').select('id, name, email, company_id'),
    ])
    const co = new Map(((cos.data ?? []) as Pick<Company, 'id' | 'name' | 'type' | 'email'>[]).map((c) => [c.id, c]))
    const ct = new Map(((cts.data ?? []) as { id: string; name: string; email: string | null; company_id: string }[]).map((c) => [c.id, c]))
    for (const d of (dir.data ?? []) as { company_id: string | null; contact_id: string | null; role: string }[]) {
      const c = d.contact_id ? ct.get(d.contact_id) : undefined
      const company = co.get(d.company_id ?? c?.company_id ?? '')
      const e = (c?.email || company?.email || '').trim()
      if (!EMAIL.test(e) || out.has(e.toLowerCase())) continue
      out.set(e.toLowerCase(), { key: e.toLowerCase(), name: c?.name ?? company?.name ?? e, email: e, group: company?.name ?? 'Others', sub: d.role, type: company?.type ?? 'other' })
    }
  }
  return [...out.values()]
}

async function toBase64(b: Blob) {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export default function MinutesEmail({ meeting, hubUrl, onClose, onDone, onIssued, beforeIssue }: { meeting: Meeting; hubUrl: string | null; onClose: () => void; onDone: (msg: string, danger?: boolean) => void; onIssued: (rev: number) => void; beforeIssue: () => Promise<void> }) {
  const [people, setPeople] = useState<Recipient[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // issuing records the revision, keeps a copy of exactly what went out and locks the minutes (script 085)
  const [issue, setIssue] = useState(true)
  const nextRev = (meeting.rev ?? 0) + 1
  const [subject, setSubject] = useState(`${meeting.project || 'Meeting'} – ${meeting.no ? `Meeting ${meeting.no} ` : ''}minutes of ${formatDateNice(meeting.date)}${(meeting.rev ?? 0) > 0 ? ` (Rev ${revLetter(nextRev)})` : ''}`)
  const [message, setMessage] = useState('Please find the minutes of our meeting attached.\n\nIf you have any comments or corrections, let me know. Otherwise they will be taken as agreed in 72 hours.')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    loadRecipients(meeting).then(
      (p) => {
        if (!live) return
        setPeople(p)
        setPicked(new Set(p.filter((x) => x.type === 'attendee').map((x) => x.key))) // the people at the meeting to start with
      },
      (e: Error) => live && (setError(e.message), setPeople([])),
    )
    return () => {
      live = false
    }
  }, [meeting])

  const groups = useMemo(() => {
    const g = new Map<string, Recipient[]>()
    for (const p of people ?? []) g.set(p.group, [...(g.get(p.group) ?? []), p])
    // attendees first, then the companies by name
    return [...g.entries()].sort(([a], [b]) => (a === 'Attendees' ? -1 : b === 'Attendees' ? 1 : a.localeCompare(b)))
  }, [people])
  const types = useMemo(() => [...new Set((people ?? []).map((p) => p.type).filter((t) => t !== 'attendee' && t !== 'other'))], [people])

  const set = (keys: string[], on: boolean) =>
    setPicked((s) => {
      const n = new Set(s)
      keys.forEach((k) => (on ? n.add(k) : n.delete(k)))
      return n
    })
  const toggle = (k: string) => set([k], !picked.has(k))
  const chosen = (people ?? []).filter((p) => picked.has(p.key))

  async function send() {
    if (!chosen.length && !issue) return setError('Tick at least one person.')
    if (!navigator.onLine) return setError('You are offline: the minutes can only be emailed or issued with a connection.')
    setSending(true)
    setError(null)
    try {
      // the PDF is of the revision being issued (it carries "Rev A" and the meeting number)
      const out: Meeting = issue ? { ...meeting, rev: nextRev, locked: true } : meeting
      if (chosen.length) {
        const pdf = await buildMinutesPdf(out, hubUrl)
        const r = await supabase.functions.invoke('send-minutes', {
          body: { to: chosen.map((p) => p.email), subject: subject.trim(), message, filename: minutesFilename(out, 'pdf'), pdf: await toBase64(pdf), job_id: meeting.jobId },
        })
        if (r.error) throw new Error(r.error.message)
        if (!r.data?.ok) throw new Error(r.data?.detail ?? 'The email was not sent.')
      }
      if (issue) {
        await beforeIssue() // every change so far is saved first, so the issued copy and the outside people's actions match
        const rev = await issueMinutes(meeting, chosen.map((p) => ({ name: p.name, email: p.email })))
        onIssued(rev)
        onDone(chosen.length ? `Issued as Rev ${revLetter(rev)} and emailed to ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}.` : `Issued as Rev ${revLetter(rev)} (not emailed).`)
      } else onDone(`Minutes emailed to ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSending(false)
    }
  }

  return (
    <div className="mm-back" onMouseDown={(e) => e.target === e.currentTarget && !sending && onClose()}>
      <div className="mm-panel" role="dialog" aria-label="Email the minutes">
        <h2>{issue ? `Issue these minutes as Rev ${revLetter(nextRev)}` : 'Email these minutes'}</h2>
        <p className="mm-note">
          Check who this goes to. It is sent from the DBP mailbox as a PDF, with you copied in and replies coming to you{hubUrl ? ', and the project hub link at the foot' : ''}.
          {!hubUrl && ' (This job has no project hub link yet: add one in Edit job.)'}
        </p>

        {people === null && <p className="mm-note">Loading the people on this project…</p>}
        {people && (
          <>
            <div className="mm-quick">
              <button type="button" onClick={() => setPicked(new Set(people.map((p) => p.key)))}>Everyone ({people.length})</button>
              <button type="button" onClick={() => setPicked(new Set(people.filter((p) => p.type === 'attendee').map((p) => p.key)))}>Attendees</button>
              {types.map((t) => (
                <button key={t} type="button" onClick={() => set(people.filter((p) => p.type === t).map((p) => p.key), true)}>
                  + All {TYPE_WORD[t] ?? t}
                </button>
              ))}
              <button type="button" onClick={() => setPicked(new Set())}>None</button>
            </div>
            <div className="mm-list">
              {!groups.length && <p className="mm-note">Nobody on this project has an email address yet. Add attendees with their email, or people to the project directory.</p>}
              {groups.map(([name, list]) => {
                const all = list.every((p) => picked.has(p.key))
                return (
                  <div key={name} className="mm-group">
                    <label className="mm-group-head">
                      <input type="checkbox" checked={all} onChange={() => set(list.map((p) => p.key), !all)} />
                      <b>{name}</b>
                      <span className="mm-count">{list.filter((p) => picked.has(p.key)).length} of {list.length}</span>
                    </label>
                    {list.map((p) => (
                      <label key={p.key} className="mm-person">
                        <input type="checkbox" checked={picked.has(p.key)} onChange={() => toggle(p.key)} />
                        <span>
                          {p.name} <span className="mm-sub">{p.sub}</span>
                        </span>
                        <span className="mm-mail">{p.email}</span>
                      </label>
                    ))}
                  </div>
                )
              })}
            </div>
          </>
        )}

        <label className="mm-field">
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="mm-field">
          Message
          <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>

        <label className="mm-issue">
          <input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} />
          <span>
            <b>Issue as Rev {revLetter(nextRev)}</b>: keep a copy of exactly what is sent, record who it went to, lock the minutes, and email outside people their own actions with a link to tick them off. Untick to email a draft without issuing.
          </span>
        </label>

        {error && <p className="mm-error">{error}</p>}
        <div className="mm-actions">
          <span className="mm-note">{chosen.length ? `Going to ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}` : 'Nobody ticked'}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={send} disabled={sending || (!chosen.length && !issue)}>
            {sending ? 'Sending…' : issue ? (chosen.length ? `Issue and send to ${chosen.length}` : 'Issue without emailing') : `Send to ${chosen.length || 'nobody'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
