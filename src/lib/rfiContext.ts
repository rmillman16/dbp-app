import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { cached, must } from './offline'
import { loadDirPeople, loadTeam, loadTemplates, loadTrades, type DirPerson, type PersonRef, type Rfi, type RfiPerson, type RfiResponse, type RfiTemplate } from './rfis'
import type { RegisterRow } from './exportRfis'
import { htmlToText } from './richText'
import type { TeamMember } from './om'

export interface Who {
  key: string // "d:<directory id>" or "p:<profile id>"
  label: string // Name (Company · Role)
  name: string
  email: string | null
  external: boolean
}
export const keyOf = (p: { directory_id?: string | null; profile_id?: string | null }) => (p.directory_id ? `d:${p.directory_id}` : `p:${p.profile_id}`)
export const refOf = (k: string): PersonRef => (k.startsWith('d:') ? { directory_id: k.slice(2) } : { profile_id: k.slice(2) })

// who an RFI can be addressed to on one job: the people in its project directory (outside DBP) and DBP's team
export function useRfiContext(jobId: string) {
  const [dir, setDir] = useState<DirPerson[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [profiles, setProfiles] = useState<{ id: string; full_name: string | null; email: string | null }[]>([])
  const [trades, setTrades] = useState<string[]>([])
  const [templates, setTemplates] = useState<RfiTemplate[]>([])
  const [ready, setReady] = useState(false)

  const reload = () =>
    Promise.all([
      loadDirPeople(jobId).catch(() => [] as DirPerson[]),
      loadTeam(jobId).catch(() => [] as TeamMember[]),
      cached('profiles-basic', () => must<{ id: string; full_name: string | null; email: string | null; job_title: string | null }[]>(supabase.from('profiles').select('id,full_name,email,job_title').order('full_name'))).catch(() => []),
      loadTrades(),
      loadTemplates(),
    ]).then(([d, t, p, tr, tp]) => {
      setDir(d)
      setTeam(t)
      setProfiles(p)
      setTrades(tr)
      setTemplates(tp)
      setReady(true)
    })
  useEffect(() => {
    reload()
  }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  const profileName = (id: string | null | undefined) => {
    const p = profiles.find((x) => x.id === id)
    return p?.full_name || p?.email || ''
  }
  // everyone, outside DBP first
  const whos: Who[] = useMemo(() => {
    const outside = dir.map((p) => ({ key: `d:${p.id}`, label: `${p.name} (${p.company}${p.role ? ' · ' + p.role : ''})`, name: p.name, email: p.email, external: true }))
    const inside = team.map((m) => ({ key: `p:${m.profile_id}`, label: `${m.full_name ?? m.email ?? ''} (DBP · ${m.role})`, name: m.full_name ?? m.email ?? '', email: m.email, external: false }))
    return [...outside, ...inside]
  }, [dir, team])
  const who = (k: string) => whos.find((w) => w.key === k)
  const nameOf = (p: Pick<RfiPerson, 'directory_id' | 'profile_id'>) => (p.directory_id ? dir.find((d) => d.id === p.directory_id)?.name : profileName(p.profile_id)) ?? ''

  const rowFor = (rfi: Rfi, people: RfiPerson[], responses: RfiResponse[] = []): RegisterRow => ({
    rfi,
    assignees: people.filter((p) => p.role === 'assignee').map(nameOf).filter(Boolean).join(', '),
    cc: people.filter((p) => p.role === 'cc').map(nameOf).filter(Boolean).join(', '),
    manager: profileName(rfi.manager_id),
    receivedFrom: rfi.received_from ? (dir.find((d) => d.id === rfi.received_from)?.name ?? '') + (dir.find((d) => d.id === rfi.received_from)?.company ? ` (${dir.find((d) => d.id === rfi.received_from)?.company})` : '') : '',
    replies: responses.map((r) => ({ at: r.created_at, by: r.author_name || profileName(r.author_id) || 'DBP', kind: r.kind, text: htmlToText(r.body) })),
  })
  return { dir, team, profiles, trades, setTrades, templates, ready, reload, whos, who, nameOf, profileName, rowFor }
}
