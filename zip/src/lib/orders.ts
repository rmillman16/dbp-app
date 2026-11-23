// Orders (23 Nov, script 054; was "Payment notices"): order numbers 2611_FISL_001, a package from the
// procurement schedule with its delivery / start date, appendices (any file, from the standard library in
// Settings or for this order only), the order itself as a Word letter on the letterhead, and the email to
// the subcontractor as an Outlook draft (.eml: opens in Outlook ready to send, with every file attached).
// Placing an order fills in the procurement schedule (the database does it).
import { supabase } from './supabase'
import { cached } from './offline'
import { money, todayIso } from './format'
import { letterDocx, longDate, ordinalDate, type Block } from './letter'
import { addProcPackage, loadProcurement, rowDates } from './procurement'
import type { Company, Job, Order, Profile } from './types'
import type { Contact } from '../components/ContactsEditor'

export const needs054 = (m: string) =>
  /package_name|delivery_date|placed_on|order_appendices|standard_documents|pqq|company_documents|cert_|bucket/i.test(m) && /schema cache|does not exist|not found|column/i.test(m)
    ? 'This needs script 054 run in Supabase first (supabase/README.md).'
    : m
const fail = (e: { message: string }) => new Error(needs054(e.message))

// ---------- order numbers: 2611_FISL_001 ----------
export function nextOrderNo(job: Pick<Job, 'job_no' | 'code'>, orders: Pick<Order, 'order_no'>[]) {
  const used = orders.map((o) => Number(/_(\d+)$/.exec(o.order_no ?? '')?.[1] ?? 0))
  const n = Math.max(orders.length, ...used, 0) + 1
  return `${job.job_no}_${job.code}_${String(n).padStart(3, '0')}`
}

// ---------- packages: the procurement schedule's, with delivery / start dates ----------
export interface OrderPackage {
  name: string // the procurement row's SoW name (what the order and schedule match on)
  label: string // as shown, e.g. "Electrical (install)"
  group: string
  budget: number
  delivery: string | null
  deliveryFrom: 'typed' | 'programme' | 'provisional' | null // typed in procurement / its linked activities / the programme's first matching activity
  ordered: boolean
}
export async function loadOrderPackages(job: Job): Promise<OrderPackage[]> {
  const p = await loadProcurement(job)
  const today = todayIso()
  return p.contract.map((r) => {
    const d = rowDates(r, p.tasks, today)
    return {
      name: r.description,
      label: r.label,
      group: r.group,
      budget: r.budget,
      delivery: d.onSite,
      deliveryFrom: d.from,
      ordered: ['ordered', 'on_site', 'complete'].includes(r.status),
    }
  })
}
export const DELIVERY_FROM: Record<string, string> = {
  typed: 'from the procurement schedule',
  programme: "from the package's programme activities",
  provisional: "the programme's first activity for this trade",
}
export async function addOrderPackage(jobId: string, name: string) {
  await addProcPackage(jobId, name.trim())
}

// ---------- placing ----------
export async function placeOrder(order: Order, me: string | null) {
  const r = await supabase
    .from('orders')
    .update({ status: 'placed', placed_on: todayIso(), placed_by: me, order_date: order.order_date ?? todayIso() })
    .eq('id', order.id)
    .select('*')
    .single()
  if (r.error) throw fail(r.error)
  return r.data as Order
}

// ---------- files (private storage area "orders") ----------
const safeName = (n: string) => n.replace(/[^\w.\- ()]+/g, '_')
export async function uploadFile(folder: string, file: File) {
  const path = `${folder}/${Date.now()}-${safeName(file.name)}`
  const up = await supabase.storage.from('orders').upload(path, file, { contentType: file.type || undefined })
  if (up.error) throw fail(up.error)
  return path
}
export async function fileUrl(path: string) {
  const r = await supabase.storage.from('orders').createSignedUrl(path, 3600)
  if (r.error || !r.data) throw new Error(r.error?.message ?? 'File not found')
  return r.data.signedUrl
}
export async function fileBlob(path: string) {
  const r = await supabase.storage.from('orders').download(path)
  if (r.error || !r.data) throw new Error(`Couldn't fetch ${path.split('/').pop()}: ${r.error?.message ?? 'not found'}`)
  return r.data
}
export async function openFile(path: string) {
  window.open(await fileUrl(path), '_blank', 'noopener')
}

