import { useEffect, useRef, useState } from 'react'
import { useNotifications } from '../lib/notifications'
import NotificationList from './NotificationList'

export function BellIcon({ count, worst }: { count: number; worst: 'overdue' | 'due_soon' | null }) {
  return (
    <span className={`bell ${worst === 'overdue' ? 'overdue' : worst === 'due_soon' ? 'due-soon' : ''}`} aria-hidden>
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path
          fill="currentColor"
          d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
        />
      </svg>
      {count > 0 && <span className="count">{count}</span>}
    </span>
  )
}

// Bell in the top bar: count, red / amber, and a drop-down of what needs attention.
export default function Bell() {
  const { attention, worst } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="bell-wrap" ref={ref}>
      <button className="icon-button" onClick={() => setOpen(!open)} aria-label={`Notifications: ${attention.length} need attention`}>
        <BellIcon count={attention.length} worst={worst} />
      </button>
      {open && (
        <div className="bell-drop">
          <div className="bell-drop-head">Needs attention</div>
          {attention.length === 0 ? <p className="muted small">Nothing needs attention.</p> : <NotificationList items={attention} onNavigate={() => setOpen(false)} />}
        </div>
      )}
    </div>
  )
}
