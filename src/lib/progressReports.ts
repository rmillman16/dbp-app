// Progress reports (23 Nov, script 064), as agreed 19 Nov (docs/decisions.md): a numbered report per period, in numbered sections
// that can be switched off per job (the numbering closes up), a cover and summary page, photos and appendices, issued as one
// combined PDF (and an editable Word file). The report pulls what the app already knows when it's made; the PM writes the
// narrative. The commercial section is VO and EOT status only: no values, no CVR, margin or application figures.
import { supabase } from './supabase'
import { addDaysIso, todayIso } from './format'
import { loadProgramme } from './programme'
import { loadRfis, type Rfi } from './rfis'
import { loadSubmittals, type Submittal } from './submittals'
import type { Job } from './types'

export type SectionKey = 'programme' | 'design' | 'procurement' | 'information' | 'contract' | 'commercial' | 'site' | 'hs'
export const SECTIONS: { key: SectionKey; title: string; hint: string }[] = [
  { key: 'programme', title: 'Programme and progress', hint: 'Programme dates, progress this period, photos, look-ahead, key issues' },
  { key: 'design', title: 'Design', hint: 'Submittals summary, sampling tracker, design queries' },
  { key: 'procurement', title: 'Procurement', hint: 'Where each package stands, from the Procurement schedule' },
  { key: 'information', title: 'Information required', hint: 'RFIs outstanding; the RFI report is appended' },
  { key: 'contract', title: 'Contract', hint: 'Status, insurances, warranties' },
  { key: 'commercial', title: 'Commercial', hint: 'Variation and EOT status only: no values, no CVR, no margin' },
  { key: 'site', title: 'Site-specific issues', hint: 'Headings you set for this job (e.g. base build, client direct contractors, access)' },
  { key: 'hs', title: 'Health and safety', hint: 'Statistics and audit; attach the Inndex report as an appendix' },
]
export type SectionsOn = Partial<Record<SectionKey, boolean>>
export const sectionOn = (s: SectionsOn | null | undefined, k: SectionKey) => (s?.[k] ?? true) !== false

// the report's own text and figures (all optional; blank is left out of the report)
export interface Content {
  keyIssues: string[]
  programme: { revision: string; progress: string; lookahead: string; issues: string }
  design: { queries: string }
  procurement: { notes: string }
  information: { notes: string }
  contract: { status: string; insurances: string; warranties: string }
  commercial: { notes: string }
  siteSpecific: { heading: string; text: string }[]
  hs: { hours: string; inducted: string; riddor: string; accidents: string; nearMisses: string; audits: string; score: string; notes: string }
  autoAppendices: { rfis: boolean; submittals: boolean }
}
export const emptyContent = (): Content => ({
  keyIssues: [],
  programme: { revision: '', progress: '', lookahead: '', issues: '' },
  design: { queries: '' },
  procurement: { notes: '' },
  information: { notes: '' },
  contract: { status: '', insurances: '', warranties: '' },
  commercial: { notes: '' },
  siteSpecific: [],
  hs: { hours: '', inducted: '', riddor: '', accidents: '', nearMisses: '', audits: '', score: '', notes: '' },
  autoAppendices: { rfis: true, submittals: true },
})
export const mergeContent = (c: Partial<Content> | null | undefined): Content => {
  const e = emptyContent()
  const x = c ?? {}
  return {
    ...e,
    ...x,
    programme: { ...e.programme, ...x.programme },
    design: { ...e.design, ...x.design },
    procurement: { ...e.procurement, ...x.procurement },
    information: { ...e.information, ...x.information },
    contract: { ...e.contract, ...x.contract },
    commercial: { ...e.commercial, ...x.commercial },
    hs: { ...e.hs, ...x.hs },
    autoAppendices: { ...e.autoAppendices, ...x.autoAppendices },
    keyIssues: x.keyIssues ?? [],
    siteSpecific: x.siteSpecific ?? [],
  }
}

export type ReportStatus = 'draft' | 'approved' | 'issued'
export const REPORT_STATUS: Record<ReportStatus, string> = { draft: 'Draft', approved: 'Approved', issued: 'Issued' }
export interface ProgressReport {
  id: string
  job_id: string
  report_no: number
  title: string | null
  period_start: string | null
  period_end: string | null
  status: ReportStatus
  sections: SectionsOn | null
  content: Partial<Content> | null
  issued_on: string | null
  prepared_by: string | null
  approved_by: string | null
  created_at: string
  updated_at: string
}
export interface ReportFile {
  id: string
  report_id: string
  kind: 'photo' | 'appendix'
  name: string
  path: string
  file_name: string
  caption: string | null
  sort: number
}

