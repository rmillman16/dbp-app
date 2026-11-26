// Client applications (valuations), as 2611 Application 2 R2:
// Anticipated Final Account front sheet, priced SoW with application % and Client
// Assessment, and the VO summary.
import { supabase } from './supabase'
import { cached, must } from './offline'
import { todayIso } from './format'
import { projectedValue, type VoWithLines } from './variations'
import { suggestTasks } from './cashflowCalc'
import type { ProgrammeTask } from './programme'
import type { Application, ApplicationLine, Job, SowLine, SowRevision } from './types'
import type { ParsedSow } from './sowImport'

const r2 = (n: number) => Math.round(n * 100) / 100

// "Application 2 R2"
export const appName = (a: Pick<Application, 'app_no' | 'revision'>) => `Application ${a.app_no} R${a.revision}`

// ---------- priced SoW ----------
export async function loadCurrentSow(jobId: string) {
  return cached(`sow:${jobId}`, async () => {
    const revs = await must<SowRevision[]>(supabase.from('sow_revisions').select('*').eq('job_id', jobId).eq('is_current', true).order('imported_at', { ascending: false }).limit(1))
    const rev = revs[0] ?? null
    const lines = rev ? await loadSowLines(rev.id) : []
    return { rev, lines }
  })
}

// a particular revision (an application stays priced against the revision it was made with)
export async function loadSowRevision(revisionId: string) {
  return cached(`sow-rev:${revisionId}`, async () => ({
    rev: await must<SowRevision>(supabase.from('sow_revisions').select('*').eq('id', revisionId).single()),
    lines: await loadSowLines(revisionId),
  }))
}

async function loadSowLines(revisionId: string) {
  // more than 1,000 lines comes back in pages
  const out: SowLine[] = []
  for (let from = 0; ; from += 1000) {
    const page = await must<SowLine[]>(supabase.from('sow_lines').select('*').eq('revision_id', revisionId).order('sort').range(from, from + 999))
    out.push(...page)
    if (page.length < 1000) return out
  }
}

// Saves an imported SoW as the job's current revision; returns the new sow_lines (in order).
export async function importSow(job: Job, p: ParsedSow, fileName: string, kind: 'office' | 'client') {
  const off = await supabase.from('sow_revisions').update({ is_current: false }).eq('job_id', job.id)
  if (off.error) throw off.error
  const rev = await supabase
    .from('sow_revisions')
    .insert({ job_id: job.id, revision: p.revision, kind, file_name: fileName, total: p.total, is_current: true })
    .select('*')
    .single()
  if (rev.error) throw rev.error
  const rows = p.lines.map((l) => ({
    revision_id: rev.data.id,
    kind: l.kind,
    section: l.section,
    item_ref: l.item_ref,
    description: l.description,
    qty: l.qty,
    unit: l.unit,
    rate: l.rate,
    total: l.total,
    total_text: l.total_text,
    below_line: l.below_line,
    sort: l.sort,
  }))
  const saved: SowLine[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const ins = await supabase.from('sow_lines').insert(rows.slice(i, i + 500)).select('*')
    if (ins.error) throw ins.error
    saved.push(...(ins.data as SowLine[]))
  }
  saved.sort((a, b) => a.sort - b.sort)
  return { rev: rev.data as SowRevision, lines: saved }
}

// ---------- applications ----------
export async function loadApplications(jobId: string) {
  return cached(`apps:${jobId}`, () => must<Application[]>(supabase.from('applications').select('*').eq('job_id', jobId).order('app_no').order('revision')))
}

export async function loadApplication(id: string) {
  return cached(`app:${id}`, async () => ({
    app: await must<Application>(supabase.from('applications').select('*').eq('id', id).single()),
    lines: await must<ApplicationLine[]>(supabase.from('application_lines').select('*').eq('application_id', id)),
  }))
}

// the latest revision of each application number
export function latestRevisions(apps: Application[]) {
  const byNo = new Map<number, Application>()
  for (const a of apps) if (!byNo.has(a.app_no) || byNo.get(a.app_no)!.revision < a.revision) byNo.set(a.app_no, a)
  return [...byNo.values()].sort((a, b) => a.app_no - b.app_no)
}

