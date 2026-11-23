// Outside people's access to RFIs and submittals (script 061). These pages never use the app's own sign-in or database
// connection: everything goes through the "external" Edge Function, which checks who they are (a private link, or an
// email code) and returns only their own item. See supabase/functions/external/index.ts.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export type ExtAuth = { token: string } | { session: string; kind: 'rfi' | 'submittal'; id: string }

export async function ext<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  if (!url) throw new Error('This page is not set up yet.')
  let r: Response
  try {
    r = await fetch(`${url}/functions/v1/external`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(anon ? { apikey: anon } : {}) }, body: JSON.stringify(body) })
  } catch {
    throw new Error("Couldn't reach the server. Please check your connection and try again.")
  }
  const j = (await r.json().catch(() => null)) as ({ ok: boolean; error?: string } & T) | null
  if (!j) throw new Error(r.status === 404 ? 'This page is not switched on yet.' : 'Something went wrong. Please try again.')
  if (!j.ok) throw new Error(j.error ?? 'Something went wrong. Please try again.')
  return j
}

export interface ExtFile {
  id: string
  name: string
  kind?: string
}
export interface ExtItem {
  kind: 'rfi' | 'submittal'
  id: string
  project: string
  number: number
  title: string
  body: string | null
  status: string
  due_date: string | null
  trade: string | null
  manager: string | null
  type?: string
  current_rev?: number
  you: { name: string; company: string; role: string }
  can_act: boolean
  responses?: { id: string; kind: string; body: string | null; author: string; at: string; files: ExtFile[] }[]
  files?: ExtFile[]
  revisions?: { id: string; rev: number; submitted_on: string | null; due_date: string | null; outcome: string | null; response_notes: string | null; responded_by: string | null; responded_on: string | null; files: ExtFile[] }[]
}
export interface ExtListItem {
  kind: 'rfi' | 'submittal'
  id: string
  number: number
  title: string
  status: string
  due_date: string | null
  project: string
  act: boolean
}

export const authBody = (a: ExtAuth) => a

// upload one file straight to storage through a one-off signed address the function made for this item
export async function extUpload(a: ExtAuth, file: File) {
  const r = await ext<{ path: string; url: string }>({ action: 'upload_url', ...a, filename: file.name })
  const form = new FormData()
  form.append('cacheControl', '3600')
  form.append('', file)
  const up = await fetch(r.url, { method: 'PUT', body: form, headers: { 'x-upsert': 'false' } })
  if (!up.ok) throw new Error(up.status === 413 ? 'That file is too large (the limit is 50 MB).' : "The file couldn't be uploaded. Please try again.")
  return { path: r.path, name: file.name }
}
export async function extOpenFile(a: ExtAuth, fileId: string) {
  const r = await ext<{ url: string }>({ action: 'file_url', ...a, file_id: fileId })
  window.open(r.url, '_blank', 'noopener')
}

export const SESSION_KEY = 'dbp-ext-session'
export const getSession = () => {
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}
export const setSession = (s: string | null) => {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, s)
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* private window: carry on without remembering */
  }
}
