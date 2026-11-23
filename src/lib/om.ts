// The O&M manual (script 047): a tracker of the documents each package owes for the client's O&M
// manual, the file sections typed per job (description of works, residual risks, handover document)
// and the project directory. Groups: one per order (DBP's appointed subcontractors), one per client
// direct contractor (job_directory, client_direct ticked) and the job's own items (no package).
// Documents stay in SharePoint: each line holds a link; the client's PDF is built in the browser.
import { supabase } from './supabase'
import { cached, must } from './offline'
import { addDaysIso, todayIso, ukDate } from './format'
import { loadCompanies, loadOrders } from './subcontracts'
import type { Company, CompanySettings, Job, OmDocType, Order } from './types'

export type OmStatus = 'not_requested' | 'requested' | 'received' | 'accepted' | 'rejected_resubmit' | 'not_required'
export const OM_STATUS_LABELS: Record<OmStatus, string> = {
  not_requested: 'Not requested',
  requested: 'Requested',
  received: 'Received',
  accepted: 'Accepted',
  rejected_resubmit: 'Rejected – resubmit',
  not_required: 'Not required',
}
export const OM_STATUSES = Object.keys(OM_STATUS_LABELS) as OmStatus[]

export interface OmLine {
  id: string
  job_id: string
  order_id: string | null // DBP subcontractor
  company_id: string | null // client direct contractor (no order)
  doc_type_id: string | null // from the standard list
  custom_name: string | null // its name (copied from the standard list, or typed)
  status: OmStatus
  requested_date: string | null
  due_date: string | null
  received_date: string | null
  file_url: string | null // SharePoint link
  link_status?: LinkStatus | null // script 048: can anyone open it (checked by the check-link function)
  link_checked_url?: string | null // the link that was checked: a changed link is checked again
  reviewer_comment: string | null
  sort: number
}

export interface Contact {
  id: string
  company_id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
}

export interface DirectoryEntry {
  id: string
  job_id: string
  company_id: string | null
  contact_id: string | null
  role: string
  client_direct: boolean
}

export type Row = Record<string, string>
export interface OmJob {
  job_id: string
  description: string | null
  risks: Row[]
  handover: Record<string, Row[]>
}

// the columns of the file sections' tables (editors and PDF share them)
export interface Col {
  k: string
  label: string
  type?: 'date'
  w: number // relative width in the PDF
}
export const RISK_COLS: Col[] = [
  { k: 'risk', label: 'Residual risk', w: 3 },
  { k: 'location', label: 'Location', w: 2 },
  { k: 'controls', label: 'Control measures', w: 4 },
  { k: 'notes', label: 'Notes', w: 2 },
]
export const HANDOVER_TABLES: { key: string; title: string; cols: Col[] }[] = [
  {
    key: 'training',
    title: 'Client training & systems',
    cols: [
      { k: 'system', label: 'System / equipment', w: 3 },
      { k: 'by', label: 'Demonstrated by', w: 2 },
      { k: 'to', label: 'Trained / handed to', w: 2 },
      { k: 'date', label: 'Date', type: 'date', w: 1.3 },
      { k: 'notes', label: 'Notes', w: 2 },
    ],
  },
  {
    key: 'keys',
    title: 'Keys schedule',
    cols: [
      { k: 'item', label: 'Key / fob / code', w: 3 },
      { k: 'qty', label: 'Qty', w: 0.8 },
      { k: 'location', label: 'Door / location', w: 2.5 },
      { k: 'to', label: 'Handed to', w: 2 },
      { k: 'date', label: 'Date', type: 'date', w: 1.3 },
    ],
  },
  {
    key: 'outstanding',
    title: 'Outstanding works',
    cols: [
      { k: 'item', label: 'Item', w: 4 },
      { k: 'location', label: 'Location', w: 2 },
      { k: 'by', label: 'By', w: 2 },
      { k: 'date', label: 'Target date', type: 'date', w: 1.3 },
    ],
  },
  {
    key: 'warranties',
    title: 'Warranties',
    cols: [
      { k: 'item', label: 'Item / system', w: 3 },
      { k: 'company', label: 'Company', w: 2.5 },
      { k: 'period', label: 'Period', w: 1.3 },
      { k: 'starts', label: 'From', type: 'date', w: 1.3 },
      { k: 'notes', label: 'Notes', w: 2 },
    ],
  },
]
export const TEAM_ROLES = ['PM', 'QS', 'Site manager', 'Designer', 'Buyer']
export const DIRECTORY_ROLES = [
  'Client',
  'Client PM',
  'Architect',
  'Interior designer',
  'M&E consultant',
  'Structural engineer',
  'CDM adviser',
  'Building control',
  'Landlord',
  'Quantity surveyor',
]
// common project-specific items (typed per job)
export const PROJECT_ITEMS = [
  'Regulation 38 fire safety information pack',
  'BREEAM evidence',
  'Building control completion certificate',
  'Health & safety file',
  'Fire strategy',
  'Asbestos register',
  'As-built general arrangement drawings',
  'Maintenance instructions',
  'Client-specific requirements',
]

