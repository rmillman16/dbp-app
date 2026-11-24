import { MoneyText } from '../components/MoneyInput'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money, todayIso, ukDate } from '../lib/format'
import { cached, must, saveError } from '../lib/offline'
import { lineTotal } from '../lib/variations'
import { acceptQuotation, fullRef, loadQuotation, saveQuotation } from '../lib/quotations'
import { exportQuotationWord } from '../lib/exportQuotation'
import { QUOTE_STATUS_LABELS, type Clause, type Enquiry, type Job, type Quotation, type QuotationClause, type QuotationLine, type QuoteStatus, type TextTemplate } from '../lib/types'
import GroupsEditor from '../components/GroupsEditor'
import { useJob } from './JobLayout'
import { loadEnquiry } from './Estimating'
import { parseSow } from '../lib/sowImport'
import { readPricingPdf } from '../lib/readPdf'
import Loading from '../components/Loading'

// Pricing schedule from a priced SoW in Excel (our SoW template, client / office SoW, or an
// application workbook) or from a PDF read by Claude: every priced line, or one line per
// section with its total. If the PDF can't be read, it asks for the Excel version instead.
type Priced = { section: string | null; sectionTitle: string | null; heading: string | null; description: string; qty: number | null; unit: string | null; rate: number | null; total: number | null }

function toQuotationLines(items: Priced[], mode: 'lines' | 'sections'): QuotationLine[] {
  const r2 = (n: number) => Math.round(n * 100) / 100
  if (mode === 'lines')
    return items.map((l, i) => ({ item: null, heading: l.heading, description: l.description, qty: l.qty ?? 1, unit: l.unit, rate: l.rate ?? l.total, total: l.total, sort: i }))
  const sections = [...new Set(items.map((l) => l.section ?? ''))]
  return sections
    .map((sec, i) => {
      const inSec = items.filter((l) => (l.section ?? '') === sec)
      const total = r2(inSec.reduce((t, l) => t + (l.total ?? 0), 0))
      return { item: null, heading: inSec[0]?.sectionTitle || sec || 'Works', description: '', qty: 1, unit: 'Item', rate: total, total, sort: i }
    })
    .filter((l) => l.total)
}

