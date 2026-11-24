// The outbox (24 Nov): site work that must never be lost for want of signal. When there is no connection, or it drops while
// saving, the new snag, site diary, delivery note, accident report, change to a snag or photo is kept on the device (IndexedDB)
// and sent, in order, as soon as the connection is back. Lists and forms show what is waiting (merged into what they load), and
// the top bar shows how many are waiting. Minutes have their own device copy (minutes.ts saveDraft).
//
// Every queued item is safe to send twice (a new record is inserted only if it isn't there; files are stored under their own id),
// so a drop in the middle of a send never makes a duplicate. Things that cannot be queued (deleting, sending a snag back, issuing
// to a trade) still need a connection and say so.
import { useEffect, useState } from 'react'
import { get, set } from 'idb-keyval'
import { supabase } from './supabase'
import { isNetworkError } from './offline'

export type Op =
  | { t: 'snag.create'; id: string; row: Record<string, unknown> }
  | { t: 'snag.update'; id: string; patch: Record<string, unknown> }
  | { t: 'snag.photo'; fileId: string; snagId: string; kind: string; file: File }
  | { t: 'hs.save'; table: string; id: string; jobId: string; isNew: boolean; values: Record<string, unknown> }
  | { t: 'hs.file'; fileId: string; jobId: string; kind: string; recordId: string; file: File }

export interface Item {
  qid: string
  at: string
  label: string
  jobId: string | null
  op: Op
  error?: string
}

const KEY = 'outbox-v1'
const CHANGED = 'outbox-changed'
const SYNCED = 'outbox-synced'
const safeName = (n: string) => n.replace(/[^\w.\- ()]+/g, '_')
export const newId = () => crypto.randomUUID()
export const isLocalPath = (p: string) => p.startsWith('local:')

// one change at a time to the stored list
let chain: Promise<unknown> = Promise.resolve()
function locked<T>(f: () => Promise<T>): Promise<T> {
  const next = chain.then(f, f)
  chain = next.catch(() => {})
  return next
}
export const queued = (): Promise<Item[]> => get<Item[]>(KEY).then((l) => l ?? [], () => [])
const save = (l: Item[]) => set(KEY, l).then(() => void window.dispatchEvent(new Event(CHANGED)))

export function enqueue(label: string, jobId: string | null, op: Op) {
  return locked(async () => {
    const l = await queued()
    l.push({ qid: newId(), at: new Date().toISOString(), label, jobId, op })
    await save(l)
  }).then(() => void flush())
}

// is this record (a snag or a diary…) still waiting to be created? Then changes to it queue behind it, to keep the order
export async function isWaiting(id: string) {
  return (await queued()).some((i) => ('id' in i.op && i.op.id === id) || ('recordId' in i.op && i.op.recordId === id))
}

// run online; if there is no connection (or it drops mid-way) queue instead. Returns true when it was queued.
export async function tryOrQueue(run: () => Promise<unknown>, queue: () => Promise<unknown>, waitingFor?: string): Promise<boolean> {
  if (navigator.onLine && !(waitingFor && (await isWaiting(waitingFor)))) {
    try {
      await run()
      return false
    } catch (e) {
      if (!isNetworkError(e)) throw e
    }
  }
  await queue()
  return true
}

// ---------- sending ----------
const msg = (e: { message: string } | null | undefined) => e?.message ?? 'failed'
async function send(op: Op) {
  if (op.t === 'snag.create') {
    const r = await supabase.from('snags').upsert({ id: op.id, ...op.row }, { onConflict: 'id', ignoreDuplicates: true })
    if (r.error) throw new Error(msg(r.error))
  } else if (op.t === 'snag.update') {
    const r = await supabase.from('snags').update(op.patch).eq('id', op.id)
    if (r.error) throw new Error(msg(r.error))
  } else if (op.t === 'snag.photo') {
    const path = `${op.snagId}/${op.fileId}-${safeName(op.file.name)}`
    const up = await supabase.storage.from('snags').upload(path, op.file, { contentType: op.file.type || undefined, upsert: true })
    if (up.error) throw new Error(msg(up.error))
    const r = await supabase.from('snag_files').upsert({ id: op.fileId, snag_id: op.snagId, kind: op.kind, name: op.file.name, path }, { onConflict: 'id', ignoreDuplicates: true })
    if (r.error) throw new Error(msg(r.error))
  } else if (op.t === 'hs.save') {
    const r = op.isNew
      ? await supabase.from(op.table).upsert({ ...op.values, id: op.id, job_id: op.jobId }, { onConflict: 'id', ignoreDuplicates: true })
      : await supabase.from(op.table).update(op.values).eq('id', op.id)
    if (r.error) throw new Error(msg(r.error))
  } else {
    const path = `${op.jobId}/${op.fileId}-${safeName(op.file.name)}`
    const up = await supabase.storage.from('hs').upload(path, op.file, { contentType: op.file.type || undefined, upsert: true })
    if (up.error) throw new Error(msg(up.error))
    const r = await supabase.from('hs_files').upsert({ id: op.fileId, job_id: op.jobId, record_kind: op.kind, record_id: op.recordId, name: op.file.name, path }, { onConflict: 'id', ignoreDuplicates: true })
    if (r.error) throw new Error(msg(r.error))
  }
}

let running = false
export async function flush(retryFailed = false) {
  if (running || !navigator.onLine) return
  running = true
  let sent = 0
  try {
    if (retryFailed) await locked(async () => save((await queued()).map(({ error: _e, ...i }) => i))) // eslint-disable-line @typescript-eslint/no-unused-vars
    for (const item of await queued()) {
      if (item.error) continue
      try {
        await send(item.op)
        await locked(async () => save((await queued()).filter((i) => i.qid !== item.qid)))
        sent++
      } catch (e) {
        if (isNetworkError(e)) break // the connection dropped again: try later, in order
        await locked(async () => save((await queued()).map((i) => (i.qid === item.qid ? { ...i, error: (e as Error).message } : i))))
      }
    }
  } finally {
    running = false
    if (sent) window.dispatchEvent(new Event(SYNCED))
  }
}
export const discard = (qid: string) => locked(async () => save((await queued()).filter((i) => i.qid !== qid)))

// started once when signed in: send whatever is waiting now, when the connection returns, and now and then
export function startOutbox() {
  const go = () => void flush()
  window.addEventListener('online', go)
  const t = window.setInterval(go, 30_000)
  go()
  return () => {
    window.removeEventListener('online', go)
    window.clearInterval(t)
  }
}

// ---------- for the screens ----------
export function useOutbox() {
  const [items, setItems] = useState<Item[]>([])
  useEffect(() => {
    const read = () => queued().then(setItems)
    read()
    window.addEventListener(CHANGED, read)
    return () => window.removeEventListener(CHANGED, read)
  }, [])
  return items
}
// call back when something waiting has just been sent (so a list can load again)
export function useOnSynced(cb: () => void) {
  useEffect(() => {
    window.addEventListener(SYNCED, cb)
    return () => window.removeEventListener(SYNCED, cb)
  }, [cb])
}
// a photo that is still on the device: a link the page can show
export async function localFileUrl(path: string): Promise<string> {
  const id = path.slice(6)
  const item = (await queued()).find((i) => (i.op.t === 'snag.photo' || i.op.t === 'hs.file') && i.op.fileId === id)
  if (!item || !('file' in item.op)) return ''
  return URL.createObjectURL(item.op.file)
}
