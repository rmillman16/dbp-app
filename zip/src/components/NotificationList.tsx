import { Link } from 'react-router-dom'
import { ukDate } from '../lib/format'
import { linkFor, SNOOZE_DAYS, useNotifications } from '../lib/notifications'
import type { Notification } from '../lib/types'

export default function NotificationList({ items, onNavigate }: { items: Notification[]; onNavigate?: () => void }) {
  const { markDone, snooze } = useNotifications()
  return (
    <ul className="notif-list">
      {items.map((n) => {
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
      })}
    </ul>
  )
}