const needs064 = (m: string) => (/relation|schema cache|does not exist|column/i.test(m) && /progress_report|content|sections/i.test(m) ? 'Progress reports need script 064 run in Supabase first (supabase/README.md).' : m)
const fail = (e: { message: string }) => new Error(needs064(e.message))

// numbered sections, closing up when some are off: { programme: "1", design: "2", … }
export function numbering(on: SectionsOn | null | undefined) {
  const out = {} as Record<SectionKey, string>
  let n = 0
  for (const s of SECTIONS) if (sectionOn(on, s.key)) out[s.key] = String(++n)
  return out
}

// ---------- loading and saving ----------
export async function loadReports(jobId: string) {
  const r = await supabase.from('progress_reports').select('*').eq('job_id', jobId).order('report_no', { ascending: false })
  if (r.error) throw fail(r.error)
  return r.data as ProgressReport[]
}
export async function loadReport(id: string) {
  const [r, f] = await Promise.all([
    supabase.from('progress_reports').select('*').eq('id', id).single(),
    supabase.from('progress_report_files').select('*').eq('report_id', id).order('sort').order('created_at'),
  ])
  if (r.error) throw fail(r.error)
  if (f.error) throw fail(f.error)
  return { report: r.data as ProgressReport, files: f.data as ReportFile[] }
}
// a new report starts after the last one's period, with its sections and standing text carried across
export async function createReport(job: Pick<Job, 'id' | 'start_date' | 'report_frequency_days'>) {
  const all = await loadReports(job.id)
  const last = all[0]
  const days = job.report_frequency_days && job.report_frequency_days > 0 ? job.report_frequency_days : 28
  const start = last?.period_end ? addDaysIso(last.period_end, 1) : (job.start_date ?? todayIso())
  let end = addDaysIso(start, days - 1)
  if (end < start) end = start
  const prev = mergeContent(last?.content)
  const content: Content = {
    ...emptyContent(),
    // what stands from one report to the next
    programme: { ...emptyContent().programme, revision: prev.programme.revision },
    contract: { status: prev.contract.status, insurances: prev.contract.insurances, warranties: prev.contract.warranties },
    siteSpecific: prev.siteSpecific.map((s) => ({ heading: s.heading, text: '' })),
    autoAppendices: prev.autoAppendices,
  }
  const r = await supabase
    .from('progress_reports')
    .insert({ job_id: job.id, report_no: (last?.report_no ?? 0) + 1, period_start: start, period_end: end, status: 'draft', sections: last?.sections ?? {}, content })
    .select('*')
    .single()
  if (r.error) throw fail(r.error)
  return r.data as ProgressReport
}
export async function updateReport(id: string, patch: Partial<Pick<ProgressReport, 'title' | 'period_start' | 'period_end' | 'status' | 'sections' | 'content' | 'issued_on' | 'approved_by'>>) {
  const r = await supabase.from('progress_reports').update(patch).eq('id', id).select('*').single()
  if (r.error) throw fail(r.error)
  return r.data as ProgressReport
}
export async function deleteReport(id: string) {
  const files = await supabase.from('progress_report_files').select('path').eq('report_id', id)
  const r = await supabase.from('progress_reports').delete().eq('id', id)
  if (r.error) throw fail(r.error)
  const paths = (files.data ?? []).map((f) => f.path as string)
  if (paths.length) await supabase.storage.from('reports').remove(paths)
}

