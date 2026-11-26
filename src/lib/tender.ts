import { supabase } from './supabase'
import { todayIso } from './format'
import { emlDraft, escHtml, type Attachment } from './orders'
import { fill } from './letter'

// Tender enquiries (script 067): the Enquiry Generator rebuilt in the app, and the tracker that follows it.
// A PACKAGE (trade) of an Estimating enquiry goes to a list of contractors: one email each, as an Outlook draft (.eml).
// Each contractor on each package is an INVITE, tracked like a Procurement line.

export type InviteStatus = 'drafted' | 'sent' | 'interested' | 'declined' | 'quoted' | 'used' | 'appointed' | 'unsuccessful'
export const INVITE_STATUS: [InviteStatus, string][] = [
  ['drafted', 'Draft made'],
  ['sent', 'Sent'],
  ['interested', 'Interested'],
  ['declined', 'Declined'],
  ['quoted', 'Quote received'],
  ['used', 'Price used'],
  ['appointed', 'Appointed'],
  ['unsuccessful', 'Unsuccessful'],
]
export const INVITE_LABEL = Object.fromEntries(INVITE_STATUS) as Record<InviteStatus, string>
// still waiting on them
export const AWAITING: InviteStatus[] = ['sent', 'interested']

export interface TenderPackage {
  id: string
  enquiry_id: string
  package: string
  return_date: string
  job_address: string | null
  main_contract: string | null
  sub_contract: string | null
  summary: string | null
  scope: string | null
  notes: string | null
  documents_link: string | null
  sender_name: string | null
  sender_phone: string | null
  email_subject: string | null
  email_body: string | null
  created_at: string
}
export interface TenderInvite {
  id: string
  package_id: string
  company_id: string | null
  contact_id: string | null
  name: string
  email: string | null
  status: InviteStatus
  sent_on: string | null
  chased_count: number
  last_chased_on: string | null
  quote_amount: number | null
  quote_received_on: string | null
  notes: string | null
}

const NEEDS_067 = 'The tender tracker needs script 067 (supabase/067_tender_enquiries.sql) to be run first.'
function fail(e: { message: string }): Error {
  return new Error(/tender_(packages|invites)|schema cache|does not exist/i.test(e.message) ? NEEDS_067 : e.message)
}

export async function loadTracker() {
  const [p, i] = await Promise.all([
    supabase.from('tender_packages').select('*').order('created_at', { ascending: false }),
    supabase.from('tender_invites').select('*').order('name'),
  ])
  if (p.error) throw fail(p.error)
  if (i.error) throw fail(i.error)
  return { packages: p.data as TenderPackage[], invites: i.data as TenderInvite[] }
}
export async function createPackage(pkg: Omit<TenderPackage, 'id' | 'created_at'>, invites: Omit<TenderInvite, 'id' | 'package_id'>[]) {
  const p = await supabase.from('tender_packages').insert(pkg).select('*').single()
  if (p.error) throw fail(p.error)
  if (invites.length) {
    const r = await supabase.from('tender_invites').insert(invites.map((x) => ({ ...x, package_id: p.data.id })))
    if (r.error) throw fail(r.error)
  }
  return p.data as TenderPackage
}
// a contractor added to a package that is already in the tracker (sent outside the app)
export async function addInvites(packageId: string, who: { company_id: string | null; name: string; email: string | null }[], sentOn: string | null) {
  if (!who.length) return
  const r = await supabase.from('tender_invites').insert(
    who.map((w) => ({ package_id: packageId, company_id: w.company_id, contact_id: null, name: w.name, email: w.email, status: 'sent' as InviteStatus, sent_on: sentOn, chased_count: 0, last_chased_on: null, quote_amount: null, quote_received_on: null, notes: null })),
  )
  if (r.error) throw fail(r.error)
}
export async function updateInvite(id: string, patch: Partial<Omit<TenderInvite, 'id' | 'package_id'>>) {
  const r = await supabase.from('tender_invites').update(patch).eq('id', id)
  if (r.error) throw fail(r.error)
}
export async function deleteInvite(id: string) {
  const r = await supabase.from('tender_invites').delete().eq('id', id)
  if (r.error) throw fail(r.error)
}
export async function deletePackage(id: string) {
  const r = await supabase.from('tender_packages').delete().eq('id', id)
  if (r.error) throw fail(r.error)
}
export async function updatePackage(id: string, patch: Partial<Pick<TenderPackage, 'return_date' | 'notes' | 'documents_link'>>) {
  const r = await supabase.from('tender_packages').update(patch).eq('id', id)
  if (r.error) throw fail(r.error)
}
// the status follows what happened to it: a quote arriving dates it, a chase is counted
export function statusPatch(status: InviteStatus, cur: TenderInvite): Partial<TenderInvite> {
  const p: Partial<TenderInvite> = { status }
  if (status === 'sent' && !cur.sent_on) p.sent_on = todayIso()
  if (status === 'quoted' && !cur.quote_received_on) p.quote_received_on = todayIso()
  return p
}

// ---------- the email ----------
export const DEFAULT_SUBJECT = '{{job}} ({{jobno}}): tender enquiry, {{package}}: return by {{return}}'
export const DEFAULT_BODY = `Dear {{contact}},

We are tendering for {{job}}{{address}} and would like to invite {{company}} to price the {{package}} package.

{{summary}}
Main contract: {{main}}
Sub-contract: {{sub}}

The tender documents are here: {{link}}

{{scope}}Please return your tender by {{return}}.

{{notes}}If you would like to price this, or you are unable to, please let me know.

Kind regards,
{{sender}}
{{phone}}
du Boulay Projects Limited`
export const CHASE_SUBJECT = 'Reminder: {{job}} ({{jobno}}): tender enquiry, {{package}}: return by {{return}}'
export const CHASE_BODY = `Dear {{contact}},

A quick reminder about the {{package}} package for {{job}}, which we sent to {{company}} on {{sent}}.

We need your tender back by {{return}}. Please let me know if you are pricing it, or if you are unable to.

Kind regards,
{{sender}}
{{phone}}
du Boulay Projects Limited`

export interface MailValues {
  job: string
  jobno: string
  address: string
  summary: string
  main: string
  sub: string
  link: string
  scope: string
  notes: string
  ret: string
  package: string
  sender: string
  phone: string
}
// lines that would be empty are dropped, so the email has no "Main contract:" with nothing after it
export function valuesFor(v: MailValues, company: string, contact: string, sent = ''): Record<string, string> {
  return {
    job: v.job,
    jobno: v.jobno,
    address: v.address ? `, ${v.address}` : '',
    summary: v.summary ? v.summary + '\n' : '',
    main: v.main,
    sub: v.sub,
    link: v.link || '(to follow)',
    scope: v.scope ? v.scope + '\n\n' : '',
    notes: v.notes ? v.notes + '\n\n' : '',
    return: v.ret,
    package: v.package,
    sender: v.sender,
    phone: v.phone,
    company,
    contact: contact || 'Sir or Madam',
    sent,
  }
}
const tidy = (t: string) =>
  t
    .split('\n')
    .filter((l) => !/^(Main contract|Sub-contract):\s*$/.test(l.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
export const render = (tpl: string, vals: Record<string, string>) => tidy(fill(tpl, vals))
export const toHtml = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')

export async function draftFor(args: { to: string | null; subject: string; body: string; attachments: Attachment[] }) {
  return emlDraft({ to: args.to ? [args.to] : [], subject: args.subject, html: toHtml(args.body), attachments: args.attachments })
}