export const isOutstanding = (l: Pick<OmLine, 'status'>) => l.status === 'not_requested' || l.status === 'requested' || l.status === 'rejected_resubmit'
export const isOverdue = (l: Pick<OmLine, 'status' | 'due_date'>, today = todayIso()) => isOutstanding(l) && !!l.due_date && l.due_date < today
// due by default 4 weeks before PC; no PC, no date
export const defaultDue = (job: Pick<Job, 'pc_date'>) => (job.pc_date ? addDaysIso(job.pc_date, -28) : null)
export const lineName = (l: Pick<OmLine, 'custom_name' | 'doc_type_id'>, types: OmDocType[] = []) => l.custom_name || types.find((t) => t.id === l.doc_type_id)?.name || 'Document'

// ---------- groups ----------
export type GroupKind = 'order' | 'client' | 'job'
export interface OmGroup {
  key: string // o:<order id> · c:<company id> · job
  kind: GroupKind
  orderId: string | null
  companyId: string | null
  company: Company | null
  title: string // the company (or "Project items")
  subtitle: string // the package / trade
  directoryId: string | null // client direct: its job_directory row
}
export const groupKeyOf = (l: Pick<OmLine, 'order_id' | 'company_id'>) => (l.order_id ? `o:${l.order_id}` : l.company_id ? `c:${l.company_id}` : 'job')

export interface OmData {
  lines: OmLine[]
  docTypes: OmDocType[]
  orders: Order[]
  packages: { id: string; name: string }[]
  companies: Company[]
  contacts: Contact[]
  directory: DirectoryEntry[]
  omJob: OmJob
  settings: CompanySettings | null
  team: { profile_id: string; role: string; full_name: string | null; email: string | null; job_title: string | null }[]
}

export function buildGroups(d: Pick<OmData, 'lines' | 'orders' | 'packages' | 'companies' | 'directory'>): OmGroup[] {
  const co = (id: string | null) => d.companies.find((c) => c.id === id) ?? null
  const out: OmGroup[] = d.orders.map((o) => {
    const c = co(o.company_id)
    const pkg = d.packages.find((p) => p.id === o.package_id)?.name
    return {
      key: `o:${o.id}`,
      kind: 'order',
      orderId: o.id,
      companyId: o.company_id,
      company: c,
      title: c?.name ?? 'Subcontractor',
      subtitle: [o.folder_no != null ? String(o.folder_no).padStart(2, '0') : null, pkg || o.trade].filter(Boolean).join(' · ') || 'Order',
      directoryId: null,
    }
  })
  const clients = new Map<string, OmGroup>()
  for (const e of d.directory.filter((x) => x.client_direct && x.company_id)) {
    if (clients.has(e.company_id!)) continue
    const c = co(e.company_id)
    clients.set(e.company_id!, {
      key: `c:${e.company_id}`,
      kind: 'client',
      orderId: null,
      companyId: e.company_id,
      company: c,
      title: c?.name ?? 'Client direct contractor',
      subtitle: `${e.role || 'Client direct'} · client direct`,
      directoryId: e.id,
    })
  }
  // lines for a company that's no longer listed as client direct still show
  for (const l of d.lines)
    if (!l.order_id && l.company_id && !clients.has(l.company_id)) {
      const c = co(l.company_id)
      clients.set(l.company_id, {
        key: `c:${l.company_id}`,
        kind: 'client',
        orderId: null,
        companyId: l.company_id,
        company: c,
        title: c?.name ?? 'Contractor',
        subtitle: 'Client direct',
        directoryId: null,
      })
    }
  // lines for an order that's gone (shouldn't happen: they're deleted with it)
  for (const l of d.lines)
    if (l.order_id && !out.some((g) => g.orderId === l.order_id))
      out.push({ key: `o:${l.order_id}`, kind: 'order', orderId: l.order_id, companyId: null, company: null, title: 'Order', subtitle: '', directoryId: null })
  return [
    ...out,
    ...[...clients.values()].sort((a, b) => a.title.localeCompare(b.title, 'en-GB')),
    { key: 'job', kind: 'job', orderId: null, companyId: null, company: null, title: 'Project items', subtitle: 'Not tied to a package', directoryId: null },
  ]
}
// the standard list's trade that best fits a group (its package / trade name)
export function suggestTrade(g: OmGroup, trades: string[], orders: Order[]) {
  const hay = `${g.subtitle} ${orders.find((o) => o.id === g.orderId)?.trade ?? ''} ${g.company?.trade ?? ''}`.toLowerCase()
  return (
    trades.find((t) => hay.includes(t.toLowerCase())) ??
    trades.find((t) =>
      t
        .toLowerCase()
        .split(/\W+/)
        .some((w) => w.length > 3 && hay.includes(w)),
    ) ??
    null
  )
}