// ---------- files (private storage area "reports") ----------
export async function addReportFile(reportId: string, kind: ReportFile['kind'], file: File, name: string, sort: number) {
  const safe = file.name.replace(/[^\w.\- ()]+/g, '_')
  const path = `${reportId}/${Date.now()}-${safe}`
  const up = await supabase.storage.from('reports').upload(path, file, { contentType: file.type || undefined })
  if (up.error) throw fail(up.error)
  const r = await supabase
    .from('progress_report_files')
    .insert({ report_id: reportId, kind, name: name.trim() || file.name.replace(/\.[^.]+$/, ''), path, file_name: file.name, sort })
    .select('*')
    .single()
  if (r.error) {
    await supabase.storage.from('reports').remove([path])
    throw fail(r.error)
  }
  return r.data as ReportFile
}
export async function updateReportFile(id: string, patch: Partial<Pick<ReportFile, 'name' | 'caption' | 'sort'>>) {
  const r = await supabase.from('progress_report_files').update(patch).eq('id', id)
  if (r.error) throw fail(r.error)
}
export async function removeReportFile(f: ReportFile) {
  const r = await supabase.from('progress_report_files').delete().eq('id', f.id)
  if (r.error) throw fail(r.error)
  await supabase.storage.from('reports').remove([f.path])
}
export async function reportFileBytes(path: string) {
  const r = await supabase.storage.from('reports').download(path)
  if (r.error || !r.data) throw new Error(`Couldn't fetch ${path.split('/').pop()}: ${r.error?.message ?? 'not found'}`)
  return new Uint8Array(await r.data.arrayBuffer())
}
export async function openReportFile(path: string) {
  const r = await supabase.storage.from('reports').createSignedUrl(path, 3600)
  if (r.error || !r.data) throw new Error(r.error?.message ?? 'File not found')
  window.open(r.data.signedUrl, '_blank', 'noopener')
}

// ---------- what the app already knows (pulled in when the report is made) ----------
export interface AutoData {
  programme: {
    commencement: string | null
    contractCompletion: string | null
    estimated: string | null
    now: { code: string; name: string; start: string; finish: string; progress: number | null; rag: string | null }[]
    next: { code: string; name: string; start: string; finish: string }[]
    milestones: { code: string; name: string; date: string }[]
  } | null
  rfis: { rows: Rfi[]; open: number; answered: number; overdue: number; closedInPeriod: number } | null
  submittals: { rows: Submittal[]; out: number; overdue: number; respondedInPeriod: number } | null
  sampling: { counts: Record<string, number>; total: number } | null
  procurement: { counts: Record<string, number>; total: number; upcoming: { name: string; onSite: string | null; status: string }[] } | null
  variations: { counts: Record<string, number>; total: number } | null
  eot: { claims: { no: number; status: string; submitted: string | null; claimed: number | null; granted: number | null }[] } | null
  insurances: { cover: string; insurer: string | null; end_date: string }[] | null
  warnings: string[]
}

const count = <T>(rows: T[], f: (r: T) => string) => {
  const m: Record<string, number> = {}
  for (const r of rows) m[f(r)] = (m[f(r)] ?? 0) + 1
  return m
}

