// Draft the minutes from rough notes or a pasted Teams / Zoom transcript (24 Nov, the minutes-draft Edge Function). It only drafts:
// nothing goes into the minutes until the points are ticked here and added, and everything can then be edited as normal.
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { fileToText, parseAsWritten } from '../lib/minutesImport'
import { formatDateShort, plainMentions, type Meeting } from '../lib/minutes'

export interface DraftPoint {
  type: 'heading' | 'note'
  text: string
  action: boolean
  owner: string | null // an attendee's initials
  due: string | null
  urgent: boolean
}

export default function MinutesDraft({ meeting, headings, onAdd, onClose }: { meeting: Meeting; headings: string[]; onAdd: (points: DraftPoint[]) => void; onClose: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftPoint[] | null>(null)
  const [off, setOff] = useState<Set<number>>(new Set())

  // minutes somebody else took: read the file (Word, PDF or text) into the box
  async function pickFile(f: File | undefined) {
    if (!f) return
    setError(null)
    setBusy(true)
    try {
      const txt = (await fileToText(f)).trim()
      if (!txt) throw new Error('No text could be found in that file (a scanned PDF has none).')
      setText(txt)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }
  // use their minutes as written: split into headings, points and actions, no rewriting
  function asWritten() {
    setError(null)
    const pts = parseAsWritten(text, meeting.attendees)
    if (!pts.length) return setError('Nothing to import.')
    setDraft(pts)
    setOff(new Set())
  }
  async function write() {
    setError(null)
    if (!navigator.onLine) return setError('You are offline: the draft needs a connection.')
    setBusy(true)
    try {
      const r = await supabase.functions.invoke('minutes-draft', {
        body: {
          text,
          project: meeting.project,
          date: meeting.date,
          attendees: meeting.attendees.map((a) => ({ initials: a.initials, name: a.name, company: a.company })),
          headings,
        },
      })
      // a non-200 answer carries the function's own message in its body
      if (r.error) {
        const body = await (r.error as { context?: Response }).context?.json?.().catch(() => null)
        throw new Error(body?.error ?? r.error.message)
      }
      if (!r.data?.ok) throw new Error(r.data?.error ?? 'The draft could not be written.')
      setDraft(r.data.points as DraftPoint[])
      setOff(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  const chosen = (draft ?? []).filter((_, i) => !off.has(i))
  const who = (initials: string | null) => meeting.attendees.find((a) => a.initials === initials)?.name

  return (
    <div className="mm-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="mm-panel mm-wide" role="dialog" aria-label="Draft the minutes">
        <h2>Draft the minutes from notes or a transcript</h2>
        {!draft ? (
          <>
            <p className="mm-note">
              Paste your rough notes, or the transcript from Teams or Zoom. The app drafts the headings, the points and the actions with owners and dates. Nothing is added until you have checked the draft. Add the attendees first, so actions can be given to the right people.
            </p>
            <div className="mm-note">
              <b>Client took the minutes?</b> Choose their file (Word, PDF or text) or paste their minutes below, then <b>Import as written</b> to keep their wording exactly and just split it into headings, points and actions.{' '}
              <input type="file" accept=".docx,.pdf,.txt,.md,text/plain" disabled={busy} onChange={(e) => (pickFile(e.target.files?.[0]), (e.target.value = ''))} />
            </div>
            <textarea className="mm-paste" rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the notes or transcript here…" autoFocus />
            {meeting.attendees.length === 0 && <p className="mm-error">No attendees yet: actions will have no owner. Add them to the minutes first.</p>}
            {error && <p className="mm-error">{error}</p>}
            <div className="mm-actions">
              <span className="mm-note">{text.trim() ? `${text.trim().split(/\s+/).length} words` : ''}</span>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn btn-ghost" onClick={asWritten} disabled={busy || text.trim().length < 5} title="Keep their wording; only split it into headings, points and actions">
                Import as written
              </button>
              <button type="button" className="btn btn-primary" onClick={write} disabled={busy || text.trim().length < 20}>
                {busy ? 'Drafting… (up to a minute)' : 'Draft the minutes'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mm-note">Untick anything you do not want. Everything can be edited in the minutes afterwards. Check the owners and dates in particular.</p>
            <div className="mm-list mm-draft-list">
              {draft.map((p, i) => (
                <label key={i} className={'mm-draft-row' + (p.type === 'heading' ? ' is-heading' : '') + (off.has(i) ? ' is-off' : '')}>
                  <input
                    type="checkbox"
                    checked={!off.has(i)}
                    onChange={() =>
                      setOff((s) => {
                        const n = new Set(s)
                        if (n.has(i)) n.delete(i)
                        else n.add(i)
                        return n
                      })
                    }
                  />
                  <span>
                    {p.type === 'heading' ? <b>{p.text}</b> : plainMentions(p.text, meeting.attendees)}
                    {p.type === 'note' && p.action && (
                      <span className="mm-draft-meta">
                        {' '}
                        · Action{who(p.owner) ? ` for ${who(p.owner)}` : ' (no owner)'}
                        {p.due ? ` · due ${formatDateShort(p.due)}` : ''}
                        {p.urgent ? ' · urgent' : ''}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            <div className="mm-actions">
              <span className="mm-note">{chosen.length} of {draft.length} ticked</span>
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
                Back
              </button>
              <button type="button" className="btn btn-primary" disabled={!chosen.length} onClick={() => (onAdd(chosen), onClose())}>
                Add {chosen.length} to the minutes
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
