import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { todayIso, ukDate } from '../lib/format'
import { saveError } from '../lib/offline'
import { useAccess } from '../lib/access'
import { downloadBlob } from '../lib/letter'
import { supabase } from '../lib/supabase'
import { loadProgramme, listRevisions } from '../lib/programme'
import { revName } from '../lib/timelineFormat'
import { loadRfi, loadRfis } from '../lib/rfis'
import { loadSubmittals, loadSubmittal } from '../lib/submittals'
import { useRfiContext } from '../lib/rfiContext'
import type { SubmittalRow } from '../lib/exportSubmittals'
import {
  REPORT_STATUS,
  SECTIONS,
  addReportFile,
  collectAuto,
  countsLine,
  deleteReport,
  loadReport,
  mergeContent,
  numbering,
  openReportFile,
  removeReportFile,
  sectionOn,
  updateReport,
  updateReportFile,
  word,
  type AutoData,
  type Content,
  type ProgressReport,
  type ReportFile,
  type ReportStatus,
  type SectionsOn,
} from '../lib/progressReports'
import { buildReportPdf } from '../lib/progressReportPdf'
import { buildReportDocx } from '../lib/progressReportDocx'
import { useJob } from './JobLayout'

// Job › Progress reports › one report: the period, which sections are in, the narrative, photos, appendices; and the PDF / Word.
export default function ProgressReportPage() {
  const { job } = useJob()
  const { reportId } = useParams()
  const navigate = useNavigate()
  const { me } = useAccess()
  const owner = useMemo(() => ({ kind: 'job' as const, id: job.id }), [job.id])
  const ctx = useRfiContext(owner)
  const [report, setReport] = useState<ProgressReport | null>(null)
  const [files, setFiles] = useState<ReportFile[]>([])
  const [content, setContent] = useState<Content | null>(null)
  const [sections, setSections] = useState<SectionsOn>({})
  const [period, setPeriod] = useState<{ start: string; end: string }>({ start: '', end: '' })
  const [auto, setAuto] = useState<AutoData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [state, setState] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [busy, setBusy] = useState<string | null>(null)
  const loaded = useRef(false)

  useEffect(() => {
    loaded.current = false
    loadReport(reportId!).then(
      (d) => {
        setReport(d.report)
        setFiles(d.files)
        setContent(mergeContent(d.report.content))
        setSections(d.report.sections ?? {})
        setPeriod({ start: d.report.period_start ?? '', end: d.report.period_end ?? '' })
        setTimeout(() => (loaded.current = true), 0)
      },
      (e: Error) => setError(e.message),
    )
  }, [reportId])

  const refreshAuto = (p = period) =>
    collectAuto(job, { period_start: p.start || null, period_end: p.end || null }).then(setAuto, (e: Error) => setError(e.message))
  useEffect(() => {
    if (report) refreshAuto()
  }, [report?.id, period.start, period.end]) // eslint-disable-line react-hooks/exhaustive-deps

  // saved a moment after you stop typing
  const readOnly = report?.status === 'issued'
  useEffect(() => {
    if (!loaded.current || !report || !content || readOnly) return
    setState('unsaved')
    const t = setTimeout(async () => {
      setState('saving')
      try {
        await updateReport(report.id, { content, sections, period_start: period.start || null, period_end: period.end || null })
        setState('saved')
      } catch (e) {
        setError(saveError(e))
        setState('unsaved')
      }
    }, 1500)
    return () => clearTimeout(t)
  }, [content, sections, period.start, period.end]) // eslint-disable-line react-hooks/exhaustive-deps

  // the programme's issued revisions, for the revision dropdown
  const [revs, setRevs] = useState<string[]>([])
  useEffect(() => {
    loadProgramme(job.id)
      .then((p) => (p.programme ? listRevisions(p.programme.id) : []))
      .then((l) => setRevs(l.map((r) => revName(r.rev_no))))
      .catch(() => setRevs([]))
  }, [job.id])
  const [dragHs, setDragHs] = useState(false) // keep with the other hooks: above the early returns
  if (error && !report) return <p className="error">{error}</p>
  if (!report || !content) return <p className="muted">Loading…</p>
  const num = numbering(sections)
  const setC = (patch: Partial<Content>) => setContent((c) => (c ? { ...c, ...patch } : c))
  const setSection = <K extends keyof Content>(k: K, patch: Partial<Content[K]>) => setContent((c) => (c ? { ...c, [k]: { ...(c[k] as object), ...patch } } : c))
  const personName = (id: string | null) => ctx.profileName(id)

  async function run(key: string, f: () => Promise<void>) {
    setError(null)
    setMsg(null)
    setBusy(key)
    try {
      await f()
    } catch (e) {
      setError(saveError(e))
    }
    setBusy(null)
  }
  async function status(s: ReportStatus) {
    await run('status', async () => {
      const r = await updateReport(report!.id, { content: content!, sections, period_start: period.start || null, period_end: period.end || null, status: s, issued_on: s === 'issued' ? todayIso() : s === 'draft' ? null : report!.issued_on, approved_by: s === 'approved' || s === 'issued' ? (report!.approved_by ?? me?.id ?? null) : null })
      setReport(r)
      setState('saved')
    })
  }

  // the reports need the open RFIs (with their replies) and the submittals out for review
  async function gather() {
    const rfis = await loadRfis(owner)
    const open = rfis.rfis.filter((r) => r.status === 'open' || r.status === 'answered')
    const rfiRows = await Promise.all(
      open.map(async (r) => {
        const d = await loadRfi(r.id)
        return ctx.rowFor(d.rfi, d.people, d.responses)
      }),
    )
    const subs = await loadSubmittals(job.id)
    const out = subs.items.filter((s) => s.status === 'out')
    const submittalRows: SubmittalRow[] = await Promise.all(
      out.map(async (s) => {
        const d = await loadSubmittal(s.id)
        const sb = ctx.dir.find((x) => x.id === d.s.submitted_by)
        return {
          s: d.s,
          submittedBy: sb ? `${sb.name}${sb.company && sb.company !== sb.name ? ` (${sb.company})` : ''}` : '',
          reviewers: d.people.filter((p) => p.role === 'reviewer').map(ctx.nameOf).filter(Boolean).join(', '),
          cc: '',
          manager: ctx.profileName(d.s.manager_id),
          revisions: d.revisions,
        }
      }),
    )
    return { rfiRows, submittalRows }
  }
  async function meta() {
    const client = job.client_company_id ? await supabase.from('companies').select('name').eq('id', job.client_company_id).maybeSingle() : null
    return { preparedBy: personName(report!.prepared_by) || me?.full_name || '', clientName: (client?.data?.name as string | undefined) ?? null }
  }
  const fileBase = `${job.job_no} ${job.code} Progress report ${report.report_no}`

  async function pdf() {
    await run('pdf', async () => {
      setMsg('Building the PDF (fetching the photos and appendices)…')
      const a = auto ?? (await collectAuto(job, { period_start: period.start || null, period_end: period.end || null }))
      const g = await gather()
      const m = await meta()
      const live = { ...report!, content, sections, period_start: period.start || null, period_end: period.end || null }
      const r = await buildReportPdf({ job, report: live, auto: a, files, ...m, ...g, onProgress: setMsg })
      downloadBlob(new Blob([r.bytes as BlobPart], { type: 'application/pdf' }), `${fileBase}.pdf`)
      setMsg(`Downloaded ${fileBase}.pdf.${r.warnings.length ? ' Notes: ' + r.warnings.join(' ') : ''}`)
    })
  }
  async function docx() {
    await run('docx', async () => {
      const a = auto ?? (await collectAuto(job, { period_start: period.start || null, period_end: period.end || null }))
      const m = await meta()
      const live = { ...report!, content, sections, period_start: period.start || null, period_end: period.end || null }
      downloadBlob(await buildReportDocx({ job, report: live, auto: a, ...m }), `${fileBase}.docx`)
      setMsg(`Downloaded ${fileBase}.docx (text and tables; photos and appendices are in the PDF).`)
    })
  }
  async function upload(kind: 'photo' | 'appendix', list: File[], title = '') {
    await run('up' + kind, async () => {
      const added: ReportFile[] = []
      let sort = Math.max(-1, ...files.filter((f) => f.kind === kind).map((f) => f.sort)) + 1
      for (const f of list) added.push(await addReportFile(report!.id, kind, f, title, sort++))
      setFiles((l) => [...l, ...added])
    })
  }
  const move = async (f: ReportFile, dir: -1 | 1) => {
    const same = files.filter((x) => x.kind === f.kind).sort((a, b) => a.sort - b.sort)
    const i = same.findIndex((x) => x.id === f.id)
    const other = same[i + dir]
    if (!other) return
    await run('mv', async () => {
      await updateReportFile(f.id, { sort: other.sort })
      await updateReportFile(other.id, { sort: f.sort })
      setFiles((l) => l.map((x) => (x.id === f.id ? { ...x, sort: other.sort } : x.id === other.id ? { ...x, sort: f.sort } : x)))
    })
  }
  const photos = files.filter((f) => f.kind === 'photo').sort((a, b) => a.sort - b.sort)
  const appendices = files.filter((f) => f.kind === 'appendix').sort((a, b) => a.sort - b.sort)
  const ro = !!readOnly

  const area = (label: string, value: string, onChange: (v: string) => void, rows = 5, hint?: string) => (
    <label className="span-2">
      {label}
      <textarea rows={rows} value={value} disabled={ro} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
  const autoLine = (t: string | null | undefined) => (t ? <p className="muted small rpt-auto">Pulled in automatically: {t}</p> : null)

  return (
    <div className="quote-editor rpt-page">
      <div className="sub-bar">
        <div>
          <Link to={`/jobs/${job.id}/progress`} className="link-button small">
            ← All reports
          </Link>
          <h2>Progress report {report.report_no}</h2>
          <span className={`q-status rpt-${report.status}`}>{REPORT_STATUS[report.status]}</span>{' '}
          <span className="muted small">{state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Unsaved changes…' : 'Saved'}</span>
        </div>
        <div className="button-row">
          <button disabled={!!busy} onClick={docx}>
            {busy === 'docx' ? 'Making…' : 'Word'}
          </button>
          <button className="primary" disabled={!!busy} onClick={pdf}>
            {busy === 'pdf' ? 'Building…' : 'Combined PDF'}
          </button>
          {report.status === 'draft' && (
            <button disabled={!!busy} onClick={() => status('approved')}>
              Mark approved
            </button>
          )}
          {report.status === 'approved' && (
            <button disabled={!!busy} onClick={() => confirm('Mark this report as issued? It is locked once issued.') && status('issued')}>
              Mark issued
            </button>
          )}
          {report.status !== 'draft' && (
            <button disabled={!!busy} onClick={() => status('draft')}>
              Back to draft
            </button>
          )}
          {report.status === 'draft' && (
            <button disabled={!!busy} onClick={() => confirm(`Delete draft report ${report.report_no}?`) && run('del', async () => { await deleteReport(report.id); navigate(`/jobs/${job.id}/progress`) })}>
              Delete
            </button>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}
      {ro && <p className="pqq-warning">This report is issued, so it's locked. Use "Back to draft" to change it.</p>}
      {auto?.warnings.length ? <p className="pqq-warning small">Some information couldn't be pulled in: {auto.warnings.join(' ')}</p> : null}

      <section className="card">
        <h2>Period and sections</h2>
        <div className="form-grid">
          <label>
            Period from
            <input type="date" disabled={ro} value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} />
          </label>
          <label>
            Period to
            <input type="date" disabled={ro} value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} />
          </label>
        </div>
        <p className="muted small">Switch a section off for this job and the numbering closes up. What's pulled in from the app follows the period above.</p>
        <div className="rpt-sections">
          {SECTIONS.map((s) => (
            <label key={s.key} title={s.hint}>
              <input type="checkbox" disabled={ro} checked={sectionOn(sections, s.key)} onChange={(e) => setSections({ ...sections, [s.key]: e.target.checked })} /> {num[s.key] ? `${num[s.key]}. ` : ''}
              {s.title}
            </label>
          ))}
        </div>
        <button type="button" className="small-button" onClick={() => refreshAuto()}>
          Refresh what's pulled in from the app
        </button>
      </section>

      <section className="card">
        <h2>Summary: key issues</h2>
        <p className="muted small">Three to five lines, one per line. They sit on the summary page with the status tiles (programme, health and safety, variations, EOT, RFIs, submittals).</p>
        <textarea rows={5} disabled={ro} value={content.keyIssues.join('\n')} onChange={(e) => setC({ keyIssues: e.target.value.split('\n') })} />
      </section>

      {sectionOn(sections, 'programme') && (
        <section className="card">
          <h2>{num.programme} Programme and progress</h2>
          <div className="form-grid">
            <label className="span-2">
              Programme revision
              <select disabled={ro} value={content.programme.revision} onChange={(e) => setSection('programme', { revision: e.target.value })}>
                <option value="">{revs.length ? 'Choose a revision…' : 'No revisions saved in the programme yet'}</option>
                {content.programme.revision && !revs.includes(content.programme.revision) && <option value={content.programme.revision}>{content.programme.revision}</option>}
                {revs.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            {area(`${num.programme}.2 Progress this period`, content.programme.progress, (v) => setSection('programme', { progress: v }), 7)}
            {area(`${num.programme}.${photos.length ? 4 : 3} Look-ahead`, content.programme.lookahead, (v) => setSection('programme', { lookahead: v }), 5)}
            {area('Key issues (programme)', content.programme.issues, (v) => setSection('programme', { issues: v }), 3)}
          </div>
          {auto?.programme && autoLine(`${auto.programme.now.length} activities in progress, ${auto.programme.next.length} starting in the next four weeks, estimated completion ${auto.programme.estimated ? ukDate(auto.programme.estimated) : 'not available'}`)}
          <h3 className="sub-head">Photos ({photos.length})</h3>
          <ul className="rpt-files">
            {photos.map((f, i) => (
              <li key={f.id}>
                <button type="button" className="link-button small" onClick={() => openReportFile(f.path).catch((e) => setError((e as Error).message))}>
                  {f.file_name}
                </button>
                <input disabled={ro} defaultValue={f.caption ?? ''} placeholder="Caption" onBlur={(e) => e.target.value !== (f.caption ?? '') && updateReportFile(f.id, { caption: e.target.value || null }).then(() => setFiles((l) => l.map((x) => (x.id === f.id ? { ...x, caption: e.target.value || null } : x))))} />
                {!ro && (
                  <span className="appendix-buttons">
                    <button type="button" className="small-button" disabled={i === 0} onClick={() => move(f, -1)}>↑</button>
                    <button type="button" className="small-button" disabled={i === photos.length - 1} onClick={() => move(f, 1)}>↓</button>
                    <button type="button" className="small-button" onClick={() => confirm('Remove this photo?') && run('rm', async () => { await removeReportFile(f); setFiles((l) => l.filter((x) => x.id !== f.id)) })}>✕</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!ro && (
            <label className="file-button">
              <input type="file" accept="image/jpeg,image/png" multiple onChange={(e) => { const l = [...(e.target.files ?? [])]; e.target.value = ''; if (l.length) upload('photo', l) }} />
              <span className="button small-button">{busy === 'upphoto' ? 'Uploading…' : '+ Add photos (JPG or PNG)'}</span>
            </label>
          )}
        </section>
      )}

      {sectionOn(sections, 'design') && (
        <section className="card">
          <h2>{num.design} Design</h2>
          {auto?.sampling && autoLine(`sampling: ${countsLine(auto.sampling.counts)}`)}
          <div className="form-grid">{area(`${num.design}.2 Design queries`, content.design.queries, (v) => setSection('design', { queries: v }), 5, 'One per line.')}</div>
        </section>
      )}
      {sectionOn(sections, 'procurement') && (
        <section className="card">
          <h2>{num.procurement} Procurement</h2>
          {auto?.procurement && autoLine(`${auto.procurement.total} packages (${countsLine(auto.procurement.counts)}), ${auto.procurement.upcoming.length} needed soon and not yet ordered`)}
          <div className="form-grid">{area('Notes', content.procurement.notes, (v) => setSection('procurement', { notes: v }), 4)}</div>
        </section>
      )}
      {sectionOn(sections, 'information') && (
        <section className="card">
          <h2>{num.information} Information required</h2>
          {auto?.rfis && autoLine(`${auto.rfis.rows.length} RFIs: ${auto.rfis.open} open (${auto.rfis.overdue} overdue), ${auto.rfis.answered} answered; the RFI report is appended`)}
          {auto?.submittals && autoLine(`${auto.submittals.rows.length} submittals (${auto.submittals.out} out for review, ${auto.submittals.overdue} overdue); the submittals report is appended`)}
          <div className="form-grid">{area('Notes', content.information.notes, (v) => setSection('information', { notes: v }), 4)}</div>
        </section>
      )}
      {sectionOn(sections, 'contract') && (
        <section className="card">
          <h2>{num.contract} Contract</h2>
          {auto?.insurances && autoLine(`${auto.insurances.length} insurances with their expiry dates`)}
          <div className="form-grid">
            {area(`${num.contract}.1 Status`, content.contract.status, (v) => setSection('contract', { status: v }), 3)}
            {area(`${num.contract}.2 Insurances (notes)`, content.contract.insurances, (v) => setSection('contract', { insurances: v }), 3)}
            {area(`${num.contract}.3 Warranties`, content.contract.warranties, (v) => setSection('contract', { warranties: v }), 3)}
          </div>
        </section>
      )}
      {sectionOn(sections, 'commercial') && (
        <section className="card">
          <h2>{num.commercial} Commercial</h2>
          {autoLine(`variations ${auto?.variations ? countsLine(auto.variations.counts) : 'n/a'}; EOT ${auto?.eot?.claims.length ? auto.eot.claims.map((c) => `claim ${c.no} ${word(c.status).toLowerCase()}`).join(', ') : 'no claims'}. No values, CVR or margin ever appear here`)}
          <div className="form-grid">{area('Notes', content.commercial.notes, (v) => setSection('commercial', { notes: v }), 3)}</div>
        </section>
      )}
      {sectionOn(sections, 'site') && (
        <section className="card">
          <div className="pane-head">
            <h2>{num.site} Site-specific issues</h2>
            {!ro && (
              <button type="button" className="small-button" onClick={() => setC({ siteSpecific: [...content.siteSpecific, { heading: '', text: '' }] })}>
                + Add a heading
              </button>
            )}
          </div>
          <p className="muted small">Headings for this job (e.g. base build, client direct contractors, environmental, access). They carry over to the next report.</p>
          {content.siteSpecific.map((s, i) => (
            <div key={i} className="form-grid rpt-site">
              <label className="span-2">
                {num.site}.{i + 1} Heading
                <input disabled={ro} value={s.heading} onChange={(e) => setC({ siteSpecific: content.siteSpecific.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)) })} />
              </label>
              {area('Text', s.text, (v) => setC({ siteSpecific: content.siteSpecific.map((x, j) => (j === i ? { ...x, text: v } : x)) }), 4)}
              {!ro && (
                <button type="button" className="small-button" onClick={() => setC({ siteSpecific: content.siteSpecific.filter((_, j) => j !== i) })}>
                  Remove this heading
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {sectionOn(sections, 'hs') && (
        <section className="card">
          <h2>{num.hs} Health and safety</h2>
          <div className="form-grid three">
            {(
              [
                ['hours', 'Hours worked'],
                ['inducted', 'Operatives inducted'],
                ['riddor', 'RIDDOR reportable'],
                ['accidents', 'Accidents'],
                ['nearMisses', 'Near misses'],
                ['audits', 'Audits / inspections'],
                ['score', 'Audit score'],
              ] as [keyof Content['hs'], string][]
            ).map(([k, l]) => (
              <label key={k}>
                {l}
                <input disabled={ro} value={content.hs[k]} onChange={(e) => setSection('hs', { [k]: e.target.value })} />
              </label>
            ))}
            {area('Notes', content.hs.notes, (v) => setSection('hs', { notes: v }), 3)}
          </div>
          <h3 className="sub-head">Inndex inspection report</h3>
          {appendices.filter((f) => f.name.startsWith('Inndex')).map((f) => (
            <p key={f.id} className="small">
              <button type="button" className="link-button" onClick={() => openReportFile(f.path).catch((e) => setError((e as Error).message))}>{f.file_name}</button>{' '}
              {!ro && <button type="button" className="small-button" onClick={() => confirm(`Remove ${f.file_name}?`) && run('rm', async () => { await removeReportFile(f); setFiles((l) => l.filter((x) => x.id !== f.id)) })}>✕</button>}
            </p>
          ))}
          {!ro && (
            <label
              className={'drop-zone' + (dragHs ? ' dragging' : '')}
              onDragOver={(e) => { e.preventDefault(); setDragHs(true) }}
              onDragLeave={() => setDragHs(false)}
              onDrop={(e) => { e.preventDefault(); setDragHs(false); const l = [...e.dataTransfer.files]; if (l.length) upload('appendix', l, 'Inndex inspection report') }}
            >
              <input type="file" accept="application/pdf,image/jpeg,image/png" multiple onChange={(e) => { const l = [...(e.target.files ?? [])]; e.target.value = ''; if (l.length) upload('appendix', l, 'Inndex inspection report') }} />
              {busy === 'upappendix' ? 'Uploading…' : 'Drag the Inndex inspection report here, or click to choose it'}
              <span className="muted small"> It goes into the combined PDF as an appendix.</span>
            </label>
          )}
        </section>
      )}

      <section className="card">
        <h2>Appendices</h2>
        <p className="muted small">Numbered A, B, C… in this order and merged into the combined PDF, each titled on its first page. PDFs, JPGs and PNGs can go in.</p>
        <div className="rpt-sections">
          <label>
            <input type="checkbox" disabled={ro} checked={content.autoAppendices.rfis} onChange={(e) => setC({ autoAppendices: { ...content.autoAppendices, rfis: e.target.checked } })} /> RFI report (RFIs still unanswered, with replies)
          </label>
          <label>
            <input type="checkbox" disabled={ro} checked={content.autoAppendices.submittals} onChange={(e) => setC({ autoAppendices: { ...content.autoAppendices, submittals: e.target.checked } })} /> Submittals out for review
          </label>
        </div>
        <ul className="rpt-files">
          {appendices.map((f, i) => (
            <li key={f.id}>
              <input disabled={ro} defaultValue={f.name} aria-label="Appendix title" onBlur={(e) => e.target.value.trim() && e.target.value !== f.name && updateReportFile(f.id, { name: e.target.value.trim() }).then(() => setFiles((l) => l.map((x) => (x.id === f.id ? { ...x, name: e.target.value.trim() } : x))))} />
              <button type="button" className="link-button small" onClick={() => openReportFile(f.path).catch((e) => setError((e as Error).message))}>
                {f.file_name}
              </button>
              {!ro && (
                <span className="appendix-buttons">
                  <button type="button" className="small-button" disabled={i === 0} onClick={() => move(f, -1)}>↑</button>
                  <button type="button" className="small-button" disabled={i === appendices.length - 1} onClick={() => move(f, 1)}>↓</button>
                  <button type="button" className="small-button" onClick={() => confirm(`Remove ${f.name}?`) && run('rm', async () => { await removeReportFile(f); setFiles((l) => l.filter((x) => x.id !== f.id)) })}>✕</button>
                </span>
              )}
            </li>
          ))}
        </ul>
        {!ro && (
          <label className="file-button">
            <input type="file" accept="application/pdf,image/jpeg,image/png" multiple onChange={(e) => { const l = [...(e.target.files ?? [])]; e.target.value = ''; if (l.length) upload('appendix', l) }} />
            <span className="button small-button">{busy === 'upappendix' ? 'Uploading…' : '+ Add appendix files'}</span>
          </label>
        )}
      </section>
    </div>
  )
}