// ---------- the standard library (Settings): appendices and the PQQ pack ----------
export interface StandardDoc {
  id: string
  kind: 'appendix' | 'pqq'
  name: string
  description: string | null
  path: string
  file_name: string
  default_on: boolean
  pack?: 'subcontractor' | 'sole_trader' | 'consultant' | 'supplier' | null // PQQ library: which form (055); blank = every form
  archived: boolean
  sort: number
}
export async function loadLibrary(kind?: StandardDoc['kind']): Promise<StandardDoc[]> {
  let q = supabase.from('standard_documents').select('*').eq('archived', false)
  if (kind) q = q.eq('kind', kind)
  const r = await q.order('sort').order('name')
  if (r.error) throw fail(r.error)
  return r.data as StandardDoc[]
}
export async function addLibraryDoc(kind: StandardDoc['kind'], name: string, file: File, defaultOn = true, pack: StandardDoc['pack'] = null) {
  const path = await uploadFile('library', file)
  const r = await supabase.from('standard_documents').insert({ kind, name: name.trim() || file.name, path, file_name: file.name, default_on: defaultOn, ...(pack ? { pack } : {}) }).select('*').single()
  if (r.error) throw fail(r.error)
  return r.data as StandardDoc
}
export async function updateLibraryDoc(id: string, patch: Partial<Pick<StandardDoc, 'name' | 'description' | 'default_on' | 'sort' | 'pack'>>) {
  const r = await supabase.from('standard_documents').update(patch).eq('id', id)
  if (r.error) throw fail(r.error)
}
// replace the file (a new version): orders already made keep the one they went out with
export async function replaceLibraryFile(doc: StandardDoc, file: File) {
  const path = await uploadFile('library', file)
  const r = await supabase.from('standard_documents').update({ path, file_name: file.name }).eq('id', doc.id)
  if (r.error) throw fail(r.error)
}
// removed from the library; the file stays for orders that used it
export async function archiveLibraryDoc(id: string) {
  const r = await supabase.from('standard_documents').update({ archived: true }).eq('id', id)
  if (r.error) throw fail(r.error)
}

// ---------- appendices on an order ----------
export interface Appendix {
  id: string
  order_id: string
  standard_id: string | null
  name: string
  path: string
  file_name: string
  sort: number
}
export function loadAppendices(orderId: string) {
  return cached(`appendices:${orderId}`, async () => {
    const r = await supabase.from('order_appendices').select('*').eq('order_id', orderId).order('sort').order('created_at')
    if (r.error) throw fail(r.error)
    return r.data as Appendix[]
  })
}
export async function addStandardAppendices(orderId: string, docs: StandardDoc[], startSort: number) {
  if (!docs.length) return [] as Appendix[]
  const r = await supabase
    .from('order_appendices')
    .insert(docs.map((d, i) => ({ order_id: orderId, standard_id: d.id, name: d.name, path: d.path, file_name: d.file_name, sort: startSort + i })))
    .select('*')
  if (r.error) throw fail(r.error)
  return r.data as Appendix[]
}
export async function addAppendixFile(orderId: string, file: File, name: string, sort: number) {
  const path = await uploadFile(`order/${orderId}`, file)
  const r = await supabase
    .from('order_appendices')
    .insert({ order_id: orderId, name: name.trim() || file.name.replace(/\.[^.]+$/, ''), path, file_name: file.name, sort })
    .select('*')
    .single()
  if (r.error) {
    await supabase.storage.from('orders').remove([path])
    throw fail(r.error)
  }
  return r.data as Appendix
}
export async function updateAppendix(id: string, patch: Partial<Pick<Appendix, 'name' | 'sort'>>) {
  const r = await supabase.from('order_appendices').update(patch).eq('id', id)
  if (r.error) throw fail(r.error)
}
export async function removeAppendix(a: Appendix) {
  const r = await supabase.from('order_appendices').delete().eq('id', a.id)
  if (r.error) throw fail(r.error)
  // the order's own file goes; a library file stays for the library and other orders
  if (!a.standard_id && a.path.startsWith('order/')) await supabase.storage.from('orders').remove([a.path])
}

