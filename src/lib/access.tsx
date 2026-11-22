// Profile types and who sees what (22 Nov, script 035). A person has one or more profile types; the grid of
// which types can open which part of the app is ticked by admins in Settings › Access (role_access). Admins
// see everything. Someone with no type yet keeps today's access (everything but the buyer's lists) so nobody
// is locked out while types are given out. A part you can't open is hidden from the menus, and going to it
// shows the "no access" screen (NoAccess.tsx) rather than an error.
// The database enforces this for requisitions today; for the rest it's the screens for now (database checks
// per part to follow before External logins are handed out: docs/decisions.md).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { cached, must } from './offline'
import type { Profile } from './types'

export type Role = 'project_manager' | 'commercial' | 'site_management' | 'design' | 'accounts' | 'external' | 'operations'
export const ROLES: [Role, string][] = [
  ['project_manager', 'Project manager'],
  ['commercial', 'Commercial'],
  ['site_management', 'Site management'],
  ['design', 'Design'],
  ['accounts', 'Accounts'],
  ['operations', 'Operations'],
  ['external', 'External'],
]
export const roleLabel = (r: string) => ROLES.find(([k]) => k === r)?.[1] ?? r

export type Section =
  | 'dashboard'
  | 'jobs'
  | 'job_programme'
  | 'job_commercial'
  | 'job_procurement'
  | 'job_sampling'
  | 'job_eot'
  | 'estimating'
  | 'contracts'
  | 'site'
  | 'buyer_material'
  | 'buyer_hire'
  | 'contractors'
// the parts of the app, as ticked in Settings › Access (Settings itself is admins only)
export const SECTIONS: [Section, string, string][] = [
  ['dashboard', 'Dashboard', 'Every job’s value, margin, cash, programme, overdue items and hire in one view'],
  ['jobs', 'Jobs', 'The jobs list and each job’s Overview'],
  ['job_programme', 'Job › Programme', ''],
  ['job_commercial', 'Job › Commercial', 'Variations, quotations, applications, payment notices, cashflow, CVR'],
  ['job_procurement', 'Job › Procurement', ''],
  ['job_sampling', 'Job › Sampling', ''],
  ['job_eot', 'Job › EOT', ''],
  ['estimating', 'Estimating', ''],
  ['contracts', 'Contracts', 'EOT clauses and wording'],
  ['contractors', 'Contractors', ''],
  ['site', 'Site › Requisitions', 'Raise material / hire requisitions and see your own'],
  ['buyer_material', 'Site › Material Req - ADMIN', 'Every material requisition, all jobs'],
  ['buyer_hire', 'Site › Hire Req - ADMIN', 'Every hire requisition, all jobs; off-hire reminders'],
]
export const sectionLabel = (s: Section) => SECTIONS.find(([k]) => k === s)?.[1] ?? s

interface AccessState {
  ready: boolean
  me: Profile | null
  isAdmin: boolean
  roles: Role[]
  grid: { role: Role; section: Section }[]
  can: (s: Section) => boolean
  reload: () => void
}
const Ctx = createContext<AccessState | null>(null)

export function AccessProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Profile | null>(null)
  const [grid, setGrid] = useState<{ role: Role; section: Section }[]>([])
  const [ready, setReady] = useState(false)

  const reload = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    const id = data.session?.user.id
    const [p, g] = await Promise.all([
      id ? cached('me-access', () => must<Profile>(supabase.from('profiles').select('*').eq('id', id).single())).catch(() => null) : null,
      cached('role-access', () => must<{ role: Role; section: Section }[]>(supabase.from('role_access').select('role,section'))).catch(() => []), // before 035: none
    ])
    setMe(p)
    setGrid(g)
    setReady(true)
  }, [])
  useEffect(() => {
    reload()
  }, [reload])

  const isAdmin = !!me?.is_admin
  const roles = (me?.roles ?? []) as Role[]
  const can = (s: Section) => {
    if (!ready) return true // don't flash "no access" while loading
    if (isAdmin) return true
    if (roles.length === 0) return s.startsWith('buyer_') ? !!me?.is_operations : true
    return grid.some((g) => roles.includes(g.role) && g.section === s)
  }
  return <Ctx.Provider value={{ ready, me, isAdmin, roles, grid, can, reload }}>{children}</Ctx.Provider>
}

export function useAccess() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAccess outside AccessProvider')
  return c
}
