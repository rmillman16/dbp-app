// "3 waiting to send": work saved on this device with no signal (lib/outbox.ts). Click it to see what is waiting, send it now, or
// throw away something that can't be sent (it says why).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get, keys } from 'idb-keyval'
import { discard, flush, useOutbox } from '../lib/outbox'
import { ukDate } from '../lib/format'

// Minutes keep their own copy on the device (minutes.ts saveDraft) and send it when the Minutes page is open with a connection. A copy
// older than a minute has not reached the database: listed here so it isn't forgotten.
interface Unsent {
  id: string
  project: string
  to: string
}
function useUnsentMinutes() {
  const [list, setList] = useState<Unsent[]>([])
  useEffect(() => {
    let live = true
    const read = async () => {
      const out: Unsent[] = []
      for (const k of await keys().catch(() => [])) {
        if (typeof k !== 'string' || !k.startsWith('minutes-draft:')) continue
        const m = await get<{ id: string; project?: string; jobId: string | null; enquiryId: string | null; updatedAt: number }>(k).catch(() => undefined)
        if (!m || Date.now() - m.updatedAt < 60_000) continue
        out.push({ id: m.id, project: m.project || 'Meeting minutes', to: m.jobId ? `/jobs/${m.jobId}/minutes/${m.id}` : m.enquiryId ? `/estimating/e/${m.enquiryId}/minutes/${m.id}` : '/' })
      }
      if (live) setList(out)
    }
    void read()
    const t = window.setInterval(read, 15_000)
    return () => {
      live = false
      window.clearInterval(t)
    }
  }, [])
  return list
}

export default function OutboxPill() {
  const items = useOutbox()
  const minutes = useUnsentMinutes()
  const [open, setOpen] = useState(false)
  const total = items.length + minutes.length
  if (!total) return null
  const failed = items.filter((i) => i.error)
  return (
    <span className="outbox">
      <button type="button" className={`offline-pill outbox-pill ${failed.length ? 'bad' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {failed.length ? '⚠ ' : '⏳ '}
        {total} waiting to send
      </button>
      {open && (
        <div className="outbox-panel card" role="dialog" aria-label="Waiting to send">
          <p className="muted small">
            Saved on this device. {navigator.onLine ? 'Sending now…' : 'It is sent automatically when you have signal.'} Keep the app installed and signed in on this device until it has gone.
          </p>
          <ul>
            {minutes.map((m) => (
              <li key={m.id}>
                <span>
                  Minutes: {m.project} <span className="muted small">· saved on this device</span>{' '}
                  <Link to={m.to} onClick={() => setOpen(false)}>
                    Open to send
                  </Link>
                </span>
              </li>
            ))}
            {items.map((i) => (
              <li key={i.qid}>
                <span>
                  {i.label} <span className="muted small">· {ukDate(i.at.slice(0, 10))} {i.at.slice(11, 16)}</span>
                </span>
                {i.error && (
                  <span className="error small">
                    Couldn’t be sent: {i.error}{' '}
                    <button type="button" className="link-button small" onClick={() => confirm('Throw this away? It has not reached the database and can’t be got back.') && discard(i.qid)}>
                      Discard
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="snag-save">
            <button type="button" disabled={!navigator.onLine} onClick={() => void flush(true)}>
              Send now
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
