import { createClient } from '@supabase/supabase-js'
import { get, set } from 'idb-keyval'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Shown on screen instead of a blank page if .env.local hasn't been filled in.
export const configError =
  !url || !anonKey || url.includes('YOUR-PROJECT') || anonKey.startsWith('your-')
    ? 'The Supabase Project URL and publishable key are missing. Copy .env.example to .env.local, paste them in, then restart npm run dev.'
    : null

// Whole-app offline reading: every data read (a GET to the database) is kept on the device as it is fetched. With no signal, or if
// the request fails because the connection dropped, the last copy of that same read is returned, so any page that has been opened
// before opens again. Online, the live answer is always used. Writes are never faked. The copies are wiped at sign-out
// (clearOfflineCopy), so a shared device doesn't show the last person's data.
const MAX_COPY = 4_000_000
// .single() and a list read share a URL and differ only by headers, so the headers are part of the key
const readKey = (r: Request) => `read:${r.url}|${r.headers.get('accept') ?? ''}|${r.headers.get('prefer') ?? ''}|${r.headers.get('range') ?? ''}`
async function offlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init)
  const isRead = req.method === 'GET' && req.url.includes('/rest/v1/')
  if (!isRead) return fetch(req)
  const key = readKey(req)
  const fromCopy = async () => {
    const c = await get<{ status: number; headers: [string, string][]; body: string }>(key).catch(() => undefined)
    return c ? new Response(c.body, { status: c.status, headers: c.headers }) : null
  }
  if (!navigator.onLine) return (await fromCopy()) ?? Response.error()
  try {
    const res = await fetch(req)
    if (res.ok) {
      const copy = res.clone()
      copy.text().then((body) => {
        if (body.length < MAX_COPY) set(key, { status: res.status, headers: [...res.headers.entries()].filter(([k]) => /^(content-type|content-range)$/i.test(k)), body }).catch(() => {})
      }, () => {})
    }
    return res
  } catch (e) {
    const c = await fromCopy()
    if (c) return c
    throw e
  }
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing', { global: { fetch: offlineFetch } })