// The O&M manual (scripts 047–050): a tracker of the items each package owes for the client's O&M
// manual, the file sections typed per job (description of works, residual risks, handover document)
// and the project directory. Groups: one per package of the job's SoW / procurement schedule (with its
// appointed subcontractor when known), one per client direct contractor (job_directory, client_direct
// ticked) and General / packs (the job's own items, no package).
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
  package_id?: string | null // the SoW package it belongs to (script 050)
  order_id: string | null // an order with no package (lines made before 050)
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
  'Collateral warranties',
  'Client-specific requirements',
]

export const isOutstanding = (l: Pick<OmLine, 'status'>) => l.status === 'not_requested' || l.status === 'requested' || l.status === 'rejected_resubmit'
export const isOverdue = (l: Pick<OmLine, 'status' | 'due_date'>, today = todayIso()) => isOutstanding(l) && !!l.due_date && l.due_date < today
// due by default 4 weeks before PC; no PC, no date
export const defaultDue = (job: Pick<Job, 'pc_date'>) => (job.pc_date ? addDaysIso(job.pc_date, -28) : null)
export const lineName = (l: Pick<OmLine, 'custom_name' | 'doc_type_id'>, types: OmDocType[] = []) => l.custom_name || types.find((t) => t.id === l.doc_type_id)?.name || 'Document'

export interface OmData {
  lines: OmLine[]
  docTypes: OmDocType[]
  orders: Order[]
  packages: OmPackage[]
  procItems: ProcLink[] // the procurement schedule's package rows: subcontractor, display name
  companies: Company[]
  contacts: Contact[]
  directory: DirectoryEntry[]
  omJob: OmJob
  settings: CompanySettings | null
  team: { profile_id: string; role: string; full_name: string | null; email: string | null; job_title: string | null }[]
  itemNames: string[] // project items people have added to the list (script 049)
}

// ---------- what's received (23 Nov, Richard: "just the item and its contents") ----------
// A line is an item and its contents (the SharePoint link): received = it has a link. The status in the database
// follows the link (here and by a trigger in script 050), so reminders, payment notices and the PDF keep working.
// Removing an item marks it not required (admins and Operations only, script 050): it's hidden, and the draft
// pack doesn't bring it back.
export const isRemoved = (l: Pick<OmLine, 'status'>) => l.status === 'not_required'
export const isReceived = (l: Pick<OmLine, 'status' | 'file_url'>) => !isRemoved(l) && !!l.file_url?.trim()
export const isMissing = (l: Pick<OmLine, 'status' | 'file_url'>) => !isRemoved(l) && !l.file_url?.trim()
// the status that goes with a link being set or cleared
export function withLink(l: OmLine, url: string | null): Partial<OmLine> {
  if (isRemoved(l)) return { file_url: url }
  return url
    ? { file_url: url, status: l.status === 'accepted' ? 'accepted' : 'received', received_date: l.received_date ?? todayIso() }
    : { file_url: null, status: l.requested_date ? 'requested' : 'not_requested', received_date: null }
}

// ---------- groups: the job's packages (from the SoW / procurement schedule), client direct contractors, General ----------
export type GroupKind = 'package' | 'order' | 'client' | 'job'
export interface OmGroup {
  key: string // p:<package id> · o:<order id> (an order with no package) · c:<company id> · job
  kind: GroupKind
  packageId: string | null
  orderId: string | null
  companyId: string | null
  company: Company | null // the appointed subcontractor / client direct contractor, when known
  title: string // the package (or the company for client direct; "General / packs")
  subtitle: string // the subcontractor, or what it is
  label: string // for the PDF and directory: "Electrical (Acme Ltd)"
  directoryId: string | null // client direct: its job_directory row
}
export interface OmPackage {
  id: string
  name: string
  kind: string
  is_remainder: boolean
  budget: number | null
  sort: number
}
export interface ProcLink {
  id: string
  description: string
  display_name: string | null
  package_id: string | null
  order_id: string | null
  company_id: string | null
}
type GroupData = Pick<OmData, 'lines' | 'orders' | 'packages' | 'procItems' | 'companies' | 'directory'>

