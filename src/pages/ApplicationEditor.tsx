import MoneyInput from '../components/MoneyInput'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { money, todayIso } from '../lib/format'
import { saveError } from '../lib/offline'
import { loadJobVariations, type VoWithLines } from '../lib/variations'
import { appName, frontSheet, loadApplication, loadApplications, loadSowRevision, newRevision, previousOf, programmeProgress, reviewApplication, saveApplication, type FrontSheet } from '../lib/applications'
import { loadProgramme } from '../lib/programme'
import { exportApplication } from '../lib/exportApplication'
import { APP_STATUS_LABELS, type Application, type ApplicationLine, type AppStatus, type SowLine } from '../lib/types'
import { useJob } from './JobLayout'
import Loading from '../components/Loading'
import { celebrate } from '../lib/celebrate'

const r2 = (n: number) => Math.round(n * 100) / 100
const pctText = (p: number | null | undefined) => (p == null ? '' : String(Math.round(p * 10000) / 100))
const pctVal = (t: string) => (t.trim() === '' ? null : Number(t) / 100)
const sKey = (id: string) => `s:${id}`
const vKey = (id: string) => `v:${id}`

export default function ApplicationEditor() {
  const { appId } = useParams()
  const { job } = useJob()
  const navigate = useNavigate()
  const [app, setApp] = useState<Application | null>(null)
  const [lines, setLines] = useState<Record<string, ApplicationLine>>({})
  const [sow, setSow] = useState<SowLine[]>([])
  const [sowRev, setSowRev] = useState('')
  const [vos, setVos] = useState<VoWithLines[]>([])
  const [apps, setApps] = useState<Application[]>([])
  const [prev, setPrev] = useState<{ app: Application; lines: ApplicationLine[] } | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [showClient, setShowClient] = useState(true) // the Client Assessment is always there: it starts at 0% and carries on from the last one
  const [progress, setProgress] = useState<{ id: string; label: string; now: number; prog: number; n: number }[] | null>(null)
  const [progressMsg, setProgressMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const [{ app: a, lines: ls }, all, v] = await Promise.all([loadApplication(appId!), loadApplications(job.id), loadJobVariations(job)])
        setApp(a)
        setLines(Object.fromEntries(ls.map((l) => [l.sow_line_id ? sKey(l.sow_line_id) : vKey(l.variation_id!), l])))
        setApps(all)
        setVos(v)
        if (a.sow_revision_id) {
          const s = await loadSowRevision(a.sow_revision_id)
          setSow(s.lines)
          setSowRev(s.rev.revision)
        }
        const p = previousOf(a, all)
        if (p) setPrev({ app: p, lines: (await loadApplication(p.id)).lines })
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [appId, job])

  const lineList = useMemo(() => Object.values(lines), [lines])
  const fs = useMemo(() => (app ? frontSheet(job, app, sow, lineList, vos) : null), [job, app, sow, lineList, vos])
  const fsClient = useMemo(() => (app && showClient ? frontSheet(job, app, sow, lineList, vos, 'client') : null), [job, app, sow, lineList, vos, showClient])
  const fsPrev = useMemo(() => (prev ? frontSheet(job, prev.app, sow, prev.lines, vos) : null), [job, prev, sow, vos])

  const prevBy = useMemo(() => new Map((prev?.lines ?? []).map((l) => [l.sow_line_id ? sKey(l.sow_line_id) : vKey(l.variation_id!), l])), [prev])
  const notes = useMemo(
    () => (app && fs ? reviewApplication({ app, sow, lines: lineList, prevLines: prev?.lines ?? [], vos, fs, fsPrev, fsClient }) : []),
    [app, sow, lineList, prev, vos, fs, fsPrev, fsClient],
  )

  if (error && !app) return <p className="error">{error}</p>
  if (!app || !fs) return <Loading />

  const setA = <K extends keyof Application>(k: K, v: Application[K]) => {
    setSaved(false)
    setApp({ ...app, [k]: v })
  }
  const blank = (sow_line_id: string | null, variation_id: string | null): ApplicationLine => ({ sow_line_id, variation_id, pct_claimed: null, amount_claimed: null, client_pct: null, client_amount: null, comment: null, client_comment: null })
  const setLine = (key: string, base: ApplicationLine, patch: Partial<ApplicationLine>, value: number) => {
    setSaved(false)
    setLines((ls) => {
      const l = { ...(ls[key] ?? base), ...patch }
      l.amount_claimed = l.pct_claimed == null ? null : r2(l.pct_claimed * value)
      l.client_amount = l.client_pct == null ? null : r2(l.client_pct * value)
      return { ...ls, [key]: l }
    })
  }

  async function save() {
    if (!app) return false
    setError(null)
    if (!navigator.onLine) {
      setError(saveError(new Error('offline')))
      return false
    }
    setBusy(true)
    try {
      await saveApplication(app, lineList)
      setSaved(true)
      return true
    } catch (e) {
      setError(saveError(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function revise() {
    if (!app || !(await save())) return
    try {
      navigate(`/jobs/${job.id}/applications/${await newRevision(app, apps)}`)
    } catch (e) {
      setError(saveError(e))
    }
  }

  async function exportXlsx() {
    if (!app || !fs) return
    try {
      await exportApplication({ job, app, sow, sowRev, lines: lineList, vos, fs, fsClient, fsPrev, prevName: prev ? appName(prev.app) : null })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // ---------- SoW by section ----------
  const sections: { head: SowLine; items: SowLine[] }[] = []
  for (const l of sow) {
    if (l.kind === 'section' || !sections.length) sections.push({ head: l, items: [] })
    if (l.kind === 'item') sections[sections.length - 1].items.push(l)
  }
  const claimedIn = (items: SowLine[], which: 'pct_claimed' | 'client_pct') =>
    items.filter((i) => !i.below_line).reduce((s, i) => s + r2((lines[sKey(i.id)]?.[which] ?? 0) * Number(i.total ?? 0)), 0)

  // suggest each section's % from the programme's progress (it only ever raises a line, never lowers it)
  async function openProgress() {
    setProgressMsg(null)
    try {
      const { tasks } = await loadProgramme(job.id)
      const rows = sections
        .filter((s) => s.head.kind === 'section' && !s.head.below_line)
        .map((s) => {
          const p = programmeProgress(s.head.description ?? '', tasks)
          const total = s.items.filter((i) => !i.below_line).reduce((a, i) => a + Number(i.total ?? 0), 0)
          const now = total ? Math.round((claimedIn(s.items, 'pct_claimed') / total) * 100) : 0
          return p ? { id: s.head.id, label: s.head.description ?? '', now, prog: p.pct, n: p.n } : null
        })
        .filter((r): r is NonNullable<typeof r> => !!r)
      setProgress(rows)
      if (!rows.length) setProgressMsg('No programme activities match the names of the SoW sections yet (or there is no programme with progress on it).')
    } catch (e) {
      setProgressMsg((e as Error).message)
    }
  }
  function applyProgress(ids: string[]) {
    setSaved(false)
    setLines((ls) => {
      const out = { ...ls }
      for (const id of ids) {
        const row = progress?.find((r) => r.id === id)
        const sec = sections.find((s) => s.head.id === id)
        if (!row || !sec) continue
        for (const i of sec.items) {
          if (i.below_line || i.total == null) continue
          const key = sKey(i.id)
          const cur = out[key] ?? blank(i.id, null)
          if ((cur.pct_claimed ?? 0) < row.prog / 100) out[key] = { ...cur, pct_claimed: row.prog / 100, amount_claimed: r2((row.prog / 100) * Number(i.total)) }
        }
      }
      return out
    })
  }
  // comments carried over from the last application: clear the ones that are unchanged
  const carried = Object.entries(lines).filter(([k, l]) => (l.comment && l.comment === prevBy.get(k)?.comment) || (l.client_comment && l.client_comment === prevBy.get(k)?.client_comment)).length
  function clearCarried() {
    if (!window.confirm(`Clear the ${carried} comment${carried === 1 ? '' : 's'} carried over from the last application? Comments you have changed are kept.`)) return
    setSaved(false)
    setLines((ls) =>
      Object.fromEntries(
        Object.entries(ls).map(([k, l]) => [
          k,
          { ...l, comment: l.comment && l.comment === prevBy.get(k)?.comment ? null : l.comment, client_comment: l.client_comment && l.client_comment === prevBy.get(k)?.client_comment ? null : l.client_comment },
        ]),
      ),
    )
  }

  const allOpen = sections.length > 0 && sections.every((s) => open[s.head.id])

  return (
    <div className="app-editor">
      <div className="sub-bar">
        <div>
          <button type="button" onClick={() => navigate(`/jobs/${job.id}/applications`)}>
            ← All applications
          </button>
          <h2>{appName(app)}</h2>
          <span className={`app-status ${app.status}`}>{APP_STATUS_LABELS[app.status]}</span>
          <span className="muted small"> priced against SoW {sowRev}</span>
        </div>
        <div className="button-row">
          <button onClick={exportXlsx}>Export Excel</button>
          <button onClick={revise} title="Keep this revision as sent and start the next (R2, R3…)">
            New revision
          </button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {saved && <p className="saved">Saved.</p>}

      <div className="app-steps" role="group" aria-label="Where this application is up to">
        {(['draft', 'checked', 'submitted', 'assessed', 'paid'] as AppStatus[]).map((s, n) => (
          <button
            key={s}
            type="button"
            className={`app-step ${s} ${app.status === s ? 'on' : ''}`}
            onClick={() => (setSaved(false), setApp({ ...app, status: s, ...(s === 'submitted' && !app.submitted_date ? { submitted_date: todayIso() } : {}) }))}
          >
            <span className="app-step-no">{n + 1}</span> {APP_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <section className="card app-check">
        <h2>Check before issuing</h2>
        {notes.length === 0 ? (
          <p className="ok">✓ Nothing to flag.</p>
        ) : (
          <ul className="check-list">
            {notes.map((n, i) => (
              <li key={i} className={n.level}>
                {n.level === 'error' ? '✕' : n.level === 'warn' ? '⚠' : 'ℹ'} {n.text}
              </li>
            ))}
          </ul>
        )}
        <button className="small-button" disabled={notes.some((n) => n.level === 'error') || app.status !== 'draft'} onClick={() => setA('status', 'checked')} title="Marks it Checked (save afterwards)">
          Mark as checked
        </button>
      </section>

      <section className="card app-cert">
        <h2>What the client certified</h2>
        <div className="form-grid">
          <Num label="Client certified £ (before VAT)" value={app.client_certified} onChange={(v) => setA('client_certified', v)} />
          <div>
            <span className="muted small">We claimed (total claimed)</span>
            <strong className="block">{money(fs.totalClaimed)}</strong>
          </div>
          {fsClient && (
            <div>
              <span className="muted small">Client Assessment</span>
              <strong className="block">{money(fsClient.totalClaimed)}</strong>
            </div>
          )}
        </div>
        {app.client_certified != null && Math.abs(app.client_certified - fs.totalClaimed) > 0.5 && (
          <p className="warning">
            The client certified {money(app.client_certified)}, which is {money(Math.abs(app.client_certified - fs.totalClaimed))} {app.client_certified < fs.totalClaimed ? 'less' : 'more'} than we claimed. The
            figure they certified is what the cashflow and CVR use.
          </p>
        )}
        {fsClient && app.client_certified == null && (
          <button className="small-button" onClick={() => setA('client_certified', r2(fsClient.totalClaimed))}>
            Use the Client Assessment total claimed ({money(fsClient.totalClaimed)})
          </button>
        )}
      </section>

      <div className="app-top">
        <section className="card">
          <h2>Anticipated Final Account</h2>
          <FrontSheetTable fs={fs} client={fsClient} prev={fsPrev} prevName={prev ? appName(prev.app) : null} />
        </section>

        <section className="card">
          <h2>Details</h2>
          <div className="form-grid">
            <label>
              Valuation date
              <input type="date" value={app.valuation_date ?? ''} onChange={(e) => setA('valuation_date', e.target.value || null)} />
            </label>
            <Num label="Psum adjustment £" value={app.psum_adjustment} onChange={(v) => setA('psum_adjustment', v ?? 0)} />
            <Num label="Materials on site £" value={app.materials_on_site} onChange={(v) => setA('materials_on_site', v)} />
            <Num label="Loss and expense £ (e.g. EOT prolongation)" value={app.loss_and_expense} onChange={(v) => setA('loss_and_expense', v)} />
            <Num label="Retention %" value={app.retention_pct} onChange={(v) => setA('retention_pct', v)} />
            <label className="check">
              <span>
                <input
                  type="checkbox"
                  checked={app.practical_completion}
                  onChange={(e) => {
                    setA('practical_completion', e.target.checked)
                    if (e.target.checked) celebrate('Practical completion achieved!', 'Retention is halved on this application.')
                  }}
                />{' '}
                Practical completion (retention halved)
              </span>
            </label>
            <label className="check">
              <span>
                <input type="checkbox" checked={!!app.final_account} onChange={(e) => setA('final_account', e.target.checked)} /> This is the final account (the project is finished off)
              </span>
            </label>
            <Num label="Less deposits £" value={app.deposit} onChange={(v) => setA('deposit', v)} />
            <Num label="Less previous paid £" value={app.previously_paid} onChange={(v) => setA('previously_paid', v)} />
            <Num label="VAT %" value={app.vat_pct} onChange={(v) => setA('vat_pct', v ?? 20)} />
            <div />
            <Num label="Paid £" value={app.paid_amount} onChange={(v) => setA('paid_amount', v)} />
            <label>
              Paid on
              <input type="date" value={app.paid_date ?? ''} onChange={(e) => setA('paid_date', e.target.value || null)} />
            </label>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="pane-head">
          <h2>Schedule of works</h2>
          <div className="button-row">
            <label className="check">
              <span>
                <input type="checkbox" checked={showClient} onChange={(e) => setShowClient(e.target.checked)} /> Client Assessment
              </span>
            </label>
            {prev && carried > 0 && (
              <button className="small-button" onClick={clearCarried} title="Comments are carried over from the last application: clear the ones you have not changed">
                Clear carried-over comments ({carried})
              </button>
            )}
            <button className="small-button" onClick={openProgress} title="Suggest each section's % from the programme's progress">
              Suggest from programme
            </button>
            <button className="small-button" onClick={() => setOpen(Object.fromEntries(sections.map((s) => [s.head.id, !allOpen])))}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        </div>
        {progressMsg && <p className="muted small">{progressMsg}</p>}
        {progress && progress.length > 0 && (
          <div className="app-progress">
            <p className="muted small">
              The programme's progress for each section, from the activities whose names match it. Applying only raises a line that is lower, never lowers one. Check them: matching is by name.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th className="num">Claimed now</th>
                  <th className="num">Programme</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {progress.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.label} <span className="muted small">({r.n} activit{r.n === 1 ? 'y' : 'ies'})</span>
                    </td>
                    <td className="num">{r.now}%</td>
                    <td className="num">{r.prog}%</td>
                    <td>
                      <button className="small-button" disabled={r.prog <= r.now} onClick={() => applyProgress([r.id])}>
                        Use {r.prog}%
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="button-row">
              <button className="small-button" onClick={() => applyProgress(progress.filter((r) => r.prog > r.now).map((r) => r.id))}>
                Apply all
              </button>
              <button className="small-button" onClick={() => setProgress(null)}>
                Close
              </button>
            </div>
          </div>
        )}
        <table className={`table app-sow ${showClient ? 'with-client' : ''}`}>
          <thead>
            <tr>
              <th>#</th>
              <th>Description</th>
              <th className="num">Total</th>
              {prev && <th className="num">Last %</th>}
              <th className="num">Claimed %</th>
              <th className="num">£</th>
              <th>dbp comments</th>
              {showClient && (
                <>
                  <th className="num">Client %</th>
                  <th className="num">Client £</th>
                  <th>Client comments</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sections.map(({ head, items }) => {
              const isOpen = !!open[head.id]
              const total = items.filter((i) => !i.below_line).reduce((s, i) => s + Number(i.total ?? 0), 0)
              const claimed = claimedIn(items, 'pct_claimed')
              return (
                <Fragment key={head.id}>
                  <tr className={`sec-row ${head.below_line ? 'below' : ''}`} onClick={() => setOpen({ ...open, [head.id]: !isOpen })}>
                    <td>{isOpen ? '▾' : '▸'} {head.kind === 'section' ? head.item_ref : ''}</td>
                    <td>
                      <strong>{head.kind === 'section' ? head.description : 'Items'}</strong>
                      {head.below_line && <span className="muted small"> · below the line, not claimed</span>}
                    </td>
                    <td className="num">{money(total)}</td>
                    {prev && <td />}
                    <td className="num">{total ? `${Math.round((claimed / total) * 1000) / 10}%` : ''}</td>
                    <td className="num">{money(claimed)}</td>
                    <td />
                    {showClient && (
                      <>
                        <td />
                        <td className="num">{money(claimedIn(items, 'client_pct'))}</td>
                        <td />
                      </>
                    )}
                  </tr>
                  {isOpen &&
                    items.map((i) => {
                      const key = sKey(i.id)
                      const l = lines[key]
                      const value = Number(i.total ?? 0)
                      const priced = i.total != null && !i.below_line
                      return (
                        <tr key={i.id} className={`item-row ${priced ? '' : 'unpriced'}`}>
                          <td className="muted">{i.item_ref}</td>
                          <td className="desc" title={i.description ?? ''}>
                            {i.description}
                          </td>
                          <td className="num" data-label="Total">
                            {i.total != null ? money(i.total) : <span className="muted">{i.total_text}</span>}
                          </td>
                          {prev && (
                            <td className="num muted" data-label="Last %">
                              {priced && pctText(prevBy.get(key)?.pct_claimed ?? 0) + '%'}
                            </td>
                          )}
                          <td className="num" data-label="Claimed %">
                            {priced && (
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                max="100"
                                step="any"
                                className="pct-in"
                                value={pctText(l?.pct_claimed)}
                                onChange={(e) => setLine(key, blank(i.id, null), { pct_claimed: pctVal(e.target.value) }, value)}
                              />
                            )}
                          </td>
                          <td className="num" data-label="£">
                            {l?.amount_claimed != null ? money(l.amount_claimed) : ''}
                          </td>
                          <td data-label="Comment">
                            {priced && <input className="comment-in" value={l?.comment ?? ''} onChange={(e) => setLine(key, blank(i.id, null), { comment: e.target.value || null }, value)} />}
                          </td>
                          {showClient && (
                            <>
                              <td className="num" data-label="Client %">
                                {priced && (
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    step="any"
                                    className="pct-in"
                                    value={pctText(l?.client_pct ?? 0)}
                                    onChange={(e) => setLine(key, blank(i.id, null), { client_pct: pctVal(e.target.value) ?? 0 }, value)}
                                  />
                                )}
                              </td>
                              <td className="num" data-label="Client £">
                                {priced ? money(l?.client_amount ?? 0) : ''}
                              </td>
                              <td data-label="Client comments">
                                {priced && <input className="comment-in" value={l?.client_comment ?? ''} onChange={(e) => setLine(key, blank(i.id, null), { client_comment: e.target.value || null }, value)} />}
                              </td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                </Fragment>
              )
            })}
            <tr className="grand-row">
              <td colSpan={2}>Construction</td>
              <td className="num">{money(sow.filter((s) => s.kind === 'item' && !s.below_line).reduce((t, s) => t + Number(s.total ?? 0), 0))}</td>
              {prev && <td />}
              <td />
              <td className="num">{money(fs.construction)}</td>
              <td />
              {showClient && (
                <>
                  <td />
                  <td className="num">{fsClient ? money(fsClient.construction) : ''}</td>
                  <td />
                </>
              )}
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Variations</h2>
        {vos.length === 0 && <p className="muted">No VOs on this job.</p>}
        {vos.length > 0 && (
          <table className="table app-vos stack">
            <thead>
              <tr>
                <th>VO</th>
                <th>Name</th>
                <th className="num">Firm</th>
                <th className="num">Claimed %</th>
                <th className="num">£</th>
                <th>Comments</th>
                {showClient && (
                  <>
                    <th className="num">Client %</th>
                    <th className="num">Client £</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {vos.map(({ vo, build }) => {
                const key = vKey(vo.id)
                const l = lines[key]
                const claimable = build.priced && vo.status !== 'rejected'
                return (
                  <tr key={vo.id}>
                    <td className="stack-title nowrap">
                      <span className={`vo-chip ${vo.status}`}>VO {vo.vo_no}</span>
                    </td>
                    <td className="stack-sub">{vo.title}</td>
                    <td className="num" data-label="Firm">
                      {build.priced ? money(build.total) : <span className="muted">budget {money(vo.budget_value)}</span>}
                    </td>
                    <td className="num" data-label="Claimed %">
                      {claimable && (
                        <input type="number" inputMode="decimal" step="any" className="pct-in" value={pctText(l?.pct_claimed)} onChange={(e) => setLine(key, blank(null, vo.id), { pct_claimed: pctVal(e.target.value) }, build.total)} />
                      )}
                    </td>
                    <td className="num" data-label="£">
                      {l?.amount_claimed != null ? money(l.amount_claimed) : ''}
                    </td>
                    <td data-label="Comments">
                      <input className="comment-in" value={l?.comment ?? ''} onChange={(e) => setLine(key, blank(null, vo.id), { comment: e.target.value || null }, build.total)} />
                    </td>
                    {showClient && (
                      <>
                        <td className="num" data-label="Client %">
                          {claimable && (
                            <input type="number" inputMode="decimal" step="any" className="pct-in" value={pctText(l?.client_pct ?? 0)} onChange={(e) => setLine(key, blank(null, vo.id), { client_pct: pctVal(e.target.value) ?? 0 }, build.total)} />
                          )}
                        </td>
                        <td className="num" data-label="Client £">
                          {claimable ? money(l?.client_amount ?? 0) : ''}
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="muted small">Only priced VOs can be claimed (budget-only VOs count towards the final account, not the application).</p>
      </section>

      <label className="card">
        Notes (internal)
        <textarea rows={3} value={app.notes ?? ''} onChange={(e) => setA('notes', e.target.value || null)} />
      </label>

      {error && <p className="error">{error}</p>}
      {saved && <p className="saved">Saved.</p>}
      <div className="form-actions">
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={exportXlsx}>Export Excel</button>
      </div>
    </div>
  )
}

function Num({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <label>
      {label}
      {label.includes('£') ? (
        <MoneyInput value={value} onChange={onChange} />
      ) : (
        <input type="number" step="any" inputMode="decimal" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      )}
    </label>
  )
}

// The front sheet on screen: this application, Client assessment, previous application (no movement: that is for payment notices).
export const FRONT_ROWS: [keyof FrontSheet, string, boolean?][] = [
  ['contractSum', 'Contract sum'],
  ['psum', 'Psum adjustment'],
  ['variations', 'Variations'],
  ['afa', 'Anticipated final account', true],
  ['construction', 'Construction'],
  ['voClaimed', 'Variations'],
  ['mos', 'Materials on site'],
  ['lossAndExpense', 'Loss and expense'],
  ['totalApplication', 'Total application', true],
  ['retention', 'Less retention'],
  ['deposits', 'Less deposits'],
  ['totalClaimed', 'Total claimed', true],
  ['lessPrevious', 'Less previous paid'],
  ['outstanding', 'Amount outstanding', true],
  ['vat', 'VAT'],
  ['totalOutstanding', 'Total outstanding', true],
]

function FrontSheetTable({ fs, client, prev, prevName }: { fs: FrontSheet; client: FrontSheet | null; prev: FrontSheet | null; prevName: string | null }) {
  return (
    <table className="table fs-table">
      <thead>
        <tr>
          <th />
          <th className="num">This application</th>
          {client && <th className="num">Client assessment</th>}
          {prev && <th className="num">{prevName}</th>}
        </tr>
      </thead>
      <tbody>
        {FRONT_ROWS.map(([k, label, bold], i) => {
          const finalAccount = i < 4
          return (
            <tr key={k + i} className={`${bold ? 'fs-bold' : ''} ${i === 4 ? 'fs-gap' : ''}`}>
              <td>
                {label}
                {k === 'retention' && <span className="muted small"> {fs.retentionPct}%</span>}
                {k === 'vat' && <span className="muted small"> {fs.vatPct}%</span>}
              </td>
              <td className="num">{money(fs[k])}</td>
              {client && <td className="num">{finalAccount ? '' : money(client[k])}</td>}
              {prev && <td className="num">{money(prev[k])}</td>}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
