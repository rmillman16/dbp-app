import { Link } from 'react-router-dom'
import { ukDate } from '../lib/format'
import { linkFor, SNOOZE_DAYS, useNotifications } from '../lib/notifications'
import type { Notification } from '../lib/types'

// Some jobs will have hundreds of snags, so tasks of one kind on one job are collapsed into a dropdown once there are three or
// more ("12 snags to check · 2611 FISL"), each still opening its own snag. Everything else is listed one by one.
const COLLATE: Record<string, [string, string]> = {
  snag_check: ['snag to check', 'snags to check'],
}
const COLLATE_FROM = 3

type Entry = { one: Notification } | { kind: string; job: string; items: Notification[] }

function entriesOf(items: Notification[]): Entry[] {
  const out: Entry[] = []
  const groups = new Map<string, { kind: string; job: string; items: Notification[] }>()
  for (const n of items) {
    const key = `${n.kind}|${n.job_id ?? ''}`
    if (COLLATE[n.kind] && items.filter((x) => x.kind === n.kind && x.job_id === n.job_id).length >= COLLATE_FROM) {
      let g = groups.get(key)
      if (!g) {
        g = { kind: n.kind, job: (n.title.match(/^(.*?) Snag \d+/)?.[1] ?? '').trim(), items: [] }
        groups.set(key, g)
        out.push(g)
      }
      g.items.push(n)
    } else out.push({ one: n })
  }
  return out
}

export default function NotificationList({ items, onNavigate }: { items: Notification[]; onNavigate?: () => void }) {
  const { markDone, snooze } = useNotifications()
  const row = (n: Notification) => {
    const href = linkFor(n)
    return (
      <li key={n.id} className={`notif ${n.severity}`}>
        <div className="notif-main">
          {href ? (
            <Link to={href} onClick={onNavigate}>
              {n.title}
            </Link>
          ) : (
            <strong>{n.title}</strong>
          )}
          {n.detail && <div className="muted small">{n.detail}</div>}
          {n.due_date && (
            <div className="small">
              {n.severity === 'overdue' ? 'Overdue · ' : n.severity === 'due_soon' ? 'Due soon · ' : ''}
              {ukDate(n.due_date)}
            </div>
          )}
        </div>
        <div className="notif-actions">
          <button className="small-button" onClick={() => markDone(n.id)}>
            Done
          </button>
          <button className="small-button" onClick={() => snooze(n.id)} title={`Hide for ${SNOOZE_DAYS} days`}>
            Snooze
          </button>
        </div>
      </li>
    )
  }
  return (
    <ul className="notif-list">
      {entriesOf(items).map((e) =>
        'one' in e ? (
          row(e.one)
        ) : (
          <li key={e.kind + (e.items[0]?.job_id ?? '')} className="notif-group">
            <details>
              <summary>
                <strong>
                  {e.items.length} {COLLATE[e.kind][1]}
                </strong>
                {e.job ? <span className="muted"> · {e.job}</span> : null}
              </summary>
              <ul className="notif-list">{e.items.map(row)}</ul>
            </details>
          </li>
        ),
      )}
    </ul>
  )
}