// The application before this one (latest revision of app_no − 1), for "previous" columns.
export function previousOf(app: Pick<Application, 'app_no'>, apps: Application[]) {
  return latestRevisions(apps).filter((a) => a.app_no < app.app_no).pop() ?? null
}

async function insertApplication(row: Partial<Application>, lines: ApplicationLine[]) {
  const ins = await supabase.from('applications').insert(row).select('id').single()
  if (ins.error) throw ins.error
  const id = ins.data.id as string
  const withId = lines.map(({ id: _drop, application_id: _a, ...l }) => ({ ...l, application_id: id })) // eslint-disable-line @typescript-eslint/no-unused-vars
  for (let i = 0; i < withId.length; i += 500) {
    const r = await supabase.from('application_lines').insert(withId.slice(i, i + 500))
    if (r.error) throw r.error
  }
  return id
}

// Next application: percentages carried forward from the previous one (they're cumulative);
// "less previous paid" starts at what's been paid so far (or the previous total claimed).
// Once practical completion has been reached it stays reached: later applications carry it on (retention stays halved).
export async function createApplication(job: Job, sowRevisionId: string, apps: Application[], opts: { practicalCompletion?: boolean; finalAccount?: boolean } = {}) {
  const prev = latestRevisions(apps).pop() ?? null
  let lines: ApplicationLine[] = []
  let previouslyPaid = 0
  if (prev) {
    const p = await loadApplication(prev.id)
    // the percentages are cumulative, so they carry on; so does what the client last certified (Client Assessment) and the comments,
    // which the user can clear (Applications, 26 Nov)
    lines = p.lines.map((l) => ({ ...l }))
    previouslyPaid = latestRevisions(apps).reduce((s, a) => s + Number(a.paid_amount ?? 0), 0)
  }
  return insertApplication(
    {
      job_id: job.id,
      app_no: (prev?.app_no ?? 0) + 1,
      revision: 1,
      status: 'draft',
      valuation_date: todayIso(),
      sow_revision_id: sowRevisionId,
      retention_pct: job.retention_pct,
      practical_completion: !!(opts.practicalCompletion ?? prev?.practical_completion),
      // only sent when ticked, so applications still work before script 087
      ...(opts.finalAccount ? { final_account: true } : {}),
      previously_paid: previouslyPaid,
      materials_on_site: prev?.materials_on_site ?? 0,
      vat_pct: 20,
    },
    lines,
  )
}

// Application N from an imported workbook's "dbp Application N %" and Assessment columns.
export async function createApplicationFromImport(job: Job, sowRevisionId: string, p: ParsedSow, sowLines: SowLine[], previouslyPaid: number) {
  const lines: ApplicationLine[] = []
  p.lines.forEach((pl, i) => {
    if (pl.kind !== 'item' || (pl.app_pct == null && pl.client_pct == null && !pl.app_comment)) return
    const sl = sowLines[i]
    lines.push({
      sow_line_id: sl.id,
      variation_id: null,
      pct_claimed: pl.app_pct,
      amount_claimed: pl.app_pct != null ? r2(pl.app_pct * (sl.total ?? 0)) : null,
      client_pct: pl.client_pct,
      client_amount: pl.client_pct != null ? r2(pl.client_pct * (sl.total ?? 0)) : null,
      comment: pl.app_comment,
      client_comment: null,
    })
  })
  return insertApplication(
    { job_id: job.id, app_no: p.app_no ?? 1, revision: 1, status: 'submitted', valuation_date: todayIso(), sow_revision_id: sowRevisionId, retention_pct: job.retention_pct, previously_paid: previouslyPaid, vat_pct: 20 },
    lines,
  )
}

// R2, R3…: a copy to revise; the earlier revision stays as it was sent.
export async function newRevision(app: Application, apps: Application[]) {
  const { lines } = await loadApplication(app.id)
  const top = Math.max(...apps.filter((a) => a.app_no === app.app_no).map((a) => a.revision))
  const { id: _id, ...rest } = app // eslint-disable-line @typescript-eslint/no-unused-vars
  return insertApplication({ ...rest, revision: top + 1, status: 'draft', client_certified: null, paid_amount: null, paid_date: null, submitted_date: null }, lines)
}

