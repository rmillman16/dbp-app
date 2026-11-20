import { supabase } from './supabase'
import { cached, must } from './offline'
import { addDaysIso, todayIso } from './format'
import { lineTotal, type VoWithLines } from './variations'
import type { Job, Quotation, QuotationClause, QuotationLine } from './types'

export const DEFAULT_VALID_DAYS = 30

// "2611 FISL – QU001 – Waterproofing" (agreed 20 Nov); Estimating (no job): "EST – QU001 – …"
export function fullRef(job: Pick<Job, 'job_no' | 'code'> | null, q: Pick<Quotation, 'quote_no' | 'subject'>) {
  return `${job ? `${job.job_no} ${job.code}` : 'EST'} – QU${String(q.quote_no).padStart(3, '0')} – ${q.subject}`
}

export function quoteTotal(lines: Pick<QuotationLine, 'qty' | 'rate'>[]) {
  return lines.reduce((s, l) => s + lineTotal(l), 0)
}

// Client copy of a VO's pricing: OHP and prelims built into each rate (agreed 19 Nov),
// or prelims as their own line. Omissions become negative lines.
export function linesFromVo({ lines, build }: VoWithLines, prelimsOwnLine: boolean): QuotationLine[] {
  const factor = (1 + build.ohpPct / 100) * (prelimsOwnLine ? 1 : 1 + build.prelimsPct / 100)
  const out: QuotationLine[] = lines.map((l, i) => {
    const rate = Math.round((l.rate ?? 0) * factor * 100) / 100 * (l.section === 'omit' ? -1 : 1)
    const ql = { item: null, heading: l.section === 'omit' ? 'Omit' : null, description: l.description, qty: l.qty ?? 1, unit: l.unit, rate, total: 0, sort: i }
    ql.total = lineTotal(ql)
    return ql
  })
  if (prelimsOwnLine && build.prelims) {
    const rate = Math.round(build.prelims * 100) / 100
    out.push({ item: null, heading: 'Preliminaries', description: '', qty: 1, unit: 'Item', rate, total: rate, sort: out.length })
  }
  return out
}

// Job quotations are numbered per job; Estimating ones (no job) share one series.
export async function nextQuoteNo(jobId: string | null) {
  const base = supabase.from('quotations').select('quote_no')
  const q = jobId ? base.eq('job_id', jobId) : base.is('job_id', null)
  const r = await must<{ quote_no: number }[]>(q.order('quote_no', { ascending: false }).limit(1))
  return (r[0]?.quote_no ?? 0) + 1
}

// Creates a draft quotation (for a job: standalone or from a VO; or Estimating with no job) and returns its id.
export async function createQuotation(job: Job | null, from?: { vo: VoWithLines; prelimsOwnLine: boolean }) {
  const quote_no = await nextQuoteNo(job?.id ?? null)
  const vo = from?.vo.vo
  const ins = await supabase
    .from('quotations')
    .insert({
      job_id: job?.id ?? null,
      variation_id: vo?.id ?? null,
      quote_no,
      subject: vo?.title ?? 'New quotation',
      summary: vo ? `the ${vo.title.toLowerCase()}` : null,
      scope: vo?.description ?? null,
      prepared_by: 'du Boulay Projects',
      site: job?.site_address ?? null,
      issued_date: todayIso(),
      valid_until: addDaysIso(todayIso(), DEFAULT_VALID_DAYS),
    })
    .select('id')
    .single()
  if (ins.error) throw new Error(ins.error.message)
  if (from) {
    const lines = linesFromVo(from.vo, from.prelimsOwnLine).map((l) => ({ ...l, quotation_id: ins.data.id }))
    if (lines.length) {
      const r = await supabase.from('quotation_lines').insert(lines)
      if (r.error) throw new Error(r.error.message)
    }
  }
  return ins.data.id as string
}

// a job's quotations, or (null) the Estimating ones with no job
export async function loadQuotations(jobId: string | null) {
  return cached(`quotes:${jobId ?? 'estimating'}`, async () => {
    const base = supabase.from('quotations').select('*')
    const quotes = await must<Quotation[]>((jobId ? base.eq('job_id', jobId) : base.is('job_id', null)).order('quote_no', { ascending: false }))
    const ids = quotes.map((q) => q.id)
    type Priced = Pick<QuotationLine, 'quotation_id' | 'qty' | 'rate'>
    const lines = ids.length ? await must<Priced[]>(supabase.from('quotation_lines').select('quotation_id, qty, rate').in('quotation_id', ids)) : []
    return quotes.map((q) => ({ q, total: quoteTotal(lines.filter((l) => l.quotation_id === q.id)) }))
  })
}

export async function loadQuotation(id: string) {
  return cached(`quote:${id}`, async () => ({
    q: await must<Quotation>(supabase.from('quotations').select('*').eq('id', id).single()),
    lines: await must<QuotationLine[]>(supabase.from('quotation_lines').select('*').eq('quotation_id', id).order('sort')),
    clauses: await must<QuotationClause[]>(supabase.from('quotation_clauses').select('*').eq('quotation_id', id).order('sort')),
  }))
}

type Editable = Omit<Quotation, 'id' | 'job_id' | 'quote_no' | 'ref'>

export async function saveQuotation(id: string, q: Editable, lines: QuotationLine[], clauses: QuotationClause[]) {
  const steps = [
    () => supabase.from('quotations').update(q).eq('id', id),
    () => supabase.from('quotation_lines').delete().eq('quotation_id', id),
    () => (lines.length ? supabase.from('quotation_lines').insert(lines.map((l, i) => ({ ...l, id: undefined, quotation_id: id, sort: i, total: lineTotal(l) }))) : null),
    () => supabase.from('quotation_clauses').delete().eq('quotation_id', id),
    () => (clauses.length ? supabase.from('quotation_clauses').insert(clauses.map((c, i) => ({ ...c, quotation_id: id, sort: i }))) : null),
  ]
  for (const step of steps) {
    const r = await step()
    if (r && r.error) throw r.error
  }
}

// Acceptance (signed copy or email) sets the linked VO to Agreed (agreed 19 Nov).
export async function acceptQuotation(q: Quotation, acceptedBy: string, date: string) {
  const r = await supabase.from('quotations').update({ status: 'accepted', accepted_by: acceptedBy, accepted_date: date }).eq('id', q.id)
  if (r.error) throw r.error
  if (q.variation_id) {
    const v = await supabase.from('variations').select('date_agreed').eq('id', q.variation_id).single()
    const r2 = await supabase
      .from('variations')
      .update({ status: 'agreed', date_agreed: v.data?.date_agreed ?? date })
      .eq('id', q.variation_id)
    if (r2.error) throw r2.error
  }
}