// an order's package (orders made before the package link: none)
const orderPackage = (orderId: string | null, orders: Order[]) => orders.find((o) => o.id === orderId)?.package_id ?? null
export function groupKeyOf(l: Pick<OmLine, 'order_id' | 'company_id'> & { package_id?: string | null }, orders: Order[] = []) {
  const pkg = l.package_id ?? orderPackage(l.order_id, orders)
  return pkg ? `p:${pkg}` : l.order_id ? `o:${l.order_id}` : l.company_id ? `c:${l.company_id}` : 'job'
}
// the package's procurement row (by its link, else by the SoW name it's saved under)
const procFor = (p: OmPackage, items: ProcLink[]) => items.find((i) => i.package_id === p.id) ?? items.find((i) => i.description === p.name) ?? null
// the appointed subcontractor of a package: its order, else the procurement schedule's order / company
export function packageCompany(p: OmPackage, d: Pick<OmData, 'orders' | 'procItems' | 'companies'>) {
  const pi = procFor(p, d.procItems)
  const order = d.orders.find((o) => o.package_id === p.id) ?? d.orders.find((o) => o.id === pi?.order_id) ?? null
  const id = order?.company_id ?? pi?.company_id ?? null
  return { company: d.companies.find((c) => c.id === id) ?? null, orderId: order?.id ?? null }
}
// the packages O&M is asked of: costed SoW packages (not prelims, omissions or EP), plus any with O&M lines
export function omPackages(d: Pick<OmData, 'packages' | 'procItems' | 'lines' | 'orders'>) {
  const used = new Set(d.lines.map((l) => groupKeyOf(l, d.orders)))
  return d.packages
    .filter((p) => used.has(`p:${p.id}`) || (p.kind === 'cost' && !p.is_remainder && (Number(p.budget ?? 0) > 0 || !!procFor(p, d.procItems))))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'en-GB'))
}

