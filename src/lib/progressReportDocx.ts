// The progress report as an editable Word file (23 Nov): the same sections and numbering as the PDF, with the text the PM can
// carry on editing. Photos and appendices are only in the combined PDF.
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { todayIso, ukDate } from './format'
import { countsLine, mergeContent, numbering, sectionOn, word, type AutoData, type ProgressReport } from './progressReports'
import type { Job } from './types'

export async function buildReportDocx(a: { job: Job; report: ProgressReport; auto: AutoData; preparedBy: string; clientName: string | null }): Promise<Blob> {
  const { job, report, auto } = a
  const c = mergeContent(report.content)
  const on = report.sections
  const num = numbering(on)
  const kids: (Paragraph | Table)[] = []
  const p = (t: string, o: { bold?: boolean; italics?: boolean; size?: number; after?: number } = {}) =>
    new Paragraph({ spacing: { after: o.after ?? 120 }, children: [new TextRun({ text: t, bold: o.bold, italics: o.italics, size: o.size })] })
  const body = (t: string) => {
    for (const para of t.replace(/\r/g, '').split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)) kids.push(p(para))
  }
  const h1 = (n: string, t: string) => kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 }, children: [new TextRun({ text: n ? `${n}  ${t}` : t })] }))
  const h2 = (n: string, t: string) => kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: n ? `${n}  ${t}` : t })] }))
  const bullets = (items: string[]) => items.map((x) => x.trim()).filter(Boolean).forEach((x) => kids.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun(x)] })))
  const table = (head: string[], rows: string[][]) => {
    if (!rows.length) return
    const cell = (t: string, bold = false) => new TableCell({ width: { size: 100 / head.length, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: t, bold, size: 18 })] })] })
    kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: head.map((h) => cell(h, true)) }), ...rows.map((r) => new TableRow({ children: r.map((t) => cell(t)) }))] }))
    kids.push(p('', { after: 80 }))
  }

  // cover
  kids.push(new Paragraph({ spacing: { before: 1200, after: 200 }, children: [new TextRun({ text: `Progress report ${report.report_no}`, bold: true, size: 56 })] }))
  kids.push(p(`${job.job_no} ${job.code}`, { size: 30 }))
  kids.push(p(job.name, { bold: true, size: 40 }))
  if (job.site_address) kids.push(p(job.site_address.replace(/\n/g, ', '), { size: 24 }))
  kids.push(p('', { after: 400 }))
  for (const [k, v] of [['Client', a.clientName ?? ''], ['Period', `${ukDate(report.period_start)} to ${ukDate(report.period_end)}`], ['Prepared by', a.preparedBy], ['Date', ukDate(report.issued_on ?? todayIso())]] as [string, string][])
    if (v.trim()) kids.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(v)] }))

  h1('', 'Summary')
  const e = auto.eot?.claims.at(-1)
  table(
    ['', 'Status'],
    [
      ['Programme', auto.programme?.estimated ? `Estimated completion ${ukDate(auto.programme.estimated)} (contract ${auto.programme.contractCompletion ? ukDate(auto.programme.contractCompletion) : 'not set'})` : 'Not available'],
      ['Health and safety', `RIDDOR ${c.hs.riddor || '0'}, accidents ${c.hs.accidents || '0'}${c.hs.score ? `, audit ${c.hs.score}` : ''}`],
      ['Variations', auto.variations ? `${auto.variations.total} in all: ${countsLine(auto.variations.counts)}` : 'Not available'],
      ['Extension of time', e ? `Claim ${e.no}: ${word(e.status)}` : 'No claims'],
      ['RFIs', auto.rfis ? `${auto.rfis.open} open, ${auto.rfis.overdue} overdue` : 'Not available'],
      ['Submittals', auto.submittals ? `${auto.submittals.out} out for review, ${auto.submittals.overdue} overdue` : 'Not available'],
    ],
  )
  h2('', 'Key issues')
  if (c.keyIssues.some((x) => x.trim())) bullets(c.keyIssues)
  else kids.push(p('None recorded for this period.', { italics: true }))

  if (sectionOn(on, 'programme')) {
    const n = num.programme
    h1(n, 'Programme and progress')
    h2(`${n}.1`, 'Programme')
    for (const [k, v] of [['Revision', c.programme.revision], ['Commencement', auto.programme?.commencement ? ukDate(auto.programme.commencement) : ''], ['Contract completion', auto.programme?.contractCompletion ? ukDate(auto.programme.contractCompletion) : ''], ['Estimated completion', auto.programme?.estimated ? ukDate(auto.programme.estimated) : '']] as [string, string][])
      if (v) kids.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(v)] }))
    if (auto.programme?.now.length) table(['Ref', 'Activity in progress', 'Start', 'Finish', '%'], auto.programme.now.map((t) => [t.code, t.name, ukDate(t.start), ukDate(t.finish), t.progress == null ? '' : `${t.progress}%`]))
    h2(`${n}.2`, 'Progress this period')
    body(c.programme.progress || 'No commentary this period.')
    h2(`${n}.3`, 'Look-ahead')
    body(c.programme.lookahead || 'No commentary.')
    if (auto.programme?.next.length) table(['Ref', 'Starting in the next four weeks', 'Start', 'Finish'], auto.programme.next.map((t) => [t.code, t.name, ukDate(t.start), ukDate(t.finish)]))
    if (c.programme.issues.trim()) {
      h2(`${n}.4`, 'Key issues')
      body(c.programme.issues)
    }
  }
  if (sectionOn(on, 'design')) {
    const n = num.design
    h1(n, 'Design')
    h2(`${n}.1`, 'Submittals summary')
    if (auto.submittals) {
      kids.push(p(`${auto.submittals.rows.length} submittals: ${auto.submittals.out} out for review (${auto.submittals.overdue} overdue), ${auto.submittals.respondedInPeriod} responded to this period.`))
      table(['No.', 'Submittal', 'Trade', 'Return by'], auto.submittals.rows.filter((r) => r.status === 'out').map((r) => [`S${r.number}`, r.title, r.trade ?? '', r.due_date ? ukDate(r.due_date) : '']))
    }
    h2(`${n}.2`, 'Sampling tracker')
    kids.push(p(auto.sampling ? `${auto.sampling.total} items: ${countsLine(auto.sampling.counts)}.` : 'Not available.'))
    h2(`${n}.3`, 'Design queries')
    const q = c.design.queries.split('\n').map((x) => x.replace(/^[-•*]\s*/, ''))
    if (q.some((x) => x.trim())) bullets(q)
    else kids.push(p('None.', { italics: true }))
  }
  if (sectionOn(on, 'procurement')) {
    const n = num.procurement
    h1(n, 'Procurement')
    if (auto.procurement?.total) {
      kids.push(p(`${auto.procurement.total} packages: ${countsLine(auto.procurement.counts)}.`))
      table(['Package', 'Needed on site', 'Status'], auto.procurement.upcoming.map((u) => [u.name, u.onSite ? ukDate(u.onSite) : '', word(u.status)]))
    }
    body(c.procurement.notes)
  }
  if (sectionOn(on, 'information')) {
    const n = num.information
    h1(n, 'Information required')
    if (auto.rfis) {
      kids.push(p(`${auto.rfis.rows.length} RFIs: ${auto.rfis.open} open (${auto.rfis.overdue} overdue), ${auto.rfis.answered} answered and awaiting closure, ${auto.rfis.closedInPeriod} closed this period.`))
      table(['No.', 'RFI', 'Trade', 'Due', 'Status'], auto.rfis.rows.filter((r) => r.status === 'open' || r.status === 'answered').map((r) => [`RFI ${r.number}`, r.title, r.trade ?? '', r.due_date ? ukDate(r.due_date) : '', r.status === 'open' ? 'Open' : 'Answered']))
    }
    body(c.information.notes)
  }
  if (sectionOn(on, 'contract')) {
    const n = num.contract
    h1(n, 'Contract')
    h2(`${n}.1`, 'Status')
    body(c.contract.status || (job.contract_form ?? ''))
    h2(`${n}.2`, 'Insurances')
    if (auto.insurances?.length) table(['Cover', 'Insurer', 'Expires'], auto.insurances.map((i) => [i.cover, i.insurer ?? '', ukDate(i.end_date)]))
    body(c.contract.insurances)
    h2(`${n}.3`, 'Warranties')
    body(c.contract.warranties || 'None recorded.')
  }
  if (sectionOn(on, 'commercial')) {
    const n = num.commercial
    h1(n, 'Commercial')
    kids.push(p(auto.variations ? `Variations: ${auto.variations.total} in all (${countsLine(auto.variations.counts)}).` : 'Variations: not available.'))
    if (auto.eot?.claims.length) table(['Claim', 'Status', 'Submitted', 'Days claimed', 'Days granted'], auto.eot.claims.map((x) => [`EOT ${x.no}`, word(x.status), x.submitted ? ukDate(x.submitted) : '', x.claimed == null ? '' : String(x.claimed), x.granted == null ? '' : String(x.granted)]))
    body(c.commercial.notes)
  }
  if (sectionOn(on, 'site')) {
    const n = num.site
    h1(n, 'Site-specific issues')
    const list = c.siteSpecific.filter((s) => s.heading.trim() || s.text.trim())
    if (!list.length) kids.push(p('None.', { italics: true }))
    list.forEach((s, i) => {
      h2(`${n}.${i + 1}`, s.heading || 'Issue')
      body(s.text)
    })
  }
  if (sectionOn(on, 'hs')) {
    const n = num.hs
    h1(n, 'Health and safety')
    table(['Measure', 'This period'], [['Hours worked', c.hs.hours], ['Operatives inducted', c.hs.inducted], ['RIDDOR reportable', c.hs.riddor], ['Accidents', c.hs.accidents], ['Near misses', c.hs.nearMisses], ['Audits / inspections', c.hs.audits], ['Audit score', c.hs.score]].filter(([, v]) => v))
    body(c.hs.notes)
  }
  void AlignmentType
  const doc = new Document({ creator: 'du Boulay Projects', title: `${job.job_no} ${job.code} Progress report ${report.report_no}`, sections: [{ children: kids }] })
  return Packer.toBlob(doc)
}
