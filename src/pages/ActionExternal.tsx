// An action from the meeting minutes, as the person who owns it sees it on the outside pages (24 Nov, script 085): no login. They can
// tick it done (with a note if they like), add a note, or re-open one they ticked by mistake. Ticking it done updates the minutes
// straight away and tells the person who ran the meeting. Everything goes through the "external" Edge Function.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import HubBlock from '../components/HubBlock'
import { ext, type ExtListItem } from '../lib/external'

export type ActAuth = { token: string } | { session: string } | { atoken: string }
interface Update {
  id: string
  date: string
  text: string
}
type ActionItem = ExtListItem & { updates: Update[]; can_act: boolean; can_undo: boolean; done_by: string | null; urgent: boolean }
const ukDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

export default function ActionView({ auth, id, back }: { auth: ActAuth; id: string; back: { to: string; label: string } }) {
  const [item, setItem] = useState<ActionItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const load = () => ext<{ item: ActionItem }>({ action: 'action_view', ...auth, id }).then((r) => setItem(r.item), (e: Error) => setError(e.message))
  useEffect(() => {
    load()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: 'action_done' | 'action_note' | 'action_undo', message: string) {
    setBusy(true)
    setError(null)
    try {
      await ext({ action, ...auth, id, note })
      setNote('')
      setSaved(message)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  if (!item)
    return error ? (
      <div className="card">
        <h1>We couldn't open that</h1>
        <p>{error}</p>
        <p>
          <Link to={back.to}>{back.label}</Link>
        </p>
      </div>
    ) : (
      <p className="muted">Loading…</p>
    )

  const done = item.status === 'closed'
  return (
    <>
      <p>
        <Link to={back.to}>{back.label}</Link>
      </p>
      <div className="card">
        <p className="muted small">{item.project}</p>
        <h1>Action: {item.title}</h1>
        {item.ref && (
          <p className="muted small">
            Reference: <strong>{item.ref}</strong>
          </p>
        )}
        <p>
          <span className={`q-status ext-${done ? 'done' : 'with_you'}`}>{done ? `Done${item.done_by ? ` by ${item.done_by}` : ''}` : 'Waiting for you'}</span>
          {item.due_date && (
            <span>
              {' '}
              · Due <strong>{ukDate(item.due_date)}</strong>
            </span>
          )}
          {item.urgent && !done && <span> · Urgent</span>}
        </p>
        {item.snippet && <p className="muted small">{item.snippet}</p>}
        {item.updates.length > 0 && (
          <ul className="rfi-thread">
            {item.updates.map((u) => (
              <li key={u.id}>
                <div className="rfi-thread-head">
                  <small>{ukDate(u.date)}</small>
                </div>
                <p>{u.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {saved && (
        <div className="card">
          <p className="saved">{saved}</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {item.can_act && (
        <div className="card ext-form">
          <h2>When it is done</h2>
          <label>
            Note (optional)
            <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything we should know: what was done, a date, or why it is taking longer…" />
          </label>
          <p>
            <button className="primary" disabled={busy} onClick={() => act('action_done', 'Thank you: it is ticked off, and the minutes have been updated.')}>
              {busy ? 'Saving…' : 'Mark as done'}
            </button>{' '}
            <button type="button" disabled={busy || !note.trim()} onClick={() => act('action_note', 'Your note has been added to the minutes.')}>
              Add the note, but not done yet
            </button>
          </p>
        </div>
      )}
      {done && item.can_undo && (
        <p>
          <button type="button" disabled={busy} onClick={() => act('action_undo', 'It has been re-opened.')}>
            I ticked this by mistake: re-open it
          </button>
        </p>
      )}
      {item.hub_url && <HubBlock url={item.hub_url} project={item.project} />}
    </>
  )
}