export function buildGroups(d: GroupData): OmGroup[] {
  const co = (id: string | null) => d.companies.find((c) => c.id === id) ?? null
  const out: OmGroup[] = omPackages(d).map((p) => {
    const { company, orderId } = packageCompany(p, d)
    const title = procFor(p, d.procItems)?.display_name || p.name
    return {
      key: `p:${p.id}`,
      kind: 'package',
      packageId: p.id,
      orderId,
      companyId: company?.id ?? null,
      company,
      title,
      subtitle: company?.name ?? 'No subcontractor yet',
      label: company ? `${title} (${company.name})` : title,
      directoryId: null,
    }
  })
  // lines under an order with no package (made before packages were linked)
  for (const l of d.lines) {
    const key = groupKeyOf(l, d.orders)
    if (!key.startsWith('o:') || out.some((g) => g.key === key)) continue
    const o = d.orders.find((x) => x.id === l.order_id)
    const c = co(o?.company_id ?? null)
    const title = o?.trade || c?.name || 'Order'
    out.push({
      key,
      kind: 'order',
      packageId: null,
      orderId: l.order_id,
      companyId: c?.id ?? null,
      company: c,
      title,
      subtitle: c?.name ?? '',
      label: c && title !== c.name ? `${title} (${c.name})` : title,
      directoryId: null,
    })
  }
  const clients = new Map<string, OmGroup>()
  const client = (companyId: string, role: string | null, directoryId: string | null): OmGroup => {
    const c = co(companyId)
    const name = c?.name ?? 'Client direct contractor'
    return {
      key: `c:${companyId}`,
      kind: 'client',
      packageId: null,
      orderId: null,
      companyId,
      company: c,
      title: name,
      subtitle: `${role || 'Client direct'} · client direct`,
      label: `${name} (${role ? `${role}, ` : ''}client direct)`,
      directoryId,
    }
  }
  for (const e of d.directory.filter((x) => x.client_direct && x.company_id)) if (!clients.has(e.company_id!)) clients.set(e.company_id!, client(e.company_id!, e.role, e.id))
  // lines for a company that's no longer listed as client direct still show
  for (const l of d.lines) if (groupKeyOf(l, d.orders) === `c:${l.company_id}` && !clients.has(l.company_id!)) clients.set(l.company_id!, client(l.company_id!, null, null))
  return [
    ...out,
    ...[...clients.values()].sort((a, b) => a.title.localeCompare(b.title, 'en-GB')),
    {
      key: 'job',
      kind: 'job',
      packageId: null,
      orderId: null,
      companyId: null,
      company: null,
      title: 'General / packs',
      subtitle: 'Not tied to a package',
      label: 'General / packs',
      directoryId: null,
    },
  ]
}
// the standard list's trade that best fits a group (its package name, the subcontractor's trade)
export function suggestTrade(g: OmGroup, trades: string[], orders: Order[]) {
  const hay = `${g.title} ${orders.find((o) => o.id === g.orderId)?.trade ?? ''} ${g.company?.trade ?? ''}`.toLowerCase()
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
// where a line goes when it's put in a group
export function groupFields(g: OmGroup): Pick<OmLine, 'package_id' | 'order_id' | 'company_id'> {
  if (g.kind === 'package') return { package_id: g.packageId, order_id: null, company_id: null }
  if (g.kind === 'order') return { package_id: null, order_id: g.orderId, company_id: null }
  if (g.kind === 'client') return { package_id: null, order_id: null, company_id: g.companyId }
  return { package_id: null, order_id: null, company_id: null }
}

// ---------- the draft pack: a starting list from the SoW / procurement schedule ----------
// a package whose trade has no standard documents gets these
export const GENERIC_PACKAGE_DOCS = ['O&M manual', 'Warranty', 'Test certificates', 'As-built drawings']
export const DEFAULT_GENERAL = [
  'Building control completion certificate',
  'Regulation 38 fire safety information pack',
  'Health & safety file',
  'Fire strategy',
  'As-built general arrangement drawings',
  'Maintenance instructions',
  'Collateral warranties',
]
export interface DraftPlan {
  g: OmGroup
  items: { name: string; doc_type_id: string | null }[]
  trade: string | null // the standard list's trade used (null: the generic set / General)
}
// what "Build a draft pack" would add: per package, its trade's standard documents (or the generic set); for
// General, the default packs. Never anything already there in any state, so removed items stay removed, and a
// package (or General) whose items were all removed is left alone. Re-run after the SoW changes to add what's missing.
export function draftPlan(d: OmData, groups: OmGroup[]): DraftPlan[] {
  const trades = [...new Set(d.docTypes.map((t) => t.trade))]
  const out: DraftPlan[] = []
  for (const g of groups) {
    if (g.kind !== 'package' && g.kind !== 'job') continue
    const here = d.lines.filter((l) => groupKeyOf(l, d.orders) === g.key)
    if (here.length && here.every(isRemoved)) continue
    const have = new Set(here.map((l) => lineName(l, d.docTypes).trim().toLowerCase()))
    const trade = g.kind === 'package' ? suggestTrade(g, trades, d.orders) : null
    const std = trade ? standardFor(trade, d.docTypes) : []
    const wanted =
      g.kind === 'job' ? DEFAULT_GENERAL.map((name) => ({ name, doc_type_id: null })) : std.length ? std : GENERIC_PACKAGE_DOCS.map((name) => ({ name, doc_type_id: null }))
    const items = wanted.filter((i) => !have.has(i.name.trim().toLowerCase()))
    if (items.length) out.push({ g, items, trade: std.length ? trade : null })
  }
  return out
}
export async function applyDraft(job: Pick<Job, 'id' | 'pc_date'>, plan: DraftPlan[], existing: OmLine[]) {
  let sort = Math.max(0, ...existing.map((l) => l.sort)) + 1
  const due = defaultDue(job)
  const rows = plan.flatMap((p) =>
    p.items.map((i) => ({ job_id: job.id, ...groupFields(p.g), doc_type_id: i.doc_type_id, custom_name: i.name, status: 'not_requested', due_date: due, sort: sort++ })),
  )
  if (rows.length) {
    const r = await supabase.from('om_requirements').insert(rows)
    if (r.error) throw new Error(/package_id/.test(r.error.message) ? 'The draft pack needs script 050 run in Supabase first.' : r.error.message)
  }
  return rows.length
}

// ---------- loading ----------
const emptyOmJob = (jobId: string): OmJob => ({ job_id: jobId, description: null, risks: [], handover: {} })

export async function loadOm(job: Pick<Job, 'id'>): Promise<OmData> {
  const jobId = job.id
  const [lines, docTypes, orders, packages, procItems, companies, contacts, directory, omJob, settings, team, itemNames] = await Promise.all([
    cached(`om:${jobId}`, () => must<OmLine[]>(supabase.from('om_requirements').select('*').eq('job_id', jobId).order('sort').order('id'))),
    cached('om-doc-types', () => must<OmDocType[]>(supabase.from('om_doc_types').select('*').is('job_id', null).order('trade').order('name'))).catch(() => [] as OmDocType[]),
    loadOrders(jobId).catch(() => [] as Order[]), // orders follow Job › Commercial
    cached(`om-packages:${jobId}`, () => must<OmPackage[]>(supabase.from('packages').select('id,name,kind,is_remainder,budget,sort').eq('job_id', jobId).order('sort'))).catch(
      () => [] as OmPackage[],
    ),
    cached(`om-procurement:${jobId}`, () =>
      must<ProcLink[]>(supabase.from('procurement_items').select('id,description,display_name,package_id,order_id,company_id').eq('job_id', jobId).eq('section', 'contract')),
    ).catch(() => [] as ProcLink[]), // follows Job › Procurement
    loadCompanies().catch(() => [] as Company[]),
    cached('contacts', () => must<Contact[]>(supabase.from('contacts').select('*').order('name'))).catch(() => [] as Contact[]),
    cached(`job-directory:${jobId}`, () => must<DirectoryEntry[]>(supabase.from('job_directory').select('*').eq('job_id', jobId))).catch(() => [] as DirectoryEntry[]),
    cached(`om-job:${jobId}`, () => must<OmJob | null>(supabase.from('om_job').select('*').eq('job_id', jobId).maybeSingle())).catch(() => null), // before 047: nothing
    cached('company-settings', () => must<CompanySettings>(supabase.from('company_settings').select('*').eq('id', 1).single())).catch(() => null),
    loadTeam(jobId).catch(() => []),
    cached('om-item-names', () => must<{ name: string }[]>(supabase.from('om_item_names').select('name').order('name'))).catch(() => [] as { name: string }[]), // before 049: none
  ])
  const oj = omJob ?? emptyOmJob(jobId)
  return {
    lines,
    docTypes,
    orders,
    packages,
    procItems,
    companies,
    contacts,
    directory,
    omJob: { ...oj, risks: Array.isArray(oj.risks) ? oj.risks : [], handover: oj.handover && typeof oj.handover === 'object' ? oj.handover : {} },
    settings,
    team,
    itemNames: itemNames.map((r) => r.name),
  }
}

// add a project item to the list for every job (script 049); already there is fine
export async function addItemName(name: string) {
  const r = await supabase.from('om_item_names').insert({ name: name.trim() })
  if (r.error && !/duplicate|unique/i.test(r.error.message))
    throw new Error(/relation|schema cache|does not exist/i.test(r.error.message) ? 'Adding to the list needs script 049 run in Supabase first.' : r.error.message)
}

// ---------- saving document lines ----------
const ok = async (p: PromiseLike<{ error: { message: string } | null }>) => {
  const r = await p
  if (r.error) throw new Error(r.error.message)
}
// the remove rule (script 050) in plain words
const removeError = (m: string) => (/admins and operations/i.test(m) ? 'Only admins and Operations can remove O&M items (or bring them back).' : m)
function row(l: Partial<OmLine>) {
  const { id: _id, ...rest } = l as OmLine
  void _id
  if (rest.package_id === undefined) delete rest.package_id // before 050: no such column
  return rest
}
export async function saveLine(l: OmLine) {
  if (l.id.startsWith('new')) {
    const r = await supabase.from('om_requirements').insert(row(l)).select('id').single()
    if (r.error) throw new Error(removeError(r.error.message))
    l.id = r.data.id
  } else {
    const r = await supabase.from('om_requirements').update(row(l)).eq('id', l.id)
    if (r.error) throw new Error(/package_id/.test(r.error.message) ? 'Linking items to packages needs script 050 run in Supabase first.' : removeError(r.error.message))
  }
  return l.id
}
// removed = not required on this job: kept but hidden, and the draft pack won't add it again
export async function setRemoved(ids: string[], removed: boolean) {
  if (!ids.length) return
  const r = await supabase
    .from('om_requirements')
    .update({ status: removed ? 'not_required' : 'not_requested' })
    .in('id', ids)
  if (r.error) throw new Error(removeError(r.error.message))
}
// gone for good (from the removed list)
export async function deleteLines(ids: string[]) {
  if (!ids.length) return
  const r = await supabase.from('om_requirements').delete().in('id', ids).select('id')
  if (r.error) throw new Error(removeError(r.error.message))
  if ((r.data ?? []).length < ids.length) throw new Error('Only admins and Operations can delete O&M items.')
}

// new lines for a group; names already in the group (in any state) are skipped. Returns how many were added
export async function addLines(job: Pick<Job, 'id' | 'pc_date'>, g: OmGroup, items: { name: string; doc_type_id?: string | null }[], existing: OmLine[], orders: Order[] = []) {
  const here = existing.filter((l) => groupKeyOf(l, orders) === g.key)
  const removed = here.filter(isRemoved).map((l) => (l.custom_name ?? '').trim().toLowerCase())
  const have = new Set(here.map((l) => (l.custom_name ?? '').trim().toLowerCase()))
  const fresh = items.filter((i) => i.name.trim() && !have.has(i.name.trim().toLowerCase()))
  if (!fresh.length) {
    if (items.length === 1 && removed.includes(items[0].name.trim().toLowerCase()))
      throw new Error(`“${items[0].name}” was removed from ${g.title}: show removed items to bring it back (admins and Operations).`)
    return 0
  }
  const start = Math.max(0, ...existing.map((l) => l.sort)) + 1
  const due = defaultDue(job)
  await ok(
    supabase.from('om_requirements').insert(
      fresh.map((i, n) => ({
        job_id: job.id,
        ...groupFields(g),
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
export async function removeClientDirect(jobId: string, g: OmGroup, lines: OmLine[]) {
  await setRemoved(
    lines.filter((l) => !isRemoved(l)).map((l) => l.id),
    true,
  )
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
      role: g.kind === 'client' ? g.subtitle : g.title,
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
// a draft email listing the missing items (nothing is sent from the app)
export function chaseMailto(job: Pick<Job, 'job_no' | 'code' | 'name' | 'pc_date'>, g: OmGroup, lines: OmLine[], contacts: Contact[], types: OmDocType[] = []) {
  const to = chaseTo(g, contacts)
  const owed = lines.filter(isMissing)
  const due = owed
    .map((l) => l.due_date)
    .filter((d): d is string => !!d)
    .sort()[0]
  const body = [
    `Dear ${to?.name?.split(' ')[0] || 'Sir / Madam'},`,
    '',
    `${job.job_no} ${job.code} ${job.name}: O&M information for ${g.kind === 'client' ? 'your works' : g.title}`,
    '',
    `We still need the following for the O&M manual${due ? `, by ${ukDate(due)}` : ''}${job.pc_date ? ` (practical completion ${ukDate(job.pc_date)})` : ''}:`,
    '',
    ...owed.map((l) => `- ${lineName(l, types)}`),
    '',
    'PDFs please, one file per item, named as above.',
    '',
    'Many thanks,',
  ].join('\n')
  return `mailto:${to?.email ?? ''}?subject=${encodeURIComponent(`${job.job_no} ${job.code} ${job.name}: O&M information outstanding`)}&body=${encodeURIComponent(body)}`
}

// ---------- payment notices: "O&Ms outstanding" for one order (nothing is blocked) ----------
export async function loadOutstandingOm(jobId: string, orderId: string) {
  // the order's packages: its own link, and the procurement schedule rows it's the order for (by link or SoW name)
  const [order, proc, pkgs] = await Promise.all([
    must<{ package_id: string | null } | null>(supabase.from('orders').select('package_id').eq('id', orderId).maybeSingle()).catch(() => null),
    must<{ package_id: string | null; description: string }[]>(
      supabase.from('procurement_items').select('package_id,description').eq('job_id', jobId).eq('order_id', orderId),
    ).catch(() => [] as { package_id: string | null; description: string }[]),
    must<{ id: string; name: string }[]>(supabase.from('packages').select('id,name').eq('job_id', jobId)).catch(() => [] as { id: string; name: string }[]),
  ])
  const ids = new Set<string>()
  if (order?.package_id) ids.add(order.package_id)
  for (const p of proc) {
    const id = p.package_id ?? pkgs.find((x) => x.name === p.description)?.id
    if (id) ids.add(id)
  }
  const outstanding = ['not_requested', 'requested', 'rejected_resubmit']
  const q = supabase.from('om_requirements').select('*').eq('job_id', jobId).in('status', outstanding)
  const lines = await must<OmLine[]>((ids.size ? q.or(`order_id.eq.${orderId},package_id.in.(${[...ids].join(',')})`) : q.eq('order_id', orderId)).order('sort')).catch(() =>
    // before 050 (no package_id): the order's own lines
    must<OmLine[]>(supabase.from('om_requirements').select('*').eq('job_id', jobId).eq('order_id', orderId).in('status', outstanding).order('sort')),
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

export function matchFiles(files: File[], lines: OmLine[], groups: OmGroup[], types: OmDocType[] = [], orders: Order[] = []): FileMatch[] {
  const cands = lines
    .filter((l) => l.status !== 'not_required')
    .map((l) => {
      const g = groups.find((x) => x.key === groupKeyOf(l, orders))
      return { l, link: linkFileName(l.file_url), doc: words(lineName(l, types)), co: words(`${g?.company?.name ?? ''} ${g?.kind === 'package' ? g.title : ''}`) }
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