// ---------- loading ----------
const emptyOmJob = (jobId: string): OmJob => ({ job_id: jobId, description: null, risks: [], handover: {} })

export async function loadOm(job: Pick<Job, 'id'>): Promise<OmData> {
  const jobId = job.id
  const [lines, docTypes, orders, packages, companies, contacts, directory, omJob, settings, team] = await Promise.all([
    cached(`om:${jobId}`, () => must<OmLine[]>(supabase.from('om_requirements').select('*').eq('job_id', jobId).order('sort').order('id'))),
    cached('om-doc-types', () => must<OmDocType[]>(supabase.from('om_doc_types').select('*').is('job_id', null).order('trade').order('name'))).catch(() => [] as OmDocType[]),
    loadOrders(jobId).catch(() => [] as Order[]), // orders follow Job › Commercial: someone without it sees no packages
    cached(`packages:${jobId}`, () => must<{ id: string; name: string }[]>(supabase.from('packages').select('id,name').eq('job_id', jobId))).catch(() => []),
    loadCompanies().catch(() => [] as Company[]),
    cached('contacts', () => must<Contact[]>(supabase.from('contacts').select('*').order('name'))).catch(() => [] as Contact[]),
    cached(`job-directory:${jobId}`, () => must<DirectoryEntry[]>(supabase.from('job_directory').select('*').eq('job_id', jobId))).catch(() => [] as DirectoryEntry[]),
    cached(`om-job:${jobId}`, () => must<OmJob | null>(supabase.from('om_job').select('*').eq('job_id', jobId).maybeSingle())).catch(() => null), // before 047: nothing
    cached('company-settings', () => must<CompanySettings>(supabase.from('company_settings').select('*').eq('id', 1).single())).catch(() => null),
    loadTeam(jobId).catch(() => []),
  ])
  const oj = omJob ?? emptyOmJob(jobId)
  return {
    lines,
    docTypes,
    orders,
    packages,
    companies,
    contacts,
    directory,
    omJob: { ...oj, risks: Array.isArray(oj.risks) ? oj.risks : [], handover: oj.handover && typeof oj.handover === 'object' ? oj.handover : {} },
    settings,
    team,
  }
}

// ---------- saving document lines ----------
const ok = async (p: PromiseLike<{ error: { message: string } | null }>) => {
  const r = await p
  if (r.error) throw new Error(r.error.message)
}
function row(l: Partial<OmLine>) {
  const { id: _id, ...rest } = l as OmLine
  void _id
  return rest
}
export async function saveLine(l: OmLine) {
  if (l.id.startsWith('new')) {
    const r = await supabase.from('om_requirements').insert(row(l)).select('id').single()
    if (r.error) throw new Error(r.error.message)
    l.id = r.data.id
  } else await ok(supabase.from('om_requirements').update(row(l)).eq('id', l.id))
  return l.id
}
export async function deleteLines(ids: string[]) {
  if (ids.length) await ok(supabase.from('om_requirements').delete().in('id', ids))
}

