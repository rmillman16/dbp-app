// Contractors' PQQs (23 Nov, script 054): status per company, approved for 12 months, their documents with
// expiry dates, a log of what was sent to whom and when, and the standard PQQ pack (Settings › Standard
// documents). An order to anyone not currently approved takes the PQQ pack with it. Reminders to chase go on
// the "PQQ chased by" person's bell (the database does them).
import { supabase } from './supabase'
import { addDaysIso, todayIso, ukDate } from './format'
import { emlDraft, escHtml, fileBlob, loadLibrary, needs054, uploadFile, type Attachment, type StandardDoc } from './orders'
import type { Company, PqqPack, PqqStatus } from './types'

const fail = (e: { message: string }) => new Error(needs054(e.message))

export const PQQ_LABELS: Record<PqqStatus, string> = {
  not_sent: 'Not sent',
  sent: 'Sent',
  received: 'Back, to review',
  approved: 'Approved',
  rejected: 'Rejected',
  not_required: 'Not required',
}

// where a company stands today: approved and in date counts; approved but past 12 months has lapsed
export type PqqState = 'approved' | 'expiring' | 'expired' | 'sent' | 'received' | 'rejected' | 'not_sent' | 'not_required'
export const STATE_LABELS: Record<PqqState, string> = {
  approved: 'Approved',
  expiring: 'Approved, expiring',
  expired: 'Expired',
  sent: 'Sent',
  received: 'Back, to review',
  rejected: 'Rejected',
  not_sent: 'Not sent',
  not_required: 'Not required',
}
export function pqqState(c: Pick<Company, 'pqq_status' | 'pqq_expires_on'>, today = todayIso()): PqqState {
  const s = c.pqq_status ?? 'not_sent'
  if (s !== 'approved') return s
  if (c.pqq_expires_on && c.pqq_expires_on < today) return 'expired'
  if (c.pqq_expires_on && c.pqq_expires_on <= addDaysIso(today, 30)) return 'expiring'
  return 'approved'
}
// an order to them should take the PQQ pack
export const needsPqq = (c: Pick<Company, 'pqq_status' | 'pqq_expires_on'>) => !['approved', 'expiring', 'not_required'].includes(pqqState(c))
export const stateClass = (s: PqqState) => (s === 'approved' || s === 'not_required' ? 'ok' : s === 'expired' || s === 'rejected' ? 'bad' : s === 'not_sent' ? '' : 'warn')

// ---------- their documents ----------
export type DocKind = 'pqq_return' | 'insurance_el' | 'insurance_pl' | 'insurance_car' | 'insurance_pi' | 'accreditation' | 'health_safety' | 'other'
export const DOC_KINDS: [DocKind, string][] = [
  ['pqq_return', 'Completed PQQ'],
  ['insurance_el', "Employer's liability insurance"],
  ['insurance_pl', 'Public liability insurance'],
  ['insurance_car', 'Contractors all risks insurance'],
  ['insurance_pi', 'Professional indemnity insurance'],
  ['accreditation', 'Accreditation (CHAS, SMAS, Constructionline…)'],
  ['health_safety', 'Health and safety policy'],
  ['other', 'Other'],
]
export interface CompanyDoc {
  id: string
  company_id: string
  kind: DocKind
  name: string
  expires_on: string | null
  path: string | null
  file_name: string | null
  created_at: string
}
export async function loadCompanyDocs(companyId?: string): Promise<CompanyDoc[]> {
  let q = supabase.from('company_documents').select('*')
  if (companyId) q = q.eq('company_id', companyId)
  const r = await q.order('expires_on', { nullsFirst: false })
  if (r.error) throw fail(r.error)
  return r.data as CompanyDoc[]
}
export async function addCompanyDoc(companyId: string, d: { kind: DocKind; name: string; expires_on: string | null }, file: File | null) {
  const path = file ? await uploadFile(`company/${companyId}`, file) : null
  const r = await supabase
    .from('company_documents')
    .insert({ company_id: companyId, kind: d.kind, name: d.name.trim() || DOC_KINDS.find(([k]) => k === d.kind)![1], expires_on: d.expires_on, path, file_name: file?.name ?? null })
    .select('*')
    .single()
  if (r.error) throw fail(r.error)
  return r.data as CompanyDoc
}
export async function updateCompanyDoc(id: string, patch: Partial<Pick<CompanyDoc, 'name' | 'kind' | 'expires_on'>>) {
  const r = await supabase.from('company_documents').update(patch).eq('id', id)
  if (r.error) throw fail(r.error)
}
export async function removeCompanyDoc(d: CompanyDoc) {
  const r = await supabase.from('company_documents').delete().eq('id', d.id)
  if (r.error) throw fail(r.error)
  if (d.path) await supabase.storage.from('orders').remove([d.path])
}
export const docExpiry = (d: Pick<CompanyDoc, 'expires_on'>, today = todayIso()) =>
  !d.expires_on ? null : d.expires_on < today ? 'expired' : d.expires_on <= addDaysIso(today, 30) ? 'expiring' : 'ok'