// ---------- the order (Word, on the letterhead) ----------
export const orderFileName = (job: Pick<Job, 'job_no' | 'code'>, order: Pick<Order, 'order_no'>, company: Pick<Company, 'name'> | null) =>
  `${order.order_no ?? `${job.job_no}_${job.code}`} Order${company ? ' - ' + company.name : ''}.docx`.replace(/[\\/:*?"<>|]/g, '')

export async function orderDocx(args: { job: Job; order: Order; company: Company; contact: Contact | null; packageLabel: string; appendices: Appendix[]; signer: Profile | null }) {
  const { job, order, company, contact, packageLabel, appendices, signer } = args
  const address = [company.name, ...(company.address ?? '').split(/\n/).map((s) => s.trim()).filter(Boolean), company.postcode ?? ''].filter(Boolean)
  const rows: string[][] = [
    ['Order number', order.order_no ?? ''],
    ['Project', `${job.job_no} ${job.code} – ${job.name}`],
    ...(job.site_address ? [['Site', job.site_address.replace(/\n/g, ', ')]] : []),
    ['Package', packageLabel],
    ['Order value', `${money(order.order_value)} excluding VAT`],
    ['Retention', `${order.retention_pct}%`],
    ...(order.delivery_date ? [['Delivery / start on site', longDate(order.delivery_date)]] : []),
    ...(order.po_ref ? [['PO reference', order.po_ref]] : []),
  ]
  const scope = (order.scope ?? '')
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
  const blocks: Block[] = [
    { p: ordinalDate(order.order_date ?? todayIso()), before: 1300, after: 240 },
    { p: address.join('\n'), after: 240 },
    ...(contact ? [{ p: [{ text: `Fao: ${contact.name}`, bold: true, underline: true }], after: 240 } as Block] : []),
    { p: `Our ref: ${order.order_no ?? ''}`, after: 240 },
    { p: contact ? `Dear ${contact.name.split(' ')[0]},` : 'Dear Sir or Madam,', after: 200 },
    { p: [{ text: `Re: - ${job.name} – Subcontract Order ${order.order_no ?? ''}`, bold: true, underline: true }], after: 200 },
    { p: `We are pleased to place this order with you for the ${packageLabel} package, as follows.`, after: 160 },
    { table: { head: ['', ''], rows, widths: [55, 110] } },
    ...(scope.length ? [{ p: [{ text: 'Scope of works', bold: true }], after: 80, keepNext: true } as Block, ...scope.map((t): Block => ({ p: t, after: 160 }))] : []),
    ...(appendices.length
      ? [
          { p: 'The following appendices form part of this order:', after: 80, keepNext: true } as Block,
          ...appendices.map((a, i): Block => ({ p: `${i + 1}.\t${a.name}`, indent: 567, hanging: 567, after: i === appendices.length - 1 ? 160 : 40 })),
        ]
      : []),
    { p: 'Please sign and return a copy of this order within 7 days to confirm your acceptance.', after: 160 },
    { p: 'Yours sincerely,', before: 200, after: 960, keepNext: true },
    { p: signer?.full_name || '[name]', keepNext: true, after: 0 },
    ...(signer?.job_title ? [{ p: signer.job_title, keepNext: true, after: 0 } as Block] : []),
    { p: 'On behalf of du Boulay Projects Limited', after: 480 },
    { p: [{ text: `Accepted for and on behalf of ${company.name}`, bold: true }], after: 240, keepNext: true },
    { p: 'Signed: ……………………………………………\tDate: ……………………', after: 240, keepNext: true },
    { p: 'Name: ……………………………………………\tPosition: ……………………', after: 0 },
  ]
  return letterDocx(blocks)
}

// ---------- Outlook drafts (.eml) ----------
// X-Unsent: 1 makes Outlook open it as a new message ready to send (with the attachments), not a received one.
export interface Attachment {
  name: string
  blob: Blob
}
async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/.{1,76}/g, '$&\r\n')
}
const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`)
export async function emlDraft(args: { to: string[]; cc?: string[]; subject: string; html: string; attachments: Attachment[] }) {
  const boundary = `----dbp-${Math.random().toString(36).slice(2)}`
  const parts: string[] = [
    'X-Unsent: 1',
    `To: ${args.to.join(', ')}`,
    ...(args.cc?.length ? [`Cc: ${args.cc.join(', ')}`] : []),
    `Subject: ${encodeWord(args.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    await base64(new Blob([`<html><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${args.html}</body></html>`], { type: 'text/html' })),
  ]
  for (const a of args.attachments) {
    const name = encodeWord(a.name)
    parts.push(
      `--${boundary}`,
      `Content-Type: ${a.blob.type || 'application/octet-stream'}; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`,
      '',
      await base64(a.blob),
    )
  }
  parts.push(`--${boundary}--`, '')
  return new Blob([parts.join('\r\n')], { type: 'message/rfc822' })
}
export const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export async function markEmailed(orderId: string) {
  await supabase.from('orders').update({ emailed_at: new Date().toISOString() }).eq('id', orderId)
}