function PricingImport({ hasLines, onLines }: { hasLines: boolean; onLines: (l: QuotationLine[], replace: boolean) => void }) {
  const [mode, setMode] = useState<'lines' | 'sections'>('lines')
  const [msg, setMsg] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function read(f: File) {
    setMsg(null)
    setWarnings([])
    setBusy(true)
    try {
      let items: Priced[]
      let source: string
      let stated: number | null = null
      const warn: string[] = []
      if (/\.pdf$/i.test(f.name)) {
        setMsg('Reading the PDF… (this can take up to a minute)')
        const p = await readPricingPdf(f)
        items = p.lines.filter((l) => l.total != null).map((l) => ({ ...l, sectionTitle: l.section }))
        source = `${f.name}${p.supplier ? ` (${p.supplier})` : ''}, read by Claude`
        stated = p.document_total
        warn.push(...p.warnings)
        const skipped = p.lines.filter((l) => l.total == null).length
        if (skipped) warn.push(`${skipped} line${skipped > 1 ? 's' : ''} with no figure (e.g. ${p.lines.find((l) => l.total == null)?.note ?? 'Excl'}) left out.`)
      } else {
        const p = await parseSow(await f.arrayBuffer())
        const titles = new Map(p.lines.filter((l) => l.kind === 'section').map((l) => [l.section, l.description]))
        items = p.lines.filter((l) => l.kind === 'item' && !l.below_line && l.total != null).map((l) => ({ ...l, heading: null, sectionTitle: titles.get(l.section) ?? null }))
        source = `${p.sheet} (${p.revision})`
        stated = p.stated_total
      }
      const out = toQuotationLines(items, mode)
      if (!out.length) return setMsg('No priced lines found in that file.')
      const sum = out.reduce((t, l) => t + (l.total ?? 0), 0)
      if (stated != null && Math.abs(stated - sum) > 0.01) warn.push(`The lines add up to ${money(sum)} but the document's total is ${money(stated)}: check before saving.`)
      const replace = hasLines ? confirm(`Replace the current pricing lines with these ${out.length}?\n\nOK = replace, Cancel = add them to the end.`) : true
      onLines(out, replace)
      setMsg(`Imported ${out.length} ${mode === 'lines' ? 'lines' : 'sections'} from ${source}, ${money(sum)}. Check every line, then Save.`)
      setWarnings(warn)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pricing-import">
      <label className="file-button">
        <input type="file" accept=".xlsx,.xlsm,.pdf" disabled={busy} onChange={(e) => (e.target.files?.[0] && read(e.target.files[0]), (e.target.value = ''))} />
        <span className="button">{busy ? 'Reading…' : 'Import from Excel or PDF…'}</span>
      </label>
      <select value={mode} onChange={(e) => setMode(e.target.value as 'lines' | 'sections')}>
        <option value="lines">every priced line</option>
        <option value="sections">one line per section</option>
      </select>
      {msg && <span className="small">{msg}</span>}
      {warnings.length > 0 && (
        <ul className="warning import-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

const DEFAULT_ACCEPTANCE = 'To accept, please sign below and return a copy to du Boulay Projects or respond via email.'

// pricing lines are held as text while editing
interface LineDraft {
  key: number
  heading: string
  description: string
  qty: string
  unit: string
  rate: string
}
let nextKey = 1
const s = (v: unknown) => (v == null ? '' : String(v))
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

function toLine(d: LineDraft, sort: number): QuotationLine {
  const l = { item: null, heading: d.heading.trim() || null, description: d.description.trim(), qty: numOrNull(d.qty), unit: d.unit.trim() || null, rate: numOrNull(d.rate), total: 0, sort }
  l.total = lineTotal(l)
  return l
}

// A job's quotation (inside the job's tabs)…
export default function JobQuotationEditor() {
  const { job } = useJob()
  return <QuotationEditor job={job} backTo={`/jobs/${job.id}/quotations`} />
}

// …or an Estimating one, belonging to an enquiry.
export function EstimatingQuotationEditor() {
  return <QuotationEditor job={null} />
}

function QuotationEditor({ job, backTo }: { job: Job | null; backTo?: string }) {
  const { quoteId } = useParams()
  const navigate = useNavigate()
  const [enquiry, setEnquiry] = useState<Enquiry | null>(null)
  const [q, setQ] = useState<Quotation | null>(null)
  const [lines, setLines] = useState<LineDraft[]>([])
  const [clauses, setClauses] = useState<QuotationClause[]>([])
  const [library, setLibrary] = useState<Clause[]>([])
  const [wording, setWording] = useState<Record<string, TextTemplate>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [accepting, setAccepting] = useState<{ by: string; date: string } | null>(null)

  useEffect(() => {
    loadQuotation(quoteId!).then(
      (d) => {
        // an enquiry's quotation that has since moved into a job opens in the job
        if (!job && d.q.job_id) return navigate(`/jobs/${d.q.job_id}/quotations/${d.q.id}`, { replace: true })
        if (!job && d.q.enquiry_id) loadEnquiry(d.q.enquiry_id).then(setEnquiry, () => {})
        setQ(d.q)
        setLines(d.lines.map((l) => ({ key: nextKey++, heading: s(l.heading), description: l.description, qty: s(l.qty), unit: s(l.unit), rate: s(l.rate) })))
        setClauses(d.clauses)
      },
      (e: Error) => setError(e.message),
    )
    cached('clauses-approved', () => must<Clause[]>(supabase.from('tc_clauses').select('*').eq('approved', true).order('category').order('title'))).then(setLibrary, () => {})
    cached('text-templates', () => must<TextTemplate[]>(supabase.from('text_templates').select('*'))).then(
      (ts) => setWording(Object.fromEntries(ts.map((t) => [t.key, t]))),
      () => {},
    )
  }, [quoteId, job, navigate])

  const priced = useMemo(() => lines.map((l, i) => toLine(l, i)), [lines])
  const total = priced.reduce((sum, l) => sum + lineTotal(l), 0)

  if (error && !q) return <p className="error">{error}</p>
  if (!q) return <Loading />

  const set = <K extends keyof Quotation>(k: K, v: Quotation[K]) => {
    setSaved(false)
    setQ({ ...q, [k]: v })
  }
  const setLine = (key: number, field: keyof LineDraft, v: string) => {
    setSaved(false)
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: v } : l)))
  }
  const acceptance = wording.quotation_acceptance?.body?.trim() || DEFAULT_ACCEPTANCE
  const terms = wording.terms_main?.body ?? ''

  async function save(): Promise<boolean> {
    if (!q) return false
    setError(null)
    if (!navigator.onLine) {
      setError(saveError(new Error('offline')))
      return false
    }
    if (!q.subject.trim()) {
      setError('The quotation needs a subject (what it relates to, e.g. Waterproofing).')
      return false
    }
    setBusy(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, job_id, quote_no, ref, ...editable } = q
      const tidy = (gs: Quotation['scope_groups']) => gs.map((g) => ({ ...g, items: g.items.map((t) => t.trim()).filter(Boolean) })).filter((g) => g.heading.trim() || g.items.length)
      await saveQuotation(q.id, { ...editable, scope_groups: tidy(q.scope_groups), qualification_groups: tidy(q.qualification_groups) }, priced, clauses)
      setSaved(true)
      return true
    } catch (e) {
      setError(saveError(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(status: QuoteStatus) {
    if (!q || !(await save())) return
    const { error } = await supabase.from('quotations').update({ status }).eq('id', q.id)
    if (error) return setError(saveError(error))
    setQ({ ...q, status })
  }

  async function recordAcceptance() {
    if (!q || !accepting) return
    if (!accepting.by.trim()) return setError('Who accepted it? (name, or "by email from …")')
    if (!(await save())) return
    try {
      await acceptQuotation(q, accepting.by.trim(), accepting.date)
      setQ({ ...q, status: 'accepted', accepted_by: accepting.by.trim(), accepted_date: accepting.date })
      setAccepting(null)
    } catch (e) {
      setError(saveError(e))
    }
  }

  async function exportPdf() {
    if (!q) return
    try {
      const { exportQuotationPdf } = await import('../lib/exportQuotationPdf')
      await exportQuotationPdf({ job, owner: job ?? enquiry, q, lines: priced, clauses, acceptanceWording: acceptance, terms })
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function exportWord() {
    if (!q) return
    try {
      await exportQuotationWord({ job, owner: job ?? enquiry, q, lines: priced, clauses, acceptanceWording: acceptance, terms })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const toggleClause = (c: Clause) => {
    setSaved(false)
    setClauses((cs) => (cs.some((x) => x.clause_id === c.id) ? cs.filter((x) => x.clause_id !== c.id) : [...cs, { clause_id: c.id, title: c.title, body: c.body, sort: cs.length }]))
  }

  const field = (k: keyof Quotation, label: string, o: { type?: string; wide?: boolean; hint?: string; placeholder?: string } = {}) => (
    <label className={o.wide ? 'span-2' : ''}>
      {label}
      <input type={o.type ?? 'text'} value={s(q[k])} placeholder={o.placeholder} onChange={(e) => set(k, (e.target.value || null) as never)} />
      {o.hint && <span className="hint">{o.hint}</span>}
    </label>
  )

  return (
    <div className="quote-editor">
      <div className="sub-bar">
        <div>
          <Link to={backTo ?? (enquiry ? `/estimating/e/${enquiry.id}` : '/estimating')} className="link-button small">
            ← All quotations
          </Link>
          <h2>{fullRef(job ?? enquiry, q)}</h2>
          <span className={`q-status ${q.status}`}>{QUOTE_STATUS_LABELS[q.status]}</span>
          {q.status === 'accepted' && (
            <span className="muted small">
              {' '}
              by {q.accepted_by} on {ukDate(q.accepted_date)}
            </span>
          )}
        </div>
        <div className="button-row">
          <button onClick={exportWord}>Export Word</button>
          <button onClick={exportPdf}>Export PDF</button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {saved && <p className="saved">Saved.</p>}

      {/* status actions */}
      <section className="card status-card">
        {q.status === 'draft' && (
          <>
            <span className="muted small">Draft. When it's been sent to the client:</span>
            <button onClick={() => setStatus('issued')}>Mark as issued</button>
          </>
        )}
        {q.status === 'issued' && !accepting && (
          <>
            <span className="muted small">Issued to the client.</span>
            <button className="primary" onClick={() => setAccepting({ by: '', date: todayIso() })}>
              Record acceptance
            </button>
            <button onClick={() => setStatus('rejected')}>Rejected</button>
            <button onClick={() => setStatus('withdrawn')}>Withdrawn</button>
          </>
        )}
        {accepting && (
          <div className="accept-form">
            <label>
              Accepted by
              <input value={accepting.by} placeholder='Name, or "email from …"' onChange={(e) => setAccepting({ ...accepting, by: e.target.value })} />
            </label>
            <label>
              Date
              <input type="date" value={accepting.date} onChange={(e) => setAccepting({ ...accepting, date: e.target.value })} />
            </label>
            <button className="primary" onClick={recordAcceptance}>
              Save acceptance{q.variation_id ? ' and set the VO to Agreed' : ''}
            </button>
            <button onClick={() => setAccepting(null)}>Cancel</button>
          </div>
        )}
        {(q.status === 'rejected' || q.status === 'withdrawn' || q.status === 'accepted') && (
          <>
            <span className="muted small">{QUOTE_STATUS_LABELS[q.status]}.</span>
            {q.status !== 'accepted' && <button onClick={() => setStatus('draft')}>Reopen as draft</button>}
          </>
        )}
      </section>

      <section className="card">
        <h2>Details</h2>
        <div className="form-grid">
          <label className="span-2">
            Subject
            <input value={q.subject} placeholder="e.g. Waterproofing & Builder's Works" onChange={(e) => set('subject', e.target.value)} />
            <span className="hint">Shown under QUOTATION and in the reference: {fullRef(job ?? enquiry, q)}</span>
          </label>
          <label className="span-2">
            Opening line
            <span className="opening-line">
              du Boulay Projects is pleased to submit our quotation of <strong>{money(total)} + VAT</strong> for{' '}
              <input value={s(q.summary)} placeholder="the waterproofing and associated builder's works" onChange={(e) => set('summary', e.target.value || null)} /> set out below.
            </span>
          </label>
          {!job && field('project_name', 'Project', { wide: true, placeholder: 'e.g. Norton Folgate glazing', hint: 'No job yet, so name the project here' })}
          {field('client_name', 'Client')}
          {field('client_contact', 'Client contact')}
          {field('prepared_by', 'Prepared by')}
          {field('site', 'Site address', { hint: job ? 'From the job; change if this quote is for somewhere else' : undefined })}
          {field('issued_date', 'Quotation date', { type: 'date' })}
          {field('valid_until', 'Valid until', { type: 'date' })}
          <label className="span-2">
            Why that validity date (optional)
            <input value={s(q.validity_note)} placeholder="e.g. That date is set by the validity of the specialist's price." onChange={(e) => set('validity_note', e.target.value || null)} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>
          <span className="sec-no">01</span> Scope of works
        </h2>
        <label>
          Introduction
          <textarea rows={4} value={s(q.scope)} onChange={(e) => set('scope', e.target.value || null)} />
        </label>
        <GroupsEditor groups={q.scope_groups ?? []} onChange={(g) => set('scope_groups', g)} withStyle addLabel="Add scope group" />
      </section>

      <section className="card">
        <h2>
          <span className="sec-no">02</span> Pricing schedule
        </h2>
        <p className="muted small">Client rates: OHP and prelims are built in (or prelims shown as their own line).</p>
        <PricingImport
          hasLines={lines.length > 0}
          onLines={(imported, replace) => {
            setSaved(false)
            const drafts = imported.map((l) => ({ key: nextKey++, heading: l.heading ?? '', description: l.description, qty: s(l.qty), unit: s(l.unit), rate: s(l.rate) }))
            setLines((ls) => (replace ? drafts : [...ls, ...drafts]))
          }}
        />
        <table className="table buildup quote-lines">
          <thead>
            <tr>
              <th>Item</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Rate £</th>
              <th className="num">Total £</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key} className="line-row">
                <td className="c-no">{i + 1}</td>
                <td className="c-desc">
                  <input value={l.heading} placeholder="Heading (bold), e.g. Waterproofing" onChange={(e) => setLine(l.key, 'heading', e.target.value)} />
                  <textarea rows={2} value={l.description} placeholder="Description" onChange={(e) => setLine(l.key, 'description', e.target.value)} />
                </td>
                <td className="c-qty" data-label="Qty">
                  <input type="number" step="any" inputMode="decimal" className="qty" value={l.qty} onChange={(e) => setLine(l.key, 'qty', e.target.value)} />
                </td>
                <td className="c-unit" data-label="Unit">
                  <input className="unit" value={l.unit} onChange={(e) => setLine(l.key, 'unit', e.target.value)} />
                </td>
                <td className="c-rate" data-label="Rate £">
                  <MoneyText className="rate" value={l.rate} onChange={(v) => setLine(l.key, 'rate', v)} />
                </td>
                <td className="num c-total" data-label="Total">
                  {money(lineTotal({ qty: numOrNull(l.qty), rate: numOrNull(l.rate) }))}
                </td>
                <td className="c-del">
                  <button type="button" className="small-button" onClick={() => (setSaved(false), setLines((ls) => ls.filter((x) => x.key !== l.key)))} title="Remove line">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            <tr className="section-row">
              <td colSpan={7}>
                <button type="button" className="small-button" onClick={() => (setSaved(false), setLines((ls) => [...ls, { key: nextKey++, heading: '', description: '', qty: '1', unit: 'Item', rate: '' }]))}>
                  + Add line
                </button>
              </td>
            </tr>
            <tr className="grand-row">
              <td colSpan={5}>Total (excluding VAT)</td>
              <td className="num">{money(total)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>
          <span className="sec-no">03</span> Qualifications & exclusions
        </h2>
        <GroupsEditor groups={q.qualification_groups ?? []} onChange={(g) => set('qualification_groups', g)} addLabel="Add group (e.g. Assumptions)" />

        <h3 className="sub-head">Additional conditions from the clause library</h3>
        {library.length === 0 ? (
          <p className="muted small">No legally reviewed clauses in the library yet (Templates › Clause library).</p>
        ) : (
          <div className="clause-picks">
            {[...new Set(library.map((c) => c.category || 'Other'))].map((cat) => {
              const inCat = library.filter((c) => (c.category || 'Other') === cat)
              const allOn = inCat.every((c) => clauses.some((x) => x.clause_id === c.id))
              return (
                <div key={cat} className="clause-group">
                  <div className="clause-group-head">
                    <strong>{cat}</strong>
                    <button
                      type="button"
                      className="link-button small"
                      onClick={() =>
                        allOn ? inCat.forEach((c) => toggleClause(c)) : inCat.filter((c) => !clauses.some((x) => x.clause_id === c.id)).forEach((c) => toggleClause(c))
                      }
                    >
                      {allOn ? 'Untick all' : 'Tick all'}
                    </button>
                  </div>
                  {inCat.map((c) => {
                    const picked = clauses.find((x) => x.clause_id === c.id)
                    return (
                      <div key={c.id} className={`clause-pick ${picked ? 'on' : ''}`}>
                        <label className="check">
                          <span>
                            <input type="checkbox" checked={!!picked} onChange={() => toggleClause(c)} /> {c.title}
                          </span>
                        </label>
                        {picked && (
                          <textarea
                            rows={1}
                            style={{ overflow: 'hidden', resize: 'none' }}
                            ref={(el) => {
                              if (el) {
                                el.style.height = 'auto'
                                el.style.height = el.scrollHeight + 2 + 'px'
                              }
                            }}
                            value={picked.body}
                            onChange={(e) => (setSaved(false), setClauses((cs) => cs.map((x) => (x.clause_id === c.id ? { ...x, body: e.target.value } : x))))}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="card">
        <h2>
          <span className="sec-no">04</span> Validity & acceptance
        </h2>
        <p className="preview-text">
          This quotation is valid until <strong>{q.valid_until ? ukDate(q.valid_until) : '…'}</strong>. {q.validity_note ? q.validity_note.replace(/\.?$/, '. ') : ''}After it, prices may need to be reconfirmed.
          <br />
          {acceptance}
        </p>
        <p className="muted small">Followed by the sign-off box (name, company, position, signature, date). The acceptance wording is set in Templates › Wording.</p>
      </section>

      <section className="card">
        <h2>
          <span className="sec-no">A</span> Appendices and T&Cs
        </h2>
        <label>
          Appendices (optional)
          <textarea rows={8} value={s(q.appendices)} onChange={(e) => set('appendices', e.target.value || null)} placeholder={'# Waterproofing specification\nIntro paragraph…\n## A.1 Design basis\n- First point\n- Second point'} />
          <span className="hint">
            Start each appendix with <code># Title</code> (becomes "Appendix A — Title"); <code>## </code> for a sub-heading, <code>- </code> for a bullet, <code>**bold**</code>. Drawings and photos: attach them separately for now.
          </span>
        </label>
        <label className="check">
          <span>
            <input type="checkbox" checked={q.include_terms} onChange={(e) => set('include_terms', e.target.checked)} /> Attach the standard terms and conditions
          </span>
        </label>
        {q.include_terms && !terms.trim() && <p className="warning">The standard T&Cs haven't been written yet (Templates › Wording), so nothing will be attached.</p>}
        <label>
          Internal notes (never on the quotation)
          <textarea rows={3} value={s(q.notes)} onChange={(e) => set('notes', e.target.value || null)} />
        </label>
      </section>

      {error && <p className="error">{error}</p>}
      {saved && <p className="saved">Saved.</p>}
      <div className="form-actions">
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={exportWord}>Export Word</button>
          <button onClick={exportPdf}>Export PDF</button>
      </div>
    </div>
  )
}
