import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { cached, must } from './offline'
import { loadDirPeople, loadTeam, loadTemplates, loadTrades, type OwnerRef, type DirPerson, type PersonRef, type Rfi, type RfiPerson, type RfiResponse, type RfiTemplate } from './rfis'
import type { RegisterRow } from './exportRfis'
import { htmlToText } from './richText'
import type { TeamMember } from './om'

export interface NewPerson {
  companyId: string
  newCompany: string
  newCompanyType: string
  newCompanyTrade?: string
  newCompanyPhone?: string
  name: string
  email: string
  phone: string
  role: string
}
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
export function useRfiContext(owner: OwnerRef) {
  const jobId = owner.id
  const [dir, setDir] = useState<DirPerson[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [profiles, setProfiles] = useState<{ id: string; full_name: string | null; email: string | null }[]>([])
  const [trades, setTrades] = useState<string[]>([])
  const [templates, setTemplates] = useState<RfiTemplate[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string; type: string }[]>([])
  const [ready, setReady] = useState(false)

  const reload = () =>
    Promise.all([
      loadDirPeople(owner).catch(() => [] as DirPerson[]),
      // an enquiry has no team: every DBP person can be picked
      owner.kind === 'job'
        ? loadTeam(owner.id).catch(() => [] as TeamMember[])
        : cached('profiles-basic', () => must<{ id: string; full_name: string | null; email: string | null; job_title: string | null }[]>(supabase.from('profiles').select('id,full_name,email,job_title').order('full_name')))
            .then((ps) => ps.map((p) => ({ profile_id: p.id, role: p.job_title || 'DBP', full_name: p.full_name, email: p.email, job_title: p.job_title }) as TeamMember))
            .catch(() => [] as TeamMember[]),
      cached('profiles-basic', () => must<{ id: string; full_name: string | null; email: string | null; job_title: string | null }[]>(supabase.from('profiles').select('id,full_name,email,job_title').order('full_name'))).catch(() => []),
      loadTrades(),
      loadTemplates(owner),
      supabase.from('companies').select('id, name, type').order('name').then((r) => (r.data ?? []) as { id: string; name: string; type: string }[]),
    ]).then(([d, t, p, tr, tp, co]) => {
      setCompanies(co)
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

  // someone not on the job yet: saved as a contact of their company (a new company if needed) and in this job's project
  // directory with their role, then picked. Returns the person's key.
  const addPerson = async (p: NewPerson): Promise<string> => {
    let companyId = p.companyId
    if (!companyId) {
      const c = await supabase.from('companies').insert({ name: p.newCompany.trim(), type: p.newCompanyType, trade: p.newCompanyTrade?.trim() || null, phone: p.newCompanyPhone?.trim() || null }).select('id').single()
      if (c.error) throw new Error(c.error.message)
      companyId = c.data.id as string
    }
    const ct = await supabase.from('contacts').insert({ company_id: companyId, name: p.name.trim(), email: p.email.trim() || null, phone: p.phone.trim() || null }).select('id').single()
    if (ct.error) throw new Error(ct.error.message)
    const d = await supabase.from('job_directory').insert({ job_id: owner.kind === 'job' ? jobId : null, enquiry_id: owner.kind === 'enquiry' ? jobId : null, company_id: companyId, contact_id: ct.data.id, role: p.role.trim(), client_direct: false }).select('id').single()
    if (d.error) throw new Error(d.error.message)
    await reload()
    return `d:${d.data.id}`
  }

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
  return { dir, team, profiles, trades, setTrades, templates, companies, addPerson, ready, reload, whos, who, nameOf, profileName, rowFor }
}
