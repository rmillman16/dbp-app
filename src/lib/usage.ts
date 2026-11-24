// Site usage (24 Nov, script 080): each page a signed-in person opens is counted by area and tab, so Settings › Usage can show what is
// used most. Only the page's pattern is kept (ids removed), never anything typed in the app. Quiet: if it can't be recorded (offline,
// script 080 not run) nothing happens.
import { supabase } from './supabase'

const ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i
let last = ''
let lastAt = 0

export function normalisePath(pathname: string) {
  const seg = pathname.split('/').filter(Boolean).map((s) => (ID.test(s) ? ':id' : s))
  const path = '/' + seg.join('/')
  const area = seg[0] ?? 'home'
  // inside a job: /jobs/:id/<tab>
  const tab = area === 'jobs' && seg[1] === ':id' ? (seg[2] ?? 'overview') : area === 'estimating' && seg[1] === 'e' ? (seg[3] ?? 'enquiry') : (seg[1] && seg[1] !== ':id' ? seg[1] : '')
  return { path, area, tab }
}

export function trackPage(pathname: string) {
  if (!navigator.onLine) return
  const { path, area, tab } = normalisePath(pathname)
  const now = Date.now()
  if (path === last && now - lastAt < 30000) return // a refresh or a quick bounce is not another use
  last = path
  lastAt = now
  void supabase.from('usage_events').insert({ area, tab, path }).then(
    () => {},
    () => {},
  )
}

export interface UsageArea {
  area: string
  tab: string
  views: number
  people: number
  last_used: string
}
export interface UsagePerson {
  profile_id: string
  full_name: string | null
  email: string | null
  views: number
  days_active: number
  last_seen: string
  top_area: string | null
}
export interface UsageDay {
  day: string
  views: number
  people: number
}

async function rpc<T>(name: string, days: number): Promise<T[]> {
  const r = await supabase.rpc(name, { p_days: days })
  if (r.error) throw new Error(/function|schema cache|does not exist/i.test(r.error.message) ? 'Usage tracking needs script 080 run in Supabase first (supabase/README.md).' : r.error.message)
  return (r.data ?? []) as T[]
}
export const loadUsage = (days: number) => Promise.all([rpc<UsageArea>('usage_by_area', days), rpc<UsagePerson>('usage_by_person', days), rpc<UsageDay>('usage_by_day', days)])
