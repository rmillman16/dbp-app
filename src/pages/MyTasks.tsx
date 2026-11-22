// My tasks (22 Nov, script 045): DBP Minutes' "My tasks" view as a page for everyone. Every open action item
// assigned to me (an attendee linked to my login) across all meetings, overdue first, then by due date. Click one
// to open its meeting; Complete ticks it (and closes it on the bell).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../minutes.css'
import { useAccess } from '../lib/access'
import { useNotifications } from '../lib/notifications'
import * as M from '../lib/minutes'
import { Icon, Mentions, useToast } from '../components/MinutesBits'

export default function MyTasks() {
  const { me } = useAccess()
  const { reload } = useNotifications()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<M.OpenAction[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { showToast, toastElement } = useToast()

  useEffect(() => {
    M.loadMyActions().then(setTasks, (e: Error) => {
      setError(e.message)
      setTasks([])
    })
  }, [])

  async function complete(t: M.OpenAction) {
    try {
      await M.completeAction(t.pointId, true)
      setTasks((l) => (l ?? []).filter((x) => x.pointId !== t.pointId))
      reload()
      showToast('Marked complete.')
    } catch (e) {
      showToast((e as Error).message, true)
    }
  }

  const name = me?.full_name || me?.email || 'you'
  return (
    <div className="mint my-tasks">
      <main className="note">
        <div className="note-inner">
          <h1 className="dash-title">My tasks</h1>
          <p className="dash-sub">{tasks === null ? 'Loading…' : `${tasks.length} open action item${tasks.length === 1 ? '' : 's'} assigned to ${name} across all meetings.`}</p>
          {error && <p className="mint-error">{error}</p>}
          {tasks && !tasks.length && !error && (
            <div className="dash-empty">
              Nothing outstanding — or nothing has been assigned to you yet. Actions show here once you’re an attendee and the owner of an action item.
            </div>
          )}
          {tasks && tasks.length > 0 && (
            <div className="dash-list">
              {tasks.map((t) => {
                const open = () => navigate(M.meetingPath({ id: t.meetingId, jobId: t.jobId }))
                const point = { done: false, dueDate: t.dueDate }
                return (
                  <div
                    key={t.pointId}
                    className="dash-task"
                    role="link"
                    tabIndex={0}
                    onClick={(e) => !(e.target as HTMLElement).closest('.btn-complete') && open()}
                    onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open()}
                  >
                    <div className="dash-task-text">
                      <Mentions text={t.text || '(no description)'} attendees={t.attendees} />
                    </div>
                    <div className="dash-task-meta">
                      {t.dueDate && <span className={'chip due status-' + M.dueStatus(point)}>{M.dueLabel(point)}</span>}
                      {t.urgent && <span className="chip flag-urgent">Urgent</span>}
                      <span className="chip">
                        {M.projectNameOf(t)}
                        {t.meetingDate ? ' · ' + M.formatDateSidebar(t.meetingDate) : ''}
                      </span>
                      {t.jobLabel && <span className="chip">{t.jobLabel}</span>}
                    </div>
                    {!t.jobArchived && (
                      <button className="btn-complete" type="button" aria-label="Mark complete" onClick={() => complete(t)}>
                        {Icon.check()}
                        Complete
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
      {toastElement}
    </div>
  )
}