// ---------- subcontract variations: instruct them, and file what goes with them (script 056) ----------
// Files are filed in a folder per variation inside the order's own folder: order/<order id>/variations/<ref>/…
export interface VarFile {
  id: string
  variation_id: string
  kind: 'quote' | 'email' | 'instruction' | 'other'
  name: string
  path: string
  file_name: string
  created_at: string
}
export const VAR_FILE_KINDS: [VarFile['kind'], string][] = [
  ['quote', "Subcontractor's quote"],
  ['email', 'Email / correspondence'],
  ['other', 'Other'],
]
export async function loadVarFiles(orderId: string): Promise<VarFile[]> {
  const r = await supabase.from('sub_variation_files').select('*, sub_variations!inner(order_id)').eq('sub_variations.order_id', orderId).order('created_at')
  if (r.error) throw fail(r.error)
  return (r.data as (VarFile & { sub_variations?: unknown })[]).map(({ sub_variations: _s, ...f }) => f as VarFile) // eslint-disable-line @typescript-eslint/no-unused-vars
}
const folderName = (ref: string | null) => (ref ?? 'variation').replace(/[^\w.\- ]+/g, '_').trim() || 'variation'
export async function addVarFile(orderId: string, v: { id: string; ref: string | null }, file: File, kind: VarFile['kind'], name?: string) {
  const path = await uploadFile(`order/${orderId}/variations/${folderName(v.ref)}`, file)
  const r = await supabase
    .from('sub_variation_files')
    .insert({ variation_id: v.id, kind, name: (name ?? '').trim() || file.name, path, file_name: file.name })
    .select('*')
    .single()
  if (r.error) {
    await supabase.storage.from('orders').remove([path])
    throw fail(r.error)
  }
  return r.data as VarFile
}
export async function removeVarFile(f: VarFile) {
  const r = await supabase.from('sub_variation_files').delete().eq('id', f.id)
  if (r.error) throw fail(r.error)
  await supabase.storage.from('orders').remove([f.path])
}
// when variations are deleted from an order, their files go too
export async function removeVarFilesOf(variationIds: string[]) {
  if (!variationIds.length) return
  const r = await supabase.from('sub_variation_files').select('path').in('variation_id', variationIds)
  const paths = (r.data ?? []).map((x) => x.path as string)
  if (paths.length) await supabase.storage.from('orders').remove(paths)
}
export async function markInstructed(id: string) {
  const r = await supabase.from('sub_variations').update({ instructed: true, instructed_on: todayIso(), instruction_emailed_at: new Date().toISOString() }).eq('id', id)
  if (r.error) throw fail(r.error)
}

// the instruction letter (Word, on the letterhead)
export async function variationDocx(args: {
  job: Job
  order: Order
  company: Company
  contact: Contact | null
  v: { ref: string | null; description: string | null; value: number | null }
  revisedOrderValue: number | null
  signer: Profile | null
}) {
  const { job, order, company, contact, v, revisedOrderValue, signer } = args
  const address = [company.name, ...(company.address ?? '').split(/\n/).map((s) => s.trim()).filter(Boolean), company.postcode ?? ''].filter(Boolean)
  const rows: string[][] = [
    ['Order number', order.order_no ?? ''],
    ['Project', `${job.job_no} ${job.code} – ${job.name}`],
    ['Variation', `${v.ref ?? ''}${v.description ? ' – ' + v.description : ''}`],
    ['Value of variation', `${money(v.value)} excluding VAT`],
    ['Original order value', `${money(order.order_value)} excluding VAT`],
    ...(revisedOrderValue != null ? [['Revised order value (with all instructed variations)', `${money(revisedOrderValue)} excluding VAT`]] : []),
  ]
  const blocks: Block[] = [
    { p: ordinalDate(todayIso()), before: 1300, after: 240 },
    { p: address.join('\n'), after: 240 },
    ...(contact ? [{ p: [{ text: `Fao: ${contact.name}`, bold: true, underline: true }], after: 240 } as Block] : []),
    { p: `Our ref: ${order.order_no ?? ''} / ${v.ref ?? ''}`, after: 240 },
    { p: contact ? `Dear ${contact.name.split(' ')[0]},` : 'Dear Sir or Madam,', after: 200 },
    { p: [{ text: `Re: - ${job.name} – Variation Instruction ${v.ref ?? ''} to Order ${order.order_no ?? ''}`, bold: true, underline: true }], after: 200 },
    { p: `Further to your quotation, we hereby instruct you to carry out the following variation to the above order, on the terms of the order.`, after: 160 },
    { table: { head: ['', ''], rows, widths: [70, 95] } },
    { p: 'Please proceed, and confirm receipt and acceptance by return.', after: 160 },
    { p: 'Yours sincerely,', before: 200, after: 960, keepNext: true },
    { p: signer?.full_name || '[name]', keepNext: true, after: 0 },
    ...(signer?.job_title ? [{ p: signer.job_title, keepNext: true, after: 0 } as Block] : []),
    { p: 'On behalf of du Boulay Projects Limited', after: 0 },
  ]
  return letterDocx(blocks)
}
