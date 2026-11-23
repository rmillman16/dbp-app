import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { money } from '../lib/format'
import { saveError } from '../lib/offline'
import { lineAmount, loadCompanies, loadNotice, loadOrder, noticeTotals, orderLabel, parsePasted, runChecks, saveNotice, PAYMENT_DAYS, type Column } from '../lib/subcontracts'
import { addDaysIso } from '../lib/format'
import { exportPaymentNotice } from '../lib/exportPaymentNotice'
import { readApplicationPdf } from '../lib/readPdf'
import type { Adjustment, Block, Company, Order, PaymentNotice, SubAppLine, SubApplication, SubVariation } from '../lib/types'
import { useJob } from './JobLayout'
import OmOutstanding from '../components/OmOutstanding'

const BLOCKS: [Block, string][] = [
  ['measured', 'Contract works (measured)'],
  ['materials', 'Materials on site'],
  ['variations', 'Variations'],
]
const pctText = (p: number | null) => (p == null ? '' : String(Math.round(p * 10000) / 100))
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

export default function PaymentNoticeEditor() {
  const { job } = useJob()
  const { orderId, noticeId } = useParams()
  const [order, setOrder] = useState<Order | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [vars, setVars] = useState<SubVariation[]>([])
  const [notices, setNotices] = useState<PaymentNotice[]>([])
  const [pn, setPn] = useState<PaymentNotice | null>(null)
  const [app, setApp] = useState<SubApplication | null>(null)
  const [lines, setLines] = useState<SubAppLine[]>([])
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [paste, setPaste] = useState<{ block: Block; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const [o, n, cs] = await Promise.all([loadOrder(orderId!), loadNotice(noticeId!), loadCompanies()])
        setOrder(o.order)
        setVars(o.vars)
        setNotices(o.notices)
        setCompany(cs.find((c) => c.id === o.order.company_id) ?? null)
        setPn(n.pn)
        setApp(n.app)
        setLines(n.lines)
        setAdjustments(n.adjustments)
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [orderId, noticeId])

  const previous = useMemo(() => (pn ? (notices.find((n) => n.notice_no === pn.notice_no - 1) ?? null) : null), [notices, pn])
  const totals = useMemo(() => (pn ? noticeTotals(pn, lines, adjustments, previous) : null), [pn, lines, adjustments, previous])
  const checks = useMemo(
    () => (order && app && pn && totals ? runChecks({ order, app, lines, vars, totals, hasPrevious: !!previous, pn }) : []),
    [order, app, lines, vars, totals, previous, pn],
  )

  if (error && !pn) return <p className="error">{error}</p>
  if (!order || !pn || !app || !totals || !company) return <p className="muted">Loading…</p>

  const dirty = () => setMsg(null)
  const setP = <K extends keyof PaymentNotice>(k: K, v: PaymentNotice[K]) => (dirty(), setPn({ ...pn, [k]: v }))
  const setA = <K extends keyof SubApplication>(k: K, v: SubApplication[K]) => (dirty(), setApp({ ...app, [k]: v }))
  const setLine = (i: number, patch: Partial<SubAppLine>) => (
    dirty(),
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l
        const n = { ...l, ...patch }
        return { ...n, amount: lineAmount(n) }
      }),
    )
  )
  const addLines = (block: Block, add: SubAppLine[]) => (
    dirty(),
    setLines((ls) => [...ls.filter((l) => l.block !== block || l.description || l.value != null), ...add].map((l, i) => ({ ...l, sort: i })))
  )

  async function save() {
    if (!pn || !app || !totals) return
    setError(null)
    if (!navigator.onLine) return setError(saveError(new Error('offline')))
    setBusy(true)
    try {
      await saveNotice(pn, app, lines, adjustments, checks, totals)
      setMsg('Saved.')
    } catch (e) {
      setError(saveError(e))
    } finally {
      setBusy(false)
    }
  }

  async function exportXlsx() {
    if (!pn || !app || !totals || !order || !company) return
    try {
      await exportPaymentNotice({ job, order, company, pn, app, lines, adjustments, totals, previousPaidOnPrevious: Number(previous?.previously_paid ?? 0) })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function readPdf(file: File) {
    setError(null)
    setMsg('Reading the PDF… (this can take up to a minute)')
    try {
      const r = await readApplicationPdf(file)
      setLines(r.lines.map((l, i) => ({ ...l, amount: lineAmount(l), sort: i })))
      setApp((a) =>
        a
          ? {
              ...a,
              stated_gross: r.stated_gross ?? a.stated_gross,
              stated_previous: r.stated_previous ?? a.stated_previous,
              stated_due: r.stated_due ?? a.stated_due,
              app_date: r.app_date ?? a.app_date,
            }
          : a,
      )
      setMsg(`Read ${r.lines.length} lines from ${file.name}. Check them against the PDF, then Save.${r.warnings.length ? ' Claude noted: ' + r.warnings.join(' ') : ''}`)
    } catch (e) {
      setMsg(null)
      setError((e as Error).message)
    }
  }

  const issues = checks.filter((c) => c.level === 'issue')
  const notes = checks.filter((c) => c.level === 'note')

  return (
    <div className="quote-editor pn-editor">
      <div className="sub-bar">
        <div>
          <Link to={`/jobs/${job.id}/payment-notices/${order.id}`} className="link-button small">
            ← {orderLabel(order, company)}
          </Link>
          <h2>
            Application {app.app_no} → Payment Notice {pn.notice_no}
          </h2>
          <span className={`q-status ${pn.status === 'issued' ? 'accepted' : ''}`}>{pn.status === 'issued' ? 'Issued' : 'Draft'}</span>
        </div>
        <div className="button-row">
          <button onClick={exportXlsx}>Export Excel</button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="saved">{msg}</p>}

      <div className="app-top">
        <section className="card">
          <h2>Payment notice</h2>
          <NoticeTable totals={totals} prevNo={pn.notice_no - 1} sub={company.name} />
        </section>
        <section className={`card checks ${issues.length ? 'has-issues' : ''}`}>
          <h2>Checks</h2>
          {checks.length === 0 && <p className="ok">No problems found.</p>}
          {issues.length > 0 && (
            <ul>
              {issues.map((c) => (
                <li key={c.text} className="issue">
                  {c.text}
                </li>
              ))}
            </ul>
          )}
          {notes.length > 0 && (
            <ul>
              {notes.map((c) => (
                <li key={c.text} className="note">
                  {c.text}
                </li>
              ))}
            </ul>
          )}
          <OmOutstanding jobId={job.id} orderId={orderId!} />
        </section>
      </div>

      <section className="card">
        <div className="pane-head">
          <h2>{company.name}'s application</h2>
          <label className="file-button">
            <input type="file" accept=".pdf" onChange={(e) => (e.target.files?.[0] && readPdf(e.target.files[0]), (e.target.value = ''))} />
            <span className="button">Read their PDF…</span>
          </label>
        </div>
        <div className="form-grid three">
          <label>
            Their application date
            <input type="date" value={app.app_date ?? ''} onChange={(e) => setA('app_date', e.target.value || null)} />
          </label>
          <label>
            Received
            <input type="date" value={app.received_date ?? ''} onChange={(e) => setA('received_date', e.target.value || null)} />
          </label>
          <div />
          <label>
            Their gross to date £
            <input type="number" step="any" value={app.stated_gross ?? ''} onChange={(e) => setA('stated_gross', numOrNull(e.target.value))} />
          </label>
          <label>
            Their "previous" £
            <input type="number" step="any" value={app.stated_previous ?? ''} onChange={(e) => setA('stated_previous', numOrNull(e.target.value))} />
          </label>
          <label>
            Their amount due £
            <input type="number" step="any" value={app.stated_due ?? ''} onChange={(e) => setA('stated_due', numOrNull(e.target.value))} />
          </label>
        </div>

        {BLOCKS.map(([block, title]) => {
          const idx = lines.map((l, i) => [l, i] as const).filter(([l]) => l.block === block)
          return (
            <div key={block} className="pn-block">
              <div className="pane-head">
                <h3 className="sub-head">{title}</h3>
                <div className="button-row">
                  <button className="small-button" onClick={() => setPaste(paste?.block === block ? null : { block, text: '' })}>
                    Paste rows from Excel
                  </button>
                  <button
                    className="small-button"
                    onClick={() =>
                      addLines(block, [
                        {
                          block,
                          heading: idx.at(-1)?.[0].heading ?? null,
                          item_ref: null,
                          description: '',
                          value: null,
                          pct: null,
                          amount: 0,
                          their_amount: null,
                          note: null,
                          sort: 0,
                        },
                      ])
                    }
                  >
                    + Line
                  </button>
                </div>
              </div>
              {paste?.block === block && (
                <div className="paste-box">
                  <textarea
                    rows={6}
                    value={paste.text}
                    placeholder={'Copy the rows from their Excel and paste here. Columns: ref | description | value | % | amount\n(rows with no value become headings)'}
                    onChange={(e) => setPaste({ block, text: e.target.value })}
                  />
                  <button
                    className="primary small-button"
                    onClick={() => {
                      const add = parsePasted(paste.text, block)
                      if (!add.length) return setError('No rows with a value found in what was pasted.')
                      addLines(block, add)
                      setPaste(null)
                      setMsg(`Added ${add.length} lines. Check them, then Save.`)
                    }}
                  >
                    Add these rows
                  </button>
                </div>
              )}
              {idx.length === 0 ? (
                <p className="muted small">None.</p>
              ) : (
                <table className="table pn-lines">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Description</th>
                      <th className="num">Value £</th>
                      <th className="num">Their %</th>
                      <th className="num">Their £</th>
                      <th>DuB note</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {idx.map(([l, i], k) => (
                      <Fragment key={i}>
                        {l.heading && l.heading !== idx[k - 1]?.[0].heading && (
                          <tr key={`h${i}`} className="sec-row">
                            <td colSpan={7}>{l.heading}</td>
                          </tr>
                        )}
                        <tr className="line-row">
                          <td className="c-ref" data-label="Ref">
                            <input value={l.item_ref ?? ''} onChange={(e) => setLine(i, { item_ref: e.target.value || null })} />
                          </td>
                          <td className="c-desc">
                            <input value={l.description ?? ''} onChange={(e) => setLine(i, { description: e.target.value })} />
                          </td>
                          <td className="c-qty" data-label="Value £">
                            <input type="number" step="any" inputMode="decimal" value={l.value ?? ''} onChange={(e) => setLine(i, { value: numOrNull(e.target.value) })} />
                          </td>
                          <td className="c-unit" data-label="Their %">
                            <input
                              type="number"
                              step="any"
                              inputMode="decimal"
                              value={pctText(l.pct)}
                              onChange={(e) => setLine(i, { pct: e.target.value === '' ? null : Number(e.target.value) / 100 })}
                            />
                          </td>
                          <td className="c-rate" data-label="Their £">
                            <input
                              type="number"
                              step="any"
                              inputMode="decimal"
                              value={l.their_amount ?? ''}
                              placeholder={l.value != null && l.pct != null ? String(Math.round(l.value * l.pct * 100) / 100) : ''}
                              onChange={(e) => setLine(i, { their_amount: numOrNull(e.target.value) })}
                            />
                          </td>
                          <td className="c-note" data-label="Note">
                            <input value={l.note ?? ''} onChange={(e) => setLine(i, { note: e.target.value || null })} />
                          </td>
                          <td className="c-del">
                            <button className="small-button" onClick={() => (dirty(), setLines((ls) => ls.filter((_, j) => j !== i)))} title="Remove line">
                              ✕
                            </button>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                    <tr className="subtotal-row">
                      <td colSpan={2}>Total</td>
                      <td className="num">{money(idx.reduce((s, [l]) => s + Number(l.value ?? 0), 0))}</td>
                      <td />
                      <td className="num">{money(idx.reduce((s, [l]) => s + lineAmount(l), 0))}</td>
                      <td colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
        <p className="muted small">"Their £" is what they claim; leave it blank to use % × value. Lines where the two disagree show in Checks.</p>
      </section>

      <section className="card">
        <div className="pane-head">
          <h2>DuB adjustments</h2>
          <button className="small-button" onClick={() => (dirty(), setAdjustments([...adjustments, { block: 'measured', description: '', amount: 0, sort: adjustments.length }]))}>
            + Adjustment
          </button>
        </div>
        <p className="muted small">Where DBP's assessment differs from theirs, e.g. "Prelims assessed at the stated 25% (£1,000), not 30% (£1,200) as claimed": −200.</p>
        {adjustments.map((a, i) => (
          <div key={i} className="adj-row">
            <select value={a.block} onChange={(e) => (dirty(), setAdjustments(adjustments.map((x, j) => (j === i ? { ...x, block: e.target.value as Block } : x))))}>
              <option value="measured">Contract works</option>
              <option value="variations">Variations</option>
              <option value="materials">Materials on site</option>
            </select>
            <input
              value={a.description}
              placeholder="Why"
              onChange={(e) => (dirty(), setAdjustments(adjustments.map((x, j) => (j === i ? { ...x, description: e.target.value } : x))))}
            />
            <input
              type="number"
              step="any"
              value={a.amount}
              onChange={(e) => (dirty(), setAdjustments(adjustments.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value || 0) } : x))))}
            />
            <button className="small-button" onClick={() => (dirty(), setAdjustments(adjustments.filter((_, j) => j !== i)))}>
              ✕
            </button>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Notice details</h2>
        <div className="form-grid three">
          <label>
            Notice date
            <input type="date" value={pn.notice_date ?? ''} onChange={(e) => setP('notice_date', e.target.value || null)} />
          </label>
          <label>
            Valuation due date
            <input
              type="date"
              value={pn.valuation_date ?? ''}
              onChange={(e) => {
                const v = e.target.value || null
                dirty()
                setPn({ ...pn, valuation_date: v, payment_due_date: v ? addDaysIso(v, PAYMENT_DAYS) : pn.payment_due_date })
              }}
            />
          </label>
          <label>
            Payment due date
            <input type="date" value={pn.payment_due_date ?? ''} onChange={(e) => setP('payment_due_date', e.target.value || null)} />
            <span className="hint">Valuation date + {PAYMENT_DAYS} days</span>
          </label>
          <label>
            dbp payment date
            <input type="date" value={pn.dbp_payment_date ?? ''} onChange={(e) => setP('dbp_payment_date', e.target.value || null)} />
          </label>
          <label>
            Loss and expense £
            <input type="number" step="any" value={pn.loss_and_expense ?? ''} onChange={(e) => setP('loss_and_expense', numOrNull(e.target.value))} />
          </label>
          <label>
            Contra charges notified £
            <input type="number" step="any" value={pn.contra_charges ?? ''} onChange={(e) => setP('contra_charges', numOrNull(e.target.value))} />
            <span className="hint">Enter as a positive figure; it's deducted</span>
          </label>
          <label>
            Retention %
            <input type="number" step="any" value={pn.retention_pct ?? ''} onChange={(e) => setP('retention_pct', numOrNull(e.target.value))} />
          </label>
          <label>
            Previously paid £
            <input
              type="number"
              step="any"
              value={pn.previously_paid ?? ''}
              placeholder={String(-totals.dub.previouslyPaid)}
              onChange={(e) => setP('previously_paid', numOrNull(e.target.value))}
            />
            <span className="hint">Blank = the previous notice after retention ({money(-totals.dub.previouslyPaid)})</span>
          </label>
          <label>
            Status
            <select value={pn.status} onChange={(e) => setP('status', e.target.value as PaymentNotice['status'])}>
              <option value="draft">Draft</option>
              <option value="issued">Issued</option>
            </select>
          </label>
        </div>

        {!previous && pn.notice_no > 1 && (
          <>
            <h3 className="sub-head">Payment Notice {pn.notice_no - 1} (made outside the app)</h3>
            <p className="muted small">Its figures before retention, for the "previous application" and movement columns.</p>
            <div className="form-grid three">
              {(
                [
                  ['prev_measured', 'Measured works £'],
                  ['prev_variations', 'Variations £'],
                  ['prev_materials', 'Materials on site £'],
                  ['prev_loss_and_expense', 'Loss and expense £'],
                  ['prev_contra', 'Contra charges £'],
                ] as const
              ).map(([k, label]) => (
                <label key={k}>
                  {label}
                  <input type="number" step="any" value={pn[k] ?? ''} onChange={(e) => setP(k, numOrNull(e.target.value))} />
                </label>
              ))}
            </div>
          </>
        )}
        <label>
          Notes printed on the notice
          <textarea
            rows={3}
            value={pn.notes ?? ''}
            onChange={(e) => setP('notes', e.target.value || null)}
            placeholder="e.g. Previous: Payment Notice 1 = 10% deposit £14,425.80 less 5% retention, paid £13,704.51."
          />
        </label>
      </section>

      <div className="form-actions">
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={exportXlsx}>Export Excel</button>
      </div>
    </div>
  )
}

// The front page on screen: their valuation, DuB assessment, previous notice, movement.
function NoticeTable({ totals: t, prevNo, sub }: { totals: ReturnType<typeof noticeTotals>; prevNo: number; sub: string }) {
  const rows: [keyof Column, string, boolean?][] = [
    ['measured', 'Measured works'],
    ['variations', 'Variations'],
    ['materials', 'Materials on site'],
    ['lossAndExpense', 'Loss and expense'],
    ['contra', 'Contra charges'],
    ['gross', 'Gross', true],
    ['retention', `Retention ${t.retentionPct}%`],
    ['subTotal', 'Sub total', true],
    ['previouslyPaid', 'Previously paid'],
    ['due', 'Total due (excl. VAT)', true],
  ]
  return (
    <table className="table fs-table">
      <thead>
        <tr>
          <th />
          <th className="num">{sub}</th>
          <th className="num">DuB assessment</th>
          <th className="num">Previous ({prevNo})</th>
          <th className="num">Movement</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, label, bold]) => (
          <tr key={k} className={bold ? 'fs-bold' : ''}>
            <td>{label}</td>
            <td className="num">{money(t.theirs[k])}</td>
            <td className="num">{money(t.dub[k])}</td>
            <td className="num">{money(t.previous[k])}</td>
            <td className="num">{money(t.dub[k] - t.previous[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
