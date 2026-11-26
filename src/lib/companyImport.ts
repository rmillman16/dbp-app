// Reading a supply chain list from Excel into companies, their PQQ dates and their contacts (26 Nov, a one-off import).
// Any layout: the header row is found by its words, each column's meaning is guessed from its heading (and can be changed before
// importing). Kept free of the screen so it can be tested on its own. The sheet's cells arrive as text (xlsxText.ts), so a date is
// either a typed date or Excel's day number.
import type { CompanyType, PqqStatus } from './types'

export type CField =
  | 'name'
  | 'type'
  | 'trade'
  | 'address'
  | 'postcode'
  | 'email'
  | 'phone'
  | 'iplicit_code'
  | 'notes'
  | 'pqq_status'
  | 'pqq_approved_on'
  | 'pqq_expires_on'
  | 'pqq_sent_on'
  | 'contact_name'
  | 'contact_role'
  | 'contact_email'
  | 'contact_phone'

export const CFIELD_LABELS: Record<CField, string> = {
  name: 'Company name',
  type: 'Type (subcontractor, supplier…)',
  trade: 'Trade / what they supply',
  address: 'Address',
  postcode: 'Postcode',
  email: 'Company email',
  phone: 'Company phone',
  iplicit_code: 'iPlicit code',
  notes: 'Notes',
  pqq_status: 'PQQ status',
  pqq_approved_on: 'PQQ approved on',
  pqq_expires_on: 'PQQ expires on',
  pqq_sent_on: 'PQQ sent on',
  contact_name: 'Contact name',
  contact_role: 'Contact job title',
  contact_email: 'Contact email',
  contact_phone: 'Contact phone',
}
export const CFIELDS = Object.keys(CFIELD_LABELS) as CField[]
export type CMapping = Partial<Record<CField, number>> // field → column index

// most specific first: a column goes to the first field that fits it
const TESTS: [CField, RegExp][] = [
  ['pqq_expires_on', /expir|renewal|renew|valid\s*(until|to|till|thru)|pqq.*(due|end)/i],
  ['pqq_approved_on', /(pqq|prequal|approv).*(date|on|when)|date.*(pqq|approv)/i],
  ['pqq_sent_on', /(pqq|prequal).*sent|sent.*(pqq|prequal|date)|date sent/i],
  ['pqq_status', /pqq|prequal|approved\??$|approval|vetting|status/i],
  ['contact_email', /(contact|person|buyer|manager|director|attn).*e-?mail|e-?mail.*(contact|person)/i],
  ['contact_phone', /(contact|person|direct).*(phone|tel|mobile|number)|mobile/i],
  ['contact_role', /\b(job\s*title|position|role)\b/i],
  ['contact_name', /\b(contact|person|attn|attention|buyer)\b/i],
  ['email', /e-?mail/i],
  ['phone', /phone|tel\b|telephone|number/i],
  ['postcode', /post\s*code|postal|zip/i],
  ['address', /address/i],
  ['iplicit_code', /iplicit|account\s*(code|no|number|ref)|supplier\s*(code|no|number|ref)|vendor/i],
  ['type', /\btype\b/i],
  ['trade', /trade|discipline|categor|service|speciali|supplies|works/i],
  ['name', /\b(company|supplier|subcontractor|sub-?contractor|contractor|firm|business|organisation|organization|name)\b/i],
  ['notes', /notes?|comments?|remarks?/i],
]
const cell = (v: unknown) => String(v ?? '').trim()

// the header row: the first of the top 30 rows with a company name column and at least one other recognised heading
export function findHeader(rows: string[][]) {
  let best = -1
  let bestScore = 0
  rows.slice(0, 30).forEach((r, i) => {
    const m = guessMapping(r)
    const score = Object.keys(m).length
    if (m.name !== undefined && score > bestScore) ((best = i), (bestScore = score))
  })
  return bestScore >= 2 ? best : -1
}

export function guessMapping(headers: unknown[]): CMapping {
  const m: CMapping = {}
  const used = new Set<number>()
  for (const [field, re] of TESTS)
    headers.forEach((h, i) => {
      if (m[field] === undefined && !used.has(i) && cell(h) && re.test(cell(h))) {
        m[field] = i
        used.add(i)
      }
    })
  return m
}

// ---------- the values ----------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}
const fullYear = (y: number) => (y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y)

// a date as typed (day first, as in the UK) or as Excel's day number; blank is no date, and anything unreadable is flagged
export function parseDate(text: string): { value: string | null; bad: boolean } {
  const s = cell(text)
  if (!s || /^(n\/?a|-+|tbc|none)$/i.test(s)) return { value: null, bad: false }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000)
    return { value: iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), bad: false }
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) {
    const v = iso(Number(m[1]), Number(m[2]), Number(m[3]))
    return { value: v, bad: !v }
  }
  m = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2,4})$/.exec(s)
  if (m) {
    const v = iso(fullYear(Number(m[3])), Number(m[2]), Number(m[1]))
    return { value: v, bad: !v }
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([A-Za-z]{3,})[a-z]*[\s\-/.,]+(\d{2,4})$/.exec(s)
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1
    const v = mo ? iso(fullYear(Number(m[3])), mo, Number(m[1])) : null
    return { value: v, bad: !v }
  }
  m = /^([A-Za-z]{3,})[a-z]*[\s\-/.,]+(\d{2,4})$/.exec(s) // "March 2027": the end of that month
  if (m) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1
    const y = fullYear(Number(m[2]))
    const v = mo ? iso(y, mo, new Date(Date.UTC(y, mo, 0)).getUTCDate()) : null
    return { value: v, bad: !v }
  }
  return { value: null, bad: true }
}