// new lines for a group (names already in the group are skipped); returns how many were added
export async function addLines(job: Pick<Job, 'id' | 'pc_date'>, g: OmGroup, items: { name: string; doc_type_id?: string | null }[], existing: OmLine[]) {
  const here = existing.filter((l) => groupKeyOf(l) === g.key)
  const have = new Set(here.map((l) => (l.custom_name ?? '').trim().toLowerCase()))
  const fresh = items.filter((i) => i.name.trim() && !have.has(i.name.trim().toLowerCase()))
  if (!fresh.length) return 0
  const start = Math.max(0, ...existing.map((l) => l.sort)) + 1
  const due = defaultDue(job)
  await ok(
    supabase.from('om_requirements').insert(
      fresh.map((i, n) => ({
        job_id: job.id,
        order_id: g.orderId,
        company_id: g.kind === 'client' ? g.companyId : null,
        doc_type_id: i.doc_type_id ?? null,
        custom_name: i.name.trim(),
        status: 'not_requested',
        due_date: due,
        sort: start + n,
      })),
    ),
  )
  return fresh.length
}
export function standardFor(trade: string, types: OmDocType[]) {
  return types.filter((t) => t.trade === trade).map((t) => ({ name: t.name, doc_type_id: t.id }))
}

// ---------- client direct contractors and the project directory (job_directory) ----------
export async function addDirectoryEntry(e: Omit<DirectoryEntry, 'id'>) {
  const r = await supabase.from('job_directory').insert(e).select('*').single()
  if (r.error) throw new Error(r.error.message)
  return r.data as DirectoryEntry
}
export async function deleteDirectoryEntry(id: string) {
  await ok(supabase.from('job_directory').delete().eq('id', id))
}
// a client direct contractor and its O&M lines
export async function removeClientDirect(jobId: string, g: OmGroup) {
  if (g.companyId) await ok(supabase.from('om_requirements').delete().eq('job_id', jobId).eq('company_id', g.companyId).is('order_id', null))
  if (g.directoryId) await deleteDirectoryEntry(g.directoryId)
  else if (g.companyId) await ok(supabase.from('job_directory').delete().eq('job_id', jobId).eq('company_id', g.companyId).eq('client_direct', true))
}

// ---------- the file sections ----------
export async function saveOmJob(o: OmJob) {
  const { data: u } = await supabase.auth.getUser()
  const r = await supabase
    .from('om_job')
    .upsert({ job_id: o.job_id, description: o.description, risks: o.risks, handover: o.handover, updated_by: u.user?.id ?? null }, { onConflict: 'job_id' })
  if (r.error) throw new Error(/om_job/.test(r.error.message) ? 'The file sections need script 047 run in Supabase first (supabase/README.md).' : r.error.message)
}
export const blankRow = (cols: Col[]): Row => Object.fromEntries(cols.map((c) => [c.k, '']))
export const filledRows = (rows: Row[] | undefined) => (rows ?? []).filter((r) => Object.values(r).some((v) => String(v ?? '').trim()))

// ---------- the team (Overview › Team; the O&M reminders go to them) ----------
export interface TeamMember {
  profile_id: string
  role: string
  full_name: string | null
  email: string | null
  job_title: string | null
}
export async function loadTeam(jobId: string): Promise<TeamMember[]> {
  const rows = await cached(`job-team:${jobId}`, () => must<{ profile_id: string; role: string }[]>(supabase.from('job_team').select('profile_id,role').eq('job_id', jobId)))
  if (!rows.length) return []
  const people = await cached('profiles-basic', () =>
    must<{ id: string; full_name: string | null; email: string | null; job_title: string | null }[]>(
      supabase.from('profiles').select('id,full_name,email,job_title').order('full_name'),
    ),
  )
  return rows.map((r) => {
    const p = people.find((x) => x.id === r.profile_id)
    return { ...r, full_name: p?.full_name ?? null, email: p?.email ?? null, job_title: p?.job_title ?? null }
  })
}

