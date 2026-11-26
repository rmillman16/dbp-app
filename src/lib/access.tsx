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
  | 'job_variations_list'
  | 'job_procurement'
  | 'job_sampling'
  | 'job_eot'
  | 'job_minutes'
  | 'job_om'
  | 'job_rfis'
  | 'job_snagging'
  | 'job_hs'
  | 'job_breeam'
  | 'job_progress'
  | 'job_checklist'
  | 'job_design'
  | 'estimating'
  | 'contracts'
  | 'site'
  | 'buyer_material'
  | 'buyer_hire'
  | 'buyer_inventory'
  | 'contractors'
// the parts of the app, as ticked in Settings › Access (Settings itself is admins only)
export const SECTIONS: [Section, string, string][] = [
  ['jobs', 'Jobs', 'The jobs list and each job’s Overview'],
  ['job_programme', 'Job › Programme', ''],
  ['job_commercial', 'Job › Commercial', 'Variations, quotations, applications, payment notices, cashflow, CVR'],
  ['job_variations_list', 'Job › Variations (list only)', 'See each job’s variations and their status, with no values and no editing (for the site team). Commercial sees everything anyway'],
  ['job_procurement', 'Job › Procurement', ''],
  ['job_sampling', 'Job › Sampling', ''],
  ['job_eot', 'Job › EOT', ''],
  ['job_om', 'Job › O&M', 'Each job’s O&M tracker, file sections and the client’s O&M manual PDF; O&M reminders'],
  ['job_rfis', 'Job › RFIs & submittals', 'Each job’s RFIs (and, later, submittals): create, answer, close, chase, export'],
  ['job_snagging', 'Job › Snagging', 'Each job’s snag lists: raise, assign to trades, check what they say is done, send back; the trades’ private snag links'],
  ['job_hs', 'Job › H&S', 'Each job’s site diaries, delivery notes and H&S inspections (with photos and actions)'],
  ['job_breeam', 'Job › BREEAM', 'Each job’s BREEAM tracker and evidence'],
  ['job_progress', 'Job › Progress reports', 'Each job’s progress reports: write, approve, issue'],
  ['job_checklist', 'Job › Project checklist', 'The H&S and compliance checklist at the bottom of each job’s Overview (F10, construction phase plan…)'],
  ['job_design', 'Job › Design', 'Each job’s design tools (design register, drawings, design reviews): being built, ticked for Design and Project manager to start'],
  ['job_minutes', 'Job › Minutes', 'Meeting minutes on each job (an estimate’s minutes follow Estimating). Everyone sees their own actions in Tasks'],
  ['estimating', 'Estimating', ''],
  ['contracts', 'Contracts', 'EOT clauses and wording'],
  ['contractors', 'Supply Chain', ''],
  ['site', 'Site › Requisitions', 'Raise material / hire requisitions and see your own'],
  ['buyer_material', 'Site › Material Req - ADMIN', 'Every material requisition, all jobs'],
  ['buyer_hire', 'Site › Hire Req - ADMIN', 'Every hire requisition, all jobs; off-hire reminders'],
  ['buyer_inventory', 'Site › Inventory - ADMIN', 'Add locations and items to the inventory, adjust stock, work the requests'],
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
    if (s === 'dashboard') return false // the Dashboard is for admins only (24 Nov), whatever the grid says
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