export function parseStatus(text: string): PqqStatus | null {
  const s = cell(text).toLowerCase()
  if (!s) return null
  if (/not\s*(required|needed|applicable)|n\/?a\b|exempt/.test(s)) return 'not_required'
  if (/reject|fail|declin|unsuccess|not\s*approved/.test(s)) return 'rejected'
  if (/not\s*sent|none|outstanding|to\s*send|^no$|not\s*started/.test(s)) return 'not_sent'
  if (/approv|pass|accept|complete|valid|current|^yes$|^y$|^ok$|^✓$/.test(s)) return 'approved'
  if (/received|returned|back|review|submitted/.test(s)) return 'received'
  if (/sent|issued|requested|chas|awaiting|pending/.test(s)) return 'sent'
  return null
}

export function parseType(text: string, fallback: CompanyType): CompanyType {
  const s = cell(text).toLowerCase()
  if (!s) return fallback
  if (/^sub|trade contractor|specialist/.test(s)) return 'subcontractor'
  if (/suppl|merchant|material|manufactur|hire/.test(s)) return 'supplier'
  if (/client|developer|employer/.test(s)) return 'client'
  if (/consult|engineer|surveyor|architect|pm\b|cost/.test(s)) return 'consultant'
  if (/design/.test(s)) return 'designer'
  return fallback
}

// one year earlier (an approval date worked back from its expiry)
const yearBefore = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number)
  return iso(y - 1, m, d) ?? `${y - 1}-${pad(m)}-28`
}

// "Smith & Sons Ltd." and "SMITH AND SONS LIMITED" are the same company
export const normName = (n: string) =>
  n
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(ltd|limited|llp|plc|inc|co|company|uk|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export interface ImportContact {
  name: string
  role: string | null
  email: string | null
  phone: string | null
}
export interface ImportCompany {
  name: string
  type: CompanyType
  trade: string | null
  address: string | null
  postcode: string | null
  email: string | null
  phone: string | null
  iplicit_code: string | null
  notes: string | null
  pqq_status: PqqStatus | null
  pqq_approved_on: string | null
  pqq_expires_on: string | null
  pqq_sent_on: string | null
  contacts: ImportContact[]
  warnings: string[]
  row: number // the sheet row it came from (1-based)
}

// The rows under the header as companies. A row with no company name but a contact belongs to the company above it, and a company
// named twice is one company with both contacts.
export function buildCompanies(rows: string[][], headerRow: number, m: CMapping, defaultType: CompanyType): ImportCompany[] {
  const out: ImportCompany[] = []
  const byName = new Map<string, ImportCompany>()
  const get = (r: string[], f: CField) => (m[f] === undefined ? '' : cell(r[m[f]!]))
  let last: ImportCompany | null = null
  rows.slice(headerRow + 1).forEach((r, k) => {
    if (!r.some((c) => cell(c))) return
    const name = get(r, 'name')
    const contact: ImportContact | null = (() => {
      const cn = get(r, 'contact_name')
      const ce = get(r, 'contact_email')
      const cp = get(r, 'contact_phone')
      if (!cn && !ce && !cp) return null
      return { name: cn || ce || cp, role: get(r, 'contact_role') || null, email: ce || null, phone: cp || null }
    })()
    let co: ImportCompany | null = null
    if (!name) {
      co = last
      if (!co) return
    } else {
      co = byName.get(normName(name)) ?? null
      if (!co) {
        const warnings: string[] = []
        const date = (f: CField) => {
          const d = parseDate(get(r, f))
          if (d.bad) warnings.push(`${CFIELD_LABELS[f]} "${get(r, f)}" is not a date I can read`)
          return d.value
        }
        const approved = date('pqq_approved_on')
        const expires = date('pqq_expires_on')
        const sent = date('pqq_sent_on')
        let status = parseStatus(get(r, 'pqq_status'))
        if (get(r, 'pqq_status') && !status) warnings.push(`PQQ status "${get(r, 'pqq_status')}" is not one I recognise`)
        if (!status && (expires || approved)) status = 'approved'
        co = {
          name,
          type: parseType(get(r, 'type'), defaultType),
          trade: get(r, 'trade') || null,
          address: get(r, 'address') || null,
          postcode: get(r, 'postcode') || null,
          email: get(r, 'email') || null,
          phone: get(r, 'phone') || null,
          iplicit_code: get(r, 'iplicit_code') || null,
          notes: get(r, 'notes') || null,
          pqq_status: status,
          pqq_approved_on: status === 'approved' && !approved && expires ? yearBefore(expires) : approved,
          pqq_expires_on: expires,
          pqq_sent_on: sent,
          contacts: [],
          warnings,
          row: headerRow + k + 2,
        }
        byName.set(normName(name), co)
        out.push(co)
      }
    }
    last = co
    if (contact && !co.contacts.some((c) => (c.email && c.email.toLowerCase() === contact.email?.toLowerCase()) || c.name.toLowerCase() === contact.name.toLowerCase())) co.contacts.push(contact)
  })
  return out
}