// ---------- the project directory (for the tab and the PDF) ----------
export interface DirRow {
  role: string
  company: string
  contact: string
  phone: string
  email: string
  address: string
  source: 'dbp' | 'client' | 'directory' | 'order' | 'client_direct'
  directoryId?: string
}
export function buildDirectory(job: Job, d: OmData): DirRow[] {
  const co = (id: string | null) => d.companies.find((c) => c.id === id) ?? null
  const ct = (id: string | null) => d.contacts.find((c) => c.id === id) ?? null
  const firstContact = (companyId: string | null) => d.contacts.find((c) => c.company_id === companyId && c.email) ?? d.contacts.find((c) => c.company_id === companyId) ?? null
  const addr = (c: Company | null) => [c?.address, c?.postcode].filter(Boolean).join('\n')
  const out: DirRow[] = []
  const client = co(job.client_company_id)
  if (client) {
    const c = ct(job.client_contact_id) ?? firstContact(client.id)
    out.push({
      role: 'Client',
      company: client.name,
      contact: c?.name ?? '',
      phone: c?.phone || client.phone || '',
      email: c?.email || client.email || '',
      address: addr(client),
      source: 'client',
    })
  }
  for (const e of d.directory.filter((x) => !x.client_direct)) {
    const c = co(e.company_id)
    const p = ct(e.contact_id)
    out.push({
      role: e.role,
      company: c?.name ?? '',
      contact: p?.name ?? '',
      phone: p?.phone || c?.phone || '',
      email: p?.email || c?.email || '',
      address: addr(c),
      source: 'directory',
      directoryId: e.id,
    })
  }
  if (d.settings) {
    const pm = d.team.filter((t) => /pm|project manager/i.test(t.role))
    const lead = pm[0] ?? d.team[0]
    out.push({
      role: 'Main contractor',
      company: d.settings.legal_name,
      contact: d.team.length ? d.team.map((t) => `${t.full_name ?? t.email ?? ''} (${t.role})`).join(', ') : '',
      phone: d.settings.phone ?? '',
      email: lead?.email || d.settings.email || '',
      address: d.settings.address ?? '',
      source: 'dbp',
    })
  }
  for (const g of buildGroups(d)) {
    if (g.kind === 'job' || !g.company) continue
    const c = firstContact(g.company.id)
    out.push({
      role: g.kind === 'order' ? g.subtitle.replace(/^\d+ · /, '') || 'Subcontractor' : g.subtitle,
      company: g.company.name,
      contact: c?.name ?? '',
      phone: c?.phone || g.company.phone || '',
      email: c?.email || g.company.email || '',
      address: addr(g.company),
      source: g.kind === 'order' ? 'order' : 'client_direct',
    })
  }
  return out
}

// ---------- chasing ----------
// who to chase: the first contact with an email at the company, else the company's own email
export function chaseTo(g: OmGroup, contacts: Contact[]) {
  if (!g.company) return null
  const c = contacts.find((x) => x.company_id === g.company!.id && x.email)
  return { email: c?.email || g.company.email || null, name: c?.name ?? null }
}
// a draft email (nothing is sent from the app)
export function chaseMailto(job: Pick<Job, 'job_no' | 'code' | 'name' | 'pc_date'>, g: OmGroup, lines: OmLine[], contacts: Contact[], types: OmDocType[] = []) {
  const to = chaseTo(g, contacts)
  const owed = lines.filter(isOutstanding)
  const today = todayIso()
  const body = [
    `Dear ${to?.name?.split(' ')[0] || 'Sir / Madam'},`,
    '',
    `${job.job_no} ${job.code} ${job.name}: O&M documents`,
    '',
    `Please send the following O&M documents for ${g.subtitle.replace(/^\d+ · /, '') || 'your package'}${job.pc_date ? ` (practical completion ${ukDate(job.pc_date)})` : ''}:`,
    '',
    ...owed.map(
      (l) =>
        `- ${lineName(l, types)}${l.due_date ? `: due ${ukDate(l.due_date)}${l.due_date < today ? ' (overdue)' : ''}` : ''}${l.status === 'rejected_resubmit' ? ` – resubmit${l.reviewer_comment ? `: ${l.reviewer_comment}` : ''}` : ''}`,
    ),
    '',
    'PDFs please, one file per document, named as above.',
    '',
    'Many thanks,',
  ].join('\n')
  return `mailto:${to?.email ?? ''}?subject=${encodeURIComponent(`${job.job_no} ${job.code} ${job.name}: O&M documents outstanding`)}&body=${encodeURIComponent(body)}`
}