// ---------- PQQ details ----------
export type PqqPatch = Partial<Pick<Company, 'pqq_status' | 'pqq_sent_on' | 'pqq_received_on' | 'pqq_approved_on' | 'pqq_expires_on' | 'pqq_owner' | 'pqq_notes'>>
export async function savePqq(companyId: string, patch: PqqPatch) {
  const r = await supabase.from('companies').update(patch).eq('id', companyId).select('*').single()
  if (r.error) throw fail(r.error)
  return r.data as Company
}

// ---------- what was sent to whom and when ----------
export interface PqqLogRow {
  id: string
  company_id: string
  order_id: string | null
  via: 'pqq' | 'order' | 'reminder'
  sent_to: string | null
  documents: string[]
  note: string | null
  sent_by: string | null
  sent_at: string
}
export async function loadPqqLog(companyId: string): Promise<PqqLogRow[]> {
  const r = await supabase.from('pqq_log').select('*').eq('company_id', companyId).order('sent_at', { ascending: false })
  if (r.error) throw fail(r.error)
  return r.data as PqqLogRow[]
}
export async function logPqqSent(row: { company_id: string; order_id?: string | null; via: PqqLogRow['via']; sent_to: string | null; documents: string[]; note?: string | null }) {
  const r = await supabase.from('pqq_log').insert(row)
  if (r.error) throw fail(r.error)
}
// sending the PQQ pack marks them "sent" (unless they're further on) and logs it
export async function pqqWentOut(c: Company, sentTo: string | null, documents: string[], orderId: string | null) {
  await logPqqSent({ company_id: c.id, order_id: orderId, via: orderId ? 'order' : 'pqq', sent_to: sentTo, documents })
  const s = pqqState(c)
  if (['not_sent', 'expired', 'rejected'].includes(s)) return savePqq(c.id, { pqq_status: 'sent', pqq_sent_on: todayIso(), pqq_received_on: null, pqq_approved_on: null, pqq_expires_on: null })
  return c
}

// ---------- the standard PQQ pack ----------
export const loadPqqPack = (): Promise<StandardDoc[]> => loadLibrary('pqq')

// which form a company gets: set on the company, else by type (sole traders are set to PQQ B by hand)
export const PACK_LABELS: Record<PqqPack, string> = {
  subcontractor: 'PQQ (subcontractor)',
  sole_trader: 'PQQ B (sole trader / small subcontractor)',
  consultant: 'PQQ C (consultant)',
  supplier: 'New supplier account form',
}
export const packOf = (c: Pick<Company, 'type' | 'pqq_pack'>): PqqPack =>
  c.pqq_pack ?? (c.type === 'supplier' ? 'supplier' : c.type === 'consultant' || c.type === 'designer' ? 'consultant' : 'subcontractor')
// the library documents that go to this company: its form, and anything not tied to a form
export const packFor = (c: Pick<Company, 'type' | 'pqq_pack'>, all: StandardDoc[]) => all.filter((d) => !d.pack || d.pack === packOf(c))
export async function pqqPackFiles(pack?: StandardDoc[]): Promise<Attachment[]> {
  const docs = pack ?? (await loadPqqPack())
  return Promise.all(docs.map(async (d) => ({ name: d.file_name, blob: await fileBlob(d.path) })))
}

export const pqqParagraph = (c: Pick<Company, 'pqq_status' | 'pqq_expires_on' | 'type' | 'pqq_pack'>) =>
  packOf(c) === 'supplier'
    ? 'Please complete and return the attached new supplier account form so we can set up your account.'
    : pqqState(c) === 'expired'
    ? 'Your pre-qualification with us has lapsed (it runs for 12 months). Please complete and return the attached pre-qualification questionnaire (PQQ), with the documents it asks for, so we can renew it.'
    : 'As you are not yet on our approved list, please complete and return the attached pre-qualification questionnaire (PQQ), with the documents it asks for.'

// an email with just the PQQ pack (from Contractors), as an Outlook draft
export async function pqqEmail(c: Company, to: { name: string | null; email: string | null }, sender: string | null) {
  const pack = packFor(c, await loadPqqPack())
  if (!pack.length) throw new Error(`There is no ${PACK_LABELS[packOf(c)]} in the library yet: add it in Settings › Standard documents.`)
  const greeting = to.name ? `Dear ${escHtml(to.name.split(' ')[0])},` : 'Dear Sir or Madam,'
  const html = [
    `<p>${greeting}</p>`,
    `<p>${escHtml(pqqParagraph(c))}</p>`,
    `<p>Attached: ${pack.map((d) => escHtml(d.name)).join('; ')}.</p>`,
    '<p>Kind regards,</p>',
    `<p>${escHtml(sender ?? '')}<br>du Boulay Projects Limited</p>`,
  ].join('')
  const eml = await emlDraft({ to: to.email ? [to.email] : [], subject: `du Boulay Projects: pre-qualification questionnaire – ${c.name}`, html, attachments: await pqqPackFiles(pack) })
  return { eml, documents: pack.map((d) => d.name) }
}

export const lastSentText = (log: PqqLogRow[]) => (log[0] ? `Last sent ${ukDate(log[0].sent_at.slice(0, 10))}${log[0].sent_to ? ' to ' + log[0].sent_to : ''}` : 'Never sent')