export async function saveApplication(app: Application, lines: ApplicationLine[]) {
  const { id, ...rest } = app
  const u = await supabase.from('applications').update(rest).eq('id', id)
  if (u.error) throw u.error
  const d = await supabase.from('application_lines').delete().eq('application_id', id)
  if (d.error) throw d.error
  const keep = lines.filter((l) => l.pct_claimed != null || l.client_pct != null || l.comment || l.client_comment)
  const rows = keep.map(({ id: _drop, ...l }) => ({ ...l, application_id: id })) // eslint-disable-line @typescript-eslint/no-unused-vars
  for (let i = 0; i < rows.length; i += 500) {
    const r = await supabase.from('application_lines').insert(rows.slice(i, i + 500))
    if (r.error) throw r.error
  }
}

// ---------- the front sheet (Anticipated Final Account) ----------
export interface FrontSheet {
  contractSum: number
  psum: number
  variations: number // firm where priced, budget until then
  afa: number
  construction: number
  voClaimed: number
  mos: number
  lossAndExpense: number
  totalApplication: number
  retentionPct: number // after halving at practical completion
  retention: number // negative
  afterRetention: number
  deposits: number // negative
  totalClaimed: number
  lessPrevious: number // negative
  outstanding: number
  vatPct: number
  vat: number
  totalOutstanding: number
}

export function frontSheet(
  job: Job,
  app: Application,
  sow: SowLine[],
  lines: ApplicationLine[],
  vos: VoWithLines[],
  which: 'dbp' | 'client' = 'dbp',
): FrontSheet {
  const pctOf = (l: ApplicationLine) => (which === 'dbp' ? l.pct_claimed : l.client_pct) ?? 0
  const sowById = new Map(sow.map((s) => [s.id, s]))
  let construction = 0
  let voClaimed = 0
  for (const l of lines) {
    if (l.sow_line_id) {
      const s = sowById.get(l.sow_line_id)
      if (s && !s.below_line) construction += r2(pctOf(l) * Number(s.total ?? 0))
    } else if (l.variation_id) {
      const v = vos.find((x) => x.vo.id === l.variation_id)
      if (v?.build.priced && v.vo.status !== 'rejected') voClaimed += r2(pctOf(l) * v.build.total)
    }
  }
  const contractSum = Number(job.contract_sum ?? 0)
  const psum = Number(app.psum_adjustment ?? 0)
  const variations = vos.reduce((s, v) => s + projectedValue(v.vo, v.build), 0)
  const mos = Number(app.materials_on_site ?? 0)
  const lossAndExpense = Number(app.loss_and_expense ?? 0)
  const totalApplication = construction + voClaimed + mos + lossAndExpense
  const fullRet = Number(app.retention_pct ?? job.retention_pct)
  const retentionPct = app.practical_completion ? fullRet / 2 : fullRet
  const retention = -totalApplication * (retentionPct / 100)
  const afterRetention = totalApplication + retention
  const deposits = -Number(app.deposit ?? 0)
  const totalClaimed = afterRetention + deposits
  const lessPrevious = -Number(app.previously_paid ?? 0)
  const outstanding = totalClaimed + lessPrevious
  const vatPct = Number(app.vat_pct ?? 20)
  const vat = outstanding * (vatPct / 100)
  return {
    contractSum,
    psum,
    variations,
    afa: contractSum + psum + variations,
    construction,
    voClaimed,
    mos,
    lossAndExpense,
    totalApplication,
    retentionPct,
    retention,
    afterRetention,
    deposits,
    totalClaimed,
    lessPrevious,
    outstanding,
    vatPct,
    vat,
    totalOutstanding: outstanding + vat,
  }
}