export async function collectAuto(job: Job, rep: Pick<ProgressReport, 'period_start' | 'period_end'>): Promise<AutoData> {
  const today = todayIso()
  const start = rep.period_start ?? addDaysIso(today, -28)
  const end = rep.period_end ?? today
  const warnings: string[] = []
  const safe = async <T>(label: string, f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f()
    } catch (e) {
      warnings.push(`${label}: ${(e as Error).message}`)
      return null
    }
  }
  const [prog, rfis, subs, samples, proc, vos, eot, ins] = await Promise.all([
    safe('Programme', () => loadProgramme(job.id)),
    safe('RFIs', () => loadRfis({ kind: 'job', id: job.id })),
    safe('Submittals', () => loadSubmittals(job.id)),
    safe('Sampling', async () => {
      const r = await supabase.from('samples').select('status, sample_type').eq('job_id', job.id)
      if (r.error) throw new Error(r.error.message)
      return r.data as { status: string }[]
    }),
    safe('Procurement', async () => {
      const r = await supabase.from('procurement_items').select('description, display_name, status, required_on_site, section').eq('job_id', job.id)
      if (r.error) throw new Error(r.error.message)
      return r.data as { description: string; display_name: string | null; status: string; required_on_site: string | null; section: string }[]
    }),
    safe('Variations', async () => {
      const r = await supabase.from('variations').select('status').eq('job_id', job.id)
      if (r.error) throw new Error(r.error.message)
      return r.data as { status: string }[]
    }),
    safe('EOT', async () => {
      const r = await supabase.from('eot_claims').select('claim_no, status, submitted_date, days_claimed, days_granted').eq('job_id', job.id).order('claim_no')
      if (r.error) throw new Error(r.error.message)
      return r.data as { claim_no: number; status: string; submitted_date: string | null; days_claimed: number | null; days_granted: number | null }[]
    }),
    safe('Insurances', async () => {
      const r = await supabase.from('company_insurances').select('cover, insurer, end_date').order('end_date')
      if (r.error) throw new Error(r.error.message)
      return r.data as { cover: string; insurer: string | null; end_date: string }[]
    }),
  ])

  let programme: AutoData['programme'] = null
  if (prog) {
    const tasks = prog.tasks.filter((t) => !t.milestone)
    const inProgress = tasks.filter((t) => t.start_date <= end && t.finish_date >= start && (t.progress ?? 0) < 100)
    const next = tasks.filter((t) => t.start_date > end && t.start_date <= addDaysIso(end, 28)).sort((a, b) => a.start_date.localeCompare(b.start_date))
    programme = {
      commencement: tasks.length ? tasks.map((t) => t.start_date).sort()[0] : (job.start_date ?? null),
      contractCompletion: job.pc_date ?? null,
      estimated: tasks.length ? tasks.map((t) => t.finish_date).sort().at(-1)! : null,
      now: inProgress.slice(0, 25).map((t) => ({ code: t.code, name: t.name, start: t.start_date, finish: t.finish_date, progress: t.progress ?? null, rag: t.rag ?? null })),
      next: next.slice(0, 25).map((t) => ({ code: t.code, name: t.name, start: t.start_date, finish: t.finish_date })),
      milestones: prog.tasks.filter((t) => t.milestone && t.start_date >= start).sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(0, 10).map((t) => ({ code: t.code, name: t.name, date: t.start_date })),
    }
  }
  const rfiRows = rfis?.rfis ?? null
  const subRows = subs?.items ?? null
  return {
    programme,
    rfis: rfiRows && {
      rows: rfiRows,
      open: rfiRows.filter((r) => r.status === 'open').length,
      answered: rfiRows.filter((r) => r.status === 'answered').length,
      overdue: rfiRows.filter((r) => r.status === 'open' && r.due_date && r.due_date < today).length,
      closedInPeriod: rfiRows.filter((r) => r.closed_at && r.closed_at.slice(0, 10) >= start && r.closed_at.slice(0, 10) <= end).length,
    },
    submittals: subRows && {
      rows: subRows,
      out: subRows.filter((s) => s.status === 'out').length,
      overdue: subRows.filter((s) => s.status === 'out' && s.due_date && s.due_date < today).length,
      respondedInPeriod: subRows.filter((s) => s.responded_at && s.responded_at.slice(0, 10) >= start && s.responded_at.slice(0, 10) <= end).length,
    },
    sampling: samples && { counts: count(samples, (s) => s.status), total: samples.length },
    procurement: proc && {
      counts: count(proc.filter((p) => p.section === 'contract'), (p) => p.status),
      total: proc.filter((p) => p.section === 'contract').length,
      upcoming: proc
        .filter((p) => p.section === 'contract' && ['not_started', 'enquiry_out', 'quotes_in', 'recommended'].includes(p.status) && p.required_on_site && p.required_on_site <= addDaysIso(today, 70))
        .sort((a, b) => (a.required_on_site ?? '').localeCompare(b.required_on_site ?? ''))
        .slice(0, 12)
        .map((p) => ({ name: p.display_name || p.description, onSite: p.required_on_site, status: p.status })),
    },
    variations: vos && { counts: count(vos, (v) => v.status), total: vos.length },
    eot: eot && { claims: eot.map((c) => ({ no: c.claim_no, status: c.status, submitted: c.submitted_date, claimed: c.days_claimed, granted: c.days_granted })) },
    insurances: ins,
    warnings,
  }
}

export const STATUS_WORDS: Record<string, string> = {
  not_started: 'Not started', enquiry_out: 'Enquiry out', quotes_in: 'Quotes in', recommended: 'Recommended', ordered: 'Ordered', on_site: 'On site', complete: 'Complete', covered: 'Covered', nothing_to_order: 'Nothing to order',
  not_requested: 'Not requested', requested: 'Requested', submitted: 'Submitted', approved: 'Approved', approved_with_comments: 'Approved with comments', rejected_resubmit: 'Rejected, resubmit',
  not_issued: 'Not issued', issued: 'Issued', agreed: 'Agreed', rejected: 'Rejected', draft: 'Draft', notified: 'Notified', claimed: 'Claimed', granted: 'Granted',
}
export const word = (s: string) => STATUS_WORDS[s] ?? s
export const countsLine = (c: Record<string, number>) =>
  Object.entries(c)
    .map(([k, n]) => `${n} ${word(k).toLowerCase()}`)
    .join(', ')
