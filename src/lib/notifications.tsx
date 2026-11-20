import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { addDaysIso, todayIso } from './format'
import { cached, must, saveError } from './offline'
import type { Notification } from './types'

export const SNOOZE_DAYS = 7

// A reminder dated in the future (e.g. the 60-day insurance reminder) isn't
// counted until it's within the due-soon window; it sits under "upcoming".
export function needsAttention(n: Notification) {
  return n.severity !== 'info' || n.due_date == null
}

export function linkFor(n: Notification): string | null {
  if (n.link) return n.link
  if (n.source_table === 'jobs' && n.source_id) return `/jobs/${n.source_id}`
  if (n.job_id) return `/jobs/${n.job_id}`
  return null
}

interface NotificationsState {
  items: Notification[]
  attention: Notification[]
  upcoming: Notification[]
  worst: 'overdue' | 'due_soon' | null
  error: string | null
  reload: () => void
  markDone: (id: string) => void
  snooze: (id: string) => void
}

const Ctx = createContext<NotificationsState | null>(null)

// One copy of the notifications for the whole app, shared by the bell and the home page.
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Notification[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const data = await cached('notifications', () =>
        must(supabase.from('notifications_live').select('*').order('due_date', { ascending: true, nullsFirst: false })),
      )
      setItems(data as Notification[])
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    reload()
    // refresh when the connection comes back
    window.addEventListener('online', reload)
    return () => window.removeEventListener('online', reload)
  }, [reload])

  async function update(id: string, values: Record<string, unknown>) {
    const { error } = await supabase.from('notifications').update(values).eq('id', id)
    if (error) setError(saveError(error))
    else reload()
  }

  const attention = items.filter(needsAttention)
  const value: NotificationsState = {
    items,
    attention,
    upcoming: items.filter((n) => !needsAttention(n)),
    worst: attention.some((n) => n.severity === 'overdue')
      ? 'overdue'
      : attention.some((n) => n.severity === 'due_soon')
        ? 'due_soon'
        : null,
    error,
    reload,
    markDone: (id) => update(id, { status: 'done' }),
    snooze: (id) => update(id, { status: 'snoozed', snoozed_until: addDaysIso(todayIso(), SNOOZE_DAYS) }),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNotifications() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useNotifications must be used inside NotificationsProvider')
  return v
}