// ---------- progress from the programme (26 Nov) ----------
// For a SoW section: the programme activities whose names match it, and their average progress weighted by how long each lasts.
export function programmeProgress(label: string, tasks: ProgrammeTask[]): { pct: number; n: number } | null {
  const codes = new Set(suggestTasks(label, tasks))
  const hit = tasks.filter((t) => codes.has(t.code) && !t.milestone)
  if (!hit.length) return null
  const days = (t: ProgrammeTask) => Math.max(1, Math.round((Date.parse(t.finish_date) - Date.parse(t.start_date)) / 86400000) + 1)
  const total = hit.reduce((s, t) => s + days(t), 0)
  const done = hit.reduce((s, t) => s + days(t) * Math.min(100, Math.max(0, t.progress ?? 0)), 0)
  return { pct: Math.round(done / total), n: hit.length }
}

// ---------- the check before an application is issued (26 Nov) ----------
export interface ReviewNote {
  level: 'error' | 'warn' | 'info'
  text: string
}

const refList = (a: string[]) => (a.length > 4 ? `${a.slice(0, 4).join(', ')} and ${a.length - 4} more` : a.join(', '))

export function reviewApplication(i: {
  app: Application
  sow: SowLine[]
  lines: ApplicationLine[]
  prevLines: ApplicationLine[]
  vos: VoWithLines[]
  fs: FrontSheet
  fsPrev: FrontSheet | null
  fsClient: FrontSheet | null
}): ReviewNote[] {
  const notes: ReviewNote[] = []
  const sowById = new Map(i.sow.map((s) => [s.id, s]))
  const prevBy = new Map(i.prevLines.filter((l) => l.sow_line_id).map((l) => [l.sow_line_id!, l]))
  const over: string[] = []
  const down: string[] = []
  let unchanged = 0
  let moved = 0
  for (const l of i.lines) {
    if (!l.sow_line_id) continue
    const s = sowById.get(l.sow_line_id)
    if (!s || s.below_line) continue
    const name = s.item_ref || (s.description ?? '').slice(0, 20)
    const p = l.pct_claimed ?? 0
    const before = prevBy.get(l.sow_line_id)?.pct_claimed ?? 0
    if (p > 1.00001) over.push(name)
    if (p < before - 0.00001) down.push(name)
    if (p > 0) (Math.abs(p - before) < 0.00001 ? unchanged++ : moved++)
  }
  if (i.fs.totalApplication <= 0) notes.push({ level: 'error', text: 'Nothing is claimed yet.' })
  if (over.length) notes.push({ level: 'error', text: `More than 100% claimed on: ${refList(over)}.` })
  if (down.length) notes.push({ level: 'warn', text: `Lower than last time on: ${refList(down)}.` })
  if (!i.app.valuation_date) notes.push({ level: 'warn', text: 'There is no valuation date.' })
  const missingVos = i.vos.filter((v) => v.build.priced && v.vo.status === 'agreed' && !(i.lines.find((l) => l.variation_id === v.vo.id)?.pct_claimed))
  if (missingVos.length) notes.push({ level: 'warn', text: `Agreed variations not yet claimed: ${refList(missingVos.map((v) => 'VO ' + v.vo.vo_no))}.` })
  if (i.fsPrev) {
    const diff = i.fs.totalApplication - i.fsPrev.totalApplication
    if (diff < 0) notes.push({ level: 'warn', text: `The total claimed is £${Math.abs(Math.round(diff)).toLocaleString('en-GB')} lower than last time.` })
    else notes.push({ level: 'info', text: `Up £${Math.round(diff).toLocaleString('en-GB')} since last time (${moved} line${moved === 1 ? '' : 's'} moved, ${unchanged} unchanged).` })
    if (!i.app.previously_paid) notes.push({ level: 'warn', text: '"Less previous paid" is £0 on a later application: check it.' })
  }
  if (i.fsClient && i.fsClient.totalApplication !== i.fs.totalApplication) {
    const d = i.fs.totalApplication - i.fsClient.totalApplication
    notes.push({ level: 'info', text: `Client Assessment is £${Math.abs(Math.round(d)).toLocaleString('en-GB')} ${d > 0 ? 'below' : 'above'} what we are claiming.` })
  }
  if (i.app.practical_completion) notes.push({ level: 'info', text: `Practical completion reached: retention is ${i.fs.retentionPct}%.` })
  if (i.app.status === 'assessed' && i.app.client_certified == null) notes.push({ level: 'warn', text: 'It is marked Certified but the client certified figure has not been entered.' })
  return notes
}
