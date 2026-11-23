// Offline groundwork.
// - cached(): every screen reads through this. Online it fetches and keeps a copy
//   on the device (IndexedDB); offline, or if the fetch fails, it returns that copy.
// - useOnline(): true / false, for the top-bar indicator and to stop saves offline.
// Later, modules that must work underground (minutes, site notes) add an outbox here
// that queues saves on the device and sends them when the connection returns.
import { useEffect, useState } from 'react'
import { clear, get, set } from 'idb-keyval'

interface Stored<T> {
  data: T
  savedAt: string
}

export class OfflineNoCopyError extends Error {
  constructor() {
    super("You're offline and this page hasn't been opened on this device before, so there's no saved copy to show.")
  }
}

export async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  if (navigator.onLine) {
    try {
      const data = await fetcher()
      set(key, { data, savedAt: new Date().toISOString() } satisfies Stored<T>).catch(() => {})
      return data
    } catch (e) {
      // a dropped connection looks like a failed fetch: fall back to the saved copy
      const copy = await get<Stored<T>>(key).catch(() => undefined)
      if (copy && isNetworkError(e)) return copy.data
      throw e
    }
  }
  const copy = await get<Stored<T>>(key).catch(() => undefined)
  if (copy) return copy.data
  throw new OfflineNoCopyError()
}

// Supabase returns { data, error }; this turns it into a value or a thrown error for cached().
export async function must<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data as T
}

export function isNetworkError(e: unknown) {
  const msg = (e as Error)?.message ?? ''
  return !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed/i.test(msg)
}

// Wording for a failed save.
export function saveError(e: unknown): string {
  return isNetworkError(e)
    ? "You're offline, so this hasn't been saved. Keep this page open and save again when you have signal."
    : ((e as Error)?.message ?? String(e))
}

// Wipe the device copy (on sign-out, so the next person on a shared device can't see it).
export function clearOfflineCopy() {
  return clear().catch(() => {})
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
