import { useState } from 'react'
import { useNotifications } from '../lib/notifications'
import NotificationList from '../components/NotificationList'
import JobsTable from '../components/JobsTable'
import { BellIcon } from '../components/Bell'
import { useAccess } from '../lib/access'

// Home = what needs me today, then the jobs.
export default function Home() {
  const { attention, upcoming, worst, error } = useNotifications()
  const [showUpcoming, setShowUpcoming] = useState(false)
  const { can } = useAccess()

  return (
    <>
      <section className={`card attention ${worst ?? ''}`}>
        <div className="pane-head">
          <h2>
            <BellIcon count={attention.length} worst={worst} />
            Needs attention
          </h2>
          {upcoming.length > 0 && (
            <button className="link-button small" onClick={() => setShowUpcoming(!showUpcoming)}>
              {showUpcoming ? 'Hide' : 'Show'} upcoming ({upcoming.length})
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        {attention.length === 0 ? <p className="muted">Nothing needs attention. </p> : <NotificationList items={attention} />}
        {showUpcoming && (
          <>
            <h3 className="sub-head">Upcoming</h3>
            <NotificationList items={upcoming} />
          </>
        )}
      </section>

      {can('jobs') && <JobsTable />}
    </>
  )
}