// ---------- payment notices: "O&Ms outstanding" for one order (nothing is blocked) ----------
export async function loadOutstandingOm(jobId: string, orderId: string) {
  const lines = await must<OmLine[]>(
    supabase.from('om_requirements').select('*').eq('job_id', jobId).eq('order_id', orderId).in('status', ['not_requested', 'requested', 'rejected_resubmit']).order('sort'),
  )
  const missing = [...new Set(lines.filter((l) => !l.custom_name && l.doc_type_id).map((l) => l.doc_type_id!))]
  const types = missing.length ? await must<OmDocType[]>(supabase.from('om_doc_types').select('*').in('id', missing)) : []
  const today = todayIso()
  return lines.map((l) => ({ id: l.id, name: lineName(l, types), status: l.status, due_date: l.due_date, overdue: isOverdue(l, today) }))
}

// ---------- matching the files chosen from the synced SharePoint folder to the tracker ----------
export interface FileMatch {
  file: File
  lineId: string | null // null: "Other documents"
  skip: boolean
  how: 'link' | 'name' | 'none'
  kind: 'pdf' | 'image' | 'other'
}
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, '')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !['the', 'and', 'of', 'for', 'ltd', 'limited', 'om', 'rev', 'pdf'].includes(w))
// the file name in a SharePoint link, if it shows one (sharing links don't)
export function linkFileName(url: string | null) {
  if (!url) return null
  try {
    const u = new URL(url)
    const id = u.searchParams.get('id') || u.searchParams.get('file')
    const last = decodeURIComponent((id ?? u.pathname).split('/').pop() ?? '')
    return /\.[a-z0-9]{2,4}$/i.test(last) ? last.toLowerCase() : null
  } catch {
    return null
  }
}
export const fileKind = (f: File): FileMatch['kind'] =>
  /\.pdf$/i.test(f.name) || f.type === 'application/pdf' ? 'pdf' : /\.(jpe?g|png)$/i.test(f.name) || /^image\/(jpeg|png)$/.test(f.type) ? 'image' : 'other'

export function matchFiles(files: File[], lines: OmLine[], groups: OmGroup[], types: OmDocType[] = []): FileMatch[] {
  const cands = lines
    .filter((l) => l.status !== 'not_required')
    .map((l) => {
      const g = groups.find((x) => x.key === groupKeyOf(l))
      return { l, link: linkFileName(l.file_url), doc: words(lineName(l, types)), co: words(g?.company?.name ?? '') }
    })
  return files.map((file) => {
    const kind = fileKind(file)
    const name = file.name.toLowerCase()
    const byLink = cands.find((c) => c.link === name)
    if (byLink) return { file, lineId: byLink.l.id, skip: kind === 'other', how: 'link', kind }
    const fw = new Set(words(file.name))
    let best: { id: string; score: number } | null = null
    for (const c of cands) {
      if (!c.doc.length) continue
      const docHit = c.doc.filter((w) => fw.has(w) || [...fw].some((x) => x.length > 4 && (x.startsWith(w) || w.startsWith(x)))).length / c.doc.length
      const coHit = c.co.length ? c.co.filter((w) => fw.has(w)).length / c.co.length : 0
      const score = docHit + 0.35 * coHit
      if (docHit >= 0.5 && (!best || score > best.score)) best = { id: c.l.id, score }
    }
    return { file, lineId: best?.id ?? null, skip: kind === 'other', how: best ? 'name' : 'none', kind }
  })
}

// ---------- can anyone open the SharePoint link? (23 Nov, script 048 + the check-link Edge Function) ----------
export type LinkStatus = 'public' | 'sign_in' | 'broken' | 'unknown'
export const LINK_STATUS_TEXT: Record<LinkStatus, string> = {
  public: 'Anyone with the link can open it',
  sign_in: 'Needs a DBP sign-in: in SharePoint, share it as “Anyone with the link”',
  broken: 'This link doesn’t open a document',
  unknown: 'Couldn’t check this link',
}
// opens the link from the server with no sign-in (as the client would) and keeps the answer against the line
export async function checkLink(l: Pick<OmLine, 'id' | 'file_url'>): Promise<{ status: LinkStatus; detail: string } | null> {
  if (!l.file_url || !navigator.onLine) return null
  const { data, error } = await supabase.functions.invoke('check-link', { body: { url: l.file_url } })
  if (error || !data?.status) return null // not deployed yet: no tick either way
  const status = data.status as LinkStatus
  await supabase.from('om_requirements').update({ link_status: status, link_checked_url: l.file_url, link_checked_at: new Date().toISOString() }).eq('id', l.id)
  return { status, detail: String(data.detail ?? '') }
}
